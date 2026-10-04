// ============================================================================
// linkJudge — is this the same job as an order the client already has?
// ----------------------------------------------------------------------------
// Ben, 2026-10-03: the engine "should not link an enquiry to an existing order for the
// same client on the same day, and that be the only reason it does it", and "every
// single deduplication should get an AI step, with reinforced deterministic steps".
//
// It replaced a rule that linked a sole same-day order on the date alone: 57 of the 90
// link decisions in the engine's notes, and the case where a client's second job that
// day rewrote the first job's crew and times.
//
// THE MODEL CHOOSES, THE CODE CHECKS, AND THE ENGINE ACTS ONLY WHEN THEY AGREE.
//   1. Code rates each same-day order (resolve.ts rateOrdersForLink): named by an R
//      number, venue supports, same day only, or a different venue argues against.
//   2. The model, which never sees those ratings, picks one order or "none", quoting the
//      client's own words for a link.
//   3. Code checks the answer: on the list, the quote really the client's, not an order
//      the code rated against, not overruling a named R number.
//   4. Disagreement gets one second pass with the disagreement stated. Still disagreeing,
//      or the model failing, HOLDS: nothing linked, nothing created, a Gmail tag. Code
//      alone never decides here — the venue judge's code-only fallback is what booked
//      "Hotel Cafe Royal" at Park Royal (order 16366, 2026-10-01).
//
// The costs are not symmetric and the prompt says so: a wrong link overwrites another
// job's crew, a missed link creates a second order ops can delete.
// ============================================================================
import type { LinkRating, OrderRec } from "./resolve";
import type { ConversationFacts, HydratedThread, PlaceCandidate } from "./types";
import { renderConversation } from "./renderThread";
import { ownPart } from "./triage";

export interface BlockView { day: string; start?: string; end?: string; size?: number; name?: string; place?: string }

export interface LinkCandidate {
  order_id: number;
  number?: string;
  name?: string;
  happening?: string;
  created?: string;
  specification?: string;
  intern_name?: string;
  blocks?: BlockView[];
  rating: LinkRating;
  why: string;
}

export interface LinkQuestion {
  /** enquiry: an unlinked thread. successor: our order was deleted; which order replaced it? */
  mode: "enquiry" | "successor";
  client?: string;
  /** The conversation as the model reads it (renderConversation). */
  conversation: string;
  /** The client's own words, quoted history removed, for checking a quote. */
  own_text: string;
  asks: { days: string[]; venue?: string; blocks: BlockView[] };
  lost?: { number?: string; name?: string; blocks: BlockView[] };
  candidates: LinkCandidate[];
}

export interface LinkAnswer { decision: "same" | "none"; order_id: number | null; quote: string; reason: string }

/** A model that answers one tool-shaped question. Built in reason.ts; faked in tests. */
export interface LinkJudge { ask(system: string, user: string): Promise<unknown> }

export type LinkVerdict =
  | { action: "link"; order_id: number; how: string; reason: string }
  | { action: "new"; how: string; reason: string }
  | { action: "hold"; how: string; reason: string };

export const LINK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "order_id", "quote", "reason"],
  properties: {
    decision: { type: "string", enum: ["same", "none"] },
    order_id: { type: ["integer", "null"], description: "One of the listed order ids when decision is same, else null" },
    quote: { type: "string", maxLength: 300, description: "The client's exact words that show it is that order; empty for none" },
    reason: { type: "string", maxLength: 300 },
  },
} as const;

export const LINK_SYSTEM = `You decide whether an email thread from a client of Spartan Crew (a London crew supplier) is about one of that client's EXISTING bookings, listed below, or about a different job.

Spartan's bookings live in a system called OnSinch. Each listed order is one booking: a name (usually "Client - Event @ Venue"), an R number, the day it happens, and its crew blocks (day, start-end, how many crew, venue).

What decides it:
- The same client on the same day is NOT evidence. Clients often book several separate jobs on one day: different shows, different venues, a second crew for another site. Two shows at the same venue on the same day are two jobs.
- Evidence it IS an existing booking: the client refers to something already booked ("the crew we booked for Friday", "as per the booking", an R or J number), changes crew numbers or times of a booking, adds a PO to it, or names the same event or show.
- Evidence it is NOT: a different event, show or venue; a fresh request for additional, separate work ("we also need..."); work that does not fit any listed booking.
- A change of crew numbers or times on an existing booking is still that booking.

Successor mode is different: Spartan's own order for this thread was deleted by the office, who usually re-type the same job as a new order (same day and venue, similar crew and times, often a similar name). Decide which listed order, if any, is that re-typed job. The thread is context.

A wrong link overwrites another job's crew and times. A missed link only creates a second order the office can delete. When unsure, answer none.

Answer with the emit tool. decision "same" needs order_id (one of the listed ids, never another number) and, in enquiry mode, quote: the client's exact words, copied character for character from their own messages (not from Spartan's replies or quoted history), that show it is that booking. decision "none": order_id null, quote empty. reason: one sentence.`;

