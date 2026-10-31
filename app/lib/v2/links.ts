// ============================================================================
// The bridge's memory: which OnSinch order and job each thread is about, kept true every minute.
// ----------------------------------------------------------------------------
// Ben, 10-13: the bot tracks every order it makes or changes by the job's J number, linked to the [DECISIONS V10]
// order's R number, and a separate sweep finds what is not linked to a J number; what it cannot
// find is held. The J number is the anchor because it survives a job being moved to another
// order, while R numbers are reused after a delete (measured 08-19) and staff re-type orders.
//
//   linked    order and job read back this minute
//   relinked  the job moved, or staff rebuilt the order: the link now names the new one
//   held      neither the job nor a rebuilt order can be found; retried every minute, and on
//             the TV once held for HOLD_TV_MINUTES
//
// Sweep A follows each link's J number (GET /orders?with=Job&Job__id[eq]=J) to wherever the
// job now is. Sweep B reads links with no J number: by order id, then by R number, then the
// order staff rebuilt in its place (same client, created after the link, holding the same
// shifts). Nothing here writes to OnSinch; the minute route (api/bot/sync) also retries writes
// that stopped before anything was sent.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { httpTransport } from "../onsinch/onsinch";
import { readRows } from "./read";
import { ensureSchema } from "../migrations";
import { latestText } from "./interpret/ground";
import { rNumbersIn } from "../onsinch/resolve";

type Sql = NeonQueryFunction<false, false>;
export const HOLD_TV_MINUTES = 30;
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

let ready = false;
/**
 * For a caller that may only read (scripts/_readonly.mts): the table exists in production, and
 * Postgres refuses CREATE in a read-only transaction even with IF NOT EXISTS.
 */
export function assumeLinksTable(): void { ready = true; }

export async function ensureLinks(sql: Sql): Promise<void> {
  if (ready) return;
  await ensureSchema(sql);
  ready = true;
}

