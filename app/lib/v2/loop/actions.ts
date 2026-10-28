// ============================================================================
// Staff's own work, each action once: did the TV show it first, how a moved start was moved, and whether a new
// order breaks one order per venue (ADDENDUM §12.2, §12.5, P2.5).
// ----------------------------------------------------------------------------
// An action is one person's consecutive booking changes to one order, at most 30 minutes apart (the Part 1 audit's
// unit). The minute sync's "actions" step records each once 30 minutes have passed since its last change inside
// the stored timeline, then classifies the oldest unclassified, reading its order from OnSinch when no read since
// its last change is stored:
//   - coverage: a card in the 7 days before, for the order's client, naming a day it touched; a card for the client
//     on other days; a client email with no card; an email from the client's domain whose sender is no contact
//     (can't tell); or no client email. An email's client is its sender's contact company, never the resolver;
//   - a moved start: whether staff kept the length or the end (the count DECISIONS O7 asked for);
//   - a new order holding two or more venues, or at a venue where the client has another order within 14 days of
//     its days: flagged and put in the categories §12.5 names, all read from OnSinch, never from a model.
// GETs only. A read that fails throws and leaves the action unclassified for the next minute.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Transport } from "../../onsinch/onsinch";
import { CONSUMER_DOMAINS, domainOfEmail } from "../../onsinch/resolve";
import { isTestCompanyName } from "../../testData";
import { utcToLondon } from "../bot/ops";
import { readRows } from "../read";
import { ensureSchema } from "../../migrations";
import { actsOf, type Row } from "./judge";
import { LOOP_FROM } from "./outcomes";
import type { Act } from "../score";

type Sql = NeonQueryFunction<false, false>;
const MIN = 60e3, HOUR = 3600e3, DAY = 864e5;
const GAP = 30 * MIN;
/** Orders read a minute for classifying; the backfill from 9 Oct (about 2,000 actions on about 900 orders) takes about 25 minutes. */
const READS_PER_RUN = 40;
const PER_RUN = 120;
const NESTED = "Job__SlotTeam__Slot__SlotLocation";
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const dayOf = (iso: unknown) => utcToLondon(String(iso)).date;
const addr = (from: unknown) => String(from ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
const slotsOf = (o: any): any[] => ([].concat(o?.Job ?? []) as any[]).flatMap((j) => [].concat(j.SlotTeam ?? []) as any[]).flatMap((t) => ([].concat(t.Slot ?? []) as any[]).map((s) => ({ ...s, team: Number(t.id) })));
const live = (o: any) => slotsOf(o).filter((s) => s.beginning && s.cancelled !== true);
const dnum = (d: string) => Math.round(Date.parse(`${d}T12:00:00Z`) / DAY);
const DEPOT = /\b(depot|warehouse|yard|storage|store|stores|unit)\b/i;
const STOP = new Set(["the", "and", "hall", "house", "centre", "center", "park", "london", "hotel", "room", "venue", "street", "road", "place"]);
const words = (n: string) => String(n ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));

export type Group = { order_id: number; by: number; first_id: number; first_at: number; last_at: number; acts: Act[]; ids: number[] };

/** One person's changes to one order, split where 30 minutes pass with none; each keyed by its first row's id. */
export function groupActs(acts: Array<Act & { row_id: number }>): Group[] {
  const out: Group[] = [];
  const open = new Map<string, Group>();
  for (const a of [...acts].sort((x, y) => T(x.at) - T(y.at) || x.row_id - y.row_id)) {
    const k = `${a.order_id}|${a.by}`, at = T(a.at), g = open.get(k);
    if (g && at - g.last_at <= GAP) { g.acts.push(a); g.ids.push(a.row_id); g.last_at = at; continue; }
    const n: Group = { order_id: a.order_id, by: a.by, first_id: a.row_id, first_at: at, last_at: at, acts: [a], ids: [a.row_id] };
    open.set(k, n); out.push(n);
  }
  return out;
}

/** The London days an action touched on its order; a PO or a whole-order cancel touches none. */
export function actionDays(g: Pick<Group, "acts">, o: any): string[] {
  const slots = slotsOf(o).filter((s) => s.beginning);
  const ds = new Set<string>();
  for (const a of g.acts) {
    if (a.what === "create order") live(o).forEach((s) => ds.add(dayOf(s.beginning)));
    else if (a.model === "SlotTeam") slots.filter((s) => s.team === a.model_id).forEach((s) => ds.add(dayOf(s.beginning)));
    else if (a.model === "Slot" && a.model_id) {
      const b = a.changes?.beginning?.new ?? slots.find((s) => Number(s.id) === a.model_id)?.beginning;
      if (b) ds.add(dayOf(String(b).replace(" ", "T") + (/[zZ+]/.test(String(b)) ? "" : "Z")));
    }
  }
  return [...ds].sort();
}

