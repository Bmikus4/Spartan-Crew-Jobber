// ============================================================================
// The rebuild's decisions as TV cards.
// ----------------------------------------------------------------------------
// NOTHING IS SENT TO OPS; OPS ARE TOLD ON THE TV (Ben, 2026-10-10). A decision the system
// cannot carry out itself, a planned write it has not made (shadow), and a write it made
// all land here and nowhere else. Until 10-10 a v2 "handoff" was a database row nobody saw:
// the TV read only the paused engine's state, so 57 hand-offs on shadow day 1 reached no one.
//
// A thread's card comes from its newest decision that needs a person or made a change. A
// later "nothing to do" ("thanks!") does not clear it: only a tick or a staff edit does,
// exactly as for the old engine's needs.
// ============================================================================
import type { FeedItem, FeedKind, FeedSource, FeedWant } from "./project";
import { STATUS_TEXT } from "./project";
import type { Decision } from "../v2/interpret/plan";
import type { Interpretation } from "../v2/interpret/interpret";
import type { RunResult } from "../v2/bot/run";
import type { Op } from "../v2/bot/ops";
import { londonToUtc, shiftWindow } from "../v2/bot/ops";
import { rNumbersIn } from "../engine/resolve";
import { cardNote } from "./cardNote";

/** One v2_decisions row of kind write or handoff, with its message's subject. */
export interface V2Row {
  thread_id: string;
  message_id: string;
  sent_at: string;
  kind: "write" | "handoff";
  grounded: Interpretation | null;
  decision: Decision;
  executed: RunResult[] | null;
  company_id: number | null;
  company: string | null;
  from_address: string;
  subject: string | null;
}

const REF = /\b[A-Z]{2,5}-?\d{3,6}\b/g;

/** A decision recorded before plan.ts flagged replies (10-11) is one when every reason is a quote, a question or a detail the client must give. */
const REPLY_REASON = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;

function opDays(op: Op): Array<{ date: string; start: string; end: string; place_id?: number; venue?: string }> {
  if (op.kind === "create_order") return op.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, place_id: Number(s.place_id), venue: s.place_label }));
  if (op.kind === "set_position_times" || op.kind === "add_shift" || op.kind === "add_position") return [{ date: op.date, start: op.start, end: op.end }];
  return [];
}

function window(date: string, start: string, end: string): { b: number; e: number } | null {
  try {
    const w = shiftWindow(date, start, end);
    return { b: Date.parse(w.beginning), e: Date.parse(w.end) };
  } catch {
    return null; // a time London's clock skips or repeats; the card still shows the day
  }
}

/** A day with no time counts from its first minute, so the date never promises more time than there is. */
function startOf(date: string, start?: string): number {
  try { return Date.parse(londonToUtc(date, start ?? "00:00")); } catch { return NaN; }
}

