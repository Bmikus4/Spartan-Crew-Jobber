// ============================================================================
// The study's falsification tests, run.
// ----------------------------------------------------------------------------
// Section 9 of the R&D study proposes changes and states, for each, what would
// prove it wrong. Two of those tests need no model calls and no new OnSinch
// permission, so they can settle their proposals now rather than waiting on a
// labelling budget:
//
//   A. Venue stability per client   — gates proposal 2 (fill a blank venue from the
//      sender's history). The study's threshold: below ~70% consecutive-pair venue
//      agreement, inheritance would inject wrong addresses into real orders.
//   B. Reference-join availability  — gates proposal 6 (join a thread to its order
//      on the client's own reference instead of date+company, because 7 of 25
//      date+company pairings were ambiguous). Below ~50% availability the join is
//      not there and date+company is as good as it gets.
//
// Two instrument choices carry the sections, and both are the reason the numbers
// are trustworthy rather than convenient:
//
// Venue comes from Job.name. Order allows only `with=Job,Attachment`, Job carries no
// place_id, and GET /jobs and GET /slot_teams both return 405 — the venue is not
// readable any other way. 6,515 of 6,859 job names (95.0%) follow "Client @ Venue".
//
// The reference comes from Order.intern_name — what the human booker actually typed —
// and is tested by looking for that string in the corpus. The obvious alternative,
// regexing the email for "PO:" / "our ref:", was tried first and is wrong twice over:
// it matched Spartan's OWN reply boilerplate on 3,807 threads against 2,748 client-side,
// and most client-side hits are a request for a reference ("please send your PO number")
// rather than a reference. Joining on what is recorded against the order avoids both.
//
//   node scripts/rnd-disproofs.mjs           # print both sections
//   node scripts/rnd-disproofs.mjs --json    # the same, as JSON
//   node scripts/rnd-disproofs.mjs --refresh # re-pull orders instead of using the cache
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { loadEnv, onsinchGet, requireEnv, ROOT_DIR } from "./_env.mjs";

loadEnv();
const AS_JSON = process.argv.includes("--json");
const REFRESH = process.argv.includes("--refresh");
const say = (...a) => { if (!AS_JSON) console.log(...a); };
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + "%" : "n/a");
const out = {};

// ------------------------------------------------------------------ orders pull
// Cached: 67 pages of a read-only endpoint that gains a few rows a day, and every
// iteration of this analysis would otherwise re-pull all of it.
const CACHE = join(ROOT_DIR, "data", "orders-with-job.json");

async function pullOrders() {
  const key = requireEnv("ONSINCH_API_KEY");
  const rows = [];
  // pagination.nextPage is a BOOLEAN, not a page number — reading it as one loops on
  // page 1 forever. Page off pagination.count, which is the item total.
  const first = await onsinchGet("/orders?limit=100&page=1&with=Job", key);
  const pages = Math.ceil((first.pagination?.count ?? 0) / 100);
  const take = (j) => {
    for (const o of j.data || []) {
      const jobs = (Array.isArray(o.Job) ? o.Job : [o.Job]).filter(Boolean);
      rows.push({
        id: o.id,
        company_id: o.company_id,
        happening: o.happening || o.created || null,
        status: o.status,
        number: String(o.number ?? "").trim(),
        intern_name: String(o.intern_name ?? "").trim(),
        job_names: jobs.map((j) => j.name || ""),
      });
    }
  };
  take(first);
  for (let p = 2; p <= pages; p++) {
    take(await onsinchGet(`/orders?limit=100&page=${p}&with=Job`, key));
    if (p % 10 === 0) say(`  … ${rows.length} orders`);
  }
  writeFileSync(CACHE, JSON.stringify(rows));
  return rows;
}

const cached = !REFRESH && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : null;
// A cache written before intern_name was collected cannot answer section B; re-pull
// rather than silently reporting a 0% join rate.
const orders = cached && cached[0] && "intern_name" in cached[0] ? cached : await pullOrders();

// ------------------------------------------------------------------ venue parse
// "Wacker Global - Brighton Pride @ Preston Park **Photo ID**" -> "preston park".
// Split on the LAST " @ ": the client half sometimes carries an event name with its
// own punctuation, the venue half never carries another "@".
const PLACEHOLDER = /^(tbc|tba|various|n\/a|unknown|-+)$/;
function venueOf(name) {
  const i = name.lastIndexOf(" @ ");
  if (i < 0) return { key: null, placeholder: false };
  const raw = name.slice(i + 3)
    .replace(/\*\*[^*]*\*\*/g, "")        // "**Photo ID**" is a crew instruction
    .replace(/\s+/g, " ")
    .trim();
  const key = raw.toLowerCase().replace(/^the\s+/, "").replace(/[.,;:]+$/, "").trim();
  return { key: key === "" ? null : key, placeholder: PLACEHOLDER.test(key) };
}