/** Each start staff moved: the end moved by as much (the length kept), not at all (the end kept), or otherwise. */
export function movedStarts(g: Pick<Group, "acts">): { length: number; end: number; other: number } | null {
  const n = { length: 0, end: 0, other: 0 };
  const utc = (v: unknown) => T(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : String(v).replace(" ", "T") + "Z");
  for (const a of g.acts) {
    const b = a.changes?.beginning;
    if (a.model !== "Slot" || !b) continue;
    const db = utc(b.new) - utc(b.old);
    if (!db) continue;
    const e = a.changes?.end;
    if (!e) n.end++;
    else if (utc(e.new) - utc(e.old) === db) n.length++;
    else n.other++;
  }
  return n.length + n.end + n.other ? n : null;
}

type Card = { message_id: string; kind: string; days: string[] };
/** The days a decision names: its operations' and its reading's. */
export function decisionDays(decision: any, requests: any[] | null): string[] {
  const ds = new Set<string>();
  for (const o of (decision?.ops ?? []) as any[]) {
    const op = o?.op ?? {};
    if (op.date) ds.add(op.date);
    for (const s of (op.shifts ?? []) as any[]) if (s?.date) ds.add(s.date);
  }
  for (const r of requests ?? []) { if (r?.date) ds.add(r.date); if (r?.target?.date) ds.add(r.target.date); }
  return [...ds].sort();
}

/**
 * Coverage of one action, from what came before it. `emails` are client emails of the 7 days before, each with the
 * companies whose contact list holds its sender and its decision.
 */
export function coverage(days: string[], company: number, contactDomains: Set<string>, emails: Array<{ message_id: string; from: string; companies: number[]; kind: string | null; days: string[] }>): { bucket: string; message_id: string | null } {
  const mine = emails.filter((e) => e.companies.includes(company));
  const cards = mine.filter((e) => e.kind === "write" || e.kind === "handoff");
  const named = cards.find((c) => c.days.some((d) => days.includes(d)));
  if (named) return { bucket: "a card named the day", message_id: named.message_id };
  // A card whose reading kept no day shows none on the TV (feed/v2.ts takes a card's days from the grounded
  // requests and the plan): told apart from a card naming other days, the reader's share of a miss is visible.
  const last = cards[cards.length - 1];
  if (cards.length && !days.length) return { bucket: "a card for the client (no day to check)", message_id: last.message_id };
  if (cards.length) return { bucket: cards.every((c) => !c.days.length) ? "a card for the client, naming no day" : "a card for the client, another day", message_id: last.message_id };
  if (mine.length) return { bucket: "a client email, no card", message_id: mine[mine.length - 1].message_id };
  const near = emails.find((e) => !e.companies.includes(company) && contactDomains.has(domainOfEmail(e.from)));
  if (near) return { bucket: "can't tell: a sender on the client's domain is no contact", message_id: near.message_id };
  return { bucket: "no client email in the 7 days before", message_id: null };
}

/** A new order against one order per venue (DECISIONS O10), in §12.5's categories. */
export function exceptionOf(o: any, clientOrders: any[], placeName: (id: number) => string): { kind: string; categories: string[]; other: string | null } | null {
  const mine = live(o);
  const venues = [...new Set(mine.map((s) => Number(s.SlotLocation?.place_id) || 0).filter(Boolean))];
  const days = [...new Set(mine.map((s) => dayOf(s.beginning)))].sort();
  if (!days.length) return null;
  if (venues.length > 1) {
    const cats: string[] = [];
    const nums = days.map(dnum);
    if (nums.slice(1).some((d, i) => d - nums[i] >= 7)) cats.push("a week or more between days");
    if (venues.some((v) => DEPOT.test(placeName(v)))) cats.push("a depot or warehouse");
    const ws = venues.map((v) => new Set(words(placeName(v))));
    if (ws.some((a, i) => ws.some((b, j) => j > i && [...a].some((w) => b.has(w))))) cats.push("the venues share a site word");
    return { kind: "multi-venue", categories: cats.length ? cats : ["none of these"], other: null };
  }
  const near = clientOrders.filter((x) => Number(x.id) !== Number(o.id) && Number(x.status) !== -1).map((x) => {
    const at = live(x).filter((s) => venues.includes(Number(s.SlotLocation?.place_id)));
    const gap = Math.min(...at.flatMap((s) => days.map((d) => Math.abs(dnum(dayOf(s.beginning)) - dnum(d)))));
    return { x, gap };
  }).filter((n) => Number.isFinite(n.gap) && n.gap <= 14).sort((a, b) => a.gap - b.gap)[0];
  if (!near) return null;
  const cats: string[] = [];
  const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  if (!same(o.intern_name, near.x.intern_name)) cats.push("PO differs");
  if (!same(o.name, near.x.name)) cats.push("order name differs");
  if (Number(o.user_id) !== Number(near.x.user_id)) cats.push("contact differs");
  if (near.gap >= 7) cats.push("a week or more between days");
  return { kind: "same-venue split", categories: cats.length ? cats : ["none of these"], other: String(near.x.number) };
}

