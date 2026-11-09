// ============================================================================
// The fold, live: the minute sync keeps fold_state equal to what a full refold would write.
// ----------------------------------------------------------------------------
// Incremental on purpose: each run refolds only the threads whose events moved since the cursor —
// new mail or readings stored, a new link, or timeline rows stored on a linked order — so the
// minute's work is usually a handful of threads, and a version bump refolds everything once.
// Correctness does not rest on the increment: foldThreads recomputes a thread whole from its stored
// events (the fold is pure), and once a day the whole table is refolded and diffed; any drift throws,
// which turns the sync red, because a derived state that disagrees with its own derivation must be
// loud, not patched. The owner wired this in 9 Nov after the module scored 86%/96% against behavior.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureSchema } from "../../migrations";
import { foldAll, FOLD_VERSION, type FoldEvent } from "./fold";

type Sql = NeonQueryFunction<false, false>;

/** Canonical JSON: jsonb reorders keys and stringify drops undefined, so byte compares need this. */
export const stable = (x: any): string => Array.isArray(x) ? `[${x.map(stable).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(",")}}`
  : JSON.stringify(x);

const RANK = { mail: 0, reading: 1, act: 2 } as const;

/** Every fold event of the given threads, from the stored rows, sorted as the fold eats them. */
export async function buildEvents(sql: Sql, tids: string[]): Promise<Map<string, FoldEvent[]>> {
  const byThread = new Map<string, FoldEvent[]>();
  if (!tids.length) return byThread;
  const push = (tid: string, e: FoldEvent) => { const a = byThread.get(tid) ?? []; a.push(e); byThread.set(tid, a); };
  const mail = (await sql`SELECT thread_id, message_id, date_iso, is_from_spartan FROM thread_messages
    WHERE thread_id = ANY(${tids}::text[]) AND date_iso IS NOT NULL`) as any[];
  for (const m of mail) push(m.thread_id, { t: new Date(m.date_iso).toISOString(), kind: "mail", id: m.message_id, from: m.is_from_spartan ? "spartan" : "client" });
  const readings = (await sql`SELECT thread_id, message_id, sent_at, ask FROM v2_decisions
    WHERE thread_id = ANY(${tids}::text[]) AND ask IS NOT NULL`) as any[];
  for (const r of readings) push(r.thread_id, { t: new Date(r.sent_at ?? 0).toISOString(), kind: "reading", id: `read:${r.message_id}`, ask: r.ask });
  const links = (await sql`SELECT thread_id, order_id FROM job_links
    WHERE thread_id = ANY(${tids}::text[]) AND state IN ('linked','relinked')`) as any[];
  const orderIds = [...new Set(links.map((l: any) => Number(l.order_id)))];
  if (orderIds.length) {
    const acts = (await sql`SELECT id, order_id, creator, created::text t FROM onsinch_timeline
      WHERE order_id = ANY(${orderIds}::bigint[]) AND creator IS NOT NULL`) as any[];
    const actsByOrder = new Map<number, any[]>();
    for (const a of acts) { const k = Number(a.order_id); const v = actsByOrder.get(k) ?? []; v.push(a); actsByOrder.set(k, v); }
    for (const l of links) for (const a of actsByOrder.get(Number(l.order_id)) ?? [])
      push(l.thread_id, { t: new Date(a.t).toISOString(), kind: "act", id: `act:${a.id}:${l.thread_id}`, order_id: Number(a.order_id), row_id: Number(a.id), creator: Number(a.creator) });
  }
  for (const tid of tids) {
    const events = (byThread.get(tid) ?? []).sort((a, b) => a.t.localeCompare(b.t) || RANK[a.kind] - RANK[b.kind] || a.id.localeCompare(b.id));
    byThread.set(tid, events);
  }
  return byThread;
}

