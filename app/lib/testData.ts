// ============================================================================
// TEST DATA: what tests leave in the live automation, found by marks only tests leave, and removed.
// ----------------------------------------------------------------------------
// Found on 2026-10-14 by looking, not by guessing: two bench orders still on TEST - Eventz, a probe
// company ("ZZ PROBE DO NOT CREATE"), nine companies the old engine invented from Ben's own test
// emails ("Global Expos Ltd." and five siblings in one minute on 09-03), and 39 of those test
// threads still feeding the TV and the analytics. Nothing marked any of it as a test, so nothing
// could take it back out.
//
// What counts as a test is decided by these marks and nothing else:
//   a sender      Ben's own addresses, test-eventz.co.uk, the reserved example/test/invalid domains
//   a synthetic id e2e-, bench-, harness-, spartan-pipeline-test ... (thread, message or ledger source)
//   a TEST company a company whose OnSinch name starts "TEST" or "(TEST)", or the ZZ PROBE one
// A thread with ANY outside sender who is not a test sender is never a test thread, whatever else
// marks it: a real client's email matched to a TEST company is a matching bug to look at, not
// rubbish to clear.
//
// OnSinch is touched only where the automation itself wrote. An order goes only if user 2257
// ("Samurai AI", the login the bot and the API key both write as) created it; staff test orders
// (Daniel's "Test @ Test HQ", "Jamie TEST - Do not Delete") stay, and so does anything named
// "do not delete". A company goes only if 2257 created it and it has no contact and no order left.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { readRows } from "./v2/read";

export const AUTOMATION_USER = 2257;
// Postgres ARE and JS read these the same way; [.] instead of \. so neither escaping layer eats it.
export const TEST_SENDER = "^benjamintmikus@gmail[.]com$|@samuraisolutions[.]co[.]uk$|@test-eventz[.]co[.]uk$|@([a-z0-9-]+[.])*(example[.](com|org|net)|[a-z0-9-]+[.](example|test|invalid|localhost))$";
export const TEST_ID = "^(e2e-|test-|bench-|vercel-bench-|harness-|spartan-pipeline-test|fixture-|canary-|probe-|verify-)";
export const TEST_COMPANY = "^[(]?test[)]?([^a-z]|$)|^zz probe";
const KEEP = /do not delete/i;

export const isTestSender = (a: string | null | undefined) => new RegExp(TEST_SENDER, "i").test(String(a ?? "").trim());
export const isTestId = (id: string | null | undefined) => new RegExp(TEST_ID, "i").test(String(id ?? ""));
export const isTestCompanyName = (n: string | null | undefined) => new RegExp(TEST_COMPANY, "i").test(String(n ?? "").trim());

// The caps a sweep may not pass on its own. A rule that suddenly matches a hundred orders is a
// broken rule, and the one thing worse than test data left behind is real data cleared.
export const CAPS = { orders: 25, companies: 25, threads: 300 };

/** Every table that keys its rows by email thread. */
export const THREAD_TABLES = [
  "thread_messages", "v2_decisions", "conversation_state", "tickets", "ticket_events", "metric_events", "feed_marks",
  "inbound_raw", "message_ledger", "sweep_threads", "sweep_labels", "sender_ledger_threads", "job_links",
  "order_records", "followup_suppressions", "order_archive",
] as const;

export type OnsinchCall = (method: "GET" | "DELETE", path: string, body?: unknown) => Promise<{ status: number; data: any }>;
type Sql = NeonQueryFunction<false, false>;
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

export interface PlanOrder { id: number; number: string; company_id: number; name: string; why: string }
export interface PlanCompany { id: number; name: string; why: string }
export interface TestDataPlan {
  at: string;
  threads: string[];
  orders: PlanOrder[];
  companies: PlanCompany[];
  /** Rows per table that go, thread-keyed tables and the rest. */
  rows: Record<string, number>;
  /** What looked like a test and was left, with why. */
  kept: string[];
  testCompanies: number[];
  messages: string[];
  /** Set when the plan passes a cap: nothing is cleared without force. */
  over?: string;
}

