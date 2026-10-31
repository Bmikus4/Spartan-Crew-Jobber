// ============================================================================
// The rebuild's decisions as TV cards.
// ----------------------------------------------------------------------------
// NOTHING IS SENT TO OPS; OPS ARE TOLD ON THE TV (Ben, 2026-10-10). A decision the system [DECISIONS V35]
// cannot carry out itself, a planned write it has not made (shadow), and a write it made
// all land here and nowhere else. Until 10-10 a v2 "handoff" was a database row nobody saw:
// the TV read only the paused engine's state, so 57 hand-offs on shadow day 1 reached no one.
//
// A thread's card comes from its newest decision that needs a person or made a change. A
// later "nothing to do" ("thanks!") does not clear it: only a tick or a staff edit does,
// exactly as for the old engine's needs.
// ============================================================================
import type { FeedItem, FeedKind, FeedSource } from "./project";
import { STATUS_TEXT } from "./project";
import type { Decision } from "../v2/interpret/plan";
import type { Interpretation } from "../v2/interpret/interpret";
import type { RunResult } from "../v2/bot/run";
import type { Op } from "../v2/bot/ops";
import { londonToUtc, utcToLondon } from "../v2/bot/ops";
import { rNumbersIn } from "../onsinch/resolve";
import { cardNote } from "./cardNote";
import { isReplyReason } from "../v2/reasons";
import type { Ask } from "./done";

/** One v2_decisions row of kind write or handoff. */
export interface V2Row {
  thread_id: string;
  message_id: string;
  sent_at: string;
  kind: "write" | "handoff";
  grounded: Interpretation | null;
  decision: Decision;
  executed: RunResult[] | null;
  company_id: number | null;
  from_address: string;
  /** The thread's original sender (feed/live.ts clientSenders), and the client company whose contact list holds it. */
  sender?: { address: string; client: string | null } | null;
  /** The thread's link (job_links): the order it is about, whoever made it, when OnSinch made it, and the stored order. */
  link?: { order_id: number; r_number: string | null; job_id: number | null; made?: string | null; absolute?: boolean; order?: OrderFacts | null } | null;
  /** The planner's answer on this email now (v2/replan.ts), when it has been planned again. */
  replan?: Decision | null;
}

/** What a card shows of a stored OnSinch order: its title, its live shifts' days, its largest call and first venue. */
export type OrderFacts = { title: string | null; days: string[]; crew: number | null; venue: string | null };

export function orderFacts(body: any, placeName: (id: number) => string | null): OrderFacts {
  const live = (x: any) => !(x?.cancelled === true || Number(x?.cancelled) > 0);
  const teams = ([].concat(body?.Job ?? []) as any[]).flatMap((j) => [].concat(j?.SlotTeam ?? []) as any[]).filter(live)
    .map((t) => ([].concat(t?.Slot ?? []) as any[]).filter((s) => live(s) && s?.beginning));
  const slots = teams.flat().sort((a, b) => Date.parse(a.beginning) - Date.parse(b.beginning));
  const crews = teams.map((t) => t.reduce((n, s) => n + (Number(s.size) || 0), 0)).filter((n) => n > 0);
  const loc = (s: any) => Number((Array.isArray(s?.SlotLocation) ? s.SlotLocation[0] : s?.SlotLocation)?.place_id) || 0;
  return {
    title: String(body?.name ?? "").trim() || null,
    days: [...new Set(slots.map((s) => utcToLondon(String(s.beginning)).date))].sort(),
    crew: crews.length ? Math.max(...crews) : null,
    venue: slots.length && loc(slots[0]) ? placeName(loc(slots[0])) : null,
  };
}

/**
 * A CARD'S NAME, ONE RULE (DECISIONS O15): the linked OnSinch order's title; else the client and venue; else the
 * original sender's address. Never a Spartan Crew address and never a subject line: 17 of 238 cards were named by
 * their subject on 29 Oct.
 */
export function cardName(x: { title?: string | null; client?: string | null; venue?: string | null; sender?: string | null }): string | null {
  if (x.title?.trim()) return x.title.trim();
  if (x.client) return x.venue ? `${x.client} @ ${x.venue}` : x.client;
  return x.sender && !/@spartancrew\.co\.uk$/i.test(x.sender) ? x.sender : null;
}

/** A decision recorded before plan.ts flagged replies (10-11) is one when every reason is a quote, a question or a detail the client must give (reasons.ts isReplyReason). */

