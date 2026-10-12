// ============================================================================
// The one line a TV card says about a rebuild decision.
// ----------------------------------------------------------------------------
// SIMPLE, RELIABLE, INFORMATIVE, AND NEVER THE SYSTEM'S OWN REASONING (Ben, 10-11). Until then
// the card printed the planner's reasons as written: of 40 cards on 10-11, 20 showed text like
// `request 1 crew: "another 3 crew" reads as null, not 3`, message ids or "(shadow)", and 12
// ran past what the tile shows.
//
// The line is WHAT was asked or done, then at most one CHECK for the person. Both come from
// fixed phrases filled from structured fields (the request, the operation). A reason no phrase
// below recognises becomes "Read the email": an unknown reason never reaches the screen as
// text, so a reason added to the planner later cannot leak by being forgotten here.
// The tile already shows the client, R and J numbers, the date, the crew count and the venue,
// so the line repeats none of them unless it is the change itself.
// ============================================================================
import type { Decision } from "../v2/interpret/plan";
import type { Interpretation, Request } from "../v2/interpret/interpret";
import type { RunResult } from "../v2/bot/run";
import type { Op } from "../v2/bot/ops";
import { tradeOf, PROFESSION_NAME } from "../v2/interpret/professions";

export const NOTE_MAX = 80;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? "" : `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, ""));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 || /s$/.test(w) ? "" : "s"}`;

/** Each reason the planner or grounding gives, as the person's check. First match wins. */
const CHECKS: Array<[RegExp, (m: RegExpExecArray) => string | null]> = [
  [/no venue in the email/, () => "No venue given"],
  [/no day the client wrote/, () => "No date given"],
  [/no start time the client wrote/, () => "No start time given"],
  [/no end time or duration the client wrote/, () => "No finish time given"],
  [/no crew count the client wrote/, () => "No crew count given"],
  [/no new time or length the client wrote/, () => "No new time given"],
  [/(target date|date): "([^"]+)" reads as/, (m) => `${m[1] === "date" ? "Check the date" : "Check which day"}: "${clip(m[2], 28)}"`],
  [/(target start|start|end): "([^"]+)" reads as/, (m) => `Check the ${m[1] === "end" ? "finish" : m[1] === "start" ? "start" : "shift's"} time: "${clip(m[2], 24)}"`],
  [/crew(?: increase| decrease)?: "([^"]+)" reads as/, (m) => `Check the crew count: "${clip(m[1], 24)}"`],
  [/asked for a quote/, () => "Price it and send the quote"],
  [/request is unclear/, () => "Read the email and reply"],
  [/no single client company for (\S+)/, (m) => `New client, not in OnSinch: ${clip(m[1], 40)}`],
  [/(\d+) OnSinch venues are named "([^"]+)"/, (m) => (m[1] === "0" ? `Venue not in OnSinch: "${clip(m[2].split(",")[0], 30)}"` : `${m[1]} OnSinch venues called "${clip(m[2].split(",")[0], 26)}"`)],
  [/(\d+) shifts on \S+ could be the one meant/, (m) => `${m[1]} shifts that day, pick one`],
  [/(\d+) of the client's orders have a shift on/, (m) => `${m[1]} orders that day, pick one`],
  [/no booking for this client on/, () => "No booking found that day"],
  [/no shift on \S+/, () => "No shift that day on this order"],
  [/R(\d+) not found/, (m) => `R${m[1]} not found in OnSinch`],
  [/R(\d+) belongs to another client/, (m) => `R${m[1]} belongs to another client`],
  [/the email names (\d+) orders/, (m) => `The email names ${m[1]} orders`],
  [/no order is named/, () => "Which order? None named"],
  [/already has PO (\S+); the email gives (\S+)/, (m) => `PO ${clip(m[2], 20)} given, order has ${clip(m[1], 20)}`],
  [/part of this is already booked \(([^)]+)\)/, (m) => `Part already booked in ${clip(m[1], 30)}`],
  [/crew chiefs$/, () => "Shift has 2 crew chiefs, change by hand"],
  [/(\d+) crew positions$/, (m) => `Shift has ${m[1]} crew positions, change by hand`],
  [/makes \d+, not the \d+ written/, () => "Crew numbers don't add up, check"],
  [/the email says (\d+) crew, the shift has (\d+)/, (m) => `Email says ${m[1]} crew, ${m[2]} booked`],
  [/(\d+)(?: crew)? (?:on one shift )?is not a shape the system builds/, () => "10 or more crew, build by hand"],
  [/crew chief was asked for on a crew of 3/, () => "Crew chief asked for on 3 or fewer"],
  [/with no plain crew/, () => "No plain crew on the shift, build by hand"],
  [/locations; which one/, () => "Order has several venues, pick one"],
  [/linked to order/, () => "Linked order unreadable, check OnSinch"],
  [/one call at \d+ venues/, () => "One call at two venues, check"],
  [/count other than adding/, () => "Profession change, do by hand"],
  [/OnSinch has no (.+) profession yet/, (m) => `No ${clip(m[1], 24)} profession in OnSinch yet`],
  [/could not read this email/, () => "System couldn't read this email"],
  [/sent with a later email|later client message/, () => null],
];

/** The check a reason means, "Read the email" when no phrase knows it, null when it needs none. */
export function checkOf(reason: string): string | null {
  for (const [re, f] of CHECKS) { const m = re.exec(reason); if (m) return f(m); }
  return "Read the email";
}

