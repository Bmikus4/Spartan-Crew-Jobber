// ============================================================================
// The two live wrong-write paths and the unchecked create venue, closed.
// ----------------------------------------------------------------------------
// The addendum's F22, F23 and F28 (23 Oct). F22: a length beside an end ("six hours ending
// 18:00") was dropped, so a new shift was booked at the assumed 08:00 start and a change kept
// the old start. F23: the reader's pick of a shift stood on its day alone, so with two bookings
// that day a wrong pick was written to; the deterministic finder never takes the day alone.
// F28: a create read back at another venue counted as verified.
// Offline: recorded readings and a fake OnSinch.
// npx tsx test/v2WrongBookingPaths.ts
// ============================================================================
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import { ground } from "../app/lib/v2/interpret/interpret";
import { mismatches } from "../app/lib/v2/bot/run";
import type { World } from "../app/lib/v2/interpret/plan";
import type { Op } from "../app/lib/v2/bot/ops";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const SENT = "2026-10-15T09:00:00Z";

const slot = (id: number, start: string, end: string, size: number, place: number) =>
  ({ id, beginning: `2026-11-20T${start}:00+00:00`, end: `2026-11-20T${end}:00+00:00`, size, profession_id: 1, role: 0, SlotLocation: { place_id: place } });
const order = (id: number, number: string, team: number, s: ReturnType<typeof slot>) =>
  ({ id, number, company_id: 137, creator: 110, created: "2026-10-01T10:00:00Z", Job: [{ id: id + 1, SlotTeam: [{ id: team, name: "Crew", Slot: [s] }] }] });
