// ============================================================================
// Extraction: one model call turns the client's newest words into requests, each value
// paired with the exact words it came from. The model is a reader here, not a decider:
// interpret.ts throws away any value whose words are not in the email or do not parse to
// that value, and the planner decides what (if anything) to write.
// ============================================================================
import { createHash } from "node:crypto";

export type Grounded<T> = { value: T; quote: string } | null;

export type RawRequest = {
  action: "new_shift" | "change_times" | "change_crew" | "cancel_shift" | "other";
  date: Grounded<string>;
  start: Grounded<string>;
  end: Grounded<string>;
  duration_minutes: Grounded<number>;
  crew: Grounded<number>;
  /** "add 2 crew", "2 more": an increase on what is booked, never a total. */
  crew_add: Grounded<number>;
  /** "stand down 2", "2 fewer": a decrease on what is booked, never a total. */
  crew_remove?: Grounded<number>;
  venue: Grounded<string>;
  crew_chief: Grounded<boolean>;
  trade: Grounded<string>;
  /** For a change: the existing shift it is about, in the client's words ("the derig shift"). */
  target: { quote: string; date: Grounded<string>; start: Grounded<string> } | null;
  /** The booking it is about, from the bookings the reader was shown ("R11224"), and its shift. */
  order?: string | null;
  shift_id?: number | null;
  /** A venue from the client's own venues ("our warehouse"), by id, with the words naming it. */
  venue_id?: Grounded<number>;
};

export type Extraction = {
  intent: "booking" | "change" | "cancellation" | "quote_request" | "info_only" | "unclear";
  po: Grounded<string>;
  /** The booking a PO (or a message with no requests) is about, from the bookings shown. */
  order?: string | null;
  /** The client's company as written (signature, sign-off), for a client OnSinch does not hold. */
  company?: Grounded<string>;
  requests: RawRequest[];
  note: string;
};

export const SYSTEM = `You read emails sent to Spartan Crew, a London crew-hire agency, and report what the client is asking for, so that the booking can be made or changed in OnSinch. You never invent anything.

You are given the email's NEWEST MESSAGE, the EARLIER MESSAGES on the thread (the client's and Spartan's), THE CLIENT'S CURRENT BOOKINGS (each an R number with its shifts and shift_ids) and the VENUES THIS CLIENT USES (with venue_ids).

Return ONLY a JSON object:
{
 "intent": "booking" | "change" | "cancellation" | "quote_request" | "info_only" | "unclear",
 "po": {"value": "<PO/reference>", "quote": "<exact words>"} | null,
 "order": "<R number of the booking a PO or the whole message is about>" | null,
 "company": {"value": "<the client's company name>", "quote": "<exact words, e.g. from the signature>"} | null,
 "requests": [ {
   "action": "new_shift" | "change_times" | "change_crew" | "cancel_shift" | "other",
   "order": "<R number from THE CLIENT'S CURRENT BOOKINGS that this request is about>" | null,
   "shift_id": <shift_id from that booking that this request changes or cancels> | null,
   "date": {"value": "YYYY-MM-DD", "quote": "<exact words naming the day>"} | null,
   "start": {"value": "HH:MM", "quote": "<exact words>"} | null,
   "end": {"value": "HH:MM", "quote": "<exact words>"} | null,
   "duration_minutes": {"value": <number>, "quote": "<e.g. 3hr call>"} | null,
   "crew": {"value": <number>, "quote": "<e.g. 3 x Crew>"} | null,   (the TOTAL wanted on that shift)
   "crew_add": {"value": <number>, "quote": "<e.g. add 2 crew>"} | null,   (only when they ask for MORE on top of what is booked)
   "crew_remove": {"value": <number>, "quote": "<e.g. stand down 2 crew>"} | null,   (only when they ask for FEWER than is booked)
   "venue": {"value": "<venue name as written>", "quote": "<exact words>"} | null,
   "venue_id": {"value": <venue_id from VENUES THIS CLIENT USES>, "quote": "<exact words naming that venue>"} | null,
   "crew_chief": {"value": true, "quote": "<exact words>"} | null,
   "trade": {"value": "<e.g. crew, carpenter, AV technician, van driver>", "quote": "<exact words>"} | null,
   "target": {"quote": "<words naming the existing shift, e.g. the derig shift>", "date": <as date or null>, "start": <the OLD start time or null>} | null
 } ],
 "note": "<one short sentence on anything unclear>"
}

Rules:
- Every "quote" is copied character for character from the SUBJECT, the NEWEST MESSAGE or an EARLIER MESSAGE. Prefer the newest message; take a detail from an earlier message only when the newest message relies on it (e.g. "please book this", "same times", "add one more to Tuesday"). If you cannot quote it, the field is null.
- Read only what is written. "a couple", "a few more", "the usual", "same as last time" are not numbers or times unless an earlier message on the thread states them.
- "value" is your reading of the quote. Resolve dates against the email's sent date; write 24-hour times. "4 - 6pm" is 16:00 to 18:00; "10-2" for a day shift is 10:00 to 14:00. "at least two bodies" is 2 crew. "a man and van" is 1 crew with trade "van driver".
- A change, a cancellation or an extra shift on an existing job names its booking in "order" and, for a change or cancellation, the exact shift in "shift_id". Choose ONLY from THE CLIENT'S CURRENT BOOKINGS, by what the messages say (day, times, venue, job name, reference, what Spartan said it booked). Leave both null when no booking clearly fits; never pick one only because it is on the same day.
- A request for prices or a quote is intent "quote_request": list the shifts asked about exactly as for a booking.
- "venue_id" when the venue as written is one of VENUES THIS CLIENT USES ("our warehouse", "Beckenham" when their Beckenham warehouse is listed, "the usual venue").
- Confirmations, thanks, contacts, names, meeting points, invoices and PO-only messages are "info_only" with no requests (but report a PO if one is given).
- A client saying a booking is no longer needed ("we can cancel that order", "this has been filled elsewhere", "we've sorted this internally", "no longer required") is intent "cancellation": one "cancel_shift" request per shift of that booking, each with "order" and "shift_id".
- A client accepting a quote or proposal Spartan sent ("sounds good", "let's go ahead", "please book this") books what that earlier message proposed: list its shifts, quoting that message.
- Extra calls on an existing job ("please add 2x2hr at 16:30 to our booking at Guildhall") are "new_shift" requests with "order" set; "crew_add" is only more people on a shift that is already booked.
- A request for a day or venue none of the bookings has is a NEW booking ("new_shift", "order" null), never a change to another day's booking, unless the client asks to move that booking.
- Adding a person of a trade to a booked shift ("add a carpenter to the team tomorrow") is "change_crew" with "crew_add", "trade", "order" and "shift_id".
- Times written against the booking ("an hour earlier", "forward by 30 mins", "the same timings") are given as the resulting HH:MM, quoting those words.
- One request per shift per day. A time change names the shift it changes in "target" and "shift_id".
- A move to another day puts the NEW day in "date" and the shift's current day in "target".`;

