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
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const asksNew = g ? g.intent === "booking" || g.intent === "quote_request" || g.requests.some((r) => r.action === "new_shift") : !r_numbers.length;

  let kind: FeedKind;
  let note: string;
  if (d.kind === "write" && written) {
    kind = creates ? "created-check" : "updated-check";
    note = `Done by the system: ${said.join("; ")}`;
  } else if (d.kind === "write") {
    kind = creates ? "needs-created" : "needs-updated";
    const stopped = row.executed?.find((r) => r.status !== "verified");
    note = stopped
      ? `The system stopped: ${stopped.reasons.join("; ") || stopped.status}`
      : `Not written yet (shadow): ${said.join("; ")}`;
  } else {
    kind = asksNew ? "needs-created" : "needs-updated";
    note = cap(said.join("; "));
  }
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
  const newest = new Map<string, V2Row>();
  for (const r of rows) {
    const was = newest.get(r.thread_id);
    if (!was || Date.parse(r.sent_at) >= Date.parse(was.sent_at)) newest.set(r.thread_id, r);
  }
  return [...newest.values()].map((r) => v2Source(r, now));
}
