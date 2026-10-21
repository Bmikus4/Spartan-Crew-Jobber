// ============================================================================
// One captured client email, end to end: read -> ground -> plan -> record -> (maybe) write.
// ----------------------------------------------------------------------------
// Every email ends in a recorded decision (v2_decisions): written, left for a person with
// the reasons, or no action with the reason. A silent drop has no row shape. Nothing is
// sent to ops: the office TV reads this table (feed/v2.ts) and that is how they hear of it.
// Writes run only when the caller asks and only through runOp, on real clients only under
// SPARTAN_WRITES=live (paused.ts).
//
// The frozen engine's tables are read, never written: thread_messages for the email,
// conversation_state for the thread's order (the thread itself naming its booking).
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { httpTransport, OnsinchClient } from "../engine/onsinch";
import { matchCompanyByDomain, normName } from "../engine/resolve";
import { extractWithMeta, type Extraction, type ExtractMeta } from "./interpret/extract";
import { ground, type Interpretation, type Request } from "./interpret/interpret";
import { latestText } from "./interpret/ground";
import { plan, type Decision, type World } from "./interpret/plan";
import { runOp, type RunResult } from "./bot/run";
import type { Op } from "./bot/ops";
import { utcToLondon } from "./bot/ops";
import { noTrace, type Tracer } from "./trace";
import { v2Writes } from "../paused";

/**
 * Whether the bot may create and update orders for real clients now: the Settings master switch
 * (bot_writes_enabled) AND the server's SPARTAN_WRITES=live. Read at every decision, so turning
 * it off in Settings stops the next write. A settings read that fails is off: TEST 515 only.
 */
