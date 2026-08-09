// ============================================================================
// Run every test file in this directory.
// ----------------------------------------------------------------------------
// test:all used to be a hand-written chain of 20 `tsx test/x.ts` calls, and nine
// files had never been added to it — companyMatch, crewChief, jobName,
// orderSharing, confirmQueue, dismissReason, autoReply, forwardedEnquiry and
// patchApply. Each one passes; none of them was ever run by "the suite". The
// matcher bug fixed in this commit lives in exactly that gap: `npm run test:all`
// reported ALL PASS while the file covering the changed function sat outside it.
//
// A list that must be edited by hand to stay complete will not stay complete, so
// this DISCOVERS instead. Adding test/foo.ts is now enough to have it run.
//
// A test file "passes" by exiting 0 — the convention every file here already
// follows (`process.exit(fails ? 1 : 0)`). Files are run in series because
// several print progress and interleaved output would be unreadable.
//
// Run: npx tsx test/all.ts
// ============================================================================
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Not tests: shared fixtures, and this runner itself. */
const NOT_A_TEST = new Set(["mocks.ts", "all.ts"]);

const files = readdirSync(HERE)
  .filter((f) => f.endsWith(".ts") && !NOT_A_TEST.has(f))
  .sort();

const failed: string[] = [];
for (const f of files) {
  console.log(`\n${"=".repeat(70)}\n== ${f}\n${"=".repeat(70)}`);
  // tsx via the local binary, so this works with no global install.
  const r = spawnSync("npx", ["tsx", join(HERE, f)], { stdio: "inherit", shell: true });
  if (r.status !== 0) failed.push(f);
}

console.log(`\n${"=".repeat(70)}`);
if (failed.length) {
  console.log(`${failed.length} of ${files.length} FAILED: ${failed.join(", ")}\n`);
  process.exit(1);
}
console.log(`ALL ${files.length} TEST FILES PASS\n`);
