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

async function pullAllOrders() {
  const orders = [];
  let page = 1;
  for (;;) {
    const path = `/orders?with=Job&sort=-id&limit=${PAGE_SIZE}&page=${page}`;
    const body = await onsinchGet(path, KEY);
    const rows = body?.data ?? [];
    orders.push(...rows);
    const pg = body?.pagination ?? {};
    process.stdout.write(
      `\r  page ${page}/${pg.pageCount ?? "?"}  orders ${orders.length}/${pg.count ?? "?"}   `
    );
    if (orders.length >= argMax) break;
    if (!rows.length) break;
    if (pg.nextPage == null && page >= (pg.pageCount ?? page)) break;
    page = pg.nextPage ?? page + 1;
    if (page > (pg.pageCount ?? Infinity)) break;
  }
  process.stdout.write("\n");
  return argMax === Infinity ? orders : orders.slice(0, argMax);
}

function buildMap(orders) {
  // group by company (orders arrive newest-first thanks to sort=-id)
  const byCompany = new Map();
  for (const o of orders) {
    const cid = o?.company_id ?? o?.Company?.id;
    if (cid == null) continue;
    if (!byCompany.has(cid)) byCompany.set(cid, []);
    byCompany.get(cid).push({
      card: o?.Job?.pricelist_category_id ?? null,
      id: o?.id ?? 0,
      date: orderDate(o),
    });
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
  const orders = await pullAllOrders();
  console.log(`Fetched ${orders.length} orders.`);

  const { map, ambiguous, none } = buildMap(orders);
  const companies = Object.keys(map).length;
  console.log(
    `\nCompanies: accepted ${companies} | ambiguous ${ambiguous.length} | no-explicit-card ${none.length}`
  );

  const out = {
    _meta: {
      generated_from_orders: orders.length,
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
  console.log(`\nWrote ${file}`);
  console.log(
    `Next: node scripts/seed-rate-cards.mjs  (upserts accepted cards into Neon rate_cards)`
  );
})().catch((e) => {
  console.error("\nrate-study failed:", e.message);
  process.exit(1);
});
