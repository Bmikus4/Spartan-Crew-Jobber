// ============================================================================
// The 500-booking corpus study. Real orders, on the real tenant, TEST company 515.
// ----------------------------------------------------------------------------
//   npx tsx sim/corpus.ts --n=10            a pilot
//   npx tsx sim/corpus.ts --n=500           the study
//   npx tsx sim/corpus.ts --cleanup         delete everything the ledger lists
//   npx tsx sim/corpus.ts --n=500 --keep    leave the orders for eyes
//
// Pre-registered in docs/CORPUS-STUDY-2026-08.md. Read that first: it says what is
// being measured, what is NOT, and the number that would falsify each hypothesis.
//
// THE MODEL IS SCRIPTED, as in sim/run.ts. A live model would add a second variable to
// every failure — "wrong crew size" would mean either a misread email or a mis-composed
// order — and it would cost money. This run costs £0 in model spend, and that is a
// property worth keeping.
//
// EVERY ORDER ID IS LEDGERED BEFORE THE CALL THAT CREATES IT, so an order that exists is
// always an order the cleanup knows about. Results are appended per case rather than
// written at the end, so a crash keeps everything up to the crash.
// ============================================================================
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "../scripts/_env.mjs";
import { OnsinchClient, httpTransport, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody, buildSlotTeamBody } from "../app/lib/engine/format";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type ConversationFacts, type HydratedThread, type ThreadMessage } from "../app/lib/engine/types";
import type { Reasoner } from "../app/lib/engine/reason";
import { loadProfessions } from "./harness";
import { buildCases, expected, bodyFor, factsFor, COMPANY_NAME, COMPANY_ID, CONTACT, type Case } from "./corpusCases";
import { createOrderWithPlace } from "../app/lib/deps";

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");
const BASE = onsinchBase();

const OUT = join(import.meta.dirname, "..", ".tmp-data", "corpus");
const LEDGER = join(OUT, "ledger.json");
const RESULTS = join(OUT, "results.jsonl");
mkdirSync(OUT, { recursive: true });

const led: { orders: number[] } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { orders: [] };
const saveLedger = () => writeFileSync(LEDGER, JSON.stringify(led, null, 2));

const argOf = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : dflt;
};
const N = argOf("n", 500);
const CONCURRENCY = argOf("concurrency", 4);
const mode = process.argv.includes("--cleanup") ? "cleanup" : process.argv.includes("--keep") ? "keep" : "full";

interface CaseResult {
  id: string;
  factors: Record<string, unknown>;
  expected: ReturnType<typeof expected>;
  ok: boolean;
  error?: string;
  new_: { status?: string; order_id?: number; r?: string; job_id?: number; crew?: number; teams?: number; notes?: string[]; window?: string };
  amend_?: { status?: string; order_id?: number; r?: string; crew?: number; path?: string; notes?: string[]; window?: string; r_survived?: boolean; proven?: "PROVEN" | "ACCEPTED" | "n/a" };
  wire: string[];
  ms: number;
}

