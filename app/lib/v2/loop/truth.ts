// ============================================================================
// The truth the measurement loop judges by: OnSinch's own record of every booking change (ADDENDUM §12.2).
// ----------------------------------------------------------------------------
// GET /timelineAudits says who changed what and when, with old and new values. Until 28 Oct production kept none
// of it, only the TV verifier's cursor (feed_meta.timeline_last_id), so nothing could be re-judged. This keeps
// every row of the eight booking actions from 29 Jul on, whole and never deleted, read forward by id from the
// minute sync, with each row's order once it can be known. OnSinch's contact lists are kept beside it, refreshed
// daily: the loop ties an email to a client by the sender's exact address on exactly one company, never by the
// resolver it is judging (§12.1, question 6). GETs only.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Transport } from "../../onsinch/onsinch";
import { readPage } from "../read";
import { ensureSchema } from "../../migrations";

type Sql = NeonQueryFunction<false, false>;

/** The first row of 29 Jul 2026, where the gold copies begin: 1,732 of 1,753 staff edits on 21-27 Oct name a part created since. */
export const TIMELINE_FROM_ID = 867675;
export const BOOKING_ACTIONS = new Set(["order_create", "order_create_by_copy", "order_created_via_api", "order_cancel", "order_confirm_provisional", "common_create", "common_change", "common_delete"]);
/** Pages of 100 a minute: the 29 Jul backfill (about 1,900 pages of every action) takes about 90 minutes, then 1 a minute. */
export const PAGES_PER_RUN = 20;
const CONTACTS_EVERY_MS = 24 * 3600e3;

const parse = (v: unknown): any => { if (typeof v !== "string") return v ?? {}; try { return JSON.parse(v); } catch { return {}; } };
/** An audit time with no zone is UTC (test/zonelessIsUtc.ts). */
const utc = (s: unknown) => { const x = String(s ?? ""); return /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(x) ? x.replace(" ", "T") + "Z" : x; };

/**
 * The entity a row is about, keyed as harness/real/writes.ts actsOf keys it: an Order row by its NUMBER, except a
 * create, which names the id (test/orderAuditByNumber.ts); a part as Model:id; a delete by the part deleted, with
 * the parent it names as a second way in.
 */
export function partOf(action: string, d: any): { part: string | null; parent: string | null } {
  const model = String(d?.model ?? ""), id = String(d?.id ?? "");
  if (action === "order_create" || action === "order_created_via_api") return { part: `Order:${id}`, parent: null };
  if (action === "order_create_by_copy" || action === "order_cancel" || action === "order_confirm_provisional") return { part: `OrderNo:${id}`, parent: null };
  if (action === "common_create") return { part: String(d?.data?.path ?? "").split("/").pop() || `${model}:${id}`, parent: null };
  const self = model === "Order" ? `OrderNo:${id}` : `${model}:${id}`;
  if (action === "common_delete" && d?.data?.model) return { part: `${d.data.model}:${d.data.id}`, parent: self };
  return { part: self, parent: null };
}

/** Each part a row proves belongs to an order: a create's path, and an order create's number. */
export function partsOf(action: string, d: any): Array<[string, number]> {
  const segs = String(d?.data?.path ?? "").split("/");
  const m = /^Order:(\d+)$/.exec(segs[0] ?? "");
  if (!m) return [];
  const order = Number(m[1]);
  const out: Array<[string, number]> = segs.map((s) => [s, order]);
  if ((action === "order_create" || action === "order_created_via_api") && d?.data?.number != null) out.push([`OrderNo:${d.data.number}`, order]);
  return out;
}

