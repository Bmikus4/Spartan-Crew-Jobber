// ============================================================================
// The loop's record of every email: each decision, and each variant plan, judged against what staff did once its
// window has closed (ADDENDUM §12.2, P2.4).
// ----------------------------------------------------------------------------
// One v2_outcomes row per decision and differing variant, for client email from 9 Oct (the v2 reader's start)
// on. The minute sync's "outcomes" step adds a row for each new decision and variant, then scores the oldest open
// rows whose window has closed and whose truth is stored:
//   - the client is the one company whose OnSinch contact list holds the sender's exact address, never the
//     resolver being judged (§12.1, question 6); none or several is "can't tell", counted;
//   - the window is loop/judge.ts windowFor's;
//   - the client's orders are read from OnSinch then, newest first, and rewound to the window's close by the
//     stored timeline. Reading them also ties their older parts' timeline rows to them (truth.ts rememberOrders);
//   - an email read as nothing to do also gets the day flag (§12.2 item 8): staff worked, within 48 hours, on an
//     order of the client's holding a day the email names, by the date parser, never the model; with the same
//     test over the 48 hours before as its noise floor.
// A read of OnSinch that fails throws and leaves every row open for the next minute; nothing is scored on a guess.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import type { Transport } from "../../onsinch/onsinch";
import type { Op } from "../bot/ops";
import { utcToLondon } from "../bot/ops";
import { readPage } from "../read";
import { datesIn, latestText } from "../interpret/ground";
import { ensureSchema } from "../../migrations";
import { actsOf, orderAt, planScope, scoreEmail, windowFor, type Row } from "./judge";
import { coded } from "../reasons";
import type { Decision } from "../interpret/plan";
import { rememberOrders } from "./truth";

type Sql = NeonQueryFunction<false, false>;

