// ============================================================================
// The venue adjudicator chooses. It cannot search, and it cannot invent.
//
// Ben, 2026-08-25: the alias store must not be the only source of a venue. Search
// OnSinch as well, and put both answers in front of a model that decides.
//
// A model in the venue path is the riskiest thing in this engine, because the venue
// is the one field that sends people to a physical address at 6am. Every property
// below exists to bound what a wrong answer can do:
//
//   - place_id must be one of the ids handed in. Anything else is DISCARDED, not
//     investigated — an id that was not offered is not a venue the model found.
//   - agreement between the alias store and the search short-circuits the call.
//     There is nothing to weigh, and asking anyway can only make it worse.
//   - a model that overrules the deterministic matcher is asked once more with the
//     disagreement stated. Changing its mind under mild pressure means neither
//     answer is safe, and that is a decline rather than a coin toss.
//   - a broken, missing or out-of-credit model never costs the booking: the
//     deterministic search result stands and the ticket says so.
//
// Every test here uses a fake judge. No network, no spend, and the logic is what
// needs pinning — a live call proves the wire, not the reasoning.
//
// Run: npx tsx test/venueAdjudicate.ts
// ============================================================================
import { adjudicateVenue, buildAdjudicationPrompt, type VenueJudge } from "../app/lib/engine/venueAdjudicate";
import { buildIndex, searchVenues } from "../app/lib/engine/venueSearch";
import type { PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PLACES = [
  { id: 49, name: "ExCel London", alias: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 7, name: "The O2", alias: "O2", address: "Peninsula Square", city: "London", zip: "SE10 0DX", active: true },
  { id: 2, name: "Royal Albert Hall", alias: "RAH", address: "Kensington Gore", city: "London", zip: "SW7 2AP", active: true },
  { id: 1693, name: "Albert Hall, Manchester", address: "27 Peter Street", city: "Manchester", zip: "M2 5QR", active: true },
  { id: 2075, name: "Excel", active: true },
] as unknown as PlaceCandidate[];

const index = buildIndex(PLACES);
const hitsFor = (t: string) => searchVenues(t, index, 5).hits;

/** A judge that answers whatever it is told to, and records what it was asked. */
const fake = (answers: unknown[]): VenueJudge & { calls: string[] } => {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async adjudicate(_system: string, user: string) { calls.push(user); return answers[Math.min(i++, answers.length - 1)]; },
  };
};

