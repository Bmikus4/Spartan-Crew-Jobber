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
import { rNumbersIn } from "../engine/resolve";
import { PLACEHOLDER_PLACE_IDS } from "../engine/resolver";
import { londonDay, orderCards, QUIET_MS } from "./order";

export type FeedKind = "needs-created" | "needs-updated" | "created-check" | "updated-check" | "needs-reply";
export type FeedColour = "red" | "blue" | "neutral";
export type FeedLane = "reply" | "need" | "done";
/**
 * AN ORDER THE ENGINE WROTE IS NOT DONE UNTIL SOMEBODY CHECKS IT (Ben, 2026-10-05). Its
 * card reads "Order was created/updated, check to verify" and stays open until a person
 * confirms it or the verifier finds a staff edit made after the write. From 2026-10-04 to
 * 10-05 such writes went green the moment they were made, and on 10-06 one green card named
 * an order (R11361) that staff had already deleted and rebooked by hand. The sweep's
 * "holds" can never close one: straight after a write OnSinch always matches what the
 * engine wrote (verify.ts).
 *
 * `stamps`, `matched` and `dismissed` are stored and are NOT green: `stamps` records that the
 * verifier has read an item's past once; `matched` carries the order it found for an
 * update the engine never bound; `dismissed` takes a whole thread off the TV. Rows marked
 * `history` (the stamps read before 2026-10-04) are still in the table and read by nothing.
 *
 * `open` and `resolved` are the feed's memory of a need, because the state alone forgets
 * it: once the engine stops needing a person without writing anything (it reclassified the
 * thread, or linked it to an order) the projection has nothing left to draw. `open` (not
 * green) records that a need key was on the TV; `resolved` (green) records when its thread
 * stopped yielding it. Without them the card vanished mid-list, which on a full screen
 * reads as a job lost, not a job done.
 */
export type MarkKind = "checked" | "staff-edit" | "order-found" | "stamps" | "matched" | "dismissed" | "open" | "resolved";
const GREEN_MARKS = new Set<MarkKind>(["checked", "staff-edit", "order-found", "resolved"]);

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
/**
 * The TV starts from the day the new system went live (Ben, 2026-10-10: "have it work
 * starting from today"). Anything whose email or write is older belongs to the paused
 * engine or to shadow mode, and ops have dealt with it in the mailbox.
 */
export const FEED_FROM = Date.parse("2026-10-10T00:00:00+01:00");
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
  /** The client's latest email when nothing of ours has gone out since (ms): how long they have waited. */
  awaiting_reply_since: number | null;
  crew: number | null;
  venue: string | null;
  r_number: string | null;
  j_number: string | null;
  subject: string;
  /** Open, with nothing done on it by anyone for QUIET_MS: listed below the fresh ones. */
  quiet: boolean;
  /** What the system says about this item: why it needs a person, or what it did. Null for the paused engine's. */
  note: string | null;
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
  /** Orders the engine wrote that nobody has checked yet. */
  to_check: number;
  /** Ticked, or verified in OnSinch, within the last day. */
  done: number;
  /** Undated needs nobody has written about for a fortnight. */
  older: number;
}

export interface Projection {
  cards: FeedCard[];
  counts: FeedCounts;
  /** Per thread, what the verifier looks for in OnSinch. Never served: it holds the client's address. */
  wants: Map<string, FeedWant>;
  /** `open` and `resolved` marks for serveFeed to store; the projection itself writes nothing. */
  remember: Array<Omit<FeedMark, "at">>;
}

/** What a thread asks for, in the terms an OnSinch order can be compared on. */
export interface FeedWant {
  /** R numbers (digits only) and client references ("EAV6695") the thread names. */
  r_numbers: string[];
  refs: string[];
  /** The resolved venue; null when it is one of the engine's placeholders, which name no building. */
  place_id: number | null;
  /** Every block the engine wants, as instants, with its venue when it names a real one. */
  shifts: Array<{ b: number; e: number; p: number | null }>;
  sender: string | null;
}