/** Notes kept with a write that a person checking it should see. */
const NOTE_CHECKS: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/asked for (.+): no live OnSinch profession, booked as Crew/, (m) => `Asked for ${m[1]}, booked as Crew`],
  [/^(.+) booked as (.+?), ops' most used/, (m) => `${m[1]} booked as ${m[2]}, check`],
  [/confirms the booking asked for earlier/, () => "Booked from their earlier email"],
  [/the day \S+ is from the subject/, () => "Date taken from the subject"],
  [/the day \S+ is from the client's earlier email/, () => "Date from their earlier email"],
  [/the venue is from the client's earlier email/, () => "Venue from their earlier email"],
];
const noteCheck = (why: string[]) => { for (const w of why) for (const [re, f] of NOTE_CHECKS) { const m = re.exec(w); if (m) return f(m); } return null; };

const tradeWord = (r: Request) => { const t = tradeOf(r.trade); return t && !t.asCrew ? t.label : null; };

/** What the client asked for, from the grounded requests. */
function asked(i: Interpretation | null, reply: boolean): string | null {
  const rs = i?.requests ?? [];
  const r = rs[0];
  if (i?.intent === "quote_request") return `Quote request${r?.start ? ` from ${r.start}${r.end ? ` to ${r.end}` : ""}` : ""}`;
  if (!r) return i?.intent === "cancellation" ? "Cancellation" : i?.intent === "booking" ? "New booking" : i?.intent === "change" ? "Change" : reply ? "Question from the client" : null;
  const more = rs.length > 1 ? `, +${rs.length - 1} more` : "";
  const t = tradeWord(r);
  switch (r.action) {
    case "new_shift": return `New booking${r.start && r.end ? ` ${r.start}-${r.end}` : ""}${t ? `, ${r.crew ? `${r.crew} ` : ""}${t}` : ""}${more}`;
    case "change_times":
      if (r.target?.date && r.date && r.date !== r.target.date) return `Move ${day(r.target.date)} to ${day(r.date)}${more}`;
      return `${r.start && r.end ? `Times to ${r.start}-${r.end}` : r.start ? `Start to ${r.start}` : r.end ? `Finish to ${r.end}` : "Time change"}${more}`;
    case "change_crew":
      if (r.crew_add) return `Add ${r.crew_add} ${t ?? "crew"}${more}`;
      if (r.crew_remove) return `Stand down ${r.crew_remove} ${t ?? "crew"}${more}`;
      return `${r.crew ? `Change to ${r.crew} crew` : "Crew change"}${more}`;
    case "cancel_shift": return `Cancel ${r.target?.date || r.date ? day((r.target?.date ?? r.date)!) : "a shift"}${more}`;
    default: return reply ? "Question from the client" : null;
  }
}

/** What the system wrote, from its operations. */
function wrote(ops: Op[], why: string[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op.kind === "create_order") {
      const s = op.shifts[0];
      const profs = s.positions.filter((p) => p.profession_id !== "1" && p.profession_id !== "36").map((p) => `${p.size} ${PROFESSION_NAME[p.profession_id] ?? "other"}`);
      parts.push(`Booked ${s.start}-${s.end}${profs.length ? `, ${profs.join(", ")}` : ""}${op.shifts.length > 1 ? `, +${op.shifts.length - 1} more shift${op.shifts.length > 2 ? "s" : ""}` : ""}${op.po ? `, PO ${op.po}` : ""}`);
    } else if (op.kind === "set_position_times") { const t = `Times now ${op.start}-${op.end}`; if (!parts.includes(t)) parts.push(t); }
    else if (op.kind === "add_shift") parts.push(`Shift added ${day(op.date)} ${op.start}-${op.end}`);
    else if (op.kind === "cancel_position") { if (!parts.some((p) => /cancel|chief removed/.test(p))) parts.push(why.some((w) => /crew chief removed/.test(w)) ? "Crew chief removed" : "Shift cancelled"); }
    else if (op.kind === "add_position") parts.push(op.position.role === "crew_chief" ? "Crew chief added" : `${plural(op.position.size, PROFESSION_NAME[op.position.profession_id] ?? "crew")} added`);
    else if (op.kind === "set_position_size") { const n = why.map((w) => /(\d+) crew in all/.exec(w)?.[1]).find(Boolean); parts.unshift(`Now ${n ?? op.size} crew`); }
    else if (op.kind === "set_po") parts.push(`PO ${op.po} added`);
  }
  return [...new Set(parts)].join(", ");
}

export type NoteInput = { decision: Decision; grounded: Interpretation | null; executed: RunResult[] | null; written: boolean };

export function cardNote({ decision: d, grounded, executed, written }: NoteInput): string {
  let what: string | null;
  let check: string | null;
  if (d.kind === "write") {
    const ops = d.ops.map((o) => o.op);
    what = wrote(ops, d.why);
    if (written) check = noteCheck(d.why);
    else {
      const stopped = executed?.find((r) => r.status !== "verified");
      check = stopped ? (executed!.some((r) => r.status === "verified") ? "System stopped partway, check OnSinch" : "System couldn't write it, do it by hand") : "Not written, do it by hand";
    }
  } else if (d.kind === "handoff") {
    what = asked(grounded, !!d.reply);
    const checks = [...new Set(d.reasons.flatMap((r) => r.split("; ")).map(checkOf).filter((c): c is string => !!c))];
    check = checks.length ? checks[0] + (checks.length > 1 ? ` (+${checks.length - 1} more)` : "") : what ? null : "Read the email";
  } else {
    what = null; check = null;
  }
  const line = [what, check].filter(Boolean).join(" · ");
  if (line.length <= NOTE_MAX) return line;
  // Too long for the tile: the check is what the person acts on, so the description gives way.
  const room = NOTE_MAX - (check ? check.length + 3 : 0);
  return [what && room >= 12 ? clip(what, room) : null, check ? clip(check, NOTE_MAX) : null].filter(Boolean).join(" · ");
}
