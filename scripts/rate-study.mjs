// ============================================================================
// PHASE B1 — Rate ground truth from real OnSinch order history.
//
// Money lives on Job.pricelist_category_id (INVARIANT I1). It never appears on
// the order/slot team; omit it and OnSinch silently assigns a DEFAULT card
// (observed 245) — that is Tracy's wrong-rate failure mode. This study learns,
// per company, which rate card they ACTUALLY get billed on, from their real
// orders, so the engine can set it explicitly.
//
// Output: data/rate-map.json
//   { "<company_id>": { card, share, lastUsed, n, nullN, source:"history" } }
//   plus an `_ambiguous` list (split habit) and `_none` list (no explicit card).
//
// Algorithm mirrors rates.ts A4 exactly so the seeded value == what the live
// resolver would compute: over a company's most recent N=20 orders, weight each
// order's card by w = 0.5^rank (rank 0 = newest). Accept the top card iff its
// share of non-null weight >= 0.7, else 'ambiguous'.
//
// Run:  node scripts/rate-study.mjs           (full pull, ~6.6k orders)
//       node scripts/rate-study.mjs --max 500 (quick sample while testing)
// ============================================================================
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchGet, ROOT_DIR } from "./_env.mjs";

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");

const RECENCY_WINDOW = 20; // A4: last N orders
const ACCEPT_SHARE = 0.7; // A4: top card must hold >= this
const PAGE_SIZE = 100;

const argMax = (() => {
  const i = process.argv.indexOf("--max");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : Infinity;
})();

function orderDate(o) {
  // best-effort recency date for reporting (id is the true sort key)
  return (
    o?.created_at ||
    o?.created ||
    o?.Job?.beginning ||
    o?.beginning ||
    null
  );
}

// Pull every order, projecting each down to the 4 fields we need (keeping full
// objects blew memory to 600MB+). NOTE: OnSinch's `pagination.nextPage` is a
// BOOLEAN, not a page number, and `sort=-id` is ignored — so we drive the loop
// off the reliable integer `pageCount` and re-sort per company later.
async function pullAllOrders() {
  const rows = [];
  let page = 1;
  let pageCount = 1;
  let count = "?";
  for (;;) {
    const body = await onsinchGet(
      `/orders?with=Job&limit=${PAGE_SIZE}&page=${page}`,
      KEY
    );
    const data = body?.data ?? [];
    for (const o of data) {
      const cid = o?.company_id ?? o?.Company?.id;
      if (cid == null) continue;
      // Job is an ARRAY (an order can hold multiple jobs); the rate card lives
      // on Job[].pricelist_category_id. Take the first non-null card.
      const jobs = Array.isArray(o?.Job) ? o.Job : o?.Job ? [o.Job] : [];
      const card =
        jobs.map((j) => j?.pricelist_category_id).find((c) => c != null) ?? null;
      rows.push({ company_id: cid, card, id: o?.id ?? 0, date: orderDate(o) });
    }
    const pg = body?.pagination ?? {};
    pageCount = Number.isInteger(pg.pageCount) ? pg.pageCount : pageCount;
    count = pg.count ?? count;
    process.stdout.write(`\r  page ${page}/${pageCount}  rows ${rows.length}/${count}   `);
    if (rows.length >= argMax) break;
    if (!data.length) break;
    if (page >= pageCount) break;
    page++;
  }
  process.stdout.write("\n");
  return argMax === Infinity ? rows : rows.slice(0, argMax);
}

function buildMap(rows) {
  // group by company; we re-sort each company's list newest-first below since
  // the API's own sort is unreliable.
  const byCompany = new Map();
  for (const r of rows) {
    if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []);
    byCompany.get(r.company_id).push(r);
  }

  const map = {};
  const ambiguous = [];
  const none = [];

  for (const [cid, list] of byCompany) {
    // ensure newest-first (defensive; API already sorts -id)
    list.sort((a, b) => b.id - a.id);
    const window = list.slice(0, RECENCY_WINDOW);

    const weight = new Map(); // card -> summed 0.5^rank
    let totalNonNull = 0;
    let nullN = 0;
    window.forEach((row, rank) => {
      if (row.card == null) {
        nullN++;
        return;
      }
      const w = Math.pow(0.5, rank);
      weight.set(row.card, (weight.get(row.card) ?? 0) + w);
      totalNonNull += w;
    });

    const entry = {
      n: list.length,
      nullN,
      lastUsed: window[0]?.date ?? null,
      lastOrderId: window[0]?.id ?? null,
    };

    if (totalNonNull === 0) {
      none.push(cid);
      continue; // no explicit card ever -> Tracy export must supply it
    }

    let topCard = null;
    let topW = -1;
    for (const [card, w] of weight) {
      if (w > topW) {
        topW = w;
        topCard = card;
      }
    }
    const share = topW / totalNonNull;

    if (share >= ACCEPT_SHARE) {
      map[cid] = { card: topCard, share: round(share), source: "history", ...entry };
    } else {
      ambiguous.push({
        company_id: cid,
        topCard,
        share: round(share),
        cards: Object.fromEntries([...weight].map(([c, w]) => [c, round(w)])),
        ...entry,
      });
    }
  }

  return { map, ambiguous, none };
}

const round = (x) => Math.round(x * 1000) / 1000;

(async () => {
  console.log("Pulling OnSinch order history (with=Job)…");
  const rows = await pullAllOrders();
  console.log(`Fetched ${rows.length} orders.`);

  const { map, ambiguous, none } = buildMap(rows);
  const companies = Object.keys(map).length;
  console.log(
    `\nCompanies: accepted ${companies} | ambiguous ${ambiguous.length} | no-explicit-card ${none.length}`
  );

  const out = {
    _meta: {
      generated_from_orders: rows.length,
      recency_window: RECENCY_WINDOW,
      accept_share: ACCEPT_SHARE,
      accepted_companies: companies,
    },
    _ambiguous: ambiguous.sort((a, b) => b.n - a.n),
    _none: none,
    ...map,
  };

  const dir = join(ROOT_DIR, "data");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "rate-map.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  // Also cache the raw projected rows so weighting can be tuned offline
  // (no re-pull) — see scripts/rate-decay-experiment.mjs.
  writeFileSync(join(dir, "rate-rows.json"), JSON.stringify(rows));
  console.log(`\nWrote ${file}`);
  console.log(
    `Next: node scripts/seed-rate-cards.mjs  (upserts accepted cards into Neon rate_cards)`
  );
})().catch((e) => {
  console.error("\nrate-study failed:", e.message);
  process.exit(1);
});
