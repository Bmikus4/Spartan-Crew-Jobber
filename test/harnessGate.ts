// ============================================================================
// The harness runs in the gate, so it cannot rot unseen again.
// ----------------------------------------------------------------------------
// harness/README.md named a gate test for the oracle run that did not exist, and from 10-20 the
// planner's world copy (plan.ts once) dropped the fake OnSinch's class methods: every harness case
// naming a venue or an R number ended "could not plan", and nothing went red for four days.
// This runs every set in-process with the perfect reader ($0, about two seconds) and holds:
//   - every case ends in a recorded decision, with a stable code (v2/reasons.ts), never "other";
//   - the late-dates control writes nothing wrong;
//   - the context set passes, and its answer needs the client's venues (adapter.ts forwards them);
//   - no set's end-to-end count falls below its floor. The floors are the 10-24 numbers after the
//     world fix: the sets' expected answers predate four rulings (quotes with shifts are booked,
//     10-13; the two-week rule and never the day alone, 10-15; the crew-chief count, 10-15), so
//     they are a ratchet, not a target. Raise a floor when a change lifts it.
// npx tsx test/harnessGate.ts
// ============================================================================
import { generate, generateContext } from "../harness/adapters/spartan/generate";
import { generateCreate, generateUpdate } from "../harness/adapters/spartan/generate-complex";
import { runCase, oracleExtract, mutantExtract } from "../harness/adapters/spartan/adapter";
import { FakeWorld } from "../harness/adapters/spartan/world";
import { decideMessage } from "../app/lib/v2/process";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const FLOOR: Record<string, number> = { simple: 304, create: 171, update: 154, context: 40 };

(async () => {
  const sets: Array<[string, ReturnType<typeof generate>, typeof oracleExtract]> = [
    ["simple", generate(), oracleExtract], ["create", generateCreate(), oracleExtract], ["update", generateUpdate(), oracleExtract],
    ["context", generateContext(), oracleExtract], ["mutant", generate(), mutantExtract],
  ];
  for (const [name, cases, ex] of sets) {
    let e2e = 0, wrong = 0, terminal = 0;
    const uncoded: string[] = [];
    for (const c of cases) {
      const { result, out } = await runCase(c, ex(c));
      const held = (n: string) => result.observations.find((o) => o.node === n)?.ok === 1;
      if (held("e2e")) e2e++;
      if (!held("inv.no_wrong_write")) wrong++;
      if (held("inv.terminal_state")) terminal++;
      const code = out.recorded?.decision.code;
      if (!code || code === "other") uncoded.push(`${c.id}: ${JSON.stringify(out.recorded?.decision).slice(0, 120)}`);
    }
    console.log(`\n[${name}] e2e ${e2e}/${cases.length}, wrong-write flags ${wrong}`);
    ok(terminal === cases.length, `every ${name} case ends in a recorded decision`, cases.length - terminal);
    ok(!uncoded.length, `every ${name} decision carries a code`, uncoded.slice(0, 3));
    if (name === "mutant") ok(wrong === 0, "dates read a day late never become a write", wrong);
    else ok(e2e >= FLOOR[name], `${name} end to end at or above its floor of ${FLOOR[name]}`, e2e);
  }

  console.log("\n[context] the answer needs the client's venues");
  {
    const c = generateContext(1)[0];
    let seen: any = null;
    await decideMessage(c.input.message, { extract: oracleExtract(c), world: new FakeWorld([]), threadOrderId: async () => null, run: null, record: async (r) => { seen = r; }, trace: () => {} });
    // Without the list the planner adds "Ally Pally" to OnSinch as a new venue: a second Alexandra Palace.
    const at = seen?.decision.kind === "write" ? seen.decision.ops[0]?.op?.shifts?.[0]?.place_id : null;
    ok(at !== "42", "with no history to list Alexandra Palace among its venues, \"Ally Pally\" is not booked there", at);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