/** The first decision the loop judges: the v2 reader's start (the Part 1 audit's own floor). */
export const LOOP_FROM = "2026-10-09T10:20:00Z";
/** Emails scored a minute: the backfill from 9 Oct (about 1,100) takes under an hour. */
export const PER_RUN = 25;
/** The client's newest orders read for an email; 500 reaches past every order touched in a window. */
const ORDER_PAGES = 5;
const FLAG_HOURS = 48;
export const SCORER = "loop-1";
const HOUR = 3600e3;
const NESTED = "Job__SlotTeam__Slot__SlotLocation";
const T = (s: unknown) => Date.parse(String(s ?? "")) || 0;
const addr = (from: unknown) => String(from ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
const slotsOf = (o: any): any[] => ([].concat(o?.Job ?? []) as any[]).flatMap((j) => [].concat(j.SlotTeam ?? []) as any[]).flatMap((t) => [].concat(t.Slot ?? []) as any[]);
const dayOf = (iso: unknown) => utcToLondon(String(iso)).date;

/**
 * A row for every new decision since LOOP_FROM, and every variant whose plan differs from its decision. The code is
 * reasons.ts coded()'s, so a decision stored before codes were (24 Oct) gets the code its words carry.
 */
export async function seedOutcomes(sql: Sql): Promise<number> {
  await ensureSchema(sql);
  const fresh = (await sql`SELECT d.message_id, d.thread_id, d.sent_at, d.kind, d.decision, 'production' AS variant FROM v2_decisions d
    WHERE d.sent_at::timestamptz >= ${LOOP_FROM}::timestamptz AND d.code_version IS DISTINCT FROM 'local'
      AND NOT EXISTS (SELECT 1 FROM v2_outcomes o WHERE o.message_id = d.message_id AND o.variant = 'production')
    UNION ALL
    SELECT v.message_id, d.thread_id, d.sent_at, v.decision->>'kind', v.decision, v.variant FROM v2_variants v JOIN v2_decisions d ON d.message_id = v.message_id
    WHERE NOT v.same AND v.error IS NULL AND v.decision IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM v2_outcomes o WHERE o.message_id = v.message_id AND o.variant = v.variant)`) as any[];
  const rows = fresh.map((r) => {
    const d = coded(r.decision as Decision);
    const plan = d.kind === "write" ? d.ops.map((o) => o.op) : null;
    return { message_id: r.message_id, variant: r.variant, thread_id: r.thread_id, sent_at: new Date(T(r.sent_at)).toISOString(), kind: d.kind, code: d.code ?? null, plan };
  }).filter((r) => r.code !== "none_not_client");
  for (let i = 0; i < rows.length; i += 200) {
    await sql`INSERT INTO v2_outcomes (message_id, variant, thread_id, sent_at, kind, code, plan)
      SELECT message_id, variant, thread_id, sent_at, kind, code, plan
      FROM jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + 200))}::jsonb) AS x(message_id TEXT, variant TEXT, thread_id TEXT, sent_at TIMESTAMPTZ, kind TEXT, code TEXT, plan JSONB)
      ON CONFLICT (message_id, variant) DO NOTHING`;
  }
  return rows.length;
}

/** The time up to which the stored timeline is complete (truth.ts), or null while it is still catching up. */
async function truthUntil(sql: Sql): Promise<number | null> {
  const r = (await sql`SELECT value FROM v2_loop_meta WHERE key = 'timeline_complete_at'`) as Array<{ value: string }>;
  return r.length ? T(r[0].value) : null;
}

type Open = { message_id: string; variant: string; code: string | null; kind: string; plan: Op[] | null };
type Scored = Partial<{ company_id: number | null; client_match: string; window_from: string; window_to: string; cut_by: string | null; days: string[]; venues: number[];
  bucket: string; why: string | null; orders: number[]; acts: number; plan_keys: string[]; staff_keys: string[]; staff_other: string[]; ahead_days: number | null;
  day_flag: string | null; day_control: string | null }>;

async function save(sql: Sql, message_id: string, variant: string, s: Scored): Promise<void> {
  const j = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
  await sql`UPDATE v2_outcomes SET company_id = ${s.company_id ?? null}, client_match = ${s.client_match ?? null},
    window_from = ${s.window_from ?? null}::timestamptz, window_to = ${s.window_to ?? null}::timestamptz, cut_by = ${s.cut_by ?? null},
    days = ${j(s.days)}::jsonb, venues = ${j(s.venues)}::jsonb, bucket = ${s.bucket ?? null}, why = ${s.why ?? null}, orders = ${j(s.orders)}::jsonb,
    acts = ${s.acts ?? null}, plan_keys = ${j(s.plan_keys)}::jsonb, staff_keys = ${j(s.staff_keys)}::jsonb, staff_other = ${j(s.staff_other)}::jsonb,
    ahead_days = ${s.ahead_days ?? null}, day_flag = ${s.day_flag ?? null}, day_control = ${s.day_control ?? null}, scored_at = now(), scorer = ${SCORER}
    WHERE message_id = ${message_id} AND variant = ${variant}`;
}

/** The client's newest orders, as OnSinch holds them now (process.ts onsinchWorld reads the same way). */
async function clientOrders(t: Transport, companyId: number): Promise<any[]> {
  const out: any[] = [];
  for (let p = 1; p <= ORDER_PAGES; p++) {
    const page = await readPage(t, `/orders?company_id[eq]=${companyId}&with=${NESTED}&limit=100&page=${p}`);
    out.push(...page.rows);
    if (page.rows.length < 100) break;
  }
  return out;
}

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);

/**
 * The minute sync's step: new rows, then up to PER_RUN emails scored, oldest first. An email whose window (or
 * day-flag span) has not closed inside the stored timeline waits.
 */
