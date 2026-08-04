// ============================================================================
// R&D study: measure the corpus and the engine's behaviour over it.
// ----------------------------------------------------------------------------
// Every claim in the write-up has to come from here, so the numbers can be
// re-derived rather than believed. Read-only: it queries the swept corpus, the
// labels, and OnSinch, and writes nothing anywhere.
//
//   node scripts/rnd-study.mjs            # print every section
//   node scripts/rnd-study.mjs --json     # the same, as JSON for the write-up
// ============================================================================
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const env = readFileSync(`${ROOT}/.env.local`, "utf8");
const g = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
const sql = neon(g("DATABASE_URL").replace(/^"|"$/g, ""));
const MODEL = "anthropic/claude-opus-4.8";
const BEFORE = "anthropic/claude-opus-4.8 (before end-time fix)";
const AS_JSON = process.argv.includes("--json");

const out = {};
const say = (...a) => { if (!AS_JSON) console.log(...a); };

// ---------------------------------------------------------------- 1. the corpus
{
  const [c] = await sql`
    SELECT COUNT(*)::int threads, SUM(message_count)::int messages,
           MIN(first_date) AS from_, MAX(last_date) AS to_
    FROM sweep_threads`;
  const months = await sql`
    SELECT to_char(date_trunc('month', last_date),'YYYY-MM') m, COUNT(*)::int n
    FROM sweep_threads WHERE last_date >= '2025-08-01' GROUP BY 1 ORDER BY 1`;
  const size = await sql`
    SELECT
      COUNT(*) FILTER (WHERE message_count = 1)::int one,
      COUNT(*) FILTER (WHERE message_count BETWEEN 2 AND 4)::int few,
      COUNT(*) FILTER (WHERE message_count BETWEEN 5 AND 10)::int many,
      COUNT(*) FILTER (WHERE message_count > 10)::int long_,
      ROUND(AVG(message_count), 1)::float avg
    FROM sweep_threads`;
  out.corpus = { ...c, months, size: size[0] };
  say(`\n=== 1. CORPUS ===`);
  say(`threads ${c.threads}  messages ${c.messages}  ${String(c.from_).slice(0,10)} .. ${String(c.to_).slice(0,10)}`);
  say(`thread length: 1 msg ${size[0].one} | 2-4 ${size[0].few} | 5-10 ${size[0].many} | >10 ${size[0].long_} | mean ${size[0].avg}`);
}

// ---------------------------------------------------------------- 2. who writes in
{
  const senders = await sql`
    SELECT lower(m.v->>'from') AS addr, COUNT(*)::int n
    FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
    WHERE COALESCE((m.v->>'is_from_spartan')::bool, false) = false
      AND m.v->>'from' <> ''
    GROUP BY 1 ORDER BY n DESC LIMIT 25`;
  const [reach] = await sql`
    SELECT COUNT(DISTINCT lower(m.v->>'from'))::int distinct_senders
    FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
    WHERE COALESCE((m.v->>'is_from_spartan')::bool, false) = false AND m.v->>'from' <> ''`;
  const domains = await sql`
    SELECT split_part(lower(m.v->>'from'), '@', 2) AS domain, COUNT(DISTINCT t.thread_id)::int threads
    FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
    WHERE COALESCE((m.v->>'is_from_spartan')::bool, false) = false AND m.v->>'from' LIKE '%@%'
    GROUP BY 1 ORDER BY threads DESC LIMIT 20`;
  // How much of the year's mail comes from senders we have seen before?
  const [repeat] = await sql`
    WITH s AS (
      SELECT lower(m.v->>'from') addr, COUNT(DISTINCT t.thread_id)::int threads
      FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
      WHERE COALESCE((m.v->>'is_from_spartan')::bool, false) = false AND m.v->>'from' <> ''
      GROUP BY 1)
    SELECT SUM(threads) FILTER (WHERE threads > 1)::int repeat_threads,
           SUM(threads)::int total_threads,
           COUNT(*) FILTER (WHERE threads > 1)::int repeat_senders,
           COUNT(*)::int senders
    FROM s`;
  out.senders = { top: senders, distinct: reach.distinct_senders, domains, repeat };
  say(`\n=== 2. WHO WRITES IN ===`);
  say(`distinct client senders ${reach.distinct_senders}`);
  say(`repeat senders ${repeat.repeat_senders}/${repeat.senders} — they account for ${repeat.repeat_threads}/${repeat.total_threads} thread-appearances`);
  for (const s of senders.slice(0, 8)) say(`  ${String(s.addr).padEnd(42)} ${s.n}`);
}

