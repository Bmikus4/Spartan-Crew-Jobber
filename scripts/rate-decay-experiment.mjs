// Offline experiment: how does the recency-decay factor change rate-card
// coverage? Reads data/rate-rows.json (raw projected orders) and recomputes the
// accept/ambiguous/none split for several decay factors. w = decay^rank over a
// company's most-recent-20 orders; accept iff top card's share of non-null
// weight >= 0.7. decay=0.5 is the current A4 spec; decay=1.0 = plain majority.
//
// Run:  node scripts/rate-decay-experiment.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT_DIR } from "./_env.mjs";

const rows = JSON.parse(readFileSync(join(ROOT_DIR, "data", "rate-rows.json"), "utf8"));
const WINDOW = 20;
const ACCEPT = 0.7;

const byCompany = new Map();
for (const r of rows) {
  if (!byCompany.has(r.company_id)) byCompany.set(r.company_id, []);
  byCompany.get(r.company_id).push(r);
}
for (const list of byCompany.values()) list.sort((a, b) => b.id - a.id);

function evalDecay(decay) {
  let accepted = 0, ambiguous = 0, none = 0;
  const flippedFrom05 = [];
  for (const [cid, list] of byCompany) {
    const win = list.slice(0, WINDOW);
    const w = new Map();
    let tot = 0;
    win.forEach((r, rank) => {
      if (r.card == null) return;
      const wt = Math.pow(decay, rank);
      w.set(r.card, (w.get(r.card) ?? 0) + wt);
      tot += wt;
    });
    if (tot === 0) { none++; continue; }
    let top = -1;
    for (const v of w.values()) if (v > top) top = v;
    if (top / tot >= ACCEPT) accepted++; else ambiguous++;
  }
  return { decay, accepted, ambiguous, none };
}

// baseline membership at 0.5 to measure flips
function acceptedSet(decay) {
  const s = new Set();
  for (const [cid, list] of byCompany) {
    const win = list.slice(0, WINDOW);
    const w = new Map(); let tot = 0;
    win.forEach((r, rank) => { if (r.card == null) return; const wt = Math.pow(decay, rank); w.set(r.card, (w.get(r.card) ?? 0) + wt); tot += wt; });
    if (tot === 0) continue;
    let top = -1, topCard = null;
    for (const [c, v] of w) if (v > top) { top = v; topCard = c; }
    if (top / tot >= ACCEPT) s.add(cid + ":" + topCard);
  }
  return s;
}

console.log(`companies: ${byCompany.size} | window ${WINDOW} | accept-share ${ACCEPT}\n`);
console.log("decay   accepted  ambiguous  none");
for (const d of [0.5, 0.7, 0.85, 0.95, 1.0]) {
  const r = evalDecay(d);
  console.log(
    `${d.toFixed(2)}      ${String(r.accepted).padStart(4)}       ${String(r.ambiguous).padStart(4)}      ${String(r.none).padStart(3)}`
  );
}
const base = acceptedSet(0.5), plain = acceptedSet(1.0);
let sameCard = 0, diffCard = 0;
const baseCards = new Map([...base].map((x) => x.split(":")).map(([c, k]) => [c, k]));
for (const x of plain) {
  const [c, k] = x.split(":");
  if (baseCards.has(c)) { baseCards.get(c) === k ? sameCard++ : diffCard++; }
}
console.log(
  `\nAgreement 0.5 vs 1.0: of companies accepted under BOTH, ${sameCard} pick the same card, ${diffCard} pick a different card.`
);
