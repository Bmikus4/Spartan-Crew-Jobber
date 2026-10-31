// The feed's production reads. SELECTs only; the feed's writes live in marksDb.ts.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { allMarks, addMark } from "./marksDb";
import { ensureSchema } from "../migrations";
import { orderFacts, type OrderFacts } from "./v2";
import { followupsEnabled } from "../followup/enabled";
import type { FeedDeps, LiveLink } from "./serve";
import { HOLD_TV_MINUTES } from "../v2/links";
import { FEED_FROM, type ReplyNeed } from "./project";
import type { V2Row } from "./v2";
import { listTickets } from "../ticketsDb";
import { getSettings } from "../settingsDb";

let _sql: NeonQueryFunction<false, false> | null = null;
function db(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) throw new Error("no database configured");
  _sql = neon(url);
  return _sql;
}

/**
 * The newest CLIENT message per thread dates a need: conversation_state.updated_at
 * moves on every hourly sweep and would make each need look minutes old. The newest
 * message of OURS says whether that client has had a reply since (drafts are never
 * stored, so an unsent draft cannot count as one). The newest message of any kind is
 * the intake's pulse.
 */
async function inbound(): Promise<{ byThread: Map<string, number>; outByThread: Map<string, number>; latest: number | null }> {
  const [rows, last] = await Promise.all([
    db()`SELECT thread_id, date_iso, first_seen_at, is_from_spartan FROM thread_messages` as unknown as Promise<{ thread_id: string; date_iso: string | null; first_seen_at: string | Date; is_from_spartan: boolean }[]>,
    db()`SELECT MAX(first_seen_at) AS last FROM thread_messages` as unknown as Promise<{ last: string | Date | null }[]>,
  ]);
  const byThread = new Map<string, number>();
  const outByThread = new Map<string, number>();
  for (const r of rows) {
    const t = Date.parse(String(r.date_iso ?? "")) || new Date(r.first_seen_at).getTime();
    const m = r.is_from_spartan ? outByThread : byThread;
    if (t > (m.get(r.thread_id) ?? 0)) m.set(r.thread_id, t);
  }
  return { byThread, outByThread, latest: last[0]?.last ? new Date(last[0].last).getTime() : null };
}

/** Only clients waiting on Spartan; "Spartan waiting for client" is nobody's reply to write. */
async function replies(): Promise<ReplyNeed[]> {
  const { followupBoard } = await import("../followup/board");
  const board = await followupBoard();
  return board.alerts
    .filter((a) => a.owed_by === "us")
    .map((a) => ({ thread_id: a.thread_id, since_iso: a.waiting_since_iso, company: a.company_name, contact: a.contact_name }));
}

/**
 * The rebuild's first build (685838f, 10-09 10:07-10:20Z) decided on each thread's OLDEST
 * email, so its rows are about mail that was dealt with weeks ago. Decisions made on a
 * workstation ("local": replays, the TEST bench) are not the intake's.
 */
export const V2_FROM = "2026-10-09T10:20:00Z";

async function v2(): Promise<V2Row[]> {
  const [t] = (await db()`SELECT to_regclass('public.v2_decisions') AS t`) as { t: string | null }[];
  if (!t?.t) return [];
  await ensureSchema(db());
  const rows = (await db()`
    SELECT d.thread_id, d.message_id, d.sent_at, d.kind, d.interpretation->'grounded' AS grounded, d.decision, d.executed,
           d.company_id, d.from_address, to_jsonb(d)->'replan' AS replan
    FROM v2_decisions d
    WHERE d.kind IN ('write', 'handoff') AND coalesce(d.code_version, '') <> 'local' AND d.created_at >= ${V2_FROM}`) as any[];
  // A thread linked to one live order shows it; a thread linked to several shows none of them
  // rather than a guess. With it, when OnSinch made that order (v2.ts: a need's kind is its job now).
  const links = await liveLinks();
  const facts = await linkedOrders(links.map((x) => x.order_id));
  const made = new Map(!links.length ? [] : ((await db()`SELECT order_id, min(created) AS made FROM onsinch_timeline
    WHERE order_id = ANY(${links.map((x) => x.order_id)}) AND action IN ('order_create', 'order_create_by_copy', 'order_created_via_api') GROUP BY order_id`) as any[])
    .map((m) => [Number(m.order_id), new Date(m.made).toISOString()]));
  const byThread = new Map(links.map((x) => [x.thread_id, { ...x, made: made.get(x.order_id) ?? null, order: facts.get(x.order_id) ?? null }]));
  const senders = await clientSenders(rows.map((r) => String(r.thread_id)));
  return rows.map((r) => ({ ...r, company_id: r.company_id == null ? null : Number(r.company_id), link: byThread.get(String(r.thread_id)) ?? null, sender: senders.get(String(r.thread_id)) ?? null }));
}

/**
 * Each thread's original sender: the first client message's address that is not Spartan's own (O15: "It should never
 * be an internal Spartan Crew email"), with the client company whose contact list holds it, when exactly one does.
 */
