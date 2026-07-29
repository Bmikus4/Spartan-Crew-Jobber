// ============================================================================
// The order -> thread linkage scorer, tested against REAL order names pulled
// from the live tenant (the 30 most recent, 2026-07-28) and synthetic threads.
//
// What matters most here is the negative cases: the scorer must refuse rather
// than mislink, because a wrong link silently attributes a real job to the wrong
// client conversation.
//
// Run: npx tsx test/orderLink.ts
// ============================================================================
import { parseOrderName, scoreLink, decideLink, type OrderSide, type ThreadSide } from "../app/lib/engine/orderLink";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

console.log("\n[1] order names parse (real names from the live tenant)");
const cases: Array<[string, string, string | undefined]> = [
  ["Eclipse @ Warehouse", "Eclipse", "Warehouse"],
  ["Wacker Global - Brighton Pride @ Preston Park", "Wacker Global", "Preston Park"],
  ["COG Live - Expo @  Excel, North Halls ", "COG Live", "Excel, North Halls"],
  ["*Tyser & Allan @ Olympia *FULL PPE REQUIRED*", "Tyser & Allan", "Olympia *FULL PPE REQUIRED*"],
  ["Solotech @ Manchester Warehouse", "Solotech", "Manchester Warehouse"],
  ["Manchester Training ", "Manchester Training", undefined],
  ["O Films @ Park Hyatt London River Thames", "O Films", "Park Hyatt London River Thames"],
];
for (const [name, company, venue] of cases) {
  const p = parseOrderName(name);
  ok(p.company === company, `company from "${name.slice(0, 34)}"`, `-> "${p.company}"`);
  if (venue !== undefined) ok(p.venue === venue, `  venue`, `-> "${p.venue}"`);
  else ok(p.venue === undefined, `  no venue`, `-> ${String(p.venue)}`);
}
ok(parseOrderName("Wacker Global - Brighton Pride @ Preston Park").sub === "Brighton Pride", "sub-brand captured");

// A real order, flattened the way the backfill will flatten it.
const order: OrderSide = {
  id: 13610,
  name: "Wacker Global - Brighton Pride @ Preston Park",
  created: "2026-07-28T10:00:00+00:00",
  happening: "2026-07-29",
  company_id: 734,
  user_id: 2313,
  company_name: "Wacker Global",
  contact_email: "ops@wackerglobal.com",
  specification: "Brighton Pride build crew",
};

console.log("\n[2] the originating thread scores high and links");
const rightThread: ThreadSide = {
  thread_id: "thr_right",
  subject: "Crew for Brighton Pride - Preston Park",
  participants: ["ops@wackerglobal.com", "bookings@spartancrew.co.uk"],
  contact_email: "ops@wackerglobal.com",
  company_name: "Wacker Global Ltd",
  location_text: "Preston Park, Brighton",
  dates: ["2026-07-29"],
  first_message_iso: "2026-07-26T09:00:00.000Z",
  company_id: 734,
  user_id: 2313,
};
const s1 = scoreLink(order, rightThread);
ok(s1.score > 0.8, "score > 0.8", s1.score.toFixed(2));
ok(!s1.disqualified, "not disqualified");
{
  const d = decideLink(order, [rightThread]);
  ok(d.kind === "linked", "decision linked", d.kind);
  if (d.kind === "linked") ok(d.thread_id === "thr_right", "linked to the right thread", d.thread_id);
}

console.log("\n[3] an unrelated thread does NOT link");
const wrongThread: ThreadSide = {
  thread_id: "thr_wrong",
  subject: "Invoice query March",
  participants: ["accounts@someoneelse.co.uk"],
  contact_email: "accounts@someoneelse.co.uk",
  company_name: "Someone Else Ltd",
  location_text: "their office",
  dates: ["2026-03-01"],
  first_message_iso: "2026-02-20T09:00:00.000Z",
};
ok(scoreLink(order, wrongThread).score < 0.3, "low score", scoreLink(order, wrongThread).score.toFixed(2));
{
  const d = decideLink(order, [wrongThread]);
  ok(d.kind === "unmatched", "decision unmatched, not a guess", d.kind);
}

console.log("\n[4] right thread among decoys still wins");
{
  const d = decideLink(order, [wrongThread, rightThread, { ...wrongThread, thread_id: "thr_wrong2" }]);
  ok(d.kind === "linked" && d.thread_id === "thr_right", "picked the right one", d.kind);
}

console.log("\n[5] two threads with the SAME contact -> ambiguous, never auto-linked");
{
  const twin: ThreadSide = { ...rightThread, thread_id: "thr_twin", subject: "Another Wacker job", dates: ["2026-08-15"] };
  const d = decideLink(order, [rightThread, twin]);
  ok(d.kind === "ambiguous", "decision ambiguous", d.kind);
  if (d.kind === "ambiguous") {
    ok(d.candidates.length >= 2, "both candidates reported");
    ok(/same contact identity/.test(d.reason), "reason explains why", d.reason);
  }
}