/** Lower-case, unify quotes and dashes, collapse whitespace — for comparing a quote. */
export function normQuote(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[‘’‛`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteHolds(quote: string, ownText: string): boolean {
  const q = normQuote(quote).replace(/^["'.\s]+|["'.\s]+$/g, "");
  return q.length >= 8 && normQuote(ownText).includes(q);
}

function blockLine(b: BlockView): string {
  return `${b.day}${b.start ? ` ${b.start}-${b.end ?? "?"}` : ""}${b.size ? `, ${b.size} crew` : ""}${b.name ? `, "${b.name}"` : ""}${b.place ? ` @ ${b.place}` : ""}`;
}

export function buildLinkPrompt(q: LinkQuestion, disagreement?: string): string {
  const out: string[] = [];
  out.push(`MODE: ${q.mode}`);
  if (q.client) out.push(`CLIENT: ${q.client}`);
  out.push("");
  out.push("WHAT THIS THREAD ASKS FOR (read by an earlier step; the conversation below is the evidence):");
  out.push(`  days: ${q.asks.days.join(", ") || "(none read)"}`);
  if (q.asks.venue) out.push(`  venue: ${q.asks.venue}`);
  for (const b of q.asks.blocks.slice(0, 20)) out.push(`  - ${blockLine(b)}`);
  if (q.mode === "successor" && q.lost) {
    out.push("");
    out.push(`SPARTAN'S DELETED ORDER: ${q.lost.number ? `R${q.lost.number} ` : ""}${q.lost.name ?? ""}`);
    for (const b of q.lost.blocks.slice(0, 20)) out.push(`  - ${blockLine(b)}`);
  }
  out.push("");
  out.push(`THE CLIENT'S ORDERS ON THOSE DAYS (${q.candidates.length}):`);
  for (const c of q.candidates) {
    out.push(`order_id ${c.order_id}${c.number ? ` (R${c.number})` : ""}: ${c.name ?? "(unnamed)"}`);
    if (c.happening) out.push(`  happens: ${c.happening.slice(0, 16)}${c.created ? `   created: ${c.created.slice(0, 16)}` : ""}`);
    if (c.intern_name) out.push(`  client PO: ${c.intern_name}`);
    if (c.specification) out.push(`  description: ${String(c.specification).replace(/\s+/g, " ").slice(0, 300)}`);
    for (const b of (c.blocks ?? []).slice(0, 12)) out.push(`  - ${blockLine(b)}`);
  }
  if (disagreement) {
    out.push("");
    out.push(`A CHECK DISAGREES WITH YOUR FIRST ANSWER: ${disagreement}`);
    out.push("Look again. Keep your answer only if the client's own words show it; otherwise give the other answer, or none.");
  }
  out.push("");
  out.push(q.conversation);
  return out.join("\n");
}

function asAnswer(raw: unknown): LinkAnswer | null {
  const r = raw as Partial<LinkAnswer> | null;
  if (!r || typeof r !== "object" || (r.decision !== "same" && r.decision !== "none")) return null;
  const id = r.order_id == null ? null : Number(r.order_id);
  return { decision: r.decision, order_id: Number.isInteger(id) ? id : null, quote: String(r.quote ?? ""), reason: String(r.reason ?? "").slice(0, 300) };
}

/** Does the code accept this answer? A reason when it does not, written for the second pass. */
export function checkAnswer(q: LinkQuestion, a: LinkAnswer): string | null {
  const named = q.candidates.find((c) => c.rating === "named");
  if (a.decision === "none") {
    return named ? `the client's thread names R${named.number}, which is order_id ${named.order_id}` : null;
  }
  const c = q.candidates.find((x) => x.order_id === a.order_id);
  if (!c) return `order_id ${a.order_id} is not one of the listed orders`;
  if (q.mode === "enquiry" && !quoteHolds(a.quote, q.own_text)) {
    return `your quote does not appear in the client's own words (${JSON.stringify(a.quote.slice(0, 80))})`;
  }
  if (named && named.order_id !== c.order_id) return `the client's thread names R${named.number}, which is order_id ${named.order_id}`;
  if (c.rating === "contrary") return `order_id ${c.order_id} is at ${c.why.replace(/^a different venue/, "a different venue from the thread's")}`;
  return null;
}

function act(q: LinkQuestion, a: LinkAnswer, how: string): LinkVerdict {
  if (a.decision === "same" && a.order_id != null) {
    const c = q.candidates.find((x) => x.order_id === a.order_id)!;
    const support = c.rating === "named" ? "+r-number" : c.rating === "supports" ? "+venue" : "";
    return { action: "link", order_id: a.order_id, how: `${how}${support}`, reason: a.reason };
  }
  return { action: "new", how, reason: a.reason };
}

/**
 * The whole decision. Never throws: a model that fails, times out or answers out of
 * shape is a HOLD, because with candidates on the day neither linking nor creating is
 * safe without a judgement.
 */
