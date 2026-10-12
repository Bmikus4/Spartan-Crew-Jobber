// ============================================================================
// Ben, 10-11: a request that names no profession is standard crew, whatever the work is
// for; and every draft is written as though the team has already made the booking.
//
// Offline.  npx tsx test/v2CrewDefault.ts
// ============================================================================
import { ground } from "../app/lib/v2/interpret/interpret";
import type { Extraction, RawRequest } from "../app/lib/v2/interpret/extract";
import { draftContext } from "../app/lib/v2/draft";
import { tradeOf, pickProfession } from "../app/lib/v2/interpret/professions";
import { plan, type World } from "../app/lib/v2/interpret/plan";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const SENT = "2026-10-12T09:00:00Z";
function booking(tradeWords: string): { x: Extraction; text: string } {
  const text = `Can we get 4 ${tradeWords} on 20th October 08:00-16:00 at Olympia London please?`;
  const r: RawRequest = {
    action: "new_shift",
    date: { value: "2026-10-20", quote: "20th October" },
    start: { value: "08:00", quote: "08:00" },
    end: { value: "16:00", quote: "16:00" },
    duration_minutes: null,
    crew: { value: 4, quote: `4 ${tradeWords}` },
    crew_add: null,
    venue: { value: "Olympia London", quote: "Olympia London" },
    crew_chief: null,
    trade: { value: tradeWords, quote: tradeWords },
    target: null,
  };
  return { x: { intent: "booking", po: null, requests: [r], note: "" }, text };
}
const blocked = (w: string) => { const { x, text } = booking(w); return ground(x, text, SENT).requests[0].problems.some((p) => /trade/.test(p)); };

console.log("[1] no profession named: standard crew, whatever the work is for");
for (const w of ["crew", "hands", "staff", "people", "build crew", "get-out crew", "load-in hands", "general labour", "event crew", "helpers", "stagehands", "local crew"])
  ok(!blocked(w), `"${w}" books as crew`);

console.log("\n[2] a named profession is booked as its OnSinch profession (Ben, 10-11: 'Orders must still be created reguardless of profession')");
for (const w of ["carpenter", "chippie", "AV technician", "audio tech", "lighting technician", "forklift driver", "telehandler operator", "bar staff", "steward", "security", "rigger", "IPAF operator"])
  ok(!blocked(w), `"${w}" is not refused`);
const as = (w: string) => tradeOf(w);
ok(as("carpenter")?.candidates.join() === "3" && as("2 chippies")?.candidates.join() === "3", "carpenter and chippie are Carpenter (3)");
ok(as("AV technician")?.candidates.join() === "16", "AV technician is Crew AV tech (16)");
ok(as("forklift driver")?.candidates.join() === "22,11", "a forklift is Counterbalance, Day Rate (22) before per hour (11), ops' order");
ok(as("van driver")?.candidates.join() === "46" && as("driver")?.candidates.join() === "45,46,9", "a van driver is Minivan (46); a driver is Carpool, Minivan or Driver");
ok(as("telehandler over 9m")?.candidates.join() === "24,7" && as("telehandler")?.candidates.join() === "23,4", "a telehandler over 9m is J3, otherwise J2");
ok(as("IPAF 1b operator")?.candidates.join() === "53" && as("IPAF operator")?.candidates.join() === "5", "IPAF 1b is 53, IPAF otherwise 3a/3b (5)");
ok(!!as("rigger")?.asCrew && !!as("audio tech")?.asCrew, "a trade with no live profession is booked as Crew, and says so");
ok(!as("security")?.asCrew && !!as("security")?.named && !!as("SIA door staff")?.named, "security is never Crew: it is found by name in OnSinch's live list (Ben, 10-11)");
ok(pickProfession(as("security")!, [], []) === null && pickProfession(as("security")!, [], [{ id: "70", name: "Security (SIA)" }])?.id === "70", "with no Security profession there is none to book; with one, it is booked");
ok(as("crew") === null && as("build crew") === null && as("stagehands") === null, "crew words are plain crew");
const history = [{ created: "2026-09-01", Job: [{ SlotTeam: [{ Slot: [{ profession_id: 11 }] }] }] }];
ok(pickProfession(as("forklift")!, history)?.id === "11" && pickProfession(as("forklift")!, [])?.id === "22", "the client's own last profession wins; with none, ops' most used");