// ---------------------------------------------------------------- 3. what the engine made of it
{
  const cls = await sql`
    SELECT classification, COUNT(*)::int n FROM sweep_labels WHERE model = ${MODEL}
    GROUP BY 1 ORDER BY n DESC`;
  const [work] = await sql`
    SELECT COUNT(*)::int labelled,
      COUNT(*) FILTER (WHERE jsonb_array_length(blocks) > 0)::int with_blocks,
      COUNT(*) FILTER (WHERE is_cancellation)::int cancellations,
      COUNT(*) FILTER (WHERE crew_peak > 0)::int with_crew,
      COUNT(*) FILTER (WHERE company_name IS NOT NULL AND company_name <> '')::int with_company,
      COUNT(*) FILTER (WHERE location_text IS NOT NULL AND location_text <> '')::int with_venue
    FROM sweep_labels WHERE model = ${MODEL} AND error IS NULL`;
  const junk = await sql`
    SELECT COUNT(*)::int junk,
      COUNT(*) FILTER (WHERE crew_peak > 0)::int junk_with_crew
    FROM sweep_labels WHERE model = ${MODEL} AND classification = 'not-a-job'`;
  out.classification = { cls, work, junk: junk[0] };
  say(`\n=== 3. WHAT THE ENGINE MADE OF IT (sample of ${work.labelled}) ===`);
  for (const c of cls) say(`  ${String(c.classification).padEnd(20)} ${c.n}`);
  say(`with blocks ${work.with_blocks} | crew ${work.with_crew} | company ${work.with_company} | venue ${work.with_venue} | cancellations ${work.cancellations}`);
}

// ---------------------------------------------------------------- 4. completeness of a job
{
  const rows = await sql`
    SELECT classification, is_cancellation, company_name, location_text, crew_peak, blocks, last_end
    FROM sweep_labels WHERE model = ${MODEL} AND error IS NULL`;
  let job = 0, full = 0;
  const missing = { date: 0, size: 0, company: 0, venue: 0 };
  const combos = {};
  for (const r of rows) {
    const blocks = r.blocks || [];
    const dated = blocks.some((b) => b.date_confirmed);
    const isJob = r.classification === "new-job" || r.classification === "update";
    if (r.is_cancellation) continue;
    if (!isJob && !(dated && (r.crew_peak ?? 0) > 0)) continue;
    job++;
    const has = {
      date: dated,
      size: (r.crew_peak ?? 0) > 0,
      company: !!(r.company_name || "").trim(),
      venue: !!(r.location_text || "").trim(),
    };
    for (const k of Object.keys(has)) if (!has[k]) missing[k]++;
    const gapKey = Object.keys(has).filter((k) => !has[k]).join("+") || "(none)";
    combos[gapKey] = (combos[gapKey] || 0) + 1;
    if (Object.values(has).every(Boolean)) full++;
  }
  out.completeness = { job, full, missing, combos };
  say(`\n=== 4. COMPLETENESS ===`);
  say(`real jobs ${job} | composable as-is ${full} (${Math.round((full / job) * 100)}%)`);
  say(`missing: date ${missing.date} | size ${missing.size} | company ${missing.company} | venue ${missing.venue}`);
  say(`gap combinations: ${JSON.stringify(combos)}`);
}

// ---------------------------------------------------------------- 5. the end-time fix, before/after
{
  const [cmp] = await sql`
    SELECT COUNT(*)::int n,
      COUNT(*) FILTER (WHERE to_char(a.last_end AT TIME ZONE 'Europe/London','HH24:MI')='18:00')::int before18,
      COUNT(*) FILTER (WHERE to_char(b.last_end AT TIME ZONE 'Europe/London','HH24:MI')='18:00')::int after18,
      COUNT(*) FILTER (WHERE a.last_end <> b.last_end)::int changed
    FROM sweep_labels a JOIN sweep_labels b
      ON a.thread_id = b.thread_id AND a.model = ${BEFORE} AND b.model = ${MODEL}
    WHERE a.last_end IS NOT NULL AND b.last_end IS NOT NULL`;
  out.endTimes = cmp;
  say(`\n=== 5. END TIMES ===`);
  say(`comparable ${cmp.n} | defaulted before ${cmp.before18} | after ${cmp.after18} | changed ${cmp.changed}`);
}

