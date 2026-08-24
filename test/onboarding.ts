// ============================================================================
// Onboarding and identity: the rules that decide what a person is shown and called.
// ----------------------------------------------------------------------------
// Every assertion here is a thing that was wrong in the tool this was ported from,
// or that would be invisible if it broke:
//
//   - A name INVENTED from bookings@ or info@ goes on a profile card and stays there.
//     An empty box gets corrected; a plausible wrong name never does.
//   - A personal mailbox has NO organisation, and asserting one prints something false
//     on that person's profile forever. "" has to survive as an answer.
//   - Colours are assigned by ARRIVAL ORDER, so the first two people in a company must
//     not be neighbours on the wheel — they are the pair most often seen side by side.
//   - /api/onboarding must read the caller's identity from the SESSION. A route that
//     took "which user am I" as a parameter would let anyone accept terms in a
//     colleague's name.
//   - The flow must let people THROUGH on every failure. Onboarding cannot be the
//     reason somebody cannot work.
//
// Run: npx tsx test/onboarding.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { orgKey, organisationFor, suggestedName, TERMS_VERSION } from "../app/lib/orgProfile";
import { handleFor, initialsFor, nameFor, userHue, USER_HUES } from "../app/lib/userIdentity";
import { TERMS_SECTIONS, termsPlainText } from "../app/lib/terms";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

async function main() {
  console.log("who an address belongs to");
  ok(orgKey("Ben@SpartanCrew.co.uk ") === "spartancrew.co.uk", "the org key is the lowercased domain");
  ok(organisationFor("ops@spartancrew.co.uk") === "Spartan Crew", "a known domain names the company");
  ok(organisationFor("ben@samuraisolutions.co.uk") === "SamurAI Solutions", "both configured domains resolve");
  ok(organisationFor("benjamintmikus@gmail.com") === "", "a personal mailbox has NO organisation, and says so");

  console.log("");
  console.log("the name it will suggest, and the names it refuses to invent");
  ok(suggestedName("ben.mikus@spartancrew.co.uk") === "Ben Mikus", "first and last out of the local part");
  ok(suggestedName("steven@spartancrew.co.uk") === "Steven", "a single token is a first name");
  ok(suggestedName("bookings@spartancrew.co.uk") === "", "bookings@ spells out no person");
  ok(suggestedName("info@spartancrew.co.uk") === "", "nor does info@");
  ok(suggestedName("accounts.team@spartancrew.co.uk") === "", "nor a mailbox made only of generic words");
  ok(suggestedName("crew2@spartancrew.co.uk") === "", "nor a role with a number on it");

  console.log("");
  console.log("handles, initials and what to call somebody");
  ok(handleFor("Ben.Mikus@spartancrew.co.uk") === "benmikus", "the handle strips dots, so a full stop cannot be part of it");
  ok(initialsFor("Ben Mikus", "b@x.com") === "BM", "initials come from the name when there is one");
  ok(initialsFor("", "ben.mikus@x.com") === "BM", "and from the address when there is not");
  ok(initialsFor("", "") === "?", "and never render empty");
  ok(nameFor({ displayName: "", handle: "benmikus" }) === "@benmikus",
     "somebody with no name on record is called by their handle, not by a blank");

  console.log("");
  console.log("colour by arrival order");
  ok(userHue(0) !== userHue(1), "the first two people in a company get different hues");
  ok(Math.abs(userHue(0) - userHue(1)) > 60, "and not adjacent ones", `${userHue(0)} vs ${userHue(1)}`);
  ok(userHue(USER_HUES.length) === userHue(0), "the wheel cycles rather than running out");
  ok(userHue(undefined) === userHue(0) && userHue(-1) === userHue(USER_HUES.length - 1),
     "an absent or negative index still resolves");
  ok(new Set(USER_HUES).size === USER_HUES.length, "no hue is listed twice");

  console.log("");
  console.log("the route reads the caller from the session, never from the body");
  const route = read("app/api/onboarding/route.ts");
  ok(/getIronSession/.test(route), "it opens the session");
  ok(!/body\.email/.test(route), "and never takes an email from the request body");
  ok(/organisationFor\(email\) \|\| typed/.test(route),
     "a typed organisation is only trusted when the domain supplies none");
  ok(/status: 401/.test(route), "an unsigned caller is refused");
  // The skip list in middleware is what makes a route machine-reachable. This one must
  // NOT be on it: everything it writes is filed under the caller's own identity.
  const mw = read("middleware.ts");
  ok(!/onboarding/.test(mw), "and it is not on middleware's auth skip list");

  console.log("");
  console.log("onboarding can never lock somebody out");
  const db = read("app/lib/onboardingDb.ts");
  ok(/catch\s*{/.test(db) && !/throw/.test(db), "the store swallows every failure rather than throwing");
  const flow = read("app/components/onboarding/OnboardingFlow.tsx");
  ok((flow.match(/onDone\(\)/g) || []).length >= 3,
     "the flow lets people through on a bad response, on a thrown error, and on nothing outstanding");
  ok(/setTimeout\(onDone, 6000\)/.test(flow),
     "and on SILENCE — a request that never answers would otherwise be a blank screen with no way out");
  ok(/needsTerms \? "terms" : "profile"/.test(flow),
     "the server decides which gate is outstanding, not the browser");

  console.log("");
  console.log("the terms an organisation is agreeing to");
  ok(TERMS_SECTIONS.length >= 5, "there are sections", String(TERMS_SECTIONS.length));
  ok(/OnSinch/.test(termsPlainText()),
     "and they say what this tool reads and writes — nobody should have to infer that from the product name");
  ok(/^\d{4}-\d{2}-\d{2}$/.test(TERMS_VERSION), "the version is a date", TERMS_VERSION);
  // The acceptance table is keyed on the version, which is the only thing that makes a
  // bump re-ask. A version that is not in the key silently treats an old signature as
  // covering new text.
  ok(/PRIMARY KEY \(org_key, terms_version\)/.test(db), "and it is part of the acceptance key");
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