export async function scoreOutcomes(sql: Sql, t: Transport, opts: { now?: number; deadline?: number; perRun?: number } = {}): Promise<Record<string, unknown>> {
  const seeded = await seedOutcomes(sql);
  const until = await truthUntil(sql);
  if (until == null) return { seeded, scored: 0, waiting: "the timeline is still catching up" };
  const contacts = (await sql`SELECT count(*)::int AS n FROM onsinch_contacts`) as Array<{ n: number }>;
  if (!contacts[0]?.n) throw new Error("no OnSinch contacts stored: no email can be tied to a client");
  const open = (await sql`SELECT message_id, min(sent_at) AS sent_at FROM v2_outcomes WHERE scored_at IS NULL AND sent_at < ${new Date(until - HOUR).toISOString()}::timestamptz
    GROUP BY message_id ORDER BY min(sent_at) LIMIT 200`) as Array<{ message_id: string }>;
  const orderMemo = new Map<number, any[]>();
  let scored = 0, waiting = 0;
  for (const { message_id } of open) {
    if (scored >= (opts.perRun ?? PER_RUN) || Date.now() >= (opts.deadline ?? Infinity)) break;
    const rows = (await sql`SELECT message_id, variant, code, kind, plan FROM v2_outcomes WHERE message_id = ${message_id} AND scored_at IS NULL`) as Open[];
    const m = ((await sql`SELECT message_id, thread_id, from_address, date_iso, body FROM thread_messages WHERE message_id = ${message_id}`) as any[])[0];
    if (!m) { for (const r of rows) await save(sql, message_id, r.variant, { bucket: "can't tell", why: "the email is not stored" }); scored++; continue; }
    const sentAt = T(m.date_iso);
    const later = ((await sql`SELECT x.message_id, x.date_iso, d.kind FROM thread_messages x LEFT JOIN v2_decisions d ON d.message_id = x.message_id
      WHERE x.thread_id = ${m.thread_id} AND NOT x.is_from_spartan AND x.message_id <> ${message_id}`) as any[])
      .map((x) => ({ message_id: String(x.message_id), at: T(x.date_iso), cuts: x.kind === "write" || x.kind === "handoff" }));
    const w = windowFor(sentAt, later);
    const flag = rows.some((r) => r.variant === "production" && r.code === "none_nothing_to_do");
    if (Math.max(w.to, flag ? sentAt + FLAG_HOURS * HOUR : 0) > until) { waiting++; continue; }
    const win = { window_from: new Date(w.from).toISOString(), window_to: new Date(w.to).toISOString(), cut_by: w.cut_by };
    const ids = ((await sql`SELECT DISTINCT company_id FROM onsinch_contacts WHERE email = ${addr(m.from_address)}`) as any[]).map((x) => Number(x.company_id));
    if (ids.length !== 1) {
      for (const r of rows) await save(sql, message_id, r.variant, { ...win, client_match: ids.length ? "several" : "none", bucket: "can't tell", why: ids.length ? "the sender is a contact of several companies" : "the sender is no company's contact" });
      scored++; continue;
    }
    const company = ids[0];
    if (!orderMemo.has(company)) { const os = await clientOrders(t, company); await rememberOrders(sql, os); orderMemo.set(company, os); }
    const orders = orderMemo.get(company)!;
    const byId = new Map(orders.map((o) => [Number(o.id), o]));
    const from = Math.min(w.from, sentAt - FLAG_HOURS * HOUR);
    const stored = ((await sql`SELECT id, action, creator, created, model, model_id, order_id, data FROM onsinch_timeline
      WHERE order_id = ANY(${[...byId.keys()]}) AND created >= ${new Date(from).toISOString()}::timestamptz ORDER BY id`) as any[])
      .map((r) => ({ ...r, id: Number(r.id), order_id: Number(r.order_id), created: new Date(r.created).toISOString() })) as Row[];
    const { acts } = actsOf(stored, (id) => { const o = byId.get(id); return o ? { number: String(o.number), company_id: company } : undefined; });
    const memo = new Map<number, any>();
    const order = (id: number) => {
      if (!memo.has(id)) { const o = byId.get(id); memo.set(id, o ? orderAt(o, w.to, stored.filter((r) => r.order_id === id)).order : undefined); }
      return memo.get(id);
    };
    const named = [...datesIn(latestText(String(m.body ?? "")), String(m.date_iso))].sort();
    for (const r of rows) {
      const plan = r.kind === "write" && Array.isArray(r.plan) ? r.plan : null;
      const scope = plan ? planScope(plan, order) : { days: named, venues: [] as number[], orders: [] as number[] };
      const out = scoreEmail({ plan, days: scope.days, venues: scope.venues, planOrders: scope.orders, sentAt, window: w, acts, order });
      const sentDay = dayOf(new Date(sentAt).toISOString());
      const s: Scored = { ...win, company_id: company, client_match: "one", days: scope.days, venues: scope.venues, ...out,
        ahead_days: plan && scope.days.length ? daysApart(sentDay, scope.days[0]) : null };
      if (r.variant === "production" && r.code === "none_nothing_to_do") {
        // Staff's work on a day the email names, after it and before it: the second is the flag's noise floor.
        const on = (a: { order_id: number }) => slotsOf(byId.get(a.order_id)).some((x) => x.beginning && named.includes(dayOf(x.beginning)));
        const hit = (lo: number, hi: number) => acts.some((a) => T(a.at) > lo && T(a.at) <= hi && a.what !== "confirm order" && on(a));
        s.day_flag = !named.length ? "no day named" : hit(sentAt, sentAt + FLAG_HOURS * HOUR) ? "staff worked on a named day" : "no";
        s.day_control = !named.length ? null : hit(sentAt - FLAG_HOURS * HOUR, sentAt) ? "staff worked on a named day" : "no";
      }
      await save(sql, message_id, r.variant, s);
    }
    scored++;
  }
  return { seeded, scored, waiting, open: open.length };
}
