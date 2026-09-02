// ============================================================================
// IS EVERY BOOKED TIME THE TIME THE CLIENT ASKED FOR?
// ----------------------------------------------------------------------------
// Ben, 2026-09-02, on the Labour Fringe order: asked for 09:00-15:00, booked as
// 10:00 for six hours, corrected by hand. "I think we need to clearly verify every
// single time is correct."
//
// THE ONE MEASUREMENT THIS RESTS ON. A probe on TEST company 515
// (scripts/probe-onsinch-clock.ts) sent 09:00-17:00 stamped "+00:00" on a BST date
// and read the window back as 09:00-17:00: OnSinch stores the stamp VERBATIM. The
// UI then renders it in London. So a wall clock stamped "+00:00" in British Summer
// Time is displayed an hour late, and `last_ordered_teams` - the shape the engine
// sent - is also what OnSinch holds, unless a person has since edited it.
//
// That is what makes a per-BLOCK audit possible at all. There is no GET /slotTeams,
// so the live tenant will only tell you an order's earliest start and latest finish
// (`Job.min_beginning` / `Job.max_end`). Those two bound the order and are used here
// for exactly one thing: detecting that a human has moved something.
//
// THREE CHECKS, and they fail for different reasons:
//
//   CLOCK   the offset on each block matches Europe/London for that block's date.
//           Deterministic and complete. A "+00:00" on a BST date is an hour late.
//
//   READING every wall clock the engine booked appears as a time in the thread the
//           client wrote. Catches a time that was invented or misread rather than
//           merely mis-stamped. It cannot prove the pairing of a start to a finish,
//           so it is reported as "not found in the thread", never as "wrong".
//
//   DRIFT   the live window against the window we sent. A difference means somebody
//           edited the order in OnSinch, so our record of it is stale.
//
// Read-only. Nothing here writes to OnSinch or to the database.
//
//   node scripts/verify-times.mjs                 # every order, summary + failures
//   node scripts/verify-times.mjs --all           # print every order, passes too
//   node scripts/verify-times.mjs --future        # only jobs that have not happened
// ============================================================================
import { sql } from './_q.mjs';
import { loadEnv, requireEnv, onsinchGet } from './_env.mjs';

loadEnv();
const KEY = requireEnv('ONSINCH_API_KEY');
const SHOW_ALL = process.argv.includes('--all');
const FUTURE_ONLY = process.argv.includes('--future');
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- the clock
/** London's offset in minutes at a given instant, from the IANA zone. */
function londonOffsetMinutes(utcMs) {
  const p = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return (asIfUtc - utcMs) / 60000;
}

/** The offset a London wall clock carries. Two passes, so a spring-forward is right. */
function offsetFor(day, hm) {
  const wall = Date.parse(`${day}T${hm}:00Z`);
  if (!Number.isFinite(wall)) return null;
  const first = londonOffsetMinutes(wall);
  return londonOffsetMinutes(wall - first * 60000);
}

const fmtOffset = (mins) => {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

/** "2026-09-24T09:00:00+00:00" -> { day, hm, offMins } */
function parseStamp(s) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}([+-])(\d{2}):(\d{2})$/.exec(String(s));
  if (!m) return null;
  const offMins = (m[3] === '-' ? -1 : 1) * (Number(m[4]) * 60 + Number(m[5]));
  return { day: m[1], hm: m[2], offMins };
}

// --------------------------------------------------------------- the reading
/**
 * Every clock time written anywhere in the thread, normalised to HH:MM.
 *
 * Deliberately generous - "9am", "9.00", "0900", "9:00-5pm" all count - because a
 * false ALARM here costs a person a look at a correct order, while a missed one
 * hides a misread time. The 12-hour forms are recorded in both readings when the
 * meridiem is absent, since "booked at 9" is 09:00 and nobody books 21:00 crew calls
 * without saying so.
 */
