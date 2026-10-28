// ============================================================================
// A WRITE THAT STOPPED IS FINISHED OR CLOSED, NEVER LEFT AS IT STOPPED (addendum Prompt 6; F26, F38, F39).
// ----------------------------------------------------------------------------
// A decision's operations stop short three ways:
//   stopped   the last one stopped before anything left the browser ("busy", or "blocked" by a
//             passing fault): nothing was sent, so it may run again;
//   between   the run died between two operations: every result verified, fewer results than
//             operations, no ledger row for the next one, and nothing has moved for RESUME_AFTER_MS.
//             Until 10-27 nothing looked at it again: the rest of the email was simply not done;
//   during    the run died inside one: the next operation has a ledger row and no result. It may have
//             landed, so it is never sent again (bot/db.ts); it is recorded as unknown, a person's.
//             Inside the FIRST one there is no result at all (F49), and that looks like a shadow
//             decision, which writes never ran for: only the first operation's ledger row tells them
//             apart. With no ledger row it is left as it is, or switching writes on would run every
//             shadow plan of the last 6 hours.
// Before anything runs again the email is planned again from its stored reading, against OnSinch as it
// is now, with staff's edits since and today's settings (the same decideMessage as intake, writing
// nothing). The rest runs only when that plan asks for exactly the operations still to do; otherwise the
// decision is closed with one "cancelled" result saying why. A decision of an older build is treated the
// same way: until 10-27 a deploy within 6 hours ended its retry with no record (F38).
// A result that leaves the write short goes to the owner (F39, reasons.ts systemFailureOf).
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { decideMessage, onsinchWorld, threadReads, botWrites, type Recorded, type MessageIn } from "./process";
import { runOp, type RunResult } from "./bot/run";
import { opKey, legacyOpKey, utcToLondon, type Op } from "./bot/ops";
import { ledgerGet } from "./bot/db";
import type { Decision, World } from "./interpret/plan";
import { linkedOrderId } from "./threadOrder";
import { recordLink } from "./links";
import { noTrace } from "./trace";
import { getSettings } from "../settingsDb";
import { automationPausedFlag } from "../paused";
import { reportError } from "../errorReport";
import { systemFailureOf } from "./reasons";

type Sql = NeonQueryFunction<false, false>;
type Planned = { source: string; op: Op };

/** How long a run must have been still before it is taken for dead: a function lives 300 s at most. */
export const RESUME_AFTER_MS = 10 * 60_000;
/** A stopped write is tried again at most this many times. */
export const RESUME_TRIES = 2;
/** Only decisions this young are looked at: an older stop is a person's already. */
const WINDOW = "6 hours";
const TRANSIENT = /bot error before submit|another operation holds the bot|audit log unreadable|Timeout|page raised|order read 5\d\d|net::|ECONNRESET|fetch failed/i;

export type ResumeDeps = {
  /** The email planned again now, writing nothing; null when it cannot be. */
  planAgain: (message_id: string) => Promise<Decision | null>;
  run: (source: string, op: Op) => Promise<RunResult>;
  /** The ledger row an operation left, with when it last moved. */
  ledger: (source: string, op: Op) => Promise<{ status: string; at: number } | null>;
  writes: () => Promise<boolean>;
  now: () => number;
};

const sameOps = (a: Planned[], b: Planned[]) => {
  const k = (x: Planned) => opKey("", x.op);
  const left = a.map(k).sort(), right = b.map(k).sort();
  return left.length === right.length && left.every((x, i) => x === right[i]);
};

