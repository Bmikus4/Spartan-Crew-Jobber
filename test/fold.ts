// ============================================================================
// A job's state is a fold over change facts, and silence changes nothing.
// ----------------------------------------------------------------------------
// Characterisation A1 (.tmp-data/job-identity-2026-09-29/plan-characterisation.ts):
// mergeFacts replaced the whole block list, so a message changing ONE block of three
// dropped the other two, 12 crew to 8. A2: there was no way to say "remove this block".
// Both flip to MEETS here, with the authority rules of design §15 around them.
//
// Offline.  npx tsx test/fold.ts
// ============================================================================
import { fold, liveBlocks, type ChangeSet } from "../app/lib/engine/fold";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const booking: ChangeSet = {
  source: "m1", at: "2026-10-01T09:00:00Z", authority: "client_requested",
  own_text: "Please book 4 for the build on the 12th, 4 on the 13th and 4 for the derig on the 14th.",
  ops: [
    { op: "add_block", ref: "b1", block: { day: "2026-11-12", start: "08:00", end: "18:00", size: 4, task: "build" }, quote: "4 for the build on the 12th" },
    { op: "add_block", ref: "b2", block: { day: "2026-11-13", start: "08:00", end: "18:00", size: 4, task: "show" }, quote: "4 on the 13th" },
    { op: "add_block", ref: "b3", block: { day: "2026-11-14", start: "08:00", end: "18:00", size: 4, task: "derig" }, quote: "4 for the derig on the 14th" },
  ],
};
const crew = (cs: ChangeSet[]) => liveBlocks(fold(cs)).reduce((n, b) => n + (b.size ?? 0), 0);

console.log("\n[A1] a change to one block leaves the others alone");
{
  const derig6: ChangeSet = { source: "m2", at: "2026-10-02T09:00:00Z", authority: "client_requested",
    own_text: "Can you make the derig 6 instead?", ops: [{ op: "set", ref: "b3", field: "size", value: 6, quote: "make the derig 6" }] };
  ok(crew([booking]) === 12, "12 crew booked", String(crew([booking])));
  ok(crew([booking, derig6]) === 14, "the derig becomes 6 and the other 8 stay (the old merge left 8 in all)", String(crew([booking, derig6])));
  ok(liveBlocks(fold([booking, derig6])).length === 3, "three blocks remain");
}

console.log("\n[A2] a block can be removed, in the client's own words");
{
  const drop: ChangeSet = { source: "m3", at: "2026-10-03T09:00:00Z", authority: "client_requested",
    own_text: "We no longer need crew on the 13th.", ops: [{ op: "remove_block", ref: "b2", quote: "no longer need crew on the 13th" }] };
  ok(liveBlocks(fold([booking, drop])).map((b) => b.ref).join() === "b1,b3", "the 13th is gone", liveBlocks(fold([booking, drop])).map((b) => b.ref).join());
  const invented: ChangeSet = { ...drop, source: "m3b", own_text: "Thanks for this.", ops: [{ op: "remove_block", ref: "b2", quote: "cancel the 13th" }] };
  const s = fold([booking, invented]);
  ok(liveBlocks(s).length === 3 && s.rejected.some((r) => /own words/.test(r.why)), "a removal the email never says is refused", JSON.stringify(s.rejected));
}

console.log("\n[3] history is kept: 4 -> 6 -> 4 is three facts, and the current is the last");
{
  const up: ChangeSet = { source: "m2", at: "2026-10-02T09:00:00Z", authority: "client_requested", own_text: "Make the build 6 please.", ops: [{ op: "set", ref: "b1", field: "size", value: 6, quote: "make the build 6" }] };
  const back: ChangeSet = { source: "m4", at: "2026-10-04T09:00:00Z", authority: "client_requested", own_text: "Back to 4 for the build, sorry.", ops: [{ op: "set", ref: "b1", field: "size", value: 4, quote: "back to 4 for the build" }] };
  const v = fold([booking, up, back]).blocks.get("b1")!.fields.size!;
  ok(v.value === 4 && v.supersedes?.value === 6 && v.supersedes?.supersedes?.value === 4, "4, superseding 6, superseding 4");
}

