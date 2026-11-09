// ============================================================================
// Every conversation's fold state, recomputed from the stored events (research: the fold, 9 Nov).
// ----------------------------------------------------------------------------
// The fold is a pure function (app/lib/v2/fold/fold.ts), so this script IS the freshness mechanism:
// fill recomputes every thread that has a reading and overwrites fold_state; diff recomputes without
// writing and counts rows that differ from what is stored — the nightly refold-and-diff check. Events
// per thread: its mail (direction and time), its readings (ask-v1), and every timeline act on its
// linked orders. No OnSinch call, no model call; counts and ids only.
//
//   npx tsx --env-file=.env.local scripts/refold.mts fill
//   npx tsx --env-file=.env.local scripts/refold.mts diff
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";
import { foldAll, FOLD_VERSION, type FoldEvent } from "../app/lib/v2/fold/fold";
import { migrate } from "../app/lib/migrations";

loadEnv();
const mode = process.argv[2];
if (mode !== "fill" && mode !== "diff") {
  console.error("usage: refold.mts fill|diff");
  process.exit(2);
}
const sql: any = neon(requireEnv("DATABASE_URL").trim());
await migrate(sql);

const threads = (await sql`SELECT DISTINCT thread_id FROM v2_decisions WHERE ask IS NOT NULL AND thread_id IS NOT NULL`) as any[];
const ids = threads.map((t: any) => t.thread_id);
const mail = (await sql`SELECT thread_id, message_id, date_iso, is_from_spartan FROM thread_messages
  WHERE thread_id = ANY(${ids}::text[]) AND date_iso IS NOT NULL`) as any[];
const readings = (await sql`SELECT thread_id, message_id, sent_at, ask FROM v2_decisions
  WHERE thread_id = ANY(${ids}::text[]) AND ask IS NOT NULL`) as any[];
const links = (await sql`SELECT thread_id, order_id FROM job_links
  WHERE thread_id = ANY(${ids}::text[]) AND state IN ('linked','relinked')`) as any[];
const orderIds = [...new Set(links.map((l: any) => Number(l.order_id)))];
const acts = (await sql`SELECT id, order_id, creator, created::text t FROM onsinch_timeline
  WHERE order_id = ANY(${orderIds}::bigint[]) AND creator IS NOT NULL`) as any[];

const byThread = new Map<string, FoldEvent[]>();
const push = (tid: string, e: FoldEvent) => { const a = byThread.get(tid) ?? []; a.push(e); byThread.set(tid, a); };
for (const m of mail) push(m.thread_id, { t: new Date(m.date_iso).toISOString(), kind: "mail", id: m.message_id, from: m.is_from_spartan ? "spartan" : "client" });
for (const r of readings) push(r.thread_id, { t: new Date(r.sent_at ?? 0).toISOString(), kind: "reading", id: `read:${r.message_id}`, ask: r.ask });
const actsByOrder = new Map<number, any[]>();
for (const a of acts) { const k = Number(a.order_id); const v = actsByOrder.get(k) ?? []; v.push(a); actsByOrder.set(k, v); }
for (const l of links) for (const a of actsByOrder.get(Number(l.order_id)) ?? [])
  push(l.thread_id, { t: new Date(a.t).toISOString(), kind: "act", id: `act:${a.id}:${l.thread_id}`, order_id: Number(a.order_id), row_id: Number(a.id), creator: Number(a.creator) });

const RANK = { mail: 0, reading: 1, act: 2 } as const;
// jsonb returns keys in its own order, so a byte compare of plain stringify always "drifts".
const stable = (x: any): string => Array.isArray(x) ? `[${x.map(stable).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(",")}}`
  : JSON.stringify(x);
let filled = 0, differ = 0, askTotal = 0;
const stored = mode === "diff"
  ? new Map(((await sql`SELECT thread_id, state FROM fold_state`) as any[]).map((r: any) => [r.thread_id, stable(r.state)]))
  : new Map();
const updates: Array<{ thread_id: string; state: string; last_event: string | null; last_t: string | null }> = [];
for (const tid of ids) {
  const events = (byThread.get(tid) ?? []).sort((a, b) => a.t.localeCompare(b.t) || RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id));
  const s = foldAll(tid, events);
  askTotal += s.asks.length;
  if (mode === "diff") { if (stored.get(tid) !== stable(s)) differ++; continue; }
  updates.push({ thread_id: tid, state: JSON.stringify(s), last_event: s.last_event, last_t: s.last_t });
}
if (mode === "diff") {
  console.log(`refolded ${ids.length} threads (${askTotal} asks): ${differ} differ from fold_state${differ ? " — REFOLD DRIFT, investigate before trusting stored state" : ""}`);
  process.exit(differ ? 1 : 0);
}
for (let i = 0; i < updates.length; i += 50) {
  const batch = updates.slice(i, i + 50);
  await sql`INSERT INTO fold_state (thread_id, state, fold_version, last_event, last_t, folded_at)
    SELECT u.thread_id, u.state::jsonb, ${FOLD_VERSION}, u.last_event, u.last_t::timestamptz, now()
    FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS u(thread_id text, state text, last_event text, last_t text)
    ON CONFLICT (thread_id) DO UPDATE SET state = EXCLUDED.state, fold_version = EXCLUDED.fold_version,
      last_event = EXCLUDED.last_event, last_t = EXCLUDED.last_t, folded_at = EXCLUDED.folded_at`;
  filled += batch.length;
}
console.log(`folded ${ids.length} threads, ${askTotal} asks; wrote ${filled} fold_state rows (${FOLD_VERSION})`);
