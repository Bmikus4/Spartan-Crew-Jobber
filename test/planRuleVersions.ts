// ============================================================================
// Each rule version the loop shadow-scores is a planner option, and today's rules stay the default (ADDENDUM §12.3).
// ----------------------------------------------------------------------------
// The owner's 28 Oct rulings reach the code one a day after the loop's baseline (§12.7). Until then each new
// version runs beside the decision as a variant. Pinned for each: the default plans as before and the option plans
// the ruling; a moved start that keeps its end never makes a shift with no length or another end; a PO is not a
// change; and at intake every rule that touched an email gets its variant, stored beside an unchanged decision,
// with a variant that throws kept as its error.
// Offline: recorded readings and a fake OnSinch.
// npx tsx --require ./test/fixtures/pg.ts test/planRuleVersions.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import { plan, type PlanOpts, type World } from "../app/lib/v2/interpret/plan";
import { planVariants, recordVariants, type Variant } from "../app/lib/v2/loop/variants";
import type { Op } from "../app/lib/v2/bot/ops";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const FAR = "2026-10-15T09:00:00Z", NEAR = "2026-11-12T09:00:00Z";
const FRI = { quote: "Friday 20/11", date: G("2026-11-20", "20/11"), start: null };
const CLIENT = "crew@eventconcept.com";