export function v2Source(row: V2Row, now: number): FeedSource {
  const d = row.decision;
  const g = row.grounded;
  const ops = d.kind === "write" ? d.ops.map((o) => o.op) : [];
  const said = d.kind === "write" ? d.why : d.kind === "handoff" ? d.reasons : [d.reason];
  const r_numbers = [...new Set(rNumbersIn(`${row.subject ?? ""}\n${said.join("\n")}`))];

  const creates = ops.some((o) => o.kind === "create_order");
  const written = !!row.executed?.length && row.executed.length === ops.length && row.executed.every((r) => r.status === "verified");
  const orderOp = ops.find((o): o is Extract<Op, { order_id: number }> => "order_id" in o);
  // A created order's ids exist only in what the bot read back, and the verifier needs them to watch the check.
  const made = row.executed?.find((r) => Number(r.detail?.order_id) > 0)?.detail as { order_id?: unknown; number?: unknown } | undefined;
  const order_id = orderOp ? orderOp.order_id : made ? Number(made.order_id) : null;
  if (made?.number != null && String(made.number)) r_numbers.push(String(made.number).replace(/^R/i, ""));
  // A thread that names an order, or a request aimed at an existing shift, is an update even
  // when it also adds a shift: "move the de-rig to Tuesday, and 6 more on Wednesday" (The
  // Events House, 10-11) read as Needs Created because one of its requests was a new shift.
  const aimsAtOrder = !!r_numbers.length || !!order_id || !!g?.requests.some((r) => r.action !== "new_shift" || r.target);
  const asksNew = g ? !aimsAtOrder && (g.intent === "booking" || g.intent === "quote_request" || g.requests.some((r) => r.action === "new_shift")) : !r_numbers.length;

  let kind: FeedKind;
  if (d.kind === "write" && written) kind = creates ? "created-check" : "updated-check";
  else if (d.kind === "write") kind = creates ? "needs-created" : "needs-updated";
  else if (d.kind === "handoff" && (d.reply ?? d.reasons.every((x) => REPLY_REASON.test(x)))) kind = "needs-reply";
  else kind = asksNew ? "needs-created" : "needs-updated";
  const note = cardNote({ decision: d, grounded: g, executed: row.executed, written });
  const at = Date.parse(row.sent_at) || now;
  const item: Omit<FeedItem, "green"> & { order_id: number | null } = {
    item_key: `${kind}:${row.thread_id}:${order_id ?? 0}:${row.message_id}`,
    kind, status: STATUS_TEXT[kind], at, order_id,
  };

  const shifts: Array<{ date: string; start?: string; end?: string; place_id?: number; venue?: string; crew?: number }> = [
    ...(g?.requests ?? []).map((r) => ({ date: r.target?.date ?? r.date ?? "", start: r.start, end: r.end, venue: r.venue, crew: r.crew })),
    ...ops.flatMap(opDays),
  ].filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date));
  const days = [...new Set(shifts.map((s) => s.date))].sort();
  const windows = shifts.flatMap((s) => (s.start && s.end ? [{ ...window(s.date, s.start, s.end), p: s.place_id ?? null }] : []))
    .filter((w): w is { b: number; e: number; p: number | null } => Number.isFinite(w.b) && Number.isFinite(w.e));
  const starts = shifts.map((s) => startOf(s.date, s.start)).filter((v) => v >= now).sort((a, b) => a - b);
  const crews = shifts.map((s) => s.crew ?? 0).filter((n) => n > 0);
  const places = [...new Set(shifts.map((s) => s.place_id).filter((p): p is number => !!p))];

  const refs = new Set<string>();
  if (g?.po) refs.add(g.po);
  for (const m of (row.subject ?? "").matchAll(REF)) if (!/^R-?\d+$/i.test(m[0])) refs.add(m[0]);
  const want: FeedWant = { r_numbers, refs: [...refs], place_id: places.length === 1 ? places[0] : null, shifts: windows, sender: row.from_address || null };

  return {
    thread_id: row.thread_id,
    days,
    item,
    order_id,
    r_number: made?.number != null && String(made.number) ? `R${String(made.number).replace(/^R/i, "")}` : r_numbers.length === 1 ? `R${r_numbers[0]}` : null,
    j_number: null,
    company_id: row.company_id,
    company: row.company,
    contact: null,
    venue: shifts.find((s) => s.venue)?.venue ?? null,
    subject: row.subject ?? "",
    crew: crews.length ? Math.max(...crews) : null,
    starts_at: starts[0] ?? null,
    last_write: written ? at : 0,
    want,
    note,
    resolvedText: "Cleared by the system",
  };
}

/** Each thread's newest decision that needs a person or made a change. */
export function v2Sources(rows: V2Row[], now: number): FeedSource[] {
  const byThread = new Map<string, V2Row[]>();
  for (const r of rows) byThread.set(r.thread_id, [...(byThread.get(r.thread_id) ?? []), r]);
  const out: FeedSource[] = [];
  for (const list of byThread.values()) {
    list.sort((a, b) => Date.parse(a.sent_at) - Date.parse(b.sent_at));
    const newest = list[list.length - 1];
    out.push(v2Source(openNeedUnder(list) ?? newest, now));
  }
  return out;
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
  if (!need || need.decision.kind !== "handoff" || (need.decision.reply ?? need.decision.reasons.every((x) => REPLY_REASON.test(x)))) return null;
  const wroteDays = new Set(newest.decision.ops.flatMap((o) => opDays(o.op)).map((d) => d.date));
  const needDays = (need.grounded?.requests ?? []).map((q) => q.target?.date ?? q.date).filter((d): d is string => !!d);
  const needOrders = rNumbersIn(`${need.subject ?? ""}\n${need.decision.reasons.join("\n")}`);
  const sameOrder = needOrders.length > 0 && rNumbersIn(newest.decision.why.join("\n")).some((n) => needOrders.includes(n));
  const sameDay = needDays.some((d) => wroteDays.has(d));
  return sameDay || sameOrder ? null : need;
}