// ---------------------------------------------------------------- 6. shift shapes actually requested
{
  const shapes = await sql`
    SELECT
      to_char(first_start AT TIME ZONE 'Europe/London','HH24') AS hour,
      COUNT(*)::int n
    FROM sweep_labels WHERE model = ${MODEL} AND first_start IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const lengths = await sql`
    SELECT width_bucket(EXTRACT(EPOCH FROM (last_end - first_start))/3600, 0, 24, 8) AS bucket,
           COUNT(*)::int n
    FROM sweep_labels WHERE model = ${MODEL} AND first_start IS NOT NULL AND last_end IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const [crew] = await sql`
    SELECT ROUND(AVG(crew_peak),1)::float avg, MAX(crew_peak)::int max,
      COUNT(*) FILTER (WHERE crew_peak = 1)::int one,
      COUNT(*) FILTER (WHERE crew_peak BETWEEN 2 AND 4)::int small,
      COUNT(*) FILTER (WHERE crew_peak BETWEEN 5 AND 10)::int mid,
      COUNT(*) FILTER (WHERE crew_peak > 10)::int big
    FROM sweep_labels WHERE model = ${MODEL} AND crew_peak > 0`;
  const [multi] = await sql`
    SELECT COUNT(*) FILTER (WHERE jsonb_array_length(blocks) > 1)::int multi_block,
           COUNT(*) FILTER (WHERE jsonb_array_length(blocks) = 1)::int single_block
    FROM sweep_labels WHERE model = ${MODEL} AND jsonb_array_length(blocks) > 0`;
  out.shapes = { startHours: shapes, lengths, crew, multi };
  say(`\n=== 6. WHAT THE WORK LOOKS LIKE ===`);
  say(`crew: mean ${crew.avg}, max ${crew.max} | 1 ${crew.one} | 2-4 ${crew.small} | 5-10 ${crew.mid} | >10 ${crew.big}`);
  say(`blocks per job: single ${multi.single_block} | multiple ${multi.multi_block}`);
}

// ---------------------------------------------------------------- 7. lead time
{
  const lead = await sql`
    SELECT width_bucket(EXTRACT(EPOCH FROM (l.first_start - t.first_date))/86400, -1, 30, 6) AS bucket,
           COUNT(*)::int n
    FROM sweep_labels l JOIN sweep_threads t ON t.thread_id = l.thread_id
    WHERE l.model = ${MODEL} AND l.first_start IS NOT NULL AND t.first_date IS NOT NULL
    GROUP BY 1 ORDER BY 1`;
  const [urgent] = await sql`
    SELECT COUNT(*) FILTER (WHERE l.first_start - t.first_date < INTERVAL '24 hours')::int within_24h,
           COUNT(*) FILTER (WHERE l.first_start - t.first_date < INTERVAL '72 hours')::int within_72h,
           COUNT(*)::int total
    FROM sweep_labels l JOIN sweep_threads t ON t.thread_id = l.thread_id
    WHERE l.model = ${MODEL} AND l.first_start IS NOT NULL AND t.first_date IS NOT NULL`;
  out.leadTime = { lead, urgent };
  say(`\n=== 7. LEAD TIME (enquiry -> shift start) ===`);
  say(`within 24h ${urgent.within_24h}/${urgent.total} | within 72h ${urgent.within_72h}/${urgent.total}`);
}

// ---------------------------------------------------------------- 8. OnSinch coverage
{
  const KEY = g("ONSINCH_API_KEY"), BASE = g("ONSINCH_BASE_URL");
  const get = async (p) => {
    const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `apikey ${KEY}`, "Content-Type": "application/json" } });
    return r.ok ? r.json() : null;
  };
  const first = await get("/orders?limit=1&with=Job");
  const total = first?.pagination?.count ?? 0;
  // A year of orders, for the ratio against a year of enquiry threads.
  const orders = [];
  for (let page = 1; page <= 40; page++) {
    const j = await get(`/orders?limit=100&page=${page}&with=Job`);
    const rows = j?.data ?? [];
    orders.push(...rows);
    if (rows.length < 100) break;
    if (Date.parse(rows[rows.length - 1].created) < Date.parse("2025-08-01")) break;
  }
  const inYear = orders.filter((o) => Date.parse(o.created) >= Date.parse("2025-08-01"));
  const withJob = inYear.filter((o) => (o.Job || []).length > 0).length;
  const provisional = inYear.filter((o) => o.provisional).length;
  const quote = inYear.filter((o) => o.quote).length;
  out.onsinch = { total, pulled: orders.length, inYear: inYear.length, withJob, provisional, quote };
  say(`\n=== 8. ONSINCH ===`);
  say(`orders total ${total} | created since Aug 2025 ${inYear.length} | with a Job row ${withJob} | provisional ${provisional} | quote ${quote}`);
}