export async function botWrites(): Promise<boolean> {
  if (!v2Writes()) return false;
  return getSettings().then((s) => s.bot_writes_enabled === true).catch(() => false);
}
import { linkedOrderId } from "./threadOrder";
import { linkFound, recordLink } from "./links";
import type { Grounded as Asked, ThreadMsg } from "./threadState";
import { bookingsOf, contextText, venuesOf, type ReadContext, type ThreadLine } from "./interpret/context";
import { readRows } from "./read";
import { getSettings } from "../settingsDb";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;
async function db(): Promise<NeonQueryFunction<false, false>> {
  if (!_sql) {
    const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
    if (!url) throw new Error("no database configured");
    _sql = neon(url);
  }
  if (!_ready) {
    await _sql`
      CREATE TABLE IF NOT EXISTS v2_decisions (
        message_id     TEXT PRIMARY KEY,
        thread_id      TEXT,
        from_address   TEXT,
        sent_at        TEXT,
        kind           TEXT NOT NULL,
        interpretation JSONB,
        decision       JSONB NOT NULL,
        executed       JSONB,
        code_version   TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    // The client as the TV names it; resolved here because the TV must not read OnSinch per refresh.
    await _sql`ALTER TABLE v2_decisions ADD COLUMN IF NOT EXISTS company_id INTEGER, ADD COLUMN IF NOT EXISTS company TEXT`;
    _ready = true;
  }
  return _sql;
}

/**
 * The build that made a decision. A row tagged "local" is hidden from the TV (it is a dev run),
 * so production must never write it: a deploy without a commit sha (a CLI redeploy, measured
 * 10-10: 10 of 16 rows blank) is "deployed-unknown", not "local".
 */
export const codeVersion = () => (process.env.VERCEL ? process.env.VERCEL_GIT_COMMIT_SHA || "deployed-unknown" : process.env.VERCEL_GIT_COMMIT_SHA ?? "local");

const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);
const NESTED = "Job__SlotTeam__Slot__SlotLocation";

/** OnSinch, read-only, as the planner needs it. Orders are read from a recent id floor: a booking is changed long before 2,000 newer orders exist. */
export function onsinchWorld(): World {
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
  const client = new OnsinchClient(t);
  return {
    companies: () => client.allCompanies(),
    placesNamed: async (name) => (await client.allPlaces()).filter((p: any) => normName(p.name) === normName(name)).map((p: any) => ({ id: Number(p.id), name: String(p.name) })),
    allPlaces: async () => (await client.allPlaces()).map((p: any) => ({ id: Number(p.id), name: String(p.name ?? ""), address: String(p.address ?? "").trim() || undefined })),
    companyOrders: async (companyId) => {
      const out: any[] = [];
      // The client's newest 1,000 orders, newest first (the API's default order). A "recent
      // floor" taken from the LAST page read the oldest id and so filtered nothing (10-15).
      for (let page = 1; page <= 10; page++) {
        const rows = await readRows(t as any, `/orders?company_id[eq]=${companyId}&with=${NESTED}&limit=100&page=${page}`);
        out.push(...rows);
        if (rows.length < 100) break;
      }
      return out;
    },
    orderByNumber: async (n) => (await readRows(t as any, `/orders?number[eq]=${encodeURIComponent(n)}&with=${NESTED}`))[0] ?? null,
    orderById: async (id) => (await readRows(t as any, `/orders?id[eq]=${id}&with=${NESTED}`))[0] ?? null,
    professions: async () => (await readRows(t as any, "/professions?limit=200")).filter((p: any) => !p.deleted).map((p: any) => ({ id: String(p.id), name: String(p.name ?? "").trim() })),
  };
}

/** The reader's context for one email: the thread, and the client's bookings and venues as OnSinch held them. */
export async function readContext(world: World, companyId: number | null, sentIso: string, thread: ThreadLine[]): Promise<ReadContext> {
  if (!companyId) return { thread, bookings: [], venues: [] };
  const orders = await world.companyOrders(companyId);
  const all = world.allPlaces ? await world.allPlaces() : [];
  const places = new Map(all.map((p) => [Number(p.id), { name: p.name, address: p.address }]));
  return { thread, bookings: bookingsOf(orders, sentIso, (id) => places.get(id)?.name ?? `place ${id}`), venues: venuesOf(orders, places) };
}

/**
 * WRITES THAT STOPPED BEFORE ANYTHING WAS SENT ARE TRIED AGAIN, up to twice, within 6 hours: a
 * browser timeout before the submit, the bot busy, an unreadable audit log (Lux Technical
 * 10-12 timed out waiting for the builder and nothing ever tried again). Only "blocked" and
 * "busy" are retried: nothing left the browser. "unknown" may have landed and is never re-sent.
 */
const TRANSIENT = /bot error before submit|another operation holds the bot|audit log unreadable|Timeout|page raised|order read 5\d\d|net::|ECONNRESET|fetch failed/i;
export async function retryStopped(): Promise<{ retried: number; results: string[] }> {
  const sql = await db();
  // Only a decision this build made is retried: an older build's plan is not re-run on its
  // authority (10-13: ec938be had planned a Lux Technical shift on 1 October, already past).
  const rows = (await sql`SELECT message_id, thread_id, decision, executed FROM v2_decisions
    WHERE kind = 'write' AND jsonb_typeof(executed) = 'array' AND created_at > now() - interval '6 hours' AND code_version = ${codeVersion()} ORDER BY created_at`) as any[];
  const results: string[] = [];
  const today = utcToLondon(new Date().toISOString()).date;
  const writing = await botWrites();
  for (const d of rows) {
    const ex = d.executed as RunResult[];
    const last = ex[ex.length - 1];
    const tries = Number(d.decision?.retries ?? 0);
    // "busy" is answered before the ledger or the browser (runWhenFree waited 2 minutes for it).
    const stopped = last && (last.status === "busy" || (last.status === "blocked" && TRANSIENT.test(last.reasons.join(" "))));
    if (!stopped || tries >= 2 || !writing) continue;
    // Never a day already gone.
    if ((d.decision.ops as { op: any }[]).some(({ op }) => [op.date, ...(op.shifts ?? []).map((s: any) => s.date)].some((x) => typeof x === "string" && x < today))) continue;
    const done = ex.slice(0, -1);
    const todo = (d.decision.ops as { source: string; op: Op }[]).slice(done.length);
    const out: RunResult[] = [...done];
    for (const { source, op } of todo) {
      const r = await runOp(`${source}:retry${tries + 1}`, op, { testOnly: !writing });
      out.push(r);
      if (r.status !== "verified") break;
      const made = Number((r.detail as any)?.order_id) || ("order_id" in op ? Number(op.order_id) : 0);
      if (made) await recordLink(sql, { thread_id: d.thread_id, order_id: made, source: "bot write (retry)" }).catch(() => {});
    }
    await sql`UPDATE v2_decisions SET executed = ${JSON.stringify(out)}::jsonb, decision = jsonb_set(decision, '{retries}', ${String(tries + 1)}::jsonb) WHERE message_id = ${d.message_id}`;
    results.push(`${d.message_id}: ${out.map((r) => r.status).join(",")}`);
  }
  return { retried: results.length, results };
}

export type Processed = { message_id: string; skipped?: string; interpretation?: Interpretation; decision?: Decision; executed?: RunResult[] };

const NOT_CLIENT = /spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i;

const addr = (from: unknown) => String(from ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();

/** The sender's OnSinch company, the planner's rule (one company by the address's domain), or nulls. */
async function clientOf(from: string, world: World): Promise<{ id: number | null; name: string | null }> {
  try {
    const companies = await world.companies();
    const id = matchCompanyByDomain(from, companies);
    const name = id ? String(companies.find((c) => Number(c.id) === id)?.name ?? "").trim() : "";
    return { id: id || null, name: name || null };
  } catch {
    return { id: null, name: null };
  }
}

/**
 * Intake's entry, in shadow. n8n posts the whole thread whenever anything in it is new,
 * Spartan's own replies included, so what to decide on is what this delivery stored for the
 * first time. Measured 10-09: deciding on n8n's message id read each thread's FIRST message
 * (it is the Gmail thread id), and planned a 14 August PO email onto #13709 as new.
 *
 * Of several new client messages only the newest is read; the older ones are left for a
 * person, on the TV. Read apart, "4 crew" then "make it 5" would be acted on twice. Each message is decided once:
 * a re-post buys no second model call.
 */
export async function decideDelivery(newIds: string[]): Promise<Processed[]> {
  if (!newIds.length) return [];
  const sql = await db();
  const rows = (await sql`SELECT message_id, thread_id, from_address, date_iso, is_from_spartan FROM thread_messages WHERE message_id = ANY(${newIds}) ORDER BY date_iso, first_seen_at`) as any[];
  const out: Processed[] = [];
  const client = rows.filter((r) => !r.is_from_spartan && !NOT_CLIENT.test(addr(r.from_address)));
  // Every inbound message ends in a recorded state, filtered mail too: bounces and system
  // mail had no row (10 on 10-09/10), so "was this email handled?" had no answer for them.
  for (const r of rows.filter((r) => !r.is_from_spartan && NOT_CLIENT.test(addr(r.from_address)))) {
    const decision: Decision = { kind: "none", reason: "not a client's email" };
    await sql`
      INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, code_version)
      VALUES (${r.message_id}, ${r.thread_id}, ${addr(r.from_address)}, ${r.date_iso}, 'none', ${JSON.stringify(decision)}::jsonb, ${codeVersion()})
      ON CONFLICT (message_id) DO NOTHING`;
    out.push({ message_id: r.message_id, decision });
  }
  const newest = client[client.length - 1];
  // SEVERAL NEW CLIENT MESSAGES ARE READ AS ONE, oldest first, and decided once on the newest.
  // Until 10-11 the older ones were handed to a person unread; when the newest was "thanks"
  // the TV showed only that hand-off, and a booking sent a minute before it was lost to the
  // card (21 such hand-offs, 10-09..10-11). Read together, "4 crew" then "make it 5" is one
  // request for 5, so nothing is acted on twice.
  const earlier = newest ? client.slice(0, -1) : [];
  for (const r of earlier) {
    const decision: Decision = { kind: "none", reason: `read together with the later email ${newest.message_id}` };
    await sql`
      INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, code_version)
      VALUES (${r.message_id}, ${r.thread_id}, ${addr(r.from_address)}, ${r.date_iso}, 'none', ${JSON.stringify(decision)}::jsonb, ${codeVersion()})
      ON CONFLICT (message_id) DO NOTHING`;
    out.push({ message_id: r.message_id, decision });
  }
  if (newest) {
    const seen = (await sql`SELECT kind FROM v2_decisions WHERE message_id = ${newest.message_id}`) as any[];
    out.push(seen.length ? { message_id: newest.message_id, skipped: `already decided (${seen[0].kind})` } : await processMessage(newest.message_id, { execute: await botWrites(), with: earlier.map((r) => r.message_id) }));
  }
  return out;
}

/**
 * The bot runs one operation at a time (bot_lease, 240s), so two emails a minute apart can
 * meet. "busy" is answered before the ledger or the browser, so nothing was sent and asking
 * again is safe. Two minutes of waiting fits the intake route's 300s with a write after it.
 */
async function runWhenFree(source: string, op: Parameters<typeof runOp>[1]): Promise<RunResult> {
  for (let waited = 0; ; waited += 10) {
    const r = await runOp(source, op, { testOnly: !(await botWrites()) });
    if (r.status !== "busy" || waited >= 120) return r;
    await new Promise((done) => setTimeout(done, 10_000));
  }
}

export type MessageIn = { message_id: string; thread_id: string; from_address: string; date_iso: string; subject: string | null; body: string | null; is_from_spartan: boolean };
export type Client = { id: number | null; name: string | null };
export type Recorded = { kind: Decision["kind"]; interpretation: { extraction: Extraction; grounded: Interpretation; meta?: ExtractMeta } | null; decision: Decision; executed: RunResult[] | null; client: Client };

/**
 * Everything one message's handling needs from outside, so the office and the harness run
 * the SAME decision code: production passes the database, OnSinch and the bot; the harness
 * passes recordings, a fake OnSinch and a recording runner. There is no test branch here.
 */
export type DecideDeps = {
  extract: typeof extractWithMeta;
  /** The thread's earlier messages, oldest first, each cut to its own newest part. */
  thread?: () => Promise<ThreadLine[]>;
  world: World;
  /** The order the thread itself is bound to, if any. */
  threadOrderId: () => Promise<number | null>;
  /** The client's own requests in earlier emails on this thread, as they were grounded then. */
  prior?: () => Promise<Request[]>;
  /** Null: decide and record only (shadow). */
  run: ((source: string, op: Op) => Promise<RunResult>) | null;
  /** Settings' create_lead_days; null when the rule is switched off; absent, the planner's own default. */
  leadDays?: () => Promise<number | null | undefined>;
  /** The moment of deciding: a day before it is already over and is never written. Absent, only a day before the email is refused. */
  now?: () => number;
  /** Planned again after the fact (v2/replan.ts): staff's work since the email stands (plan.ts PlanOpts.again). */
  again?: boolean;
  /** The whole thread, ours included, for finding the order it is about (plan.ts findOrder). */
  threadMessages?: () => Promise<ThreadMsg[]>;
  /** Every request read anywhere on the thread, later emails included (replan.ts), for finding only. */
  asked?: () => Promise<Asked[]>;
  /**
   * The thread is now about this order: kept in job_links and swept every minute (links.ts).
   * `source` "bot write" for an order the bot wrote; anything else is a find, which never
   * displaces a live link (links.ts linkFound).
   */
  link?: (order_id: number, source?: string) => Promise<void>;
  record: (r: Recorded) => Promise<void>;
  trace: Tracer;
};

export async function decideMessage(m: MessageIn, deps: DecideDeps): Promise<Recorded> {
  const from = addr(m.from_address);
  if (m.is_from_spartan || NOT_CLIENT.test(from)) {
    const r: Recorded = { kind: "none", interpretation: null, decision: { kind: "none", reason: "not a client's email" }, executed: null, client: { id: null, name: null } };
    deps.trace("filter", { client: false });
    await deps.record(r);
    deps.trace("final", { kind: r.kind });
    return r;
  }
  deps.trace("filter", { client: true });
  let client = await clientOf(from, deps.world);
  // A sender OnSinch has no contact for, on a thread already linked to an order: that order's
  // company is the client (the planner applies the same rule).
  if (!client.id && deps.world.orderById) {
    const tid = await deps.threadOrderId().catch(() => null);
    const o = tid ? await deps.world.orderById(tid).catch(() => null) : null;
    if (o && Number(o.company_id) > 0) {
      const c = (await deps.world.companies()).find((x) => Number(x.id) === Number(o.company_id));
      client = { id: Number(o.company_id), name: c ? String(c.name ?? "").trim() || null : null };
    }
  }
  const newest = latestText(String(m.body ?? ""));
  // What the reader is shown besides the newest message (context.ts says why).
  const read = await readContext(deps.world, client.id, m.date_iso, deps.thread ? await deps.thread().catch(() => []) : []).catch(() => undefined);
  // A READ THAT FAILS IS A CARD FOR A PERSON, NEVER A SILENT DROP. n8n passes each message
  // once, so an email whose model call threw (OpenRouter 402 when the account ran dry, 10-11;
  // a timeout) had no decision and nothing would ever look at it again.
  let got: Awaited<ReturnType<DecideDeps["extract"]>>;
  try {
    got = await deps.extract(m.date_iso, from, String(m.subject ?? ""), newest, read ? contextText(read) : "");
  } catch (e) {
    const reason = `the system could not read this email (${String((e as Error)?.message ?? e).slice(0, 120)})`;
    const out: Recorded = { kind: "handoff", interpretation: null, decision: { kind: "handoff", reasons: [reason] }, executed: null, client };
    deps.trace("extract", { error: reason });
    await deps.record(out);
    deps.trace("final", { kind: out.kind });
    return out;
  }
  // The model, prompt, tokens and cost of the reading are kept with the decision: until 10-11
  // they were traced and dropped, so no decision could say which model made it or what it cost.
  const { x, meta } = got;
  deps.trace("extract", { ...meta, intent: x.intent, requests: x.requests?.length ?? 0 }, meta.ms);
  const t1 = Date.now();
  const prior = deps.prior ? await deps.prior().catch(() => [] as Request[]) : [];
  const interpretation = ground(x, `${m.subject ?? ""}\n${newest}`, m.date_iso, { subject: String(m.subject ?? ""), prior, read, linkedOrderId: await deps.threadOrderId().catch(() => null) });
  deps.trace("ground", { problems: interpretation.problems.length + interpretation.requests.reduce((a, q) => a + q.problems.length, 0), notes: interpretation.notes ?? [] }, Date.now() - t1);
  const t2 = Date.now();
  const leadDays = deps.leadDays ? await deps.leadDays().catch(() => undefined) : undefined;
  // A PLAN THAT THROWS IS A CARD FOR A PERSON, like a read that fails: a time London's clock
  // skips, a window with no length or an OnSinch read that failed would otherwise lose the email.
  const decision: Decision = await plan({ message_id: m.message_id, from, subject: String(m.subject ?? ""), sentIso: m.date_iso, text: newest }, interpretation, deps.world, await deps.threadOrderId(),
    { leadDays, now: deps.now?.(), again: deps.again, thread: deps.threadMessages ? await deps.threadMessages().catch(() => undefined) : undefined,
      // The thread's earlier requests name its days too: SN ExCeL's 17th, 18th, 20th and 21st single out R10522.
      raw: [...rawRequests(x), ...prior.map((r) => ({ date: r.date ?? r.target?.date, start: r.start, crew: r.crew, place_id: r.place_id, venue: r.venue, target: r.target })),
        ...(deps.asked ? await deps.asked().catch(() => []) : [])] })
    .catch((e) => ({ kind: "handoff" as const, reasons: [`the system could not plan this email (${String((e as Error)?.message ?? e).slice(0, 120)})`] }));
  deps.trace("plan", { kind: decision.kind, ops: decision.kind === "write" ? decision.ops.map((o) => o.op.kind) : [], said: decision.kind === "write" ? decision.why : decision.kind === "handoff" ? decision.reasons : [decision.reason] }, Date.now() - t2);
  const out: Recorded = { kind: decision.kind, interpretation: { extraction: x, grounded: interpretation, meta }, decision, executed: null, client };
  await deps.record(out);
  // AN ORDER THE PLANNER FOUND IS THE THREAD'S ORDER. "already booked: R11599" was decided and
  // not kept, so the TV card for that thread showed no R number and the label sync had
  // nothing to say. One order found is linked; several are left for a person.
  // A booking staff split over several orders (MK Crew R11750-R11752, one per day) shows the order
  // holding its first day, the planner naming that one first: a job with no number is the error.
  if (decision.kind === "none" && decision.found?.length && deps.link) await deps.link(decision.found[0], "planner find").catch(() => {});
  // A card for a person names the order it is about, so the TV shows its R and J (plan.ts settle).
  if (decision.kind === "handoff" && decision.order_id && deps.link) await deps.link(decision.order_id, "finder").catch(() => {});
  if (!deps.run || decision.kind !== "write") { deps.trace("final", { kind: out.kind }); return out; }
  // RECORDED AFTER EVERY OPERATION, not once at the end: a function that times out between
  // two writes kept no record of the first, and the card said "not written" over a change
  // OnSinch had already made (B71/B72, 10-11).
  const executed: RunResult[] = [];
  for (const { source, op } of decision.ops) {
    const t3 = Date.now();
    const r = await deps.run(source, op);
    deps.trace("run", { op: op.kind, status: r.status, reasons: r.reasons }, Date.now() - t3);
    executed.push(r);
    out.executed = [...executed];
    await deps.record(out);
    if (r.status !== "verified") break;
    const made = Number((r.detail as any)?.order_id) || ("order_id" in op ? Number(op.order_id) : 0);
    if (made && deps.link) await deps.link(made, "bot write").catch(() => {});
  }
  deps.trace("final", { kind: out.kind, executed: executed.map((e) => e.status) });
  return out;
}

/** The reader's own values, for finding an order only: a day grounding refused still names it. */
const val = (g: unknown): any => (g && typeof g === "object" && "value" in (g as object) ? (g as { value: unknown }).value : g) ?? undefined;
export function rawRequests(x: Extraction): Asked[] {
  return (x.requests ?? []).map((q) => ({
    date: val(q.date), start: val(q.start), crew: typeof val(q.crew) === "number" ? val(q.crew) : undefined, venue: val(q.venue),
    target: q.target ? { date: val(q.target.date), start: val(q.target.start) } : undefined,
  }));
}

/** What a decision reads from the stored thread: the reader's context, the client's earlier requests, the whole thread. */
export function threadReads(sql: NeonQueryFunction<false, false>, m0: MessageIn, withIds: string[] = []): Pick<DecideDeps, "thread" | "prior" | "threadMessages"> {
  return {
    thread: async () => ((await sql`SELECT is_from_spartan, date_iso, body FROM thread_messages
      WHERE thread_id = ${m0.thread_id} AND date_iso < ${m0.date_iso} AND message_id <> ALL(${[m0.message_id, ...withIds]}) ORDER BY date_iso`) as any[])
      .slice(-6).map((r) => ({ who: r.is_from_spartan ? "spartan" as const : "client" as const, at: String(r.date_iso), text: latestText(String(r.body ?? "")) })),
    prior: async () => ((await sql`SELECT interpretation->'grounded'->'requests' AS rs FROM v2_decisions
      WHERE thread_id = ${m0.thread_id} AND sent_at < ${m0.date_iso} AND interpretation IS NOT NULL ORDER BY sent_at`) as any[]).flatMap((r) => (Array.isArray(r.rs) ? r.rs : [])),
    threadMessages: async () => ((await sql`SELECT message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan FROM thread_messages
      WHERE thread_id = ${m0.thread_id} ORDER BY date_iso`) as any[]).map((r) => ({
        message_id: String(r.message_id), from: addr(r.from_address), to: ([] as unknown[]).concat(r.to_addresses ?? []).map(String), at: Date.parse(String(r.date_iso)),
        subject: String(r.subject ?? ""), body: String(r.body ?? ""), ours: !!r.is_from_spartan || /@spartancrew\.co\.uk$/i.test(addr(r.from_address)),
      })),
  };
}

export async function processMessage(message_id: string, opts: { execute: boolean; world?: World; with?: string[] } = { execute: false }): Promise<Processed> {
  const sql = await db();
  const rows = (await sql`SELECT message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan FROM thread_messages WHERE message_id = ${message_id}`) as any[];
  const m0 = rows[0] as MessageIn | undefined;
  if (!m0) return { message_id, skipped: "message not captured" };
  // Earlier messages of the same delivery are read before this one, each cut to its own newest part.
  const before = opts.with?.length ? ((await sql`SELECT body FROM thread_messages WHERE message_id = ANY(${opts.with}) ORDER BY date_iso`) as any[]).map((r) => latestText(String(r.body ?? ""))) : [];
  const m: MessageIn = before.length ? { ...m0, body: [...before, latestText(String(m0.body ?? ""))].join("\n\n") } : m0;
  const from = addr(m.from_address);
  const r = await decideMessage(m, {
    extract: extractWithMeta,
    world: opts.world ?? onsinchWorld(),
    // Every recorded link (threadOrder.ts says which count).
    threadOrderId: () => linkedOrderId(sql, m.thread_id),
    ...threadReads(sql, m0, opts.with ?? []),
    run: opts.execute ? runWhenFree : null,
    // A settings read that fails keeps the rule on: undefined is the planner's default, never null.
    leadDays: () => getSettings().then((s) => (s.create_lead_enabled === false ? null : s.create_lead_days)),
    now: () => Date.now(),
    link: async (order_id, source = "bot write") => {
      if (source === "bot write") await recordLink(sql, { thread_id: m.thread_id, order_id, source });
      else await linkFound(sql, { thread_id: m.thread_id, order_id, source });
    },
    record: async (d) => {
      await sql`
        INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, interpretation, decision, executed, code_version, company_id, company)
        VALUES (${message_id}, ${m.thread_id}, ${from}, ${m.date_iso}, ${d.kind}, ${JSON.stringify(d.interpretation)}::jsonb, ${JSON.stringify(d.decision)}::jsonb, ${JSON.stringify(d.executed)}::jsonb, ${codeVersion()}, ${d.client.id}, ${d.client.name})
        ON CONFLICT (message_id) DO UPDATE SET kind = EXCLUDED.kind, interpretation = EXCLUDED.interpretation, decision = EXCLUDED.decision,
          executed = coalesce(EXCLUDED.executed, v2_decisions.executed), code_version = EXCLUDED.code_version,
          company_id = EXCLUDED.company_id, company = EXCLUDED.company`;
    },
    trace: noTrace,
  });
  if (!r.interpretation) return { message_id, skipped: "not a client's email", decision: r.decision };
  return { message_id, interpretation: r.interpretation.grounded, decision: r.decision, ...(r.executed ? { executed: r.executed } : {}) };
}