// GMT on 20 Nov, so the London times are the UTC ones.
const slot = (id: number, start: string, end: string, size: number) => ({ id, beginning: `2026-11-20T${start}:00+00:00`, end: `2026-11-20T${end}:00+00:00`, size, profession_id: 1, role: 0, SlotLocation: { place_id: 29 } });
const R100 = { id: 16100, number: "11100", company_id: 137, creator: 110, created: "2026-10-01T10:00:00Z", Job: [{ id: 16101, SlotTeam: [{ id: 501, name: "Crew", Slot: [slot(61, "08:00", "16:00", 4)] }] }] };
const world = (orders: any[] = [R100]): World => ({
  companies: async () => [{ id: 137, name: "Event Concept", Client: [{ id: 1, email: CLIENT }] }],
  placesNamed: async () => [{ id: 29, name: "Business Design Centre" }],
  allPlaces: async () => [{ id: 29, name: "Business Design Centre" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
});
const decide = async (text: string, requests: unknown[], o: { sent?: string; rules?: Partial<PlanOpts>; intent?: string; po?: unknown; orders?: any[]; variants?: (v: Variant[]) => Promise<void> } = {}) => {
  let rec: any = null;
  await decideMessage({ message_id: "m1", thread_id: "t1", from_address: CLIENT, date_iso: o.sent ?? FAR, subject: "Crew", body: text, is_from_spartan: false },
    { extract: (async () => ({ x: { intent: o.intent ?? "change", po: o.po ?? null, note: "", requests }, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
      world: world(o.orders), threadOrderId: async () => null, run: null, record: async (r: any) => { rec = r; }, trace: () => {}, now: () => Date.parse(o.sent ?? FAR),
      ...(o.rules ? { rules: async () => o.rules! } : {}), ...(o.variants ? { variants: o.variants } : {}) } as DecideDeps);
  return rec.decision;
};
const opsOf = (d: any): Op[] => (d.kind === "write" ? d.ops.map((x: any) => x.op) : []);
const times = (d: any) => opsOf(d).filter((x) => x.kind === "set_position_times").map((x: any) => `${x.start}-${x.end}`).join(",");
const START = (start: string, q = `start at ${start}`) => [{ ...base, action: "change_times", order: "R11100", target: FRI, start: G(start, q) }];
const NEW = (q: Record<string, unknown>) => ({ ...base, action: "new_shift", date: G("2026-11-20", "20/11"), start: G("08:00", "08:00"), end: G("16:00", "16:00"), venue: G("Business Design Centre", "Business Design Centre"), crew: G(2, "2 crew"), ...q });

(async () => {
  console.log("\n[moved start] the call keeps its length by default, its end when asked (O7)");
  {
    const t = "On R11100, Friday 20/11, can they start at 10:00 instead?";
    ok(times(await decide(t, START("10:00", "start at 10:00"))) === "10:00-18:00", "default: 08:00-16:00 moved to 10:00 keeps its 8 hours");
    ok(times(await decide(t, START("10:00", "start at 10:00"), { rules: { movedStart: "end" } })) === "10:00-16:00", "keeping the end: 10:00-16:00");
    const past = await decide("On R11100, Friday 20/11, can they start at 17:00 instead?", START("17:00", "start at 17:00"), { rules: { movedStart: "end" } });
    ok(past.kind === "handoff" && /is no shift/.test(past.reasons.join(" ")), "a start after the old end, the end kept, is a person's: never a shift made to fit", past);
    const both = await decide("On R11100, Friday 20/11, can they do 10:00 to 15:00 instead?", [{ ...START("10:00", "10:00")[0], end: G("15:00", "15:00") }], { rules: { movedStart: "end" } });
    ok(times(both) === "10:00-15:00", "control: a start and an end given are both kept, whichever version", times(both));
  }

  console.log("\n[two-week rule] new orders by default; changes when it covers them (O8)");
  {
    const change = "On R11100, Friday 20/11, can they start at 10:00 instead?";
    ok((await decide(change, START("10:00"), { sent: NEAR })).kind === "write", "default: a change 8 days out is planned as today");
    const held = await decide(change, START("10:00"), { sent: NEAR, rules: { leadOver: "both" } });
    ok(held.kind === "handoff" && held.code === "policy_lead_days" && /a change on 2026-11-20, within 14 days/.test(held.reasons.join(" ")), "covering changes: a person's, with the two-week code", held);
    const size = await decide("On R11100, Friday 20/11, make it 6 crew please", [{ ...base, action: "change_crew", order: "R11100", target: FRI, crew: G(6, "make it 6 crew") }], { sent: NEAR, rules: { leadOver: "both" } });
    ok(size.kind === "handoff" && size.code === "policy_lead_days", "a size change, whose day is read from its order, is held too", size);
    ok((await decide(change, START("10:00"), { sent: FAR, rules: { leadOver: "both" } })).kind === "write", "control: the same change 36 days out is planned");
    const po = await decide("For R11100, PO number: PO-77", [], { sent: NEAR, rules: { leadOver: "both" }, po: G("PO-77", "PO number: PO-77") });
    ok(po.kind === "write" && opsOf(po).every((x) => x.kind === "set_po"), "a PO is not a change under the rule (§12.8, until the owner rules)", po);
    const book = "Hi, on 20/11 from 08:00 to 16:00 at Business Design Centre we need 2 crew";
    const newOnly = await decide(book, [NEW({})], { sent: NEAR, intent: "booking", orders: [] });
    ok(newOnly.kind === "handoff" && newOnly.code === "policy_lead_days", "default: a new order 8 days out is a person's, as today", newOnly);
    const changesOnly = await decide(book, [NEW({})], { sent: NEAR, intent: "booking", orders: [], rules: { leadOver: "changes" } });
    ok(changesOnly.kind === "write" && opsOf(changesOnly).some((x) => x.kind === "create_order"), "covering changes only, a new order is planned", changesOnly);
  }

  console.log("\n[short call] a person's by default; 2 hours with a note when asked");
  {
    const t = "Hi, on 20/11 we need 2 crew 07:30-08:30 at Business Design Centre";
    const req = [NEW({ start: G("07:30", "07:30"), end: G("08:30", "08:30") })];
    const d = await decide(t, req, { intent: "booking", orders: [] });
    ok(d.kind === "handoff" && d.code === "policy_short_call", "default: a 1-hour call is a person's", d);
    const two = await decide(t, req, { intent: "booking", orders: [], rules: { shortCall: "default" } });
    const sh = (opsOf(two).find((x) => x.kind === "create_order") as any)?.shifts?.[0];
    ok(sh?.start === "07:30" && sh?.end === "09:30" && two.why.some((w: string) => /^CHECK: asked for 60 minutes/.test(w)), "the 2-hour version books 07:30-09:30 and says to check it", { sh, why: two.why });
  }

  console.log("\n[acceptance] the client's yes to a shift from the thread: a person's, or drafted (O12)");
  {
    const msg = { message_id: "m2", from: CLIENT, subject: "Re: Crew", sentIso: FAR, text: "Yes please, book that." };
    const i: any = { intent: "booking", problems: [], requests: [{ action: "new_shift", date: "2026-11-27", start: "08:00", end: "16:00", crew: 2, venue: "Business Design Centre", problems: [], history: true }] };
    const d = await plan(msg, i, world(), null, { now: Date.parse(FAR) });
    ok(d.kind === "handoff" && (d as any).code === "policy_confirmed_proposal", "default: a person's", d);
    const draft = await plan(msg, i, world(), null, { now: Date.parse(FAR), acceptance: "draft" });
    ok(draft.kind === "write" && opsOf(draft).some((x: any) => x.kind === "create_order" && x.shifts[0].date === "2026-11-27"), "drafted: the shift the client said yes to", draft);
  }

  console.log("\n[variants] at intake each rule that touched the email is planned the other way; the decision stands");
  {
    let got: Variant[] = [];
    const d = await decide("Hi, on 20/11 from 08:00 to 16:00 at Business Design Centre we need 2 crew", [NEW({})], { sent: NEAR, intent: "booking", orders: [], variants: async (v) => { got = v; } });
    const v = got.find((x) => x.name === "no_lead");
    ok(d.kind === "handoff" && d.code === "policy_lead_days", "the decision is the two-week hand-off it always was", d);
    ok(!!v && !v.same && v.decision?.kind === "write" && opsOf(v.decision).some((x) => x.kind === "create_order"), "beside it, the order the rule held back", got);
    let moved: Variant[] = [];
    const m = await decide("On R11100, Friday 20/11, can they start at 10:00 instead?", START("10:00"), { variants: async (x) => { moved = x; } });
    const e = moved.find((x) => x.name === "start_keeps_end");
    ok(times(m) === "10:00-18:00" && times(e?.decision) === "10:00-16:00", "a start alone: the decision keeps the length, the variant the end", { m: times(m), e });
    let stored = false;
    await decide("On R11100, Friday 20/11, can they do 10:00 to 15:00 instead?", [{ ...START("10:00", "10:00")[0], end: G("15:00", "15:00") }], { variants: async () => { stored = true; } });
    ok(!stored, "no rule touched it: nothing is stored");
    const boom = await planVariants(async () => { throw new Error("OnSinch read failed"); }, d, { intent: "booking", requests: [], problems: [] } as any, {});
    ok(boom.length === 1 && boom[0].error === "OnSinch read failed" && boom[0].decision === null, "a variant that throws is kept as its error", boom);
    await recordVariants(sql as any, "m1", got, "test");
    await recordVariants(sql as any, "m1", [{ name: "no_lead", decision: null, same: true, error: null }], "test2");
    const rows = (await sql`SELECT variant, same, code_version FROM v2_variants WHERE message_id = 'm1'`) as any[];
    ok(rows.length === 1 && rows[0].same === true && rows[0].code_version === "test2", "stored once per email and variant; deciding again replaces it", rows);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
