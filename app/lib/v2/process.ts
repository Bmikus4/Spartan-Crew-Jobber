// ============================================================================
// One captured client email, end to end: read -> ground -> plan -> record -> (maybe) write.
// ----------------------------------------------------------------------------
// Every email ends in a recorded decision (v2_decisions): written, handed to ops with the
// reasons, or no action with the reason. A silent drop has no row shape. Writes run only
// when the caller asks and only through runOp, which is TEST-only until cutover.
//
// The frozen engine's tables are read, never written: thread_messages for the email,
// conversation_state for the thread's order (the thread itself naming its booking).
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { httpTransport, OnsinchClient } from "../engine/onsinch";
import { normName } from "../engine/resolve";
import { extract } from "./interpret/extract";
import { ground, type Interpretation } from "./interpret/interpret";
import { latestText } from "./interpret/ground";
import { plan, type Decision, type World } from "./interpret/plan";
import { runOp, type RunResult } from "./bot/run";

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

/**
 * Intake's entry, in shadow: each message is decided once. n8n posts the whole thread on
 * every new message, and a re-post must not buy a second model call or a second decision.
 */
export async function decideOnce(message_id: string): Promise<Processed> {
  const sql = await db();
  const seen = (await sql`SELECT kind FROM v2_decisions WHERE message_id = ${message_id}`) as any[];
  if (seen.length) return { message_id, skipped: `already decided (${seen[0].kind})` };
  return processMessage(message_id, { execute: false });
}

export async function processMessage(message_id: string, opts: { execute: boolean; world?: World } = { execute: false }): Promise<Processed> {
  const sql = await db();
  const rows = (await sql`SELECT message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan FROM thread_messages WHERE message_id = ${message_id}`) as any[];
  const m = rows[0];
  if (!m) return { message_id, skipped: "message not captured" };
  const from = String(m.from_address ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  const record = async (kind: string, interpretation: unknown, decision: unknown, executed: unknown = null) => {
    await sql`
      INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, interpretation, decision, executed, code_version)
      VALUES (${message_id}, ${m.thread_id}, ${from}, ${m.date_iso}, ${kind}, ${JSON.stringify(interpretation)}::jsonb, ${JSON.stringify(decision)}::jsonb, ${JSON.stringify(executed)}::jsonb, ${process.env.VERCEL_GIT_COMMIT_SHA ?? "local"})
      ON CONFLICT (message_id) DO UPDATE SET kind = EXCLUDED.kind, interpretation = EXCLUDED.interpretation, decision = EXCLUDED.decision,
        executed = coalesce(EXCLUDED.executed, v2_decisions.executed), code_version = EXCLUDED.code_version`;
  };
  if (m.is_from_spartan || NOT_CLIENT.test(from)) {
    const decision: Decision = { kind: "none", reason: "not a client's email" };
    await record("none", null, decision);
    return { message_id, skipped: decision.reason, decision };
  }
  const newest = latestText(String(m.body ?? ""));
  const x = await extract(m.date_iso, from, String(m.subject ?? ""), newest);
  const interpretation = ground(x, `${m.subject ?? ""}\n${newest}`, m.date_iso);
  const bound = (await sql`SELECT onsinch_order_id FROM conversation_state WHERE thread_id = ${m.thread_id}`) as any[];
  const threadOrderId = bound[0]?.onsinch_order_id ? Number(bound[0].onsinch_order_id) : null;
  const decision = await plan({ message_id, from, subject: String(m.subject ?? ""), sentIso: m.date_iso, text: newest }, interpretation, opts.world ?? onsinchWorld(), threadOrderId);
  await record(decision.kind, { extraction: x, grounded: interpretation }, decision);
  if (!opts.execute || decision.kind !== "write") return { message_id, interpretation, decision };
  const executed: RunResult[] = [];
  for (const { source, op } of decision.ops) {
    const r = await runOp(source, op, { testOnly: true });
    executed.push(r);
    if (r.status !== "verified") break;
  }
  await record(decision.kind, { extraction: x, grounded: interpretation }, decision, executed);
  return { message_id, interpretation, decision, executed };
}
