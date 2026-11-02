// ============================================================================
// Each need on the TV: is it done (done.ts), and how did it leave (ADDENDUM §12.2 "per card", §13.2 change 1).
// ----------------------------------------------------------------------------
// markNeeds runs the one evaluator over every open need each minute, from the stored OnSinch history, and writes
// its answer as a mark the TV reads: "done" (staff did it in OnSinch, on its own job) or "possibly" (staff worked
// on more than one job that could be it). The TV itself reads only these marks and never OnSinch.
//
// recordCardExits keeps one row per need: when it was first and last open, and how it left, with who when known:
//   - green on the card: the mark that turned it (a person's tick, staff's work found, a later email);
//   - gone because a later email on its thread answers it (v2.ts rowsOnCard);
//   - gone with every day of its card past: its day passed;
//   - gone with no day after 14 quiet days;
//   - gone after a person dismissed the thread: dismissed;
//   - gone otherwise: "left the TV", counted, so a way out nobody named shows up in the report.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Transport } from "../../onsinch/onsinch";
import type { FeedCard } from "../../feed/project";
import { STALE_UNDATED_MS } from "../../feed/project";
import { v2Sources, type V2Row } from "../../feed/v2";
import { isDone, type Order, type Row, type ThreadMsg } from "../../feed/done";
import { latestText } from "../interpret/ground";
import { CONSUMER_DOMAINS } from "../../onsinch/resolve";
import { readClientOrders } from "./truth";
import { utcToLondon } from "../bot/ops";
import { ensureSchema } from "../../migrations";

