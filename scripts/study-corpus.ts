// ============================================================================
// Score the engine against the OnSinch jobs the enquiries actually became.
// ----------------------------------------------------------------------------
// Match on SPAN, CREW and SLOT-TEAM COUNT (Ben's rules; rate is deliberately out
// and is not folded in as a tiebreak).
//
// WHAT CAN AND CANNOT BE SCORED, established before any number was produced:
//   span            — scorable. Order.happening and Job.min_beginning/max_end read fine.
//   crew            — NOT scorable with this API key. Crew size lives on SlotTeams and
//                     GET /slot_teams returns 405; nothing on the order or Job carries
//                     a number. Needs read permission on slot teams.
//   slot-team count — NOT scorable, same wall. Job is not a proxy: 99 of 100 sampled
//                     orders have exactly one Job, while a setup and a takedown are two
//                     slot teams inside it.
// Rather than quietly scoring one thing and implying three, the unscorable two are
// counted and reported as blocked.
//
// THE JOIN. Company + date + creation proximity:
//   - the label's company_name resolved against OnSinch's company list, normalised
//     exact first, then token-overlap fuzzy at >= 0.6;
//   - candidate orders are that company's, with happening within +/- 1 day of the
//     label's first block date, and created between the thread's first message and
//     its last message + 14 days;
//   - several candidates -> the one created nearest the thread's last message, flagged
//     ambiguous; none -> "no job at all", which is the miss that matters most under
//     "all jobs that can be created should be created".
//
// SPAN TOLERANCE is +/- 60 minutes on each end, both ends must pass. An hour because
// the engine's own default is 08:00/18:00 when the client gives no time, so a tighter
// tolerance would be scoring the default rather than the reading.
//
//   npx tsx scripts/study-corpus.ts            # score every labelled thread
//   npx tsx scripts/study-corpus.ts --limit 50 # a slice, for a quick look
// ============================================================================
import { loadEnv, requireEnv } from "./_env.mjs";
import { neon } from "@neondatabase/serverless";

loadEnv();
const argv = process.argv.slice(2);
const LIMIT = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) || 0 : 0;
const KEY = requireEnv("ONSINCH_API_KEY");
const BASE = requireEnv("ONSINCH_BASE_URL");
const SPAN_TOLERANCE_MS = 60 * 60_000;
const DAY = 86_400_000;

const sql = neon(requireEnv("DATABASE_URL").replace(/^"|"$/g, ""));

