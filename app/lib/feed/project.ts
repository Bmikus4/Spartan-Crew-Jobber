// ============================================================================
// The live feed: what the engine processed that is still waiting on a person.
// ----------------------------------------------------------------------------
// A PROJECTION, and a pure one. Everything on the TV is derived from the state rows,
// the stored messages, the feed's own marks and the follow-up board at one instant;
// nothing here is remembered between refreshes except the marks. So the TV can never
// hold an opinion the engine does not.
//
// THE STATUS IS THE GMAIL LABEL, read through the engine's own predicates
// (cannotBeBooked, needsLabelFor, CHANGED_A_STANDING_ORDER) and never re-derived. A
// screen that worked out "needs created" for itself would drift from the label within a
// fortnight, and then the office TV and the mailbox would disagree with nobody able to
// say which was right. The Gmail send flags (built_flagged, needs_label, ...) are NOT
// read: they record what was posted to Gmail, and posting failed for a day on
// 2026-10-02 while the state itself was right.
// ============================================================================
import { cannotBeBooked, needsLabelFor, CHANGED_A_STANDING_ORDER } from "../engine/pipeline";
import type { ConversationState, DesiredSlotTeam } from "../engine/types";

export type FeedKind = "needs-created" | "needs-updated" | "created-check" | "updated-check" | "needs-reply";
export type FeedColour = "red" | "blue" | "neutral";
export type FeedLane = "reply" | "need" | "done";
/**
 * `made` is never stored: it is what the projection calls an order or update the engine
 * itself wrote, which is done the moment it is written (Ben, 2026-10-04). `history` and
 * `dismissed` are stored and are NOT green: `history` records that the verifier has
 * read an item's past once; `dismissed` takes a whole thread off the TV.
 */
export type MarkKind = "checked" | "staff-edit" | "order-found" | "made" | "history" | "dismissed";
const GREEN_MARKS = new Set<MarkKind>(["checked", "staff-edit", "order-found"]);

/** The requester's wording, byte for byte (test/feedProjection.ts pins it). */
export const STATUS_TEXT: Record<FeedKind, string> = {
  "needs-created": "Order needs created",
  "needs-updated": "Order needs updated",
  "created-check": "Order was created, check to verify",
  "updated-check": "Order was updated, check to verify",
  "needs-reply": "Needs reply",
};

/**
 * How long a done card stays at the bottom of the list. A day, so a board the crew has
 * worked through reads all green rather than empty (Ben, 2026-10-04).
 */
export const DONE_DWELL_MS = 24 * 3_600_000;
/**
 * A need with no job date and no word from the client in this long leaves the list for
 * the "older" count. Undated, it never passes its own date, and the July and August
 * enquiries on the board on 2026-10-04 were all of this kind.
 */
export const STALE_UNDATED_MS = 14 * 24 * 3_600_000;
export const dismissKey = (thread_id: string) => `dismiss:${thread_id}`;

export interface FeedMark {
  item_key: string;
  thread_id: string;
  mark: MarkKind;
  by: string | null;
  evidence: Record<string, unknown> | null;
  at: number;
}

export interface FeedItem {
  item_key: string;
  kind: FeedKind;
  status: string;
  /** When the event this item is keyed to happened, ms. */
  at: number;
  green: { mark: MarkKind; by: string | null; evidence: Record<string, unknown> | null; at: number } | null;
}

export interface FeedCard {
  thread_id: string;
  colour: FeedColour;
  lane: FeedLane;
  /** Every need on this thread; the first is the one the card leads with. */
  items: FeedItem[];
  green: boolean;
  at: number;
  /** For the verifier, never shown: the order an item is about. */
  order_id: number | null;
  company_id: number | null;
  company: string | null;
  contact: string | null;
  dates: string[];
  /** The first block that has not started yet (ms), for the 48-hour countdown; null when no time is known. */
  starts_at: number | null;
  crew: number | null;
  venue: string | null;
  r_number: string | null;
  j_number: string | null;
  subject: string;
}

/** One follow-up alert, already narrowed to the fields the TV may show. */
export interface ReplyNeed {
  thread_id: string;
  since_iso: string;
  company: string | null;
  contact: string | null;
  subject: string;
}

export interface FeedCounts {
  needs_created: number;
  needs_updated: number;
  needs_reply: number;
  /** Made by the engine, ticked, or verified in OnSinch, within the last day. */
  done: number;
  /** Undated needs nobody has written about for a fortnight. */
  older: number;
}

export interface Projection {
  cards: FeedCard[];
  counts: FeedCounts;
}

/** Today in London as YYYY-MM-DD. en-CA formats as ISO. */
export function londonDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

