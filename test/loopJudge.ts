// ============================================================================
// The loop's judge compares a plan with staff's own changes, matched by day and venue (ADDENDUM §12.2, P2.2).
// ----------------------------------------------------------------------------
// Synthetic orders and timeline rows. Pinned: acts come from stored rows by their order, an order's own rows by
// its number, the bot's and OnSinch's automated cancels left out, a row with no known order counted; an order is
// judged as it stood when the window closed (later parts removed, later changes undone, a later cancel reopened,
// a later delete counted); the window ends at the thread's next carded client email or 96 h; staff's order on the
// plan's day at the plan's venue is the one compared, so another job for the same client in the window is not
// held against the plan (the audit's error, §12.1); each bucket and its why.
// npx tsx test/loopJudge.ts
// ============================================================================
import type { Op } from "../app/lib/v2/bot/ops";
import { actsOf, orderAt, planScope, scoreEmail, windowFor, type Row } from "../app/lib/v2/loop/judge";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const H = 3600e3;
const SENT = Date.parse("2026-11-02T09:00:00Z");
const iso = (t: number) => new Date(t).toISOString();
const at = (h: number) => iso(SENT + h * H);
const CO = 900;

/** An order of one job, one shift per entry: [slotId, teamId, day, start, end, size, place]. */
const order = (id: number, number: number, shifts: Array<[number, number, string, string, string, number, number]>, created = at(-200)) => ({
  id, number, company_id: CO, status: 1, created,
  Job: [{ id: id * 10, created, SlotTeam: shifts.map(([sid, tid, day, s, e, size, place]) => ({ id: tid, created, Slot: [{ id: sid, created, beginning: `${day}T${s}:00+00:00`, end: `${day}T${e}:00+00:00`, size, profession_id: "7", role: 0, cancelled: false, SlotLocation: { place_id: place } }] })) }],
});
let rid = 1;
const row = (action: string, order_id: number | null, data: any, h: number, creator = 413): Row => ({ id: rid++, action, creator, created: at(h), model: data.model ?? null, model_id: data.id != null ? String(data.id) : null, order_id, data });
const create = (o: any, h: number) => row("order_create", o.id, { id: String(o.id), model: "Order", data: { number: o.number, path: `Order:${o.id}` } }, h);
const sizeEdit = (oid: number, sid: number, from: number, to: number, h: number) => row("common_change", oid, { id: String(sid), model: "Slot", diffChanges: { Slot: { size: { old: String(from), new: String(to) } } } }, h);
const poEdit = (oid: number, number: number, po: string, h: number) => row("common_change", oid, { id: String(number), model: "Order", diffChanges: { Order: { intern_name: { old: "", new: po } } } }, h);
const createOp = (day: string, place: number, size = 4): Op => ({ kind: "create_order", company_id: String(CO), company_name: "N", client_email: "x@n.example", job_name: "J", shifts: [{ name: "Crew", date: day, start: "08:00", end: "16:00", place_id: String(place), place_label: "P", positions: [{ size, profession_id: "7" }] }] });
const W = { from: SENT - H, to: SENT + 96 * H };

function run(plan: Op[] | null, orders: any[], rows: Row[], days?: string[]) {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const { acts } = actsOf(rows, (id) => { const o = byId.get(id); return o ? { number: String(o.number), company_id: o.company_id } : undefined; });
  const order = (id: number) => { const o = byId.get(id); return o ? orderAt(o, W.to, rows.filter((r) => r.order_id === id)).order : undefined; };
  const scope = planScope(plan ?? [], order);
  return scoreEmail({ plan, days: days ?? scope.days, venues: scope.venues, planOrders: scope.orders, sentAt: SENT, window: W, acts, order });
}

console.log("\n[1] acts from stored rows");
{
  const o = order(500, 11500, [[9001, 700, "2026-11-10", "08:00", "16:00", 4, 205]]);
  const rows = [sizeEdit(500, 9001, 4, 6, 1), poEdit(500, 11500, "PO1", 2), { ...sizeEdit(500, 9001, 6, 7, 3), creator: 2257 },
    row("order_cancel", 500, { id: "11500", model: "Order", data: { automated: true } }, 4), sizeEdit(999, 1, 1, 2, 5), { ...sizeEdit(0, 1, 1, 2, 6), order_id: null }];
  const r = actsOf(rows, (id) => (id === 500 ? { number: "11500", company_id: CO } : undefined));
  ok(r.acts.length === 2 && r.acts.every((a) => a.order_id === 500), "a position edit and an order's PO (keyed by number) are the order's; the bot's row and an automated cancel are not acts", r.acts.map((a) => a.what));
  ok(r.unowned === 2, "rows whose order is unknown, or not read, are counted", r.unowned);
}

console.log("\n[2] the order as it stood when the window closed");
{
  const o = order(500, 11500, [[9001, 700, "2026-11-10", "08:00", "16:00", 6, 205]]);
  o.status = -1;
  o.Job[0].SlotTeam.push({ id: 701, created: at(100), Slot: [{ id: 9002, created: at(100), beginning: "2026-11-11T08:00:00+00:00", end: "2026-11-11T16:00:00+00:00", size: 2, profession_id: "7", role: 0, cancelled: false, SlotLocation: { place_id: 205 } }] });
  const rows = [sizeEdit(500, 9001, 4, 6, 100), row("common_change", 500, { id: "9001", model: "Slot", diffChanges: { Slot: { beginning: { old: "2026-11-10 07:00:00", new: "2026-11-10 08:00:00" } } } }, 101),
    row("order_cancel", 500, { id: "11500", model: "Order" }, 102), row("common_delete", 500, { id: "700", model: "SlotTeam", data: { model: "Slot", id: "9003" } }, 103)];
  const r = orderAt(o, SENT + 99 * H, rows);
  const slot = r.order.Job[0].SlotTeam[0].Slot[0];
  ok(r.order.Job[0].SlotTeam.length === 1, "a shift made after the window is not there", r.order.Job[0].SlotTeam.length);
  ok(slot.size === 4 && slot.beginning === "2026-11-10T07:00:00+00:00", "a later size and a later time are undone; a zone-less old time is UTC", slot);
  ok(r.order.status === 0 && r.deletedAfter === 1, "a later cancel reopens the order; a later delete is counted", { status: r.order.status, d: r.deletedAfter });
  ok(o.Job[0].SlotTeam[0].Slot[0].size === 6, "the order read is left as it was");
}

