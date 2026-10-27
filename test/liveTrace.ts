// ============================================================================
// The live trace (addendum 5.2, R11) keeps each step of a decided email and nothing of its text.
// ----------------------------------------------------------------------------
// A synthetic email goes through production's decideMessage with the live tracer, on PGlite. Pinned: one row
// per step, none carrying the email's words; an address is hashed (the same address, the same hash) or
// blanked without a salt; a trace write that fails leaves the decision as it was; SPARTAN_TRACE=off writes
// nothing; pruneTrace removes rows past TRACE_DAYS and keeps the rest.
// npx tsx --require ./test/fixtures/pg.ts test/liveTrace.ts
// ============================================================================
import { sql, fault } from "./fixtures/pg";
import { decideMessage, type DecideDeps } from "../app/lib/v2/process";
import type { World } from "../app/lib/v2/interpret/plan";
import { liveTracer, pruneTrace, scrub, TRACE_DAYS } from "../app/lib/v2/traceLive";
import { ensureSchema } from "../app/lib/migrations";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const G = <T,>(value: T, quote: string) => ({ value, quote });
const base = { date: null, start: null, end: null, duration_minutes: null, crew: null, crew_add: null, crew_remove: null, venue: null, crew_chief: null, trade: null, target: null };
const CLIENT = "ops@northwind.example";
const TEXT = "Hi, can we book 4 crew at Hall One on 11/12 from 08:00 to 16:00? Our gate code is 4471, ask for Dana.";

const world: World = {
  companies: async () => [{ id: 900, name: "Northwind Events", Client: [{ id: 1, email: CLIENT }] }],
  placesNamed: async (n) => (/^hall one$/i.test(n.trim()) ? [{ id: 77, name: "Hall One" }] : []),
  allPlaces: async () => [{ id: 77, name: "Hall One", address: "1 Example Road" }],
  companyOrders: async () => [],
  orderByNumber: async () => null,
  orderById: async () => null,
};
const reading = { intent: "booking", po: null, note: "", requests: [{ ...base, action: "new_shift", date: G("2026-12-11", "11/12"), start: G("08:00", "08:00"), end: G("16:00", "16:00"), crew: G(4, "4 crew"), venue: G("Hall One", "Hall One") }] };

async function decide(id: string) {
  const trace = liveTracer(sql, id, "intake");
  let rec: any = null;
  await decideMessage({ message_id: id, thread_id: "t-" + id, from_address: CLIENT, date_iso: "2026-10-15T09:00:00Z", subject: "Crew please", body: TEXT, is_from_spartan: false },
    { extract: (async () => ({ x: reading, meta: { model: "recorded", prompt_id: "t", input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } })) as any,
      world, threadOrderId: async () => null, run: null, record: async (r: any) => { rec = r; }, trace } as DecideDeps).finally(trace.flush);
  return { rec, trace };
}
const rowsOf = async (id: string) => (await sql`SELECT source, component, data FROM v2_trace WHERE trace_id = ${id} ORDER BY id`) as any[];

(async () => {
  await ensureSchema(sql);
  delete process.env.SPARTAN_TRACE;
  process.env.SPARTAN_TRACE_SALT = "test-salt";

  const { rec } = await decide("lt1");
  const rows = await rowsOf("lt1");
  ok(rows.map((r) => r.component).join(",") === "filter,extract,ground,plan,final", "one row per step, in order", rows.map((r) => r.component));
  ok(rows.every((r) => r.source === "intake"), "each row says it came from intake");
  const all = JSON.stringify(rows.map((r) => r.data));
  ok(!/gate code|4471|Dana|can we book/.test(all), "no row carries the email's words", all.slice(0, 300));
  ok(rec?.decision?.kind === "handoff" || rec?.decision?.kind === "write", "the email is decided", rec?.decision);

  const a = scrub({ said: [`sender ${CLIENT} is not a client`], to: ["Ops@Northwind.example"] }) as any;
  ok(!JSON.stringify(a).includes("@"), "an address is hashed at any depth", a);
  ok(a.said[0].includes(a.to[0]), "the same address gives the same hash, whatever its case", a);
  ok((scrub(`from ${CLIENT}`, "") as string) === "from [address]", "with no salt an address is blanked");
  const t = liveTracer(sql, "lt2", "intake");
  t("plan", { kind: "handoff", said: [`no company for ${CLIENT}`] });
  await t.flush();
  ok(!JSON.stringify((await rowsOf("lt2"))[0]?.data).includes(CLIENT), "a written row holds no plain address", await rowsOf("lt2"));

  fault.when = (s) => /INSERT INTO v2_trace/.test(s);
  const failed = await decide("lt3");
  fault.when = null;
  ok(failed.rec?.decision?.kind === rec?.decision?.kind, "a trace that cannot be written leaves the decision as it was", failed.rec?.decision);
  ok(failed.trace.failures() === 5 && (await rowsOf("lt3")).length === 0, "the rows it could not write are counted, not retried", failed.trace.failures());

  process.env.SPARTAN_TRACE = "off";
  await decide("lt4");
  ok((await rowsOf("lt4")).length === 0, "SPARTAN_TRACE=off writes nothing");
  delete process.env.SPARTAN_TRACE;

  await sql`INSERT INTO v2_trace (trace_id, source, component, at, data) VALUES
    ('old', 'intake', 'final', now() - ${`${TRACE_DAYS + 1} days`}::interval, '{}'::jsonb),
    ('kept', 'intake', 'final', now() - ${`${TRACE_DAYS - 1} days`}::interval, '{}'::jsonb)`;
  const pruned = await pruneTrace(sql);
  const left = ((await sql`SELECT trace_id FROM v2_trace WHERE trace_id IN ('old', 'kept')`) as any[]).map((r) => r.trace_id);
  ok(pruned.deleted === 1 && left.join() === "kept", `rows older than ${TRACE_DAYS} days go, younger ones stay`, { pruned, left });

  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  if (fails) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
