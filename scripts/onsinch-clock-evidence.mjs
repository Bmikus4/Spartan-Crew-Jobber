// Does OnSinch hold true UTC or naive London local?
// Test: histogram the START HOUR of HUMAN-raised jobs, split by BST vs GMT season.
// Naive-local storage -> the two histograms line up. True UTC -> the BST one sits
// one hour earlier.
import { loadEnv, requireEnv, onsinchGet } from './_env.mjs';
loadEnv(); const KEY = requireEnv('ONSINCH_API_KEY');

const API_USER = 2257;
const rows = [];
for (let page = 1; page <= 20; page++) {
  const r = await onsinchGet(`/orders?limit=100&page=${page}&with=Job`, KEY);
  const data = r?.data || [];
  if (!data.length) break;
  rows.push(...data);
}
console.log(`${rows.length} orders read`);

// BST 2025: 30 Mar - 26 Oct. BST 2026: 29 Mar - 25 Oct. GMT otherwise.
const bstRanges = [
  ['2024-03-31', '2024-10-27'], ['2025-03-30', '2025-10-26'], ['2026-03-29', '2026-10-25'],
];
const inBst = (d) => bstRanges.some(([a, b]) => d >= a && d < b);

const hist = { bst: {}, gmt: {} };
let n = { bst: 0, gmt: 0 };
for (const o of rows) {
  if (Number(o.creator) === API_USER) continue;      // human-raised only
  const j = Array.isArray(o.Job) ? o.Job[0] : o.Job;
  const t = j?.min_beginning;
  if (!t) continue;
  const day = String(t).slice(0, 10);
  const hour = Number(String(t).slice(11, 13));
  const bucket = inBst(day) ? 'bst' : 'gmt';
  hist[bucket][hour] = (hist[bucket][hour] || 0) + 1;
  n[bucket]++;
}
console.log('human-raised counted:', n);
console.log('hour | BST%  | GMT%');
for (let h = 0; h < 24; h++) {
  const b = hist.bst[h] || 0, g = hist.gmt[h] || 0;
  if (!b && !g) continue;
  console.log(`${String(h).padStart(2, '0')}   | ${(100 * b / n.bst).toFixed(1).padStart(5)} | ${(100 * g / n.gmt).toFixed(1).padStart(5)}   (${b}/${g})`);
}