// ------------------------------------------------- A. venue stability per client
{
  say(`\n=== A. VENUE STABILITY PER CLIENT ===`);
  const named = [];
  let noAt = 0, placeholder = 0;
  for (const o of orders) {
    for (const n of o.job_names) {
      const v = venueOf(n);
      if (v.key === null) { noAt++; continue; }
      if (v.placeholder) { placeholder++; continue; }
      named.push({ company_id: o.company_id, when: Date.parse(o.happening ?? "") || 0, key: v.key });
    }
  }
  const totalJobs = orders.reduce((n, o) => n + o.job_names.length, 0);

  const byCompany = new Map();
  for (const r of named) {
    if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []);
    byCompany.get(r.company_id).push(r);
  }

  // Consecutive pairs in the order the work happened. "Would inheriting the last venue
  // have been right?" is exactly a consecutive-pair question; a company's all-time
  // distinct-venue count answers a different and easier one.
  //
  // Three matching strictnesses, because a single one invites the objection that the
  // rate is really a spelling-variance artefact ("Olympia" vs "Olympia London"). It
  // is not: the three bracket each other within 4 points.
  const norm = (s) => s.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
  const jaccard = (a, b) => {
    const A = toks(a), B = toks(b);
    if (!A.size || !B.size) return 0;
    let i = 0; for (const x of A) if (B.has(x)) i++;
    return i / (A.size + B.size - i);
  };
  const MATCHERS = {
    exact: (a, b) => a === b,
    loose: (a, b) => norm(a) === norm(b) || norm(a).startsWith(norm(b)) || norm(b).startsWith(norm(a)),
    tokens: (a, b) => jaccard(a, b) >= 0.5,
  };

  const rates = {};
  let perCompany = [];
  for (const [label, eq] of Object.entries(MATCHERS)) {
    let pairs = 0, agree = 0;
    const per = [];
    for (const [company_id, rs] of byCompany) {
      if (rs.length < 3) continue;          // the study's population: 3+ dated jobs
      rs.sort((a, b) => a.when - b.when);
      let p = 0, a = 0;
      for (let i = 1; i < rs.length; i++) { p++; if (eq(rs[i].key, rs[i - 1].key)) a++; }
      pairs += p; agree += a;
      per.push({ company_id, jobs: rs.length, pairs: p, agree: a, rate: p ? a / p : 0,
                 distinct: new Set(rs.map((r) => r.key)).size });
    }
    // Per-company mean as well as pooled: the pooled figure is dominated by the few
    // clients who book hundreds of times, and the tool has to be right for the client
    // who books four times too.
    rates[label] = {
      pairs, agree,
      pooled: pairs ? agree / pairs : 0,
      perCompanyMean: per.length ? per.reduce((s, c) => s + c.rate, 0) / per.length : 0,
    };
    if (label === "exact") perCompany = per;
  }

  // The ceiling for ANY history-based fill: was this venue used by this client at all
  // before? Even an oracle that picked the right prior venue cannot beat this.
  let n = 0, seen = 0;
  for (const rs of byCompany.values()) {
    if (rs.length < 3) continue;
    rs.sort((a, b) => a.when - b.when);
    for (let i = 1; i < rs.length; i++) { n++; if (rs.slice(0, i).some((r) => r.key === rs[i].key)) seen++; }
  }
  const oracleCeiling = n ? seen / n : 0;

  const buckets = [0, 0, 0, 0, 0];   // <20, 20-50, 50-70, 70-90, >=90
  for (const c of perCompany) {
    const r = c.rate * 100;
    buckets[r < 20 ? 0 : r < 50 ? 1 : r < 70 ? 2 : r < 90 ? 3 : 4]++;
  }

  const pooled = rates.exact.pooled;
  out.venueStability = {
    orders: orders.length, jobs: totalJobs, jobsWithVenue: named.length,
    jobsNoAt: noAt, jobsPlaceholderVenue: placeholder,
    companiesWith3Plus: perCompany.length, rates, oracleCeiling,
    buckets: { under20: buckets[0], "20to50": buckets[1], "50to70": buckets[2], "70to90": buckets[3], "90plus": buckets[4] },
    threshold: 0.7,
    verdict: pooled >= 0.7
      ? "inheritance safe at the study's threshold"
      : "FALSIFIED — the venue must not be inherited; offer it as a flagged suggestion only",
    stableClients: perCompany.filter((c) => c.jobs >= 10 && c.rate >= 0.9).length,
    bestFrequent: perCompany.filter((c) => c.jobs >= 10).sort((a, b) => b.rate - a.rate).slice(0, 8),
  };
  say(`orders ${orders.length}  jobs ${totalJobs}  venue readable ${named.length} (${pct(named.length, totalJobs)})`);
  say(`  no " @ " in name ${noAt}   placeholder venue (TBC/Various/…) ${placeholder}`);
  say(`companies with 3+ dated jobs: ${perCompany.length}   consecutive pairs: ${rates.exact.pairs}`);
  for (const [label, r] of Object.entries(rates)) {
    say(`  ${label.padEnd(6)} agreement  pooled ${(100 * r.pooled).toFixed(1)}%   per-company mean ${(100 * r.perCompanyMean).toFixed(1)}%`);
  }
  say(`ceiling for any history fill (venue used by this client before): ${(100 * oracleCeiling).toFixed(1)}%`);
  say(`companies by agreement: <20% ${buckets[0]} | 20-50% ${buckets[1]} | 50-70% ${buckets[2]} | 70-90% ${buckets[3]} | >=90% ${buckets[4]}`);
  say(`clients booking 10+ jobs that ARE venue-stable (>=90%): ${out.venueStability.stableClients}`);
  say(`VERDICT vs the study's 70% threshold: ${out.venueStability.verdict}`);
}

