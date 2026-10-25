// ============================================================================
// The chronological dev/test split, threads kept together (OPERATING §8.8).
// ----------------------------------------------------------------------------
// Run once: npx tsx harness/real/split.ts   (writes labels/split.json for the live week and
// labels/split-all.json for all 799, each only if it does not exist)
//
// Threads are ordered by their first labelled email; whole threads go to dev until dev holds
// 70% of the emails, and every later thread goes to test. A thread therefore never straddles
// the two sets, and every test thread began after every dev thread began.
// Provisional rows (a label resting on a 2-1 vote) never enter test: the locked set is scored
// only on labels both blind readers gave.
//
// THE TEST SET IS LOCKED BY ITS HASH. loadSplit() refuses a split file whose ids no longer hash
// to the value recorded at creation, and refuses to write over an existing file: re-splitting
// after a look at test results is how a test set stops being one. Tuning reads dev only.
// ============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SPLIT, SPLIT_ALL, sha256 } from "./data";
import { labelPath, loadLabels, type Label, type LabelSet } from "./labels";

export type Split = { method: string; created_at: string; dev: string[]; test: string[]; excluded_from_test: string[]; test_hash: string };

export const hashIds = (ids: string[]) => sha256([...ids].sort().join("\n")).slice(0, 16);

export function makeSplit(labels: Label[], devShare = 0.7): Split {
  const threads = new Map<string, Label[]>();
  for (const l of labels) threads.set(l.thread_id, [...(threads.get(l.thread_id) ?? []), l]);
  const ordered = [...threads.values()].map((ls) => ls.sort((a, b) => a.date_iso.localeCompare(b.date_iso)))
    .sort((a, b) => a[0].date_iso.localeCompare(b[0].date_iso) || a[0].thread_id.localeCompare(b[0].thread_id));
  const dev: string[] = [], test: string[] = [], excluded: string[] = [];
  const target = Math.round(devShare * labels.length);
  for (const ls of ordered) {
    if (dev.length < target) dev.push(...ls.map((l) => l.message_id));
    else for (const l of ls) (l.provisional ? excluded : test).push(l.message_id);
  }
  return {
    method: `threads by first email, whole threads to dev until ${Math.round(devShare * 100)}% of emails; provisional rows kept out of test`,
    created_at: new Date().toISOString(), dev, test, excluded_from_test: excluded, test_hash: hashIds(test),
  };
}

export function loadSplit(path = SPLIT): Split {
  const s = JSON.parse(readFileSync(path, "utf8")) as Split;
  if (hashIds(s.test) !== s.test_hash) throw new Error(`split: the test ids hash to ${hashIds(s.test)}, not the locked ${s.test_hash}. The test set was changed.`);
  return s;
}

export const splitPath = (set: LabelSet) => (set === "all" ? SPLIT_ALL : SPLIT);

if (process.argv[1] && /split\.ts$/.test(process.argv[1])) {
  for (const set of ["live-week", "all"] as LabelSet[]) {
    const path = splitPath(set);
    if (existsSync(path)) {
      const s = loadSplit(path);
      console.log(`${set}: split exists and is intact: dev ${s.dev.length}, test ${s.test.length}, test hash ${s.test_hash}. Not rewritten.`);
    } else {
      const s = makeSplit(loadLabels(labelPath(set)));
      writeFileSync(path, JSON.stringify(s, null, 1) + "\n");
      console.log(`${set}: split written: dev ${s.dev.length}, test ${s.test.length}, excluded from test ${s.excluded_from_test.length}, test hash ${s.test_hash}`);
    }
  }
}
