// ============================================================================
// Is this need done? The one answer (ADDENDUM §13.2 change 1; DECISIONS O14).
// ----------------------------------------------------------------------------
// Staff's OnSinch work after the client's email counts only on the need's own job. Clearing on any of the
// client's orders that day would have cleared 18 of 109 dated needs on another job (§13, 30 Oct), so the job is
// found by the first rung that yields one, absolute evidence first:
//   1. an order the thread names absolutely (links.ts gradeLinks): an R, J or PO OnSinch holds, or the bot's own;
//   2. a guessed link to the sender's company's order, only when that order holds a day the need names, at its
//      venue when it names one (a need with no day has no day to disagree);
//   3. the client's orders holding the need's day at the need's venue;
//   4. the client's orders holding the need's day;
//   5. for a new booking with no day, the client's orders staff made after the email.
// A new booking the order already held on every day it names, before the email, is done too: on 29 Oct a client
// confirmed shifts staff had booked a week before. Two or more candidate jobs with nothing absolute between them is never done: "Possibly done in R1 or R2".
// The work must fit the ask, and a deleted order (truth.ts refreshOrders) never counts: a create then a delete
// is no booking. A booking on an order still provisional or in Price Quotes is not done until staff confirm it (the
// owner, 2 Nov): the card stays as "possibly", saying so, and leaves the TV while Spartan's quote waits on the client.
// A need not done may be agreed instead (the owner, 1 Nov: "a potential decision ... which is resolved"): the client
// accepted Spartan's quote or terms and OnSinch holds them unchanged (agreedOn); an agreed need leaves the TV. Pure: the caller passes the stored rows and the thread, nothing here reads a database,
// OnSinch or the clock.
// ============================================================================
import { utcToLondon } from "../v2/bot/ops";
import { confirms } from "../v2/interpret/interpret";
import { datesIn } from "../v2/interpret/ground";

/** The bot's OnSinch user: its own writes are never a person's work. */
export const BOT = 2257;

export type Ask = "book" | "change" | "cancel" | "any";
/**
 * `fresh`: the need is a new booking (needs-created), not a change to an order the client already has. `readPlaces`: the
 * places the reading matched to the client's venues, a tie-break between candidate orders and never a filter: one
 * reading's place was the unused duplicate 7083 where staff booked the client's own 205 (1 Nov).
 */
export type Need = { at: number; asks: Ask[]; fresh: boolean; days: string[]; places: number[]; venues: string[]; company_id: number | null; readPlaces?: number[]; companies?: number[]; quote?: boolean };
/** A thread's link to an order; `ref` is what named it, so one PO held by two orders is told from two POs. */
export type Link = { order_id: number; absolute: boolean; ref: string };
export type Order = { order_id: number; number: string | null; company_id: number | null; body: any; deleted: boolean };
export type Row = { id: number; action: string; creator: number | null; created: string; model: string | null; model_id: string | null; order_id: number | null; data: any };
/** `provisional`: staff's work was found, on an order still provisional or in Price Quotes (pending): not done yet. */
export type Verdict = { state: "done" | "possibly" | "open" | "agreed"; orders: number[]; rung: string; text: string; at: string | null; creator: number | null; provisional?: boolean };
/**
 * A message on the need's thread: its newest words, whose, when, and whether a client's own words asked for work.
 * `books`: the reader took the client's email as a booking, which after a quote is the client going ahead in words no
 * phrase reads ("we would like to go ahead" read as booking 9 of the 14 times the phrases missed a yes, 2 Nov).
 */
export type ThreadMsg = { at: number; ours: boolean; text: string; asks: boolean; changes?: boolean; books?: boolean };

type Shift = { slot: string; team: string; day: string; place: number | null; cancelled: boolean };

/** Every shift with a start, cancelled ones too: a cancelled shift still says which job a need was about. */
export function shiftsOf(body: any): Shift[] {
  const out: Shift[] = [];
  for (const j of [].concat(body?.Job ?? []) as any[]) for (const t of [].concat(j?.SlotTeam ?? []) as any[]) for (const s of [].concat(t?.Slot ?? []) as any[]) {
    if (!s?.beginning) continue;
    const loc = Array.isArray(s.SlotLocation) ? s.SlotLocation[0] : s.SlotLocation;
    out.push({ slot: String(s.id), team: String(t.id), day: utcToLondon(String(s.beginning)).date, place: Number(loc?.place_id) > 0 ? Number(loc.place_id) : null,
      cancelled: s.cancelled === true || Number(s.cancelled) > 0 || t.cancelled === true || Number(t.cancelled) > 0 });
  }
  return out;
}

