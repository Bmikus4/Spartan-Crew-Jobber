// ============================================================================
// THE IDENTITY RULE — client + date + venue, and nothing else.
// ----------------------------------------------------------------------------
// Ben's ruling, 2026-09-13: a thread is about the same job as an order when the CLIENT,
// the DATE and the VENUE agree, each of which may be superseded by a change the thread
// states. Crew size is excluded outright — it is the most frequent change in the
// mailbox, so it can never be evidence that this is a different job — and times are
// excluded for the same reason.
//
// Ben's correction, 2026-09-14: "Threads will likely NEVER directly name an R number,
// dont expect to find it in an order, though for consistency in code we can look for
// it." So every case below that does NOT name a number is the real population — 198 of
// 238 bound threads — and the three that do are the bonus path.
//
// Run: npx tsx test/identityRule.ts
// ============================================================================
import { matchExistingOrder, rNumbersIn, type OrderRec } from "../app/lib/engine/resolve";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const bound = (m: ReturnType<typeof matchExistingOrder>) => (m && "order_id" in m ? m.order_id : null);
const how = (m: ReturnType<typeof matchExistingOrder>) => (m && "order_id" in m ? m.by : "—");

/** Two venues that are genuinely different buildings, as the tenant records them. */
const PLACES: PlaceCandidate[] = [
  { id: 41, name: "Royal Albert Hall", address: "Kensington Gore", city: "London", active: true },
  { id: 42, name: "Olympia London", address: "Hammersmith Road", city: "London", active: true },
  { id: 43, name: "ExCeL London", address: "Royal Victoria Dock", city: "London", active: true },
];

console.log("\n[1] crew and times are NEVER consulted — the whole point of the ruling");
{
  // One order on the day. The thread asks for four crew at 1400-2000; the order holds
  // two at 1200-1800. Under any rule that weighed the shape, this is a different job and
  // the engine raises a second booking beside the real one. Under Ben's rule it is one
  // job carrying two instructions.
  const orders: OrderRec[] = [
    { id: 5001, number: "10500", happening: "2026-03-09T12:00:00+00:00", name: "Acme @ Olympia London", Job: [{ id: 7001 }] },
  ];
  const m = matchExistingOrder("2026-03-09", orders, { location_text: "Olympia London", place_id: 42, places: PLACES });
  ok(bound(m) === 5001, "a crew and time change still binds to the same order", `by ${how(m)}`);
}

console.log("\n[2] a stated DATE change binds to the order it is changing");
{
  // The order is on the 9th. The thread says "moving the 9th to the 11th", so facts hold
  // both dates. Matching on the EARLIEST alone would still work here; matching on the
  // LAST would not — and the real failure is the thread that records only the new date
  // alongside the old one out of the quoted history. Both are passed, so either lands.
  const orders: OrderRec[] = [
    { id: 5002, number: "10501", happening: "2026-03-09T12:00:00+00:00", name: "Acme @ Olympia London", Job: [{ id: 7002 }] },
  ];
  const m = matchExistingOrder("2026-03-11", orders, { days: ["2026-03-11", "2026-03-09"], location_text: "Olympia London" });
  ok(bound(m) === 5002, "the order keeps its old date and the thread still finds it", `by ${how(m)}`);

  // And the control: a date the thread never mentions is not a match at any price.
  const no = matchExistingOrder("2026-04-20", orders, { days: ["2026-04-20"], location_text: "Olympia London" });
  ok(no === null, "an unrelated date matches nothing — this is what stops a false bind");
}

