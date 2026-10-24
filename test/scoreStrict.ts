// ============================================================================
// The scorer fails what is wrong in its values, not only in its shape.
// ----------------------------------------------------------------------------
// The addendum's 5.1 (23 Oct): score-vs-ops passed any create for a create and any operation on a
// touched order for an update, and week-review called a plan done when the runs it had verified.
// Planted cases: a wrong count, a wrong venue, an extra operation and a plan cut short must each
// fail; the same plans with the right values must pass.
// npx tsx test/scoreStrict.ts
// ============================================================================
import { judge, truthKeys, fullyWritten, type Act } from "../app/lib/v2/score";
import type { Op } from "../app/lib/v2/bot/ops";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// R11200 as staff left it: a 10:00-18:00 shift at place 31, a chief and 5 crew, then created R11300.
const slot = (id: number, size: number, prof: number, role: number, place = 31, b = "2026-11-20T10:00:00+00:00", e = "2026-11-20T18:00:00+00:00") => ({ id, beginning: b, end: e, size, profession_id: prof, role, SlotLocation: { place_id: place } });
const R11200 = { id: 16200, number: "11200", company_id: 137, Job: [{ SlotTeam: [{ id: 502, Slot: [slot(62, 5, 1, 0), slot(63, 1, 36, 1)] }] }] };
const R11300 = { id: 16300, number: "11300", company_id: 137, Job: [{ SlotTeam: [{ id: 601, Slot: [slot(71, 3, 1, 0, 32, "2026-11-27T08:00:00+00:00", "2026-11-27T16:00:00+00:00")] }] }] };
const orders = new Map<number, any>([[16200, R11200], [16300, R11300]]);
const act = (over: Partial<Act>): Act => ({ at: "2026-10-16T10:00:00Z", by: 110, what: "", order_id: 16200, number: "11200", company_id: 137, ...over });
const sizeTo6 = act({ what: "edit Slot.size", model: "Slot", model_id: 62, changes: { size: { old: 4, new: 6 } } });
const created = act({ what: "create order", order_id: 16300, number: "11300" });
const truthOf = (acts: Act[]) => truthKeys(acts, (id) => orders.get(id));

const size = (n: number): Op => ({ kind: "set_position_size", order_id: 16200, slot_id: 62, size: n });
const create = (place: string, crew: number): Op => ({ kind: "create_order", company_id: "137", company_name: "Event Concept", client_email: "crew@eventconcept.com", job_name: "x",
  shifts: [{ name: "Crew", date: "2026-11-27", start: "08:00", end: "16:00", place_id: place, place_label: "x", positions: [{ size: crew, profession_id: "1" }] }] });

console.log("\n[planted] each must fail");
ok(judge([size(5)], truthOf([sizeTo6])).verdict === "wrong", "a wrong count: 5 planned where staff made it 6", judge([size(5)], truthOf([sizeTo6])));
ok(judge([create("31", 3)], truthOf([created])).verdict === "wrong", "a wrong venue: the create at place 31, staff's at 32", judge([create("31", 3)], truthOf([created])));
const extra: Op = { kind: "cancel_position", order_id: 16200, slot_id: 63 };
ok(judge([size(6), extra], truthOf([sizeTo6])).verdict === "wrong", "an extra operation beside the right one", judge([size(6), extra], truthOf([sizeTo6])));
ok(!fullyWritten([{ op: size(6) }, { op: extra }], [{ status: "verified" }]), "a plan cut short: two operations, one run");
ok(!fullyWritten([{ op: size(6) }], [{ status: "blocked" }]), "and a run that did not verify");
ok(judge([], truthOf([sizeTo6])).verdict === "missed", "nothing planned where staff changed the count: missed");
ok(judge([size(6)], { keys: [], other: [] }).verdict === "wrong", "a write where staff did nothing: wrong");

console.log("\n[controls] the same plans with the right values pass");
ok(judge([size(6)], truthOf([sizeTo6])).verdict === "completed", "the count staff set", judge([size(6)], truthOf([sizeTo6])));
ok(judge([create("32", 3)], truthOf([created])).verdict === "completed", "the create staff made, however its positions are split", judge([create("32", 3)], truthOf([created])));
ok(fullyWritten([{ op: size(6) }], [{ status: "verified" }]), "every operation run and verified");
ok(judge([size(6)], truthOf([sizeTo6, created])).verdict === "partial", "right as far as it went, staff also created an order: partial");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
