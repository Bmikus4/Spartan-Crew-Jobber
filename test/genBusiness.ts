// ============================================================================
// The generated business (harness/gen, ADDENDUM §14.11) still runs end to end: seeded clients and jobs through
// intake, the planner, the minute sync and the TV on the fake OnSinch, with simulated staff.
// ----------------------------------------------------------------------------
// Pinned: with the perfect reader every case of A (booking), E (changes, moves among them), F (cancels), J
// (incomplete), K (staff's work) and M (controls) ends as the business answer, with no wrong write; with every date
// a day late (the mutant), nothing is written at all. The 270-case run behind these numbers is ADDENDUM §14.11.
// npx tsx test/genBusiness.ts
// ============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

function run(reader: string): any {
  const out = mkdtempSync(join(tmpdir(), "gen-"));
  // The sim refuses production credentials itself (boot.ts); no --env-file, so none are loaded.
  const r = spawnSync("npx", ["tsx", "harness/gen/run.mts", "--cats", "A,E,F,J,K,M", "--n", "3", "--seed", "31102026", "--reader", reader, "--out", out],
    { encoding: "utf8", shell: process.platform === "win32", timeout: 300_000 });
  try {
    if (r.status !== 0) return { error: (r.stderr || r.stdout || "").slice(-600) };
    return JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
  } finally { rmSync(out, { recursive: true, force: true }); }
}

const failed = (x: any) => x.obs.filter((o: any) => !o.ok).map((o: any) => `${x.id} ${o.node}: ${o.detail ?? ""}`);

console.log("\n[1] the perfect reader: every case ends as the business answer");
{
  const r = run("oracle");
  ok(!r.error, "the run finishes", r.error);
  const rs = (r.results ?? []) as any[];
  ok(rs.length === 18, "18 cases, 3 in each of 6 categories", rs.length);
  ok(rs.every((x) => !x.stage) && rs.every((x) => !failed(x).length), "every observation holds", rs.flatMap(failed).slice(0, 5));
  ok(!r.syncErrors?.length && !r.network_refused?.length, "no sync error, nothing reached past the sim's network", { sync: r.syncErrors, net: r.network_refused });
}

console.log("\n[2] every date a day late: grounding refuses every write");
{
  const r = run("mutant");
  ok(!r.error, "the run finishes", r.error);
  const rs = (r.results ?? []) as any[];
  const wrote = rs.filter((x) => x.obs.some((o: any) => o.node.startsWith("plan.") || (o.node === "decision" && !o.ok && /got write/.test(o.detail ?? ""))));
  ok(rs.length === 18 && !wrote.length, "no case wrote", wrote.map((x) => x.id));
  ok(rs.every((x) => x.obs.filter((o: any) => o.node === "inv.no_wrong_write").every((o: any) => o.ok)), "no wrong write");
}

process.exit(fails ? 1 : 0);
