// ============================================================================
// "Albert Hall" means the Royal Albert Hall, because Spartan says so.
// ----------------------------------------------------------------------------
// A bare "Albert Hall" ranks Manchester's Albert Hall and London's Royal Albert Hall
// about equally, and it should — both are real venues carrying that name. The
// adjudicator did the correct thing and abstained:
//
//   "could refer to the Royal Albert Hall in London or the Albert Hall in Manchester.
//    Without a city or postcode, there is not enough to choose."
//
// Abstaining means provisioning a new row, so five of the fifty enquiries in the
// 2026-08-26 study created a duplicate Albert Hall. Every venue miss in that study was
// this one wording.
//
// It was never a matching problem. It is a missing business rule — which one does a
// Spartan client mean when they do not say — and Ben ruled on 2026-08-26: "Albert Hall
// should default to Royal Albert Hall."
//
// WHAT THIS FILE PROTECTS is the scope of that ruling. A table of hand-set answers is
// the easiest thing in a codebase to quietly grow into a dumping ground for matching
// that should have been fixed in the matcher, and the boundaries below are the ruling's
// actual edges: it fires on the ambiguous wording and on nothing adjacent to it.
//
// Run: npx tsx test/ruledWording.ts
// ============================================================================
import { applyRuledWording } from "../app/lib/engine/venueSearch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

console.log("\n[1] the ruling applies, and says that it did");
{
  for (const wrote of ["Albert Hall", "albert hall", "The Albert Hall", "the albert hall", "  Albert Hall  "]) {
    const r = applyRuledWording(wrote);
    ok(r.text === "Royal Albert Hall", `"${wrote}" -> Royal Albert Hall`, r.text);
    ok(!!r.note && /ruled/.test(r.note), "and the ticket says a ruling was applied");
  }
}

console.log("\n[2] a wording that is ALREADY unambiguous is left alone");
{
  // Rewriting these would be pointless at best. At worst it hides that the tenant's own
  // row was matched on its real name.
  for (const wrote of ["Royal Albert Hall", "RAH", "royal albert hall, kensington gore"]) {
    const r = applyRuledWording(wrote);
    ok(r.text === wrote.trim(), `"${wrote}" is untouched`, r.text);
    ok(!r.note, "and no ruling is claimed");
  }
}

console.log("\n[3] A CLIENT WHO SAYS WHICH ONE IS BELIEVED — the rule must not override them");
{
  // This is the case that would make the ruling harmful rather than helpful: a client
  // who names Manchester means Manchester, and a default that overruled them would send
  // crew 200 miles the wrong way.
  for (const wrote of ["Albert Hall Manchester", "Albert Hall, Manchester", "Manchester Albert Hall", "Albert Hall M2 5PW"]) {
    const r = applyRuledWording(wrote);
    ok(r.text === wrote.trim(), `"${wrote}" keeps the city the client gave`, r.text);
    ok(!r.note, "and no ruling fires");
  }
}

console.log("\n[4] nothing merely CONTAINING the words is caught");
{
  for (const wrote of ["Albert Hall Hotel", "Prince Albert Hall of Residence", "Albert Halls Bolton"]) {
    const r = applyRuledWording(wrote);
    ok(r.text === wrote.trim(), `"${wrote}" is not the ruled wording`, r.text);
  }
}

console.log("\n[5] the table holds rulings only — an unruled ambiguity stays unruled");
{
  // "The NEC" resolves to nothing today and is a known open defect. It is deliberately
  // NOT in the table: nobody has ruled on it, and guessing here is the overreach this
  // test exists to catch.
  const r = applyRuledWording("The NEC");
  ok(r.text === "The NEC" && !r.note, "\"The NEC\" is untouched until somebody decides it", r.text);
}

console.log("\n[6] it never throws on the shapes a real thread produces");
{
  for (const wrote of ["", "   "]) {
    const r = applyRuledWording(wrote);
    ok(typeof r.text === "string", `empty input is handled`, JSON.stringify(r.text));
  }
  ok(applyRuledWording(undefined as unknown as string).text === "", "undefined is handled");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