type Sql = NeonQueryFunction<false, false>;
const NEED = new Set(["needs-created", "needs-updated"]);
const GREEN_EXIT: Record<string, string> = { checked: "a person's tick", done: "staff's work found in OnSinch", resolved: "answered by a later email", agreed: "agreed with the client, held in OnSinch" };
const addr = (f: unknown) => String(f ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();

/**
 * Every open need through done.ts, with one read of each table whatever the number of needs. A need's client is the
 * one company whose contact list holds the sender, never the decision's guess; its orders are read whole from
 * OnSinch here, in the minute sync, so the TV's read path never needs to.
 */
export async function markNeeds(sql: Sql, t: Transport | null, rows: V2Row[], now = Date.now()): Promise<{ needs: number; done: number; possibly: number; agreed: number; reads: number }> {
  await ensureSchema(sql);
  const needs = v2Sources(rows, now).flatMap((s) => [s, ...(s.also ?? [])])
    .filter((x) => x.item && NEED.has(x.item.kind) && x.need)
    .map((x) => ({ key: x.item!.item_key, thread_id: x.thread_id, sender: addr(x.want.sender), need: x.need! }));
  if (!needs.length) return { needs: 0, done: 0, possibly: 0, agreed: 0, reads: 0 };
  const threads = [...new Set(needs.map((n) => n.thread_id))];
  const companiesOf = new Map<string, number[]>();
  for (const c of (await sql`SELECT email, company_id FROM onsinch_contacts WHERE email = ANY(${[...new Set(needs.map((n) => n.sender))]})`) as any[]) companiesOf.set(c.email, [...(companiesOf.get(c.email) ?? []), Number(c.company_id)]);
  const companyOf = (sender: string) => { const cs = [...new Set(companiesOf.get(sender) ?? [])]; return cs.length === 1 ? cs[0] : null; };
  const companies = [...new Set(needs.map((n) => companyOf(n.sender)).filter((c): c is number => c != null))];
  // Every company a sender could be: its own contact lists, else every company with a contact at its (business)
  // domain, as the planner finds a client. A cancellation is borne out only when none of them holds the day (done.ts).
  const domainOf = (e: string) => e.split("@")[1] ?? "";
  const unlisted = [...new Set(needs.map((n) => n.sender).filter((e) => !companiesOf.has(e) && domainOf(e) && !CONSUMER_DOMAINS.has(domainOf(e))).map(domainOf))];
  const byDomain = new Map<string, number[]>();
  for (const c of (await sql`SELECT email, company_id FROM onsinch_contacts WHERE split_part(lower(email), '@', 2) = ANY(${unlisted})`) as any[]) byDomain.set(domainOf(String(c.email).toLowerCase()), [...(byDomain.get(domainOf(String(c.email).toLowerCase())) ?? []), Number(c.company_id)]);
  const senderCompanies = (sender: string) => [...new Set(companiesOf.get(sender) ?? byDomain.get(domainOf(sender)) ?? [])];
  const everyCompany = [...new Set(needs.flatMap((n) => senderCompanies(n.sender)))];
  const reads = t ? await readClientOrders(sql, t, companies, now) : 0;
  const links = (await sql`SELECT thread_id, order_id, proof FROM job_links WHERE thread_id = ANY(${threads}) AND state IN ('linked', 'relinked')`) as any[];
  const conflicts = (((await sql`SELECT value FROM v2_loop_meta WHERE key = 'link_conflicts'`) as any[])[0]?.value ?? {}) as Record<string, string>;
  const orders = new Map(((await sql`SELECT order_id, number, company_id, body, deleted_at FROM onsinch_orders
    WHERE order_id = ANY(${links.map((l) => Number(l.order_id))}) OR company_id = ANY(${everyCompany})`) as any[])
    .map((o): [number, Order] => [Number(o.order_id), { order_id: Number(o.order_id), number: o.number, company_id: o.company_id == null ? null : Number(o.company_id), body: o.body, deleted: !!o.deleted_at || !o.body }]));
  // Each need's thread, newest words only: an agreement is the client's yes to a quote or terms Spartan sent, often
  // before the need's own email (a September quote confirmed on 27 Oct), so the history read starts at the thread's.
  const asked = new Set(rows.filter((r) => (r.grounded?.requests ?? []).some((q) => !q.history)).map((r) => r.message_id));
  // A change or cancel in the client's own words, as against a booking restated (a yes listing the shifts it confirms).
  const changed = new Set(rows.filter((r) => (r.grounded?.requests ?? []).some((q) => !q.history && q.action !== "new_shift")).map((r) => r.message_id));
  // The reader's booking: after a quote, the client going ahead (done.ts saidYes).
  const books = new Set(rows.filter((r) => r.grounded?.intent === "booking").map((r) => r.message_id));
  const threadOf = new Map<string, ThreadMsg[]>();
  for (const m of (await sql`SELECT thread_id, message_id, date_iso, is_from_spartan, body FROM thread_messages WHERE thread_id = ANY(${threads})`) as any[])
    threadOf.set(m.thread_id, [...(threadOf.get(m.thread_id) ?? []), { at: Date.parse(m.date_iso), ours: !!m.is_from_spartan, text: latestText(String(m.body ?? "")), asks: !m.is_from_spartan && asked.has(m.message_id), changes: !m.is_from_spartan && changed.has(m.message_id), books: !m.is_from_spartan && books.has(m.message_id) }]);
  const from = new Date(Math.min(...needs.map((n) => n.need.at), ...[...threadOf.values()].flat().map((m) => m.at).filter((x) => x > 0))).toISOString();
  const history = ((await sql`SELECT id, action, creator, created, model, model_id, order_id, data FROM onsinch_timeline
    WHERE order_id = ANY(${[...orders.keys()]}) AND created > ${from}::timestamptz ORDER BY id`) as any[])
    .map((r): Row => ({ ...r, id: Number(r.id), order_id: Number(r.order_id), creator: r.creator == null ? null : Number(r.creator), created: new Date(r.created).toISOString() }));
  const venues = [...new Set(needs.flatMap((n) => n.need.venues.map((v) => v.trim().toLowerCase())))];
  const places = new Map<string, number[]>();
  for (const p of (await sql`SELECT id, lower(trim(name)) AS name FROM onsinch_places WHERE lower(trim(name)) = ANY(${venues})`) as any[]) places.set(p.name, [...(places.get(p.name) ?? []), Number(p.id)]);
  const marks = (await sql`SELECT item_key, mark, evidence FROM feed_marks WHERE item_key = ANY(${needs.map((n) => n.key)}) AND mark IN ('done', 'possibly', 'agreed')`) as any[];
  let done = 0, possibly = 0, agreed = 0;
  for (const n of needs) {
    // A quote waiting on the client is read again each minute: the client back on the thread brings the card back. Kept,
    // it hid a PO the client sent after the quote, which made no card of its own, for 25 h (replay from 9 Oct, 1 Nov).
    const waiting = marks.find((m) => m.item_key === n.key && m.mark === "agreed" && /^Quote sent/.test(String(m.evidence?.text ?? "")));
    if (marks.some((m) => m.item_key === n.key && (m.mark === "done" || (m.mark === "agreed" && !waiting)))) continue;
    const mine = links.filter((l) => l.thread_id === n.thread_id).map((l) => ({ order_id: Number(l.order_id), absolute: !!l.proof, ref: String(l.proof ?? "") }));
    const v = conflicts[n.thread_id]
      ? { state: "possibly" as const, text: `Check the order: ${conflicts[n.thread_id]}`, orders: [] as number[], rung: "conflict", at: null, creator: null }
      : isDone({ ...n.need, company_id: companyOf(n.sender), companies: senderCompanies(n.sender) }, mine, orders, history, (name) => places.get(name.trim().toLowerCase()) ?? [], threadOf.get(n.thread_id) ?? []);
    if (waiting) {
      if (v.state === "agreed" && /^Quote sent/.test(v.text)) continue;
      await sql`DELETE FROM feed_marks WHERE item_key = ${n.key} AND mark = 'agreed'`;
    }
    const had = marks.find((m) => m.item_key === n.key && m.mark === "possibly");
    if (v.state === "done") {
      // Green from when staff did it, not from when this saw it: the TV keeps a done card for a day after that, so work
      // found late (the first run found 85 needs done days before) never floods the list.
      await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by, evidence, at) VALUES (${n.key}, ${n.thread_id}, 'done', NULL,
        ${JSON.stringify({ text: v.text, at: v.at, creator: v.creator, orders: v.orders, rung: v.rung })}::jsonb, ${v.at ?? new Date(n.need.at).toISOString()}) ON CONFLICT (item_key, mark) DO NOTHING`;
      done++;
    } else if (v.state === "agreed") {
      // Off the TV, not green: nothing was left for staff to do (the owner, 1 Nov: "those cases should not appear on the TV").
      await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by, evidence, at) VALUES (${n.key}, ${n.thread_id}, 'agreed', NULL,
        ${JSON.stringify({ text: v.text, at: v.at, orders: v.orders })}::jsonb, ${v.at ?? new Date(now).toISOString()}) ON CONFLICT (item_key, mark) DO NOTHING`;
      agreed++;
    } else if (v.state === "possibly") {
      if (had?.evidence?.text !== v.text) await sql`INSERT INTO feed_marks (item_key, thread_id, mark, by, evidence, at) VALUES (${n.key}, ${n.thread_id}, 'possibly', NULL,
        ${JSON.stringify({ text: v.text, orders: v.orders, rung: v.rung })}::jsonb, ${new Date(now).toISOString()}) ON CONFLICT (item_key, mark) DO UPDATE SET evidence = EXCLUDED.evidence`;
      possibly++;
    } else if (had) await sql`DELETE FROM feed_marks WHERE item_key = ${n.key} AND mark = 'possibly'`;
  }
  return { needs: needs.length, done, possibly, agreed, reads };
}