async function main() {
  console.log("\n[1] agreement costs nothing — no call is made");
  {
    const j = fake([{ decision: "match", place_id: 9999, confidence: 1, reason: "should never be asked" }]);
    const r = await adjudicateVenue({ text: "ExCeL London", remembered: { place_id: 49, source: "exact" }, candidates: hitsFor("ExCeL London") }, j);
    ok(r.place_id === 49, "the agreed record is returned", String(r.place_id));
    ok(r.how === "agreed", "and marked as agreed", r.how);
    ok(j.calls.length === 0, "THE MODEL WAS NOT CALLED", `${j.calls.length} calls`);
  }

  console.log("\n[2] an id that was not offered is DISCARDED");
  {
    // The whole safety property. There is no way to tell an invented id from a found
    // one, so it is never trusted.
    const j = fake([{ decision: "match", place_id: 4242, confidence: 0.99, reason: "a venue I know about" }]);
    const r = await adjudicateVenue({ text: "O2 arena", remembered: { place_id: 2, source: "fuzzy" }, candidates: hitsFor("O2 arena") }, j);
    ok(r.place_id !== 4242, "the invented id is not used", String(r.place_id));
    ok(r.place_id === 7, "the deterministic answer stands instead", String(r.place_id));
    ok(r.how === "model-unavailable", "and the ticket says the adjudicator was unusable", r.how);
  }

  console.log("\n[3] the model may overrule the matcher — but only twice in a row");
  {
    const cands = hitsFor("the albert hall");
    ok(cands[0].building.place_id === 2, "the matcher's own top choice is Kensington", String(cands[0].building.place_id));
    // Held under pressure: accepted.
    const held = fake([
      { decision: "match", place_id: 1693, confidence: 0.8, reason: "the client is a Manchester promoter" },
      { decision: "match", place_id: 1693, confidence: 0.8, reason: "still Manchester" },
    ]);
    const a = await adjudicateVenue({ text: "the albert hall", remembered: null, candidates: cands }, held);
    ok(a.place_id === 1693, "a model that holds its answer wins", String(a.place_id));
    ok(a.how === "model-second-pass", "on the second pass", a.how);
    ok(held.calls.length === 2, "which took exactly two calls", String(held.calls.length));
    ok(/One of you is wrong/.test(held.calls[1]), "and the second call states the disagreement");

    // Folded under pressure: nobody wins.
    const folded = fake([
      { decision: "match", place_id: 1693, confidence: 0.8, reason: "Manchester" },
      { decision: "match", place_id: 999, confidence: 0.4, reason: "actually neither" },
    ]);
    const b = await adjudicateVenue({ text: "the albert hall", remembered: null, candidates: cands }, folded);
    ok(b.decision === "none", "a model that changes to a third answer settles nothing", b.decision);
    ok(b.place_id === null, "so no venue is booked");

    // Conceded to the matcher: the matcher's answer.
    const conceded = fake([
      { decision: "match", place_id: 1693, confidence: 0.6, reason: "Manchester" },
      { decision: "match", place_id: 2, confidence: 0.9, reason: "on reflection, Kensington" },
    ]);
    const c = await adjudicateVenue({ text: "the albert hall", remembered: null, candidates: cands }, conceded);
    ok(c.place_id === 2, "conceding to the matcher is accepted", String(c.place_id));
  }

  console.log("\n[4] declining is a first-class answer");
  {
    const j = fake([{ decision: "none", place_id: null, confidence: 0.9, reason: "two real Albert Halls and no city given" }]);
    const r = await adjudicateVenue({ text: "the albert hall", remembered: null, candidates: hitsFor("the albert hall") }, j);
    ok(r.decision === "none" && r.place_id === null, "nothing is booked");
    ok(/Albert Halls/.test(r.reason), "and the reason reaches the ticket", r.reason);
  }

  console.log("\n[5] no model, or a broken one, never costs the booking");
  {
    const none = await adjudicateVenue({ text: "O2 arena", remembered: { place_id: 2, source: "fuzzy" }, candidates: hitsFor("O2 arena") }, null);
    ok(none.place_id === 7, "with no judge the SEARCH wins, not the remembered alias", String(none.place_id));
    ok(none.how === "model-unavailable", "and it is said out loud", none.how);

    const thrower: VenueJudge = { async adjudicate() { throw new Error("402 out of credit"); } };
    const broke = await adjudicateVenue({ text: "O2 arena", remembered: null, candidates: hitsFor("O2 arena") }, thrower);
    ok(broke.place_id === 7, "a judge that throws falls back to the search", String(broke.place_id));

    const nothing = await adjudicateVenue({ text: "nowhere at all", remembered: null, candidates: [] }, null);
    ok(nothing.decision === "none" && nothing.how === "no-candidates", "and nothing in, nothing out", nothing.how);
  }

  console.log("\n[6] the prompt states what the model needs and nothing it could anchor on");
  {
    const text = buildAdjudicationPrompt({
      text: "excel docklands",
      remembered: { place_id: 2075, source: "fuzzy", building: index.find((b) => b.place_id === 2075) },
      candidates: hitsFor("excel docklands"),
    });
    ok(text.includes('"excel docklands"'), "the client's exact wording, uncorrected");
    ok(text.includes("id 49"), "the candidate ids it must choose from");
    ok(text.includes("E16 1XL"), "and their postcodes");
    ok(text.includes("duplicate rows for this building"), "how many rows the tenant holds for each");
    ok(text.includes("unconfirmed"), "whether the remembered alias was human-confirmed");
    // Scores are deliberately absent: a number the matcher produced is an anchor, and
    // the model is here to disagree with the matcher when the matcher is wrong.
    ok(!/score/i.test(text), "and NOT the matcher's scores, which would only anchor it");
  }

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
}

main();