function timesInText(text) {
  const out = new Set();
  const t = String(text || '');
  const add = (h, m, mer) => {
    let hh = Number(h);
    if (mer === 'pm' && hh < 12) hh += 12;
    if (mer === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 24) out.add(`${String(hh % 24).padStart(2, '0')}:${m}`);
    // No meridiem on a bare 1-12: record the afternoon reading too.
    if (!mer && Number(h) >= 1 && Number(h) <= 12) {
      const pm = (Number(h) % 12) + 12;
      out.add(`${String(pm).padStart(2, '0')}:${m}`);
    }
  };
  // 09:00 / 9.00 / 9h00, optional am|pm
  for (const m of t.matchAll(/\b(\d{1,2})[:.h](\d{2})\s*(am|pm)?/gi)) add(m[1], m[2], m[3]?.toLowerCase());
  // 9am / 5 pm
  for (const m of t.matchAll(/\b(\d{1,2})\s*(am|pm)\b/gi)) add(m[1], '00', m[2].toLowerCase());
  // 0900 / 1730, four digits that look like a clock
  for (const m of t.matchAll(/\b([01]\d|2[0-3])([0-5]\d)\b/g)) out.add(`${m[1]}:${m[2]}`);
  return out;
}

// ------------------------------------------------------------------ the data
const rows = await sql`
  select c.thread_id,
         c.state->>'subject' subject,
         c.state->>'onsinch_order_id' order_id,
         c.state->>'onsinch_order_number' order_number,
         c.state->'last_ordered_teams' teams,
         c.state->'order_action_log' log
  from conversation_state c
  where c.state->>'onsinch_order_id' is not null
    and c.state->'last_ordered_teams' is not null`;

const bodies = new Map();
for (const r of await sql`
  select thread_id, string_agg(coalesce(body, ''), ' ') body
  from thread_messages group by thread_id`) bodies.set(r.thread_id, r.body);

/**
 * The live orders. Read in bulk first, then anything still missing is fetched BY ID.
 *
 * The bulk list cannot be trusted to be complete: `GET /orders?page=N` is ordered
 * `Order.id DESC` but the pages are not contiguous runs — page 1 of a 100-row read
 * spanned 15764 down to 13782 and later pages came back with ids in the 6000s — so
 * 52 of 148 engine orders were absent from a 2500-row sweep. Reported off the sweep
 * alone that reads as "deleted in OnSinch", which for a booking is the most alarming
 * thing this script can say and it would have been wrong for most of them.
 */
const live = new Map();
const wanted = new Set(rows.map((r) => Number(r.order_id)).filter(Number.isInteger));
for (let page = 1; page <= 25; page++) {
  const r = await onsinchGet(`/orders?limit=100&page=${page}&with=Job`, KEY);
  const d = r?.data || [];
  if (!d.length) break;
  for (const o of d) {
    if (!wanted.has(Number(o.id))) continue;
    const j = Array.isArray(o.Job) ? o.Job[0] : o.Job;
    live.set(Number(o.id), { min: j?.min_beginning, max: j?.max_end, modified: o.modified, created: o.created });
  }
}
const stillMissing = [...wanted].filter((id) => !live.has(id));
for (const id of stillMissing) {
  const r = await onsinchGet(`/orders?id=${id}&with=Job`, KEY).catch(() => null);
  const o = r?.data?.[0];
  if (!o) continue; // genuinely gone
  const j = Array.isArray(o.Job) ? o.Job[0] : o.Job;
  live.set(Number(o.id), { min: j?.min_beginning, max: j?.max_end, modified: o.modified, created: o.created });
}
console.log(`live read: ${live.size} of ${wanted.size} engine orders found (${stillMissing.length} needed a direct lookup)`);