async function onsinch(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `apikey ${KEY}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json();
}

/** Every order in the tenant, with its Job rows. Newest first; paged to the end. */
async function allOrders(): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 80; page++) {
    const j = await onsinch(`/orders?limit=100&page=${page}&with=Job`);
    const rows = Array.isArray(j?.data) ? j.data : [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

async function allCompanies(): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const j = await onsinch(`/companies?limit=100&page=${page}`);
    const rows = Array.isArray(j?.data) ? j.data : [];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\b(ltd|limited|llp|plc|uk|group|holdings|the|and|&)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function tokenOverlap(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

interface Label {
  thread_id: string;
  classification: string | null;
  is_cancellation: boolean;
  company_name: string | null;
  first_start: string | null;
  last_end: string | null;
  crew_peak: number | null;
  blocks: Array<{ beginning: string; end: string; size?: number; date_confirmed: boolean }>;
  first_date: string | null;
  last_date: string | null;
}

async function main() {
  const labels = (await sql`
    SELECT l.thread_id, l.classification, l.is_cancellation, l.company_name,
           l.first_start, l.last_end, l.crew_peak, l.blocks,
           t.first_date, t.last_date
    FROM sweep_labels l JOIN sweep_threads t ON t.thread_id = l.thread_id
    WHERE l.error IS NULL AND l.model = 'anthropic/claude-opus-4.8' 
    ORDER BY t.last_date DESC`) as unknown as Label[];

  const set = LIMIT ? labels.slice(0, LIMIT) : labels;
  console.log(`\n${set.length} labelled thread(s) to score\n`);

  // The classifier finding, over everything labelled — this needs no OnSinch at all.
  const junkWithWork = set.filter(
    (l) => l.classification === "not-a-job" && (l.blocks || []).some((b) => b.date_confirmed) && (l.crew_peak ?? 0) > 0
  );
  const junkWithDatedBlock = set.filter(
    (l) => l.classification === "not-a-job" && (l.blocks || []).some((b) => b.date_confirmed)
  );
  const junk = set.filter((l) => l.classification === "not-a-job");

  console.log("CLASSIFIER vs EXTRACTOR (no OnSinch needed)");
  console.log(`  labelled not-a-job                        ${junk.length}/${set.length}`);
  console.log(`  ...of those, with a dated work block      ${junkWithDatedBlock.length}`);
  console.log(`  ...of those, with a dated block AND crew  ${junkWithWork.length}`);
  const rate = junk.length ? Math.round((junkWithWork.length / junk.length) * 100) : 0;
  console.log(`  rate: ${rate}% of not-a-job threads carry a usable crew number and a dated block\n`);

  // Only threads the engine considered real work can be paired to an order.
  const scorable = set.filter(
    (l) => (l.classification === "new-job" || l.classification === "update") && !l.is_cancellation && (l.blocks || []).some((b) => b.date_confirmed)
  );
  console.log(`SCORING ${scorable.length} thread(s) the engine called real work with a dated block`);
  if (!scorable.length) {
    console.log("  nothing to pair yet — label more of the corpus first.\n");
    return;
  }

  console.log("  pulling OnSinch orders and companies …");
  const [orders, companies] = await Promise.all([allOrders(), allCompanies()]);
  console.log(`  ${orders.length} order(s), ${companies.length} companies\n`);

  const byCompany = new Map<number, any[]>();
  for (const o of orders) {
    const arr = byCompany.get(o.company_id) || [];
    arr.push(o);
    byCompany.set(o.company_id, arr);
  }

  function resolveCompany(name: string | null): any | null {
    if (!name) return null;
    const n = norm(name);
    if (!n) return null;
    const exact = companies.find((c) => norm(c.name) === n || norm(c.invoice_name) === n);
    if (exact) return exact;
    let best: any = null, bestScore = 0;
    for (const c of companies) {
      const s = Math.max(tokenOverlap(name, c.name), tokenOverlap(name, c.invoice_name));
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return bestScore >= 0.6 ? best : null;
  }

  const tally = {
    scored: 0,
    noCompany: 0,
    noOrder: 0,
    noJobRows: 0,
    spanOk: 0,
    spanWrong: 0,
    ambiguous: 0,
    crewBlocked: 0,
    slotBlocked: 0,
  };
  const misses: string[] = [];

  for (const l of scorable) {
    tally.scored++;
    tally.crewBlocked++;   // every one of them: crew is unreadable, not merely unmatched
    tally.slotBlocked++;

    const company = resolveCompany(l.company_name);
    if (!company) { tally.noCompany++; misses.push(`${l.thread_id}  no company match for "${l.company_name ?? "(none)"}"`); continue; }

    const start = Date.parse(String(l.first_start));
    const threadFirst = Date.parse(String(l.first_date));
    const threadLast = Date.parse(String(l.last_date));
    const candidates = (byCompany.get(company.id) || []).filter((o) => {
      const hap = Date.parse(o.happening);
      const created = Date.parse(o.created);
      if (!Number.isFinite(hap) || !Number.isFinite(created)) return false;
      if (Math.abs(hap - start) > DAY) return false;
      return created >= threadFirst - DAY && created <= threadLast + 14 * DAY;
    });

    if (!candidates.length) { tally.noOrder++; misses.push(`${l.thread_id}  ${company.name}: no order within a day of ${String(l.first_start).slice(0, 10)}`); continue; }
    if (candidates.length > 1) tally.ambiguous++;

    candidates.sort((a, b) => Math.abs(Date.parse(a.created) - threadLast) - Math.abs(Date.parse(b.created) - threadLast));
    const order = candidates[0];

    const jobs = Array.isArray(order.Job) ? order.Job : [];
    const starts = jobs.map((j: any) => Date.parse(j.min_beginning)).filter(Number.isFinite);
    const ends = jobs.map((j: any) => Date.parse(j.max_end)).filter(Number.isFinite);
    if (!starts.length || !ends.length) {
      // An order with no Job rows carries no times at all. Calling that a wrong span
      // would blame the engine for a comparison that was never possible.
      tally.noJobRows++;
      misses.push(`${l.thread_id}  ${company.name} order ${order.number}: paired, but the order has no Job rows to compare`);
      continue;
    }
    const jobStart = Math.min(...starts);
    const jobEnd = Math.max(...ends);
    const wantStart = Date.parse(String(l.first_start));
    const wantEnd = Date.parse(String(l.last_end));

    const startOk = Number.isFinite(jobStart) && Math.abs(jobStart - wantStart) <= SPAN_TOLERANCE_MS;
    const endOk = Number.isFinite(jobEnd) && Math.abs(jobEnd - wantEnd) <= SPAN_TOLERANCE_MS;
    if (startOk && endOk) tally.spanOk++;
    else {
      tally.spanWrong++;
      const drift = (a: number, b: number) => (Number.isFinite(a) ? `${Math.round((a - b) / 60000)}min` : "n/a");
      misses.push(`${l.thread_id}  ${company.name} order ${order.number}: start off by ${drift(jobStart, wantStart)}, end off by ${drift(jobEnd, wantEnd)}`);
    }
  }

  // The standing finding, put to the test: a thread the engine called junk, which
  // nonetheless became a real OnSinch order, is a job that could have been created and
  // was not. That is the difference between the classifier being noisy and the
  // classifier costing Spartan work.
  let junkThatBecameOrders = 0, junkPairable = 0;
  for (const l of junkWithDatedBlock) {
    const company = resolveCompany(l.company_name);
    if (!company) continue;
    junkPairable++;
    const start = Date.parse(String(l.first_start));
    const threadFirst = Date.parse(String(l.first_date));
    const threadLast = Date.parse(String(l.last_date));
    const hit = (byCompany.get(company.id) || []).some((o) => {
      const hap = Date.parse(o.happening), created = Date.parse(o.created);
      return Number.isFinite(hap) && Math.abs(hap - start) <= DAY &&
             created >= threadFirst - DAY && created <= threadLast + 14 * DAY;
    });
    if (hit) junkThatBecameOrders++;
  }
  console.log("THE not-a-job THREADS, TESTED AGAINST ONSINCH");
  console.log(`  not-a-job with a dated block            ${junkWithDatedBlock.length}`);
  console.log(`  ...whose company resolved              ${junkPairable}`);
  console.log(`  ...that DID become a real order        ${junkThatBecameOrders}`);
  console.log(`  (each of those is a job the engine declined to create)
`);

  console.log("SCORE (span only — crew and slot count are blocked, see header)");
  console.log(`  paired and span correct        ${tally.spanOk}/${tally.scored}`);
  console.log(`  paired but span wrong          ${tally.spanWrong}`);
  console.log(`  no order found at all          ${tally.noOrder}`);
  console.log(`  paired but order has no Jobs   ${tally.noJobRows}`);
  console.log(`  company never resolved         ${tally.noCompany}`);
  console.log(`  pairing was ambiguous          ${tally.ambiguous} (nearest-created taken)`);
  console.log(`  crew unscored (GET /slot_teams 405)        ${tally.crewBlocked}`);
  console.log(`  slot-team count unscored (same)            ${tally.slotBlocked}`);
  console.log(`\nMISSES`);
  for (const m of misses.slice(0, 40)) console.log(`  ${m}`);
  if (misses.length > 40) console.log(`  … and ${misses.length - 40} more`);
  console.log();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
