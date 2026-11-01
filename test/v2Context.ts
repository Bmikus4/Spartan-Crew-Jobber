// The reader's context (context.ts) and how grounding checks what it picks (interpret.ts).
import { ground } from "../app/lib/v2/interpret/interpret";
import type { ReadContext } from "../app/lib/v2/interpret/context";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const SENT = "2026-10-10T11:35:00Z";
const read: ReadContext = {
  thread: [{ who: "spartan", at: "2026-10-09T10:00:00Z", text: "We have booked 4 x Crew 18:00-23:00 at Christie's on Sunday 11th." }],
  bookings: [{ order: "R11224", order_id: 16100, job_id: 1, name: "Creative Technology @ Christie's", po: "", shifts: [{ shift_id: 41611, name: "Crew", date: "2026-10-11", start: "18:00", end: "23:00", place_id: 9, venue: "Christie's", positions: "1 Crew Chief + 3 Crew" }] }],
  venues: [{ place_id: 9, name: "Christie's", address: "8 King Street", uses: 3 }],
};
const G = (v: any, quote: string) => ({ value: v, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };

console.log("[1] a picked shift is checked and stands for its target");
{
  const x: any = { intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R11224", shift_id: 41611, start: G("17:00", "5pm"), end: G("22:00", "Finishing an hour earlier"), target: { quote: "the call for tomorrow", date: null, start: G("18:00", "the call for tomorrow") } }] };
  const g = ground(x, "Any chance we could move the call for tomorrow to be 5pm instead of 6pm? Finishing an hour earlier aswell.", SENT, { subject: "Re: Christie's October", read });
  const r = g.requests[0];
  ok(r.order_id === 16100 && r.shift_id === 41611 && r.date === "2026-10-11", "the booking and shift are taken, and the shift gives the day", r);
  ok(r.start === "17:00" && r.end === "22:00" && !r.problems.length, "'an hour earlier' is read from the shift's own end", r);
}
{
  const x: any = { intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R11224", shift_id: 41611, date: G("2026-10-14", "Wednesday 14th"), start: G("17:00", "5pm") }] };
  const g = ground(x, "Can we do 5pm on Wednesday 14th?", SENT, { subject: "Re: Christie's October", read });
  ok(g.requests[0].shift_id === undefined, "a shift on another day than the email names is not taken", g.requests[0]);
}
{
  const x: any = { intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R99999", shift_id: 1, start: G("17:00", "5pm") }] };
  const g = ground(x, "5pm please", SENT, { subject: "Re: x", read });
  ok(g.requests[0].order_id === undefined && (g.notes ?? []).some((n) => /not among/.test(n)), "a booking the reader was not shown is never taken", g);
}

console.log("[2] what a change changes is the client's newest words");
{
  const x: any = { intent: "change", po: null, note: "", requests: [{ ...base, action: "change_crew", order: "R11224", shift_id: 41611, crew: G(4, "4 x Crew") }] };
  const g = ground(x, "Happy to go ahead with this booking", SENT, { subject: "Re: booking", read });
  ok(g.requests[0].crew === undefined && g.requests[0].problems.length > 0, "a crew total quoted only from Spartan's earlier message is not a change", g.requests[0]);
}
{
  const x: any = { intent: "booking", po: null, note: "", requests: [{ ...base, action: "new_shift", date: G("2026-10-11", "Sunday 11th"), start: G("18:00", "18:00-23:00"), end: G("23:00", "18:00-23:00"), crew: G(4, "4 x Crew"), venue_id: G(9, "Christie's") }] };
  const g = ground(x, "Please book this", SENT, { subject: "Re: booking", read });
  const r = g.requests[0];
  ok(r.crew === 4 && r.start === "18:00" && r.end === "23:00" && r.place_id === 9 && !r.problems.length, "accepting a proposal books its shift from the earlier message, at the client's own venue", r);
}

console.log("[3] a whole shift is cancelled only on words that cancel it");
{
  const x: any = { intent: "cancellation", po: null, note: "", requests: [{ ...base, action: "cancel_shift", order: "R11224", shift_id: 41611 }] };
  ok(ground(x, "Please stand down on the 2nd man for Sunday.", SENT, { subject: "Re: crew", read }).requests[0].problems.length > 0, "'stand down the 2nd man' does not cancel the shift");
  ok(ground(x, "Sorry, we can actually cancel that order.", SENT, { subject: "Re: crew", read, linkedOrderId: 16100 }).requests[0].problems.length === 0, "'cancel that order' on the order's own thread does");
  ok(ground(x, "Thanks, this has already been filled elsewhere", SENT, { subject: "Re: crew", read, linkedOrderId: 16100 }).requests[0].problems.length === 0, "'filled elsewhere' does");
}

console.log("[4] a pick nothing bears out is dropped (code and model must agree)");
{
  const x: any = { intent: "change", po: null, note: "", requests: [{ ...base, action: "change_times", order: "R11224", shift_id: 41611, start: G("19:00", "19:00"), end: G("23:00", "4x4hr at 19:00"), duration_minutes: G(240, "4x4hr") }] };
  const g = ground(x, "Morning Guys Please can I extend the below booking to 4x4hr at 19:00 [image]", SENT, { subject: "Changes", read });
  ok(g.requests[0].order_id === undefined && (g.notes ?? []).some((n) => /bears out/.test(n)), "a booking pasted as an image is not guessed: no day, start, venue or R number of R11224 is in the words", g);
}
console.log("[5] a pick stands on its own day, and the booking's PO names it (harness/gen, 1 Nov)");
{
  // Two days of one booking at one venue: each day's pick is borne out by its day and the venue, and the other day's
  // shift is no rival to it. Until 1 Nov a whole-booking cancel was refused as "the day alone".
  const two: ReadContext = { ...read, thread: [], bookings: [{ order: "R70061", order_id: 880061, job_id: 2, name: "Harbour Live @ Southbank Undercroft", po: "", shifts: [
    { shift_id: 880094, name: "Crew", date: "2026-11-01", start: "08:30", end: "12:30", place_id: 7120, venue: "Southbank Undercroft", positions: "1 Crew" },
    { shift_id: 880095, name: "Crew", date: "2026-11-02", start: "09:00", end: "11:00", place_id: 7120, venue: "Southbank Undercroft", positions: "2 Crew" }] }] };
  const x: any = { intent: "cancellation", po: null, note: "", requests: [
    { ...base, action: "cancel_shift", order: "R70061", shift_id: 880094, date: G("2026-11-01", "1st Nov"), venue: G("Southbank Undercroft", "Southbank Undercroft") },
    { ...base, action: "cancel_shift", order: "R70061", shift_id: 880095, date: G("2026-11-02", "Monday 2nd November"), venue: G("Southbank Undercroft", "Southbank Undercroft") }] };
  const g = ground(x, "We have to cancel the whole booking at Southbank Undercroft (1st Nov, Monday 2nd November), sorry.", "2026-10-20T10:00:00Z", { subject: "Cancel", read: two });
  ok(g.requests.every((r) => r.order_id === 880061 && !r.problems.length), "both days of the booking are taken: the other day's shift is no rival", g.requests.map((r) => r.problems));
}
{
  const po: ReadContext = { ...read, thread: [], bookings: [{ ...read.bookings[0], po: "SC47671" }] };
  const x: any = { intent: "change", po: G("SC47671", "SC47671"), note: "", requests: [{ ...base, action: "change_times", order: "R11224", shift_id: 41611, date: G("2026-10-11", "Sunday 11th"), start: G("10:00", "10:00"), end: G("14:00", "1400") }] };
  const g = ground(x, "Can we change Sunday 11th (our PO SC47671) to 10:00 - 1400 please?", SENT, { subject: "Change", read: po });
  ok(g.requests[0].order_id === 16100 && !g.requests[0].problems.length, "the booking's PO in the client's words names it, as an R does (O17)", g.requests[0]);
  const none = ground(x, "Can we change Sunday 11th (our PO SC47672) to 10:00 - 1400 please?", SENT, { subject: "Change", read: po });
  ok(none.requests[0].problems.length > 0 || none.requests[0].order_id === undefined, "another PO names nothing: the day alone is still refused", none.requests[0]);
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