// ----------------------------------------------------------------- the audit
const verdicts = [];
for (const r of rows) {
  const teams = Array.isArray(r.teams) ? r.teams : [];
  if (!teams.length) continue;
  const stamps = teams.flatMap((t) => [parseStamp(t.beginning), parseStamp(t.end)]).filter(Boolean);
  if (!stamps.length) continue;
  const firstDay = stamps.map((s) => s.day).sort()[0];
  if (FUTURE_ONLY && firstDay < TODAY) continue;

  const lateBy = [];   // blocks whose stamp is displayed at the wrong hour
  for (const t of teams) {
    for (const [edge, raw] of [['start', t.beginning], ['end', t.end]]) {
      const p = parseStamp(raw);
      if (!p) continue;
      const want = offsetFor(p.day, p.hm);
      if (want === null || want === p.offMins) continue;
      /**
       * How wrong the DISPLAYED hour is, and the sign matters.
       *
       * We send a wall clock W with offset S, so the instant is W-S. OnSinch stores
       * that verbatim and renders it in London, at the correct offset C — so it shows
       * W - S + C, i.e. W plus (C - S). Stamping BST with "+00:00" makes C-S = +1h and
       * the job is displayed an HOUR LATE. Getting this sign backwards prints a
       * reassuring "shows 08:00" for a job the client will turn up to at 09:00.
       */
      const driftH = (want - p.offMins) / 60;
      lateBy.push({ edge, day: p.day, asked: p.hm, sent: fmtOffset(p.offMins), want: fmtOffset(want), driftH });
    }
  }

  const seen = timesInText(bodies.get(r.thread_id));
  const unseen = [];
  for (const t of teams) {
    for (const raw of [t.beginning, t.end]) {
      const p = parseStamp(raw);
      if (p && !seen.has(p.hm)) unseen.push(p.hm);
    }
  }

  const lv = live.get(Number(r.order_id));
  const sentMin = stamps.map((s) => `${s.day}T${s.hm}`).sort()[0];
  const sentMax = stamps.map((s) => `${s.day}T${s.hm}`).sort().slice(-1)[0];
  let drift = null;
  if (lv?.min) {
    const liveMin = String(lv.min).slice(0, 16);
    const liveMax = String(lv.max).slice(0, 16);
    if (liveMin !== sentMin || liveMax !== sentMax) drift = { liveMin, liveMax, sentMin, sentMax };
  }

  verdicts.push({
    order: r.order_number ? `R${r.order_number}` : `#${r.order_id}`,
    order_id: Number(r.order_id),
    subject: r.subject,
    day: firstDay,
    blocks: teams.length,
    gone: !lv,
    lateBy,
    unseen: [...new Set(unseen)],
    drift,
  });
}

// ------------------------------------------------------------------- report
const clockBad = verdicts.filter((v) => v.lateBy.length);
const readingBad = verdicts.filter((v) => v.unseen.length);
const drifted = verdicts.filter((v) => v.drift);
const gone = verdicts.filter((v) => v.gone);

console.log(`\n${verdicts.length} engine-written orders with a recorded shape${FUTURE_ONLY ? ', today onward' : ''}`);
console.log(`  CLOCK   wrong offset on at least one edge   ${clockBad.length}`);
console.log(`  READING a booked time is not in the thread  ${readingBad.length}`);
console.log(`  DRIFT   live window differs from what we sent ${drifted.length}`);
console.log(`  GONE    order no longer exists in OnSinch    ${gone.length}`);

if (clockBad.length) {
  console.log(`\n── CLOCK ─ every one of these is displayed at the wrong hour in OnSinch ──`);
  for (const v of clockBad.sort((a, b) => a.day.localeCompare(b.day))) {
    const past = v.day < TODAY ? ' (already happened)' : '';
    const d = v.lateBy[0].driftH;
    console.log(`  ${v.order.padEnd(8)} ${v.day}  ${v.lateBy.length}/${v.blocks * 2} edges ${d > 0 ? d : -d}h ${d > 0 ? 'LATE' : 'EARLY'}${past}  ${String(v.subject).slice(0, 52)}`);
    for (const e of v.lateBy.slice(0, 6)) {
      const shows = `${String((Number(e.asked.slice(0, 2)) + e.driftH + 24) % 24).padStart(2, '0')}:${e.asked.slice(3)}`;
      console.log(`           ${e.day} ${e.edge.padEnd(5)} client asked ${e.asked} — sent ${e.sent}, should be ${e.want} — OnSinch shows ${shows}`);
    }
    if (v.lateBy.length > 6) console.log(`           … ${v.lateBy.length - 6} more edges`);
  }
}

