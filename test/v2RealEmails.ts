// ============================================================================
// The shapes real client emails took on 9-11 Oct that the rebuild left for a person, each
// pinned to the rule that now handles it. Replayed on the 115 shadow emails (no model call),
// the planned writes went from 7 to 14, every one matching what ops then built by hand.
//
// Offline.  npx tsx test/v2RealEmails.ts
// ============================================================================
import { amountIn, oneIn, parseCount, parseNewDate, subjectDate } from "../app/lib/v2/interpret/ground";
import { ground } from "../app/lib/v2/interpret/interpret";
import type { Extraction } from "../app/lib/v2/interpret/extract";
import { plan, venueKey, type World } from "../app/lib/v2/interpret/plan";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};
const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), label, JSON.stringify(a) === JSON.stringify(b) ? "" : `got ${JSON.stringify(a)}`);
const SENT = "2026-10-11T12:00:00Z";

console.log("[1] one person written as a word");
eq(amountIn("add a carpenter"), 1, "add a carpenter (Wall to Wall)");
eq(parseCount("someone"), 1, "I require someone (ILEC)");
eq(amountIn("add him as a third person on this shift"), null, "add him, if he's available, is not +1 (We Are Family)");
eq(parseCount("a crew"), null, "a crew is a team, not one");
eq(parseCount("a couple"), null, "a couple is still no number");
eq(oneIn("a few hands"), false, "a few is no number");
eq(parseCount("another 3 crew"), 3, "another 3 crew is 3 on a new shift (Bearded Kitten)");

console.log("\n[2] days");
eq(parseNewDate("shift the Wednesday 14th de-rig shift to Tuesday 13th", "2026-10-11T17:54:00Z"), "2026-10-13", "a move reads the day after 'to' (The Events House)");
eq(parseNewDate("12th to 14th", SENT), "2026-10-12", "a range without a moving verb is not split");
eq(subjectDate("RE: Crew availability 13/10", SENT), "2026-10-13", "a reply's subject gives its one day (Encore)");
eq(subjectDate("Re: 6x Crew Sunday/ Monday", SENT), null, "no date in the subject, none taken");
eq(subjectDate("Re: Names for shift tonight", SENT), null, "a relative day in an old subject is not today");
eq(subjectDate("Crew 13/10 and 14/10", SENT), null, "two dates in the subject, none taken");

console.log("\n[3] venues written with an address or a district");
eq(venueKey("The Peninsula, 1 Grosvenor Place, London, SW1X 7HJ"), venueKey("The Peninsula London"), "The Peninsula with its address (d&b)");
eq(venueKey("Labs House 15-19 Bloomsbury Way, London WC1A 2TH"), venueKey("LABS House"), "Labs House with its address (Wall to Wall)");
eq(venueKey("Christies"), venueKey("Christie's London"), "Christies (Harbour Scenic)");
ok(venueKey("Tobacco Dock") !== venueKey("Old Billingsgate"), "different places stay different");

console.log("\n[4] the thread's own words");
const ex = (requests: any[], intent: Extraction["intent"] = "booking"): Extraction => ({ intent, po: null, requests, note: "" });
const prior = [{ action: "new_shift" as const, date: "2026-10-15", start: "09:00", end: "13:00", crew: 4, venue: "ColourWorks Studio", problems: [] }];
const c = ground(ex([], "unclear"), "Re: ColourWorks\nHello Team, Please may this be booked. Contact: Gina", SENT, { subject: "Re: ColourWorks", prior });
ok(c.intent === "booking" && c.requests.length === 1 && c.requests[0].date === "2026-10-15", "'Please may this be booked' books the client's earlier request (Wall to Wall)", JSON.stringify(c));
const n = ground(ex([], "unclear"), "Re: x\nIs that for the 15-22nd role?", SENT, { subject: "Re: x", prior });
ok(!n.requests.length, "a question on the same thread books nothing");
const two = [prior[0], { ...prior[0], date: "2026-10-12" }];
const m = ground(ex([], "booking"), "Re: x\nBut let's confirm Monday to start with.", SENT, { subject: "Re: x", prior: two });
ok(m.requests.length === 1 && m.requests[0].date === "2026-10-12", "'let's confirm Monday' books only Monday (Vivid)", JSON.stringify(m.requests.map((r) => r.date)));
const po = ground({ intent: "info_only", po: { value: "2871", quote: "ref:2871" }, requests: [], note: "" }, "Re: 13/10 British museum ref:2871\nThanks Jake", SENT, { subject: "Re: 13/10 British museum ref:2871" });
ok(!po.po, "a reference in a reply's old subject is not a new PO (Bespoke)");

console.log("\n[5] the planner");
const order = { id: 16470, number: "11430", company_id: 9006, intern_name: "1195", created: "2026-10-07", Job: [{ SlotTeam: [{ id: 1, name: "Crew", Slot: [{ id: 2, beginning: "2026-10-13T15:30:00Z", end: "2026-10-13T18:30:00Z", size: 7, profession_id: 1, role: 0, SlotLocation: { place_id: 12 } }] }] }] };
const world: World = {
  companies: async () => [{ id: 9006, name: "Bespoke Events", Client: [{ id: 1, email: "stephen@bespoke-london.co.uk" }] }],
  placesNamed: async () => [],
  companyOrders: async () => [order],
  orderByNumber: async (r) => (r === "11430" ? order : null),
};
(async () => {
  const msg = { message_id: "m", from: "stephen@bespoke-london.co.uk", subject: "Re: R11430", sentIso: SENT, text: "PO is 2871" };
  const d = await plan(msg, { intent: "info_only", po: "2871", requests: [], problems: [] }, world);
  ok(d.kind === "handoff" && /already has PO 1195/.test(d.reasons.join()), "a PO already on the order is never replaced by the system", JSON.stringify(d));
  const q = await plan(msg, { intent: "quote_request", requests: [], problems: [] }, world);
  ok(q.kind === "handoff" && q.reply === true, "a quote is a reply, not an order card");
  const gone = await plan({ ...msg, from: "bijel@atcomms.co.uk" }, { intent: "cancellation", requests: [], problems: [] }, world);
  ok(gone.kind === "none", "a cancellation from a sender with nothing booked changes nothing (AT Comms)");
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
