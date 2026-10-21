// ============================================================================
// The help assistant's guide names only what the screens show.
// ----------------------------------------------------------------------------
// The assistant answers from app/lib/help/knowledge.ts and nothing else, so a stale guide is a
// confidently wrong assistant. House of Hud's copy of it proved the point: its guide went seven
// weeks without an edit while 133 UI commits changed the screens, and on 2026-10-21 it answered 18
// of 40 questions wrong, the same on every repeat. The TV here changes weekly, so this ties the
// two together:
//   [1] every **bold** phrase in the guide, the greeting and the prompt starts a string or JSX
//       text in the shipped UI (the screens, the TV's card and feed wording, the Gmail labels),
//       comments stripped. Bold is for labels only, so a renamed label fails here;
//   [2] every rail item is named in bold;
//   [3] retired names stay out.
//
// NEGATIVE CONTROLS (each applied, run, confirmed red, reverted, confirmed green):
//   - "**Order Needs Updated**" changed to "**Order Needs Built**"  : [3] failed ([1] cannot see it:
//     threadLabels.ts still spells the old name, to rename it in place)
//   - "**Jobs Board**" unbolded everywhere in the guide             : [2] failed
//
// Run: npx tsx test/helpGuide.ts
// ============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { HELP_GREETING, HELP_KNOWLEDGE } from "../app/lib/help/knowledge";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e)) files.push(p);
  }
})("app/components");
files.push("app/page.tsx", "app/lib/mail/threadLabels.ts");
for (const e of readdirSync("app/lib/feed")) if (/\.ts$/.test(e)) files.push(join("app/lib/feed", e));

// Comments are stripped: a label that survives only in a comment about its removal is gone.
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const UI = files.map((f) => strip(readFileSync(f, "utf8"))).join("\n");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A label must START a string literal or a run of JSX text and end at a word boundary: a bare
// substring test would let "Send" or "Done" pass on any identifier containing them.
const shown = (label: string) => new RegExp(`["'\`>]\\s*${escape(label)}(?![A-Za-z0-9])`, "i").test(UI);

const route = readFileSync("app/api/help/route.ts", "utf8");
const PROMPT = route.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] ?? "";
const bolds = (s: string) => [...s.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());

console.log("\n[1] every bold phrase is a label the UI shows");
const phrases = [...new Set([...bolds(HELP_KNOWLEDGE), ...bolds(HELP_GREETING), ...bolds(PROMPT)])];
ok(phrases.length > 50, `${phrases.length} bold labels read (bold still means a label)`);
const missing = phrases.filter((p) => !shown(p));
ok(missing.length === 0, "none is missing from the shipped UI", missing.join(" | "));

console.log("\n[2] every rail item is named in bold");
const sidebar = readFileSync("app/components/Sidebar.tsx", "utf8");
const rail = [...sidebar.matchAll(/\{ id: "[a-z]+", label: "([^"]+)"/g)].map((m) => m[1]);
ok(rail.length >= 3, `${rail.length} rail items read from Sidebar.tsx`, rail.join(", "));
const named = new Set(bolds(HELP_KNOWLEDGE).map((b) => b.toLowerCase()));
const unnamed = rail.filter((l) => !named.has(l.toLowerCase()));
ok(unnamed.length === 0, "the guide names each of them", unnamed.join(", "));

console.log("\n[3] retired names stay out of the guide, the greeting and the prompt");
// "Built" was renamed to "Created" on 2026-10-15; the Everything tab went on 2026-10-21.
const RETIRED = ["Order Built", "Order Needs Built", "Everything tab", "Hud Assistant", "Kairo"];
const text = `${HELP_KNOWLEDGE}\n${HELP_GREETING}\n${PROMPT}`.toLowerCase();
const back = RETIRED.filter((r) => text.includes(r.toLowerCase()));
ok(back.length === 0, "none is back", back.join(", "));

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