const T = (s: string) => Date.parse(s) || 0;
const label = (o: Order) => (o.number ? `R${o.number}` : `order ${o.order_id}`);
const atPlace = (s: Shift, places: number[]) => !places.length || (s.place != null && places.includes(s.place));
const holdsDay = (o: Order, need: Need, places: number[]) => shiftsOf(o.body).some((s) => need.days.includes(s.day) && atPlace(s, places));
const MADE = new Set(["order_create", "order_create_by_copy", "order_created_via_api"]);
const madeAfter = (o: Order, rows: Row[], need: Need, within = Infinity) => rows.some((r) => r.order_id === o.order_id && MADE.has(r.action) && r.creator != null && Number(r.creator) !== BOT && T(r.created) > need.at && T(r.created) <= need.at + within);
/** An undated booking's order is one staff made within this of the email: 96 hours, the window the same-day study used. */
const UNDATED_WINDOW_MS = 96 * 3600e3;
const confirmsByEdit = (r: Row) => { const p = r.data?.diffChanges?.Order?.provisional; return !!p && Number(p.old) === 1 && Number(p.new) === 0; };
/**
 * An order still provisional or in Price Quotes holds what Spartan offered, not a booking: staff make it when they
 * quote and confirm it after the client's yes. Counting the made order as the booking hid the yes: of 132 clients'
 * first yes after a quote (30 Jul-2 Nov, outcome analysis), 117 were followed by staff confirming or editing the
 * order, and a card showed for the whole wait in 30; 15 waited over 4 h with nothing on the TV.
 */
const pending = (o: Order) => !!(o.body?.provisional || o.body?.quote);

/** A row as staff's work: what it did, and which asks it answers. Null when it is not booking work. */
function workOf(r: Row, o: Order, need: Need): { what: string; fits: Ask[] } | null {
  if (r.creator == null || Number(r.creator) === BOT || T(r.created) <= need.at) return null;
  const d = r.data ?? {};
  const days = new Set(shiftsOf(o.body).filter((s) => s.slot === String(r.model_id) || s.team === String(r.model_id)).map((s) => s.day));
  for (const f of ["beginning", "end"]) for (const v of [d.diffChanges?.Slot?.[f]?.old, d.diffChanges?.Slot?.[f]?.new]) if (v) days.add(utcToLondon(String(v)).date);
  // A part is on the need's day, or its day cannot be known (a deleted part, an undated need).
  const onDay = !need.days.length || !days.size || [...days].some((x) => need.days.includes(x));
  if (MADE.has(r.action)) return { what: "made the order", fits: ["book", "any"] };
  // OnSinch marks staff's own order cancels "automated" (175 of 207 to 31 Oct, by 11 people): the creator is the test.
  if (r.action === "order_cancel") return { what: "cancelled the order", fits: ["cancel", "any"] };
  if (r.action === "order_confirm_provisional") return { what: "confirmed the order", fits: ["book", "any"] };
  // Staff also confirm by editing the flag (64 times since 1 Sep, 6 people, beside 472 confirm rows).
  if (r.action === "common_change" && confirmsByEdit(r)) return { what: "confirmed the order", fits: ["book", "any"] };
  if (r.action === "common_create" && (d.model === "SlotTeam" || d.model === "Slot") && onDay) return { what: d.model === "Slot" ? "added crew" : "added a shift", fits: ["book", "change", "any"] };
  if (r.action === "common_delete" && /^(Slot|SlotTeam|Job)$/.test(String(d.data?.model ?? "")) && onDay) return { what: "removed a shift", fits: ["cancel", "change", "any"] };
  if (r.action === "common_change") {
    const f = Object.entries(d.diffChanges ?? {}).flatMap(([m, x]) => Object.keys(x as object).map((k) => `${m}.${k}`));
    if (f.includes("Slot.cancelled") && onDay) return { what: "cancelled a shift", fits: ["cancel", "any"] };
    if (f.some((x) => /^Slot\.(size|beginning|end|profession_id)$/.test(x)) && onDay) return { what: f.includes("Slot.size") ? "changed the crew" : "changed the times", fits: ["change", "any"] };
    if (f.some((x) => /^Order\.(intern_name|name)$/.test(x))) return { what: "changed the order's details", fits: ["any"] };
  }
  return null;
}

