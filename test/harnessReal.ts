// ============================================================================
// The real-mail harness (harness/real) holds its four promises, at $0, in the gate.
// ----------------------------------------------------------------------------
//   1. Both label files (the live week's 400, all 799) are exactly what the blind reads convert
//      to: a hand edit or a re-read never converted turns this red, so a score is never taken on
//      labels nobody read.
//   2. Both test splits are intact: their ids hash to the values pinned below, no thread straddles
//      dev and test, and no provisional (2-1) label is in test.
//   3. score-production reproduces every figure of eval/live-week-reads.md (the baseline proof).
//   4. The time-correct world shows an email nothing created after it, undoes logged changes
//      made after it, and replay refuses a production credential, sends no request and calls no
//      model.
// It needs the local gold copy (.tmp-data/gold, gitignored): without it the file says SKIP and
// passes, because that copy is production data and exists only where it was taken.
// npx tsx test/harnessReal.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { fileHash, goldPresent, textOf } from "../harness/real/data";
import type { LabelSet } from "../harness/real/labels";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

(async () => {
  if (!goldPresent()) { console.log("  SKIP  .tmp-data/gold is absent: the real-mail harness has nothing to score here"); process.exit(0); }
  const { buildLabels, labelPath, loadLabels, serialize } = await import("../harness/real/labels");
  const { loadSplit, hashIds, splitPath } = await import("../harness/real/split");
  const { productionRows } = await import("../harness/real/system");
  const { reproduce } = await import("../harness/real/reproduce");
  const { Index, TimeWorld } = await import("../harness/real/world");
  const { replay } = await import("../harness/real/replay");
  const t0 = Date.now();

  // 1-2. both label files and both splits. The test hashes are pinned HERE as well as in the split
  // files: a split file regenerated with a fresh hash still fails, because the lock is this line.
  const LOCKED: Record<"live-week" | "all", string> = { "live-week": "8aaf7ecd8b29ba86", all: "d2790450e2c9ae4f" };
  for (const set of ["live-week", "all"] as const) {
    ok(serialize(buildLabels(set)) === textOf(labelPath(set)), `${set}: the label file equals the converted blind reads`);
    const ls = loadLabels(labelPath(set));
    let split: ReturnType<typeof loadSplit> | null = null;
    try { split = loadSplit(splitPath(set)); } catch (e) { ok(false, `${set}: the split loads with its locked hash`, String(e)); }
    if (!split) continue;
    const by = new Map(ls.map((l) => [l.message_id, l]));
    const devThreads = new Set(split.dev.map((i) => by.get(i)!.thread_id));
    ok(hashIds(split.test) === LOCKED[set] && split.test_hash === LOCKED[set], `${set}: test ids hash to the locked ${LOCKED[set]}`, { got: hashIds(split.test) });
    ok(split.test.every((i) => !devThreads.has(by.get(i)!.thread_id)), `${set}: no thread straddles dev and test`);
    ok(split.test.every((i) => !by.get(i)!.provisional), `${set}: no provisional label is in test`);
    ok(split.dev.length + split.test.length + split.excluded_from_test.length === ls.length, `${set}: every labelled email is in dev, test or kept out of test`);
    if (set === "all") ok(ls.length === 799 && ls.every((l) => l.consensus.strict !== "disputed"), "all: 799 emails, and no row stays disputed (settled.csv)", { n: ls.length });
  }
  // The prospective set (mail after the 10-22 copy, red-team-B H1): every email is test, and its lock is pinned here too.
  // Its labels are built from the 10-26 copy (HARNESS_GOLD), so this checks the lock and the file, not the rebuild.
  {
    const ps = loadSplit(splitPath("prospective"));
    ok(ps.dev.length === 0 && hashIds(ps.test) === "7f277f8725036c76" && ps.test_hash === "7f277f8725036c76", "prospective: all 79 are test, and their ids hash to the locked 7f277f8725036c76", { got: hashIds(ps.test) });
    ok(fileHash(labelPath("prospective")) === "6a9d545a23025055", "prospective: the label file is the one the checkpoint was scored on", { got: fileHash(labelPath("prospective")) });
  }
  const labels = loadLabels(labelPath("live-week"));

  // 3. baseline
  const checks = reproduce(labels, productionRows(labels.map((l) => l.message_id)));
  const bad = checks.filter((c) => !c.ok && !c.descriptive);
  ok(bad.length === 0, `score-production reproduces all ${checks.filter((c) => !c.descriptive).length} figures of eval/live-week-reads.md`, bad.map((c) => `line ${c.line}: ${c.claim}: doc ${c.doc}, harness ${c.harness}`));

  // 4a. the world at an email's time holds nothing made after it, and logged changes are undone
  const ix = new Index();
  const created = (e: any) => Date.parse(e?.created ?? "") || 0;
  let future = 0, checked = 0;
  for (const at of ["2026-10-14T09:00:00Z", "2026-10-17T12:00:00Z", "2026-10-20T18:00:00Z"].map(Date.parse)) {
    const w = new TimeWorld(ix, at);
    for (const cid of [...ix.byCompany.keys()].slice(0, 120)) for (const o of await w.companyOrders(cid)) {
      checked++;
      const parts = [o, ...(o.Job ?? []), ...(o.Job ?? []).flatMap((j: any) => j.SlotTeam ?? []), ...(o.Job ?? []).flatMap((j: any) => (j.SlotTeam ?? []).flatMap((t: any) => t.Slot ?? []))];
      if (parts.some((p: any) => created(p) > at || Date.parse(p.modified ?? "") > at)) future++;
    }
  }
  ok(checked > 0 && future === 0, `no order, job, team or shift created or modified after the email's time (${checked} orders read at 3 times)`, { future });
  // A shift whose start was moved after an email: the world at that email has the start as it was.
  const moved = [...ix.changes.entries()].find(([k, cs]) => k.startsWith("Slot:") && cs.some((c) => c.diff.beginning && Date.parse("2026-10-14T00:00:00Z") < c.at && c.at < Date.parse("2026-10-21T00:00:00Z")));
  if (moved) {
    const [key, cs] = moved;
    const c = cs.filter((x) => x.diff.beginning && x.at > Date.parse("2026-10-14T00:00:00Z")).sort((a, b) => a.at - b.at)[0];
    const sid = Number(key.slice(5));
    const owner = ix.orders.find((o) => (o.Job ?? []).some((j: any) => (j.SlotTeam ?? []).some((t: any) => (t.Slot ?? []).some((s: any) => s.id === sid))));
    const w = new TimeWorld(ix, c.at - 1000);
    const o = owner ? await w.orderById(owner.id) : null;
    const slot = o ? (o.Job ?? []).flatMap((j: any) => (j.SlotTeam ?? []).flatMap((t: any) => t.Slot ?? [])).find((s: any) => s.id === sid) : null;
    const want = String(c.diff.beginning.old).replace(" ", "T") + "+00:00";
    ok(!!slot && slot.beginning === want, `a shift start moved after the email reads as it was then (${key})`, { got: slot?.beginning, want });
  }

  // 4b. replay is isolated: a planted production credential stops it before any email.
  // The gate's preload points the database variables at its in-process simulator ("sim://pglite",
  // test/fixtures/pg.ts); the preflight cannot tell that from a credential, so they are set aside here.
  const sim = Object.entries(process.env).filter(([, v]) => v === "sim://pglite").map(([k]) => k);
  for (const k of sim) delete process.env[k];
  process.env.DATABASE_URL = "postgres://planted";
  let refused = false;
  try { await replay(labels.slice(0, 2).map((l) => l.message_id)); } catch (e) { refused = /preflight failed/.test(String(e)); }
  delete process.env.DATABASE_URL;
  ok(refused, "replay refuses to start with a production credential in the environment");
  // and on whole threads it decides every email with no request and no model call
  const firstThreads = new Set(labels.slice(0, 40).map((l) => l.thread_id));
  const sample = labels.filter((l) => firstThreads.has(l.thread_id)).map((l) => l.message_id);
  const r = await replay(sample);
  ok(r.rows.size === sample.length, `replay decides every email of the sample (${r.rows.size} of ${sample.length})`);
  ok(r.netAttempts === 0 && r.modelCalls === 0, "replay sends no network request and calls no model", { net: r.netAttempts, model: r.modelCalls });
  // An email intake read with a later one is not decided on its own in replay, as at intake.
  const all = loadLabels(labelPath("all"));
  const prod = productionRows(all.map((l) => l.message_id));
  const rt = all.find((l) => prod.get(l.message_id)!.carried_by);
  if (rt) {
    const thread = all.filter((l) => l.thread_id === rt.thread_id).map((l) => l.message_id);
    const rr = await replay(thread);
    const row = rr.rows.get(rt.message_id)!;
    ok(row.code === "none_read_together" && row.carried_by === prod.get(rt.message_id)!.carried_by && !rr.limits.has(rt.message_id), `an email read with a later one stays read with it in replay (${rt.message_id})`, { code: row.code });
  }
  for (const k of sim) process.env[k] = "sim://pglite";

  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
