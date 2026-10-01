// ============================================================================
// A draft that sends a document carries [ATTACH HERE] for the person who sends it.
// ----------------------------------------------------------------------------
// Ben, 2026-09-30: a draft that refers to something attached, or says a colleague will
// follow up with it, is written for the team to add the attachment to the draft — every
// one carries a note reading [ATTACH HERE], in capitals, and it must still read well.
// The engine cannot attach a file; a person adds it before sending, and the marker is
// how they know there is one to add.
//
// The prompt asks for the marker; this guarantees it, because a prompt is not a
// guarantee. It reacts only to SPARTAN sending something — "thanks for the PO you
// attached" is the client's document and must not ask ops to attach anything.
// ============================================================================

export const ATTACH_TOKEN = "[ATTACH HERE]";

const SENDING: RegExp[] = [
  /\b(?:find|see)\b[^.<]{0,60}\b(?:attached|enclosed)\b/i, // "please find the quote attached"
  /\b(?:i|we)(?:'ve|\s+have)?\s+(?:attached|enclosed)\b/i, // "I've attached", "we have enclosed"
  /\battached\s+(?:is|are|you'?ll\s+find)\b/i, // "attached is the invoice"
  /\b(?:i'?m|we'?re|i\s+am|we\s+are)\s+attaching\b/i,
  /\b(?:sen[dt]|follow(?:ing)?)\b[^.<]{0,30}\bseparately\b/i, // "will be sent over separately"
  /\bcolleague\s+will\s+(?:send|forward|share|follow\s+up)\b/i, // the old rule's own wording
];

/** True when the draft says Spartan is sending a document with it. */
export function sendsADocument(html: string): boolean {
  const text = String(html ?? "").replace(/<[^>]+>/g, " ");
  return SENDING.some((re) => re.test(text));
}

/**
 * The draft with its marker: any spelling of it normalised to capitals, and one added
 * before the sign-off when the draft sends a document and carries none.
 */
export function markAttachments(html: string): string {
  let out = String(html ?? "").replace(/\[\s*attach(?:ment)?\s+(?:it\s+)?here\s*\]/gi, ATTACH_TOKEN);
  if (out.includes(ATTACH_TOKEN) || !sendsADocument(out)) return out;
  const marker = `<p>${ATTACH_TOKEN}</p>`;
  // Before the sign-off paragraph, which every Spartan draft ends with; failing that,
  // inside the closing </div>; failing that, at the end.
  const signOff = out.search(/<p>\s*(?:thanks|many thanks|kind regards|best|all the best)[^<]*<br\s*\/?>\s*spartan crew/i);
  if (signOff >= 0) return out.slice(0, signOff) + marker + "\n  " + out.slice(signOff);
  const close = out.lastIndexOf("</div>");
  if (close >= 0) return out.slice(0, close) + marker + "\n" + out.slice(close);
  return out + marker;
}
