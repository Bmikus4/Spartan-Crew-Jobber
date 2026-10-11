// ============================================================================
// The harness's scorer can say 0. A gate nobody has watched fail is a gate nobody has reason
// to believe, so each invariant is fed a planted violation here, and the oracle run (the
// perfect reader) is pinned at its known result on all three sets, simple and complex.
//
// Offline, no model call.  npx tsx test/harnessScore.ts
// ============================================================================
import { generate } from "../harness/adapters/spartan/generate";
import { score } from "../harness/adapters/spartan/score";
import { runCase, oracleExtract, mutantExtract } from "../harness/adapters/spartan/adapter";
import { generateCreate, generateUpdate } from "../harness/adapters/spartan/generate-complex";
import type { SpartanCase } from "../harness/adapters/spartan/generate";
import type { Op } from "../app/lib/v2/bot/ops";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const cases = generate(500);
const change = cases.find((c) => c.template === "time change by R number")!;
const thanks = cases.find((c) => c.template === "thanks")!;
const right = change.expected.ops;
const decision = (ops: Op[]) => ({ kind: "write" as const, interpretation: null, decision: { kind: "write" as const, ops: ops.map((op) => ({ source: "s", op })), why: [] }, executed: null, client: { id: change.input.company_id, name: null } });
const node = (obs: ReturnType<typeof score>, n: string) => obs.find((o) => o.node === n)!.ok;

console.log("each invariant fails when it is broken");
{
  const good = score(change, { recorded: decision(right), written: right, keys: right.map((_, i) => `k${i}`), error: null, ms: 1000 });
  ok(good.every((o) => o.node === "ai.intent" || o.ok === 1), "the right write scores 1 everywhere it is judged");
  const late = right.map((op) => ({ ...op, date: "2026-12-31" })) as Op[];
  ok(node(score(change, { recorded: decision(late), written: late, keys: ["a", "b"], error: null, ms: 1000 }), "inv.no_wrong_write") === 0, "a write on the wrong day is a wrong write");
  const theirs = right.map((op) => ({ ...op, order_id: 1 })) as Op[];
  ok(node(score(change, { recorded: decision(theirs), written: theirs, keys: ["a", "b"], error: null, ms: 1000 }), "inv.client_isolation") === 0, "a write on an order that is not the sender's breaks isolation");
  ok(node(score(change, { recorded: decision(right), written: right, keys: ["a", "a"], error: null, ms: 1000 }), "inv.no_double_write") === 0, "the same operation key twice is a double write");
  const priced = right.map((op) => ({ ...op, price: 10 })) as unknown as Op[];
  ok(node(score(change, { recorded: decision(priced), written: priced, keys: ["a", "b"], error: null, ms: 1000 }), "inv.forbidden_fields") === 0, "a price field is forbidden");
  ok(node(score(thanks, { recorded: null, written: [], keys: [], error: "OpenRouter 500", ms: 1000 }), "inv.terminal_state") === 0, "an email that threw has no final state");
  ok(node(score(thanks, { recorded: null, written: [], keys: [], error: null, ms: 301_000 }), "inv.five_minutes") === 0, "301 seconds misses five minutes");
  ok(node(score(thanks, { recorded: decision(right), written: right, keys: ["a", "b"], error: null, ms: 1000 }), "inv.no_wrong_write") === 0, "any write on a thanks email is wrong");
}

(async () => {
console.log("the perfect reader and the day-late control, through production's decideMessage");
{
  const sets: [string, SpartanCase[]][] = [["simple", cases], ["complex create", generateCreate(500)], ["complex update", generateUpdate(500)]];
  for (const [name, set] of sets) {
    for (const [label, reader] of [["perfect reader", oracleExtract], ["dates a day late", mutantExtract]] as const) {
      let e2e = 0, wrong = 0, inv = 0, invN = 0;
      const missed: string[] = [];
      for (const c of set) {
        const { result } = await runCase(c, reader(c));
        for (const o of result.observations) {
          if (o.node === "e2e") { e2e += o.ok; if (!o.ok) missed.push(`${c.id} ${c.template}`); }
          if (o.node === "inv.no_wrong_write" && !o.ok) wrong++;
          if (o.node.startsWith("inv.")) { inv += o.ok; invN++; }
        }
      }
      if (label === "perfect reader") {
        ok(inv === invN && e2e === set.length, `${name}, ${label}: ${set.length} of ${set.length} end to end, every invariant held`, `${e2e}/${set.length}, invariants ${inv}/${invN} ${missed.slice(0, 3).join(", ")}`);
      } else {
        // A model that misreads every date must be refused by grounding, never written.
        ok(wrong === 0, `${name}, ${label}: no wrong write`, `${wrong} wrong writes`);
      }
    }
  }
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
})();