async function clientSenders(threads: string[]): Promise<Map<string, { address: string; client: string | null }>> {
  if (!threads.length) return new Map();
  const first = (await db()`SELECT DISTINCT ON (thread_id) thread_id, lower(trim(regexp_replace(regexp_replace(from_address, '.*<', ''), '>.*', ''))) AS address
    FROM thread_messages WHERE thread_id = ANY(${threads}) AND NOT is_from_spartan AND from_address NOT ILIKE '%spartancrew.co.uk%'
    ORDER BY thread_id, date_iso`) as Array<{ thread_id: string; address: string }>;
  const companies = new Map<string, string[]>();
  for (const c of (await db()`SELECT email, company_name FROM onsinch_contacts WHERE email = ANY(${first.map((f) => f.address)})`) as any[]) companies.set(c.email, [...new Set([...(companies.get(c.email) ?? []), String(c.company_name ?? "").trim()])]);
  return new Map(first.map((f) => { const cs = (companies.get(f.address) ?? []).filter(Boolean); return [f.thread_id, { address: f.address, client: cs.length === 1 ? cs[0] : null }]; }));
}

/** The stored OnSinch orders behind the threads' links, as the facts a card shows (v2.ts orderFacts). */
async function linkedOrders(ids: number[]): Promise<Map<number, OrderFacts>> {
  if (!ids.length) return new Map();
  const orders = (await db()`SELECT order_id, body FROM onsinch_orders WHERE order_id = ANY(${ids}) AND deleted_at IS NULL AND body IS NOT NULL`) as any[];
  const placeIds = [...new Set(orders.flatMap((o) => ([].concat(o.body?.Job ?? []) as any[]).flatMap((j) => ([].concat(j.SlotTeam ?? []) as any[]).flatMap((t) => ([].concat(t.Slot ?? []) as any[]).map((s) => Number((Array.isArray(s.SlotLocation) ? s.SlotLocation[0] : s.SlotLocation)?.place_id) || 0)))))].filter(Boolean);
  const places = new Map(((await db()`SELECT id, name FROM onsinch_places WHERE id = ANY(${placeIds})`) as any[]).map((p) => [Number(p.id), String(p.name ?? "")]));
  return new Map(orders.map((o) => [Number(o.order_id), orderFacts(o.body, (id) => places.get(id) ?? null)]));
}

/** Links the minute sweep has held past HOLD_TV_MINUTES (links.ts). */
async function held() {
  const [t] = (await db()`SELECT to_regclass('public.job_links') AS t`) as { t: string | null }[];
  if (!t?.t) return [];
  const rows = (await db()`
    SELECT l.thread_id, l.r_number, l.held_since::text AS since, l.note, l.shifts
    FROM job_links l WHERE l.state = 'held' AND l.held_since < now() - (${HOLD_TV_MINUTES} || ' minutes')::interval
      AND NOT EXISTS (SELECT 1 FROM job_links o WHERE o.thread_id = l.thread_id AND o.state IN ('linked', 'relinked'))`) as any[];
  const senders = await clientSenders(rows.map((h) => String(h.thread_id)));
  return rows.map((h) => ({ ...h, sender: senders.get(String(h.thread_id)) ?? null,
    days: (Array.isArray(h.shifts) ? h.shifts : []).map((w: string) => new Date(String(w).split("|")[0]).toLocaleDateString("en-CA", { timeZone: "Europe/London" })) }));
}

/**
 * Every thread linked to exactly one live order. An order OnSinch has deleted is no thread's order, so the card
 * shows no R or J for it rather than one OnSinch may give to another client's order (DECISIONS D6).
 */
async function liveLinks(): Promise<Array<LiveLink & { thread_id: string }>> {
  const [t] = (await db()`SELECT to_regclass('public.job_links') AS t`) as { t: string | null }[];
  if (!t?.t) return [];
  const rows = (await db()`SELECT l.thread_id, min(l.order_id) AS order_id, min(l.r_number) AS r_number, min(l.job_id) AS job_id, min(l.proof) AS proof
    FROM job_links l WHERE l.state IN ('linked', 'relinked') AND NOT EXISTS (SELECT 1 FROM onsinch_orders o WHERE o.order_id = l.order_id AND o.deleted_at IS NOT NULL)
    GROUP BY l.thread_id HAVING count(DISTINCT l.order_id) = 1`) as any[];
  return rows.map((x) => ({ thread_id: String(x.thread_id), order_id: Number(x.order_id), r_number: x.r_number == null ? null : String(x.r_number), job_id: x.job_id == null ? null : Number(x.job_id), absolute: x.proof != null }));
}

/** The same links for the jobs board's tiles, with their orders' facts (ported.ts). */
async function links(): Promise<Map<string, LiveLink>> {
  const [l] = (await db()`SELECT to_regclass('public.job_links') AS t`) as { t: string | null }[];
  if (!l?.t) return new Map();
  const all = await liveLinks();
  const facts = await linkedOrders(all.map((x) => x.order_id));
  return new Map(all.map(({ thread_id, ...x }) => [thread_id, { ...x, order: facts.get(x.order_id) ?? null }]));
}

async function historyAt(): Promise<string | null> {
  const r = (await db()`SELECT value FROM v2_loop_meta WHERE key = 'timeline_complete_at'`) as Array<{ value: string }>;
  return r[0]?.value ?? null;
}

export function liveFeedDeps(): FeedDeps {
  return {
    inbound, marks: allMarks, v2, from: FEED_FROM, held,
    // Every job the board ever held (948 tickets, 457 client jobs on 2026-10-11), not its first 300.
    jobs: () => listTickets(5000),
    replies: followupsEnabled() ? replies : null,
    historyAt,
    remember: async (ms) => { for (const m of ms) await addMark(m); },
    intakePaused: () => getSettings().then((s) => s.intake_paused === true),
    links,
  };
}
