// ============================================================================
// A client who moves the venue is not ignored.
// ----------------------------------------------------------------------------
// `resolvePlace` used to open with `if (prior?.place_id) return { id: prior.place_id }`.
// Once a thread had a venue, every later email reused it and never looked again — and
// it emitted no note, so the only trace of the decision was the absence of one.
//
// FOUND BY THE MODEL-IN-THE-LOOP STUDY, 2026-08-26. All four venue-change amendments
// (R009, R019, R027, R049) logged "this message changed location_text" and then
// "no crew or time change in this message — the blocks are unchanged". The client said
// the job had moved, the engine agreed the message said so, and the order kept pointing
// at the old building. That is crew sent to the wrong place, which is the most expensive
// mistake this system can make.
//
// The short-circuit is still correct when the venue has NOT moved — re-searching ~3,000
// rows for the same wording can only return the same answer — so the two halves are
// tested together. Silence is not a move either: a later email that does not mention the
// venue must keep the one already resolved.
//
// Run: npx tsx test/venueMoved.ts
// ============================================================================
import { resolvePlace } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationFacts, ConversationState, PlaceCandidate } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const PLACES: PlaceCandidate[] = [
  { id: 49, name: "ExCel London", address: "1 Western Gateway", city: "London", zip: "E16 1XL", active: true },
  { id: 57, name: "Olympia London", address: "Hammersmith Road", city: "London", zip: "W14 8UX", active: true },
] as unknown as PlaceCandidate[];

/** Only the calls resolvePlace makes: the whole place list. */
const client = new OnsinchClient((async (method: string, path: string) => {
  if (method === "GET" && path.startsWith("/places")) {
    return { status: 200, data: { data: PLACES, pagination: { count: PLACES.length, pageCount: 1, nextPage: false } } };
  }
  return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1, nextPage: false } } };
}) as never);

const state = (location_text: string | undefined, place_id: number): ConversationState =>
  ({ place_id, facts: { ...(location_text ? { location_text } : {}) } as ConversationFacts } as ConversationState);

const facts = (location_text?: string): ConversationFacts =>
  ({ ...(location_text ? { location_text } : {}) } as ConversationFacts);

(async () => {
  console.log("\n[1] the venue moves, so it is resolved again");
  {
    const r = await resolvePlace(facts("Olympia London"), state("ExCeL", 49), client);
    ok(r.id === 57, "the order follows the client to Olympia, not ExCeL", `place ${r.id}`);
    // The note is deliberately NOT asserted here. resolvePlace answers from six branches
    // — the alias store, V3's adjudicator, V2's fuzzy match, the shell fallback,
    // matchPlace, provisioning — and only some return a note. The study's venue moves
    // came back from one that does not (`note: v2.note ?? undefined`), so the booking
    // relocated in silence. Announcing it is the CALLER's job, because compile() is the
    // only place holding both the old id and the new one; it raises "VENUE MOVED" there.
  }

  console.log("\n[2] the same venue, worded the same way, is not re-searched");
  {
    const r = await resolvePlace(facts("ExCeL"), state("ExCeL", 49), client);
    ok(r.id === 49, "the stored venue stands", `place ${r.id}`);
    ok(!r.note, "with no note, because nothing was decided", r.note ?? "(none)");
  }

  console.log("\n[3] punctuation and case are not a move");
  {
    const r = await resolvePlace(facts("the O2,"), state("The O2", 49), client);
    ok(r.id === 49, "normAddr decides, so a comma does not relocate a job", `place ${r.id}`);
  }

  console.log("\n[4] SILENCE IS NOT A MOVE — the common case, and the dangerous one to get wrong");
  {
    // Most follow-ups do not restate the venue. Treating that as a change would send the
    // job to the "No Location" placeholder after it had been correctly resolved.
    const r = await resolvePlace(facts(undefined), state("ExCeL", 49), client);
    ok(r.id === 49, "an email that does not mention the venue keeps the one resolved", `place ${r.id}`);
  }

  console.log("\n[5] a venue named for the first time is resolved, not inherited");
  {
    // The first email had no venue, so the thread carries the placeholder. The second
    // names one, and that IS new information even though nothing 'changed'.
    const r = await resolvePlace(facts("Olympia London"), state(undefined, 1), client);
    ok(r.id === 57, "the newly-named venue wins over the placeholder", `place ${r.id}`);
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
