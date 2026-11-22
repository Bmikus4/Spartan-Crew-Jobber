// ============================================================================
// Staff pay is never stored in an order body (O46; Stop 2 deletion D9).
// ----------------------------------------------------------------------------
// OnSinch puts seven wage fields on every Slot. Every body written to onsinch_orders or onsinch_orders_raw goes
// through stripPay (app/lib/onsinch/pay.ts), and the minute sync's blankStoredPay drains the bodies stored before:
// done only after a whole pass rewrites nothing. PGlite; OnSinch faked.
// npx tsx --require ./test/fixtures/pg.ts test/payNeverStored.ts
// ============================================================================
import { sql } from "./fixtures/pg";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PAY_KEY, stripPay, holdsPay } from "../app/lib/onsinch/pay";
import { readClientOrders, readLinkedOrders, keepRawBodies, blankStoredPay } from "../app/lib/v2/loop/truth";
import { ensureSchema } from "../app/lib/migrations";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

const WAGES = { wage_h: 12.5, wage_fix: 0, total_wage: 100, total_wage_h: 100, total_wage_fix: 0, wage_percentage: null, total_wage_percentage: null };
const order = (id: number, company: number, size = 2) => ({ id, number: String(18000 + id), company_id: company, name: "job",
  Job: [{ id: id * 10, SlotTeam: [{ id: id * 100, Slot: [{ id: id * 1000, beginning: "2026-12-04T09:00:00Z", end: "2026-12-04T17:00:00Z", size, ...WAGES }] }] }] });
const bodies = new Map<number, any>();
const t = (async (_m: string, path: string) => {
  const u = new URL("http://x" + path);
  const byCompany = u.searchParams.get("company_id[eq]"), eq = u.searchParams.get("id[eq]");
  const hit = byCompany ? [...bodies.values()].filter((b) => b.company_id === Number(byCompany)) : eq && bodies.has(Number(eq)) ? [bodies.get(Number(eq))] : [];
  return { status: 200, data: { data: hit, pagination: { pageCount: 1, count: hit.length } } };
}) as any;
const payRows = async () => {
  const a = (await sql`SELECT body FROM onsinch_orders WHERE body IS NOT NULL`) as any[];
  const b = (await sql`SELECT body FROM onsinch_orders_raw`) as any[];
  return { orders: a.filter((r) => holdsPay(r.body)).length, raw: b.filter((r) => holdsPay(r.body)).length, total: a.length + b.length };
};

(async () => {
  await ensureSchema(sql as any);

  console.log("\n[rule] the stems, and what stripPay keeps");
  ok(PAY_KEY.source === "wage|salary|payroll|(^|_)penalt|wallet|payment_?method|bank_?account|^(iban|swift|bic)$" && PAY_KEY.flags === "i",
    "the same stems as the data home's lib.mjs PAY_KEY", PAY_KEY.source);
  const s = stripPay(order(1, 10));
  const slot = s.Job[0].SlotTeam[0].Slot[0] as Record<string, unknown>;
  ok(Object.keys(WAGES).every((k) => !(k in slot)), "all seven wage keys go, at Slot depth", Object.keys(slot));
  ok(slot.size === 2 && slot.beginning === "2026-12-04T09:00:00Z" && s.number === "18001" && !holdsPay(s), "everything else stays");
  ok(holdsPay(order(1, 10)) && !holdsPay({ note: "wage paid" }), "a key is pay; a value that mentions pay is not");

  console.log("\n[write] every write point stores the body without pay");
  bodies.set(801, order(801, 10)); bodies.set(802, order(802, 11));
  await readClientOrders(sql as any, t, [10], Date.parse("2026-11-22T09:00:00Z"));
  await sql`INSERT INTO job_links (thread_id, order_id, state) VALUES ('t-pay', 802, 'linked') ON CONFLICT DO NOTHING`;
  await readLinkedOrders(sql as any, t, Date.parse("2026-11-22T09:00:00Z"));
  await keepRawBodies(sql as any, [order(803, 12)], "2026-11-22T09:00:00Z");
  const w = await payRows();
  ok(w.total === 5 && w.orders === 0 && w.raw === 0, "client-list read, linked read and raw keep: 5 bodies, none with pay", w);
  // A write point this test cannot reach (actions.ts) or one added later: every INSERT into either table is fed by stripPay.
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : []; });
  const writers = walk("app").filter((f) => /INSERT INTO onsinch_orders/.test(readFileSync(f, "utf8")));
  ok(writers.length >= 2 && writers.every((f) => /stripPay\(/.test(readFileSync(f, "utf8"))), "every module that inserts order bodies calls stripPay", writers);

  console.log("\n[drain] bodies stored before are blanked, and done means a whole pass found nothing");
  // Bodies as production holds them today: pay included, written before stripPay existed.
  for (const id of [1, 2, 3, 4, 5]) {
    await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (${id}, ${String(id)}, 20, ${JSON.stringify(order(id, 20))}::jsonb, now()) ON CONFLICT (order_id) DO UPDATE SET body = EXCLUDED.body`;
    for (const at of ["2026-11-01T00:00:00Z", "2026-11-02T00:00:00.123456Z"])
      await sql`INSERT INTO onsinch_orders_raw (order_id, fetched_at, body) VALUES (${id}, ${at}::timestamptz, ${JSON.stringify(order(id, 20, id))}::jsonb)`;
  }
  const before = await payRows();
  ok(before.orders === 5 && before.raw === 10, "5 cached and 10 kept bodies hold pay", before);
  let state = await blankStoredPay(sql as any, 2);
  let runs = 1, late = false;
  while (!state.done_at && runs < 100) {
    // An old instance writes a body with pay behind the cursor, mid-drain: the next pass must catch it.
    if (!late && state.table === "raw" && state.after && Number(state.after[0]) >= 3) {
      await sql`INSERT INTO onsinch_orders_raw (order_id, fetched_at, body) VALUES (1, '2026-11-03T00:00:00Z'::timestamptz, ${JSON.stringify(order(1, 20))}::jsonb)`;
      late = true;
    }
    state = await blankStoredPay(sql as any, 2); runs++;
  }
  const after = await payRows();
  ok(!!state.done_at && after.orders === 0 && after.raw === 0, "drained to zero", { after, state, runs });
  // Pass 1 strips the old bodies and misses the late one behind its cursor; pass 2 strips it; pass 3 finds nothing.
  ok(late && state.passes === 3 && state.rewrote === 0, "the late body was caught by the next pass, and done came only after a pass rewrote nothing", state);
  const sizes = ((await sql`SELECT body FROM onsinch_orders_raw WHERE order_id = 4 ORDER BY fetched_at`) as any[]).map((r) => r.body.Job[0].SlotTeam[0].Slot[0].size);
  ok(JSON.stringify(sizes) === "[4,4]", "the kept bodies are otherwise unchanged, microsecond timestamps included", sizes);
  const again = await blankStoredPay(sql as any, 2);
  ok(again.done_at === state.done_at, "once done, the step does nothing more");

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
