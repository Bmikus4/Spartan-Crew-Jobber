// ============================================================================
// What a TV card says about a decision, in plain sentences (ADDENDUM §13.2 change 5).
// ----------------------------------------------------------------------------
// The owner, 30 Oct: "clear and descriptive about what the order is and what needs done on it. And they should not
// be intentionally technical or vague. They should just be plain and explain things outright." So a card says two
// things, each from fixed templates filled from structured fields only (the request, the operation), never from
// email text and never the planner's own reasoning (DECISIONS V8: on 10-11, 20 of 40 cards showed text like
// `request 1 crew: "another 3 crew" reads as null, not 3`):
//   - the ask: what the job is and what needs doing, every shift listed, nothing cut short;
//   - the check: the one thing a person must look at, as a sentence. A reason no template knows says "Read the
//     email": an unknown reason never reaches the screen as text, so one added to the planner later cannot leak.
// ============================================================================
import type { Decision } from "../v2/interpret/plan";
import type { Interpretation, Request } from "../v2/interpret/interpret";
import type { RunResult } from "../v2/bot/run";
import type { Op } from "../v2/bot/ops";
import { tradeOf, PROFESSION_NAME } from "../v2/interpret/professions";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const date = (iso: string) => new Date(`${iso}T12:00:00Z`);
const day = (iso: string) => { const d = date(iso); return Number.isNaN(d.getTime()) ? "" : `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
/** "Fri 6 and Mon 9 Nov", the month once when every day shares it. */
function days(isos: string[]): string {
  const ds = [...new Set(isos)].sort();
  const sameMonth = ds.every((x) => x.slice(0, 7) === ds[0].slice(0, 7));
  const parts = ds.map((x) => (sameMonth ? day(x).replace(/ \w+$/, "") : day(x)));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  return sameMonth && ds.length ? `${list} ${MON[date(ds[0]).getUTCMonth()]}` : list;
}
/** "6pm", "7:45am", "midnight", "noon". */
function clock(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]), min = m[2];
  if (h % 24 === 0 && min === "00") return "midnight";
  if (h === 12 && min === "00") return "noon";
  return `${h % 12 || 12}${min === "00" ? "" : `:${min}`}${h < 12 ? "am" : "pm"}`;
}
const span = (start?: string, end?: string) => (start && end ? `${clock(start)} to ${clock(end)}` : start ? `from ${clock(start)}` : end ? `until ${clock(end)}` : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 || /s$|^crew$/.test(w) ? "" : "s"}`;
const sentence = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? "" : "."}`;

/**
 * EVERY BOOKING IN ONE PLAIN LINE (Ben, 19 Nov: "We can summarize 'Add (total number of crew) over (this many
 * dates)'", then "all descriptions should be written with such simplicity"). A 12-shift booking listed every shift and
 * was cut off after two lines, and each shift split its chief out as "1 crew and 5 crew". Now:
 *   one shift          "Book 6 crew on Fri 4 Dec, 10am to noon"
 *   one date, several  "Book 15 crew over 4 shifts on Fri 4 Dec"
 *   two or three dates "Book 12 crew on Fri 4 and Sat 5 Dec"
 *   four dates or more "Book 106 crew over 6 dates"
 * The total is said only when every shift has a count; otherwise the shifts are counted, so no number is guessed. A
 * crew chief is inside the headcount (V13). Null when nothing is known, so the caller's plain fallback stands.
 */
function simply(verb: string, shifts: Array<{ date?: string; start?: string; end?: string; crew?: number }>): string | null {
  if (!shifts.length || shifts.every((s) => !s.date && !s.crew && !s.start)) return null;
  const dates = [...new Set(shifts.map((s) => s.date).filter((d): d is string => !!d))].sort();
  const total = shifts.every((s) => s.crew && s.crew > 0) ? shifts.reduce((a, s) => a + (s.crew ?? 0), 0) : null;
  if (shifts.length === 1) {
    const s = shifts[0], when = span(s.start, s.end);
    return [`${verb} ${total ? `${total} crew` : "crew"}${s.date ? ` on ${day(s.date)}` : ""}`, when].filter(Boolean).join(", ");
  }
  const what = total ? `${total} crew` : plural(shifts.length, "shift");
  if (dates.length === 1) return total ? `${verb} ${what} over ${shifts.length} shifts on ${day(dates[0])}` : `${verb} ${what} on ${day(dates[0])}`;
  if (dates.length >= 2 && dates.length <= 3) return `${verb} ${what} on ${days(dates)}`;
  return `${verb} ${what} over ${dates.length ? plural(dates.length, "date") : "several dates"}`;
}

const tradeWord = (r: Request) => { const t = tradeOf(r.trade); return t && !t.asCrew ? t.label : null; };
const crewOf = (n: number | undefined, r: Request) => (n ? plural(n, tradeWord(r) ?? "crew") : "");
const dayOf = (r: Request) => r.target?.date ?? r.date;

/** What the client asks for, one sentence per kind of request, every shift in it. */
function asked(i: Interpretation | null, reply: boolean, fresh: boolean): string | null {
  const rs = i?.requests ?? [];
  const by = (a: Request["action"]) => rs.filter((r) => r.action === a);
  const out: string[] = [];
  const asks = by("new_shift").map((r) => ({ date: r.date, start: r.start, end: r.end, crew: r.crew }));
  if (i?.intent === "quote_request") out.push(simply("Send a quote for", asks) ?? "Price this and send a quote");
  else if (by("new_shift").length) out.push(simply(fresh ? "Book" : "Add", asks) ?? (fresh ? "Book a new order" : "Add a shift to the order"));
  for (const r of by("change_times")) {
    const from = r.target?.date, to = r.date, when = span(r.start, r.end);
    if (from && to && from !== to) out.push(`Move the ${day(from)} shift to ${day(to)}${when ? `, ${when}` : ""}`);
    else if (r.start && r.end) out.push(`Change the times${dayOf(r) ? ` on ${day(dayOf(r)!)}` : ""}: ${when}`);
    else if (r.start || r.end) out.push(`Change the ${r.start ? "start" : "finish"}${dayOf(r) ? ` on ${day(dayOf(r)!)}` : ""} to ${clock((r.start ?? r.end)!)}`);
    else out.push(`Change the times${dayOf(r) ? ` on ${day(dayOf(r)!)}` : ""}`);
  }
  for (const r of by("change_crew")) {
    const on = dayOf(r) ? ` on ${day(dayOf(r)!)}${r.target?.start ? ` (the ${clock(r.target.start)} call)` : ""}` : "";
    const making = r.crew && (r.crew_add || r.crew_remove) ? `, making ${r.crew}` : "";
    if (r.crew_add) out.push(`Add ${crewOf(r.crew_add, r)}${on}${making}`);
    else if (r.crew_remove) out.push(`Stand down ${crewOf(r.crew_remove, r)}${on}${making}`);
    else out.push(r.crew ? `Make it ${crewOf(r.crew, r)}${on}` : `Change the crew${on}`);
  }
  const cancels = by("cancel_shift").map(dayOf).filter((x): x is string => !!x);
  if (by("cancel_shift").length) out.push(!cancels.length ? "Cancel a shift" : new Set(cancels).size === 1 ? `Cancel the shift on ${day(cancels[0])}` : new Set(cancels).size === 2 ? `Cancel both shifts, ${days(cancels)}` : `Cancel the shifts on ${days(cancels)}`);
  if (by("other").length && !out.length) out.push("The client asks for something else: see the email");
  if (!out.length) {
    if (i?.intent === "cancellation") out.push("Cancel the booking");
    else if (i?.intent === "booking") out.push(fresh ? "Book a new order" : "Add to the order");
    else if (i?.intent === "change") out.push("Make the change the client asks for");
    else if (reply) out.push("Answer the client's question");
    // A PO on its own is a set-PO update, never a change to the shifts (O51 G1).
    else if (i?.po) out.push(`Add PO ${i.po} to the order`);
  }
  return out.length ? out.map(sentence).join(" ") : null;
}

/** What the system wrote, or would write, from its operations. */
function wrote(ops: Op[], why: string[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.kind === "create_order") {
      // Every seat counts toward the crew, the chief included (V13): "1 crew and 5 crew" was one shift of 6.
      const shifts = op.shifts.map((s) => ({ date: s.date, start: s.start, end: s.end, crew: s.positions.reduce((a, p) => a + p.size, 0) }));
      parts.push(`${simply("Book", shifts) ?? "Book a new order"}${op.po ? `, PO ${op.po}` : ""}`);
    } else if (op.kind === "set_position_times") parts.push(`Change the times on ${day(op.date)}: ${span(op.start, op.end)}`);
    else if (op.kind === "add_shift") { /* every added shift is said once, together, below */ }
    else if (op.kind === "cancel_position") parts.push(why.some((w) => /crew chief removed/.test(w)) ? "Remove the crew chief" : "Cancel the shift");
    else if (op.kind === "add_position") parts.push(op.position.role === "crew_chief" ? `Add a crew chief on ${day(op.date)}` : `Add ${plural(op.position.size, PROFESSION_NAME[op.position.profession_id] ?? "crew")} on ${day(op.date)}`);
    else if (op.kind === "set_position_size") { const n = why.map((w) => /(\d+) crew in all/.exec(w)?.[1]).find(Boolean); parts.push(`Make it ${n ?? op.size} crew`); }
    else if (op.kind === "set_po") parts.push(`Set the PO to ${op.po}`);
  }
  // Added shifts in one plain line, like a booking (Ben, 19 Nov: "all descriptions should be written with such simplicity").
  const adds = ops.filter((o): o is Extract<Op, { kind: "add_shift" }> => o.kind === "add_shift").map((o) => ({ date: o.date, start: o.start, end: o.end, crew: o.positions.reduce((a, p) => a + p.size, 0) }));
  const added = adds.length ? simply("Add", adds) : null;
  return [...new Set([...parts, ...(added ? [added] : [])])].map(sentence).join(" ");
}

/** Each reason the planner or grounding gives, as the person's check. First match wins; null needs no check. */
const CHECKS: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
  [/no venue in the email/, () => "The email does not say where."],
  [/no day the client wrote/, () => "The email does not give a date."],
  [/no start time the client wrote/, () => "The email does not give a start time."],
  [/no end time or duration the client wrote/, () => "The email does not give a finish time."],
  [/no crew count the client wrote/, () => "The email does not say how many crew."],
  [/no new time or length the client wrote/, () => "The email does not give the new time."],
  [/(target date|date): "[^"]+" reads as/, (m) => (m[1] === "date" ? "The date in the email could not be read: check it." : "Which day the client means could not be read: check it.")],
  [/(target start|start|end): "[^"]+" reads as/, (m) => `The ${m[1] === "end" ? "finish" : m[1] === "start" ? "start" : "shift's"} time in the email could not be read: check it.`],
  [/crew(?: increase| decrease)?: "[^"]+" reads as/, () => "The crew count in the email could not be read: check it."],
  [/duration: "[^"]+" reads as/, () => "The length of the shift in the email could not be read: check it."],
  [/(start|end|duration|crew|date|venue)[^:]*: "[^"]+" is not in the email/, (m) => `The ${({ start: "start time", end: "finish time", duration: "length of the shift", crew: "crew count", date: "date", venue: "venue" } as Record<string, string>)[m[1]]} was not found in the email's own words: check it.`],
  [/no words cancelling the whole shift/, () => "The email does not clearly cancel the whole shift: check it."],
  [/and nothing more does not single out/, () => "The day alone does not say which of the client's shifts is meant: pick one."],
  [/\d+ changes in one email/, () => "Several changes to one shift in one email: make them by hand."],
  [/possibly the same booking/, () => "A shift that day starts at another time: it may be the same booking, so check it."],
  [/asked for a quote/, () => null],
  [/request is unclear/, () => "The request is unclear: read the email and reply."],
  [/no single client company for/, () => "The sender is not a client in OnSinch yet."],
  [/(\d+) OnSinch venues are named/, (m) => (m[1] === "0" ? "The venue in the email is not in OnSinch." : `${m[1]} OnSinch venues share the venue's name: pick one.`)],
  [/(\d+) shifts on \S+ could be the one meant/, (m) => `${m[1]} shifts that day could be the one meant: pick one.`],
  [/(\d+) of the client's orders have a shift on/, (m) => `${m[1]} of the client's orders have a shift that day: pick one.`],
  [/no booking for this client on/, () => "The client has no booking that day."],
  [/no shift on \S+/, () => "The order has no shift that day."],
  [/R(\d+) not found/, (m) => `R${m[1]} is not in OnSinch.`],
  [/R(\d+) belongs to another client/, (m) => `R${m[1]} belongs to another client.`],
  [/the email names (\d+) orders/, (m) => `The email names ${m[1]} orders.`],
  [/no order is named/, () => "The email names no order."],
  [/is already over: a person adjusts it/, () => "That day is already over: adjust it by hand."],
  [/the client confirmed .+, and no order holds it yet/, () => "The client has confirmed, and no order holds it yet."],
  [/the client confirmed a change from the thread/, () => "The client confirmed a change from earlier in the thread: make it by hand."],
  [/already has PO (\S+); the email gives (\S+)/, (m) => `The email gives PO ${m[2]}; the order has ${m[1]}.`],
  [/part of this is already booked \(([^)]+)\)/, (m) => `Part of it is already booked in ${m[1]}.`],
  [/crew chiefs$/, () => "The shift has 2 crew chiefs: change it by hand."],
  [/(\d+) crew positions$/, (m) => `The shift has ${m[1]} crew positions: change it by hand.`],
  [/makes \d+, not the \d+ written/, () => "The crew numbers in the email do not add up."],
  [/the email says (\d+) crew, the shift has (\d+)/, (m) => `The email says ${m[1]} crew; the shift has ${m[2]}.`],
  [/(\d+)(?: crew)? (?:on one shift )?is not a shape the system builds/, () => "10 or more crew on one shift: build it by hand."],
  [/crew chief was asked for on a crew of 3/, () => "A crew chief is asked for on a crew of 3 or fewer."],
  [/with no plain crew/, () => "The shift has no plain crew: build it by hand."],
  [/locations; which one/, () => "The order has several venues: pick one."],
  [/linked to order/, () => "The linked order could not be read: check OnSinch."],
  [/one call at \d+ venues/, () => "One call at two venues: check it."],
  [/count other than adding/, () => "A change of profession: do it by hand."],
  [/could not read this email/, () => "The system could not read this email."],
  [/sent with a later email|later client message/, () => null],
];

const READ_THE_EMAIL = "Read the email.";
/** The check a reason means, "Read the email" when no template knows it, null when it needs none. */
export function checkOf(reason: string): string | null {
  for (const [re, f] of CHECKS) { const m = re.exec(reason); if (m) return f(m); }
  return READ_THE_EMAIL;
}

/** Notes kept with a write that a person checking it should see. */
const NOTE_CHECKS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/asked for (.+): no live OnSinch profession, booked as Crew/, (m) => `The client asked for ${m[1]}; it is booked as Crew.`],
  [/^(.+) booked as (.+?), ops' most used/, (m) => `${m[1]} is booked as ${m[2]}: check it.`],
  [/confirms the booking asked for earlier/, () => "Booked from the client's earlier email."],
  [/the day \S+ is from the subject/, () => "The date was taken from the email's subject line."],
  [/the day \S+ is from the client's earlier email/, () => "The date is from the client's earlier email."],
  [/the venue is from the client's earlier email/, () => "The venue is from the client's earlier email."],
];
const noteCheck = (why: string[]) => { for (const w of why) for (const [re, f] of NOTE_CHECKS) { const m = re.exec(w); if (m) return f(m); } return null; };

export type NoteInput = { decision: Decision; grounded: Interpretation | null; executed: RunResult[] | null; written: boolean; fresh?: boolean };
/**
 * THE PEN (Ben, 19 Nov): who enters the change in OnSinch, as an icon, not a sentence. "todo": the system planned it and
 * did not write it, so a person enters it (orange). "done": the system wrote it, so a person checks it (green). Null
 * when the system made no plan of its own (the card's description is the whole job).
 */
export type Pen = "todo" | "done" | null;
export type Note = { ask: string | null; check: string | null; pen?: Pen };

export function cardNote({ decision: d, grounded, executed, written, fresh = true }: NoteInput): Note {
  if (d.kind === "write") {
    const what = wrote(d.ops.map((o) => o.op), d.why);
    if (written) return { ask: what ? `The system did this: ${what}` : null, check: noteCheck(d.why), pen: "done" };
    const stopped = executed?.find((r) => r.status !== "verified");
    return { ask: what || null, check: stopped ? (executed!.some((r) => r.status === "verified") ? "The system stopped partway: check OnSinch." : "The system could not write it: do it by hand.") : null, pen: "todo" };
  }
  if (d.kind === "handoff") {
    const confirmed = d.reasons.some((r) => /the client confirmed .+, and no order holds it yet/.test(r));
    const ask = asked(grounded, !!d.reply, fresh);
    // ONE DESCRIPTION (Ben, 19 Nov): a check is shown only when it names something to look at. "Read the email" (a reason
    // no template knows) and "Not written: do it by hand" (every card while writes are off) told staff nothing; the first
    // stays only on a card that would otherwise say nothing at all.
    const check = d.reasons.flatMap((r) => r.split("; ")).map(checkOf).find((c): c is string => !!c && c !== READ_THE_EMAIL) ?? (ask ? null : READ_THE_EMAIL);
    return { ask: ask && confirmed ? `${ask} The client has confirmed.` : ask, check: confirmed && check === "The client has confirmed, and no order holds it yet." ? "No order holds it yet." : check };
  }
  return { ask: null, check: null };
}
