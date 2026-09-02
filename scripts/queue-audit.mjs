// What the dashboard's four tiles are actually holding.
//
// The tiles count what a ticket's flags SAY, not what is true in OnSinch, and the
// two diverge: a thread whose order was written keeps `needs_human` until somebody
// clears it, so the needs-human tile is mostly finished work. This splits each tile
// on the one question that decides whether there is anything left to do —
// is there an order in OnSinch for this thread?
//
// Read-only.  node scripts/queue-audit.mjs
import { sql } from './_q.mjs';

const DISMISSED = `(classification = 'not-a-job' OR status = 'ignored' OR is_client_inquiry = false)`;

const tiles = (await sql`
  SELECT
    count(*) FILTER (WHERE NOT dismissed)                                        AS live,
    count(*) FILTER (WHERE NOT dismissed AND status = 'proposed' AND NOT flagged) AS awaiting_confirm,
    count(*) FILTER (WHERE NOT dismissed AND flagged AND status <> 'error')       AS needs_human,
    count(*) FILTER (WHERE NOT dismissed AND onsinch_order_id IS NOT NULL)        AS with_order,
    count(*) FILTER (WHERE NOT dismissed AND status = 'error')                    AS failed,
    count(*) FILTER (WHERE dismissed)                                             AS dismissed,
    count(*)                                                                      AS total
  FROM (
    SELECT status, onsinch_order_id,
           (classification = 'not-a-job' OR status = 'ignored' OR is_client_inquiry = false) AS dismissed,
           (needs_human OR status = 'needs-info') AS flagged
    FROM tickets) t`)[0];
console.log('\nTILES', tiles);

const split = async (label, where) => {
  const rows = await sql(`
    select onsinch_order_number, status, notes, updated_at, subject
    from tickets where ${where}`);
  const booked = rows.filter((r) => r.onsinch_order_number).length;
  console.log(`\n${label}: ${rows.length}`);
  console.log(`  an order exists in OnSinch  ${booked}`);
  console.log(`  nothing booked              ${rows.length - booked}`);
  const t = {};
  for (const r of rows) {
    const notes = Array.isArray(r.notes) ? r.notes : [];
    const flagish = notes.filter((n) => /held|missing|not recognised|NOT BOOKED|no company|ambiguous|pick|cannot|failed|assumed|by hand|which|unknown/i.test(String(n)));
    const last = flagish[flagish.length - 1] ?? notes[notes.length - 1] ?? '(no notes)';
    const key = String(last).replace(/"[^"]*"/g, '"…"').replace(/\d+/g, 'N').slice(0, 96);
    (t[key] ||= 0), (t[key] += 1);
  }
  for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`   ${String(n).padStart(4)}  ${k}`);
  }
};

await split('NEEDS HUMAN', `NOT ${DISMISSED} and (needs_human or status='needs-info') and status <> 'error'`);
await split('AWAITING CONFIRM', `NOT ${DISMISSED} and status='proposed' and not (needs_human or status='needs-info')`);
await split('FAILED', `NOT ${DISMISSED} and status='error'`);

const dis = await sql`
  select classification, status, is_client_inquiry, count(*)::int c
  from tickets where classification='not-a-job' or status='ignored' or is_client_inquiry=false
  group by 1,2,3 order by c desc`;
console.log('\nDISMISSED, by the three conditions that dismiss:');
for (const r of dis) console.log(`   ${String(r.c).padStart(4)}  classification=${r.classification} status=${r.status} is_client_inquiry=${r.is_client_inquiry}`);

const senders = await sql`
  select count(*)::int c,
         (select from_address from thread_messages m where m.thread_id=t.thread_id order by date_iso limit 1) sender
  from tickets t group by 2 order by 1 desc limit 8`;
console.log('\nTOP ORIGINATING SENDERS ON THE BOARD (test traffic shows up here):');
for (const s of senders) console.log(`   ${String(s.c).padStart(4)}  ${s.sender}`);
