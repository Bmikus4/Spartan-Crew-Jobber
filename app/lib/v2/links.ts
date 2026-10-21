// ============================================================================
// The bridge's memory: which OnSinch order and job each thread is about, kept true every minute.
// ----------------------------------------------------------------------------
// Ben, 10-13: the bot tracks every order it makes or changes by the job's J number, linked to the
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
import { httpTransport } from "../engine/onsinch";
import { readRows } from "./read";

type Sql = NeonQueryFunction<false, false>;
export const HOLD_TV_MINUTES = 30;
const rowsOf = (r: any): any[] => (Array.isArray(r?.data?.data) ? r.data.data : Array.isArray(r?.data) ? r.data : []);

let ready = false;
export async function ensureLinks(sql: Sql): Promise<void> {
  if (ready) return;
  await sql`CREATE TABLE IF NOT EXISTS job_links (
    thread_id TEXT NOT NULL, order_id BIGINT NOT NULL, r_number TEXT, job_id BIGINT, company_id INTEGER,
    state TEXT NOT NULL DEFAULT 'linked', source TEXT, shifts JSONB,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_checked TIMESTAMPTZ, held_since TIMESTAMPTZ, note TEXT,
    PRIMARY KEY (thread_id, order_id))`;
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
 * OnSinch and no link, because only a bot write made one). It never displaces a live link to
 * another order: the bot's own order stays the thread's until it is gone (0cdb4ec). A held link
 * is an order that is gone, and the found one replaces it.
 */
export async function linkFound(sql: Sql, l: { thread_id: string; order_id: number; source: string }): Promise<"linked" | "same" | "kept"> {
  await ensureLinks(sql);
  const have = (await sql`SELECT order_id, state FROM job_links WHERE thread_id = ${l.thread_id}`) as Array<{ order_id: string | number; state: string }>;
  if (have.some((h) => Number(h.order_id) === l.order_id && h.state !== "held")) return "same";
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

export type SweepReport = { checked: number; linked: number; relinked: number; held: number; notes: string[] };

/** Sweeps A and B over the links not checked in the last minute, oldest first. */
export async function sweepLinks(sql: Sql, limit = 40): Promise<SweepReport> {
  await ensureLinks(sql);
  const t = api();
  const rep: SweepReport = { checked: 0, linked: 0, relinked: 0, held: 0, notes: [] };
  // The TV's own threads first; the jobs board's carried-over tiles take what the minute has left.
  const links = (await sql`SELECT * FROM job_links WHERE state <> 'gone' AND coalesce(last_checked, 'epoch') < now() - interval '50 seconds'
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
