// ============================================================================
// The job matcher's score (app/lib/match/score.ts): bits per level summed per candidate, a null
// level adding nothing, the density bucket choosing the time table, and "none of these" as one
// more option whose bits depend on whether the email asks for new work.
// Offline.  npx tsx test/matchScore.ts
// ============================================================================
import { score, densityBucket, type Weights } from "../app/lib/match/score";
import weights from "../app/lib/match/weights.json";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`); };
const lw = (w: number) => ({ w, m: 0, u: 0, n1: 0, n0: 0 });
const W: Weights = {
  version: "test", fitted_on: "test", stratified: ["time"],
  levels: {
    reference: { all: { "PO in the newest words": lw(4), none: lw(-1) } },
    time: { "1": { "day and start": lw(5) }, "4+": { "day and start": lw(1) }, all: { "day and start": lw(3) } },
  },
  none: { new_work: 2, other: -3 },
};
const cmp = (over: Record<string, string | null>) => ({ reference: null, person: null, precedent: null, company: null, time: null, coverage: null, size: null, place: null, subject: null, thread: null, state: null, age: null, ...over });
const ctx = (density: number, asks_new: boolean) => ({ candidates: 2, density, intent: null, asks_new, reading: "model" as const });

console.log("\n[1] summing and absence");
const a = score({ candidates: [{ order_id: 1, r: "R1", j: null, company_id: 1, via: [], cmp: cmp({ reference: "PO in the newest words", time: "day and start" }) }, { order_id: 2, r: "R2", j: null, company_id: 1, via: [], cmp: cmp({}) }], context: ctx(1, false) } as any, W);
ok(a.candidates[0].order_id === 1 && a.candidates[0].bits === 9, "PO (4) and a lone client's day and start (5) make 9 bits", String(a.candidates[0].bits));
ok(a.candidates[1].bits === 0, "a candidate with every family null scores 0, not below it");
ok(a.top.order_id === 1 && Math.abs(a.candidates.reduce((s, c) => s + c.p, 0) + a.none.p - 1) < 1e-9, "probabilities over the candidates and none sum to 1");

console.log("\n[2] density changes what the same day and start is worth");
const busy = score({ candidates: [{ order_id: 1, r: "R1", j: null, company_id: 1, via: [], cmp: cmp({ time: "day and start" }) }], context: ctx(6, false) } as any, W);
ok(densityBucket(6) === "4+" && busy.candidates[0].bits === 1, "eight of the client's jobs that day: 1 bit, not 5", String(busy.candidates[0].bits));

console.log("\n[3] none of these");
const nw = score({ candidates: [{ order_id: 1, r: "R1", j: null, company_id: 1, via: [], cmp: cmp({ reference: "none" }) }], context: ctx(1, true) } as any, W);
ok(nw.top.order_id === null && nw.none.bits === 2, "a booking whose only candidate has nothing for it is a new job", JSON.stringify(nw.top));
const empty = score({ candidates: [], context: ctx(0, false) } as any, W);
ok(empty.top.order_id === null && empty.none.p === 1, "no candidates: none of these, certainly");

console.log("\n[4] the fitted table");
const fw = weights as unknown as Weights;
ok(fw.levels.reference?.all?.["R or J in the newest words"]?.w! > fw.levels.reference?.all?.["none"]?.w!, "an R or J in the client's newest words outweighs no reference", String(fw.levels.reference?.all?.["R or J in the newest words"]?.w));
ok(fw.levels.time?.all?.["no asked day"]?.w! < fw.levels.time?.all?.["day, no time asked"]?.w!, "holding no asked day weighs against holding one");

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
