// ============================================================================
// The live feed reads. It never changes how an order is processed.
// ----------------------------------------------------------------------------
// The office TV may write exactly one thing: its own records in feed_marks / feed_meta.
// It must never write OnSinch (those writes are real), never Gmail, and never
// conversation_state, and since 31 Oct it never reads OnSinch either: whether a need is
// done is the minute sync's mark (loop/cards.ts). [1] reads every feed source for an
// OnSinch transport; [2] reads every feed source for a write it could make.
// Run: npx tsx test/feedReadsOnly.ts
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const files: string[] = [];
for (const dir of ["app/lib/feed", "app/api/feed"]) (function walk(d: string) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(e)) files.push(p); } })(dir);
files.push("app/components/LiveFeedScreen.tsx");
// Code only: a comment explaining why the feed does NOT call flagBuiltIfNeeded is not a call.
const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

console.log("\n[1] no feed source reaches OnSinch");
ok(files.length >= 9, `${files.length} files read`, files.join(" "));
for (const f of files) ok(!/httpTransport|OnsinchClient|onsinch\/onsinch"/.test(code(f)), `${f}: no OnSinch transport or client`);

console.log("\n[2] no feed source can write anything of the engine's");
for (const f of files) {
  const src = code(f);
  const sqlWrites = [...src.matchAll(/\b(?:INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)|\bUPDATE\s+(\w+)\s+SET\b/gi)].map((m) => m[1] ?? m[2]).filter((t) => !/^(feed_marks|feed_meta)$/i.test(t));
  ok(sqlWrites.length === 0, `${f}: SQL writes only feed_marks/feed_meta`, sqlWrites.join(","));
  ok(!/stateDb|NeonStateStore|\.put\(|gmailWrite|lib\/deps|executor\(|flag(Manual|Built|Updated)IfNeeded/.test(src), `${f}: no state store, Gmail writer or engine executor`);
  ok(!/["'](POST|PATCH|PUT|DELETE)["']\s*,\s*["']\//.test(src), `${f}: no OnSinch write verb`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exitCode = fails ? 1 : 0;