console.log("\n[6] an order raised BEFORE the thread started is impossible");
{
  const late: ThreadSide = { ...rightThread, thread_id: "thr_late", first_message_iso: "2026-08-20T09:00:00.000Z" };
  const s = scoreLink(order, late);
  ok(!!s.disqualified, "disqualified", s.disqualified);
  const d = decideLink(order, [late]);
  ok(d.kind === "unmatched", "so it cannot be linked", d.kind);
}

console.log("\n[7] company match works off the sender domain alone");
{
  const domainOnly: ThreadSide = {
    thread_id: "thr_domain",
    participants: ["someone@eclipse.co.uk"],
    contact_email: "someone@eclipse.co.uk",
    location_text: "the Warehouse",
    dates: ["2026-07-27"],
    first_message_iso: "2026-07-20T09:00:00.000Z",
  };
  const eclipse: OrderSide = { id: 13592, name: "Eclipse @ Warehouse", created: "2026-07-24T10:00:00+00:00", happening: "2026-07-27", company_id: 126, user_id: 2523 };
  const s = scoreLink(eclipse, domainOnly);
  ok(s.features.find((f) => f.name === "company_name")?.hit === true, "company matched via domain");
  ok(s.features.find((f) => f.name === "happening_date")?.hit === true, "happening date matched");
  ok(s.features.find((f) => f.name === "venue")?.hit === true, "venue matched");
}

console.log("\n[8] no threads at all -> unmatched, no throw");
{
  const d = decideLink(order, []);
  ok(d.kind === "unmatched", "unmatched", d.kind);
}

console.log("\n[9] weak-but-tied candidates are ambiguous, not a coin flip");
{
  const weakA: ThreadSide = { thread_id: "a", company_name: "Wacker Global", location_text: "Preston Park", dates: ["2026-07-29"], first_message_iso: "2026-07-20T00:00:00.000Z" };
  const weakB: ThreadSide = { thread_id: "b", company_name: "Wacker Global", location_text: "Preston Park", dates: ["2026-07-29"], first_message_iso: "2026-07-21T00:00:00.000Z" };
  const d = decideLink(order, [weakA, weakB]);
  ok(d.kind === "ambiguous", "ambiguous", d.kind === "ambiguous" ? d.reason : d.kind);
}

console.log("\n[10] a single thin coincidence must not link on a perfect ratio");
{
  // Only the subject echoes the venue. Ratio would be 1.00 over one evaluable
  // feature - the strength floor is what stops this becoming a link.
  const thin: ThreadSide = { thread_id: "thin", subject: "Preston Park question" };
  const s = scoreLink(order, thin);
  ok(s.score === 1, "ratio is a perfect 1.00", s.score.toFixed(2));
  ok(s.strength < 0.35, "but strength is tiny", s.strength.toFixed(2));
  const d = decideLink(order, [thin]);
  ok(d.kind === "unmatched", "refused", d.kind);
  if (d.kind === "unmatched") ok(/too little evidence/.test(d.reason), "reason names the guard", d.reason);
}

console.log("\n[11] short company names do not match mid-word (the RTS / O Films bug)");
{
  // Both are real companies in the live 30. Raw substring matching made
  // normName("RTS")="rts" a hit inside "spare parts", and "O Films" a hit inside
  // "info films" - so an unrelated thread scored company_name.
  const rts: OrderSide = { id: 254, name: "RTS @ HQ", created: "2026-07-20T10:00:00+00:00", happening: "2026-07-25", company_id: 264 };
  const decoy: ThreadSide = {
    thread_id: "decoy",
    subject: "spare parts enquiry",
    company_name: "Spare Parts Direct",
    participants: ["sales@spareparts.example"],
    contact_email: "sales@spareparts.example",
    first_message_iso: "2026-07-18T09:00:00.000Z",
  };
  const s = scoreLink(rts, decoy);
  ok(s.features.find((f) => f.name === "company_name")?.hit === false, "RTS does not match 'Spare Parts Direct'");
  ok(s.features.find((f) => f.name === "subject_echo")?.hit === false, "RTS does not echo in 'spare parts enquiry'");
  ok(decideLink(rts, [decoy]).kind === "unmatched", "so it stays unmatched");

  // and the legitimate matches still work
  ok(scoreLink({ ...rts, name: "RTS @ HQ" }, { thread_id: "t", company_name: "RTS Ltd" }).features.find((f) => f.name === "company_name")?.hit === true, "RTS still matches 'RTS Ltd'");
  const multi = scoreLink(order, { thread_id: "t", company_name: "Wacker Global Events Ltd" });
  ok(multi.features.find((f) => f.name === "company_name")?.hit === true, "'Wacker Global' still matches 'Wacker Global Events Ltd'");
}

console.log("\n[12] identity evidence links even when nothing else is known");
{
  const idOnly: ThreadSide = { thread_id: "idonly", participants: ["ops@wackerglobal.com"], contact_email: "ops@wackerglobal.com" };
  const d = decideLink(order, [idOnly]);
  ok(d.kind === "linked", "linked on the contact email alone", d.kind);
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
