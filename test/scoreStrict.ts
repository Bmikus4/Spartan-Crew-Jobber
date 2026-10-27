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
// Staff build an order as create, then add its shift and position: one order, judged once. Its create key is
// read from the order's final state, so counting the adds again judged an equal create "partial" (1a121423eac99289,
// 1a13af10fc5250eb; eval/item-correctness.md, 10-26).
{
  const built = [created, act({ what: "add shift", order_id: 16300, number: "11300", model: "SlotTeam", model_id: 601 }), act({ what: "add position", order_id: 16300, number: "11300", model: "Slot", model_id: 71 })];
  ok(judge([create("32", 3)], truthOf(built)).verdict === "completed", "a create equal to the order staff built, shift by shift, is completed", judge([create("32", 3)], truthOf(built)));
  // The build also logs its Job, and slot edits made while building (R11529's shift re-timed in the same minute,
  // R11561's trade changed 5 minutes on). The order as it stands holds them; they are not separate work.
  const buildEdits = [...built, act({ what: "add job", order_id: 16300, number: "11300", model: "Job", model_id: 801 }),
    act({ what: "edit Slot.beginning+Slot.end", order_id: 16300, number: "11300", model: "Slot", model_id: 71,
      changes: { beginning: { old: "2026-11-27 05:30:00", new: "2026-11-27 08:00:00" }, end: { old: "2026-11-27 13:30:00", new: "2026-11-27 16:00:00" } } }),
    act({ what: "edit Slot.profession_id", order_id: 16300, number: "11300", model: "Slot", model_id: 71, changes: { profession_id: { old: 2, new: 1 } } })];
  ok(judge([create("32", 3)], truthOf(buildEdits)).verdict === "completed", "and its job and in-build edits do not make it partial", judge([create("32", 3)], truthOf(buildEdits)));
  const thenCancelled = [...built, act({ what: "cancel order", order_id: 16300, number: "11300", model: "Order" })];
  ok(judge([create("32", 3)], truthOf(thenCancelled)).verdict === "partial", "a cancel of the order staff made still counts", judge([create("32", 3)], truthOf(thenCancelled)));
}
ok(judge([size(6)], truthOf([sizeTo6])).verdict === "completed", "the count staff set", judge([size(6)], truthOf([sizeTo6])));
ok(judge([create("32", 3)], truthOf([created])).verdict === "completed", "the create staff made, however its positions are split", judge([create("32", 3)], truthOf([created])));
ok(fullyWritten([{ op: size(6) }], [{ status: "verified" }]), "every operation run and verified");
ok(judge([size(6)], truthOf([sizeTo6, created])).verdict === "partial", "right as far as it went, staff also created an order: partial");

console.log("\n[net effect] staff's edits count by where they end, not edit by edit (eval/write-breakdown.md §7)");
const po = (n: string): Op => ({ kind: "set_po", order_id: 16200, po: n });
const poEdit = (old: string, nu: string, at: string) => act({ at, what: "edit Order.intern_name", model: "Order", model_id: 11200, changes: { intern_name: { old, new: nu } } });
// 1a1206f2acc35678: the PO typed with a trailing space, then retyped.
ok(judge([po("PO 4471")], truthOf([poEdit("", "PO 447 ", "2026-10-16T10:00:00Z"), poEdit("PO 447 ", "PO 4471 ", "2026-10-16T10:01:00Z")])).verdict === "completed",
  "a PO typed then corrected is the one PO it ends as, spaces aside", judge([po("PO 4471")], truthOf([poEdit("", "PO 447 ", "2026-10-16T10:00:00Z"), poEdit("PO 447 ", "PO 4471 ", "2026-10-16T10:01:00Z")])));
const sizeEdit = (old: number, nu: number, at: string) => act({ at, what: "edit Slot.size", model: "Slot", model_id: 62, changes: { size: { old, new: nu } } });
ok(judge([size(7)], truthOf([sizeEdit(5, 6, "2026-10-16T10:00:00Z"), sizeEdit(6, 7, "2026-10-16T11:00:00Z")])).verdict === "completed", "two size edits are judged at the last value");
ok(judge([], truthOf([sizeEdit(5, 6, "2026-10-16T10:00:00Z"), sizeEdit(6, 5, "2026-10-16T10:02:00Z")])).verdict === "nothing to do", "a size moved and moved back is no change");
ok(judge([size(6)], truthOf([sizeEdit(5, 6, "2026-10-16T10:00:00Z"), sizeEdit(6, 5, "2026-10-16T10:02:00Z")])).verdict === "wrong", "so a plan that changes it is wrong");

console.log("\n[deletes] a part added and deleted inside the window left no work behind");
// 1a1259926be7623f, 1a12fc76a35c018d, 1a1345c6d25b4669: positions added and deleted within seconds on R11224.
const addPos = act({ at: "2026-10-16T10:00:00Z", what: "add position", model: "Slot", model_id: 64 });
const delPos = act({ at: "2026-10-16T10:00:20Z", what: "delete position", model: "Slot", model_id: 64 });
ok(judge([size(6)], truthOf([sizeTo6, addPos, delPos])).verdict === "completed", "an added-then-deleted position is not work the plan lacks", judge([size(6)], truthOf([sizeTo6, addPos, delPos])));
ok(judge([{ kind: "cancel_position", order_id: 16200, slot_id: 63 }], truthOf([act({ what: "delete position", model: "Slot", model_id: 63 })])).verdict === "completed",
  "deleting a position that existed before the email is the cancel the system would send");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