console.log("\n[3] the venue separates a client's several jobs on one day, by PLACE ID");
{
  // The measured failure this replaces: comparing the two strings refused "@ Rosewood
  // Hotel" against "Rosewood London, 252 High Holborn". Both sides now resolve through
  // matchPlace, so the comparison is id against id.
  const orders: OrderRec[] = [
    { id: 5003, number: "10502", happening: "2026-03-09T08:00:00+00:00", name: "Acme @ Royal Albert Hall", Job: [{ id: 7003 }] },
    { id: 5004, number: "10503", happening: "2026-03-09T14:00:00+00:00", name: "Acme @ ExCeL London", Job: [{ id: 7004 }] },
  ];
  // "RAH" is the tenant's own alias and resolves through matchPlace where a string
  // comparison against "Royal Albert Hall" would find nothing in common.
  const m = matchExistingOrder("2026-03-09", orders, { location_text: "RAH", place_id: 41, places: PLACES });
  ok(bound(m) === 5003, "an alias on one side and the full name on the other still agree", `by ${how(m)}`);

  const amb = matchExistingOrder("2026-03-09", orders, {});
  ok(!!amb && "ambiguous" in amb && amb.ambiguous === 2, "no venue at all -> ambiguous, never a coin flip");

  // A venue that is neither of them picks none, which is ambiguity and not a third job.
  const neither = matchExistingOrder("2026-03-09", orders, { location_text: "Olympia London", place_id: 42, places: PLACES });
  ok(!!neither && "ambiguous" in neither, "a venue matching neither candidate refuses rather than guessing");
}

console.log("\n[4] a sole candidate: a STRONG venue disagreement refuses, a weak one does not");
{
  const orders: OrderRec[] = [
    { id: 5005, number: "10504", happening: "2026-03-09T08:00:00+00:00", name: "Acme @ Royal Albert Hall", Job: [{ id: 7005 }] },
  ];

  // Both sides resolved, to different buildings. This is the case that cost a wrong bind
  // on live data: thread "PO - Tottenham Hotspur Stadium - 02/09/26" took "Blackout - MCS
  // Prods @ The Tower Hotel" because it was the only order that client had that day, and
  // a stadium crew change would have landed on a hotel.
  const strong = matchExistingOrder("2026-03-09", orders, { location_text: "ExCeL London", place_id: 43, places: PLACES });
  ok(!!strong && "ambiguous" in strong, "both sides resolved to different places -> refuse, do not bind");

  // Neither side resolved and the strings merely fail to overlap. Weak, and it must not
  // refuse: our own venue resolution is the softer side of the comparison — R10556's
  // thread says "Royal Horse Guards Hotel" and resolved to Banqueting House, R10657's
  // resolved to "London". Refusing on wording would break binds that are right today in
  // order to fix errors that are ours.
  const weak = matchExistingOrder("2026-03-09", orders, { location_text: "the usual place" });
  ok(bound(weak) === 5005, "a string that simply does not overlap still binds", `by ${how(weak)}`);

  // An order the ENGINE named carries no "@" at all, so its venue is unreadable rather
  // than wrong. Unreadable is not a disagreement and must never refuse — otherwise every
  // order we raised ourselves loses to every order staff raised, by naming accident.
  const ours: OrderRec[] = [
    { id: 5010, number: "10507", happening: "2026-03-09T08:00:00+00:00", name: "Acme - 4 crew at Olympia, 9 Mar", Job: [{ id: 7010 }] },
  ];
  const unreadable = matchExistingOrder("2026-03-09", ours, { location_text: "ExCeL London", place_id: 43, places: PLACES });
  ok(bound(unreadable) === 5010, "an order we raised ourselves still binds", `by ${how(unreadable)}`);
}

