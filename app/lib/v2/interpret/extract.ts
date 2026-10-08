// ============================================================================
// Extraction: one model call turns the client's newest words into requests, each value
// paired with the exact words it came from. The model is a reader here, not a decider:
// interpret.ts throws away any value whose words are not in the email or do not parse to
// that value, and the planner decides what (if anything) to write.
// ============================================================================

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
  venue: Grounded<string>;
  crew_chief: Grounded<boolean>;
  trade: Grounded<string>;
  /** For a change: the existing shift it is about, in the client's words ("the derig shift"). */
  target: { quote: string; date: Grounded<string>; start: Grounded<string> } | null;
};

export type Extraction = {
  intent: "booking" | "change" | "cancellation" | "quote_request" | "info_only" | "unclear";
  po: Grounded<string>;
  requests: RawRequest[];
  note: string;
};

export const SYSTEM = `You read emails sent to Spartan Crew, a London crew-hire agency, and report what the client is asking for. You never invent anything.

Return ONLY a JSON object:
{
 "intent": "booking" | "change" | "cancellation" | "quote_request" | "info_only" | "unclear",
 "po": {"value": "<PO/reference>", "quote": "<exact words>"} | null,
 "requests": [ {
   "action": "new_shift" | "change_times" | "change_crew" | "cancel_shift" | "other",
   "date": {"value": "YYYY-MM-DD", "quote": "<exact words naming the day>"} | null,
   "start": {"value": "HH:MM", "quote": "<the time token exactly as written>"} | null,
   "end": {"value": "HH:MM", "quote": "<the time token exactly as written>"} | null,
   "duration_minutes": {"value": <number>, "quote": "<e.g. 3hr call>"} | null,
   "crew": {"value": <number>, "quote": "<e.g. 3 x Crew>"} | null,   (the TOTAL asked for on that shift)
   "crew_add": {"value": <number>, "quote": "<e.g. add 2 crew>"} | null,   (only when they ask for MORE on top of what is booked)
   "venue": {"value": "<venue name as written>", "quote": "<exact words>"} | null,
   "crew_chief": {"value": true, "quote": "<exact words>"} | null,
   "trade": {"value": "<e.g. crew, carpenter, AV technician>", "quote": "<exact words>"} | null,
   "target": {"quote": "<words naming the existing shift, e.g. the derig shift>", "date": <as date or null>, "start": <the OLD start time or null>} | null
 } ],
 "note": "<one short sentence on anything unclear>"
}

Rules:
- Every "quote" is copied character for character from the SUBJECT or the NEWEST message (never from quoted history). If you cannot quote it, the field is null.
- Read only what is written. "a couple", "a few more", "the usual", "same as last time" are not numbers or times: leave them null.
- "value" is your reading of the quote. Resolve dates against the email's sent date given below; write 24-hour times.
- A request for prices or a quote is intent "quote_request" (still list the shifts asked about).
- Confirmations, thanks, contacts, meeting points, invoices and PO-only messages are "info_only" with no requests (but report a PO if one is given).
- One request per shift per day. A time change names the shift it changes in "target".`;

export function userPrompt(sentIso: string, from: string, subject: string, newest: string): string {
  return `Sent: ${sentIso}\nFrom: ${from}\nSubject: ${subject}\n\nNEWEST MESSAGE:\n${newest.slice(0, 6000)}`;
}

/** One OpenRouter call (the key the engine already uses). Costs money: callers budget it. */
export async function extract(sentIso: string, from: string, subject: string, newest: string): Promise<Extraction> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");
  const model = process.env.SPARTAN_INTERPRET_MODEL || process.env.SPARTAN_MODEL || "anthropic/claude-opus-4.6";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt(sentIso, from, subject, newest) }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`extract: OpenRouter ${res.status}`);
  const j: any = await res.json();
  // Models sometimes wrap the object in prose or a code fence; the object itself is taken.
  const text = String(j?.choices?.[0]?.message?.content ?? "");
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("extract: no JSON object in the answer");
  return JSON.parse(text.slice(first, last + 1)) as Extraction;
}