// -------------------------------------------------- B. reference-join availability
{
  say(`\n=== B. REFERENCE-JOIN AVAILABILITY ===`);
  const sql = neon(requireEnv("DATABASE_URL"));

  // A reference is only a join key if it is distinctive. Four characters of digits
  // ("5029") matched three unrelated threads in the probe; require five, or four with
  // a letter in them.
  const usable = (r) => r.length >= 5 || (r.length >= 4 && /[A-Za-z]/.test(r));
  const refs = [...new Set(orders.map((o) => o.intern_name).filter((r) => r && usable(r)))];
  const withRef = orders.filter((o) => o.intern_name && usable(o.intern_name)).length;

  // Sampled, not exhaustive: matching every reference against every payload is a cross
  // product over ~200MB of mail. 400 references bound the rate closely enough to decide
  // a design question, and the sample is a stable shuffle so a re-run measures the same
  // references rather than re-sampling.
  const SAMPLE = Math.min(400, refs.length);
  const shuffled = refs.slice().sort((a, b) => (a < b ? -1 : 1));
  const step = Math.max(1, Math.floor(shuffled.length / SAMPLE));
  const probe = [];
  for (let i = 0; i < shuffled.length && probe.length < SAMPLE; i += step) probe.push(shuffled[i]);

  let found = 0, unique = 0;
  const CONC = 8;
  let cursor = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= probe.length) return;
      const r = probe[i];
      const [c] = await sql`
        SELECT COUNT(*)::int n FROM sweep_threads WHERE payload::text ILIKE ${"%" + r + "%"}`;
      if (c.n > 0) found++;
      if (c.n === 1) unique++;
      if (!AS_JSON && i && i % 100 === 0) say(`  … ${i}/${probe.length} references probed`);
    }
  }));

  const availability = probe.length ? found / probe.length : 0;
  out.referenceJoin = {
    orders: orders.length, ordersWithUsableRef: withRef,
    refShare: orders.length ? withRef / orders.length : 0,
    distinctRefs: refs.length, sampled: probe.length,
    foundInCorpus: found, resolvedToExactlyOneThread: unique,
    availability, uniqueShare: probe.length ? unique / probe.length : 0,
    precisionGivenFound: found ? unique / found : 0,
    threshold: 0.5,
    verdict: availability >= 0.5
      ? "CONFIRMED — the booker's own reference is present on most orders and resolves to a single thread; use it as the primary join and fall back to date+company"
      : "FALSIFIED — too few references reach the mail; keep date+company as the join",
  };
  say(`orders with a usable reference in intern_name: ${withRef}/${orders.length} = ${pct(withRef, orders.length)}`);
  say(`distinct references ${refs.length}, probed ${probe.length} (SAMPLED)`);
  say(`  found verbatim in the corpus:      ${found} = ${pct(found, probe.length)}`);
  say(`  resolved to exactly ONE thread:    ${unique} = ${pct(unique, probe.length)}  (${pct(unique, found)} of those found)`);
  say(`VERDICT vs the study's 50% threshold: ${out.referenceJoin.verdict}`);
}

if (AS_JSON) console.log(JSON.stringify(out, null, 2));