function jobDays(s: ConversationState): string[] {
  const days = new Set<string>();
  for (const r of s.facts?.requests ?? []) if (r?.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) days.add(r.date.slice(0, 10));
  for (const t of s.desired_order?.slot_teams ?? []) if (t?.beginning && /^\d{4}-\d{2}-\d{2}/.test(t.beginning)) days.add(t.beginning.slice(0, 10));
  return [...days].sort();
}

/** A London wall-clock time as an instant: the offset is London's on that day, so BST is right. */
export function londonInstant(day: string, hhmm: string): number {
  const guess = Date.parse(`${day}T${hhmm.length === 5 ? hhmm : "00:00"}:00Z`);
  if (!Number.isFinite(guess)) return NaN;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess).map((x) => [x.type, x.value]));
  const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return guess - (wall - guess);
}

/**
 * When the job next starts. The ordered blocks carry real instants; a request's date and
 * start time are London wall-clock. A day with no time counts from its first minute, so
 * the countdown never promises more time than there is.
 */
function nextStart(s: ConversationState, now: number): number | null {
  const at: number[] = [];
  for (const t of s.desired_order?.slot_teams ?? []) { const v = Date.parse(String(t?.beginning ?? "")); if (Number.isFinite(v)) at.push(v); }
  for (const r of s.facts?.requests ?? []) if (r?.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) { const v = londonInstant(r.date.slice(0, 10), r.start_time ?? "00:00"); if (Number.isFinite(v)) at.push(v); }
  const future = at.filter((v) => v >= now).sort((a, b) => a - b);
  return future[0] ?? null;
}

/**
 * The busiest single day, not the sum of every block: a three-day job of eight would
 * otherwise read "24 crew" on the TV, which is nobody's headcount.
 */
