// ============================================================================
// Every client email since 9 Oct gets one judged outcome per plan, from the stored truth (ADDENDUM §12.2, P2.4).
// ----------------------------------------------------------------------------
// On PGlite with a fake OnSinch. Pinned: a row for each decision and each differing variant, once, and none for
// mail that is not a client's; a planned change staff made is matched; an email read as nothing to do on whose
// named day staff worked is "staff acted, no plan" with the day flag up and its control down; the plan the
// two-week rule held back is judged beside the hand-off; an email no company's contact sent is "can't tell",
// counted; a window still open waits; nothing is scored before the timeline is complete; a failed OnSinch read
// throws and leaves the rows open.
// npx tsx --require ./test/fixtures/pg.ts test/loopOutcomes.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { scoreOutcomes } from "../app/lib/v2/loop/outcomes";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const CLIENT = "ops@north.example";

const slot = (id: number, day: string, size: number, place: number, created = "2026-10-01T09:00:00Z") => ({ id, created, beginning: `${day}T08:00:00+00:00`, end: `${day}T16:00:00+00:00`, size, profession_id: "7", role: 0, cancelled: false, SlotLocation: { place_id: place } });
const order = (id: number, number: number, s: ReturnType<typeof slot>, created = "2026-10-01T09:00:00Z") => ({ id, number, company_id: 900, status: 1, created, Job: [{ id: id * 10, created, SlotTeam: [{ id: id * 100, created, Slot: [s] }] }] });
const ORDERS = [
  order(500, 11500, slot(9001, "2026-10-27", 6, 205)),
  order(501, 11501, slot(9101, "2026-10-30", 2, 205, "2026-10-20T12:00:00Z"), "2026-10-20T12:00:00Z"),
  order(502, 11502, slot(9201, "2026-10-26", 3, 300)),
];
let down = false;
const t = (async (_m: string, path: string) => {
  if (down) return { status: 503, data: null };
  if (path.startsWith("/orders?company_id[eq]=900")) return { status: 200, data: { data: ORDERS, pagination: { pageCount: 1, count: ORDERS.length } } };
  return { status: 200, data: { data: [], pagination: { pageCount: 0, count: 0 } } };
}) as any;

const msg = (id: string, from: string, date: string, body: string) => sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan) VALUES (${id}, ${"t-" + id}, ${from}, ${date}, 'Crew', ${body}, false)`;
const dec = (id: string, from: string, date: string, kind: string, decision: unknown) => sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, code_version) VALUES (${id}, ${"t-" + id}, ${from}, ${date}, ${kind}, ${JSON.stringify(decision)}::jsonb, 'abc')`;
const tl = (id: number, action: string, order_id: number, data: unknown, created: string, creator = 413) => sql`INSERT INTO onsinch_timeline (id, action, creator, created, model, model_id, order_id, data) VALUES (${id}, ${action}, ${creator}, ${created}::timestamptz, ${(data as any).model}, ${String((data as any).id)}, ${order_id}, ${JSON.stringify(data)}::jsonb)`;
const out = async () => new Map(((await sql`SELECT * FROM v2_outcomes`) as any[]).map((r) => [`${r.message_id}/${r.variant}`, r]));