function api() {
  return httpTransport({ baseUrl: process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1", apiKey: process.env.ONSINCH_API_KEY || "" });
}

/** An order's job (J), R number and live shift windows, as the sweeps compare them. */
function shape(o: any): { job_id: number | null; r: string; shifts: string[] } {
  const jobs = ([] as any[]).concat(o?.Job ?? []);
  const slots = jobs.flatMap((j) => ([] as any[]).concat(j.SlotTeam ?? [])).flatMap((t) => ([] as any[]).concat(t.Slot ?? [])).filter((s) => s.cancelled !== true);
  return { job_id: jobs[0] ? Number(jobs[0].id) : null, r: String(o?.number ?? ""), shifts: [...new Set(slots.map((s) => `${s.beginning}|${s.end}`))].sort() };
}

/** Record that a thread is about an order (after the bot made or changed it, or a verified link). */
export async function recordLink(sql: Sql, l: { thread_id: string; order_id: number; company_id?: number | null; source: string }): Promise<void> {
  await ensureLinks(sql);
  const o = rowsOf(await api()("GET", `/orders?id[eq]=${l.order_id}&with=Job__SlotTeam__Slot`))[0];
  const s = o ? shape(o) : { job_id: null, r: "", shifts: [] };
  await sql`INSERT INTO job_links (thread_id, order_id, r_number, job_id, company_id, state, source, shifts, last_checked)
    VALUES (${l.thread_id}, ${l.order_id}, ${s.r || null}, ${s.job_id}, ${l.company_id ?? (o ? Number(o.company_id) : null)}, 'linked', ${l.source}, ${JSON.stringify(s.shifts)}::jsonb, now())
    ON CONFLICT (thread_id, order_id) DO UPDATE SET r_number = coalesce(EXCLUDED.r_number, job_links.r_number), job_id = coalesce(EXCLUDED.job_id, job_links.job_id),
      shifts = CASE WHEN EXCLUDED.shifts = '[]'::jsonb THEN job_links.shifts ELSE EXCLUDED.shifts END, state = 'linked', last_checked = now(), held_since = NULL`;
}

/**
 * AN ORDER THE PLANNER FOUND (by evidence, not by writing it) becomes the thread's link, so the
 * TV's R and J are the order's own (measured 10-21: 59 of 107 need threads had their order in
 * OnSinch and no link, because only a bot write made one). A guess never displaces a live link to
 * another order, and never stands beside an absolute one or comes back once an absolute one
 * replaced it (linkAbsolute, DECISIONS O17). A held link is an order that is gone, and the found
 * one replaces it.
 */
export async function linkFound(sql: Sql, l: { thread_id: string; order_id: number; source: string }): Promise<"linked" | "same" | "kept"> {
  await ensureLinks(sql);
  const have = (await sql`SELECT order_id, state FROM job_links WHERE thread_id = ${l.thread_id}`) as Array<{ order_id: string | number; state: string }>;
  if (have.some((h) => Number(h.order_id) === l.order_id && h.state !== "held" && h.state !== "replaced")) return "same";
  if (have.some((h) => h.state !== "held" && h.state !== "gone")) return "kept";
  await sql`DELETE FROM job_links WHERE thread_id = ${l.thread_id} AND state IN ('held', 'gone')`;
  await recordLink(sql, l);
  return "linked";
}

/** Every order the bot made or changed, from the decisions, recorded as a link once. */
export async function backfillLinks(sql: Sql): Promise<number> {
  await ensureLinks(sql);
  const rows = (await sql`
    SELECT DISTINCT d.thread_id, d.company_id, (e->'detail'->>'order_id')::bigint AS order_id
      FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
     WHERE (e->'detail'->>'order_id') ~ '^[0-9]+$' AND e->>'status' = 'verified'
    UNION
    SELECT DISTINCT d.thread_id, d.company_id, (x->'op'->>'order_id')::bigint
      FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.decision->'ops') = 'array' THEN d.decision->'ops' ELSE '[]'::jsonb END) x
     WHERE d.kind = 'write' AND (x->'op'->>'order_id') ~ '^[0-9]+$' AND d.executed::text LIKE '%verified%'`) as any[];
  let n = 0;
  for (const r of rows) {
    // ONLY A THREAD WITH NO LINK AT ALL. A link the sweep moved to staff's rebuild (or that was
    // moved off a duplicate) no longer names the bot's order, and checking for that exact pair
    // put the dead order back every minute: the sweep then held it and the TV showed "Order not
    // found in OnSinch". 9 of 11 held links on 10-15 were these.
    const have = (await sql`SELECT 1 FROM job_links WHERE thread_id = ${r.thread_id}`) as any[];
    if (have.length) continue;
    await recordLink(sql, { thread_id: r.thread_id, order_id: Number(r.order_id), company_id: r.company_id, source: "backfill" });
    n++;
  }
  return n;
}

/**
 * THE JOBS BOARD'S TICKETS, LINKED BY THEIR J (ported.ts says why): each ticket thread with no link
 * gets one to the order that holds its job now, found by the J (stable) rather than its R (reused
 * after a delete) or its order id. A job OnSinch no longer has, or a cancelled order, gets none.
 * A few a minute, so the minute's other work is not held up; the tickets no longer change.
 */
export async function backfillBoardLinks(sql: Sql, limit = 20): Promise<{ linked: number; gone: number }> {
  await ensureLinks(sql);
  const [t] = (await sql`SELECT to_regclass('public.tickets') AS t`) as { t: string | null }[];
  if (!t?.t) return { linked: 0, gone: 0 };
  const rows = (await sql`
    SELECT k.thread_id, k.onsinch_order_id, k.onsinch_job_id, k.company_id FROM tickets k
    WHERE NOT EXISTS (SELECT 1 FROM job_links l WHERE l.thread_id = k.thread_id)
      AND (k.onsinch_job_id > 0 OR k.onsinch_order_id > 0)
      AND coalesce(k.classification, '') <> 'not-a-job' AND coalesce(k.status, '') <> 'ignored' AND k.is_client_inquiry IS NOT FALSE
    ORDER BY k.updated_at DESC LIMIT ${limit}`) as any[];
  const t2 = api();
  let linked = 0, gone = 0;
  for (const k of rows) {
    const holder = Number(k.onsinch_job_id) > 0 ? (await readRows(t2 as any, `/orders?with=Job&Job__id[eq]=${Number(k.onsinch_job_id)}`))[0]
      : (await readRows(t2 as any, `/orders?id[eq]=${Number(k.onsinch_order_id)}&with=Job`))[0];
    if (!holder || Number(holder.status) === -1) {
      // Remembered as "gone", so it is asked once: a link no card, sweep or finder reads.
      await sql`INSERT INTO job_links (thread_id, order_id, state, source, note, last_checked) VALUES (${k.thread_id}, ${Number(k.onsinch_order_id) || 0}, 'gone', 'jobs board', 'its job is not in OnSinch, or its order is cancelled', now()) ON CONFLICT (thread_id, order_id) DO NOTHING`;
      gone++;
      continue;
    }
    await recordLink(sql, { thread_id: k.thread_id, order_id: Number(holder.id), company_id: k.company_id ?? null, source: "jobs board" });
    linked++;
  }
  return { linked, gone };
}

export type GradeMessage = { at: number; ours: boolean; subject: string | null; body: string | null };
export type GradeOrder = { order_id: number; number: string | null; company_id: number | null; po: string | null; jobs: number[]; made: number | null; deleted: boolean };
export type Graded = { order_id: number; proof: string };

/** A PO's whole tokens: 6+ characters with a digit, staff's markers (*, ^) off; a link, an address or a path is no token. */
const poTokens = (s: string) => s.split(/[\s,;|]+|\s\/\s/).map((x) => x.replace(/^[*^#("'[<]+|[)"'\].,:;>!?]+$/g, "").toLowerCase())
  .filter((x) => x.length >= 6 && /\d/.test(x) && !/[@\\]|:\/\/|^www\.|\//.test(x));

/**
 * THE ORDERS A THREAD NAMES ABSOLUTELY (DECISIONS O17, O18), each with its proof:
 *   - an R or J in a subject or a message's own words, the client's or ours; quoted history is another thread's
 *     (one false hit on 30 Oct was an R quoted from another thread). An R names the order holding it when the
 *     email was sent: OnSinch reuses an R after a delete (DECISIONS D6);
 *   - a PO token in the client's own words or subject equal to an order's PO token. A PO in ours only is not the
 *     client naming the job: on 31 Oct one named the client's previous order and would have replaced the right one;
 *   - the bot's own order.
 * A PO token is whole, 6+ characters with a digit, staff's markers (*, ^) off, never inside a link, an address or a
 * path: all 8 false hits of 30 Oct were POs of 4-5 characters inside such strings, or that quoted R. A deleted
 * order names nothing. `conflict`: two absolutes disagree (an order of another company than the sender's, or the
 * bot's order beside a PO naming another); then nothing is linked or overruled, and the card asks a person.
 */
export function gradeThread(msgs: GradeMessage[], orders: GradeOrder[], botOrders: number[], senderCompanies: number[]): { links: Graded[]; conflict: string | null } {
  const live = orders.filter((o) => !o.deleted);
  const out = new Map<number, string>();
  const add = (id: number, proof: string) => { if (!out.has(id)) out.set(id, proof); };
  for (const m of msgs) {
    const own = `${m.subject ?? ""}\n${latestText(m.body ?? "")}`;
    for (const r of rNumbersIn(own)) {
      const held = live.filter((o) => o.number === r && (o.made == null || o.made <= m.at));
      if (held.length === 1) add(held[0].order_id, `R${r}`);
    }
    for (const j of own.matchAll(/\bJ(\d{5,6})\b/g)) for (const o of live) if (o.jobs.includes(Number(j[1]))) add(o.order_id, `J${j[1]}`);
    if (m.ours) continue;
    const said = new Set(poTokens(own));
    for (const o of live) for (const p of poTokens(o.po ?? "")) if (said.has(p)) add(o.order_id, `PO ${p}`);
  }
  const byPo = [...out].filter(([, p]) => p.startsWith("PO")).map(([id]) => id);
  for (const id of botOrders) if (live.some((o) => o.order_id === id)) add(id, "the bot's own order");
  const links = [...out].map(([order_id, proof]) => ({ order_id, proof }));
  const other = senderCompanies.length ? links.find((l) => !senderCompanies.includes(Number(live.find((o) => o.order_id === l.order_id)?.company_id))) : undefined;
  const bot = botOrders.filter((id) => out.has(id));
  const conflict = other ? `${other.proof} is another company's order`
    : bot.length && byPo.length && !byPo.some((id) => bot.includes(id)) ? "the bot's order is not the one the PO names" : null;
  return { links, conflict };
}

/**
 * Every thread's absolute links, matched again whenever a side changes: a new email against the stored orders,
 * a new or changed order against the stored threads (80 of 148 absolute links on 30 Oct name an order made after
 * the email, which a search at intake cannot see). An absolute link overrules a guessed link to an order outside
 * its set; the guessed one is marked replaced with the proof, never deleted.
 */
export async function linkAbsolute(sql: Sql, opts: { dry?: boolean } = {}): Promise<{ graded: number; added: Array<Graded & { thread_id: string; was: string | null }>; replaced: Array<Graded & { thread_id: string; source: string | null }>; conflicts: Record<string, string> }> {
  await ensureLinks(sql);
  const stamp = JSON.stringify((await sql`SELECT (SELECT max(first_seen_at) FROM thread_messages)::text AS m, (SELECT max(read_at) FROM onsinch_orders)::text AS o,
    (SELECT max(deleted_at) FROM onsinch_orders)::text AS d, (SELECT count(*) FROM v2_decisions)::int AS n`) as unknown[]);
  const last = ((await sql`SELECT value FROM v2_loop_meta WHERE key = 'links_graded'`) as Array<{ value: string }>)[0]?.value;
  if (!opts.dry && last === stamp) return { graded: 0, added: [], replaced: [], conflicts: {} };
  const orders = ((await sql`SELECT o.order_id, o.number, o.company_id, o.body->>'intern_name' AS po, o.body->'Job' AS jobs, o.deleted_at IS NOT NULL AS deleted,
      (SELECT min(t.created) FROM onsinch_timeline t WHERE t.order_id = o.order_id AND t.action IN ('order_create', 'order_create_by_copy', 'order_created_via_api')) AS made
    FROM onsinch_orders o`) as any[]).map((o): GradeOrder => ({ order_id: Number(o.order_id), number: o.number == null ? null : String(o.number), company_id: o.company_id == null ? null : Number(o.company_id),
      po: o.po ?? null, jobs: ([].concat(o.jobs ?? []) as any[]).map((j) => Number(j?.id)).filter(Boolean), made: o.made ? new Date(o.made).getTime() : null, deleted: !!o.deleted }));
  const msgs = (await sql`SELECT m.thread_id, m.date_iso, m.subject, m.body, m.from_address, m.is_from_spartan FROM thread_messages m
    WHERE m.thread_id IN (SELECT thread_id FROM v2_decisions WHERE created_at >= ${LINKS_FROM}::timestamptz)`) as any[];
  const bot = (await sql`SELECT DISTINCT d.thread_id, (e->'detail'->>'order_id')::bigint AS order_id
      FROM v2_decisions d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.executed) = 'array' THEN d.executed ELSE '[]'::jsonb END) e
     WHERE (e->'detail'->>'order_id') ~ '^[0-9]+$' AND e->>'status' = 'verified'`) as any[];
  const contacts = (await sql`SELECT email, company_id FROM onsinch_contacts`) as any[];
  const links = (await sql`SELECT thread_id, order_id, state, source, proof FROM job_links WHERE state IN ('linked', 'relinked', 'held', 'replaced')`) as any[];
  const companiesOf = new Map<string, number[]>();
  for (const c of contacts) companiesOf.set(c.email, [...(companiesOf.get(c.email) ?? []), Number(c.company_id)]);
  const byThread = new Map<string, any[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  const added: Array<Graded & { thread_id: string; was: string | null }> = [], replaced: Array<Graded & { thread_id: string; source: string | null }> = [];
  const conflicts: Record<string, string> = {};
  for (const [thread_id, ms] of byThread) {
    const sender = [...new Set(ms.filter((m) => !m.is_from_spartan).flatMap((m) => companiesOf.get(addrOf(m.from_address)) ?? []))];
    const g = gradeThread(ms.map((m) => ({ at: Date.parse(m.date_iso) || 0, ours: !!m.is_from_spartan, subject: m.subject, body: m.body })), orders,
      bot.filter((b) => b.thread_id === thread_id).map((b) => Number(b.order_id)), sender);
    if (!g.links.length) continue;
    if (g.conflict) { conflicts[thread_id] = g.conflict; continue; }
    const mine = links.filter((l) => l.thread_id === thread_id);
    for (const l of g.links) {
      const had = mine.find((x) => Number(x.order_id) === l.order_id);
      if (had?.proof === l.proof && had.state !== "replaced") continue;
      added.push({ thread_id, ...l, was: had ? `${had.state}${had.source ? ` (${had.source})` : ""}` : null });
      if (opts.dry) continue;
      const o = orders.find((x) => x.order_id === l.order_id)!;
      await sql`INSERT INTO job_links (thread_id, order_id, r_number, job_id, company_id, state, source, proof)
        VALUES (${thread_id}, ${l.order_id}, ${o.number}, ${o.jobs[0] ?? null}, ${o.company_id}, 'linked', 'absolute', ${l.proof})
        ON CONFLICT (thread_id, order_id) DO UPDATE SET proof = EXCLUDED.proof, state = CASE WHEN job_links.state = 'replaced' THEN 'linked' ELSE job_links.state END, note = NULL`;
    }
    const set = new Set(g.links.map((l) => l.order_id));
    const proof = g.links.map((x) => x.proof).join(", ");
    for (const l of mine.filter((x) => (x.state === "linked" || x.state === "relinked") && !set.has(Number(x.order_id)) && !x.proof)) {
      replaced.push({ thread_id, order_id: Number(l.order_id), source: l.source, proof });
      if (!opts.dry) await sql`UPDATE job_links SET state = 'replaced', note = ${`replaced by ${proof}`} WHERE thread_id = ${thread_id} AND order_id = ${Number(l.order_id)}`;
    }
  }
  if (!opts.dry) {
    // A conflict writes no link: the TV reads it here and shows the card as one to check.
    await sql`INSERT INTO v2_loop_meta (key, value, at) VALUES ('link_conflicts', ${JSON.stringify(conflicts)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
    await sql`INSERT INTO v2_loop_meta (key, value, at) VALUES ('links_graded', ${JSON.stringify(stamp)}::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
  }
  return { graded: byThread.size, added, replaced, conflicts };
}

/** The first decision the TV shows (feed/live.ts V2_FROM): threads older than the rebuild are graded by nobody. */
const LINKS_FROM = "2026-10-09T10:20:00Z";
const addrOf = (f: unknown) => String(f ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();

export type SweepReport = { checked: number; linked: number; relinked: number; held: number; notes: string[] };

/** Sweeps A and B over the links not checked in the last minute, oldest first. */
export async function sweepLinks(sql: Sql, limit = 40): Promise<SweepReport> {
  await ensureLinks(sql);
  const t = api();
  const rep: SweepReport = { checked: 0, linked: 0, relinked: 0, held: 0, notes: [] };
  // The TV's own threads first; the jobs board's carried-over tiles take what the minute has left.
  const links = (await sql`SELECT * FROM job_links WHERE state NOT IN ('gone', 'replaced') AND coalesce(last_checked, 'epoch') < now() - interval '50 seconds'
    ORDER BY (coalesce(source, '') = 'jobs board'), coalesce(last_checked, 'epoch') LIMIT ${limit}`) as any[];
  for (const l of links) {
    // A read that failed says nothing about the order: the link is left exactly as it was and
    // tried again next minute. Before 10-15 a 500 read as "not in OnSinch" and held the link.
    try {
      rep.checked++;
      let o: any = null;
      let how = "";
      // Sweep A: follow the job.
      // The Job filter works only beside with=Job (10-13: with=Job__SlotTeam answers 400), so the
      // job finds its order and the order is then read whole.
      if (l.job_id) {
        const holder = (await readRows(t as any, `/orders?with=Job&Job__id[eq]=${l.job_id}`))[0];
        if (holder) o = (await readRows(t as any, `/orders?id[eq]=${holder.id}&with=Job__SlotTeam__Slot`))[0] ?? null;
        how = o && Number(o.id) !== Number(l.order_id) ? `job J${l.job_id} moved to R${o.number}` : "";
      }
      // Sweep B: no J number, or the job is gone: the order, its R number, then its rebuild.
      if (!o) { o = (await readRows(t as any, `/orders?id[eq]=${l.order_id}&with=Job__SlotTeam__Slot`))[0] ?? null; }
      if (!o && l.r_number) { const byR = (await readRows(t as any, `/orders?number[eq]=${l.r_number}&with=Job__SlotTeam__Slot`))[0]; if (byR && Number(byR.company_id) === Number(l.company_id)) { o = byR; how = `R${l.r_number} is now order ${byR.id}`; } }
      if (!o && l.company_id) {
        // A rebuilt order: the same client, created after the link was made, holding every shift the link held.
        const was: string[] = Array.isArray(l.shifts) ? l.shifts : [];
        // Newest first is /orders' default; `sort=-id` reverses it and read the client's 30 OLDEST orders, so no rebuild was ever found.
        const cands = (await readRows(t as any, `/orders?company_id[eq]=${l.company_id}&with=Job__SlotTeam__Slot&limit=30`))
          .filter((c) => Date.parse(c.created) >= Date.parse(l.first_seen) - 3600e3 && was.length && was.every((w) => shape(c).shifts.includes(w)));
        if (cands.length === 1) { o = cands[0]; how = `rebuilt by staff as R${o.number}`; }
        else if (cands.length > 1) rep.notes.push(`${l.thread_id}: ${cands.length} orders could be the rebuild of R${l.r_number}`);
      }
      if (o) {
        const s = shape(o);
        const moved = Number(o.id) !== Number(l.order_id);
        if (moved) {
          await sql`DELETE FROM job_links WHERE thread_id = ${l.thread_id} AND order_id = ${Number(o.id)}`;
          await sql`UPDATE job_links SET order_id = ${Number(o.id)}, r_number = ${s.r}, job_id = ${s.job_id}, shifts = ${JSON.stringify(s.shifts)}::jsonb, state = 'relinked', last_checked = now(), held_since = NULL, note = ${how}
            WHERE thread_id = ${l.thread_id} AND order_id = ${Number(l.order_id)}`;
          rep.relinked++; rep.notes.push(`${l.thread_id}: ${how}`);
        } else {
          await sql`UPDATE job_links SET r_number = ${s.r}, job_id = ${s.job_id}, shifts = CASE WHEN ${s.shifts.length} > 0 THEN ${JSON.stringify(s.shifts)}::jsonb ELSE shifts END,
            state = CASE WHEN state = 'held' THEN 'linked' ELSE state END, last_checked = now(), held_since = NULL WHERE thread_id = ${l.thread_id} AND order_id = ${Number(l.order_id)}`;
          rep.linked++;
        }
      } else {
        await sql`UPDATE job_links SET state = 'held', held_since = coalesce(held_since, now()), last_checked = now(), note = 'the order and its job are not in OnSinch, and no rebuild was found'
          WHERE thread_id = ${l.thread_id} AND order_id = ${Number(l.order_id)}`;
        rep.held++;
      }
    } catch (e) {
      rep.notes.push(`${l.thread_id}: OnSinch read failed, left as it was (${String((e as Error)?.message ?? e).slice(0, 100)})`);
    }
  }
  return rep;
}
