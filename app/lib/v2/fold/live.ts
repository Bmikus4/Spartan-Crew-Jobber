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
import { compare, tally } from "./compare";
import { utcToLondon } from "../bot/ops";

type Sql = NeonQueryFunction<false, false>;

/** Canonical JSON: jsonb reorders keys and stringify drops undefined, so byte compares need this. */
export const stable = (x: any): string => Array.isArray(x) ? `[${x.map(stable).join(",")}]`
  : x && typeof x === "object" ? `{${Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(x[k])}`).join(",")}}`
  : JSON.stringify(x);

const RANK = { mail: 0, link: 1, reading: 2, act: 3 } as const;

/** The London day of a timeline timestamp (zoneless strings are UTC); undefined when unreadable. */
const londonDayOf = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  try { return utcToLondon(v).date; } catch { return undefined; }
};

/**
 * Every fold event of the given threads, from the stored rows, sorted as the fold eats them.
 *
 * An act's days (fold-v2) come from two channels: a Slot row's beginning diff names the old and new
 * day itself; a row without one reaches a day through its model_id and the order's stored body
 * (Slot id → its day, SlotTeam id → its slots' days). The body is current state, so a recovered day
 * can change when the slot moves again — but every OnSinch edit lands as timeline rows, which mark
 * the thread moved and refold it with the same body the daily diff will read. A body that changed
 * with no timeline row shows up as refold drift, which throws: loud by design, not patched here.
 */
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
  const links = (await sql`SELECT thread_id, order_id, first_seen FROM job_links
    WHERE thread_id = ANY(${tids}::text[]) AND state IN ('linked','relinked')`) as any[];
  for (const l of links) push(l.thread_id, { t: new Date(l.first_seen ?? 0).toISOString(), kind: "link", id: `link:${l.order_id}:${l.thread_id}`, order_id: Number(l.order_id) });
  const orderIds = [...new Set(links.map((l: any) => Number(l.order_id)))];
  if (orderIds.length) {
    const acts = (await sql`SELECT id, order_id, creator, created::text t, model, model_id,
        data->'diffChanges'->'Slot'->'beginning' AS beg FROM onsinch_timeline
      WHERE order_id = ANY(${orderIds}::bigint[]) AND creator IS NOT NULL`) as any[];
    // The freshest stored body per order (the live cache first, raw where it is empty), for the
    // model_id → slot-day join of rows whose diff names no day.
    const slotDay = new Map<string, string>();
    const teamDays = new Map<string, string[]>();
    const live = (await sql`SELECT order_id, body FROM onsinch_orders
      WHERE order_id = ANY(${orderIds}::bigint[]) AND body IS NOT NULL AND deleted_at IS NULL`) as any[];
    const cached = new Set(live.map((b: any) => Number(b.order_id)));
    const raw = (await sql`SELECT DISTINCT ON (order_id) order_id, body FROM onsinch_orders_raw
      WHERE order_id = ANY(${orderIds.filter((o) => !cached.has(o))}::bigint[]) ORDER BY order_id, fetched_at DESC`) as any[];
    for (const r of [...live, ...raw]) for (const j of r.body?.Job ?? []) for (const st of j?.SlotTeam ?? []) {
      const days: string[] = [];
      for (const s of st?.Slot ?? []) {
        const d = londonDayOf(s?.beginning);
        if (!d) continue;
        if (s.id != null) slotDay.set(String(s.id), d);
        days.push(d);
      }
      if (st?.id != null && days.length) teamDays.set(String(st.id), [...new Set(days)].sort());
    }
    const daysOf = (a: any): string[] | undefined => {
      const diffed = [a.beg?.old, a.beg?.new].map(londonDayOf).filter((d): d is string => !!d);
      if (diffed.length) return [...new Set(diffed)].sort();
      if (a.model === "Slot" && a.model_id != null) { const d = slotDay.get(String(a.model_id)); if (d) return [d]; }
      if (a.model === "SlotTeam" && a.model_id != null) return teamDays.get(String(a.model_id));
      return undefined;
    };
    const actsByOrder = new Map<number, any[]>();
    for (const a of acts) { const k = Number(a.order_id); const v = actsByOrder.get(k) ?? []; v.push(a); actsByOrder.set(k, v); }
    for (const l of links) for (const a of actsByOrder.get(Number(l.order_id)) ?? []) {
      const days = daysOf(a);
      push(l.thread_id, { t: new Date(a.t).toISOString(), kind: "act", id: `act:${a.id}:${l.thread_id}`, order_id: Number(a.order_id), row_id: Number(a.id), creator: Number(a.creator), ...(days?.length ? { days } : {}) });
    }
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
/** Verdicts re-read per run beyond the refolded: the whole table comes round in about 15 minutes. */
export const COMPARE_PER_RUN = 40;

/**
 * The comparator over these threads: the freshest stored body per reachable order (the live cache
 * first, the raw pull where the cache is empty), then compare(), stored beside the state.
 */
export async function compareThreads(sql: Sql, tids: string[]): Promise<Record<string, number>> {
  if (!tids.length) return {};
  const states = (await sql`SELECT thread_id, state FROM fold_state WHERE thread_id = ANY(${tids}::text[])`) as any[];
  const links = (await sql`SELECT thread_id, order_id FROM job_links
    WHERE thread_id = ANY(${tids}::text[]) AND state IN ('linked','relinked')`) as any[];
  const ordersBy = new Map<string, number[]>();
  for (const l of links) { const a = ordersBy.get(l.thread_id) ?? []; a.push(Number(l.order_id)); ordersBy.set(l.thread_id, a); }
  const named = states.flatMap((r: any) => (r.state.asks ?? []).map((a: any) => Number(a.order_id)).filter(Boolean));
  const oids = [...new Set([...links.map((l: any) => Number(l.order_id)), ...named])];
  const bodies = new Map<number, any>();
  if (oids.length) {
    const live = (await sql`SELECT order_id, body FROM onsinch_orders
      WHERE order_id = ANY(${oids}::bigint[]) AND body IS NOT NULL AND deleted_at IS NULL`) as any[];
    for (const b of live) bodies.set(Number(b.order_id), b.body);
    const missing = oids.filter((o) => !bodies.has(o));
    if (missing.length) {
      const raw = (await sql`SELECT DISTINCT ON (order_id) order_id, body FROM onsinch_orders_raw
        WHERE order_id = ANY(${missing}::bigint[]) ORDER BY order_id, fetched_at DESC`) as any[];
      for (const b of raw) bodies.set(Number(b.order_id), b.body);
    }
  }
  const total: Record<string, number> = {};
  for (const r of states) {
    const v = compare(r.state, bodies, ordersBy.get(r.thread_id) ?? []);
    for (const [k, n] of Object.entries(tally(v))) total[k] = (total[k] ?? 0) + n;
    await sql`UPDATE fold_state SET verdicts = ${JSON.stringify(v)}::jsonb, compared_at = now() WHERE thread_id = ${r.thread_id}`;
  }
  return total;
}

/**
 * The minute step. Refolds the threads whose events moved since the cursor, every thread on a
 * version bump, and once a day refolds everything without writing and throws on any difference.
 */
export async function syncFold(sql: Sql, now = Date.now()): Promise<{ refolded: number; asks: number; verdicts?: Record<string, number>; drift?: number }> {
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

  // The comparator: the refolded threads now, plus the stalest-compared on a rolling sweep.
  const sweep = (await sql`SELECT thread_id FROM fold_state WHERE NOT (thread_id = ANY(${tids}::text[]))
    ORDER BY compared_at NULLS FIRST LIMIT ${COMPARE_PER_RUN}`) as any[];
  const verdicts = await compareThreads(sql, [...tids, ...sweep.map((r: any) => r.thread_id)]);

  const lastDiff = await meta(sql, "fold_diff_at");
  if (!lastDiff || now - Date.parse(lastDiff) >= DIFF_EVERY_MS) {
    const all = await allThreads(sql);
    const stored = new Map(((await sql`SELECT thread_id, state FROM fold_state`) as any[]).map((r: any) => [r.thread_id, stable(r.state)]));
    const events = await buildEvents(sql, all);
    let drift = 0;
    for (const tid of all) if (stored.get(tid) !== stable(foldAll(tid, events.get(tid) ?? []))) drift++;
    await setMeta(sql, "fold_diff_at", started);
    if (drift) throw new Error(`refold-and-diff: ${drift} of ${all.length} threads differ from fold_state — the fold or its feed has drifted`);
    return { refolded: tids.length, asks, verdicts, drift: 0 };
  }
  return { refolded: tids.length, asks, verdicts };
}
