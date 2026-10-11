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
import { extractWithMeta, type Extraction } from "./interpret/extract";
import { ground, type Interpretation } from "./interpret/interpret";
import { latestText } from "./interpret/ground";
import { plan, type Decision, type World } from "./interpret/plan";
import { runOp, type RunResult } from "./bot/run";
import type { Op } from "./bot/ops";
import { noTrace, type Tracer } from "./trace";
import { v2Writes } from "../paused";
import { linkedOrderId } from "./threadOrder";

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

const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);
const NESTED = "Job__SlotTeam__Slot__SlotLocation";

/** OnSinch, read-only, as the planner needs it. Orders are read from a recent id floor: a booking is changed long before 2,000 newer orders exist. */
export function onsinchWorld(): World {
  const t = httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
  const client = new OnsinchClient(t);
  let floor: number | null = null;
  const recentFloor = async () => {
    if (floor !== null) return floor;
    const first = await t("GET", "/orders?limit=1&page=1");
    const pages = Number(first?.data?.pagination?.pageCount);
    const last = rowsOf(await t("GET", `/orders?limit=1&page=${pages}`))[0];
    floor = Math.max(0, Number(last?.id ?? 0) - 2000);
    return floor;
  };
  return {
    companies: () => client.allCompanies(),
    placesNamed: async (name) => (await client.allPlaces()).filter((p: any) => normName(p.name) === normName(name)).map((p: any) => ({ id: Number(p.id), name: String(p.name) })),
    companyOrders: async (companyId) => {
      const out: any[] = [];
      for (let page = 1; page <= 10; page++) {
        const r = await t("GET", `/orders?company_id[eq]=${companyId}&id[gte]=${await recentFloor()}&with=${NESTED}&limit=100&page=${page}`);
        const rows = rowsOf(r);
        out.push(...rows);
        if (rows.length < 100) break;
      }
      return out;
    },
    orderByNumber: async (n) => rowsOf(await t("GET", `/orders?number[eq]=${encodeURIComponent(n)}&with=${NESTED}`))[0] ?? null,
  };
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
      VALUES (${r.message_id}, ${r.thread_id}, ${addr(r.from_address)}, ${r.date_iso}, 'none', ${JSON.stringify(decision)}::jsonb, ${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"})
      ON CONFLICT (message_id) DO NOTHING`;
    out.push({ message_id: r.message_id, decision });
  }
  const newest = client[client.length - 1];
  const world = client.length > 1 ? onsinchWorld() : null;
  for (const r of client.slice(0, -1)) {
    const decision: Decision = { kind: "handoff", reasons: [`sent with a later email (${newest.message_id}); the system read only the later one`] };
    const c = await clientOf(addr(r.from_address), world!);
    await sql`
      INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, code_version, company_id, company)
      VALUES (${r.message_id}, ${r.thread_id}, ${addr(r.from_address)}, ${r.date_iso}, 'handoff', ${JSON.stringify(decision)}::jsonb, ${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}, ${c.id}, ${c.name})
      ON CONFLICT (message_id) DO NOTHING`;
    out.push({ message_id: r.message_id, decision });
  }
  if (newest) {
    const seen = (await sql`SELECT kind FROM v2_decisions WHERE message_id = ${newest.message_id}`) as any[];
    out.push(seen.length ? { message_id: newest.message_id, skipped: `already decided (${seen[0].kind})` } : await processMessage(newest.message_id, { execute: v2Writes() }));
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
    const r = await runOp(source, op, { testOnly: !v2Writes() });
    if (r.status !== "busy" || waited >= 120) return r;
    await new Promise((done) => setTimeout(done, 10_000));
  }
}

export type MessageIn = { message_id: string; thread_id: string; from_address: string; date_iso: string; subject: string | null; body: string | null; is_from_spartan: boolean };
export type Client = { id: number | null; name: string | null };
export type Recorded = { kind: Decision["kind"]; interpretation: { extraction: Extraction; grounded: Interpretation } | null; decision: Decision; executed: RunResult[] | null; client: Client };

/**
 * Everything one message's handling needs from outside, so the office and the harness run
 * the SAME decision code: production passes the database, OnSinch and the bot; the harness
 * passes recordings, a fake OnSinch and a recording runner. There is no test branch here.
 */
export type DecideDeps = {
  extract: typeof extractWithMeta;
  world: World;
  /** The order the thread itself is bound to, if any. */
  threadOrderId: () => Promise<number | null>;
  /** Null: decide and record only (shadow). */
  run: ((source: string, op: Op) => Promise<RunResult>) | null;
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
  const client = await clientOf(from, deps.world);
  const newest = latestText(String(m.body ?? ""));
  const { x, meta } = await deps.extract(m.date_iso, from, String(m.subject ?? ""), newest);
  deps.trace("extract", { ...meta, intent: x.intent, requests: x.requests?.length ?? 0 }, meta.ms);
  const t1 = Date.now();
  const interpretation = ground(x, `${m.subject ?? ""}\n${newest}`, m.date_iso);
  deps.trace("ground", { problems: interpretation.problems.length + interpretation.requests.reduce((a, q) => a + q.problems.length, 0), notes: interpretation.notes ?? [] }, Date.now() - t1);
  const t2 = Date.now();
  const decision = await plan({ message_id: m.message_id, from, subject: String(m.subject ?? ""), sentIso: m.date_iso, text: newest }, interpretation, deps.world, await deps.threadOrderId());
  deps.trace("plan", { kind: decision.kind, ops: decision.kind === "write" ? decision.ops.map((o) => o.op.kind) : [], said: decision.kind === "write" ? decision.why : decision.kind === "handoff" ? decision.reasons : [decision.reason] }, Date.now() - t2);
  const out: Recorded = { kind: decision.kind, interpretation: { extraction: x, grounded: interpretation }, decision, executed: null, client };
  await deps.record(out);
  if (!deps.run || decision.kind !== "write") { deps.trace("final", { kind: out.kind }); return out; }
  const executed: RunResult[] = [];
  for (const { source, op } of decision.ops) {
    const t3 = Date.now();
    const r = await deps.run(source, op);
    deps.trace("run", { op: op.kind, status: r.status, reasons: r.reasons }, Date.now() - t3);
    executed.push(r);
    if (r.status !== "verified") break;
  }
  out.executed = executed;
  await deps.record(out);
  deps.trace("final", { kind: out.kind, executed: executed.map((e) => e.status) });
  return out;
}

export async function processMessage(message_id: string, opts: { execute: boolean; world?: World } = { execute: false }): Promise<Processed> {
  const sql = await db();
  const rows = (await sql`SELECT message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan FROM thread_messages WHERE message_id = ${message_id}`) as any[];
  const m = rows[0] as MessageIn | undefined;
  if (!m) return { message_id, skipped: "message not captured" };
  const from = addr(m.from_address);
  const r = await decideMessage(m, {
    extract: extractWithMeta,
    world: opts.world ?? onsinchWorld(),
    // Every recorded link, not only the paused engine's binding (threadOrder.ts says why).
    threadOrderId: () => linkedOrderId(sql, m.thread_id),
    run: opts.execute ? runWhenFree : null,
    record: async (d) => {
      await sql`
        INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, interpretation, decision, executed, code_version, company_id, company)
        VALUES (${message_id}, ${m.thread_id}, ${from}, ${m.date_iso}, ${d.kind}, ${JSON.stringify(d.interpretation)}::jsonb, ${JSON.stringify(d.decision)}::jsonb, ${JSON.stringify(d.executed)}::jsonb, ${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"}, ${d.client.id}, ${d.client.name})
        ON CONFLICT (message_id) DO UPDATE SET kind = EXCLUDED.kind, interpretation = EXCLUDED.interpretation, decision = EXCLUDED.decision,
          executed = coalesce(EXCLUDED.executed, v2_decisions.executed), code_version = EXCLUDED.code_version,
          company_id = EXCLUDED.company_id, company = EXCLUDED.company`;
    },
    trace: noTrace,
  });
  if (!r.interpretation) return { message_id, skipped: "not a client's email", decision: r.decision };
  return { message_id, interpretation: r.interpretation.grounded, decision: r.decision, ...(r.executed ? { executed: r.executed } : {}) };
}