/**
 * Every ask has staff work that fits it on this order after the email (with the latest such row), or a new booking was
 * on it already. `provisional`: the booking is on an order still provisional or in Price Quotes, which is not done until
 * staff confirm it (pending).
 */
function doneOn(o: Order, rows: Row[], need: Need, places: number[]): { what: string[]; last: Row | null; provisional: boolean } | null {
  const mine = rows.filter((r) => r.order_id === o.order_id);
  const active = shiftsOf(o.body).filter((s) => !s.cancelled);
  const undone = (r: Row) => r.action === "order_cancel" && mine.some((u) => u.action === "order_uncancel" && T(u.created) > T(r.created));
  const work = mine.filter((r) => !undone(r)).map((r) => ({ r, w: workOf(r, o, need) })).filter((x): x is { r: Row; w: NonNullable<ReturnType<typeof workOf>> } => !!x.w);
  const confirmed = work.some((x) => x.w.what === "confirmed the order");
  const asks = need.asks.length ? need.asks : (["any"] as Ask[]);
  const provisional = pending(o) && !confirmed && asks.includes("book");
  if (need.fresh && need.days.length && !madeAfter(o, rows, need) && need.days.every((d) => active.some((s) => s.day === d && atPlace(s, places)))) return { what: ["booked it before the email"], last: null, provisional };
  const cancelled = work.find((x) => x.r.action === "order_cancel");
  if (cancelled) return { what: ["cancelled the order"], last: cancelled.r, provisional: false };
  if (!work.length || !asks.every((a) => work.some((x) => x.w.fits.includes(a)))) return null;
  const last = work.reduce((a, b) => (T(b.r.created) > T(a.r.created) ? b : a)).r;
  return { what: [...new Set(work.map((x) => x.w.what))], last, provisional };
}

/** The need's candidate jobs: groups that must each come to one order, from the first rung that yields any. */
function candidates(need: Need, links: Link[], orders: Map<number, Order>, rows: Row[], places: number[]): { rung: string; groups: Order[][] } {
  const live = (id: number) => { const o = orders.get(id); return o && !o.deleted ? o : null; };
  const client = need.company_id ? [...orders.values()].filter((o) => !o.deleted && o.company_id === need.company_id) : [];
  const abs = links.filter((l) => l.absolute && live(l.order_id));
  if (abs.length) {
    const byRef = new Map<string, Order[]>();
    for (const l of abs) byRef.set(l.ref, [...(byRef.get(l.ref) ?? []), live(l.order_id)!]);
    // The need's day picks among the orders one reference names, and among the references: a thread naming this
    // job and an older one (31 Oct: a J and a PO a week apart) is about the one holding the day.
    const all = [...byRef.values()].map((g) => (need.days.length ? g.filter((o) => holdsDay(o, need, [])) : g));
    const groups = all.some((g) => g.length) ? all.filter((g) => g.length) : [...byRef.values()];
    return { rung: "named by the thread", groups };
  }
  // A guess on another company's order than the sender's is no candidate (31 Oct: R11871 would have cleared a need).
  // A guessed link to an order with nothing on or after the email's day is an old job on a reused thread, not this need's
  // (1 Nov: a client booked Monday on an October thread; the October order held the link and hid the new one).
  const sentDay = utcToLondon(new Date(need.at).toISOString()).date;
  const guessed = links.filter((l) => !l.absolute).map((l) => live(l.order_id))
    .filter((o): o is Order => !!o && (!need.days.length || holdsDay(o, need, places)) && (!need.company_id || o.company_id === need.company_id)
      && shiftsOf(o.body).some((s) => s.day >= sentDay));
  if (guessed.length) return { rung: need.days.length ? "the thread's link, on the need's day" : "the thread's link", groups: [guessed] };
  if (!need.days.length) {
    const made = need.fresh ? client.filter((o) => madeAfter(o, rows, need, UNDATED_WINDOW_MS)) : [];
    return made.length ? { rung: "the client's order made after the email", groups: [made] } : { rung: "", groups: [] };
  }
  if (places.length) {
    const atVenue = client.filter((o) => holdsDay(o, need, places));
    if (atVenue.length) return { rung: "the need's venue and day", groups: [atVenue] };
  }
  const onDay = client.filter((o) => holdsDay(o, need, []));
  return onDay.length ? { rung: onDay.length === 1 ? "the client's only order that day" : "the client's orders that day", groups: [onDay] } : { rung: "", groups: [] };
}

