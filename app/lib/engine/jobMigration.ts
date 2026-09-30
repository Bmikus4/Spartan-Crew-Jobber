// ============================================================================
// jobMigration — what the job tables would hold, planned from what we have now.
// ----------------------------------------------------------------------------
// Design §27 step 2-4 and §30 step 4, whose gate is a DRY RUN: nothing here writes.
// A job is identified by the engine, not by any OnSinch id (design §5); ids are links.
// Threads joined through any order they share are one job — the only hard evidence the
// history carries (23 orders already span 52 threads). A thread that asked for work and
// never held an order is a job with no link. Everything else is not a job.
//
// No model calls, by rule (the $57 night): the plan is built from rows, and the facts
// each job carries forward are the thread's stored facts, marked `migrated` later.
// ============================================================================

export interface OrderRecordRow {
  order_id: number | string;
  thread_id: string;
  job_id?: number | string | null;
  company_id?: number | string | null;
  id_source?: string | null;
}

export interface StateRow {
  thread_id: string;
  classification?: string;
  company_id?: number | null;
  onsinch_order_id?: number | string | null;
  order_action_log?: Array<{ kind?: string; order_id?: number | string; ok?: boolean }>;
}

export interface PlannedLink {
  onsinch_order_id: number;
  /** created: the engine raised it. matched: bound to an order it did not raise. */
  source: "created" | "matched";
  thread_id: string;
  /** Where the link was found; a link only one side holds is reported, not dropped. */
  seen_in: Array<"order_records" | "state" | "action_log">;
}

export interface PlannedJob {
  /** Deterministic, so a re-run of the dry run plans the same keys. */
  job_key: string;
  threads: string[];
  company_ids: number[];
  links: PlannedLink[];
}

export interface MigrationReport {
  threads: number;
  jobs: number;
  jobs_linked: number;
  jobs_unlinked: number;
  jobs_with_several_orders: number;
  jobs_merging_threads: number;
  jobs_spanning_companies: number;
  links: number;
  links_created: number;
  links_matched: number;
  links_missing_from_order_records: number;
  records_without_state: number;
  threads_not_jobs: number;
}

const WROTE = new Set(["create", "replace"]);
const ASKED = new Set(["new-job", "update"]);
const n = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);

export function planJobMigration(records: OrderRecordRow[], states: StateRow[]): { jobs: PlannedJob[]; report: MigrationReport } {
  // Union-find over thread and order nodes.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) { const up = parent.get(c)!; parent.set(c, r); c = up; }
    return r;
  };
  const add = (x: string) => { if (!parent.has(x)) parent.set(x, x); };
  const join = (a: string, b: string) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb); };

  const links = new Map<string, PlannedLink>(); // key thread|order
  const link = (thread_id: string, order: number, source: PlannedLink["source"], seen: PlannedLink["seen_in"][number]) => {
    const k = `${thread_id}|${order}`;
    const l = links.get(k);
    if (l) {
      if (!l.seen_in.includes(seen)) l.seen_in.push(seen);
      if (source === "created") l.source = "created"; // a create anywhere outranks a match
    } else links.set(k, { onsinch_order_id: order, source, thread_id, seen_in: [seen] });
    join(`t:${thread_id}`, `o:${order}`);
  };

  const stateByThread = new Map(states.map((s) => [s.thread_id, s]));
  let recordsWithoutState = 0;
  for (const r of records) {
    const order = n(r.order_id);
    if (!order || !r.thread_id) continue;
    if (!stateByThread.has(r.thread_id)) recordsWithoutState++;
    link(r.thread_id, order, r.id_source === "matched" ? "matched" : "created", "order_records");
  }
  for (const s of states) {
    add(`t:${s.thread_id}`);
    for (const a of s.order_action_log ?? []) {
      const order = n(a.order_id);
      if (order && a.ok && WROTE.has(String(a.kind))) link(s.thread_id, order, "created", "action_log");
    }
    const bound = n(s.onsinch_order_id);
    if (bound) link(s.thread_id, bound, "matched", "state");
  }

  const groups = new Map<string, { threads: Set<string>; links: PlannedLink[] }>();
  for (const node of parent.keys()) {
    if (!node.startsWith("t:")) continue;
    const root = find(node);
    const g = groups.get(root) ?? { threads: new Set<string>(), links: [] };
    g.threads.add(node.slice(2));
    groups.set(root, g);
  }
  for (const l of links.values()) groups.get(find(`t:${l.thread_id}`))!.links.push(l);

  const jobs: PlannedJob[] = [];
  let notJobs = 0;
  for (const g of groups.values()) {
    const threads = [...g.threads].sort();
    if (!g.links.length && !threads.some((t) => ASKED.has(String(stateByThread.get(t)?.classification)))) { notJobs++; continue; }
    const orders = [...new Set(g.links.map((l) => l.onsinch_order_id))].sort((a, b) => a - b);
    jobs.push({
      job_key: orders.length ? `job:o${orders[0]}` : `job:t${threads[0]}`,
      threads,
      company_ids: [...new Set(threads.map((t) => n(stateByThread.get(t)?.company_id)).filter((c): c is number => !!c))].sort((a, b) => a - b),
      links: g.links.sort((a, b) => a.onsinch_order_id - b.onsinch_order_id || a.thread_id.localeCompare(b.thread_id)),
    });
  }
  jobs.sort((a, b) => a.job_key.localeCompare(b.job_key));

  const all = jobs.flatMap((j) => j.links);
  const report: MigrationReport = {
    threads: [...parent.keys()].filter((k) => k.startsWith("t:")).length,
    jobs: jobs.length,
    jobs_linked: jobs.filter((j) => j.links.length).length,
    jobs_unlinked: jobs.filter((j) => !j.links.length).length,
    jobs_with_several_orders: jobs.filter((j) => new Set(j.links.map((l) => l.onsinch_order_id)).size > 1).length,
    jobs_merging_threads: jobs.filter((j) => j.threads.length > 1).length,
    jobs_spanning_companies: jobs.filter((j) => j.company_ids.length > 1).length,
    links: all.length,
    links_created: all.filter((l) => l.source === "created").length,
    links_matched: all.filter((l) => l.source === "matched").length,
    links_missing_from_order_records: all.filter((l) => !l.seen_in.includes("order_records")).length,
    records_without_state: recordsWithoutState,
    threads_not_jobs: notJobs,
  };
  return { jobs, report };
}