(async () => {
console.log("\n[2b] the planner books them");
const world: World = {
  companies: async () => [{ id: 9005, name: "Meridian Live", Client: [{ id: 1, email: "chris@meridianlive.com" }] }],
  placesNamed: async (n) => (n.toLowerCase() === "tobacco dock" ? [{ id: 40, name: "Tobacco Dock" }] : []),
  companyOrders: async () => [],
  orderByNumber: async () => null,
};
const msg = { message_id: "m1", from: "chris@meridianlive.com", subject: "Build crew Tobacco Dock", sentIso: SENT, text: "" };
const R = (crew: number, trade?: string) => ({ action: "new_shift" as const, date: "2026-10-23", start: "07:00", end: "19:00", crew, venue: "Tobacco Dock", trade, problems: [] });
const d1 = await plan(msg, { intent: "booking", requests: [R(4), R(2, "carpenters")], problems: [] }, world);
const pos1 = d1.kind === "write" && d1.ops[0].op.kind === "create_order" ? d1.ops[0].op.shifts.map((s) => s.positions.map((p) => `${p.size}x${p.profession_id}${p.role ? "c" : ""}`).join(" ")) : [];
ok(pos1.length === 1 && pos1[0] === "1x36c 3x1 2x3", "4 crew and 2 carpenters on one call: one shift, a chief from the crew, then the carpenters", JSON.stringify(pos1));
const d2 = await plan(msg, { intent: "booking", requests: [R(2, "carpenters")], problems: [] }, world);
ok(d2.kind === "handoff" && /no plain crew/.test(d2.reasons.join()), "carpenters alone are left for a person: the bot builds a shift on a crew position first", JSON.stringify(d2));
const d3 = await plan(msg, { intent: "booking", requests: [R(3, "riggers")], problems: [] }, world);
ok(d3.kind === "write" && d3.why.some((w) => /booked as Crew/.test(w)), "riggers are booked as Crew and the card says so", JSON.stringify(d3.kind === "write" ? d3.why : d3));
const d4 = await plan(msg, { intent: "booking", requests: [R(4), R(2, "security")], problems: [] }, world);
ok(d4.kind === "handoff" && /no Security profession/.test(d4.reasons.join()), "security with no Security profession in OnSinch goes to a person, never booked as Crew", JSON.stringify(d4));
const d5 = await plan(msg, { intent: "booking", requests: [R(4), R(2, "security")], problems: [] }, { ...world, professions: async () => [{ id: "1", name: "Crew" }, { id: "70", name: "Security" }] });
const pos5 = d5.kind === "write" && d5.ops[0].op.kind === "create_order" ? d5.ops[0].op.shifts.map((s) => s.positions.map((p) => `${p.size}x${p.profession_id}${p.role ? "c" : ""}`).join(" ")) : [];
ok(pos5[0] === "1x36c 3x1 2x70", "with a Security profession in OnSinch, 2 security are booked as it beside the crew", JSON.stringify(d5));

console.log("\n[3] every draft assumes the order is made; only unwritten details are asked");
const c1 = draftContext({ kind: "handoff", reasons: ["R40101: 2 shifts on 2026-10-21 could be the one meant"] });
ok(c1.order_state === "assumed-done" && c1.ask_for.length === 0, "an OnSinch question is the team's, not the client's", JSON.stringify(c1));
const a1 = draftContext({ kind: "handoff", reasons: ["no venue in the email"] });
ok(a1.order_state === "assumed-done" && a1.ask_for.join() === "the venue", "a missing venue is asked for", JSON.stringify(a1));
const two = draftContext({ kind: "handoff", reasons: ["request 1: no start time the client wrote; request 1: no end time or duration the client wrote"] });
ok(two.ask_for.join() === "the start time,the finish time", "each unwritten detail once", JSON.stringify(two));
const w = draftContext({ kind: "write", ops: [], why: ["R1: PO 1"] });
ok(w.order_state === "assumed-done" && !w.ask_for.length, "a write drafts as done, asking nothing");
ok(!w.quote_attached && !a1.quote_attached && !c1.quote_attached, "no quote is attached unless one was asked for");
ok(draftContext({ kind: "handoff", reasons: ["the client asked for a quote"] }).quote_attached === true, "a quote request drafts with the quote attached");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
})();
