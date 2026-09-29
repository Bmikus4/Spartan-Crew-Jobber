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

  /**
   * QUOTED TEXT IS NOT OURS TO CHASE, and this cost two real drafts before it was
   * caught. A reply carries the client's message quoted beneath it, so scanning the
   * whole body found "> > Do you have a contact number?" — the CLIENT asking US — and
   * produced a chase asking them to answer their own question. The most embarrassing
   * possible follow-up, and invisible until you read the ask rather than the email.
   *
   * Everything from a quote marker onward is somebody else's words. Also drops the
   * "On <date> X wrote:" attribution line that introduces it, which carries no marker.
   */
  const QUOTED = /^\s*>+/;
  const ATTRIBUTION = /^\s*(on\s.+\swrote:|from:\s|sent:\s|-{2,}\s*original message)/i;

  /**
   * THE SIGNATURE IS NOT THE MESSAGE, and ignoring that broke everything above it.
   *
   * ThreadMessage documents `body` as "cleaned plain text (quotes/signatures
   * stripped)". It is not: the live rows carry the full sign-off, the sender's title
   * block, and this company's standing footer — "Please note, all quotes sent from
   * this account are valid for 14 days…". That footer alone supplies a "please" and
   * a "PO" to every outbound email ever sent.
   *
   * Measured before this cut: of 559 threads whose last message is Spartan's, 491
   * scored as asking for something, and 448 of those "asks" were the same phantom
   * purchase order read out of the footer. Two thirds of the mailbox was about to be
   * chased for a PO nobody had requested.
   *
   * Cut at the first sign-off line. Short and on its own line, so "Thanks for
   * confirming the times" is left alone while "Thanks," ends the message.
   */
  const SIGNOFF =
    /^(kind regards|best regards|warm regards|many thanks|all the best|best wishes|regards|cheers|thanks|thank you|speak soon|sent from my)\b[\s,.!*-]*$/i;

  /**
   * A LINE-BASED CUT CANNOT WORK ON THESE BODIES, because most of them have no lines.
   * The sweep's stripHtml collapses every run of whitespace to a single space
   * (n8n/spartan-sweep.workflow.json), so an HTML email arrives as one continuous
   * string and every newline heuristic silently does nothing.
   *
   * Measured: after the line-based cut, 106 threads still "asked" for a purchase
   * order, and all five sampled were the same standing footer — "…no products or
   * services are reserved until the booking is confirmed with a Purchase Order."
   *
   * So the tail is cut by CONTENT, at the earliest marker that nothing meaningful
   * ever follows. The first two are this tenant's own fixed footer and are the
   * highest-confidence markers available; the rest are sign-offs that no real request
   * appears after.
   */
  const TAIL = [
    /please note, all quotes sent from this account/i,
    /we now provide van services/i,
    /\[image: ?logo\]/i,
    /\bkind regards\b/i,
    /\bbest regards\b/i,
    /\bwarm regards\b/i,
    /\ball the best\b/i,
    /\bmany thanks\b[\s,!*]*(?:[A-Z*]|$)/,
  ];

  /**
   * An attribution line introduces a quoted block, and that block often carries NO
   * marker at all. Cutting the attribution alone leaves the other party's words
   * looking like ours, so everything from it onward goes.
   */
  const allLines = b.split(/\r?\n/);
  const stop = allLines.findIndex(
    (line) => ATTRIBUTION.test(line) || (line.trim().length <= 30 && SIGNOFF.test(line.trim()))
  );
  const cleanedRaw = (stop === -1 ? allLines : allLines.slice(0, stop))
    .filter((line) => !QUOTED.test(line))
    .filter((line) => !GREETING.test(line.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const tailAt = TAIL.reduce((best, re) => {
    const i = cleanedRaw.search(re);
    return i >= 0 && i < best ? i : best;
  }, cleanedRaw.length);
  const cleaned = cleanedRaw.slice(0, tailAt).trim();
  if (!cleaned) return null;

  const sentences = cleaned.split(/(?<=[.?!])\s+/);
  const asked = sentences.find(
    (s) => s.trim().endsWith("?") && !PLEASANTRY.test(s) && s.trim().length >= 12 && s.trim().length <= 200
  );
  if (asked) return asked.trim();
  if (PLEASANTRY.test(cleaned) && !/\?/.test(cleaned.replace(PLEASANTRY, ""))) return null;

  /**
   * THE PHRASE LIST ONLY RUNS IF THE MESSAGE ASKS FOR SOMETHING AT ALL.
   *
   * Measured: without this gate, "Spartan waiting for client" over the live corpus
   * went from 131 to 354 of 772 threads. The word "confirm" appears in nearly every
   * outbound email this company sends — "I have confirmed", "confirmed everything is
   * good to go", and the quote boilerplate on every signature — so a bare \bconfirm\b
   * matched almost everything and put two thirds of the mailbox in the client's debt.
   *
   * The list was written to NAME an ask once we had decided one existed; it is too
   * tolerant to DECIDE that, and needsResponse now leans on this function for exactly
   * that decision. So request framing has to be present first, and the phrase list
   * then says which request it was.
   */
  const REQUESTY =
    /\b(please|could you|can you|would you|will you|we(?:'ll| will) need|before we can|once you|kindly|send (?:me|us|over|through)|let us have|waiting (?:on|for))\b/i;

  /**
   * THE PHRASE MUST BE IN THE SENTENCE THAT ASKS, not merely somewhere in the email.
   *
   * Matching across the whole message read "Thank you for the PO, this is now updated
   * on our end. Please confirm the start time." as a request for a purchase order —
   * the PO had ARRIVED, and the thing actually wanted was two sentences later. Worse
   * was "PO received, thank you", which asks for nothing at all and still scored as a
   * PO chase. A chase for something the client already sent is the message that makes
   * them stop reading the ones that matter.
   */
  /**
   * "Please see the attached quote" is politeness about a document, not a request of
   * the client. A bare `please` counted it, so a message that attached a quote and
   * offered more crew read as an outstanding ask. Stripped before the test rather
   * than added to an exclusion list, so "Please could you…" and "Please confirm…"
   * are untouched.
   */
  const PRESENTATIONAL = /\bplease (see|find|note|disregard|ignore|refer to)\b/gi;

  /**
   * AN OPEN OFFER IS NOT AN OUTSTANDING ITEM, and the "if" is what gives it away.
   * "Please let me know if anything changes" asks the client to do nothing unless
   * something happens; chasing it means emailing someone to ask whether they have
   * anything to ask us. Live thread 19db58a19ee0cbc4 sat "owed" from April on exactly
   * this sentence. The whole clause goes, not just the verb, or the residue still
   * reads as a request.
   */
  const OFFER_IF = /\b(?:please\s+)?(?:let (?:me|us) know|get in touch|reach out|shout)\s+if\b[^.?!]*/gi;

  /**
   * THE CONDITIONAL COMES FIRST AS OFTEN AS IT COMES SECOND, and only catching one
   * order left two live drafts chasing on "If you need anything else in the future,
   * please let me know." OFFER_IF catches "let me know IF x"; these two catch the
   * inverted form — the conditional clause, then the courtesy trailing at the end of
   * the sentence with nothing asked for after it.
   *
   * OFFER_TRAIL is anchored to the sentence end on purpose: "please let me know the
   * start time" has an object and survives, which is the whole distinction between a
   * request and a sign-off.
   */
  /**
   * OFFER-SHAPED CONDITIONALS ONLY. A first version matched any "if you…" and ate
   * "If you're happy to confirm please send a PO and a site contact" whole — a real
   * request, stripped because it happened to start with a conditional. The clause has
   * to be an offer of further help, not merely conditional.
   */
  const OFFER_COND =
    /\bif (?:you need|you require|you want|there(?:'s| is| are)? anything|anything else)\b[^,.?!]*,?\s*/gi;
  const OFFER_TRAIL = /\b(?:please\s+)?(?:let (?:me|us) know|get in touch|reach out)\s*(?=[.!]?\s*$)/gi;

  const asking = sentences.find((s) =>
    REQUESTY.test(
      s.replace(PRESENTATIONAL, " ")
        .replace(OFFER_IF, " ")
        .replace(OFFER_COND, " ")
        .replace(OFFER_TRAIL, " ")
    )
  );
  if (!asking) return null;
  const sentence = asking.trim();

  const PHRASES: Array<[RegExp, string]> = [
    [/\bpurchase order\b|\bPO number\b|\bPO\b/i, "the purchase order number"],
    [/\bsite contact\b|\bcontact (number|details)\b/i, "the site contact details"],
    [/\bstart time\b|\bcall time\b/i, "the start time"],
    [/\bfinish time\b|\bend time\b/i, "the finish time"],
    [/\baddress\b|\bpostcode\b|\bvenue\b/i, "the venue address"],
    [/\bhow many\b|\bcrew numbers?\b|\bnumber of crew\b/i, "the crew numbers"],
    [/\bconfirm\b/i, "confirmation so the job can be booked in"],
  ];
  /**
   * Against the ASKING SENTENCE. Two earlier versions of this line were wrong in the
   * same direction: against the raw body it matched a client's question quoted in our
   * reply, and against the whole cleaned message it matched "thank you for the PO"
   * and chased a client for what they had just sent. The scope is the fix, not the
   * pattern list.
   */
  for (const [re, ask] of PHRASES) if (re.test(sentence)) return ask;
  /**
   * A request this list has no name for is still a request. Handing back the sentence
   * itself is more honest than a generic label and more honest than silence — the
   * model is told what was asked in the words it was asked in.
   */
  return sentence.length <= 200 ? sentence : null;
}