function opDays(op: Op): Array<{ date: string; start: string; end: string; place_id?: number; venue?: string }> {
  if (op.kind === "create_order") return op.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, place_id: Number(s.place_id), venue: s.place_label }));
  if (op.kind === "set_position_times" || op.kind === "add_shift" || op.kind === "add_position") return [{ date: op.date, start: op.start, end: op.end }];
  return [];
}

/** A day with no time counts from its first minute, so the date never promises more time than there is. */
function startOf(date: string, start?: string): number {
  try { return Date.parse(londonToUtc(date, start ?? "00:00")); } catch { return NaN; }
}

/** What a decision says about its card: the kind, the order it is about, what the bot did for it. */
function classify(row: V2Row, d: Decision) {
  const g = row.grounded;
  const ops = d.kind === "write" ? d.ops.map((o) => o.op) : [];
  const said = d.kind === "write" ? d.why : d.kind === "handoff" ? d.reasons : [d.reason];
  const r_numbers = [...new Set(rNumbersIn(said.join("\n")))];
  const creates = ops.some((o) => o.kind === "create_order");
  // What the bot ran belongs to the decision it ran for: a decision planned again sent nothing.
  const executed = d === row.decision ? row.executed : null;
  const written = !!executed?.length && executed.length === ops.length && executed.every((r) => r.status === "verified");
  const orderOp = ops.find((o): o is Extract<Op, { order_id: number }> => "order_id" in o);
  // A created order's ids exist only in what the bot read back, and the verifier needs them to watch the check.
  const made = executed?.find((r) => Number(r.detail?.order_id) > 0)?.detail as { order_id?: unknown; number?: unknown } | undefined;
  const order_id = orderOp ? orderOp.order_id : made ? Number(made.order_id) : d.kind === "handoff" && d.order_id ? d.order_id : null;
  if (made?.number != null && String(made.number)) r_numbers.push(String(made.number).replace(/^R/i, ""));
  // A thread that names an order, or a request aimed at an existing shift, is an update even
  // when it also adds a shift: "move the de-rig to Tuesday, and 6 more on Wednesday" (The
  // Events House, 10-11) read as Needs Created because one of its requests was a new shift.
  const aimsAtOrder = !!row.link?.absolute || !!r_numbers.length || !!order_id || !!g?.requests.some((r) => r.action !== "new_shift" || r.target);
  const asksNew = g ? !aimsAtOrder && (g.intent === "booking" || g.intent === "quote_request" || g.requests.some((r) => r.action === "new_shift")) : !r_numbers.length;
  let kind: FeedKind;
  if (d.kind === "write" && written) kind = creates ? "created-check" : "updated-check";
  else if (d.kind === "write") kind = creates ? "needs-created" : "needs-updated";
  else if (d.kind === "handoff" && (d.reply ?? d.reasons.every(isReplyReason))) kind = "needs-reply";
  else kind = asksNew ? "needs-created" : "needs-updated";
  return { kind, ops, r_numbers, executed, written, order_id, made };
}

const ASK: Record<string, Ask> = { new_shift: "book", change_times: "change", change_crew: "change", cancel_shift: "cancel", other: "any" };
const OP_ASK: Record<Op["kind"], Ask> = { create_order: "book", add_shift: "book", add_position: "book", set_position_times: "change", set_position_size: "change", cancel_position: "cancel", set_po: "any" };

/**
 * A thread's card is the planner's CURRENT answer on its email: the decision made when it
 * arrived, or the one v2/replan.ts made since against OnSinch as it is now. The item key stays
 * the email's first decision's, so a tick or a remembered need survives the card being planned
 * again with another kind or order (a re-keyed card loses its marks).
 */