function crewOf(s: ConversationState): number | null {
  const teams: DesiredSlotTeam[] = s.desired_order?.slot_teams?.length ? s.desired_order.slot_teams : s.last_ordered_teams ?? [];
  if (!teams.length) return null;
  const perDay = new Map<string, number>();
  for (const t of teams) {
    const d = String(t?.beginning ?? "").slice(0, 10);
    perDay.set(d, (perDay.get(d) ?? 0) + (Number(t?.size) || 0));
  }
  const max = Math.max(...perDay.values());
  return max > 0 ? max : null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstName = (v: unknown) => str(v)?.split(/\s+/)[0] ?? null;
const epochMs = (n: unknown) => { const v = Number(n); return !Number.isFinite(v) || v <= 0 ? 0 : v < 1e12 ? v * 1000 : v; };

/**
 * A thread's one order item, or null: a need while the engine's own predicate says a
 * person is required, otherwise the latest write it made, to be checked.
 *
 * The two are exclusive for the same reason the four labels are: a failure outranks a
 * success (flagBuiltIfNeeded), so a thread that needs a person shows the need and not
 * the order it also holds.
 */
function orderItem(s: ConversationState, lastInbound: number | undefined): Omit<FeedItem, "green"> & { order_id: number | null } | null {
  const order_id = Number(s.onsinch_order_id) > 0 ? Number(s.onsinch_order_id) : null;
  if (cannotBeBooked(s)) {
    const kind: FeedKind = needsLabelFor(s) === "Order Needs Built" ? "needs-created" : "needs-updated";
    /**
     * The client's latest email is part of the key. Without it a tick on "needs updated"
     * would outlive the next change the client sends, and the card for that change would
     * arrive already green.
     */
    return {
      item_key: `${kind}:${s.thread_id}:${order_id ?? 0}:${lastInbound ?? 0}`,
      kind, status: STATUS_TEXT[kind],
      at: lastInbound ?? epochMs(s.last_processed_epoch),
      order_id,
    };
  }
  if (!order_id) return null; // nothing booked to check; a cleared order is not "was created"
  const latest = [...(s.order_action_log ?? [])].reverse().find((a) => a.ok && (a.kind === "create" || CHANGED_A_STANDING_ORDER.has(a.kind)));
  if (!latest) return null;
  const kind: FeedKind = latest.kind === "create" ? "created-check" : "updated-check";
  const oid = Number(latest.order_id) > 0 ? Number(latest.order_id) : order_id;
  return { item_key: `${kind}:${oid}:${latest.ts}`, kind, status: STATUS_TEXT[kind], at: epochMs(latest.ts), order_id: oid };
}

/**
 * The feed at `now`.
 *
 * `lastInbound` is the newest client message per thread (ms). `marks` may hold several
 * rows per item — a tick and a staff edit are separate evidence, and undoing the tick
 * must not erase the edit — and the earliest decides when the item went green.
 */
export function project(
  states: ConversationState[],
  lastInbound: Map<string, number>,
  marks: FeedMark[],
  replies: ReplyNeed[] | null,
  now: number,
): Projection {
  const today = londonDay(now);
  const dismissed = new Set(marks.filter((m) => m.mark === "dismissed").map((m) => m.thread_id));
  const byKey = new Map<string, FeedMark>();
  for (const m of [...marks].sort((a, b) => a.at - b.at)) if (GREEN_MARKS.has(m.mark) && !byKey.has(m.item_key)) byKey.set(m.item_key, m);
  // A tick outranks automatic evidence for what the card SAYS, not for when it went green.
  const ticked = new Map(marks.filter((m) => m.mark === "checked").map((m) => [m.item_key, m]));
  const green = (it: Omit<FeedItem, "green">): FeedItem["green"] => {
    const first = byKey.get(it.item_key);
    if (it.kind === "created-check" || it.kind === "updated-check") {
      const shown = ticked.get(it.item_key) ?? first;
      return shown
        ? { mark: shown.mark, by: shown.by, evidence: shown.evidence, at: it.at }
        : { mark: "made", by: null, evidence: { text: it.kind === "created-check" ? "Order created by the system" : "Order updated by the system" }, at: it.at };
    }
    if (!first) return null;
    const shown = ticked.get(it.item_key) ?? first;
    return { mark: shown.mark, by: shown.by, evidence: shown.evidence, at: first.at };
  };

  const counts: FeedCounts = { needs_created: 0, needs_updated: 0, needs_reply: 0, done: 0, older: 0 };
  const cards = new Map<string, FeedCard>();

  for (const s of states) {
    if (!s?.thread_id || dismissed.has(s.thread_id)) continue;
    /**
     * `not-a-job` is excluded EXCEPT where the engine's own predicate still holds: a client
     * calling a booked job off reads to the model as not-a-job, and cannotBeBooked keeps
     * that thread as a need on purpose (pipeline.ts, verified 2026-10-01). Dropping it here
     * would hide the most dangerous update there is.
     */
    if (s.classification === "not-a-job" && !cannotBeBooked(s)) continue;
    const days = jobDays(s);
    if (days.length && days[days.length - 1] < today) continue; // the job is over

    const it = orderItem(s, lastInbound.get(s.thread_id));
    if (!it) continue;
    const g = green(it);
    if (g && now - g.at > DONE_DWELL_MS) continue;
    if (!g && !days.length && now - it.at > STALE_UNDATED_MS) { counts.older++; continue; }

    if (g) counts.done++;
    else if (it.kind === "needs-created") counts.needs_created++;
    else counts.needs_updated++;

    const { order_id, ...item } = it;
    cards.set(s.thread_id, {
      thread_id: s.thread_id,
      colour: order_id ? "blue" : "red",
      lane: g ? "done" : "need",
      items: [{ ...item, green: g }],
      green: !!g,
      at: it.at,
      order_id,
      company_id: Number(s.company_id) > 0 ? Number(s.company_id) : null,
      company: str(s.facts?.company_name),
      contact: firstName(s.facts?.contact_name),
      dates: days,
      starts_at: nextStart(s, now),
      crew: crewOf(s),
      venue: str(s.facts?.location_text),
      r_number: str(s.onsinch_order_number) ? `R${String(s.onsinch_order_number).replace(/^R/i, "")}` : null,
      j_number: Number(s.onsinch_job_id) > 0 ? `J${s.onsinch_job_id}` : null,
      subject: s.subject ?? "",
    });
  }

  /**
   * A reply is cleared by the follow-up board no longer listing it and by nothing else —
   * a verified order never answers the client. So it carries no mark and no tick.
   */
  for (const r of replies ?? []) {
    if (dismissed.has(r.thread_id)) continue;
    counts.needs_reply++;
    const item: FeedItem = { item_key: `reply:${r.thread_id}:${r.since_iso}`, kind: "needs-reply", status: STATUS_TEXT["needs-reply"], at: Date.parse(r.since_iso) || now, green: null };
    const card = cards.get(r.thread_id);
    if (card) {
      card.items.push(item);
      card.lane = "reply";
      card.green = false;
      continue;
    }
    cards.set(r.thread_id, {
      thread_id: r.thread_id, colour: "neutral", lane: "reply", items: [item], green: false, at: item.at,
      order_id: null, company_id: null, company: r.company, contact: firstName(r.contact),
      dates: [], starts_at: null, crew: null, venue: null, r_number: null, j_number: null, subject: r.subject,
    });
  }

  const LANE: Record<FeedLane, number> = { reply: 0, need: 1, done: 2 };
  const doneAt = (c: FeedCard) => c.items[0].green?.at ?? c.at;
  const ordered = [...cards.values()].sort((a, b) =>
    LANE[a.lane] - LANE[b.lane] ||
    // open work oldest first, the longest wait being the one to act on now; done work
    // newest first, so what just went green sits at the top of the done group
    (a.lane === "done" ? doneAt(b) - doneAt(a) : a.at - b.at));
  return { cards: ordered, counts };
}

