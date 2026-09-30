// ============================================================================
// The nested read sees every block, and sees it whole.
// ----------------------------------------------------------------------------
// readLiveShape reads blocks through /attendance, so a block nobody is signed on to does
// not exist to it, and a block is only ever one seat's view of it. `GET /orders?id[eq]=N
// &with=Job__SlotTeam__Slot` returns every block with every position (design §30 step
// 3; measured on 390 orders 2026-09-29). This pins the parser against real reads cut
// from that set, and the shadow comparison that runs it beside the old read.
//
// Offline.  npx tsx test/nestedShape.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { nestedShape, compareShapes, type LiveShape } from "../app/lib/engine/reconcile";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const orders = JSON.parse(readFileSync(new URL("./fixtures/nested-orders.json", import.meta.url), "utf8")) as any[];
const byId = (id: number) => orders.find((o) => o.id === id)!;

console.log("\n[1] every block is visible, staffed or not");
for (const o of orders) {
  const want = (o.Job ?? []).reduce((n: number, j: any) => n + (j.SlotTeam ?? []).length, 0);
  ok(nestedShape(o).teams.size === want, `#${o.id}: ${want} block(s)`, String(nestedShape(o).teams.size));
}

console.log("\n[2] a block's size is the sum of its positions");
{
  // #16305 "Derig": a Crew Chief position (role 1, profession 36) and three crew.
  const derig = [...nestedShape(byId(16305)).teams.values()].find((t) => t.name === "Derig")!;
  ok(derig.size === 4, "chief + 3 crew is 4", String(derig.size));
  ok(derig.positions === 2, "and it is two positions, so not PATCHable", String(derig.positions));
  ok(derig.profession_id === 1, "its trade is the staff position's, not the chief's", String(derig.profession_id));
}

console.log("\n[3] a single-position block carries its own trade and times");
{
  const s = nestedShape(byId(16301));
  const raw = byId(16301).Job[0].SlotTeam[0];
  const t = s.teams.get(raw.id)!;
  ok(t.positions === 1 && t.size === raw.Slot[0].size, "size from its one position", `${t.size}`);
  ok(t.beginning === raw.Slot[0].beginning && t.end === raw.Slot[0].end, "times from its position");
  ok(t.profession_id === raw.Slot[0].profession_id, "trade from its position");
}

console.log("\n[4] the window comes from the positions, never the job's stale span");
{
  // #16306 reads min_beginning/max_end null with a block underneath (51 of 388 did).
  const o = byId(16306);
  ok(o.Job[0].min_beginning == null, "the job window is null in the read");
  const s = nestedShape(o);
  ok(!!s.window?.beginning && !!s.window?.end, "the nested window is not", JSON.stringify(s.window));
}

console.log("\n[5] staggered positions widen the block to their span");
{
  const o = byId(16281);
  const team = o.Job[0].SlotTeam.find((t: any) => new Set(t.Slot.map((x: any) => x.beginning)).size > 1);
  const t = nestedShape(o).teams.get(team.id)!;
  const starts = team.Slot.map((x: any) => Date.parse(x.beginning));
  ok(Date.parse(t.beginning!) === Math.min(...starts), "earliest start", t.beginning);
}

console.log("\n[6] the shadow says what the old read cannot see, and where they disagree");
{
  const nested = nestedShape(byId(16301));
  const [a, b] = [...nested.teams.values()];
  // The attendance read sees only a staffed block, and here one seat on it says 1.
  const attendance: LiveShape = { order_id: 16301, window: null, teams: new Map([[a.id, { ...a, size: 1 }]]), staffedBlocks: 1 };
  const cmp = compareShapes(attendance, nested);
  ok(cmp.onlyNested.includes(b.id), "the unstaffed block is reported", JSON.stringify(cmp.onlyNested));
  ok(cmp.differ.some((d) => d.id === a.id && d.field === "size") === (a.size !== 1), "a size difference on the shared block is reported",
    JSON.stringify(cmp.differ));
  const same = compareShapes(nested, nested);
  ok(same.agree && !same.onlyNested.length && !same.differ.length, "and a read agrees with itself");
}

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
process.exitCode = fails === 0 ? 0 : 1;