const R100 = order(16100, "11100", 501, slot(61, "08:00", "16:00", 4, 29));
const R200 = order(16200, "11200", 502, slot(62, "10:00", "18:00", 4, 31));
const world = (orders: any[]): World => ({
  companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: "crew@eventconcept.com" }] }],
  placesNamed: async (n) => (/business design centre/i.test(n) ? [{ id: 29, name: "Business Design Centre" }] : []),
  allPlaces: async () => [{ id: 29, name: "Business Design Centre" }, { id: 31, name: "ExCeL London" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
});
const decide = (text: string, subject: string, requests: any[], orders: any[]) => decideMessage(
  { message_id: "m1", thread_id: "t1", from_address: "crew@eventconcept.com", date_iso: SENT, subject, body: text, is_from_spartan: false },
  { extract: (async () => ({ x: { intent: "change", po: null, note: "", requests }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
    world: world(orders), threadOrderId: async () => null, run: null, record: async () => {}, trace: () => {} } as DecideDeps);
const opsOf = (d: any): Op[] => (d.kind === "write" ? d.ops.map((o: any) => o.op) : []);

(async () => {
  console.log("\n[F22] a length beside an end sets the start");
  {
    const text = "Please book 4 crew on 20/11 for six hours ending 18:00 at Business Design Centre";
    const x: any = { intent: "booking", po: null, note: "", requests: [{ ...base, action: "new_shift", date: G("2026-11-20", "20/11"), end: G("18:00", "ending 18:00"), duration_minutes: G(360, "six hours"), crew: G(4, "4 crew"), venue: G("Business Design Centre", "Business Design Centre") }] };
    const q = ground(x, text, SENT, { subject: "Crew" }).requests[0];
    ok(q.start === "12:00" && q.end === "18:00" && q.duration === 360 && !q.problems.length, "read: 12:00 to 18:00, the six hours kept", q);
    const made = await decide(text, "Crew", x.requests, []);
    const shift = (opsOf(made.decision).find((o) => o.kind === "create_order") as any)?.shifts?.[0];
    ok(shift?.start === "12:00" && shift?.end === "18:00", "a new shift is booked 12:00-18:00, not at an assumed 08:00", made.decision);

    const digits = "Please book 4 crew on 20/11 for 6 hours ending 18:00 at Business Design Centre";
    const six = await decide(digits, "Crew", [{ ...x.requests[0], duration_minutes: G(360, "6 hours") }], []);
    const s6 = (opsOf(six.decision).find((o) => o.kind === "create_order") as any)?.shifts?.[0];
    ok(s6?.start === "12:00" && s6?.end === "18:00", "written in figures, the same: 12:00-18:00", six.decision);

    const change = [{ ...base, action: "change_times", target: { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null }, end: G("18:00", "ending 18:00"), duration_minutes: G(360, "six hours") }];
    const moved = await decide("Can the crew on Friday 20/11 work six hours ending 18:00 instead", "RE: R11100", change, [R100]);
    const times = opsOf(moved.decision).find((o) => o.kind === "set_position_times") as any;
    ok(times?.start === "12:00" && times?.end === "18:00", "a change to an 08:00-16:00 shift is 12:00-18:00, not 08:00-18:00", moved.decision);
  }

  console.log("\n[F23] a picked shift needs the day and one more fact, and no rival as good");
  {
    const pick = (crewAdd: number, quote: string) => [{ ...base, action: "change_crew", order: "R11200", shift_id: 502, target: { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null }, crew_add: G(crewAdd, quote) }];
    const dayOnly = await decide("Hi, can you add 2 more crew on Friday 20/11? Thanks", "Crew Friday", pick(2, "add 2 more"), [R100, R200]);
    const why = dayOnly.decision.kind === "handoff" ? dayOnly.decision.reasons.join(" | ") : "";
    ok(dayOnly.decision.kind === "handoff" && /R11100/.test(why) && /R11200/.test(why), "two bookings that day and only the day written: a card listing both, no write", dayOnly.decision);
    const byStart = await decide("Hi, can you add 2 more crew to the 10:00 call on Friday 20/11? Thanks", "Crew Friday", pick(2, "add 2 more"), [R100, R200]);
    ok(byStart.decision.kind === "write" && opsOf(byStart.decision).every((o: any) => o.order_id === 16200), "the day and its start single R11200 out: the pick stands (control)", byStart.decision);
    const wrong = await decide("Hi, can you add 2 more crew at Business Design Centre on Friday 20/11? Thanks", "Crew Friday", pick(2, "add 2 more"), [R100, R200]);
    ok(wrong.decision.kind !== "write" || opsOf(wrong.decision).every((o: any) => o.order_id !== 16200), "the words name the other booking's venue: R11200 is never written", wrong.decision);
    const alone = await decide("Hi, can you add 2 more crew on Friday 20/11? Thanks", "Crew Friday", pick(2, "add 2 more"), [R200]);
    ok(alone.decision.kind === "handoff", "the day alone, even with one booking that day, is not enough (as for the finder: Ben 10-03, 10-15)", alone.decision);
  }

  console.log("\n[F28] a create read back at another venue is not verified");
  {
    const create: Extract<Op, { kind: "create_order" }> = { kind: "create_order", company_id: "137", company_name: "Event Concept", client_email: "crew@eventconcept.com", job_name: "x",
      shifts: [{ name: "Crew", date: "2026-11-20", start: "12:00", end: "18:00", place_id: "29", place_label: "Business Design Centre", positions: [{ size: 4, profession_id: "1" }] }] };
    const back = (place: number | null) => ({ company_id: 137, intern_name: "", Job: [{ SlotTeam: [{ Slot: [{ id: 1, beginning: "2026-11-20T12:00:00+00:00", end: "2026-11-20T18:00:00+00:00", size: 4, profession_id: 1, hidden: true, ...(place == null ? {} : { SlotLocation: { place_id: place } }) }] }] }] });
    ok(mismatches(create, back(29)).length === 0, "at the asked venue: verified", mismatches(create, back(29)));
    ok(mismatches(create, back(31)).length > 0, "at another venue: a mismatch", mismatches(create, back(31)));
    ok(mismatches(create, back(null)).length > 0, "with no venue read back: a mismatch, never assumed", mismatches(create, back(null)));
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