(async () => {
  await ensureSchema(sql as any);
  await msg("m1", `Ops <${CLIENT}>`, "2026-10-20T09:00:00Z", "Please make it 6 crew on 27/10");
  await dec("m1", CLIENT, "2026-10-20T09:00:00Z", "write", { kind: "write", code: "write", why: [], ops: [{ source: "m1#0", op: { kind: "set_position_size", order_id: 500, slot_id: 9001, size: 6 } }] });
  await msg("m2", CLIENT, "2026-10-20T10:00:00Z", "Thanks, all good for the 26/10");
  await dec("m2", CLIENT, "2026-10-20T10:00:00Z", "none", { kind: "none", code: "none_nothing_to_do", reason: "nothing to do" });
  await msg("m3", "someone@elsewhere.example", "2026-10-20T11:00:00Z", "Crew on 27/10?");
  await dec("m3", "someone@elsewhere.example", "2026-10-20T11:00:00Z", "handoff", { kind: "handoff", code: "client_unknown", reasons: ["no single client company"] });
  await msg("m4", CLIENT, "2026-10-25T00:00:00Z", "Add one on 27/10");
  await dec("m4", CLIENT, "2026-10-25T00:00:00Z", "write", { kind: "write", code: "write", why: [], ops: [{ source: "m4#0", op: { kind: "set_position_size", order_id: 500, slot_id: 9001, size: 7 } }] });
  await msg("m5", CLIENT, "2026-10-20T08:00:00Z", "Please book 2 crew on 30/10 at Hall One 08:00-16:00");
  await dec("m5", CLIENT, "2026-10-20T08:00:00Z", "handoff", { kind: "handoff", code: "policy_lead_days", reasons: ["a new booking from 2026-10-30, within 14 days of the email, is for staff to create"] });
  await sql`INSERT INTO v2_variants (message_id, variant, decision, same, error, code_version) VALUES ('m5', 'no_lead', ${JSON.stringify({ kind: "write", code: "write", why: [], ops: [{ source: "m5#0", op: { kind: "create_order", company_id: "900", company_name: "N", client_email: CLIENT, job_name: "J", shifts: [{ name: "Crew", date: "2026-10-30", start: "08:00", end: "16:00", place_id: "205", place_label: "Hall One", positions: [{ size: 2, profession_id: "7" }] }] } }] })}::jsonb, false, null, 'abc')`;
  await msg("m6", "noreply@spartancrew.co.uk", "2026-10-20T08:30:00Z", "x");
  await dec("m6", "noreply@spartancrew.co.uk", "2026-10-20T08:30:00Z", "none", { kind: "none", code: "none_not_client", reason: "not a client" });
  await sql`INSERT INTO onsinch_contacts (email, company_id, refreshed_at) VALUES (${CLIENT}, 900, now())`;
  await tl(1, "common_change", 500, { id: "9001", model: "Slot", diffChanges: { Slot: { size: { old: "4", new: "6" } } } }, "2026-10-20T11:00:00Z");
  await tl(2, "order_create", 501, { id: "501", model: "Order", data: { number: 11501, path: "Order:501" } }, "2026-10-20T12:00:00Z");
  await tl(3, "common_change", 502, { id: "9201", model: "Slot", diffChanges: { Slot: { size: { old: "2", new: "3" } } } }, "2026-10-21T08:00:00Z");

  console.log("\n[waiting] nothing is scored before the timeline is complete");
  const w = await scoreOutcomes(sql as any, t);
  const o0 = await out();
  ok(w.scored === 0 && o0.size === 6, "a row each for 5 client emails and the differing variant; none for our own mail", { w, keys: [...o0.keys()] });
  ok(![...o0.values()].some((r) => r.scored_at), "and none is judged yet");

  console.log("\n[scored] once the timeline is complete to 27 Oct");
  await sql`INSERT INTO v2_loop_meta (key, value) VALUES ('timeline_complete_at', '"2026-10-27T00:00:00.000Z"'::jsonb)`;
  down = true;
  const err = await scoreOutcomes(sql as any, t).then(() => "no throw", (e) => String(e.message));
  down = false;
  ok(/answered 503/.test(err) && ![...(await out()).values()].some((r) => r.scored_at && r.company_id), "a failed read of the client's orders throws; nothing for that client is judged", err);
  const s = await scoreOutcomes(sql as any, t);
  const o = await out();
  const b = (k: string) => `${o.get(k)?.bucket}${o.get(k)?.why ? ` (${o.get(k)?.why})` : ""}`;
  ok(b("m1/production") === "matched", "the planned size change staff made: matched", o.get("m1/production"));
  ok(b("m2/production") === "staff acted, no plan" && o.get("m2/production").day_flag === "staff worked on a named day" && o.get("m2/production").day_control === "no", "read as nothing to do, staff worked on the day it names: flagged, control down", o.get("m2/production"));
  ok(o.get("m3/production").bucket === "can't tell" && o.get("m3/production").client_match === "none", "a sender on no company's contact list: can't tell, counted", o.get("m3/production"));
  ok(!o.get("m4/production").scored_at, "a window still open waits", o.get("m4/production"));
  ok(b("m5/production") === "staff acted, no plan" && b("m5/no_lead") === "matched", "the two-week hand-off: staff made the order the rule held back, matched", { p: b("m5/production"), v: b("m5/no_lead") });
  ok(o.get("m5/no_lead").ahead_days === 10 && JSON.stringify(o.get("m5/no_lead").days) === '["2026-10-30"]', "the held-back plan's days and how far ahead", o.get("m5/no_lead"));
  ok(s.scored === 4 && s.waiting === 1, "4 emails judged, 1 waiting", s);
  const again = await scoreOutcomes(sql as any, t);
  ok(again.seeded === 0 && again.scored === 0, "run again: nothing new, nothing judged twice", again);

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
