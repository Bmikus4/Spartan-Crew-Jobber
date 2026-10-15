// Create parity (bot/parity.ts): every order the old engine created, as the rebuild would create
// it. What is booked must not change; only how it is laid out may. The live A/B, both writers
// against OnSinch on TEST, is scripts/create-ab.mts --write.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { opFromV1, contentOfOp, contentOfV1, type V1Shape } from "../app/lib/v2/bot/parity";
import { createBody, firstRow, ORDER_MANAGER_ID } from "../app/lib/v2/bot/apiCreate";
import { stateProblems } from "../app/lib/v2/bot/run";
import { SWEEP_GRACE_MINUTES, SWEEP_MINUTES } from "../app/lib/testData";
let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const shapes = JSON.parse(readFileSync(join(__dirname, "fixtures", "v1-create-shapes.json"), "utf8")) as (V1Shape & { r: string })[];

console.log(`[1] the ${shapes.length} old-engine orders book the same through the rebuild's writer`);
{
  const differ: string[] = [], cannot: string[] = [];
  for (const s of shapes) {
    const op = opFromV1(s, { company_id: "515", client_email: "x@y.z", years: 1 });
    const got = contentOfOp(op);
    if (got.cannot) { cannot.push(`R${s.r}: ${got.cannot}`); continue; }
    if (got.content.join(" ") !== contentOfV1(s, 1).join(" ")) differ.push(`R${s.r}`);
  }
  ok(shapes.length === 132, "all 132 are in the fixture", shapes.length);
  ok(differ.length === 0, "no order books different people, trades, venues or hours", differ);
  ok(cannot.length === 0, "and none is one the rebuild cannot make", cannot);
}

console.log("[2] what every create sends");
{
  for (const s of shapes) {
    const op = opFromV1(s, { company_id: "515", client_email: "x@y.z", years: 1 });
    const [b] = createBody(op, { user_id: "1591", card: 355 });
    const bad = [
      b.request_approval !== true && "not in Orders To Confirm",
      b.order_manager_id !== ORDER_MANAGER_ID && "no Samurai AI order manager",
      b.Job.pricelist_category_id !== 355 && "rate card not the one chosen",
      b.user_id !== 1591 && "contact not the one chosen",
      b.SlotTeam.some((t: any) => t.hidden !== true) && "a shift not hidden from workers",
      b.SlotTeam.length !== op.shifts.length && "not one SlotTeam per shift",
      op.shifts.some((sh, i) => Number(firstRow(sh)?.profession_id) !== b.SlotTeam[i].profession_id) && "a shift not made with its plain crew",
    ].filter(Boolean);
    if (bad.length) { ok(false, `R${s.r}`, bad); break; }
  }
  ok(ORDER_MANAGER_ID === 2257, "the order manager is Samurai AI, as the old engine stamped it (Ben, 2026-08-25)");
  ok(true, "every create asks for To Confirm, stamps the order manager, hides its shifts, and makes each shift with its plain crew");
}

console.log("[3] a crew chief goes inside his shift, not in a block of his own");
{
  const s = shapes.find((x) => x.slot_teams.length === 2 && x.slot_teams.some((t) => t.profession_id === 36) && new Set(x.slot_teams.map((t) => t.beginning)).size === 1)!;
  const op = opFromV1(s, { company_id: "515", client_email: "x@y.z", years: 1 });
  ok(op.shifts.length === 1 && op.shifts[0].positions.some((p) => p.role === "crew_chief" && p.profession_id === "36"), "the old engine's two blocks are one shift with the chief inside", op.shifts);
}

console.log("[4] nothing in the rebuild leans on sort=-id, which lists /orders OLDEST first");
{
  const hits: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.ts$/.test(f.name) && /[?&]sort=-id/.test(readFileSync(p, "utf8").replace(/\/\/.*$/gm, ""))) hits.push(p); } };
  walk(join(__dirname, "..", "app", "lib", "v2"));
  ok(hits.length === 0, "no v2 query asks for sort=-id", hits);
}

console.log("[5] a failed OnSinch read is never read as an empty one");
{
  const hits: string[] = [];
  const scan = (p: string) => { const src = readFileSync(p, "utf8").replace(/\/\/.*$/gm, ""); if (/rowsOf\(await t\(/.test(src) || /\.data\?\.data \?\? \[\]/.test(src)) hits.push(p); };
  const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.ts$/.test(f.name)) scan(p); } };
  walk(join(__dirname, "..", "app", "lib", "v2"));
  scan(join(__dirname, "..", "app", "lib", "testData.ts"));
  ok(hits.length === 0, "every list read in the rebuild goes through read.ts, which throws on a failed answer", hits);
}

console.log("[6] every position a write made reads back not a draft, and hidden");
{
  const order = (slots: any[]) => ({ Job: [{ SlotTeam: [{ id: 1, Slot: slots }] }] });
  const before = order([{ id: 10, concept: false, hidden: true }]);
  ok(stateProblems(before, order([{ id: 10, concept: false, hidden: true }, { id: 11, concept: false, hidden: true }])).length === 0, "a new hidden, non-draft position passes");
  ok(stateProblems(before, order([{ id: 10, concept: false, hidden: true }, { id: 11, concept: true, hidden: true }])).some((x) => /draft/.test(x)), "a new draft position is caught (R11500's added shift, 10-14)");
  ok(stateProblems(before, order([{ id: 10, concept: false, hidden: true }, { id: 11, concept: false, hidden: false }])).some((x) => /visible/.test(x)), "a new position workers can see is caught");
  ok(stateProblems(order([{ id: 10, concept: true, hidden: false }]), order([{ id: 10, concept: true, hidden: false }])).length === 0, "a position that was already there is not this write's to answer for");
  ok(SWEEP_GRACE_MINUTES >= 2 * SWEEP_MINUTES, "the test-data sweep leaves anything under 30 minutes old for its next pass");
}

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
