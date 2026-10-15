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
    const have = (await sql`SELECT 1 FROM job_links WHERE thread_id = ${r.thread_id} AND order_id = ${Number(r.order_id)}`) as any[];
    if (have.length) continue;
    await recordLink(sql, { thread_id: r.thread_id, order_id: Number(r.order_id), company_id: r.company_id, source: "backfill" });
    n++;
  }
  return n;
}

export type SweepReport = { checked: number; linked: number; relinked: number; held: number; notes: string[] };

/** Sweeps A and B over the links not checked in the last minute, oldest first. */
export async function sweepLinks(sql: Sql, limit = 40): Promise<SweepReport> {
  await ensureLinks(sql);
  const t = api();
  const rep: SweepReport = { checked: 0, linked: 0, relinked: 0, held: 0, notes: [] };
  const links = (await sql`SELECT * FROM job_links WHERE coalesce(last_checked, 'epoch') < now() - interval '50 seconds' ORDER BY coalesce(last_checked, 'epoch') LIMIT ${limit}`) as any[];
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