/** An order the automation made for a test goes; one staff made never does. */
export function orderVerdict(o: { id: number; creator: number; name: string; company_id: number }, testCompanies: Set<number>, testThreadOrders: Set<number>): { go: true; why: string } | { go: false; why: string } | null {
  const marked = testCompanies.has(Number(o.company_id)) ? "on a TEST company" : testThreadOrders.has(Number(o.id)) ? "made for a test email" : "";
  if (!marked) return null;
  if (KEEP.test(o.name ?? "")) return { go: false, why: `named "do not delete"` };
  if (Number(o.creator) !== AUTOMATION_USER) return { go: false, why: `${marked}, but made by staff (user ${o.creator})` };
  return { go: true, why: `${marked}, made by the automation` };
}

/** A company the automation made goes only if nothing real points at it. */
export function companyVerdict(c: { name: string; email_invoice?: string | null; clients: number; orders: number; testRefs: number; realRefs: number; testMentions: number; realMentions: number }): string | null {
  if (c.clients || c.orders || KEEP.test(c.name)) return null;
  if (isTestCompanyName(c.name)) return "a test name";
  if (isTestSender(c.email_invoice)) return "a test invoice address";
  if (c.realRefs || c.realMentions) return null;
  if (c.testRefs) return "made for test emails only";
  if (c.testMentions) return "named only in test emails";
  return null;
}

async function companiesMadeByAutomation(t: OnsinchCall): Promise<Set<number>> {
  const out = new Set<number>();
  for (let page = 1; page <= 20; page++) {
    const rows = await readRows(t as any, `/timelineAudits?creator[eq]=${AUTOMATION_USER}&action[eq]=company_create&limit=100&page=${page}`);
    for (const a of rows) { try { out.add(Number(JSON.parse(a.data).id)); } catch {} }
    if (rows.length < 100) break;
  }
  return out;
}