export async function resumeStopped(sql: Sql, deps: Partial<ResumeDeps> = {}): Promise<{ resumed: number; closed: number; results: string[]; paused?: true }> {
  if (automationPausedFlag()) return { resumed: 0, closed: 0, results: [], paused: true };
  const d0 = { ...productionDeps(sql), ...deps };
  if (!(await d0.writes())) return { resumed: 0, closed: 0, results: [] };
  const rows = (await sql`SELECT message_id, thread_id, decision, executed FROM v2_decisions
    WHERE kind = 'write' AND coalesce(jsonb_typeof(executed), 'null') IN ('array', 'null') AND created_at > now() - ${WINDOW}::interval ORDER BY created_at`) as any[];
  const today = utcToLondon(new Date(d0.now()).toISOString()).date;
  const out = { resumed: 0, closed: 0, results: [] as string[] };
  for (const row of rows) {
    const ops = (row.decision?.ops ?? []) as Planned[];
    const ex = (row.executed ?? []) as RunResult[];
    const last = ex[ex.length - 1];
    const tries = Number(row.decision?.retries ?? 0);
    let done: RunResult[], todo: Planned[];
    if (last && (last.status === "busy" || (last.status === "blocked" && TRANSIENT.test(last.reasons.join(" "))))) {
      if (tries >= RESUME_TRIES) continue;
      done = ex.slice(0, -1); todo = ops.slice(done.length);
    } else if (ex.length && ex.length < ops.length && ex.every((r) => r.status === "verified" || r.status === "seen")) {
      const next = ops[ex.length];
      const moved = await Promise.all([...ops.slice(0, ex.length), next].map((p) => d0.ledger(p.source, p.op)));
      const at = Math.max(0, ...moved.filter((m): m is { status: string; at: number } => !!m).map((m) => m.at));
      if (d0.now() - at < RESUME_AFTER_MS) continue; // still running, or not yet known to be dead
      const inside = moved[moved.length - 1];
      if (inside) {
        // during: it may have landed. Never sent again: recorded, closed, the owner told.
        const r: RunResult = { op_key: opKey(next.source, next.op), status: "unknown", reasons: [`the run stopped inside this operation (ledger: ${inside.status}); OnSinch may hold it: a person checks`] };
        await close(sql, row, [...ex, r], tries);
        out.closed++; out.results.push(`${row.message_id}: unknown`);
        continue;
      }
      done = ex; todo = ops.slice(ex.length);
    } else if (!ex.length && ops.length) {
      const first = await d0.ledger(ops[0].source, ops[0].op);
      if (!first || d0.now() - first.at < RESUME_AFTER_MS) continue; // a shadow plan, or still running
      const r: RunResult = { op_key: opKey(ops[0].source, ops[0].op), status: "unknown", reasons: [`the run stopped inside its first operation (ledger: ${first.status}); OnSinch may hold it: a person checks`] };
      await close(sql, row, [r], tries);
      out.closed++; out.results.push(`${row.message_id}: unknown (first operation)`);
      continue;
    } else continue;
    // Never a day already gone.
    if (todo.some(({ op }) => [(op as any).date, ...(((op as any).shifts ?? []) as any[]).map((s) => s.date)].some((x) => typeof x === "string" && x < today))) {
      await close(sql, row, [...done, { op_key: "", status: "cancelled", reasons: ["a day it writes is already over: a person adjusts it"] }], tries);
      out.closed++; out.results.push(`${row.message_id}: cancelled (day over)`);
      continue;
    }
    const again = await d0.planAgain(row.message_id).catch(() => null);
    const asks = again?.kind === "write" ? again.ops : [];
    if (!again || !sameOps(asks, todo)) {
      const said = !again ? "it could not be planned again" : again.kind === "write" ? `planned again it asks for other changes (${again.why[0] ?? again.ops.length + " operations"})`
        : again.kind === "none" ? `planned again: ${again.reason}` : `planned again: ${again.reasons[0] ?? "a person's"}`;
      await close(sql, row, [...done, { op_key: "", status: "cancelled", reasons: [`stopped part-way, not resumed: ${said}`] }], tries);
      out.closed++; out.results.push(`${row.message_id}: cancelled`);
      continue;
    }
    const ran: RunResult[] = [...done];
    for (const { source, op } of todo) {
      // A key of its own: a stopped operation's first key is in the ledger as blocked, and runs once.
      const r = await d0.run(`${source}:retry${tries + 1}`, op);
      ran.push(r);
      if (r.status !== "verified") break;
      const made = Number((r.detail as any)?.order_id) || ("order_id" in op ? Number((op as any).order_id) : 0);
      if (made) await recordLink(sql, { thread_id: row.thread_id, order_id: made, source: "bot write (resumed)" }).catch(() => {});
    }
    await close(sql, row, ran, tries + 1);
    out.resumed++; out.results.push(`${row.message_id}: ${ran.map((r) => r.status).join(",")}`);
  }
  return out;
}

async function close(sql: Sql, row: any, executed: RunResult[], tries: number): Promise<void> {
  await sql`UPDATE v2_decisions SET executed = ${JSON.stringify(executed)}::jsonb, decision = jsonb_set(decision, '{retries}', ${String(tries)}::jsonb) WHERE message_id = ${row.message_id}`;
  const failed = systemFailureOf(row.decision, executed);
  if (failed) void reportError({ route: "system-failed", where: "v2/resume", what: failed, detail: `message ${row.message_id}, thread ${row.thread_id}: ${executed[executed.length - 1]?.reasons?.[0] ?? ""}`.slice(0, 300) });
}

function productionDeps(sql: Sql): ResumeDeps {
  let world: World | null = null;
  return {
    writes: () => botWrites(),
    now: () => Date.now(),
    run: (source, op) => runOp(source, op, { testOnly: false }),
    ledger: async (source, op) => {
      const k = opKey(source, op), old = legacyOpKey(source, op);
      const rows = (await sql`SELECT status, updated_at FROM bot_ledger WHERE op_key IN (${k}, ${old})`) as any[];
      return rows.length ? { status: String(rows[0].status), at: Date.parse(String(rows[0].updated_at)) } : null;
    },
    planAgain: async (message_id) => {
      const [d] = (await sql`SELECT interpretation FROM v2_decisions WHERE message_id = ${message_id}`) as any[];
      const [m0] = (await sql`SELECT message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan FROM thread_messages WHERE message_id = ${message_id}`) as MessageIn[];
      if (!d?.interpretation?.extraction || !m0) return null;
      world ??= onsinchWorld();
      const w = world;
      const leadDays = await getSettings().then((s) => (s.create_lead_enabled === false ? null : s.create_lead_days)).catch(() => undefined);
      let got: Recorded | null = null;
      await decideMessage(m0, {
        ...threadReads(sql, m0),
        extract: (async () => ({ x: d.interpretation.extraction, meta: d.interpretation.meta ?? { model: "stored", prompt_id: "stored", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
        world: w,
        threadOrderId: () => linkedOrderId(sql, m0.thread_id, async (id) => (w.orderById ? !!(await w.orderById(id)) : true)),
        run: null,
        leadDays: async () => leadDays,
        now: () => Date.now(),
        again: true,
        link: async () => {},
        record: async (r) => { got = r; },
        trace: noTrace,
      });
      return (got as Recorded | null)?.decision ?? null;
    },
  };
}
