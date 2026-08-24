// The engine's own words, said the way a person would say them.
//
// The notes and gate reasons are written for whoever is debugging the engine, and they
// read like it: "SlotTeam[0] start time not stated — defaulted to 08:00", "this message
// filled company_name, contact_name, contact_email", "(I1)". Every one of those is a real
// fact somebody on the booking desk needs — which block, what was assumed, what to check
// before confirming — wrapped in a field name they have never seen.
//
// SO THE REWRITE HAPPENS HERE, IN THE UI, NOT AT THE SOURCE. The engine's strings are also
// what a support ticket carries and what the ops email quotes, and they are matched on
// elsewhere; rewording them there is a change with a blast radius. This is a lens over the
// same text.
//
// ANYTHING UNRECOGNISED PASSES THROUGH UNCHANGED. A note nobody has taught this module
// about is still a note the desk has to read, and swallowing it because it did not match a
// pattern would hide exactly the unusual case that matters most. The raw string is also
// kept, so the UI can show it on hover — the plain wording is a courtesy, not a
// replacement for the record.

/** The engine's field names, in the words the desk uses for them. */
const FIELD_WORDS: Record<string, string> = {
  company_name: "company",
  contact_name: "contact name",
  contact_email: "email",
  contact_phone: "phone",
  location_text: "venue",
  customer_reference: "PO number",
  requests: "the crew request",
  date: "date",
  size: "crew size",
};

const fieldList = (csv: string): string =>
  csv.split(",").map((f) => FIELD_WORDS[f.trim()] || f.trim().replace(/_/g, " ")).join(", ");

/** SlotTeam[0] is the first crew block. Nobody outside the code counts from zero. */
const blockLabel = (i: string): string => `Block ${Number(i) + 1}`;

interface Rule {
  test: RegExp;
  say: (m: RegExpMatchArray) => string;
}

const RULES: Rule[] = [
  // ---- what was read out of the email
  {
    test: /^this message filled (.+)$/i,
    say: (m) => `Read from this email: ${fieldList(m[1])}`,
  },
  // ---- who and where it was matched to
  {
    test: /^company from a name resolved before \("(.+)"\)$/i,
    say: (m) => `Client matched to “${m[1]}” from a name seen before`,
  },
  {
    test: /^new venue "(.+)" — will be created in OnSinch on confirm$/i,
    say: (m) => `“${m[1]}” is a new venue — it will be created in OnSinch when this is confirmed`,
  },
  {
    test: /^new company "(.+)" — will be created in OnSinch on confirm$/i,
    say: (m) => `“${m[1]}” is a new client — it will be created in OnSinch when this is confirmed`,
  },
  {
    test: /^matched existing OnSinch order #(\d+)(?: \(job J(\d+)\))?(?: \(([^)]+)\))? — will update, not create$/i,
    say: (m) =>
      `Matches order #${m[1]}${m[2] ? ` (job J${m[2]})` : ""}${m[3] ? ` on the ${m[3]}` : ""} — that order will be updated rather than a second one raised`,
  },
  // ---- pricing
  {
    test: /^no pricing history for company (\d+) — using the standard rate card (\d+); CHECK IT BEFORE CONFIRMING \(I1\)$/i,
    say: (m) => `No past pricing for this client, so the standard rate card (${m[2]}) was used — check it before confirming`,
  },
  {
    test: /^"(.+)" is new, so it has no rate card yet — set one when confirming \(I1\)$/i,
    say: (m) => `“${m[1]}” is new and has no rate card — set one when confirming`,
  },
  // ---- what the engine had to assume about a block
  {
    test: /^SlotTeam\[(\d+)\] start time not stated — defaulted to (.+)$/i,
    say: (m) => `${blockLabel(m[1])}: no start time was given, so ${m[2]} was assumed`,
  },
  {
    test: /^SlotTeam\[(\d+)\] finish time not stated — defaulted to (.+)$/i,
    say: (m) => `${blockLabel(m[1])}: no finish time was given, so ${m[2]} was assumed`,
  },
  {
    test: /^SlotTeam\[(\d+)\] profession not recognised in "(.+)" — booked as Crew$/i,
    say: (m) => `${blockLabel(m[1])}: “${m[2]}” is not a role in OnSinch, so it was booked as general Crew`,
  },
  {
    test: /^SlotTeam\[(\d+)\] (.+)$/i,
    say: (m) => `${blockLabel(m[1])}: ${m[2]}`,
  },
  // ---- the crew-chief carve-out, which is the note most often misread as "extra crew"
  {
    test: /^crew-chief rule: team of (\d+) -> (\d+) \+ (\d+) chief[s]? \(headcount unchanged\)$/i,
    say: (m) => `Crew chief: the ${m[1]} asked for is ${m[2]} crew plus ${m[3]} chief — the same ${m[1]} people, not one more`,
  },
  // ---- contacts
  {
    test: /^new contact (.+) and the company has no contact on file — order raised against (.+) as a stand-in; add the real contact in OnSinch$/i,
    say: (m) => `${m[1]} is not on file and neither is anyone else at this company, so the order is against ${m[2]} for now — add the real contact in OnSinch`,
  },
  {
    test: /^no contact on file for (.+) — order raised against (.+) as a stand-in; add the real contact in OnSinch$/i,
    say: (m) => `${m[1]} is not on file, so the order is against ${m[2]} for now — add the real contact in OnSinch`,
  },
  // ---- disagreements between the model and the text it read
  {
    test: /^DISAGREEMENT — (.+): model (.+), text (.+)$/i,
    say: (m) => `The model and the email disagree about ${m[1]}: it read ${m[2]}, the email says ${m[3]} — the email won`,
  },
  // ---- what could not be done to a live order
  {
    test: /^crew and times must be applied by hand on OnSinch order #(\d+)(.*)$/i,
    say: (m) => `The crew and times on order #${m[1]} have to be changed by hand in OnSinch${m[2] ? ` —${m[2].replace(/^ —/, "")}` : ""}`,
  },
  {
    test: /^crew\/time change applied to order #(\d+) in place — (.+)$/i,
    say: (m) => `Order #${m[1]} was corrected in place: ${m[2]}`,
  },
  {
    test: /^crew\/time change NOT applied — (.+)$/i,
    say: (m) => `The crew or time change was NOT applied: ${m[1]}`,
  },
];

