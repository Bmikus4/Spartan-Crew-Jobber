// ============================================================================
// The live feed: what the engine processed that is still waiting on a person.
// ----------------------------------------------------------------------------
// A PROJECTION, and a pure one. Everything on the TV is derived from the engine's decisions
// (v2.ts sources), the stored messages, the feed's own marks and the follow-up board at one
// instant; nothing here is remembered between refreshes except the marks. So the TV can never
// hold an opinion the engine does not. The paused engine's states were a second source until
// 27 Oct (addendum Prompt 12); the projection tests still describe cases that way, through
// test/fixtures/stateSource.ts.
// ============================================================================
import { FOLLOW_UP_MS, londonDay, orderCards, QUIET_MS } from "./order";

export type FeedKind = "needs-created" | "needs-updated" | "created-check" | "updated-check" | "needs-reply";
export type FeedColour = "red" | "blue" | "neutral";
export type FeedLane = "reply" | "need" | "done";
/**
 * AN ORDER THE ENGINE WROTE IS NOT DONE UNTIL SOMEBODY CHECKS IT (Ben, 2026-10-05). Its [DECISIONS V35]
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
 * worked through reads all green rather than empty (Ben, 2026-10-04). [DECISIONS V34]
 */
export const DONE_DWELL_MS = 24 * 3_600_000;
/**
 * A need with no job date and no word from the client in this long leaves the list for
 * the "older" count. Undated, it never passes its own date, and the July and August
 * enquiries on the board on 2026-10-04 were all of this kind.
 */
export const STALE_UNDATED_MS = 14 * 24 * 3_600_000;
/**
 * The TV starts from the day the new system went live (Ben, 2026-10-10: "have it work [DECISIONS V35]
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
  /** Open, and nothing on the job from anyone for FOLLOW_UP_MS: the TV raises "Needs Follow Up". */
  follow_up: boolean;
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
  /** Open jobs with nothing from anyone for FOLLOW_UP_MS. */
  needs_follow_up: number;
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



export { londonDay, QUIET_MS };


/** A London wall-clock time as an instant: the offset is London's on that day, so BST is right. */
export function londonInstant(day: string, hhmm: string): number {
  const guess = Date.parse(`${day}T${hhmm.length === 5 ? hhmm : "00:00"}:00Z`);
  if (!Number.isFinite(guess)) return NaN;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(guess).map((x) => [x.type, x.value]));
  const wall = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return guess - (wall - guess);
}



const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstName = (v: unknown) => str(v)?.split(/\s+/)[0] ?? null;