export function v2Source(row: V2Row, now: number): FeedSource {
  const d = answerOf(row);
  const c = classify(row, d);
  // A NEED'S KIND IS ITS JOB AS IT IS NOW (ADDENDUM §13.2 change 2): a new booking on a thread linked to an order
  // OnSinch already held when the email came is a change to that order. 11 of 44 "needs created" cards carried an
  // R and J on 29 Oct. An order made after the email is the booking done, which done.ts finds.
  if (c.kind === "needs-created" && row.link?.made && Date.parse(row.link.made) < (Date.parse(row.sent_at) || now)) c.kind = "needs-updated";
  // The key is the email's first decision as read without the link: a link found or proved later changes what the
  // card says, never which need it is, or the need would lose its marks (31 Oct: the kind moving moved the key).
  const first = classify({ ...row, link: null }, row.decision);
  const g = row.grounded;
  const note = d.kind === "none" ? null : cardNote({ decision: d, grounded: g, executed: c.executed, written: c.written });
  const at = Date.parse(row.sent_at) || now;
  const item: (Omit<FeedItem, "green"> & { order_id: number | null }) | null = d.kind === "none" ? null : {
    item_key: `${first.kind}:${row.thread_id}:${first.order_id ?? 0}:${row.message_id}`,
    kind: c.kind, status: STATUS_TEXT[c.kind], at, order_id: c.order_id,
  };

  // A day the planner says is already over is the card's day too, so the card leaves with its job
  // (project.ts): Encore's 13 Oct, planned again on 10-21, was listed with no day of its own.
  const over = d.kind === "handoff" ? d.reasons.map((x) => /^(\d{4}-\d{2}-\d{2}) is already over/.exec(x)?.[1]).filter((x): x is string => !!x) : [];
  const shifts: Array<{ date: string; start?: string; end?: string; place_id?: number; venue?: string; crew?: number }> = [
    ...(g?.requests ?? []).map((r) => ({ date: r.target?.date ?? r.date ?? "", start: r.start, end: r.end, venue: r.venue, crew: r.crew })),
    ...c.ops.flatMap(opDays),
    ...over.map((date) => ({ date })),
  ].filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  const days = [...new Set(shifts.map((s) => s.date))].sort();
  const starts = shifts.map((s) => startOf(s.date, s.start)).filter((v) => v >= now).sort((a, b) => a - b);
  const crews = shifts.map((s) => s.crew ?? 0).filter((n) => n > 0);
  const places = [...new Set(shifts.map((s) => s.place_id).filter((p): p is number => !!p))];

  // The linked order names the card only when the link is absolute, or its order holds a day the email names.
  const order = row.link?.order ?? null;
  const agreed = !!row.link?.absolute || !!order?.days.some((x) => days.includes(x));
  const venue = shifts.find((s) => s.venue)?.venue ?? (agreed ? order?.venue ?? null : null);

  return {
    thread_id: row.thread_id,
    days,
    item,
    // THE THREAD'S LINK IS THE ORDER IT IS ABOUT, kept current by the minute sweep. Until 10-15
    // a card took its R number only from the decision's own ops or the subject, and never a J
    // number: 15 of 19 open cards showed neither. And the order a decision made can be gone:
    // R11615, a duplicate deleted once staff keyed R11617, still headed its card.
    order_id: row.link?.order_id ?? c.order_id ?? null,
    // R AND J FROM THE LINK ONLY, the two together (Ben, 10-21: "always the correct R and J"). An R [DECISIONS V29]
    // read from the subject or the reasons was a number, not an order: EMS's R11562 stayed on its
    // card after the order was deleted. The bot's own orders are linked (links.ts backfillLinks).
    r_number: row.link?.r_number ? `R${String(row.link.r_number).replace(/^R/i, "")}` : null,
    j_number: row.link?.job_id ? `J${row.link.job_id}` : null,
    company_id: row.company_id,
    company: cardName({ title: agreed ? order?.title : null, client: row.sender?.client, venue, sender: row.sender?.address }),
    contact: null,
    venue,
    crew: crews.length ? Math.max(...crews) : null,
    starts_at: starts[0] ?? null,
    last_write: c.written ? at : 0,
    want: { sender: row.sender?.address ?? (row.from_address || null) },
    need: {
      at,
      asks: [...new Set([...(g?.requests ?? []).map((r) => ASK[r.action] ?? "any"), ...(g?.requests.length ? [] : c.ops.map((o) => OP_ASK[o.kind]))])],
      fresh: c.kind === "needs-created",
      days, places, venues: [...new Set(shifts.map((s) => s.venue).filter((v): v is string => !!v))],
    },
    note,
    resolvedText: "Answered by a later email",
  };
}

/** Each thread's card: its newest decision that needs a person or made a change, carrying every older need still open. */
export function v2Sources(rows: V2Row[], now: number): FeedSource[] {
  const byThread = new Map<string, V2Row[]>();
  for (const r of rows) byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), r]);
  return [...byThread.values()].map((list) => {
    const [lead, ...older] = rowsOnCard(list);
    const s = v2Source(lead, now);
    const also = older.map((r) => v2Source(r, now)).filter((o) => o.item?.kind === "needs-created" || o.item?.kind === "needs-updated");
    return also.length ? { ...s, also } : s;
  });
}