async function runCase(c: Case): Promise<CaseResult> {
  const t0 = Date.now();
  const wire: string[] = [];
  const logged: Transport = async (m, p, b) => {
    const r = await httpTransport({ baseUrl: BASE, apiKey: KEY })(m, p, b);
    if (m !== "GET") wire.push(`${m} ${p} -> ${r.status}`);
    // LEDGERED FROM THE WIRE, not from the return value of whichever function asked for
    // the order. A create that dies between its two phases is rolled back by the
    // production path, and a create that dies some way nobody has thought of is not —
    // either way the id passed through here, so either way cleanup knows about it.
    if (m === "POST" && p === "/orders" && r.status === 201) {
      const id = Number((r.data as { data?: { id?: number }[] })?.data?.[0]?.id);
      if (Number.isInteger(id) && !led.orders.includes(id)) { led.orders.push(id); saveLedger(); }
    }
    return r;
  };
  const onsinch = new OnsinchClient(logged);

  let phase: "new" | "amend" = "new";
  const reasoner: Reasoner = {
    async classify() {
      return phase === "new"
        ? { classification: "new-job" as const, priority: "high" as const, job_summary: c.id }
        : { classification: "update" as const, priority: "medium" as const, job_summary: `${c.id} amended` };
    },
    async extractFacts() { return factsFor(c, phase === "new" ? c.blocks : c.amended!); },
    async composeReply() { return { subject: `Re: ${c.id}`, html: "<p>noted</p>", priority: "high" as const }; },
  };

  const store = new InMemoryStore();
  let clock = 1_800_000_000_000;

  // The SAME executor shape as production (app/lib/deps.ts), including the two-phase
  // create and the in-place amendment with the stored ids. An executor missing
  // amendOrderInPlace would silently measure the old delete-and-repost path and report it
  // as the engine's behaviour.
  const executor: Executor = {
    async createReplyDraft() { return "no-draft"; },
    async createOrder(order) {
      // THE PRODUCTION FUNCTION, not a copy of it. A study that reimplements the thing it
      // is measuring measures the reimplementation: the first version of this executor
      // duplicated the two-phase create WITHOUT its rollback, and left a half-built order
      // behind on the first failure — a defect of the harness that would have been
      // reported as a defect of the engine.
      return createOrderWithPlace(onsinch, order);
    },
    async patchOrder(p) {
      const applied: string[] = [];
      const patch: Record<string, unknown> = { id: p.order_id };
      if (p.desired.specification) { patch.specification = p.desired.specification; applied.push("specification"); }
      if (p.desired.intern_name) { patch.intern_name = p.desired.intern_name; applied.push("intern_name"); }
      if (applied.length) await onsinch.patchOrder([patch as { id: number }]);
      return applied;
    },
    async amendOrderInPlace(p) {
      return amendOrderInPlace(
        onsinch,
        { order_id: p.order_id, previous: p.previous, desired: p.desired, alreadyCreated: p.alreadyCreated, known: p.known },
        { onCreated: p.onCreated }
      );
    },
    async replaceOrder(p) {
      const res = await replaceProvisionalOrder(
        onsinch,
        { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
        { onIntent: p.onIntent, onDeleted: p.onDeleted }
      );
      if (res.created) { led.orders.push(res.created.id); saveLedger(); }
      return res;
    },
    async identifiersForOrder(order_id) {
      const live = (await onsinch.orderById(order_id)) as { Job?: { id: number }[]; number?: string } | null;
      const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
      return { job_id: job?.id, order_number: live?.number != null ? String(live.number) : undefined };
    },
  };

  const deps: PipelineDeps = {
    reasoner, onsinch, now: () => ++clock, store,
    metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
    professions: loadProfessions(),
    // Pinned, so a case measures the booking rather than the rate-card hold: the test
    // company has no order history, and a derived card would stage every thread.
    seededRateCard: async () => 315,
    archiveOrder: async () => 1,
    recordReplacement: async () => {},
  };

  const windowOf = async (id?: number) => {
    if (!id) return undefined;
    const live = (await onsinch.orderById(id)) as { Job?: { min_beginning?: string; max_end?: string }[] } | null;
    const job = Array.isArray(live?.Job) ? live?.Job?.[0] : undefined;
    if (!job?.min_beginning) return undefined;
    return `${String(job.min_beginning).slice(0, 16)}..${String(job.max_end).slice(0, 16)}`;
  };

  const m = (id: string, at: string, body: string): ThreadMessage => ({
    message_id: id, from: CONTACT, to: ["bookings@spartancrew.co.uk"],
    date_iso: at, subject: `CORPUS ${c.id}`, body, is_from_spartan: false,
  });
  const thread = (msgs: ThreadMessage[]): HydratedThread => ({ thread_id: `corpus-${c.id}`, messages: msgs });

  const res: CaseResult = { id: c.id, factors: c.factors, expected: expected(c), ok: true, new_: {}, wire, ms: 0 };

  try {
    const email1 = m("m1", "2026-08-24T09:00:00Z", bodyFor(c, c.blocks, "new"));
    const s1 = await handleThread(thread([email1]), deps);
    res.new_ = {
      status: s1.status,
      order_id: s1.onsinch_order_id,
      r: s1.onsinch_order_number,
      job_id: s1.onsinch_job_id,
      crew: (s1.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0),
      teams: (s1.desired_order?.slot_teams ?? []).length,
      notes: s1.notes,
      window: await windowOf(s1.onsinch_order_id),
    };

    if (c.amend) {
      // THE PHASE FLAG IS WHAT MAKES THE SECOND EMAIL AN AMENDMENT. Without it the scripted
      // reasoner returns the first email's facts again, the engine sees no change, and the
      // run measures 250 no-ops as "amendments that did not apply".
      phase = "amend";
      const s2 = await handleThread(thread([
        email1,
        m("m2", "2026-08-24T11:00:00Z", bodyFor(c, c.amended!, "amend")),
      ]), deps);
      const path = s2.order_action_log.map((a) => `${a.kind}${a.ok ? "" : "!"}`).join(",");
      const after = await windowOf(s2.onsinch_order_id);
      res.amend_ = {
        status: s2.status,
        order_id: s2.onsinch_order_id,
        r: s2.onsinch_order_number,
        crew: (s2.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0),
        path,
        notes: s2.notes,
        window: after,
        r_survived: !!res.new_.r && res.new_.r === s2.onsinch_order_number,
        // PROVEN only where the job window can show it. Everything else is a 204 and a
        // hope, and calling that "verified" is how a study lies to the person reading it.
        proven: res.expected.provable
          ? (after && after !== res.new_.window ? "PROVEN" : "ACCEPTED")
          : "n/a",
      };
    }
  } catch (err) {
    res.ok = false;
    res.error = String((err as Error)?.message ?? err).slice(0, 400);
  }
  res.ms = Date.now() - t0;
  appendFileSync(RESULTS, JSON.stringify(res) + "\n");
  return res;
}

// ---------------------------------------------------------------- cleanup
async function cleanup() {
  const onsinch = new OnsinchClient(httpTransport({ baseUrl: BASE, apiKey: KEY }));
  const ids = [...new Set(led.orders)];
  if (!ids.length) { console.log("ledger clean — nothing to delete"); return; }
  console.log(`cleanup: ${ids.length} order(s)`);
  let gone = 0, stuck: number[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = ids.slice(i, i + 20);
    await Promise.all(batch.map(async (id) => {
      try {
        const still = await onsinch.orderById(id);
        if (!still) { gone++; return; }
        await onsinch.deleteOrders([id]);
        const after = await onsinch.orderById(id);
        if (after) stuck.push(id); else gone++;
      } catch { stuck.push(id); }
    }));
    process.stdout.write(`\r  ${Math.min(i + 20, ids.length)}/${ids.length}`);
  }
  console.log(`\n  gone ${gone}, still present ${stuck.length}${stuck.length ? " -> " + stuck.join(",") : ""}`);
  led.orders = stuck; saveLedger();
}

// ---------------------------------------------------------------- run
(async () => {
  __resetListCache();
  console.log(`tenant ${BASE}`);
  if (mode === "cleanup") { await cleanup(); return; }

  // The one assertion that keeps this off a real client.
  const check = new OnsinchClient(httpTransport({ baseUrl: BASE, apiKey: KEY }));
  const companies = (await check.allCompanies()) as Array<{ id: number; name?: string }>;
  const test = companies.find((x) => String(x.name || "").trim() === COMPANY_NAME);
  if (!test || Number(test.id) !== COMPANY_ID) {
    throw new Error(`refusing to run: "${COMPANY_NAME}" is not company ${COMPANY_ID} on this tenant`);
  }
  console.log(`company ${COMPANY_ID} "${COMPANY_NAME}" confirmed`);

  const cases = buildCases(N);
  console.log(`${cases.length} cases, ${cases.filter((c) => c.amend).length} amended, concurrency ${CONCURRENCY}`);
  writeFileSync(RESULTS, "");

  const started = Date.now();
  let done = 0, failed = 0;
  for (let i = 0; i < cases.length; i += CONCURRENCY) {
    const batch = cases.slice(i, i + CONCURRENCY);
    const out = await Promise.all(batch.map((c) => runCase(c).catch((e) => {
      failed++;
      return { id: c.id, error: String(e), ok: false } as CaseResult;
    })));
    done += out.length;
    failed += out.filter((r) => !r.ok).length;
    const rate = (Date.now() - started) / done;
    process.stdout.write(`\r  ${done}/${cases.length}  failed ${failed}  ~${Math.round((cases.length - done) * rate / 1000)}s left   `);
  }
  console.log(`\ndone in ${Math.round((Date.now() - started) / 1000)}s -> ${RESULTS}`);

  if (mode === "full") await cleanup();
  else console.log(`--keep: ${led.orders.length} order(s) left. Run --cleanup to remove.`);
})();
