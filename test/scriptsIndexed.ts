// ============================================================================
// Every script is in scripts/README.md with what it can touch, read from its own code (ADDENDUM R21).
// ----------------------------------------------------------------------------
// A script added, or one that starts writing, fails here until `node scripts/scripts-index.mjs` is run again,
// so the index cannot fall behind the scripts. The classifier is checked on made-up code in both directions.
// Offline.  npx tsx test/scriptsIndexed.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { index, readme, classOf } from "../scripts/scripts-index.mjs";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

console.log("\n[index] scripts/README.md is the index the scripts make now");
const want: string = readme(index());
const have = readFileSync("scripts/README.md", "utf8").replace(/\r\n/g, "\n");
const diff = want.split("\n").filter((l: string) => !have.split("\n").includes(l)).slice(0, 5);
ok(diff.length === 0, "nothing missing or reclassified (run node scripts/scripts-index.mjs)", diff);

console.log("\n[classes] what the code shows decides the class");
ok(classOf("await sql`DELETE FROM job_links WHERE x`") === "writes: database", "a DELETE writes the database");
ok(classOf("await fetch(`${N8N}/api/v1/workflows/${id}`, { method: \"PUT\" })") === "writes: n8n", "a PUT to n8n's workflows writes n8n");
ok(classOf("const t = httpTransport(...onsinch...); await t.post('/orders', o)") === "writes: OnSinch", "a POST to OnSinch writes OnSinch");
ok(classOf("import { readOnlySql } from './_readonly.mts'; await ro`SELECT 1`") === "reads production (read-only transaction)", "a _readonly script reads only");
ok(classOf("const rows = JSON.parse(readFileSync('eval/x.json', 'utf8'))") === "offline", "control: a script on local files is offline");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exitCode = fails ? 1 : 0;