console.log("\n[4] only a client or ops value is a value");
{
  const ours: ChangeSet = { source: "out1", at: "2026-10-02T09:00:00Z", authority: "spartan_stated", ops: [{ op: "set", ref: "b1", field: "size", value: 10 }] };
  const guess: ChangeSet = { source: "m5", at: "2026-10-02T10:00:00Z", authority: "inferred", ops: [{ op: "set", ref: "b1", field: "size", value: 9 }] };
  const s = fold([booking, ours, guess]);
  ok(s.blocks.get("b1")!.fields.size!.value === 4, "what Spartan said and what a model guessed change nothing", String(s.blocks.get("b1")!.fields.size!.value));
  const ops: ChangeSet = { source: "onsinch:991", at: "2026-10-02T11:00:00Z", authority: "ops_live", ops: [{ op: "set", ref: "b1", field: "task", value: "build + load-in" }] };
  const client: ChangeSet = { source: "m6", at: "2026-10-03T09:00:00Z", authority: "client_requested", own_text: "It is just the build.", ops: [{ op: "set", ref: "b1", field: "task", value: "build", quote: "just the build" }] };
  ok(fold([booking, ops, client]).blocks.get("b1")!.fields.task!.value === "build + load-in", "an ops-owned field keeps ops' live value");
  const def: ChangeSet = { source: "rule:18:00", at: "2026-10-02T09:00:00Z", authority: "engine_default", ops: [{ op: "set", ref: "b1", field: "end", value: "17:00" }] };
  ok(fold([booking, def]).blocks.get("b1")!.fields.end!.value === "18:00", "a default never overwrites a stated value");
}

console.log("\n[5] validation refuses what cannot be true");
{
  const bad: ChangeSet = { source: "m7", at: "2026-10-02T09:00:00Z", authority: "client_requested", own_text: "make it minus two",
    ops: [{ op: "set", ref: "b1", field: "size", value: -2 }, { op: "set", ref: "b9", field: "size", value: 3 }, { op: "set", ref: "b2", field: "start", value: "25:00" }] };
  const s = fold([booking, bad]);
  ok(s.rejected.length === 3, "impossible size, unknown block, impossible time", s.rejected.map((r) => r.why).join(" | "));
  ok(crew([booking, bad]) === 12, "and nothing moved");
}

console.log("\n[6] the fold is deterministic");
{
  const a: ChangeSet = { source: "m2", at: "2026-10-02T09:00:00Z", authority: "client_requested", own_text: "Make it 5.", ops: [{ op: "set", ref: "b1", field: "size", value: 5, quote: "make it 5" }] };
  const b: ChangeSet = { source: "m3", at: "2026-10-02T09:00:00Z", authority: "client_requested", own_text: "Make it 7.", ops: [{ op: "set", ref: "b1", field: "size", value: 7, quote: "make it 7" }] };
  const one = JSON.stringify(liveBlocks(fold([booking, a, b])));
  ok(one === JSON.stringify(liveBlocks(fold([b, booking, a]))), "the same facts in any order fold the same", one);
}

console.log("\n[7] design §15, as the step 6 plan read it (2026-10-01)");
{
  const unquoted: ChangeSet = { source: "m8", at: "2026-10-02T09:00:00Z", authority: "client_requested", own_text: "Thanks!", ops: [{ op: "set", ref: "b1", field: "size", value: 9 }] };
  ok(fold([booking, unquoted]).blocks.get("b1")!.fields.size!.value === 4, "a client value with no quote moves nothing (it is inferred)");
  const noText: ChangeSet = { source: "m9", at: "2026-10-02T09:00:00Z", authority: "client_requested", ops: [{ op: "set", ref: "b1", field: "size", value: 9, quote: "make it 9" }] };
  ok(fold([booking, noText]).blocks.get("b1")!.fields.size!.value === 4, "no own text is no evidence, not a pass");
  const opsProf: ChangeSet = { source: "onsinch:992", at: "2026-10-02T09:00:00Z", authority: "ops_live", ops: [{ op: "set", ref: "b1", field: "profession", value: 1 }] };
  const clientProf: ChangeSet = { source: "m10", at: "2026-10-03T09:00:00Z", authority: "client_requested", own_text: "We need riggers for the build.", ops: [{ op: "set", ref: "b1", field: "profession", value: 5, quote: "riggers for the build" }] };
  ok(fold([booking, opsProf, clientProf]).blocks.get("b1")!.fields.profession!.value === 5, "profession is client-owned: the later client value wins");
  const seed: ChangeSet = { source: "migrated:t1", at: "2026-10-05T09:00:00Z", authority: "migrated", ops: [{ op: "set", ref: "b1", field: "size", value: 2 }] };
  ok(fold([booking, seed]).blocks.get("b1")!.fields.size!.value === 4, "a migrated value fills a gap, never outranks a client value");
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