console.log("\n[5] the R number is a CHECK, not a branch — #13841, the one provable defect");
{
  // Thread #13841's subject reads "Price quote - R10687 Delta Live - BBC PROMS 53 @ RAH"
  // and is bound to R10688, PROMS 54 @ Various — a different show at a different venue,
  // created five minutes apart. Both are same-client same-day, so the shape rule alone
  // cannot separate them; the number the thread states can.
  const orders: OrderRec[] = [
    { id: 13840, number: "10687", happening: "2026-07-20T08:00:00+00:00", name: "Delta Live @ Royal Albert Hall", Job: [{ id: 9001 }] },
    { id: 13841, number: "10688", happening: "2026-07-20T08:00:00+00:00", name: "Delta Live @ Various", Job: [{ id: 9002 }] },
  ];
  const subject = "Price quote - R10687 Delta Live - BBC PROMS 53 @ RAH";
  const m = matchExistingOrder("2026-07-20", orders, { r_numbers: rNumbersIn(subject) });
  ok(bound(m) === 13840, "the thread gets the order its own subject names", `R${m && "order_id" in m ? m.order_number : "?"}`);
  ok(how(m) === "date+r-number", "and says that is how it was decided", String(how(m)));

  // It may only ever NARROW. A number naming an order outside the same-day set is a
  // stale reference, and the shape rule carries on as if nothing had been named.
  const stale = matchExistingOrder("2026-07-20", orders, {
    r_numbers: ["9999"],
    location_text: "Royal Albert Hall",
    place_id: 41,
    places: PLACES,
  });
  ok(bound(stale) === 13840, "a number outside the candidates narrows nothing and widens nothing", `by ${how(stale)}`);
}

console.log("\n[6] the two poisoned phrasings are inert");
{
  // "Repeat of R5531" names the order this job is a COPY of — deliberately not the one
  // the thread is about. Binding to it attaches a new booking's crew to last year's job.
  ok(rNumbersIn("Re: Repeat of R5531").length === 0, "'Repeat of R5531' names nothing", JSON.stringify(rNumbersIn("Re: Repeat of R5531")));
  ok(rNumbersIn("repeat r5531 please").length === 0, "and neither does 'repeat R5531'");
  // A quote reply listing three jobs picks none of them, on the count test alone.
  const three = rNumbersIn("Quotes attached for R10967, R10968 and R10969");
  ok(three.length === 3, "a thread naming three numbers yields three", three.join(","));
  const orders: OrderRec[] = [
    { id: 5006, number: "10967", happening: "2026-09-11T12:00:00+00:00", name: "Impact @ Olympia London", Job: [{ id: 7006 }] },
    { id: 5007, number: "10968", happening: "2026-09-11T12:00:00+00:00", name: "Impact @ ExCeL London", Job: [{ id: 7007 }] },
  ];
  const m = matchExistingOrder("2026-09-11", orders, { r_numbers: three });
  ok(!!m && "ambiguous" in m, "so three numbers decide nothing and the shape rule refuses");

  // The ordinary phrasings still read.
  ok(rNumbersIn("your ref R10967 for Friday").join() === "10967", "'R10967' reads");
  ok(rNumbersIn("Ref: R 10967").join() === "10967", "'R 10967' reads");
  ok(rNumbersIn("R#10967").join() === "10967", "'R#10967' reads");
  // And nothing that merely looks like one does.
  ok(rNumbersIn("4 crew at 1400-2000, room 12").length === 0, "times and room numbers are not R numbers");
}

console.log("\n[7] the overwhelming case: no number named at all, and it changes nothing");
{
  // 198 of 238 bound threads name no R number. Every accuracy claim has to hold here, so
  // this repeats [1] and [3] with the field absent rather than empty.
  const orders: OrderRec[] = [
    { id: 5008, number: "10505", happening: "2026-03-09T08:00:00+00:00", name: "Acme @ Royal Albert Hall", Job: [{ id: 7008 }] },
    { id: 5009, number: "10506", happening: "2026-03-09T14:00:00+00:00", name: "Acme @ ExCeL London", Job: [{ id: 7009 }] },
  ];
  const text = "Morning - can we make that 6 crew instead of 4, 1400 til close? Same as before at the Albert Hall.";
  const m = matchExistingOrder("2026-03-09", orders, {
    r_numbers: rNumbersIn(text),
    location_text: "Royal Albert Hall",
    place_id: 41,
    places: PLACES,
  });
  ok(rNumbersIn(text).length === 0, "the thread names no number, like most of them");
  ok(bound(m) === 5008, "and the venue alone still lands it on the right one of two", `by ${how(m)}`);
}

