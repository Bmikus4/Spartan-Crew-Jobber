// ============================================================================
// A test file that failed exits non-zero, whenever PGlite starts.
// ----------------------------------------------------------------------------
// test/all.ts counts a file failed only by its exit code, and 15 files (58 before 27 Oct) report
// failure by setting process.exitCode. PGlite's start-up ends in Postgres's own exit, which sets process.exitCode to 0
// (emscripten's quit_), so from S-0213, when the suite moved onto PGlite, a file whose failure was
// recorded before or during the start-up passed: routeHandlers was red from S-0240 and the gate saw
// green. harness/sim/pg.ts keeps the code through the start-up. Each case runs as the runner runs a
// file: its own process, the preload first. "ran" in its output proves the case's code ran, so a
// case that cannot even load cannot pass as a failure.
// npx tsx --require ./test/fixtures/pg.ts test/exitCodeSurvivesPglite.ts
// ============================================================================
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PRELOAD = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pg.ts");
const dir = mkdtempSync(join(tmpdir(), "exitcode-"));
let fails = 0;
const ok = (c: boolean, m: string, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + d}`); if (!c) fails++; };

function run(name: string, body: string): { status: number | null; ran: boolean; tail: string } {
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, `const { sql } = require(${JSON.stringify(PRELOAD)});\n(async () => { ${body} console.log("ran"); })();\n`);
  const r = spawnSync("npx", ["tsx", "--require", PRELOAD, file], { encoding: "utf8", shell: true });
  return { status: r.status, ran: /^ran$/m.test(r.stdout), tail: (r.stdout + r.stderr).slice(-300) };
}

try {
  console.log("\n[1] a failure recorded before PGlite starts still fails the file");
  {
    const r = run("before", "process.exitCode = 1; await sql`select 1`;");
    ok(r.ran && r.status === 1, "ran, and exit 1", `status ${r.status} ran ${r.ran} ${r.tail}`);
  }
  console.log("\n[2] a failure recorded while PGlite is starting, from work the test left running");
  {
    const r = run("during", "void sql`select 1`; process.exitCode = 1;");
    ok(r.ran && r.status === 1, "ran, and exit 1", `status ${r.status} ran ${r.ran} ${r.tail}`);
  }
  console.log("\n[3] control: a file that passes exits 0");
  {
    const r = run("pass", "await sql`select 1`;");
    ok(r.ran && r.status === 0, "ran, and exit 0", `status ${r.status} ran ${r.ran} ${r.tail}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