/** "EAV6695", "HP1263": a client's own job reference. Postcodes ("SE9") are too short to match. */
const REF = /\b[A-Z]{2,5}-?\d{3,6}\b/g;

function wantOf(s: ConversationState): FeedWant {
  const subject = s.subject ?? "";
  const r_numbers = rNumbersIn(subject);
  const refs = new Set<string>();
  const cref = str((s.facts as { customer_reference?: unknown } | undefined)?.customer_reference);
  if (cref) refs.add(cref);
  for (const m of subject.matchAll(REF)) if (!/^R-?\d+$/i.test(m[0])) refs.add(m[0]);
  const teams: DesiredSlotTeam[] = s.desired_order?.slot_teams?.length ? s.desired_order.slot_teams : s.last_ordered_teams ?? [];
  const real = (v: unknown) => { const n = Number(v); return n > 0 && !PLACEHOLDER_PLACE_IDS.has(n) ? n : null; };
  const shifts = teams
    .map((t) => ({ b: Date.parse(String(t?.beginning ?? "")), e: Date.parse(String(t?.end ?? "")), p: real((t as { place_id?: unknown })?.place_id) }))
    .filter((x) => Number.isFinite(x.b) && Number.isFinite(x.e));
  return { r_numbers, refs: [...refs], place_id: real(s.place_id), shifts, sender: str(s.sender_email) };
}

export { londonDay, QUIET_MS };

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
 * One thread as the TV draws it, from either engine: the paused engine's state
 * (stateSource) or the rebuild's newest decision (v2.ts). The card, the green rules, the
 * memory and the verifier's wants are the same for both, so the TV reads one way.
 */
export interface FeedSource {
  thread_id: string;
  days: string[];
  item: (Omit<FeedItem, "green"> & { order_id: number | null }) | null;
  /** The thread's bound order, for a need remembered after the thread stopped yielding it. */
  order_id: number | null;
  r_number: string | null;
  j_number: string | null;
  company_id: number | null;
  company: string | null;
  contact: string | null;
  venue: string | null;
  subject: string;
  crew: number | null;
  starts_at: number | null;
  /** The newest write made on the thread (ms), 0 for none. */
  last_write: number;
  want: FeedWant;
  note: string | null;
  resolvedText: string;
}