/** `onCard`: the emails the TV's cards are built from now (v2.ts rowsOnCard); a need whose email is not among them was answered by a later one. */
export async function recordCardExits(sql: Sql, cards: FeedCard[], onCard: Set<string>, now = Date.now()): Promise<{ open: number; exited: number }> {
  await ensureSchema(sql);
  const today = utcToLondon(new Date(now).toISOString()).date;
  const at = new Date(now).toISOString();
  const open: any[] = [], green: any[] = [];
  for (const c of cards) for (const i of c.items) {
    if (!NEED.has(i.kind)) continue;
    const base = { item_key: i.item_key, thread_id: c.thread_id, kind: i.kind, days: c.dates ?? [], opened_at: new Date(i.at || now).toISOString() };
    if (!i.green) open.push(base);
    else {
      const creator = (i.green.evidence as { creator?: unknown } | null)?.creator;
      green.push({ ...base, exit: GREEN_EXIT[i.green.mark] ?? i.green.mark, exit_by: i.green.by ?? (creator ? `onsinch:${creator}` : null), exit_at: new Date(i.green.at || now).toISOString() });
    }
  }
  if (open.length) await sql`INSERT INTO v2_card_exits (item_key, thread_id, kind, days, opened_at, last_seen_at)
    SELECT item_key, thread_id, kind, days, opened_at, ${at}::timestamptz FROM jsonb_to_recordset(${JSON.stringify(open)}::jsonb)
      AS x(item_key TEXT, thread_id TEXT, kind TEXT, days JSONB, opened_at TIMESTAMPTZ)
    ON CONFLICT (item_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, days = EXCLUDED.days WHERE v2_card_exits.exit IS NULL`;
  // Turned green: its mark is how it left. A need first seen already green is recorded with it.
  if (green.length) await sql`INSERT INTO v2_card_exits (item_key, thread_id, kind, days, opened_at, last_seen_at, exit, exit_by, exit_at)
    SELECT item_key, thread_id, kind, days, opened_at, ${at}::timestamptz, exit, exit_by, exit_at FROM jsonb_to_recordset(${JSON.stringify(green)}::jsonb)
      AS x(item_key TEXT, thread_id TEXT, kind TEXT, days JSONB, opened_at TIMESTAMPTZ, exit TEXT, exit_by TEXT, exit_at TIMESTAMPTZ)
    ON CONFLICT (item_key) DO UPDATE SET exit = EXCLUDED.exit, exit_by = EXCLUDED.exit_by, exit_at = EXCLUDED.exit_at, last_seen_at = EXCLUDED.last_seen_at
    WHERE v2_card_exits.exit IS NULL`;
  // Gone from the TV without a mark.
  const shown = new Set([...open, ...green].map((x) => x.item_key));
  const gone = ((await sql`SELECT item_key, thread_id, days, opened_at FROM v2_card_exits WHERE exit IS NULL`) as any[]).filter((r) => !shown.has(r.item_key));
  const dismissed = new Map(((await sql`SELECT thread_id, by, at FROM feed_marks WHERE mark = 'dismissed'`) as any[]).map((m) => [String(m.thread_id), m]));
  // Green past the TV's day of dwell before it was seen green: work found late is dated when staff did it (markNeeds).
  const marked = new Map(((await sql`SELECT item_key, mark, by, evidence FROM feed_marks WHERE item_key = ANY(${gone.map((r) => r.item_key)}) AND mark IN ('checked', 'done', 'resolved', 'agreed')`) as any[])
    .map((m) => [String(m.item_key), m]));
  for (const r of gone) {
    const days = (Array.isArray(r.days) ? r.days : []) as string[];
    const d = dismissed.get(String(r.thread_id));
    const g = marked.get(String(r.item_key));
    if (g) {
      await sql`UPDATE v2_card_exits SET exit = ${GREEN_EXIT[g.mark]}, exit_by = ${g.by ?? (g.evidence?.creator ? `onsinch:${g.evidence.creator}` : null)}, exit_at = ${at}::timestamptz WHERE item_key = ${r.item_key} AND exit IS NULL`;
      continue;
    }
    const exit = d ? "dismissed"
      : !onCard.has(String(r.item_key).split(":").pop()!) ? "answered by a later email"
      : days.length && days.every((x) => x < today) ? "its day passed"
      : !days.length && now - Date.parse(new Date(r.opened_at).toISOString()) > STALE_UNDATED_MS ? "no day, and quiet for 14 days"
      : "left the TV";
    await sql`UPDATE v2_card_exits SET exit = ${exit}, exit_by = ${d?.by ?? null}, exit_at = ${at}::timestamptz WHERE item_key = ${r.item_key} AND exit IS NULL`;
  }
  return { open: open.length, exited: gone.length };
}
