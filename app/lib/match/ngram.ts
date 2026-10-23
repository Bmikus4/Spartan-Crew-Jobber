// ============================================================================
// Names compared as groups of three characters, each group weighted by how rare it is across
// OnSinch's own names (TF-IDF over character 3-grams), and word by word with near-identical
// words counted as one (Soft TF-IDF: Cohen, Ravikumar and Fienberg, 2003).
// ----------------------------------------------------------------------------
// The weights come from the corpus, not from hand-made stop-word lists: "london", "hotel" and
// "the" appear on hundreds of places, so their groups weigh almost nothing, and a rare name
// carries the match. Codes, numbers, postcodes and email addresses never come here: one
// character changes the job, and E15482 and E15483 share three of their four 3-grams.
// ============================================================================

/** Lower case, accents and apostrophes gone, "&" as "and", anything else not a letter or digit a space. */
export function clean(s: unknown): string {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/['‘’`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export const words = (s: unknown): string[] => { const c = clean(s); return c ? c.split(" ") : []; };

/** The 3-grams of the cleaned text with a space at each edge, so a word's start and end count. */
export function grams(s: unknown): string[] {
  const c = clean(s);
  if (!c) return [];
  const p = ` ${c} `;
  const out: string[] = [];
  for (let i = 0; i + 3 <= p.length; i++) out.push(p.slice(i, i + 3));
  return out;
}

export type Corpus = { n: number; gramDf: Map<string, number>; wordDf: Map<string, number> };

/** Document frequencies over the names the matcher compares against: places, aliases, order and company names. */
export function corpus(docs: Iterable<unknown>): Corpus {
  const gramDf = new Map<string, number>(), wordDf = new Map<string, number>();
  let n = 0;
  for (const d of docs) {
    const g = new Set(grams(d));
    if (!g.size) continue;
    n++;
    for (const x of g) gramDf.set(x, (gramDf.get(x) ?? 0) + 1);
    for (const x of new Set(words(d))) wordDf.set(x, (wordDf.get(x) ?? 0) + 1);
  }
  return { n, gramDf, wordDf };
}

const idf = (df: number | undefined, n: number) => Math.log((n + 1) / ((df ?? 0) + 1)) + 1;

function weighted(items: string[], df: Map<string, number>, n: number): Map<string, number> {
  const tf = new Map<string, number>();
  for (const x of items) tf.set(x, (tf.get(x) ?? 0) + 1);
  const v = new Map<string, number>();
  let sq = 0;
  for (const [x, f] of tf) { const w = f * idf(df.get(x), n); v.set(x, w); sq += w * w; }
  const norm = Math.sqrt(sq) || 1;
  for (const [x, w] of v) v.set(x, w / norm);
  return v;
}

/** TF-IDF cosine over 3-grams, 0 to 1. */
export function gramCosine(a: unknown, b: unknown, c: Corpus): number {
  const va = weighted(grams(a), c.gramDf, c.n), vb = weighted(grams(b), c.gramDf, c.n);
  let s = 0;
  for (const [x, w] of va) s += w * (vb.get(x) ?? 0);
  return Math.min(1, s);
}

/**
 * How much of the short name is in the long text, by IDF weight, 0 to 1. Asymmetric on purpose:
 * "LABS House" is all there in "Labs House 15-19 Bloomsbury Way, London WC1A 2TH", which a
 * cosine marks down for the address beside it.
 */
export function gramContainment(short: unknown, long: unknown, c: Corpus): number {
  const gs = [...new Set(grams(short))];
  if (!gs.length) return 0;
  const gl = new Set(grams(long));
  let have = 0, all = 0;
  for (const x of gs) { const w = idf(c.gramDf.get(x), c.n); all += w; if (gl.has(x)) have += w; }
  return all ? have / all : 0;
}

/** Jaro-Winkler, 0 to 1. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false), mb = new Array<boolean>(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - range); j < Math.min(lb, i + range + 1); j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

/** Soft TF-IDF over words: a word counts against its closest word on the other side when they are at least `theta` alike. */
export function softTfIdf(a: unknown, b: unknown, c: Corpus, theta = 0.9): number {
  const wa = weighted(words(a), c.wordDf, c.n), wb = weighted(words(b), c.wordDf, c.n);
  let s = 0;
  for (const [x, w] of wa) {
    let best = 0, bw = 0;
    for (const [y, v] of wb) { const j = x === y ? 1 : jaroWinkler(x, y); if (j >= theta && j > best) { best = j; bw = v; } }
    s += w * bw * best;
  }
  return Math.min(1, s);
}

/** The matcher's similarity of two names: the higher of the 3-gram cosine and Soft TF-IDF. */
export const similarity = (a: unknown, b: unknown, c: Corpus): number => Math.max(gramCosine(a, b, c), softTfIdf(a, b, c));