function stateSource(s: ConversationState, lastInbound: Map<string, number>, now: number): FeedSource {
  return {
    thread_id: s.thread_id,
    days: jobDays(s),
    /**
     * `not-a-job` yields nothing EXCEPT where the engine's own predicate still holds: a client
     * calling a booked job off reads to the model as not-a-job, and cannotBeBooked keeps
     * that thread as a need on purpose (pipeline.ts, verified 2026-10-01). Dropping it here
     * would hide the most dangerous update there is.
     */
    item: s.classification === "not-a-job" && !cannotBeBooked(s) ? null : orderItem(s, lastInbound.get(s.thread_id)),
    order_id: Number(s.onsinch_order_id) > 0 ? Number(s.onsinch_order_id) : null,
    r_number: str(s.onsinch_order_number) ? `R${String(s.onsinch_order_number).replace(/^R/i, "")}` : null,
    j_number: Number(s.onsinch_job_id) > 0 ? `J${s.onsinch_job_id}` : null,
    company_id: Number(s.company_id) > 0 ? Number(s.company_id) : null,
    company: str(s.facts?.company_name),
    contact: firstName(s.facts?.contact_name),
    venue: str(s.facts?.location_text),
    subject: s.subject ?? "",
    crew: crewOf(s),
    starts_at: nextStart(s, now),
    last_write: Math.max(0, ...(s.order_action_log ?? []).filter((a) => a.ok).map((a) => epochMs(a.ts))),
    want: wantOf(s),
    note: null,
    resolvedText: resolvedText(s),
  };
}

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
  lastOutbound: Map<string, number> = new Map(),
  v2: FeedSource[] = [],
  from = 0,
): Projection {
  const today = londonDay(now);
  const dismissed = new Set(marks.filter((m) => m.mark === "dismissed").map((m) => m.thread_id));
  const byKey = new Map<string, FeedMark>();
  for (const m of [...marks].sort((a, b) => a.at - b.at)) if (GREEN_MARKS.has(m.mark) && !byKey.has(m.item_key)) byKey.set(m.item_key, m);
  // A tick outranks automatic evidence for what the card SAYS, not for when it went green.
  const ticked = new Map(marks.filter((m) => m.mark === "checked").map((m) => [m.item_key, m]));
  /**
   * The numbers of an order the verifier found for a thread the engine never bound, for the
   * screen only: order_id stays null, because binding is the engine's and the TV never does it.
   */
  const foundNo = new Map<string, { r: string | null; j: string | null }>();
  for (const m of marks) {
    const e = m.evidence as { r_number?: unknown; j_number?: unknown } | null;
    if ((m.mark === "matched" || m.mark === "order-found") && str(e?.r_number)) {
      foundNo.set(m.item_key, { r: `R${String(e!.r_number).replace(/^R/i, "")}`, j: str(e?.j_number) });
    }
  }
  const green = (it: Omit<FeedItem, "green">): FeedItem["green"] => {
    const first = byKey.get(it.item_key);
    if (!first) return null;
    const shown = ticked.get(it.item_key) ?? first;
    return { mark: shown.mark, by: shown.by, evidence: shown.evidence, at: first.at };
  };

  const counts: FeedCounts = { needs_created: 0, needs_updated: 0, needs_reply: 0, to_check: 0, done: 0, older: 0 };
  const awaiting = (thread: string): number | null => {
    const inAt = lastInbound.get(thread);
    if (!inAt) return null;
    const outAt = lastOutbound.get(thread);
    return outAt && outAt >= inAt ? null : inAt;
  };
  // The latest thing a person or the engine did on each thread, from the marks: a tick, or a
  // staff edit at the moment it was made rather than the moment the verifier noticed it.
  const actedAt = new Map<string, number>();
  for (const m of marks) {
    if (!GREEN_MARKS.has(m.mark)) continue;
    const t = Date.parse(String((m.evidence as { at?: unknown } | null)?.at ?? "")) || m.at;
    if (t > (actedAt.get(m.thread_id) ?? 0)) actedAt.set(m.thread_id, t);
  }
  const cards = new Map<string, FeedCard>();
  const wants = new Map<string, FeedWant>();
  const remember: Projection["remember"] = [];
  // The newest need each thread showed on the TV, and every need key already remembered.
  const lastOpen = new Map<string, FeedMark>();
  const openKeys = new Set<string>();
  for (const m of marks) {
    if (m.mark !== "open" || !/^needs-/.test(m.item_key)) continue;
    openKeys.add(m.item_key);
    if (m.at >= (lastOpen.get(m.thread_id)?.at ?? -Infinity)) lastOpen.set(m.thread_id, m);
  }

  // The rebuild's decision on a thread replaces the paused engine's state for it: the state
  // stopped moving when the engine was paused, and the decision is about a newer email.
  const sources = new Map<string, FeedSource>();
  for (const s of states) if (s?.thread_id) sources.set(s.thread_id, stateSource(s, lastInbound, now));
  for (const v of v2) sources.set(v.thread_id, v);

  for (const s of sources.values()) {
    if (dismissed.has(s.thread_id)) continue;
    const days = s.days;
    if (days.length && days[days.length - 1] < today) continue; // the job is over

    let it = s.item;
    /**
     * A need the TV showed, which the thread no longer yields, resolved without an engine
     * write. So does one whose thread now yields only a write OLDER than the need: that is
     * the order the need was about, not an answer to it.
     */
    const was = lastOpen.get(s.thread_id);
    if (was && (!it || ((it.kind === "created-check" || it.kind === "updated-check") && it.at < was.at))) {
      if (!byKey.has(was.item_key)) {
        // Shown once stored: serveFeed writes this and projects again, so its time is the first sighting.
        remember.push({ item_key: was.item_key, thread_id: s.thread_id, mark: "resolved", by: null, evidence: { text: s.resolvedText } });
        continue;
      }
      const kind = was.item_key.split(":")[0] as FeedKind;
      it = { item_key: was.item_key, kind, status: STATUS_TEXT[kind], at: was.at, order_id: s.order_id };
    }
    if (!it || it.at < from) continue;
    const g = green(it);
    if (g && now - g.at > DONE_DWELL_MS) continue;
    if (!g && !days.length && now - it.at > STALE_UNDATED_MS) { counts.older++; continue; }

    if (g) counts.done++;
    else if (it.kind === "needs-created") counts.needs_created++;
    else if (it.kind === "needs-updated") counts.needs_updated++;
    else counts.to_check++;

    const { order_id, ...item } = it;
    const r_number = s.r_number ?? foundNo.get(it.item_key)?.r ?? null;
    const j_number = s.j_number ?? (order_id ? null : foundNo.get(it.item_key)?.j ?? null);
    /**
     * A JOB HAS NO TIMER (Ben, 2026-10-06). Once an order exists in OnSinch the reply clock is
     * gone, and with it the clock's pull to the top of the list; it counts only for an enquiry
     * nobody has booked yet.
     */
    const isJob = !!(order_id || r_number || j_number);
    /**
     * QUIET RESETS ON ANY UPDATE (Ben, 2026-10-06): the client's email, ours, an engine write,
     * or a person's tick or edit. Measured from the client alone, a job the engine updated
     * yesterday sank under "quiet" because the client had last written a week ago.
     */
    const lastActivity = Math.max(lastInbound.get(s.thread_id) ?? 0, lastOutbound.get(s.thread_id) ?? 0, s.last_write, actedAt.get(s.thread_id) ?? 0) || it.at;
    cards.set(s.thread_id, {
      thread_id: s.thread_id,
      // The legend's colour is the NEED, not whether an order is bound (Ben, 2026-10-04): an
      // update the engine never bound read "Order needs updated" in red, against the key.
      colour: item.kind === "needs-created" || item.kind === "created-check" ? "red" : "blue",
      lane: g ? "done" : "need",
      items: [{ ...item, green: g }],
      green: !!g,
      at: it.at,
      order_id,
      company_id: s.company_id,
      company: s.company,
      contact: s.contact,
      dates: days,
      starts_at: s.starts_at,
      awaiting_reply_since: isJob ? null : awaiting(s.thread_id),
      crew: s.crew,
      venue: s.venue,
      r_number,
      j_number,
      subject: s.subject,
      quiet: !g && now - lastActivity > QUIET_MS,
      note: s.note,
    });
    if (!g) wants.set(s.thread_id, s.want);
    // Needs only: a check's key is its write, and a remembered check would read as resolved
    // on the next refresh, the write being older than the moment it was first seen.
    if (!g && (it.kind === "needs-created" || it.kind === "needs-updated") && !openKeys.has(it.item_key)) {
      remember.push({ item_key: it.item_key, thread_id: s.thread_id, mark: "open", by: null, evidence: null });
    }
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
      dates: [], starts_at: null, awaiting_reply_since: item.at, crew: null, venue: null, r_number: null, j_number: null, subject: r.subject, quiet: false, note: null,
    });
  }

  return { cards: orderCards([...cards.values()], now), counts, wants, remember };
}

/** What the resolved card says happened. The engine wrote nothing, so this reads its state. */
function resolvedText(s: ConversationState): string {
  if (s.classification === "not-a-job") return "Read as not a job by the system";
  if (Number(s.onsinch_order_id) > 0) return "Linked to an order by the system";
  return "No order needed any more, per the system";
}