async function meta<T>(sql: Sql, key: string): Promise<T | null> {
  const r = (await sql`SELECT value FROM v2_loop_meta WHERE key = ${key}`) as Array<{ value: T }>;
  return r.length ? r[0].value : null;
}

/**
 * The minute sync's step. New actions closed inside the stored timeline are recorded, then up to PER_RUN of the
 * oldest unclassified are classified, reading at most READS_PER_RUN orders.
 */
export async function recordActions(sql: Sql, t: Transport, opts: { deadline?: number } = {}): Promise<Record<string, unknown>> {
  await ensureSchema(sql);
  const complete = await meta<string>(sql, "timeline_complete_at");
  if (!complete) return { recorded: 0, classified: 0, waiting: "the timeline is still catching up" };
  const until = T(complete);
  const from = T((await meta<string>(sql, "actions_until")) ?? LOOP_FROM);
  let recorded = 0;
  if (until > from) {
    const rows = ((await sql`SELECT id, action, creator, created, model, model_id, order_id, data FROM onsinch_timeline
      WHERE order_id IS NOT NULL AND creator IS DISTINCT FROM 2257 AND created > ${new Date(from - 12 * HOUR).toISOString()}::timestamptz
        AND created <= ${new Date(until).toISOString()}::timestamptz ORDER BY id`) as any[])
      .map((r) => ({ ...r, id: Number(r.id), order_id: Number(r.order_id), created: new Date(r.created).toISOString() })) as Row[];
    const { acts } = actsOf(rows, () => ({ number: "", company_id: 0 }));
    const withIds = acts.filter((a) => a.what !== "confirm order");
    // Closed in this run: its last change 30 minutes or more before the timeline's complete time, and after the
    // last run's.
    const closed = groupActs(withIds).filter((g) => g.last_at + GAP > from && g.last_at + GAP <= until);
    const recs = closed.map((g) => ({ order_id: g.order_id, by: g.by, first_id: g.first_id, first_at: new Date(g.first_at).toISOString(), last_at: new Date(g.last_at).toISOString(),
      rows: g.acts.length, what: [...new Set(g.acts.map((a) => a.what))].sort(), moved_start: movedStarts(g), acts: g.acts }));
    for (let i = 0; i < recs.length; i += 200) {
      await sql`INSERT INTO v2_staff_actions (order_id, by, first_id, first_at, last_at, rows, what, moved_start, acts)
        SELECT order_id, by, first_id, first_at, last_at, rows, what, moved_start, acts
        FROM jsonb_to_recordset(${JSON.stringify(recs.slice(i, i + 200))}::jsonb)
          AS x(order_id BIGINT, by INTEGER, first_id BIGINT, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ, rows INTEGER, what JSONB, moved_start JSONB, acts JSONB)
        ON CONFLICT (order_id, by, first_id) DO NOTHING`;
    }
    recorded = recs.length;
    await sql`INSERT INTO v2_loop_meta (key, value, at) VALUES ('actions_until', ${JSON.stringify(new Date(until).toISOString())}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
  }
  return { recorded, ...(await classifyActions(sql, t, opts)) };
}

async function classifyActions(sql: Sql, t: Transport, opts: { deadline?: number }): Promise<Record<string, unknown>> {
  const pending = (await sql`SELECT order_id, by, first_id, first_at, last_at, what, acts FROM v2_staff_actions WHERE classified_at IS NULL ORDER BY first_at LIMIT ${PER_RUN}`) as any[];
  if (!pending.length) return { classified: 0 };
  const contacts = (await sql`SELECT email, company_id, company_name FROM onsinch_contacts`) as Array<{ email: string; company_id: number; company_name: string | null }>;
  if (!contacts.length) throw new Error("no OnSinch contacts stored: no action can be tied to an email");
  const companiesOf = new Map<string, number[]>();
  const domainsOf = new Map<number, Set<string>>();
  const nameOf = new Map<number, string>();
  for (const c of contacts) {
    companiesOf.set(c.email, [...(companiesOf.get(c.email) ?? []), Number(c.company_id)]);
    const d = domainOfEmail(c.email);
    if (d && !CONSUMER_DOMAINS.has(d)) domainsOf.set(Number(c.company_id), new Set([...(domainsOf.get(Number(c.company_id)) ?? []), d]));
    if (c.company_name) nameOf.set(Number(c.company_id), c.company_name);
  }
  const places = new Map(((await sql`SELECT id, name FROM onsinch_places`) as any[]).map((p) => [Number(p.id), String(p.name ?? "")]));
  let reads = 0, classified = 0;
  const clientMemo = new Map<number, any[]>();
  for (const p of pending) {
    if (Date.now() >= (opts.deadline ?? Infinity)) break;
    const orderId = Number(p.order_id);
    let o = ((await sql`SELECT body, read_at FROM onsinch_orders WHERE order_id = ${orderId}`) as any[])[0];
    if (!o || T(o.read_at) < T(p.last_at)) {
      if (reads >= READS_PER_RUN) break;
      reads++;
      const got = (await readRows(t, `/orders?id[eq]=${orderId}&with=${NESTED}`))[0] ?? null;
      await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (${orderId}, ${got ? String(got.number) : null}, ${got ? Number(got.company_id) : null}, ${JSON.stringify(got)}::jsonb, now())
        ON CONFLICT (order_id) DO UPDATE SET number = EXCLUDED.number, company_id = EXCLUDED.company_id, body = EXCLUDED.body, read_at = now()`;
      o = { body: got };
    }
    const order = o.body;
    const key = { order_id: orderId, by: Number(p.by), first_id: Number(p.first_id) };
    if (!order) { await classify(sql, key, { bucket: "can't tell: the order is gone from OnSinch" }); classified++; continue; }
    const company = Number(order.company_id);
    if (isTestCompanyName(nameOf.get(company))) { await classify(sql, key, { number: String(order.number), company_id: company, bucket: "test company" }); classified++; continue; }
    const g = { acts: p.acts as Act[] };
    const days = actionDays(g, order);
    const first = T(p.first_at);
    const emails = ((await sql`SELECT d.message_id, d.kind, d.decision, d.interpretation->'grounded'->'requests' AS rs, m.from_address
      FROM v2_decisions d JOIN thread_messages m ON m.message_id = d.message_id
      WHERE NOT m.is_from_spartan AND d.sent_at::timestamptz > ${new Date(first - 7 * DAY).toISOString()}::timestamptz
        AND d.sent_at::timestamptz <= ${new Date(first).toISOString()}::timestamptz ORDER BY d.sent_at`) as any[])
      .map((e) => ({ message_id: String(e.message_id), from: addr(e.from_address), companies: companiesOf.get(addr(e.from_address)) ?? [], kind: e.kind as string | null, days: decisionDays(e.decision, Array.isArray(e.rs) ? e.rs : null) }));
    const cov = coverage(days, company, domainsOf.get(company) ?? new Set(), emails);
    let exception = null;
    if ((p.what as string[]).includes("create order")) {
      if (!clientMemo.has(company)) {
        if (reads >= READS_PER_RUN) break;
        reads++;
        clientMemo.set(company, await readRows(t, `/orders?company_id[eq]=${company}&with=${NESTED}&limit=100&page=1`));
      }
      exception = exceptionOf(order, clientMemo.get(company)!, (id) => places.get(id) ?? "");
    }
    await classify(sql, key, { number: String(order.number), company_id: company, days, bucket: cov.bucket, message_id: cov.message_id, exception });
    classified++;
  }
  return { classified, reads, pending: pending.length };
}

async function classify(sql: Sql, k: { order_id: number; by: number; first_id: number }, s: { number?: string; company_id?: number; days?: string[]; bucket: string; message_id?: string | null; exception?: unknown }): Promise<void> {
  await sql`UPDATE v2_staff_actions SET number = ${s.number ?? null}, company_id = ${s.company_id ?? null}, days = ${JSON.stringify(s.days ?? [])}::jsonb,
    bucket = ${s.bucket}, message_id = ${s.message_id ?? null}, exception = ${s.exception ? JSON.stringify(s.exception) : null}::jsonb, classified_at = now()
    WHERE order_id = ${k.order_id} AND by = ${k.by} AND first_id = ${k.first_id}`;
}
