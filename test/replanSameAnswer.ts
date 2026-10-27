// ============================================================================
// The minute re-plan counts, stores and traces an answer only when it changed.
// ----------------------------------------------------------------------------
// It compared JSON.stringify of the stored answer with the new one. Postgres returns a JSONB value with its
// keys reordered, so the two never matched: every open card counted as changed every minute, and once the
// live trace was on (R11) each one wrote five trace rows a minute (production 27 Oct: 86 emails in 5 minutes).
// On PGlite with a made-up client: a card planned twice against the same OnSinch changes once; a new order
// for its day changes it again. No model call: the re-plan reads the stored reading.
// npx tsx --require ./test/fixtures/pg.ts test/replanSameAnswer.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import type { World } from "../app/lib/v2/interpret/plan";
import { replanOpen, sameAnswer } from "../app/lib/v2/replan";
import { ensureSchema } from "../app/lib/migrations";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };

const CLIENT = "ops@northwind.example";
const SENT = new Date(Date.now() - 3_600_000).toISOString();
const DAY = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const [y, m, d] = DAY.split("-");
const TEXT = `Hi, can we book 4 crew at Hall One on ${d}/${m} from 08:00 to 16:00?`;
const reading = { intent: "booking", po: null, note: "", requests: [{ ...base, action: "new_shift", date: G(DAY, `${d}/${m}`), start: G("08:00", "08:00"), end: G("16:00", "16:00"), crew: G(4, "4 crew"), venue: G("Hall One", "Hall One") }] };

const slot = (id: number, day: string, start: string, end: string, size: number) =>
  ({ id, beginning: `${day}T${start}:00+00:00`, end: `${day}T${end}:00+00:00`, size, profession_id: 1, role: 0, slotlocation_id: 877, SlotLocation: { place_id: 77 } });
const R1 = { id: 30001, number: "30001", company_id: 900, status: 1, intern_name: "", name: "Northwind @ Hall One", creator: 110, created: SENT, Job: [{ id: 30002, SlotTeam: [{ id: 30003, name: "Crew", Slot: [slot(61, DAY, "07:00", "16:00", 4)] }] }] };
const worldWith = (orders: any[]): World => ({
  companies: async () => [{ id: 900, name: "Northwind Events", Client: [{ id: 1, email: CLIENT }] }],
  placesNamed: async (n) => (/^hall one$/i.test(n.trim()) ? [{ id: 77, name: "Hall One" }] : []),
  allPlaces: async () => [{ id: 77, name: "Hall One", address: "1 Example Road" }],
  companyOrders: async () => orders,
  orderByNumber: async (n) => orders.find((o) => o.number === n) ?? null,
  orderById: async (id) => orders.find((o) => o.id === id) ?? null,
});
const traced = async () => ((await sql`SELECT count(*)::int AS n FROM v2_trace WHERE source = 'replan'`) as any[])[0].n as number;

(async () => {
  await ensureSchema(sql);
  delete process.env.SPARTAN_TRACE;

  console.log("\n[order] a JSONB answer read back is the same answer");
  const answer = { kind: "handoff", reasons: ["x"], code: "other" };
  await sql`CREATE TABLE IF NOT EXISTS jsonb_probe (j JSONB)`;
  await sql`INSERT INTO jsonb_probe VALUES (${JSON.stringify(answer)}::jsonb)`;
  const back = ((await sql`SELECT j FROM jsonb_probe`) as any[])[0].j;
  ok(JSON.stringify(back) !== JSON.stringify(answer), "control: Postgres reorders the keys, so a plain stringify differs");
  ok(sameAnswer(back, answer), "sameAnswer ignores key order, at any depth");
  ok(!sameAnswer(back, { ...answer, reasons: ["y"] }), "and still sees a changed reason");

  console.log("\n[card] planned twice against the same OnSinch, the card changes once");
  await sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan)
    VALUES ('rp1', 'trp', ${CLIENT}, ${SENT}, 'Crew please', ${TEXT}, false)`;
  await sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, interpretation, decision, code_version, company_id, company)
    VALUES ('rp1', 'trp', ${CLIENT}, ${SENT}, 'handoff', ${JSON.stringify({ extraction: reading, grounded: { requests: [{ date: DAY }] } })}::jsonb,
      ${JSON.stringify({ kind: "handoff", reasons: ["stored at intake"] })}::jsonb, 'test', 900, 'Northwind Events')`;
  const first = await replanOpen(sql, { world: worldWith([]) });
  const after1 = await traced();
  ok(first.planned === 1 && first.changed === 1, "the first pass answers differently from intake and says so", first);
  ok(after1 > 0, "and that answer is traced", after1);
  const second = await replanOpen(sql, { world: worldWith([]) });
  ok(second.planned === 1 && second.changed === 0, "the second pass, same OnSinch, changes nothing", second);
  ok((await traced()) === after1, "and traces nothing", await traced());

  console.log("\n[control] OnSinch moved: the order now exists, and the card changes");
  const third = await replanOpen(sql, { world: worldWith([R1]) });
  ok(third.changed === 1 && (await traced()) > after1, "a new answer is counted and traced", { third, traced: await traced() });

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