// ---------------------------------------------------------------- 9. cost of a pass
{
  const [n] = await sql`SELECT COUNT(*)::int threads FROM sweep_threads`;
  out.cost = {
    threads: n.threads,
    callsPerThread: 3,
    callsFullPass: n.threads * 3,
    note: "classify + extract + cancellation probe; the deferral rule adds a 4th on rejected threads",
  };
  say(`\n=== 9. COST OF A FULL PASS ===`);
  say(`${n.threads} threads x 3 model calls = ${n.threads * 3} calls`);
}

// ---------------------------------------------------------------- 10. who does the talking
{
  const [split] = await sql`
    SELECT COUNT(*)::int messages,
      COUNT(*) FILTER (WHERE (m.v->>'is_from_spartan')::bool)::int from_spartan,
      COUNT(*) FILTER (WHERE NOT COALESCE((m.v->>'is_from_spartan')::bool, false))::int from_client
    FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)`;
  out.talk = split;
  say(`
=== 10. WHO DOES THE TALKING ===`);
  say(`messages ${split.messages} | from Spartan ${split.from_spartan} | from clients ${split.from_client}`);
}

// ---------------------------------------------------------------- 11. reply latency
{
  // Time from a client's message to Spartan's next message in the same thread. This is
  // the human cost the tool is meant to remove, so it bounds the prize.
  const [lat] = await sql`
    WITH msgs AS (
      SELECT t.thread_id,
             (m.v->>'date_iso')::timestamptz AS at,
             COALESCE((m.v->>'is_from_spartan')::bool, false) AS spartan
      FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
      WHERE m.v->>'date_iso' <> ''
    ), pairs AS (
      SELECT c.thread_id, c.at AS asked,
             MIN(s.at) AS answered
      FROM msgs c JOIN msgs s ON s.thread_id = c.thread_id AND s.spartan AND s.at > c.at
      WHERE NOT c.spartan
      GROUP BY 1, 2
    )
    SELECT COUNT(*)::int pairs,
      ROUND(AVG(EXTRACT(EPOCH FROM (answered - asked))/60))::int mean_minutes,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (answered - asked))/60))::int median_minutes,
      COUNT(*) FILTER (WHERE answered - asked < INTERVAL '15 minutes')::int within_15m,
      COUNT(*) FILTER (WHERE answered - asked > INTERVAL '4 hours')::int over_4h
    FROM pairs`;
  out.latency = lat;
  say(`
=== 11. REPLY LATENCY (client message -> Spartan reply) ===`);
  say(`pairs ${lat.pairs} | median ${lat.median_minutes} min | mean ${lat.mean_minutes} min | <15min ${lat.within_15m} | >4h ${lat.over_4h}`);
}

// ---------------------------------------------------------------- 12. what a sender's history could fill
{
  // The venue/company gaps are only fillable if the same sender has written before AND
  // an earlier thread of theirs names a venue. This measures the ceiling of that idea
  // rather than assuming it.
  const [hist] = await sql`
    WITH sender AS (
      SELECT t.thread_id, lower(m.v->>'from') AS addr, t.first_date
      FROM sweep_threads t, jsonb_array_elements(t.payload->'messages') AS m(v)
      WHERE NOT COALESCE((m.v->>'is_from_spartan')::bool, false) AND m.v->>'from' <> ''
    ), labelled AS (
      SELECT l.thread_id, l.location_text, l.company_name
      FROM sweep_labels l WHERE l.model = ${MODEL} AND l.error IS NULL
    )
    SELECT
      COUNT(*) FILTER (WHERE (lb.location_text IS NULL OR lb.location_text = ''))::int missing_venue,
      COUNT(*) FILTER (WHERE (lb.location_text IS NULL OR lb.location_text = '')
                         AND EXISTS (SELECT 1 FROM sender s2 WHERE s2.addr = s.addr AND s2.thread_id <> s.thread_id))::int missing_venue_with_history
    FROM labelled lb JOIN sender s ON s.thread_id = lb.thread_id`;
  out.history = hist;
  say(`
=== 12. WHAT A SENDER'S OWN HISTORY COULD FILL ===`);
  say(`labelled threads missing a venue ${hist.missing_venue} | of those, the sender has written before ${hist.missing_venue_with_history}`);
}

if (AS_JSON) console.log(JSON.stringify(out, null, 1));