/** One note, in plain words. Unrecognised notes are returned exactly as they came. */
export function noteWords(note: string): string {
  const n = (note || "").trim();
  for (const r of RULES) {
    const m = n.match(r.test);
    if (m) return r.say(m);
  }
  return n;
}

/**
 * Why a message never reached the model, or what the model made of it.
 *
 * The bracketed tag is the engine's rule name and the useful part is what follows it, so
 * the tag becomes the sentence: `[own-mail]` is "sent by Spartan itself".
 */
export function gateWords(reason?: string | null): string {
  const r = (reason || "").trim();
  if (!r) return "";
  let m = r.match(/^filtered before the model \[own-mail\]: sent by Spartan \((.+)\)$/i);
  if (m) return `Skipped before the model: Spartan sent this itself, from ${m[1]}`;
  m = r.match(/^filtered before the model \[machine-sender\]: unrepliable address \((.+)\)$/i);
  if (m) return `Skipped before the model: ${m[1]} is a no-reply address, so there is nobody to answer`;
  m = r.match(/^filtered before the model \[([a-z-]+)\]: (.+)$/i);
  if (m) return `Skipped before the model (${m[1].replace(/-/g, " ")}): ${m[2]}`;
  m = r.match(/^machine mail from (.+) — not a client enquiry$/i);
  if (m) return `Automated mail from ${m[1]} — not a client enquiry`;
  m = r.match(/^triage WOULD have skipped this \[([a-z-]+)\]: (.+?) — shadow mode, read anyway$/i);
  if (m) return `Triage would have skipped this (${m[1].replace(/-/g, " ")}: ${m[2]}), but shadow mode is on, so it was read anyway`;
  m = r.match(/^this message filled (.+)$/i);
  if (m) return `Read from this email: ${fieldList(m[1])}`;
  return r;
}

/** What the engine decided this thread is, and what that means for the desk. */
export function classificationWords(c?: string | null): { label: string; gloss: string } {
  switch ((c || "").trim()) {
    case "new-job":
      return { label: "New job", gloss: "a first request for crew on this thread" };
    case "update":
      return { label: "A change to an existing job", gloss: "the crew, times or venue have moved" };
    case "confirmation-only":
      return { label: "Confirmation only", gloss: "nothing to book — the client is acknowledging" };
    case "not-a-job":
      return { label: "Not a job", gloss: "no crew is being asked for" };
    default:
      return { label: (c || "unknown").trim(), gloss: "" };
  }
}

/** Priority, said as urgency rather than as a level. */
export function priorityWords(p?: string | null): string {
  switch ((p || "").trim()) {
    case "high": return "High — answer today";
    case "medium": return "Medium";
    case "low": return "Low";
    default: return (p || "").trim();
  }
}
