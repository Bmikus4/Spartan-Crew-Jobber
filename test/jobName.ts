// ============================================================================
// The OnSinch Job name must keep its DATE.
//
// jobNameFrom built "<size> at <location> on <date>" and then truncated the whole
// string to 100 chars. A long venue address therefore ate the date off the end.
// Live thread 19fb237ffe62ff48 staged a patch of real order 13632 whose job name
// read "...London E16 2HB on 2026" - the address is 87 chars, so the string is
// 106 and the cut lands four characters into the year.
//
// The date is the single most load-bearing token in a crew job name: it is what a
// human scans for, and what the order->thread linkage matches on. The venue is
// the part that can afford to lose its tail.
//
// Run: npx tsx test/jobName.ts
// ============================================================================
import { jobNameFrom } from "../app/lib/engine/compiler";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const facts = (loc: string, date?: string, size?: number): ConversationFacts => ({
  location_text: loc,
  requests: [{ date, size }],
});

// The exact live case off the board.
const LONG = "Unit A, The Factory Project, Thameside Industrial Estate, 33 Factory Rd, London E16 2HB";

console.log("\n[1] the live case that lost its date (order 13632)");
{
  const n = jobNameFrom(facts(LONG, "2026-08-04", 2));
  console.log(`      -> ${JSON.stringify(n)}  (${n.length} chars)`);
  ok(n.length <= 80, "still within the 80-char limit", String(n.length));
  ok(n.endsWith("2026-08-04"), "ENDS WITH THE FULL DATE (was '...on 2026')");
  ok(n.startsWith("2 at "), "still leads with the crew size");
  ok(/Unit A/.test(n), "keeps the start of the venue");
}

console.log("\n[2] a short venue is untouched");
{
  const n = jobNameFrom(facts("ExCeL London", "2026-08-12", 6));
  ok(n === "6 at ExCeL London on 2026-08-12", "unchanged", JSON.stringify(n));
}

console.log("\n[3] missing pieces still render, and the date still survives");
{
  const a = jobNameFrom(facts(LONG, undefined, 4));
  ok(a.endsWith("TBC"), "no date -> ends with TBC", JSON.stringify(a.slice(-24)));
  const b = jobNameFrom(facts(LONG, "2026-09-01", undefined));
  ok(b.startsWith("? at "), "no size -> '?'");
  ok(b.endsWith("2026-09-01"), "date still survives without a size");
  const c = jobNameFrom({ requests: [] });
  ok(c === "? at TBC on TBC", "nothing at all", JSON.stringify(c));
}

console.log("\n[4] a venue long enough to blow the budget on its own");
{
  const absurd = "A".repeat(300);
  const n = jobNameFrom(facts(absurd, "2026-12-25", 3));
  ok(n.length <= 80, "capped", String(n.length));
  ok(n.endsWith("2026-12-25"), "date STILL survives a 300-char venue");
  ok(n.startsWith("3 at AAA"), "venue truncated, not the date");
}

console.log("\n[5] the limit is EIGHTY — 100 was a guess and it 400s on the wire");
{
  // The corpus separates this perfectly: of 500 cases, the 100 whose composed Job
  // name exceeds 80 characters produced all 147 `POST /orders -> 400`, and the 400
  // whose name fits produced none. An ordinary London address is enough to do it.
  const excel = "Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";
  const n = jobNameFrom(facts(excel, "2026-09-15", 2));
  ok(n.length <= 80, "the ExCeL address fits", `${n.length}: ${JSON.stringify(n)}`);
  ok(n.endsWith("on 2026-09-15"), "and still keeps its date");
  // 81 characters was the reject boundary for the SlotTeam name and it is the same
  // limit here; the guard is on the number, so a future edit to 100 fails loudly.
  const long = jobNameFrom(facts("z".repeat(200), "2026-09-15", 40));
  ok(long.length === 80, "a name budgeted to the limit is exactly 80", String(long.length));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
