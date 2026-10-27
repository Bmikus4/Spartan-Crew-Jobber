// ============================================================================
// Write judging reads the audit rows the way OnSinch writes them, and judges each email on its own window.
// ----------------------------------------------------------------------------
// eval/write-breakdown.md §7: the first item_correctness count lost deletes, pooled the next email's work
// into this one's, and keyed Order rows by id where OnSinch writes the number. Synthetic rows in OnSinch's
// shapes (harness/real/world.ts header): each must come out as the act the scorer expects.
// npx tsx test/harnessWrites.ts
// ============================================================================
import { actsOf, ownerIndex, windowFor, BOT } from "../harness/real/writes";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// Order id 16200 is R11200; its number collides with order id 11200 (R9000), the trap test/orderAuditByNumber.ts pins.
const orders = [
  { id: 16200, number: "11200", company_id: 137, Job: [{ id: 900, SlotTeam: [{ id: 502, Slot: [{ id: 62 }, { id: 63 }] }] }] },
  { id: 11200, number: "9000", company_id: 55, Job: [] },
];
const row = (id: number, action: string, data: unknown, creator = 110, created = "2026-10-16T10:00:00+00:00") => ({ id, action, creator, created, data: JSON.stringify(data) });
const rows = [
  row(1, "common_change", { id: "11200", model: "Order", diffChanges: { Order: { intern_name: { old: "", new: "PO 1" } } } }),
  row(2, "order_cancel", { id: "11200" }),
  row(3, "order_cancel", { id: "11200", data: { automated: true } }),
  row(4, "common_create", { id: "64", model: "Slot", data: { path: "Order:16200/Job:900/SlotTeam:502/Slot:64" } }),
  row(5, "common_delete", { id: "502", model: "SlotTeam", data: { model: "Slot", id: "64" } }),
  row(6, "common_change", { id: "62", model: "Slot", diffChanges: { Slot: { size: { old: 4, new: 6 } } } }, BOT),
  row(7, "common_change", { id: "63", model: "Slot", diffChanges: { Slot: { size: { old: 2, new: 3 } } } }),
];
const acts = actsOf(rows, ownerIndex(orders, rows));

console.log("\nOrder rows are keyed by number");
ok(acts.some((a) => a.what === "edit Order.intern_name" && a.order_id === 16200 && a.number === "11200"), "a PO edit naming 11200 is R11200's (order 16200), not order 11200's", acts.map((a) => [a.what, a.order_id]));
ok(acts.filter((a) => a.what === "cancel order").length === 1 && acts.find((a) => a.what === "cancel order")!.order_id === 16200, "a staff cancel is kept, OnSinch's automated one is not");

console.log("\ndeletes are acts on the deleted part");
const del = acts.find((a) => a.what === "delete position");
ok(!!del && del.model === "Slot" && del.model_id === 64 && del.order_id === 16200, "the delete row's data names the part; its order comes from the create path", del);
ok(acts.some((a) => a.what === "add position" && a.model_id === 64), "the add of the same part is an act too, so the scorer can drop the pair");

console.log("\nthe bot is not staff");
ok(!acts.some((a) => a.model === "Slot" && a.model_id === 62), "the bot's own size edit is left out");
ok(acts.some((a) => a.model === "Slot" && a.model_id === 63 && a.changes?.size?.new === 3), "a staff size edit is kept with its values");
const bot = actsOf(rows, ownerIndex(orders, rows), "bot");
ok(bot.length === 1 && bot[0].model_id === 62 && bot[0].changes?.size?.new === 6, "the bot's own rows are read apart, for an email whose write production ran", bot);

console.log("\nan email's window ends at the thread's next client email");
const thread = [
  { message_id: "a", date_iso: "2026-10-16T09:00:00Z", is_from_spartan: false },
  { message_id: "b", date_iso: "2026-10-16T10:00:00Z", is_from_spartan: true },
  { message_id: "c", date_iso: "2026-10-17T09:00:00Z", is_from_spartan: false },
];
const w = windowFor(thread[0] as any, thread as any);
ok(w.from === Date.parse("2026-10-16T08:00:00Z") && w.to === Date.parse("2026-10-17T09:00:00Z") && w.cut_by === "c", "1 h before, to the next client email (our reply does not cut it)", w);
const last = windowFor(thread[2] as any, thread as any);
ok(last.to === Date.parse("2026-10-17T09:00:00Z") + 96 * 3600e3 && last.cut_by === null, "with no later client email, 96 h", last);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