/**
 * THE CARD'S ROW, THEN EVERY OLDER NEED NO LATER EMAIL ANSWERED (addendum F2, 10-23). A card that
 * was only the thread's newest decision lost an older need to anything after it: "book Tuesday"
 * handed off, then "what's the rate?" became a Needs Reply the TV does not list, and our answer
 * to the question cleared the thread with the booking never made. A later decision answers a
 * need only when it is about one of the need's days or the order it names (openNeedUnder's
 * rule, for every later decision rather than a newest write); a question answers none. The
 * re-plan (v2/replan.ts) reads every row returned, so a need staff since booked turns green.
 */
export function rowsOnCard<T extends V2Row>(list: T[]): T[] {
  const lead = cardRow(list);
  const sorted = [...list].sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
  const open = sorted.filter((r, i) => r !== lead && needsWork(r) && !sorted.slice(i + 1).some((later) => answers(later, r)));
  return [lead, ...open.reverse()];
}

/**
 * The planner's current answer on a row: re-planned, or as decided. A re-plan that finds nothing to do no longer
 * clears the need (ADDENDUM §13.2 change 1): 29 of the 45 needs that "left the TV" by 30 Oct went that way, some
 * because "nothing is booked" on the day, which is the work not done. Whether staff did it is done.ts's to say.
 */
function answerOf(r: V2Row): Decision { return r.replan && r.replan.kind !== "none" ? r.replan : r.decision; }
function needsWork(r: V2Row): boolean {
  const d = answerOf(r);
  if (d.kind === "none") return false;
  const k = classify(r, d).kind;
  return k === "needs-created" || k === "needs-updated";
}
function answers(later: V2Row, need: V2Row): boolean {
  const d = answerOf(later), n = answerOf(need);
  if (d.kind === "none" || n.kind === "none" || classify(later, d).kind === "needs-reply") return false;
  const daysOf = (r: V2Row, x: Decision) => [...(r.grounded?.requests ?? []).map((q) => q.target?.date ?? q.date),
    ...(x.kind === "write" ? x.ops.flatMap((o) => opDays(o.op)).map((o) => o.date) : [])].filter((v): v is string => !!v);
  const needDays = daysOf(need, n);
  const sameDay = daysOf(later, d).some((v) => needDays.includes(v));
  const needOrders = rNumbersIn((n.kind === "write" ? n.why : n.reasons).join("\n"));
  const sameOrder = needOrders.length > 0 && rNumbersIn((d.kind === "write" ? d.why : d.reasons).join("\n")).some((v) => needOrders.includes(v));
  return sameDay || sameOrder;
}

/** The decision a thread's card is: its newest, or an older need a newer write left open. v2/replan.ts plans the same row again. */
export function cardRow<T extends V2Row>(list: T[]): T {
  const sorted = [...list].sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
  return (openNeedUnder(sorted) as T | null) ?? sorted[sorted.length - 1];
}

/**
 * A NEWER WRITE DOES NOT ANSWER AN OLDER NEED ABOUT SOMETHING ELSE (B79, 10-11). The thread's
 * card was its newest row, so a need ("no venue for the 14th") followed by a write about the
 * 20th became the write's check, and ticking that check lost the need for good: measured on
 * thread 1a11c3919fdd9ee7. The need stays the card unless the write is about one of its days
 * or the order it names; a need with no day known stays too, as the safe side.
 */
function openNeedUnder(list: V2Row[]): V2Row | null {
  const newest = list[list.length - 1];
  if (newest.decision.kind !== "write") return null;
  let need: V2Row | null = null;
  for (let i = list.length - 2; i >= 0; i--) {
    const r = list[i];
    if (r.decision.kind === "write") break; // an earlier write: anything before it was its business
    if (r.decision.kind === "handoff") { need = r; break; }
  }
  // A need answered by writing back (Needs Reply) is closed by our email, not by a write.
  if (!need || need.decision.kind !== "handoff" || (need.decision.reply ?? need.decision.reasons.every(isReplyReason))) return null;
  const wroteDays = new Set(newest.decision.ops.flatMap((o) => opDays(o.op)).map((d) => d.date));
  const needDays = (need.grounded?.requests ?? []).map((q) => q.target?.date ?? q.date).filter((d): d is string => !!d);
  const needOrders = rNumbersIn(need.decision.reasons.join("\n"));
  const sameOrder = needOrders.length > 0 && rNumbersIn(newest.decision.why.join("\n")).some((n) => needOrders.includes(n));
  const sameDay = needDays.some((d) => wroteDays.has(d));
  return sameDay || sameOrder ? null : need;
}