async function meta<T>(sql: Sql, key: string): Promise<T | null> {
  const r = (await sql`SELECT value FROM v2_loop_meta WHERE key = ${key}`) as Array<{ value: T }>;
  return r.length ? r[0].value : null;
}
async function setMeta(sql: Sql, key: string, value: unknown): Promise<void> {
  await sql`INSERT INTO v2_loop_meta (key, value, at) VALUES (${key}, ${JSON.stringify(value)}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
}

/**
 * New timeline rows, oldest first, from the cursor: the highest id read, kept or not, so the actions this does not
 * keep are not read again. Rows are stored before the cursor moves; a page read twice is stored once.
 */
export async function pullTimeline(sql: Sql, t: Transport, opts: { pages?: number; deadline?: number } = {}): Promise<{ read: number; kept: number; cursor: number; behind: boolean; newest: string | null }> {
  await ensureSchema(sql);
  const started = new Date().toISOString();
  let cursor = (await meta<number>(sql, "timeline_cursor")) ?? TIMELINE_FROM_ID - 1;
  let read = 0, kept = 0, behind = true, newest: string | null = null;
  for (let p = 0; p < (opts.pages ?? PAGES_PER_RUN) && behind && Date.now() < (opts.deadline ?? Infinity); p++) {
    const page = await readPage(t, `/timelineAudits?id[gt]=${cursor}&limit=100&page=1`);
    if (!page.rows.length) { behind = false; break; }
    const rows = page.rows.map((r) => ({ ...r, id: Number(r.id), d: parse(r.data) }));
    // Ids must rise: the cursor is only safe if every row past it is on a later page.
    if (rows.some((r, k) => !(r.id > cursor) || (k > 0 && r.id <= rows[k - 1].id))) throw new Error(`timeline page after ${cursor} is not in rising id order`);
    const keep = rows.filter((r) => BOOKING_ACTIONS.has(String(r.action)));
    if (keep.length) {
      const recs = keep.map((r) => ({ id: r.id, action: String(r.action), creator: Number(r.creator) || null, created: utc(r.created), model: r.d?.model ?? null, model_id: r.d?.id != null ? String(r.d.id) : null, ...partOf(String(r.action), r.d), data: r.d }));
      await sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, part, parent, data)
        SELECT id, action, creator, created, model, model_id, part, parent, data
        FROM jsonb_to_recordset(${JSON.stringify(recs)}::jsonb)
          AS x(id BIGINT, action TEXT, creator INTEGER, created TIMESTAMPTZ, model TEXT, model_id TEXT, part TEXT, parent TEXT, data JSONB)
        ON CONFLICT (id) DO NOTHING`;
      const parts = keep.flatMap((r) => partsOf(String(r.action), r.d)).map(([part, order_id]) => ({ part, order_id }));
      if (parts.length) await sql`INSERT INTO onsinch_parts (part, order_id)
        SELECT DISTINCT ON (part) part, order_id FROM jsonb_to_recordset(${JSON.stringify(parts)}::jsonb) AS x(part TEXT, order_id BIGINT)
        ON CONFLICT (part) DO NOTHING`;
      kept += keep.length;
      newest = utc(keep[keep.length - 1].created);
    }
    read += rows.length;
    cursor = rows[rows.length - 1].id;
    await setMeta(sql, "timeline_cursor", cursor);
    behind = rows.length >= 100;
  }
  await resolveOrders(sql);
  // Caught up, every row made before this run began is stored: the loop judges no window that closes later.
  if (!behind) await setMeta(sql, "timeline_complete_at", started);
  return { read, kept, cursor, behind, newest };
}

/** Rows whose order is still unknown, given what onsinch_parts now holds: by the part, else by the parent a delete names. */
export async function resolveOrders(sql: Sql): Promise<number> {
  const r = (await sql`UPDATE onsinch_timeline t SET order_id = p.order_id FROM onsinch_parts p
    WHERE t.order_id IS NULL AND (t.part = p.part OR (t.parent = p.part AND NOT EXISTS (SELECT 1 FROM onsinch_parts q WHERE q.part = t.part)))
    RETURNING t.id`) as unknown[];
  return r.length;
}

/** The parts of orders read whole (Job, SlotTeam, Slot, and each number), so their rows can be tied to them. */
export async function rememberOrders(sql: Sql, orders: any[]): Promise<void> {
  const parts: Array<{ part: string; order_id: number }> = [];
  for (const o of orders) {
    const id = Number(o?.id);
    if (!id) continue;
    parts.push({ part: `Order:${id}`, order_id: id });
    if (o.number != null) parts.push({ part: `OrderNo:${o.number}`, order_id: id });
    for (const j of [].concat(o.Job ?? []) as any[]) {
      parts.push({ part: `Job:${j.id}`, order_id: id });
      for (const tm of [].concat(j.SlotTeam ?? []) as any[]) {
        parts.push({ part: `SlotTeam:${tm.id}`, order_id: id });
        for (const s of [].concat(tm.Slot ?? []) as any[]) parts.push({ part: `Slot:${s.id}`, order_id: id });
      }
    }
  }
  if (!parts.length) return;
  await sql`INSERT INTO onsinch_parts (part, order_id) SELECT DISTINCT ON (part) part, order_id FROM jsonb_to_recordset(${JSON.stringify(parts)}::jsonb) AS x(part TEXT, order_id BIGINT) ON CONFLICT (part) DO NOTHING`;
  await resolveOrders(sql);
}