export function userPrompt(sentIso: string, from: string, subject: string, newest: string, context = ""): string {
  return `Sent: ${sentIso}\nFrom: ${from}\nSubject: ${subject}\n\nNEWEST MESSAGE:\n${newest.slice(0, 6000)}${context ? `\n\n${context}` : ""}`;
}

/**
 * GPT-6.1 Sol reads the emails (Ben, 10-15: "go with sol"). On the newest 100 emails scored [DECISIONS V20]
 * against what ops did, it got 5 of 20 bookings right where the stored Opus readings got 2 of
 * 22, for $0.007 an email against $0.024. SPARTAN_MODEL is the paused engine's and is set in
 * production, so the reader no longer falls back to it.
 */
export const interpretModel = () => process.env.SPARTAN_INTERPRET_MODEL || "openai/gpt-6.1-sol";
/** Which prompt produced an extraction: a reading is only comparable to one made by the same prompt. */
export const PROMPT_ID = `extract@${createHash("sha256").update(SYSTEM).digest("hex").slice(0, 12)}`;

export type ExtractMeta = { model: string; prompt_id: string; input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; ms: number };

/**
 * A read that got no answer is asked again inside the call (addendum F29): 3 attempts, 400 ms then
 * 1,200 ms apart plus up to half again, and none started after 120 s. Only a 429, a 5xx other than
 * 501, a timeout or a dropped connection: a 400, 401 or 402 is the same refusal every time, and a
 * reply that came back is never asked for twice, since each attempt is paid.
 */
const ATTEMPTS = 3, BACKOFF_MS = [400, 1200], LAST_START_MS = 120_000;
const retryable = (status: number) => status === 429 || (status >= 500 && status !== 501);

/** One OpenRouter call (the key the engine already uses). Costs money: callers budget it. */
export async function extractWithMeta(sentIso: string, from: string, subject: string, newest: string, context = ""): Promise<{ x: Extraction; meta: ExtractMeta }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const model = interpretModel();
  const t0 = Date.now();
  let res: Response | null = null;
  for (let attempt = 1; ; attempt++) {
    let failure: Error;
    try {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0, response_format: { type: "json_object" }, usage: { include: true },
          messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt(sentIso, from, subject, newest, context) }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      failure = new Error(`extract: OpenRouter ${res.status}`);
    } catch (e) {
      // A thrown fetch is a timeout or a dropped connection.
      res = null;
      failure = e as Error;
    }
    if (res?.ok) break;
    if (res && !retryable(res.status)) throw failure;
    const wait = (BACKOFF_MS[attempt - 1] ?? 0) * (1 + Math.random() / 2);
    if (attempt >= ATTEMPTS || Date.now() - t0 + wait > LAST_START_MS) throw failure;
    await new Promise((r) => setTimeout(r, wait));
  }
  const j: any = await res!.json();
  // Models sometimes wrap the object in prose or a code fence; the object itself is taken.
  const text = String(j?.choices?.[0]?.message?.content ?? "");
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("extract: no JSON object in the answer");
  const u = j?.usage ?? {};
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    x: JSON.parse(text.slice(first, last + 1)) as Extraction,
    meta: { model: String(j?.model ?? model), prompt_id: PROMPT_ID, input_tokens: num(u.prompt_tokens), output_tokens: num(u.completion_tokens), cost_usd: num(u.cost), ms: Date.now() - t0 },
  };
}

export async function extract(sentIso: string, from: string, subject: string, newest: string): Promise<Extraction> {
  return (await extractWithMeta(sentIso, from, subject, newest)).x;
}