async function allOf(t: OnsinchCall, path: string, cap = 30): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= cap; page++) {
    const rows = (await readRows(t as any, `${path}${path.includes("?") ? "&" : "?"}limit=100&page=${page}`));
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/**
 * What a clear would remove, without removing anything. `graceMinutes` leaves alone whatever was
 * made that recently: the sweep deleted a probe order mid-test on 10-15, and a test's ledger
 * row is what stops its write running twice, so a sweep must never race work still under way.
 */
export async function planTestData(sql: Sql, t: OnsinchCall, opts: { graceMinutes?: number } = {}): Promise<TestDataPlan> {
  const kept: string[] = [];
  const grace = Math.max(0, opts.graceMinutes ?? 0);
  const cutoff = new Date(Date.now() - grace * 60e3).toISOString();
  const companies = await allOf(t, "/companies?with=Client", 40);
  const testCos = companies.filter((c) => isTestCompanyName(c.name)).map((c) => Number(c.id));

  // Threads: every candidate, then out goes any with a real outside sender.
  const cand = (await sql`
    SELECT thread_id FROM thread_messages WHERE NOT is_from_spartan AND from_address ~* ${TEST_SENDER}
    UNION SELECT thread_id FROM thread_messages WHERE thread_id ~* ${TEST_ID} OR message_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM v2_decisions WHERE company_id = ANY(${testCos}) OR thread_id ~* ${TEST_ID} OR from_address ~* ${TEST_SENDER}
    UNION SELECT thread_id FROM tickets WHERE company_id = ANY(${testCos}) OR thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM order_records WHERE company_id = ANY(${testCos}) OR sender_email ~* ${TEST_SENDER} OR thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM job_links WHERE company_id = ANY(${testCos}) OR thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM metric_events WHERE thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM ticket_events WHERE thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM inbound_raw WHERE thread_id ~* ${TEST_ID}
    UNION SELECT thread_id FROM conversation_state WHERE thread_id ~* ${TEST_ID}`) as { thread_id: string | null }[];
  const ids = [...new Set(cand.map((r) => r.thread_id).filter((x): x is string => !!x))];
  const real = new Set(((await sql`SELECT DISTINCT thread_id FROM thread_messages WHERE thread_id = ANY(${ids}) AND NOT is_from_spartan AND from_address IS NOT NULL AND NOT (from_address ~* ${TEST_SENDER})`) as any[]).map((r) => r.thread_id));
  for (const id of real) kept.push(`thread ${id}: marked as a test, but a real client wrote on it`);
  const fresh = new Set(grace ? ((await sql`SELECT thread_id FROM thread_messages WHERE thread_id = ANY(${ids}) AND first_seen_at > ${cutoff}
    UNION SELECT thread_id FROM v2_decisions WHERE thread_id = ANY(${ids}) AND created_at > ${cutoff}`) as any[]).map((r) => r.thread_id) : []);
  for (const id of fresh) kept.push(`thread ${id}: still in progress (under ${grace} minutes old)`);
  const threads = ids.filter((id) => !real.has(id) && !fresh.has(id));

  // Orders: everything on a TEST company, and everything a test thread points at.
  const msgIds = ((await sql`SELECT message_id FROM thread_messages WHERE thread_id = ANY(${threads})`) as any[]).map((r) => r.message_id);
  const pointed = (await sql`
    SELECT order_id::bigint AS id FROM order_records WHERE thread_id = ANY(${threads})
    UNION SELECT order_id::bigint FROM job_links WHERE thread_id = ANY(${threads})
    UNION SELECT onsinch_order_id FROM tickets WHERE thread_id = ANY(${threads}) AND onsinch_order_id IS NOT NULL
    UNION SELECT onsinch_order_id FROM conversation_state WHERE thread_id = ANY(${threads}) AND onsinch_order_id IS NOT NULL
    UNION SELECT (e->'detail'->>'order_id')::bigint FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
      WHERE d.thread_id = ANY(${threads}) AND e->'detail'->>'order_id' ~ '^[0-9]+$'
    UNION SELECT (detail->>'order_id')::bigint FROM bot_ledger WHERE (source ~* ${TEST_ID} OR split_part(source, '#', 1) = ANY(${msgIds})) AND detail->>'order_id' ~ '^[0-9]+$'`) as { id: string }[];
  const testThreadOrders = new Set(pointed.map((r) => Number(r.id)).filter((n) => n > 0));
  const seen = new Map<number, any>();
  for (const c of testCos) for (const o of await allOf(t, `/orders?company_id[eq]=${c}`)) seen.set(Number(o.id), o);
  for (const id of testThreadOrders) if (!seen.has(id)) { const o = (await readRows(t as any, `/orders?id[eq]=${id}`))[0]; if (o) seen.set(id, o); }
  const orders: PlanOrder[] = [];
  for (const o of seen.values()) {
    const v = orderVerdict(o, new Set(testCos), testThreadOrders);
    if (!v) continue;
    if (v.go && grace && Date.parse(o.created) > Date.parse(cutoff)) { kept.push(`order R${o.number}: still in progress (under ${grace} minutes old)`); continue; }
    if (v.go) orders.push({ id: Number(o.id), number: String(o.number), company_id: Number(o.company_id), name: String(o.name ?? ""), why: v.why });
    else kept.push(`order R${o.number} "${o.name}": ${v.why}`);
  }

  // Companies the automation made.
  const made = await companiesMadeByAutomation(t);
  const goingByCompany = new Map<number, number>();
  for (const o of orders) goingByCompany.set(o.company_id, (goingByCompany.get(o.company_id) ?? 0) + 1);
  const companiesOut: PlanCompany[] = [];
  for (const c of companies.filter((c) => made.has(Number(c.id)))) {
    const id = Number(c.id);
    const clients = ([] as any[]).concat(c.Client ?? []).length;
    if (clients) continue;
    const refs = (await sql`
      SELECT thread_id FROM v2_decisions WHERE company_id = ${id} UNION SELECT thread_id FROM tickets WHERE company_id = ${id}
      UNION SELECT thread_id FROM order_records WHERE company_id = ${id} UNION SELECT thread_id FROM job_links WHERE company_id = ${id}`) as any[];
    const name = String(c.name ?? "").trim();
    const mentions = name.length >= 5 ? ((await sql`SELECT DISTINCT thread_id FROM thread_messages WHERE position(lower(${name}) in lower(body)) > 0`) as any[]) : [];
    const isTest = (th: string) => threads.includes(th);
    const facts = {
      name, email_invoice: c.email_invoice, clients,
      orders: 0,
      testRefs: refs.filter((r) => isTest(r.thread_id)).length, realRefs: refs.filter((r) => r.thread_id && !isTest(r.thread_id)).length,
      testMentions: mentions.filter((r) => isTest(r.thread_id)).length, realMentions: mentions.filter((r) => !isTest(r.thread_id)).length,
    };
    if (!companyVerdict(facts)) continue;
    // Only now pay for its orders: a company that is going must have none left after this clear.
    const left = (await allOf(t, `/orders?company_id[eq]=${id}`, 3)).length - (goingByCompany.get(id) ?? 0);
    const why = companyVerdict({ ...facts, orders: left });
    if (why) companiesOut.push({ id, name, why });
    else kept.push(`company "${name}": made by the automation for tests, but ${left} order(s) still on it`);
  }

  const rows: Record<string, number> = {};
  for (const table of THREAD_TABLES) {
    try { rows[table] = Number(((await sql(`SELECT count(*)::int AS n FROM ${table} WHERE thread_id = ANY($1)`, [threads])) as any[])[0].n); } catch { /* a table this database never made */ }
  }
  const extra = await extraRows(sql, testCos, msgIds, orders.map((o) => o.id), "count", cutoff);
  Object.assign(rows, extra);

  const plan: TestDataPlan = { at: new Date().toISOString(), threads, orders, companies: companiesOut, rows, kept, testCompanies: testCos, messages: msgIds };
  if (orders.length > CAPS.orders) plan.over = `${orders.length} orders (cap ${CAPS.orders})`;
  else if (companiesOut.length > CAPS.companies) plan.over = `${companiesOut.length} companies (cap ${CAPS.companies})`;
  else if (threads.length > CAPS.threads) plan.over = `${threads.length} threads (cap ${CAPS.threads})`;
  return plan;
}

/** Rows not keyed by a test thread: the ledger of test writes, local runs, and what was learned about TEST companies. */
async function extraRows(sql: Sql, testCos: number[], msgIds: string[], orderIds: number[], mode: "count" | "delete", cutoff: string): Promise<Record<string, number>> {
  const q = (where: string) => (mode === "count" ? `SELECT count(*)::int AS n FROM ${where}` : `WITH d AS (DELETE FROM ${where} RETURNING 1) SELECT count(*)::int AS n FROM d`);
  const parts: [string, string, unknown[]][] = [
    ["bot_ledger", `bot_ledger WHERE (source ~* $1 OR split_part(source, '#', 1) = ANY($2) OR (detail->>'order_id') = ANY($3) OR (op->>'company_id') = ANY($4)) AND created_at <= $5`, [TEST_ID, msgIds, orderIds.map(String), testCos.map(String), cutoff]],
    ["v2_decisions (local runs)", `v2_decisions WHERE code_version = 'local' AND (executed IS NULL OR jsonb_typeof(executed) <> 'array' OR jsonb_array_length(executed) = 0)`, []],
    ["sender_ledger", `sender_ledger WHERE addr ~* $1`, [TEST_SENDER]],
    ["entity_aliases", `entity_aliases WHERE kind = 'company' AND entity_id = ANY($1)`, [testCos]],
    ["rate_cards", `rate_cards WHERE company_id = ANY($1)`, [testCos]],
  ];
  const out: Record<string, number> = {};
  for (const [name, where, params] of parts) {
    try { out[name] = Number(((await sql(q(where), params)) as any[])[0].n); } catch { /* table absent */ }
  }
  return out;
}

export interface ClearResult { at: string; trigger: string; orders: string[]; companies: string[]; rows: Record<string, number>; failed: string[]; kept: string[]; refused?: string }

/** Removes what a plan names, OnSinch first; an order or company that will not go is reported, not retried. */
export async function clearTestData(sql: Sql, t: OnsinchCall, trigger: string, opts: { force?: boolean; graceMinutes?: number } = {}): Promise<ClearResult> {
  const plan = await planTestData(sql, t, { graceMinutes: opts.graceMinutes });
  const res: ClearResult = { at: new Date().toISOString(), trigger, orders: [], companies: [], rows: {}, failed: [], kept: plan.kept };
  if (plan.over && !opts.force) { res.refused = `more than a sweep may clear on its own: ${plan.over}`; await log(sql, res); return res; }
  for (const o of plan.orders) {
    const r = await t("DELETE", "/orders", [o.id]);
    const gone = !(await readRows(t as any, `/orders?id[eq]=${o.id}`))[0];
    if ((r.status === 200 || r.status === 204) && gone) res.orders.push(`R${o.number}`);
    else res.failed.push(`order R${o.number}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  }
  for (const c of plan.companies) {
    const r = await t("DELETE", "/companies", [c.id]);
    const gone = !(await readRows(t as any, `/companies?id[eq]=${c.id}`))[0];
    if ((r.status === 200 || r.status === 204) && gone) res.companies.push(c.name);
    else res.failed.push(`company "${c.name}": ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  }
  Object.assign(res.rows, await extraRows(sql, plan.testCompanies, plan.messages, plan.orders.map((o) => o.id), "delete", new Date(Date.parse(plan.at) - Math.max(0, opts.graceMinutes ?? 0) * 60e3).toISOString()));
  for (const table of THREAD_TABLES) {
    try { res.rows[table] = Number(((await sql(`WITH d AS (DELETE FROM ${table} WHERE thread_id = ANY($1) RETURNING 1) SELECT count(*)::int AS n FROM d`, [plan.threads])) as any[])[0].n); } catch { /* table absent */ }
  }
  await log(sql, res);
  return res;
}

/** Every clear is kept: what went, when, and what started it. */
async function log(sql: Sql, res: ClearResult) {
  await sql`CREATE TABLE IF NOT EXISTS test_data_clears (at TIMESTAMPTZ NOT NULL DEFAULT now(), trigger TEXT NOT NULL, result JSONB NOT NULL)`;
  await sql`INSERT INTO test_data_clears (trigger, result) VALUES (${res.trigger}, ${JSON.stringify(res)})`;
}

/** The last clear, and the last one that removed anything: an empty sweep every 15 minutes would otherwise hide it. */
export async function lastClear(sql: Sql): Promise<{ last: ClearResult | null; removed: ClearResult | null }> {
  try {
    const last = (await sql`SELECT result FROM test_data_clears ORDER BY at DESC LIMIT 1`) as any[];
    const removed = (await sql`SELECT result FROM test_data_clears
      WHERE jsonb_array_length(result->'orders') > 0 OR jsonb_array_length(result->'companies') > 0
        OR EXISTS (SELECT 1 FROM jsonb_each_text(result->'rows') r WHERE r.value::int > 0)
      ORDER BY at DESC LIMIT 1`) as any[];
    return { last: last[0]?.result ?? null, removed: removed[0]?.result ?? null };
  } catch { return { last: null, removed: null }; }
}

export const SWEEP_MINUTES = 15;
/** What the sweep leaves for its next pass: long enough for any test or harness run to finish. */
export const SWEEP_GRACE_MINUTES = 30;

/** The quarter-hourly clear: runs only with the setting on, and only when the last one is 15 minutes old. */
export async function maybeSweep(sql: Sql, t: OnsinchCall, enabled: boolean, now = Date.now()): Promise<ClearResult | string> {
  if (!enabled) return "off";
  const last = (await sql`SELECT max(at) AS at FROM test_data_clears WHERE trigger = 'sweep'`.catch(() => [{ at: null }])) as any[];
  if (last[0]?.at && now - new Date(last[0].at).getTime() < SWEEP_MINUTES * 60e3 - 30e3) return "not due";
  try {
    return await clearTestData(sql, t, "sweep", { graceMinutes: SWEEP_GRACE_MINUTES });
  } catch (e: any) {
    // Logged as a sweep so a clear that keeps throwing is tried every 15 minutes, not every minute.
    const res: ClearResult = { at: new Date().toISOString(), trigger: "sweep", orders: [], companies: [], rows: {}, failed: [String(e?.message ?? e).slice(0, 200)], kept: [] };
    await log(sql, res).catch(() => {});
    return res;
  }
}