export async function decideLink(q: LinkQuestion, judge: LinkJudge | null | undefined): Promise<LinkVerdict & { answers: LinkAnswer[] }> {
  const answers: LinkAnswer[] = [];
  if (!q.candidates.length) return { action: "new", how: "no-candidates", reason: "the client has no other order on these days", answers };
  if (!judge) return { action: "hold", how: "judge-unavailable", reason: "no model is configured to check whether this is an existing booking", answers };

  const ask = async (disagreement?: string): Promise<LinkAnswer | string> => {
    try {
      const a = asAnswer(await judge.ask(LINK_SYSTEM, buildLinkPrompt(q, disagreement)));
      return a ?? "the model answered out of shape";
    } catch (err) {
      return `the model failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
    }
  };

  const first = await ask();
  if (typeof first === "string") return { action: "hold", how: "judge-unavailable", reason: first, answers };
  answers.push(first);
  const objection = checkAnswer(q, first);
  if (!objection) return { ...act(q, first, "judge"), answers };

  const second = await ask(objection);
  if (typeof second === "string") return { action: "hold", how: "judge-unavailable", reason: `${objection}; the second look failed: ${second}`, answers };
  answers.push(second);
  const again = checkAnswer(q, second);
  if (!again) return { ...act(q, second, "judge-second-pass"), answers };
  return { action: "hold", how: "disagreement", reason: `the model and the check disagree: ${again}`, answers };
}

/** Blocks of a nested order read (onsinch orderWithBlocks shape) as the judge reads them. */
export function blocksOfNested(order: any, placeName: (id?: number) => string | undefined): BlockView[] {
  const out: BlockView[] = [];
  for (const job of [].concat(order?.Job ?? [])) {
    for (const t of [].concat((job as any)?.SlotTeam ?? []) as any[]) {
      const slots = [].concat(t?.Slot ?? []) as any[];
      const size = slots.reduce((n, s) => n + (Number(s?.size) || 0), 0) || undefined;
      const pid = slots.map((s) => Number(s?.SlotLocation?.place_id)).find((n) => n > 0);
      const b = String(t?.beginning ?? ""), e = String(t?.end ?? "");
      out.push({ day: b.slice(0, 10), start: b.slice(11, 16) || undefined, end: e.slice(11, 16) || undefined, size, name: t?.name || undefined, place: placeName(pid) });
    }
  }
  return out.sort((a, b) => `${a.day}${a.start}`.localeCompare(`${b.day}${b.start}`));
}

/**
 * Everything the judge needs, read from what the caller already holds plus one nested
 * read per candidate (free, and only on the day there is a candidate at all). A failed
 * nested read leaves that candidate without blocks rather than failing the question:
 * the order's name and day still go in front of the model.
 */
export async function assembleLinkQuestion(p: {
  mode: LinkQuestion["mode"];
  client?: string;
  thread: HydratedThread;
  facts: ConversationFacts;
  rated: Array<{ order: OrderRec; rating: LinkRating; why: string }>;
  readBlocks: (orderId: number) => Promise<any | null>;
  places?: PlaceCandidate[];
  lost?: LinkQuestion["lost"];
}): Promise<LinkQuestion> {
  const placeName = (id?: number) => {
    if (!id) return undefined;
    const pl = p.places?.find((x) => Number(x.id) === Number(id));
    return pl ? [pl.name, pl.zip].filter(Boolean).join(", ") : `place ${id}`;
  };
  const candidates: LinkCandidate[] = [];
  for (const r of p.rated) {
    let full: any = null;
    try { full = await p.readBlocks(Number(r.order.id)); } catch { full = null; }
    candidates.push(toCandidate({ ...(r.order as any), ...(full ?? {}) }, r.rating, r.why, full ? blocksOfNested(full, placeName) : undefined));
  }
  const msgs = [...p.thread.messages];
  const latest = msgs[msgs.length - 1];
  const client = msgs.filter((m) => !m.is_from_spartan);
  return {
    mode: p.mode,
    client: p.client,
    conversation: latest ? renderConversation(latest, msgs.slice(0, -1)).text : "",
    own_text: client.map((m) => `${m.subject ?? ""}\n${ownPart(m.body ?? "")}`).join("\n"),
    asks: {
      days: [...new Set((p.facts.requests ?? []).map((r) => (r.date || "").slice(0, 10)).filter(Boolean))].sort(),
      venue: p.facts.location_text,
      blocks: (p.facts.requests ?? []).map((r) => ({
        day: (r.date || "TBC").slice(0, 10), start: r.start_time, end: r.end_time, size: r.size,
        name: r.task, place: r.location_text,
      })),
    },
    lost: p.lost,
    candidates,
  };
}

/** An order row (with or without its nested blocks) and its code rating, as a candidate. */
export function toCandidate(o: OrderRec & Record<string, any>, rating: LinkRating, why: string, blocks?: BlockView[]): LinkCandidate {
  return {
    order_id: Number(o.id),
    number: o.number != null ? String(o.number) : undefined,
    name: o.name ?? undefined,
    happening: o.happening ?? undefined,
    created: o.created ?? undefined,
    specification: o.specification ?? undefined,
    intern_name: o.intern_name ?? undefined,
    blocks,
    rating,
    why,
  };
}