// ---- agreed: the client accepted Spartan's quote or terms, and OnSinch holds them ---------------------------------
// Spartan's own wording (its staff's templates), measured on its 1,308 replies 9 Oct-1 Nov: 247 hand a quote over, 47
// set terms. A quote is the order as it stood: of 189 quotes on a thread linked to an order, staff had made or edited
// its shifts before 188 of them (144 within the hour), so the order at the quote's moment is what the client was
// offered. A quote promised ("we'll send over an updated quote on Monday") is none: the words must hand one over.
// "Please see your quotes attached" is one too (2 Nov: a quote request's card stayed 17 days in the provisional replay).
const QUOTE = /\b(?:attached|please (?:find|see)|(?:see|find) (?:the )?attached|here(?:'s| is))\b[^.\n]{0,40}\b(?:quotes?|quotations?|proforma)\b|\b(?:quotes?|quotations?|proforma)\b[^.\n]{0,25}\battached\b/i;
/**
 * The client's yes, beyond confirms(): a PO sent after the quote ("Revised PO attached"), which is how this business
 * confirms ("no products or services are reserved until the booking is confirmed with a Purchase Order", Spartan's own
 * footer). And Spartan acknowledging the client's yes ("Thanks for paying the invoice", "thank you for the PO", "it is
 * now confirmed"), which stands for a yes the client gave in words that are not a phrase, or by paying. On 1 Nov one
 * need stayed after "Revised PO attached", another after "Thanks for paying the invoice".
 */
const PO_SENT = /\b(?:(?:revised|new|updated|amended)\s+)?(?:po|p\.o\.|purchase order)(?:\s+(?:number|no\.?))?\s+(?:is\s+)?(?:attached|enclosed)\b|\b(?:attached|enclosed|please find|see)\b[^.\n]{0,30}\b(?:po|purchase order)\b/i;
const ACK = /\bthank(?:s| you)\s+(?:very much\s+|so much\s+)?for\s+(?:paying|the payment|confirming|your confirmation|the (?:po|p\.o\.|purchase order)|sending (?:over |through |us )?the (?:po|p\.o\.|purchase order))|(?<!\b(?:once|when|until|after)\s)\bpayment (?:has been |was )?received\b|\b(?:it|the (?:order|booking|job)) is now confirmed\b/i;
const TERMS = /\b(?:minimum|unfortunately|unable to|(?:can ?not|can't|cannot) (?:do|offer|provide|accommodate|book|supply)|not (?:able|possible)|fully booked|no availability|subject to)\b/i;
/** Spartan's words without its footer, which mentions quotes on every email. */
const spartanOwn = (text: string) => text.split(/\*?Please note, all quotes|We now provide Van services/i)[0];
/** The client going ahead: its words confirm or send a PO, or Spartan thanks it for confirming, the PO or paying. */
const saidYes = (m: ThreadMsg) => (m.ours ? ACK.test(spartanOwn(m.text)) : !!m.books || confirms(m.text) || PO_SENT.test(m.text));

/**
 * A need the client settled with Spartan: the client's own words confirm (the need's email or a later one), the last
 * thing Spartan sent before that was a quote or terms, and OnSinch still holds that offer: the need's job is one live,
 * confirmed order holding every day of the need, made before Spartan's message, and no shift of it on those days changed
 * since. On 1 Nov four needs stayed on the TV this way: a 2-hour call refused for a 3-hour minimum and accepted; two
 * quotes with other times than first asked, confirmed by the client. A "we'll do it" never settles: it is no quote or
 * terms, and if staff still had work to do, its order would have to change.
 */
function agreedOn(need: Need, thread: ThreadMsg[], o: Order, rows: Row[]): { text: string; at: string } | null {
  // An order still in Price Quotes or provisional is staff's to raise or confirm after the yes, which is work: replayed
  // from 9 Oct, 6 of 9 agreements were followed by staff confirming the provisional order 3 min to 3 h later, and 145
  // of 265 October orders were confirmed from provisional. One left provisional stays on the TV until its day passes.
  if (!need.days.length || need.asks.includes("cancel") || o.deleted || o.body?.quote || o.body?.provisional) return null;
  const active = shiftsOf(o.body).filter((s) => !s.cancelled);
  if (!need.days.every((d) => active.some((s) => s.day === d))) return null;
  const ms = [...thread].sort((a, b) => a.at - b.at);
  // A yes that asks for a change too ("confirm the order and change the timing to 10-2") accepts the offer with a
  // change, which the offer does not hold. A yes that restates the bookings ("happy to confirm: the 5th, the 7th at
  // 11am...") asks for what the offer is, and the order is checked to hold every day of it.
  // An unknown `changes` counts as asking: a yes is never read more widely than the words show.
  const yes = (m: ThreadMsg) => (m.ours ? ACK.test(spartanOwn(m.text)) : !(m.changes ?? m.asks) && (confirms(m.text) || PO_SENT.test(m.text)));
  for (const c of ms.filter((m) => m.at >= need.at && yes(m))) {
    // Spartan's latest offer before it: a note after a quote ("no rush, the event is in November") changes nothing.
    const s = [...ms].reverse().find((m) => m.ours && m.at < c.at && (QUOTE.test(spartanOwn(m.text)) || TERMS.test(spartanOwn(m.text))));
    if (!s) continue;
    // Spartan answered this need, or the need's own email accepts what Spartan sent before it.
    if (c.at > need.at && s.at < need.at) continue;
    // The client asked for a change after the offer: the offer does not cover it.
    if (ms.some((m) => !m.ours && (m.changes ?? m.asks) && m.at > s.at && m.at < c.at && m.at !== need.at)) continue;
    const since = { ...need, at: s.at };
    if (rows.some((r) => r.order_id === o.order_id && MADE.has(r.action) && T(r.created) > s.at)) continue;
    // A change answered with a quote: the quote holds the change only if staff changed the order before sending it (a
    // quote is built from the order; 188 of 189 measured). Terms refuse, and need no edit.
    if (s.at > need.at && need.asks.includes("change") && QUOTE.test(spartanOwn(s.text))
      && !rows.some((r) => r.order_id === o.order_id && T(r.created) > need.at && T(r.created) <= s.at && workOf(r, o, need)?.fits.includes("change"))) continue;
    const changed = rows.filter((r) => r.order_id === o.order_id).map((r) => workOf(r, o, since)).some((w) => !!w && w.fits.some((f) => f === "change" || f === "cancel" || f === "book") && w.what !== "confirmed the order");
    if (changed) continue;
    const day = new Date(s.at).toISOString().slice(0, 10);
    return { text: `Agreed: the client accepted Spartan's ${QUOTE.test(spartanOwn(s.text)) ? "quote" : "terms"} of ${day}, and ${label(o)} holds it unchanged`, at: new Date(c.at).toISOString() };
  }
  return null;
}

/** Spartan saying it cancelled ("We have cancelled the order"), in its own words. */
const CANCELLED = /\b(?:we have|we've|i have|i've|has been|have been|is now|are now)\s+(?:now\s+)?cancel+ed\b/i;

/**
 * A cancellation Spartan confirmed it made, which OnSinch bears out: no order of any company the sender is a contact of
 * holds a live shift on the need's days. On 1 Nov a cancel stayed on the TV 4 days after "We have cancelled the order":
 * the sender is on two companies, so no single client's order could be checked, and neither holds anything those days.
 */
function cancelAgreed(need: Need, thread: ThreadMsg[], orders: Map<number, Order>): { text: string; at: string } | null {
  if (!need.days.length || !need.asks.length || need.asks.some((a) => a !== "cancel") || !need.companies?.length) return null;
  const said = thread.filter((m) => m.ours && m.at > need.at && CANCELLED.test(spartanOwn(m.text))).sort((a, b) => a.at - b.at)[0];
  if (!said) return null;
  const live = [...orders.values()].some((o) => !o.deleted && o.company_id != null && need.companies!.includes(o.company_id)
    && shiftsOf(o.body).some((x) => !x.cancelled && need.days.includes(x.day)));
  return live ? null : { text: `Agreed: Spartan confirmed the cancellation on ${new Date(said.at).toISOString().slice(0, 10)}, and OnSinch holds nothing for this client on ${need.days.join(", ")}`, at: new Date(said.at).toISOString() };
}

/**
 * The client taking back its own request, in words that point at an earlier one ("please ignore my last email",
 * "scrap that", "keep it as it was"). "Ignore this email" is about the email it is in, and a condition ("if not, keep
 * the booking as is") takes nothing back: neither counts. In 1,179 client emails 9 Oct-1 Nov no request was taken back
 * this way (5 matched looser words, none a withdrawal), so the words are narrow and OnSinch must bear it out.
 */
const WITHDRAW = /\b(?:(?:ignore|disregard)\s+(?:my|the|that)\s+(?:last|previous|earlier|above|first)\s+(?:e-?mail|message|request|one)|(?:ignore|disregard)\s+(?:that|my)\s+(?:request|change|amendment)|scrap (?:that|my (?:last|previous) (?:e-?mail|request))|(?:keep|leave) (?:it|everything|the booking|the times|the crew) as (?:it is|it was|originally (?:booked|planned)|before)|(?:cancel|withdraw) my (?:last |previous )?(?:request|change|amendment))\b/i;
const REPLACE = /\b(?:instead of|rather than)\b/i;
const sentenceOf = (text: string, at: number) => text.slice(Math.max(0, text.lastIndexOf(".", at) + 1, text.lastIndexOf("\n", at) + 1), at);

/**
 * A need the client withdrew with no reply from us: its words take back the client's latest request before them, which
 * is this need's, and OnSinch shows nothing was done since: its one job's shifts on the need's days unchanged since the
 * need, or for a new booking, nothing booked those days. Work already done is not undone by this: that is a change.
 */
function withdrawnOn(need: Need, thread: ThreadMsg[], jobs: Order[], rows: Row[]): { text: string; at: string } | null {
  if (!need.days.length) return null;
  const ms = [...thread].sort((a, b) => a.at - b.at);
  // "Instead of Monday 2nd November" in a client's later request replaces the earlier day's (1 Nov: a need for the 2nd
  // stayed after the client moved it to the 3rd, which OnSinch holds). Only in an email that itself asks: the new request.
  const w = ms.find((m) => {
    if (m.ours || m.at <= need.at) return false;
    const x = WITHDRAW.exec(m.text) ?? (m.asks ? REPLACE.exec(m.text) : null);
    if (!x || /\b(?:if|unless|otherwise)\b/i.test(sentenceOf(m.text, x.index))) return false;
    // "From 16:30 instead of 17:45" replaces a time, not the request: the words it replaces must name the need's own day.
    // They end at "on"/"for"/"at": "17:00 instead of 19:00 on the 30th" moves a time ON the 30th (blind test, 1 Nov).
    if (REPLACE.test(x[0]) && ![...datesIn(m.text.slice(x.index + x[0].length, x.index + 80).split(/[.,;?!\n]|\s(?:on|for|at|from)\s/i)[0], new Date(m.at).toISOString())].some((d) => need.days.includes(d))) return false;
    return true;
  });
  if (!w) return null;
  // The words take back the client's latest request before them: another between makes this need not the one meant.
  if (ms.some((m) => !m.ours && m.asks && m.at > need.at && m.at < w.at)) return null;
  if (REPLACE.test(w.text) && !WITHDRAW.test(w.text) && jobs.some((o) => shiftsOf(o.body).some((x) => !x.cancelled && need.days.includes(x.day)))) return null;
  if (jobs.length > 1) return null;
  if (jobs.length === 1) {
    const since = { ...need, at: need.at };
    const touched = rows.filter((r) => r.order_id === jobs[0].order_id).map((r) => workOf(r, jobs[0], since)).some((x) => !!x && x.fits.some((f) => f === "change" || f === "cancel" || f === "book"));
    if (touched) return null;
  } else if (!need.fresh) return null;
  return { text: `Withdrawn: the client took this request back on ${new Date(w.at).toISOString().slice(0, 10)}, and OnSinch shows nothing was done`, at: new Date(w.at).toISOString() };
}

/**
 * A quote request Spartan has answered with its quote, the client not yet back: nothing is staff's to do until the
 * client says yes, which is a new email and a new need. Borne out by OnSinch: an order holds every day asked (quotes are
 * built from orders). On 1 Nov such a need sat on the TV 60 h saying "Not written: do it by hand", which done by hand
 * would have booked crew the client never confirmed.
 */
/**
 * `held`: staff's work for the need was found on an order still provisional (the done verdict), which is what Spartan
 * quoted even when the client's days moved after it: 9 of the provisional replay's long cards were quotes on an order
 * no longer holding every day first asked.
 */
function quoteSent(need: Need, thread: ThreadMsg[], jobs: Order[], held = false): { text: string; at: string } | null {
  // An undated request ("in February") quoted on the order staff made waits too: that order is what was quoted.
  if (!need.days.length && !held) return null;
  const q = thread.filter((m) => m.ours && m.at > need.at && QUOTE.test(spartanOwn(m.text))).sort((a, b) => a.at - b.at).pop();
  if (!q) return null;
  const offered = jobs.filter((o) => need.days.every((d) => shiftsOf(o.body).some((x) => !x.cancelled && x.day === d)));
  if (held || (need.asks.includes("book") && offered.some(pending))) {
    // While the order is provisional the quote waits on the client's yes, for a booking as for a quote request: "please
    // book" is answered "please let me know if this can be confirmed" (119 of 158 booking requests got a quote, 30 Jul-
    // 2 Nov). Any other reply ("thanks, we'll come back to you once the client signs off") keeps it waiting: ended by any
    // reply, four quote requests' cards stayed up 4 to 17 days in the provisional replay with nothing for staff to do.
    if (thread.some((m) => m.at > q.at && saidYes(m))) return null;
  } else {
    // The client back since the quote, whatever it wrote, is no longer waiting on itself: staff read it. A PO "with the
    // contacts onsite" was read as neither a yes nor an ask, and staff confirmed the order from it the next day (1 Nov).
    // On a confirmed order, staff's work is what clears a booking.
    if (!need.quote || thread.some((m) => !m.ours && m.at > q.at) || !offered.length) return null;
  }
  return { text: `Quote sent on ${new Date(q.at).toISOString().slice(0, 10)}: waiting for the client to confirm`, at: new Date(q.at).toISOString() };
}

export function isDone(need: Need, links: Link[], orders: Map<number, Order>, rows: Row[], placeNamed: (name: string) => number[] = () => [], thread: ThreadMsg[] = []): Verdict {
  const v = doneVerdict(need, links, orders, rows, placeNamed);
  if (v.state === "done" || !thread.length) return v;
  const cx = cancelAgreed(need, thread, orders);
  if (cx) return { state: "agreed", orders: [], rung: v.rung || "agreed", text: cx.text, at: cx.at, creator: null };
  const places = [...need.places, ...need.venues.flatMap(placeNamed)];
  const jobs = [...new Set(candidates(need, links, orders, rows, places).groups.flat())];
  // The thread's own guessed link, whatever company OnSinch keeps the order under, for what the thread itself settles
  // (an agreement, a quote): those rest on Spartan's message on THIS thread, not on staff's work found on the order.
  // On 1 Nov a client's change was settled by quote and PO on an order kept under another company than the sender's.
  const own = links.filter((l) => !l.absolute).map((l) => orders.get(l.order_id)).filter((o): o is Order => !!o && !o.deleted && need.days.every((d) => shiftsOf(o.body).some((x) => x.day === d)));
  const settledOn = jobs.length ? jobs : [...new Set(own)];
  // A new booking with no candidate job is withdrawn only when the client is known: an unknown client's orders were
  // never read. The thread's live linked order stands for the client when its sender is on no contact list.
  const known = need.company_id != null || links.some((l) => { const o = orders.get(l.order_id); return !!o && !o.deleted; });
  const wd = withdrawnOn(need, thread, jobs, rows);
  if (wd && (jobs.length || known)) return { state: "agreed", orders: jobs.map((o) => o.order_id), rung: v.rung || "withdrawn", text: wd.text, at: wd.at, creator: null };
  const a = settledOn.length === 1 ? agreedOn(need, thread, settledOn[0], rows) : null;
  if (a) return { state: "agreed", orders: [settledOn[0].order_id], rung: v.rung || "agreed", text: a.text, at: a.at, creator: null };
  const qs = quoteSent(need, thread, settledOn, !!v.provisional);
  if (qs) return { state: "agreed", orders: settledOn.map((o) => o.order_id), rung: v.rung || "quote sent", text: qs.text, at: qs.at, creator: null };
  if (!v.provisional) return v;
  // What is left on a provisional order: the client's yes since Spartan's latest quote is staff's to confirm; with none,
  // the quote is still Spartan's to send (staff make the order to build it, and quote within the hour 144 of 188 times).
  const q = thread.filter((m) => m.ours && QUOTE.test(spartanOwn(m.text))).sort((a, b) => a.at - b.at).pop();
  const y = thread.filter((m) => m.at >= need.at && (!q || m.at > q.at) && saidYes(m)).sort((a, b) => a.at - b.at)[0];
  const which = v.orders.map((id) => label(orders.get(id)!)).join(" and ");
  return { ...v, text: y ? `The client said yes on ${new Date(y.at).toISOString().slice(0, 10)}: confirm ${which} in OnSinch` : `${which} ${v.orders.length > 1 ? "are" : "is"} still provisional: ${q ? "confirm it once the client says yes to the quote" : "send the quote, or confirm it once the client says yes"}` };
}

function doneVerdict(need: Need, links: Link[], orders: Map<number, Order>, rows: Row[], placeNamed: (name: string) => number[]): Verdict {
  const places = [...need.places, ...need.venues.flatMap(placeNamed)];
  const { rung, groups } = candidates(need, links, orders, rows, places);
  const open: Verdict = { state: "open", orders: [], rung, text: "", at: null, creator: null };
  if (!groups.length) return open;
  let found = groups.map((g) => g.map((o) => ({ o, d: doneOn(o, rows, need, places) })).filter((x) => x.d));
  // Several of the client's orders that day, the work on more than one: the one at the place the reading matched is the
  // need's job, as the need's own venue would pick it (rung 3). For 12 days a need was "possibly R11773 or R11785" while
  // R11773 alone was at its place (1 Nov).
  const at = (o: Order) => shiftsOf(o.body).some((s) => need.days.includes(s.day) && s.place != null && !!need.readPlaces?.includes(s.place));
  const broken = groups.map((g, i) => g.length > 1 && found[i].filter((x) => at(x.o)).length === 1);
  found = found.map((f, i) => (broken[i] ? f.filter((x) => at(x.o)) : f));
  if (groups.some((g, i) => g.length > 1 && found[i].length && !broken[i])) {
    const hit = found.flat();
    return { ...open, state: "possibly", orders: hit.map((x) => x.o.order_id), text: `Possibly done in ${hit.map((x) => label(x.o)).join(" or ")}: check` };
  }
  if (found.some((f) => !f.length)) return open;
  const done = found.map((f) => f[0]);
  // Staff's work found, on an order still provisional: the card stays, and says what is left.
  const held = done.filter((x) => x.d!.provisional);
  if (held.length) return { ...open, state: "possibly", orders: held.map((x) => x.o.order_id), provisional: true, text: `${held.map((x) => label(x.o)).join(" and ")} ${held.length > 1 ? "are" : "is"} still provisional: confirm in OnSinch once the client says yes` };
  const last = done.map((x) => x.d!.last).filter((r): r is Row => !!r).sort((a, b) => T(b.created) - T(a.created))[0] ?? null;
  const text = done.map((x) => `${label(x.o)}, staff ${x.d!.what.join(", ")}`).join("; ");
  return { state: "done", orders: done.map((x) => x.o.order_id), rung, text, at: last ? new Date(T(last.created)).toISOString() : null, creator: last?.creator ?? null };
}

export const RULES = { QUOTE, PO_SENT, ACK, TERMS, WITHDRAW, REPLACE, spartanOwn };
