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
  ok(ground(x, "Sorry, we can actually cancel that order.", SENT, { subject: "Re: crew", read }).requests[0].problems.length === 0, "'cancel that order' does");
  ok(ground(x, "Thanks, this has already been filled elsewhere", SENT, { subject: "Re: crew", read }).requests[0].problems.length === 0, "'filled elsewhere' does");
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
