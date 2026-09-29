// ============================================================================
// The chase: what Spartan writes when the CLIENT is the one who owes an answer.
// ----------------------------------------------------------------------------
// composeReply (prompts.ts REPLY_SYSTEM) answers an incoming email. Pointed at a
// thread where Spartan spoke last it does the wrong thing entirely — it tries to
// answer Spartan's own message. A chase is a different act with a different failure
// mode, so it gets its own prompt rather than a flag on that one.
//
// WHAT MAKES A CHASE GO WRONG. A reply that says too little is merely unhelpful. A
// chase that says too much is a machine nagging a client about something they already
// answered somewhere this mailbox cannot see — a phone call, a colleague's inbox, a
// text. That is why the horizon in clock.ts exists, and it is why this prompt is
// forbidden from asserting that the client has not responded. It may say what Spartan
// is waiting on. It may not say the client failed to do anything.
//
// The voice rules are the reply prompt's, deliberately: sign as Spartan Crew and never
// as a person, never claim a booking that was not made, never report an action taken
// outside this email. A chase is the message most likely to be sent unread, so the
// rules that stop a draft committing Spartan to something matter MORE here, not less.
// ============================================================================

/**
 * The system prompt for a follow-up chase.
 *
 * ONE ASK, ALREADY KNOWN. The caller passes what is outstanding, worked out from the
 * thread before the model was involved. The model's job is wording, not deciding what
 * Spartan needs — a model left to infer the ask invents plausible ones, and a client
 * asked for a purchase order nobody wanted is worse than no chase at all.
 */
export const CHASE_SYSTEM = `You write a single short follow-up email on behalf of Spartan Crew, a UK event crew company.

Spartan is waiting on the client. Your job is to ask again for what is outstanding, once, politely, in natural UK English.

## What you are told
You are given the conversation so far and a line saying WHAT SPARTAN IS WAITING ON. That line is the truth of the matter. Ask for exactly that and nothing else.

## Hard rules (CRITICAL)
- NEVER state or imply that the client failed to reply, ignored you, or is late. They may well have answered by phone, or through a colleague, or the message may have gone astray at our end. Write as though the last message may simply have been missed by either side.
- NEVER invent what is outstanding. If the line above names one thing, ask for one thing.
- NEVER confirm a booking, a crew number, a rate, a date or a name that is not already stated in this thread. A draft prepared and awaiting confirmation is NOT a confirmed booking.
- NEVER say a call has been made, a colleague has been spoken to, or any action has been taken outside this email.
- NEVER attach a deadline, a threat to release the date, or a consequence of not replying, unless the thread itself already stated one.
- Do not apologise for chasing. It is a normal part of arranging work and an apology invites the reader to treat it as an imposition.

## Who you are signing as (CRITICAL)
Sign off as "Spartan Crew" and nothing else. Do NOT sign as a named person, even when a colleague's name appears throughout the thread and it would read naturally. A draft signed "Jake" is a message a client believes Jake wrote and stands behind; it was written by a machine and may be sent by anyone. Greeting the client by their own first name is right and expected — signing as an individual is not.

## Length and shape
Three sentences is usually right and six is too many. Remind them briefly what the job is, say what you need, and stop. No summary of the whole thread: they were there.

## Email Body (HTML)
The "html" field must be valid HTML in this exact structure:
<div>
  <p>Hello,</p>
  <p>[the chase — one short paragraph, or one sentence plus a short list when more than one thing is outstanding]</p>
  <p>Thanks,<br>Spartan Crew</p>
</div>

## Output
Return: subject (the existing thread's subject, unchanged, with no "Re:" added — the mail client threads it), priority (low|medium|high), html (the complete HTML body above).
Do not include job ids, thread ids, priority, or any internal metadata in the html.`;

/**
 * WHAT SPARTAN IS WAITING ON, in the client's terms.
 *
 * Derived from the thread rather than asked of the model, for the reason in the prompt:
 * a model told to work out the ask for itself produces a plausible one, and a client
 * chased for something nobody needs is a worse outcome than silence. When nothing can
 * be identified this returns null and the CALLER declines to chase — an honest refusal
 * beats a vague "just checking in", which is the single most deletable email there is.
 */
export function outstandingAsk(lastSpartanBody: string): string | null {
  const b = (lastSpartanBody || "").trim();
  if (!b) return null;

  /**
   * A QUESTION MARK IS NOT AN OUTSTANDING ITEM, which is what the first version of
   * this got wrong and what a live thread proved within two calls. Spartan's last
   * message on thread 1a0662d09571ad87 was "Hi Michael, Just wanted to see how
   * everything went?" — a courtesy after a completed job. Read as an ask, it produced
   * "Hope the move went well! Just wanted to check in and see how everything went",
   * which is a nag about nothing: the exact email that makes a client mute a sender.
   *
   * So greetings are stripped and pleasantries are refused outright. When nothing
   * substantive survives, this returns null and the caller declines to chase — the
   * honest refusal the header promises, rather than a "just checking in" nobody asked
   * for. A follow-up system is judged on the emails it does NOT send.
   */
  const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^.?!\n]*/i;
  const PLEASANTRY =
    /\b(how (are|did|is|was|it|everything)|hope (you|the|it|this)|just (wanted|checking|thought)|all (well|good)|everything (ok|okay|went|go)|any (news|joy)|touching base|checking in)\b/i;

  const cleaned = b
    .split(/\r?\n/)
    .filter((line) => !GREETING.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const sentences = cleaned.split(/(?<=[.?!])\s+/);
  const asked = sentences.find(
    (s) => s.trim().endsWith("?") && !PLEASANTRY.test(s) && s.trim().length >= 12 && s.trim().length <= 200
  );
  if (asked) return asked.trim();
  if (PLEASANTRY.test(cleaned) && !/\?/.test(cleaned.replace(PLEASANTRY, ""))) return null;

  const PHRASES: Array<[RegExp, string]> = [
    [/\bpurchase order\b|\bPO number\b|\bPO\b/i, "the purchase order number"],
    [/\bsite contact\b|\bcontact (number|details)\b/i, "the site contact details"],
    [/\bstart time\b|\bcall time\b/i, "the start time"],
    [/\bfinish time\b|\bend time\b/i, "the finish time"],
    [/\baddress\b|\bpostcode\b|\bvenue\b/i, "the venue address"],
    [/\bhow many\b|\bcrew numbers?\b|\bnumber of crew\b/i, "the crew numbers"],
    [/\bconfirm\b/i, "confirmation so the job can be booked in"],
  ];
  for (const [re, ask] of PHRASES) if (re.test(b)) return ask;
  return null;
}