if (readingBad.length) {
  console.log(`\n── READING ─ a booked wall clock that does not appear in the client's words ──`);
  console.log(`   (a start with no stated finish is defaulted to 18:00 by design, so 18:00 here is usually that)`);
  for (const v of readingBad.sort((a, b) => a.day.localeCompare(b.day))) {
    console.log(`  ${v.order.padEnd(8)} ${v.day}  not in thread: ${v.unseen.join(', ')}  ${String(v.subject).slice(0, 46)}`);
  }
}

if (drifted.length) {
  console.log(`\n── DRIFT ─ somebody moved these in OnSinch; our record is stale ──`);
  for (const v of drifted.sort((a, b) => a.day.localeCompare(b.day))) {
    console.log(`  ${v.order.padEnd(8)} sent ${v.drift.sentMin}..${v.drift.sentMax}  live ${v.drift.liveMin}..${v.drift.liveMax}  ${String(v.subject).slice(0, 40)}`);
  }
}

if (gone.length) {
  console.log(`\n── GONE ─ no order exists at the id we recorded ──`);
  console.log(`   Not verifiable and not amendable: this is the same condition behind the`);
  console.log(`   live "patchOrder 400: Records with specified IDs not found" failures.`);
  for (const v of gone.sort((a, b) => a.day.localeCompare(b.day))) {
    console.log(`  ${v.order.padEnd(8)} #${v.order_id} ${v.day}  ${String(v.subject).slice(0, 54)}`);
  }
}

/**
 * THE REPAIR LIST. The only rows where a fix is both needed and possible: the order
 * still exists, the job has not happened yet, and its window is displayed at the wrong
 * hour. Everything else is either history or a record pointing at nothing.
 */
const live_wrong = verdicts.filter((v) => !v.gone && v.lateBy.length && v.day >= TODAY);
/**
 * Split on whether the live window still equals the instant we sent. Where it does,
 * nobody has touched it and the whole order is an hour out. Where it does not, someone
 * has already moved something — and because there is no GET /slotTeams, min/max cannot
 * say WHICH blocks, so those need a person's eyes rather than a bulk correction. The
 * Labour Fringe order is the case in point: its first block was corrected by hand and
 * its other two were not.
 */
const untouched = live_wrong.filter((v) => !v.drift);
const partly = live_wrong.filter((v) => v.drift);

console.log(`\n── REPAIR ─ still to come, wrong hour, and nobody has touched it: ${untouched.length} ──`);
for (const v of untouched.sort((a, b) => a.day.localeCompare(b.day))) {
  const days = [...new Set(v.lateBy.map((e) => e.day))].join(', ');
  console.log(`  #${String(v.order_id).padEnd(6)} ${v.order.padEnd(8)} ${v.blocks}b on ${days}  every block ${Math.abs(v.lateBy[0].driftH)}h late`);
  console.log(`           ${String(v.subject).slice(0, 70)}`);
}

console.log(`\n── PART-FIXED ─ still to come, wrong hour, but someone has already moved it: ${partly.length} ──`);
console.log(`   min/max cannot say which blocks were fixed. Each of these needs looking at.`);
for (const v of partly.sort((a, b) => a.day.localeCompare(b.day))) {
  console.log(`  #${String(v.order_id).padEnd(6)} ${v.order.padEnd(8)} ${v.blocks}b  sent ${v.drift.sentMin}..${v.drift.sentMax}  live ${v.drift.liveMin}..${v.drift.liveMax}`);
  console.log(`           ${String(v.subject).slice(0, 70)}`);
}

if (SHOW_ALL) {
  console.log(`\n── EVERY ORDER ──`);
  for (const v of verdicts.sort((a, b) => a.day.localeCompare(b.day))) {
    const tags = [v.lateBy.length && 'CLOCK', v.unseen.length && 'READING', v.drift && 'DRIFT', v.gone && 'GONE'].filter(Boolean);
    console.log(`  ${v.order.padEnd(8)} ${v.day} ${String(v.blocks).padStart(2)}b  ${(tags.join('+') || 'ok').padEnd(20)} ${String(v.subject).slice(0, 50)}`);
  }
}
