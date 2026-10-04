// ============================================================================
// SP-52: .env.example lists every environment variable the app reads.
// ----------------------------------------------------------------------------
// There was no .env.example, so the only list of what a deploy needs was the code itself
// (58 names). A name read in app/ and missing from the file fails here; regenerate with
// `node scripts/env-names.mjs`. The file carries names only, never a value.
//
// Offline.  npx tsx test/envExample.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { envNames } from "../scripts/env-names.mjs";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const file = readFileSync(".env.example", "utf8");
const listed = new Set([...file.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
const read = [...(envNames("app") as Map<string, string>).keys()];

const missing = read.filter((n) => !listed.has(n));
ok(missing.length === 0, `every name the app reads is listed (${read.length})`, missing.join(", "));
const valued = [...file.matchAll(/^([A-Z][A-Z0-9_]*)=(.+)$/gm)].map((m) => m[1]);
ok(valued.length === 0, "and no line carries a value", valued.join(", "));

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