export const rememberOrder = (sql: Sql, o: any): Promise<void> => rememberOrders(sql, [o]);

/**
 * Every OnSinch contact's address and company, once a day. The new list is written before the old one goes, so a
 * reader never sees an empty list; a company list that cannot be read whole leaves yesterday's in place and fails.
 */
export async function refreshContacts(sql: Sql, t: Transport, now = Date.now()): Promise<{ refreshed: boolean; contacts: number }> {
  await ensureSchema(sql);
  const last = await meta<string>(sql, "contacts_at");
  if (last && now - Date.parse(last) < CONTACTS_EVERY_MS) return { refreshed: false, contacts: 0 };
  const rows: Array<{ email: string; company_id: number; company_name: string }> = [];
  for (let p = 1; p <= 50; p++) {
    const page = await readPage(t, `/companies?with=Client&limit=100&page=${p}`);
    for (const c of page.rows) for (const cl of [].concat(c.Client ?? []) as any[]) {
      const email = String(cl?.email ?? "").trim().toLowerCase();
      if (email && Number(c.id)) rows.push({ email, company_id: Number(c.id), company_name: String(c.name ?? "").trim() });
    }
    if (page.rows.length < 100 || p >= page.pageCount) break;
    if (p === 50) throw new Error("more than 5,000 companies: the contact list was not read whole");
  }
  if (!rows.length) throw new Error("OnSinch listed no contacts; yesterday's list is kept");
  const at = new Date(now).toISOString();
  await sql`INSERT INTO onsinch_contacts (email, company_id, company_name, refreshed_at)
    SELECT DISTINCT email, company_id, company_name, ${at}::timestamptz FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(email TEXT, company_id INTEGER, company_name TEXT)
    ON CONFLICT (email, company_id) DO UPDATE SET company_name = EXCLUDED.company_name, refreshed_at = EXCLUDED.refreshed_at`;
  await sql`DELETE FROM onsinch_contacts WHERE refreshed_at < ${at}::timestamptz`;
  await setMeta(sql, "contacts_at", at);
  return { refreshed: true, contacts: rows.length };
}

/**
 * OnSinch's places by id and name, once a day, for the exceptions' venue categories (a depot, one site; ADDENDUM
 * §12.5). Written before the old list goes, as the contacts are.
 */
export async function refreshPlaces(sql: Sql, t: Transport, now = Date.now()): Promise<{ refreshed: boolean; places: number }> {
  await ensureSchema(sql);
  const last = await meta<string>(sql, "places_at");
  if (last && now - Date.parse(last) < CONTACTS_EVERY_MS) return { refreshed: false, places: 0 };
  const rows: Array<{ id: number; name: string }> = [];
  for (let p = 1; p <= 100; p++) {
    const page = await readPage(t, `/places?limit=100&page=${p}`);
    for (const x of page.rows) if (Number(x.id)) rows.push({ id: Number(x.id), name: String(x.name ?? "").trim() });
    if (page.rows.length < 100 || p >= page.pageCount) break;
    if (p === 100) throw new Error("more than 10,000 places: the place list was not read whole");
  }
  if (!rows.length) throw new Error("OnSinch listed no places; yesterday's list is kept");
  const at = new Date(now).toISOString();
  for (let i = 0; i < rows.length; i += 1000) await sql`INSERT INTO onsinch_places (id, name, refreshed_at)
    SELECT id, name, ${at}::timestamptz FROM jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + 1000))}::jsonb) AS x(id INTEGER, name TEXT)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, refreshed_at = EXCLUDED.refreshed_at`;
  await sql`DELETE FROM onsinch_places WHERE refreshed_at < ${at}::timestamptz`;
  await setMeta(sql, "places_at", at);
  return { refreshed: true, places: rows.length };
}

/** The minute sync's step: the timeline first, then the contacts and places when a day has passed. */
export async function pullTruth(sql: Sql, t: Transport, now = Date.now()): Promise<Record<string, unknown>> {
  const timeline = await pullTimeline(sql, t, { deadline: now + 60_000 });
  const contacts = await refreshContacts(sql, t, now);
  const places = await refreshPlaces(sql, t, now);
  return { ...timeline, contacts: contacts.refreshed ? contacts.contacts : "fresh", places: places.refreshed ? places.places : "fresh" };
}