/** One thread as the TV draws it: the engine's newest decision on it (v2.ts). */
export interface FeedSource {
  thread_id: string;
  days: string[];
  item: (Omit<FeedItem, "green"> & { order_id: number | null }) | null;
  /** The thread's bound order, for a need remembered after the thread stopped yielding it. */
  order_id: number | null;
  /** Older needs on the thread that no later email answered (v2.ts rowsOnCard): items on the same card. */
  also?: FeedSource[];
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



/**
 * The feed at `now`.
 *
 * `lastInbound` is the newest client message per thread (ms). `marks` may hold several
 * rows per item — a tick and a staff edit are separate evidence, and undoing the tick
 * must not erase the edit — and the earliest decides when the item went green.
 */
export function project(
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
  // A card's R and J are its thread's own (the link the planner keeps, v2.ts), never the
  // verifier's find for the screen: 11 of its 83 finds named another order than the evidence
  // finder (10-21), and the R/J-only list (serve.ts) would have listed those as known jobs.
  const green = (it: Omit<FeedItem, "green">): FeedItem["green"] => {
    const first = byKey.get(it.item_key);
    if (!first) return null;
    const shown = ticked.get(it.item_key) ?? first;
    return { mark: shown.mark, by: shown.by, evidence: shown.evidence, at: first.at };
  };

  const counts: FeedCounts = { needs_created: 0, needs_updated: 0, needs_reply: 0, to_check: 0, needs_follow_up: 0, done: 0, older: 0 };
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

  // A later source for a thread replaces an earlier one.
  const sources = new Map<string, FeedSource>();
  for (const v of v2) sources.set(v.thread_id, v);

  /**
   * Activity on the same job counts wherever it happened: a client who replies on a new
   * thread about the same order has answered, and the old thread must not raise a follow-up.
   * The job is its order, by id or by R number.
   */
  const activityOf = (s: FeedSource) => Math.max(lastInbound.get(s.thread_id) ?? 0, lastOutbound.get(s.thread_id) ?? 0, s.last_write, actedAt.get(s.thread_id) ?? 0);
  const jobKey = (s: FeedSource) => (s.order_id ? `o${s.order_id}` : s.r_number ? `r${s.r_number}` : null);
  const jobActivity = new Map<string, number>();
  for (const s of sources.values()) {
    const k = jobKey(s);
    if (k) jobActivity.set(k, Math.max(jobActivity.get(k) ?? 0, activityOf(s)));
  }

  for (const source of sources.values()) {
    if (dismissed.has(source.thread_id)) continue;
    // EVERY NEED THE THREAD STILL HOLDS IS AN ITEM ON ITS CARD (addendum F2, 10-23): the source's
    // own, and each older need no later email answered (v2.ts rowsOnCard). Each is filtered on its
    // own below, so our reply clears a Needs Reply and leaves a booking beside it standing.
    const carried = new Set((source.also ?? []).map((a) => a.item?.item_key));
    const entries: Array<{ s: FeedSource; it: NonNullable<FeedSource["item"]>; g: FeedItem["green"] }> = [];
    for (const s of [source, ...(source.also ?? [])]) {
      const days = s.days;
      if (days.length && days[days.length - 1] < today) continue; // the job is over

      let it = s.item;
      /**
       * A need the TV showed, which the thread no longer yields, resolved without an engine
       * write. So does one whose thread now yields only a write OLDER than the need: that is
       * the order the need was about, not an answer to it.
       */
      const was = s === source ? lastOpen.get(s.thread_id) : undefined;
      if (was && !carried.has(was.item_key) && (!it || ((it.kind === "created-check" || it.kind === "updated-check") && it.at < was.at))) {
        if (!byKey.has(was.item_key)) {
          // Shown once stored: serveFeed writes this and projects again, so its time is the first sighting.
          remember.push({ item_key: was.item_key, thread_id: s.thread_id, mark: "resolved", by: null, evidence: { text: s.resolvedText } });
          continue;
        }
        const kind = was.item_key.split(":")[0] as FeedKind;
        it = { item_key: was.item_key, kind, status: STATUS_TEXT[kind], at: was.at, order_id: s.order_id };
      }
      if (!it || it.at < from) continue;
      // A question, a quote or a missing detail is answered by writing back: once an email of
      // ours is on the thread after it, it is done (a draft is not an email: only sent mail is
      // in lastOutbound). Our email answers that and nothing else on the card.
      if (it.kind === "needs-reply" && (lastOutbound.get(s.thread_id) ?? 0) >= it.at) continue;
      const g = green(it);
      if (g && now - g.at > DONE_DWELL_MS) continue;
      if (!g && !days.length && now - it.at > STALE_UNDATED_MS) { counts.older++; continue; }
      entries.push({ s, it, g });
    }
    // An open need leads the card: the source's own when it is one, else the newest carried one.
    const openNeed = (e: (typeof entries)[number]) => !e.g && (e.it.kind === "needs-created" || e.it.kind === "needs-updated");
    const lead = entries.find(openNeed) ?? entries.find((e) => !e.g) ?? entries[0];
    if (!lead) continue;
    const { s, it, g } = lead;
    const days = s.days;

    if (g) counts.done++;
    else if (it.kind === "needs-created") counts.needs_created++;
    else if (it.kind === "needs-updated") counts.needs_updated++;
    else if (it.kind === "needs-reply") counts.needs_reply++;
    else counts.to_check++;

    const { order_id, ...item } = it;
    const r_number = s.r_number;
    const j_number = s.j_number;
    /**
     * A JOB HAS NO TIMER (Ben, 2026-10-06). Once an order exists in OnSinch the reply clock is [DECISIONS V34]
     * gone, and with it the clock's pull to the top of the list; it counts only for an enquiry
     * nobody has booked yet.
     */
    const isJob = !!(order_id || r_number || j_number);
    /**
     * QUIET RESETS ON ANY UPDATE (Ben, 2026-10-06): the client's email, ours, an engine write, [DECISIONS V34]
     * or a person's tick or edit. Measured from the client alone, a job the engine updated
     * yesterday sank under "quiet" because the client had last written a week ago.
     */
    const k = jobKey(s);
    const lastActivity = Math.max(activityOf(s), k ? jobActivity.get(k) ?? 0 : 0) || it.at;
    const followUp = !g && now - lastActivity > FOLLOW_UP_MS;
    if (followUp) counts.needs_follow_up++;
    cards.set(s.thread_id, {
      thread_id: s.thread_id,
      // The legend's colour is the NEED, not whether an order is bound (Ben, 2026-10-04): an [DECISIONS V34]
      // update the engine never bound read "Order needs updated" in red, against the key.
      colour: item.kind === "needs-reply" ? "neutral" : item.kind === "needs-created" || item.kind === "created-check" ? "red" : "blue",
      lane: g ? "done" : item.kind === "needs-reply" ? "reply" : "need",
      items: [lead, ...entries.filter((e) => e !== lead)].map((e) => { const { order_id: _o, ...rest } = e.it; return { ...rest, green: e.g }; }),
      green: entries.every((e) => !!e.g),
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
      follow_up: followUp,
      note: s.note,
    });
    if (!g) wants.set(s.thread_id, s.want);
    // Needs only: a check's key is its write, and a remembered check would read as resolved
    // on the next refresh, the write being older than the moment it was first seen.
    for (const e of entries.filter(openNeed)) {
      if (!openKeys.has(e.it.item_key)) remember.push({ item_key: e.it.item_key, thread_id: s.thread_id, mark: "open", by: null, evidence: null });
    }
  }

  /**
   * A reply is cleared by the follow-up board no longer listing it and by nothing else —
   * a verified order never answers the client. So it carries no mark and no tick.
   */
  for (const r of replies ?? []) {
    if (dismissed.has(r.thread_id)) continue;
    const card = cards.get(r.thread_id);
    if (card?.items.some((i) => i.kind === "needs-reply")) continue; // the rebuild already asks for this reply
    counts.needs_reply++;
    const item: FeedItem = { item_key: `reply:${r.thread_id}:${r.since_iso}`, kind: "needs-reply", status: STATUS_TEXT["needs-reply"], at: Date.parse(r.since_iso) || now, green: null };
    if (card) {
      card.items.push(item);
      card.lane = "reply";
      card.green = false;
      continue;
    }
    cards.set(r.thread_id, {
      thread_id: r.thread_id, colour: "neutral", lane: "reply", items: [item], green: false, at: item.at,
      order_id: null, company_id: null, company: r.company, contact: firstName(r.contact),
      dates: [], starts_at: null, awaiting_reply_since: item.at, crew: null, venue: null, r_number: null, j_number: null, subject: r.subject, quiet: false, follow_up: false, note: null,
    });
  }

  return { cards: orderCards([...cards.values()], now), counts, wants, remember };
}


