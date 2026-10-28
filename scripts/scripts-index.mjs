// ============================================================================
// What each script in scripts/ can touch, read from its own code, and the index (scripts/README.md) made from it.
// ----------------------------------------------------------------------------
// 136 scripts sat side by side with nothing saying which write to production, OnSinch, n8n or Gmail (the V1
// review, ADDENDUM R21). The class is found in the code, not the name, so a script that starts writing moves
// class and test/scriptsIndexed.ts fails until the index is made again:
//   node scripts/scripts-index.mjs          writes scripts/README.md
// The signals are deliberately broad: a script flagged as writing that only reads is a nuisance; one that
// writes and is not flagged is the failure this exists to stop.
// ============================================================================
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = "scripts";

/** What a script's text shows it can touch. */
export function signals(text) {
  const s = [];
  if (/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+(TABLE|INDEX)|TRUNCATE|ALTER\s+TABLE|CREATE\s+(TABLE|INDEX))\b/i.test(text)) s.push("database");
  if (/onsinch/i.test(text) && /method:\s*["'](POST|PUT|PATCH|DELETE)|\.(post|put|patch|delete)\(|runOp\(|apiCreateOrder|openBot\(/i.test(text)) s.push("OnSinch");
  if (/n8n/i.test(text) && /(workflows|credentials)/.test(text) && /method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(text)) s.push("n8n");
  if (/gmail/i.test(text) && /\b(modify|batchModify|drafts|messages\/send)\b/.test(text)) s.push("Gmail");
  if (/\/api\/bot\/|canary/i.test(text)) s.push("bot routes");
  return s;
}

/**
 * writes (with what), reads production, or offline. A script whose only database is readOnlySql cannot write
 * it, whatever SQL it holds; _readonly.mts itself names the statements its server refuses.
 */
export function classOf(text) {
  const readOnly = /readOnlySql/.test(text) && (!/neon\(/.test(text) || /export function readOnlySql/.test(text));
  const w = signals(text).filter((x) => !(readOnly && x === "database"));
  if (w.length) return `writes: ${w.join(", ")}`;
  if (/_readonly/.test(text)) return "reads production (read-only transaction)";
  if (/DATABASE_URL|POSTGRES_URL|neon\(|onsinch\.com|ONSINCH_API_KEY|N8N_|GMAIL_|fetch\(/.test(text)) return "reads production";
  return "offline";
}

/** The script's first comment line: what it says it is for. */
export function purposeOf(text) {
  for (const line of text.split(/\r?\n/).slice(0, 25)) {
    const m = line.match(/^\s*(?:\/\/|#|\*)\s*(?!=+$|-+$|!|eslint|@ts-|usage|run:|npx |node |python )(.{12,})$/i);
    if (m && !/^[=\-*\s]+$/.test(m[1])) return m[1].trim().replace(/\|/g, "/").slice(0, 140);
  }
  return "";
}

export function scriptFiles() {
  return readdirSync(DIR).filter((f) => statSync(join(DIR, f)).isFile() && f !== "README.md").sort();
}

export function index() {
  const npm = JSON.stringify(JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {});
  return scriptFiles().map((f) => {
    const text = readFileSync(join(DIR, f), "utf8");
    return { file: f, cls: classOf(text), npm: npm.includes(f), purpose: purposeOf(text) };
  });
}

export function readme(rows) {
  const order = (c) => (c.startsWith("writes") ? 0 : c.startsWith("reads production") ? 1 : 2);
  const sorted = [...rows].sort((a, b) => order(a.cls) - order(b.cls) || a.file.localeCompare(b.file));
  const n = (p) => rows.filter((r) => p(r.cls)).length;
  return [
    "# scripts/: what each one can touch",
    "",
    "Made by `node scripts/scripts-index.mjs` from each script's own code; test/scriptsIndexed.ts fails when a script",
    "is missing here or its class has changed. **Never run a script marked writes without reading it first**: the gate",
    "(scripts/session.py) is the only sanctioned way to ship, and production is read only through scripts/_readonly.mts.",
    "",
    `${rows.length} scripts: ${n((c) => c.startsWith("writes"))} can write, ${n((c) => c.startsWith("reads production"))} read production, ${n((c) => c === "offline")} are offline. npm marks the ones package.json runs.`,
    "",
    "| script | can touch | npm | what it says it is for |",
    "|---|---|---|---|",
    ...sorted.map((r) => `| ${r.file} | ${r.cls} | ${r.npm ? "npm" : ""} | ${r.purpose} |`),
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(DIR, "README.md"), readme(index()));
  console.log(`scripts/README.md: ${scriptFiles().length} scripts`);
}
