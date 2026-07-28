// Read-only: the N most-recent OnSinch orders with everything the inbox
// record-linkage will need (company, contact, place, happening dates, job name).
//
// Two API facts worth knowing, both verified against the live tenant:
//  - GET /orders returns NEWEST FIRST (id and created both descending), so the
//    recent orders are on page 1. Paging to the last page gets you 2023.
//  - sort=-id is accepted and ignored, and pagination.nextPage is a boolean,
//    so never drive paging off it.
//
//   node scripts/onsinch-recent-orders.mjs [count]
import { loadEnv, requireEnv, onsinchGet } from "./_env.mjs";

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");
const WANT = Number(process.argv[2] || 30);

/** The N most-recent orders, newest first, with their Job rows attached. */
export async function recentOrders(key, want = 30) {
  const out = [];
  for (let page = 1; out.length < want && page <= 5; page++) {
    const r = await onsinchGet(`/orders?limit=100&page=${page}&with=Job`, key);
    const rows = Array.isArray(r?.data) ? r.data : [];
    if (!rows.length) break;
    out.push(...rows);
  }
  // Do not trust the server order - sort explicitly on created, id as tiebreak.
  out.sort((a, b) => {
    const d = Date.parse(b.created ?? 0) - Date.parse(a.created ?? 0);
    return d !== 0 ? d : Number(b.id) - Number(a.id);
  });
  return out.slice(0, want);
}

export const firstJob = (o) => (Array.isArray(o.Job) ? o.Job[0] : o.Job) ?? {};

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const recent = await recentOrders(KEY, WANT);
  console.log(`\n${recent.length} most-recent OnSinch orders (newest first):\n`);
  for (const o of recent) {
    const j = firstJob(o);
    console.log(
      `  #${String(o.id).padEnd(6)} ${String(o.created ?? "").slice(0, 10)} ` +
      `happening=${String(o.happening ?? "-").slice(0, 10).padEnd(10)} ` +
      `co=${String(o.company_id ?? "-").padEnd(5)} user=${String(o.user_id ?? "-").padEnd(6)} ` +
      `prov=${o.provisional ? "Y" : "n"} card=${String(j.pricelist_category_id ?? "-").padEnd(4)} ` +
      `${String(o.name ?? j.name ?? "").slice(0, 44)}`
    );
  }
  const withHappening = recent.filter((o) => o.happening).length;
  const withCompany = recent.filter((o) => o.company_id).length;
  const withUser = recent.filter((o) => o.user_id).length;
  console.log(`\nlinkage keys present: happening ${withHappening}/${recent.length}, company_id ${withCompany}/${recent.length}, user_id ${withUser}/${recent.length}`);
}