console.log("\n[3] the window");
{
  const w1 = windowFor(SENT, [{ message_id: "a", at: SENT + 2 * H, cuts: false }, { message_id: "b", at: SENT + 5 * H, cuts: true }]);
  ok(w1.from === SENT - H && w1.to === SENT + 5 * H && w1.cut_by === "b", "the next client email with a card ends it; one without does not", w1);
  const w2 = windowFor(SENT, [{ message_id: "c", at: SENT + 200 * H, cuts: true }]);
  ok(w2.to === SENT + 96 * H && w2.cut_by === null, "otherwise 96 hours", w2);
}

console.log("\n[4] matched by day and venue");
{
  const mine = order(501, 11501, [[9101, 710, "2026-11-10", "08:00", "16:00", 4, 205]], at(1));
  const other = order(502, 11502, [[9201, 720, "2026-11-20", "10:00", "14:00", 2, 300]], at(2));
  const r = run([createOp("2026-11-10", 205)], [mine, other], [create(mine, 1), create(other, 2)]);
  ok(r.bucket === "matched" && JSON.stringify(r.orders) === "[501]", "staff's order on the plan's day and venue matches; another job for the client that week is not held against it", r);

  const elsewhere = order(503, 11503, [[9301, 730, "2026-11-10", "08:00", "16:00", 4, 300]], at(1));
  const v = run([createOp("2026-11-10", 205)], [elsewhere], [create(elsewhere, 1)]);
  ok(v.bucket === "wrong" && /^venue/.test(v.why ?? ""), "staff's only order that day is at another venue: wrong, the venue", v);

  const more = order(504, 11504, [[9401, 740, "2026-11-10", "08:00", "16:00", 6, 205]], at(1));
  const c = run([createOp("2026-11-10", 205)], [more], [create(more, 1)]);
  ok(c.bucket === "wrong" && c.why === "differs in crew", "the right day, times and venue with 6 crew, not 4: wrong, the crew", c);

  const po = run([createOp("2026-11-10", 205)], [mine], [create(mine, 1), poEdit(501, 11501, "PO9", 3)]);
  ok(po.bucket === "matched", "a PO staff set on the order they made is part of making it (app/lib/v2/score.ts)", po);

  const none = run([createOp("2026-11-10", 205)], [other], [create(other, 2)]);
  ok(none.bucket === "staff did nothing", "staff worked only on another day: staff did nothing on the plan's", none);
}

console.log("\n[5] changes to an existing order");
{
  const x = order(510, 11510, [[9501, 750, "2026-11-10", "08:00", "16:00", 4, 205]]);
  const y = order(511, 11511, [[9601, 760, "2026-11-10", "08:00", "16:00", 4, 205]]);
  const plan: Op[] = [{ kind: "set_position_size", order_id: 510, slot_id: 9501, size: 6 }];
  ok(run(plan, [x, y], [sizeEdit(510, 9501, 4, 6, 1)]).bucket === "matched", "staff made the planned size change: matched");
  const later = run(plan, [{ ...x, Job: [{ ...x.Job[0], SlotTeam: [{ ...x.Job[0].SlotTeam[0], Slot: [{ ...x.Job[0].SlotTeam[0].Slot[0], size: 8 }] }] }] }, y], [sizeEdit(510, 9501, 4, 6, 1), sizeEdit(510, 9501, 6, 8, 120)]);
  ok(later.bucket === "matched", "a change after the window closed does not make a right plan wrong", later);
  const wrongOrder = run(plan, [x, y], [sizeEdit(511, 9601, 4, 6, 1)]);
  ok(wrongOrder.bucket === "wrong" && /^another order/.test(wrongOrder.why ?? ""), "staff changed another order on that day and venue: wrong, another order", wrongOrder);
  const more = run(plan, [x], [sizeEdit(510, 9501, 4, 6, 1), poEdit(510, 11510, "PO9", 2)]);
  ok(more.bucket === "partial", "the plan right and staff also set a PO on that order: partial", more);
  const value = run(plan, [x], [sizeEdit(510, 9501, 4, 5, 1)]);
  ok(value.bucket === "wrong" && /different value/.test(value.why ?? ""), "the right position, another size: wrong, a different value", value);
}

console.log("\n[6] no plan: a hand-off or nothing to do");
{
  const x = order(520, 11520, [[9701, 770, "2026-11-10", "08:00", "16:00", 4, 205]]);
  ok(run(null, [x], [sizeEdit(520, 9701, 4, 5, 1)], ["2026-11-10"]).bucket === "staff acted, no plan", "staff worked on a day the email names: staff acted, no plan");
  ok(run(null, [x], [sizeEdit(520, 9701, 4, 5, 1)], ["2026-11-12"]).bucket === "staff did nothing", "staff worked on another day: nothing on this email's");
  const nd = run(null, [x], [sizeEdit(520, 9701, 4, 5, 1)], []);
  ok(nd.bucket === "staff did nothing" && nd.why === "the email names no day", "an email naming no day cannot be tied to staff's work, and says so", nd);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
