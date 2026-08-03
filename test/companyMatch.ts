// ============================================================================
// An existing client whose email names them slightly differently must resolve.
// ----------------------------------------------------------------------------
// matchCompany was exact-match only. That is the right rule for WRITES - it is
// what stops the engine creating a duplicate company - but it was also the only
// rule for READS, so a client who signs off with their full legal name did not
// resolve at all, and the thread went to needs-human as a "new company".
//
// Six of the nine live needs-human tickets were blocked this way, and four of the
// five "new" companies already existed in OnSinch, each missing by one word:
//
//   eclipse presentations   vs  eclipse                          (126)
//   we are family london    vs  we are family                    (324)
//   bigabox productions     vs  bigabox production               (55)
//   storyhouse              vs  storyhouse design and production (478)
//
// Ben, 2026-08-03, asked directly: "they are all matches yes."
//
// The dangerous direction is a WRONG match - it would attach a real order to the
// wrong client, which is worse than leaving it for a human. So the fallback is
// token-subset with two hard limits: every substantive token of the shorter name
// must appear in the longer, and it resolves ONLY when exactly one company
// qualifies. Two candidates means ambiguous means human.
//
// Run: npx tsx test/companyMatch.ts
// ============================================================================
import { matchCompany, type CompanyRec } from "../app/lib/engine/resolve";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

// Real names from the live tenant, including the whole "We Are …" crowd, which is
// what makes the ambiguity guard worth having.
const LIVE: CompanyRec[] = [
  { id: 126, name: "Eclipse" },
  { id: 324, name: "We Are Family" },
  { id: 325, name: "We Are The Fair" },
  { id: 383, name: "We are Innovision " },
  { id: 537, name: "We-Fab LTD" },
  { id: 711, name: "We Are Brd" },
  { id: 735, name: "We Are Collider " },
  { id: 55, name: "Bigabox Production Ltd" },
  { id: 478, name: "StoryHouse Design and Production Ltd " },
  { id: 150, name: "FARAGO PROJECTS" },
  { id: 652, name: "Blue Oak Removals" },
  { id: 264, name: "RTS" },
  { id: 238, name: "O Films" },
  { id: 1, name: "Spartan Crew" },
];

console.log("\n[1] the four live cases resolve to the right existing client");
{
  ok(matchCompany("Eclipse Presentations Ltd", LIVE) === 126, "Eclipse Presentations Ltd -> 126", String(matchCompany("Eclipse Presentations Ltd", LIVE)));
  ok(matchCompany("We Are Family London Ltd", LIVE) === 324, "We Are Family London Ltd -> 324", String(matchCompany("We Are Family London Ltd", LIVE)));
  ok(matchCompany("Bigabox Productions", LIVE) === 55, "Bigabox Productions -> 55", String(matchCompany("Bigabox Productions", LIVE)));
  ok(matchCompany("StoryHouse", LIVE) === 478, "StoryHouse -> 478", String(matchCompany("StoryHouse", LIVE)));
}

console.log("\n[2] exact matching still wins, unchanged");
{
  ok(matchCompany("Eclipse", LIVE) === 126, "exact");
  ok(matchCompany("blue oak removals ltd", LIVE) === 652, "legal suffix stripped, as before");
  ok(matchCompany("FARAGO PROJECTS", LIVE) === 150, "case-insensitive");
}

console.log("\n[3] a genuinely new company is still new");
{
  ok(matchCompany("Innovate Solutions Ltd.", LIVE) === null, "Innovate Solutions -> null", String(matchCompany("Innovate Solutions Ltd.", LIVE)));
  ok(matchCompany("Totally Unrelated Events", LIVE) === null, "unrelated -> null");
}

console.log("\n[4] ambiguity goes to a human, it does not pick one");
{
  // Two companies would qualify as a subset of this name.
  const ambiguous: CompanyRec[] = [...LIVE, { id: 999, name: "We Are Family London" }];
  ok(matchCompany("We Are Family London Ltd", ambiguous) === 999,
    "an EXACT match still wins over the shorter subset", String(matchCompany("We Are Family London Ltd", ambiguous)));
  // The MOST SPECIFIC subset wins - "Acme Events" (2 tokens) beats "Acme" (1).
  const twoSubsets: CompanyRec[] = [{ id: 11, name: "Acme" }, { id: 12, name: "Acme Events" }];
  ok(matchCompany("Acme Events Group Ltd", twoSubsets) === 12,
    "most specific subset wins", String(matchCompany("Acme Events Group Ltd", twoSubsets)));
  // A genuine tie IS ambiguous: two different 2-token names, neither more specific.
  const tie: CompanyRec[] = [{ id: 21, name: "Northern Rigging" }, { id: 22, name: "Rigging Northern" }];
  ok(matchCompany("Northern Rigging Services Ltd", tie) === null,
    "a real tie -> null, never a coin flip", String(matchCompany("Northern Rigging Services Ltd", tie)));
}

console.log("\n[5] short names cannot sweep (the RTS lesson)");
{
  // "RTS" must not match into longer names that merely contain the token, and a
  // one-short-token stored name must not swallow every client mentioning it.
  ok(matchCompany("RTS Productions Ltd", LIVE) === null,
    "a 3-letter stored name does not claim a longer client", String(matchCompany("RTS Productions Ltd", LIVE)));
  ok(matchCompany("Spare Parts Direct", LIVE) === null, "no mid-word or token coincidence");
  ok(matchCompany("O Films International", LIVE) === null,
    "'O Films' is too thin to extend", String(matchCompany("O Films International", LIVE)));
}

console.log("\n[6] never resolves to Spartan itself");
{
  ok(matchCompany("Spartan Crew Ltd", LIVE) === 1, "exact self-match is legitimate (internal orders)");
  // Spartan's own internal orders DO name themselves at length, and resolving
  // those to company 1 is correct - #13613 "Manchester Training" is company 1.
  ok(matchCompany("Spartan Crew Manchester Training", LIVE) === 1,
    "Spartan's own longer internal name still resolves to Spartan", String(matchCompany("Spartan Crew Manchester Training", LIVE)));
  // A DIFFERENT company that merely shares a word must not.
  ok(matchCompany("Spartan Signs Ltd", LIVE) === null,
    "a different business sharing one word does not become Spartan", String(matchCompany("Spartan Signs Ltd", LIVE)));
}

console.log("\n[7] empty and junk input");
{
  ok(matchCompany(undefined, LIVE) === null, "undefined -> null");
  ok(matchCompany("", LIVE) === null, "empty -> null");
  ok(matchCompany("Ltd", LIVE) === null, "a bare legal suffix normalises to nothing -> null");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