/** Refold these threads whole and upsert; returns asks folded. */
export async function foldThreads(sql: Sql, tids: string[]): Promise<number> {
  if (!tids.length) return 0;
  const events = await buildEvents(sql, tids);
  let asks = 0;
  const updates: Array<{ thread_id: string; state: string; last_event: string | null; last_t: string | null }> = [];
  for (const tid of tids) {
    const s = foldAll(tid, events.get(tid) ?? []);
    asks += s.asks.length;
    updates.push({ thread_id: tid, state: JSON.stringify(s), last_event: s.last_event, last_t: s.last_t });
  }
  for (let i = 0; i < updates.length; i += 50) {
    const batch = updates.slice(i, i + 50);
    await sql`INSERT INTO fold_state (thread_id, state, fold_version, last_event, last_t, folded_at)
      SELECT u.thread_id, u.state::jsonb, ${FOLD_VERSION}, u.last_event, u.last_t::timestamptz, now()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS u(thread_id text, state text, last_event text, last_t text)
      ON CONFLICT (thread_id) DO UPDATE SET state = EXCLUDED.state, fold_version = EXCLUDED.fold_version,
        last_event = EXCLUDED.last_event, last_t = EXCLUDED.last_t, folded_at = EXCLUDED.folded_at`;
  }
  return asks;
}

/** Every thread a full refold would cover: one reading with an ask names it. */
async function allThreads(sql: Sql): Promise<string[]> {
  return ((await sql`SELECT DISTINCT thread_id FROM v2_decisions WHERE ask IS NOT NULL AND thread_id IS NOT NULL`) as any[]).map((r) => r.thread_id);
}

const meta = async (sql: Sql, key: string): Promise<string | null> => {
  const r = (await sql`SELECT value FROM v2_loop_meta WHERE key = ${key}`) as any[];
  return r.length ? (r[0].value as string) : null;
};
const setMeta = (sql: Sql, key: string, value: string) => sql`INSERT INTO v2_loop_meta (key, value, at)
  VALUES (${key}, ${JSON.stringify(value)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;

export const DIFF_EVERY_MS = 24 * 3600e3;

/**
 * The minute step. Refolds the threads whose events moved since the cursor, every thread on a
 * version bump, and once a day refolds everything without writing and throws on any difference.
 */
export async function syncFold(sql: Sql, now = Date.now()): Promise<{ refolded: number; asks: number; drift?: number }> {
  await ensureSchema(sql);
  const cursor = (await meta(sql, "fold_sync_at")) ?? "1970-01-01T00:00:00Z";
  const started = new Date(now).toISOString();
  const moved = (await sql`
    SELECT DISTINCT t FROM (
      SELECT thread_id t FROM thread_messages WHERE first_seen_at > ${cursor}::timestamptz
      UNION SELECT thread_id FROM v2_decisions WHERE created_at > ${cursor}::timestamptz AND ask IS NOT NULL
      UNION SELECT thread_id FROM job_links WHERE first_seen > ${cursor}::timestamptz
      UNION SELECT l.thread_id FROM job_links l JOIN onsinch_timeline h ON h.order_id = l.order_id
        WHERE l.state IN ('linked','relinked') AND h.stored_at > ${cursor}::timestamptz
      UNION SELECT thread_id FROM fold_state WHERE fold_version <> ${FOLD_VERSION}
    ) x WHERE t IS NOT NULL
      AND EXISTS (SELECT 1 FROM v2_decisions d WHERE d.thread_id = x.t AND d.ask IS NOT NULL)`) as any[];
  const tids = moved.map((r) => r.t);
  const asks = await foldThreads(sql, tids);
  await setMeta(sql, "fold_sync_at", started);

  const lastDiff = await meta(sql, "fold_diff_at");
  if (!lastDiff || now - Date.parse(lastDiff) >= DIFF_EVERY_MS) {
    const all = await allThreads(sql);
    const stored = new Map(((await sql`SELECT thread_id, state FROM fold_state`) as any[]).map((r: any) => [r.thread_id, stable(r.state)]));
    const events = await buildEvents(sql, all);
    let drift = 0;
    for (const tid of all) if (stored.get(tid) !== stable(foldAll(tid, events.get(tid) ?? []))) drift++;
    await setMeta(sql, "fold_diff_at", started);
    if (drift) throw new Error(`refold-and-diff: ${drift} of ${all.length} threads differ from fold_state — the fold or its feed has drifted`);
    return { refolded: tids.length, asks, drift: 0 };
  }
  return { refolded: tids.length, asks };
}
