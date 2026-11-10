// ============================================================================
// The comparator: the fold's word against the world's, per ask (the board's design: agreement
// becomes confidence, disagreement becomes something a person is shown).
// ----------------------------------------------------------------------------
// Two independent channels meet here and nothing else is consulted: the fold's status (what the
// conversation and the act TIMING say) and the order's stored body (what OnSinch HOLDS now). The
// verdicts: settled-confirmed and withdrawn-confirmed and open are agreement; acted-not-held (staff
// acted, the ask is not in the state), done-unacted (the state holds it with no email-visible act —
// the phone/portal half showing itself) and withdrawn-but-held are the disagreements worth eyes.
// A superseded ask (fold-v2: its date was restated) is neither: the newer key carries the grade.
// cancelled-after is agreement too: staff acted and the day was then cancelled — a cancelled slot in
// the body, or a cancel ask naming the date (a cancel never withdraws an acted ask, so the acted ask
// outlives the cancellation). Of the 77 acted-not-held named 10 Nov, cancellation explained 45.
// Pure: the caller supplies the state and the bodies; the same inputs always give the same verdicts,
// so stored verdicts are derived-only and recomputable, like everything else on the board.
// ============================================================================
import type { AskState, FoldState } from "./fold";

export type Held = "exact" | "adjusted" | "absent" | "cancelled" | "unkeyed";
export type Verdict =
  | "settled-confirmed" | "open" | "withdrawn-confirmed"            // agreement
  | "cancelled-after"                                               // agreement: acted, then the day was cancelled
  | "acted-not-held" | "done-unacted" | "withdrawn-but-held"        // disagreement
  | "superseded"                                                    // replaced by a newer date: judged through the newer ask's key
  | "unkeyed";                                                      // nothing to compare against

export type AskVerdict = { key: string; status: AskState["status"]; held: Held; verdict: Verdict; differs?: string[]; order_id?: number };

type Slot = { day: string; start: string; end: string; size: number; cancelled: boolean; place: number | null };

const londonDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const londonTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });

/** The slots of a stored order body (the Job__SlotTeam__Slot__SlotLocation embed, as truth.ts stores it). */
export function slotsOf(body: any): Slot[] {
  const out: Slot[] = [];
  for (const j of body?.Job ?? []) for (const st of j?.SlotTeam ?? []) for (const s of st?.Slot ?? []) {
    if (!s?.beginning) continue;
    out.push({ day: londonDay(s.beginning), start: londonTime(s.beginning), end: s.end ? londonTime(s.end) : "", size: Number(s.size) || 0, cancelled: !!s.cancelled, place: s?.SlotLocation?.place_id ?? null });
  }
  return out;
}

/** Does this body hold the ask on its day, and with which asked values off? */
function heldIn(a: AskState, slots: Slot[]): { held: Held; differs: string[] } {
  const date = a.date;
  if (!date) return { held: "unkeyed", differs: [] };
  const day = slots.filter((s) => s.day === date);
  const open = day.filter((s) => !s.cancelled);
  if (a.akind === "cancel_shift") return { held: open.length ? "absent" : day.length ? "exact" : "exact", differs: [] };
  // The day is in the body but every slot on it is cancelled: not the same thing as never held.
  if (!open.length) return { held: day.length ? "cancelled" : "absent", differs: [] };
  const v: any = a.values ?? {};
  const differs: string[] = [];
  const near = v.start ? open.filter((s) => s.start === v.start) : open;
  const at = near.length ? near : open;
  if (v.start && !near.length) differs.push("start");
  if (v.end && !at.some((s) => s.end === v.end)) differs.push("end");
  if (v.crew !== undefined && !at.some((s) => s.size === v.crew) && at.reduce((n, s) => n + s.size, 0) !== v.crew) differs.push("crew");
  if (a.place_id !== undefined && a.place_id !== null && !at.some((s) => s.place === a.place_id)) differs.push("venue");
  return { held: differs.length ? "adjusted" : "exact", differs };
}

/**
 * Every ask's verdict. bodies: the freshest stored body per order the thread can reach; an ask whose
 * order has no stored body, or which names no day, is unkeyed — said, never guessed.
 */
export function compare(state: FoldState, bodies: Map<number, any>, threadOrders: number[]): AskVerdict[] {
  const out: AskVerdict[] = [];
  for (const a of state.asks ?? []) {
    // A superseded ask left the live population when its date was restated; the world is compared
    // against the newer ask's key, so grading this one again would double-count the same shift.
    if (a.status === "superseded") { out.push({ key: a.key, status: a.status, held: "unkeyed", verdict: "superseded" }); continue; }
    const cand = a.order_id ? [a.order_id] : threadOrders;
    const withBody = cand.filter((o) => bodies.has(o));
    if (!withBody.length) { out.push({ key: a.key, status: a.status, held: "unkeyed", verdict: "unkeyed" }); continue; }
    let best: { held: Held; differs: string[]; order?: number } = { held: "absent", differs: [] };
    for (const o of withBody) {
      const r = heldIn(a, slotsOf(bodies.get(o)));
      if (r.held === "unkeyed") { best = { ...r, order: o }; break; }
      if (r.held === "exact") { best = { ...r, order: o }; break; }
      if (r.held === "adjusted" && best.held !== "exact") best = { ...r, order: o };
      else if (r.held === "cancelled" && best.held === "absent") best = { ...r, order: o };
    }
    const held = best.held;
    const gone = held === "absent" || held === "cancelled";
    // A cancellation shows itself two ways: cancelled slots in the body, or a cancel ask naming the
    // same day in the state (a cancel never withdraws an acted ask, so the acted ask outlives it).
    const cancelled = held === "cancelled" || (a.akind !== "cancel_shift" && (state.asks ?? []).some((c) =>
      c.key !== a.key && c.akind === "cancel_shift" && c.status !== "withdrawn" && c.date === a.date
      && (!c.order_id || !a.order_id || c.order_id === a.order_id)));
    const verdict: Verdict =
      held === "unkeyed" ? "unkeyed"
      : a.status === "withdrawn" ? (gone ? "withdrawn-confirmed" : "withdrawn-but-held")
      : a.status === "acted" ? (gone ? (cancelled ? "cancelled-after" : "acted-not-held") : "settled-confirmed")
      : gone ? "open" : "done-unacted";
    const row: AskVerdict = { key: a.key, status: a.status, held, verdict };
    if (best.differs.length) row.differs = best.differs;
    if (best.order !== undefined) row.order_id = best.order;
    out.push(row);
  }
  return out;
}

/** The step's one-line shape: how many of each verdict. */
export function tally(v: AskVerdict[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const x of v) t[x.verdict] = (t[x.verdict] ?? 0) + 1;
  return t;
}