console.log("\n[8] two place IDS are only a disagreement when they are two BUILDINGS");
{
  /**
   * WHY THIS SECTION EXISTS, measured 2026-09-15 on the 96 threads whose order staff
   * deleted (`npx tsx scripts/score-successor-recovery.ts`). Handing the rule the place
   * list took successor binds from 60 to 42 — it refused 18 more. Reading all 18: ONE is
   * a genuine disagreement (Tottenham Hotspur Stadium against The Tower Hotel, case [4]),
   * two are arguable, and the rest are the tenant holding several rows for one venue, or
   * one side resolving to a placeholder.
   *
   *   ours 758 "Rose Court"                 vs order 639 "Rose Court"
   *   ours 6262 "Harrods - Knightsbridge"   vs order  15 "Harrods"
   *   ours 6922 "No Location"               vs order 544 "The Roof Gardens"
   *   ours  356 "Hilton London Heathrow T5" vs order 6896 "London"
   *
   * None of those is evidence that the thread and the order are different jobs, and
   * refusing on them costs ~14 correct binds to prevent one wrong one. So `differ-id` now
   * requires that BOTH rows say where they are and that they are not the same venue
   * recorded twice.
   */
  const DUPES: PlaceCandidate[] = [
    { id: 758, name: "Rose Court", address: "2 Southwark Bridge Road", city: "London", active: true },
    { id: 639, name: "Rose Court", address: "Southwark Bridge Rd", city: "London", active: true },
    { id: 15, name: "Harrods", address: "87-135 Brompton Road", city: "London", active: true },
    { id: 6262, name: "Harrods - Knightsbridge", address: "87-135 Brompton Rd", city: "London", active: true },
    // The placeholders the engine reaches for when a thread names no venue. They carry
    // nothing but a name, which is what makes them unusable as evidence.
    { id: 6922, name: "No Location", active: true },
    { id: 544, name: "The Roof Gardens", address: "99 Kensington High Street", city: "London", active: true },
  ];
  const on = (id: number, name: string): OrderRec[] => [
    { id, number: String(id), happening: "2026-03-09T08:00:00+00:00", name: `Acme @ ${name}`, Job: [{ id: id + 1 }] },
  ];

  const twice = matchExistingOrder("2026-03-09", on(6001, "Rose Court"), {
    location_text: "Rose Court, 2 Southwark Bridge Road, SE1 9HS", place_id: 758, places: DUPES,
  });
  ok(bound(twice) === 6001, "the same venue held under two place rows is not a disagreement", `by ${how(twice)}`);

  const shorter = matchExistingOrder("2026-03-09", on(6002, "Harrods"), {
    location_text: "Harrods Knightsbridge", place_id: 6262, places: DUPES,
  });
  ok(bound(shorter) === 6002, "one row's name contained in the other's is the same venue", `by ${how(shorter)}`);

  // Our side sank to a placeholder because the thread named no venue at all. A row that
  // does not say where it is cannot contradict one that does.
  const ourShell = matchExistingOrder("2026-03-09", on(6003, "The Roof Gardens"), {
    location_text: undefined, place_id: 6922, places: DUPES,
  });
  ok(bound(ourShell) === 6003, "a placeholder on our side never refuses", `by ${how(ourShell)}`);

  const theirShell = matchExistingOrder("2026-03-09", on(6004, "No Location"), {
    location_text: "The Roof Gardens", place_id: 544, places: DUPES,
  });
  ok(bound(theirShell) === 6004, "a placeholder on the order's side never refuses", `by ${how(theirShell)}`);

  // And the case the refusal exists for is untouched: two rows that both say where they
  // are, naming two different buildings.
  const real = matchExistingOrder("2026-03-09", on(6005, "Harrods"), {
    location_text: "Rose Court, 2 Southwark Bridge Road, SE1 9HS", place_id: 758, places: DUPES,
  });
  ok(!!real && "ambiguous" in real, "two informative rows for two different buildings still refuse");
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
