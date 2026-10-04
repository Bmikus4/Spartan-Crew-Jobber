// ============================================================================
// SP-51: statements the code has outgrown stay corrected.
// ----------------------------------------------------------------------------
// Each phrase below was true once and became false while the code moved on; a reader
// trusting it would act on the old system (book on src/*, expect an assumed rate card to
// hold an order, restore a cron that only dry-runs). They were corrected on 2026-10-04.
// A phrase coming back fails here; to change one, change the behaviour it describes first.
//
// Offline.  npx tsx test/staleDocs.ts
// ============================================================================
import { readFileSync } from "node:fs";

let fails = 0;
const ok = (cond: boolean, label: string) => { if (!cond) fails++; console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}`); };

const GONE: Array<[file: string, phrase: string, why: string]> = [
  ["README.md", "claude-opus-4.8", "the default model is opus-4.6 (deps.ts)"],
  ["README.md", "src/compiler.ts", "the engine lives in app/lib/engine"],
  ["README.md", "order_mode", "order_mode retired with the staging queue (Q1)"],
  ["README.md", "Not built yet", "everything on that list was built"],
  ["CLAUDE.md", "117-file", "the runner finds its own files; any count goes stale"],
  ["docs/JOB-IDENTITY-DESIGN-2026-09-29.md", "Nothing here is built", "steps 1-5 and 6.1 are built"],
  ["app/lib/engine/reconcile.ts", "the ONLY working", "the nested order read expands blocks too"],
  ["app/lib/engine/amendOrder.ts", "simply cannot be read through this API", "orderWithBlocks reads the SlotLocation"],
  ["app/lib/deps.ts", "Still a DRAFT and never a send", "sending exists, gated by replySendArmed"],
  ["app/lib/mail/gmailWrite.ts", "A DRAFT, never a send", "sendDraft exists, gated by replySendArmed"],
  ["app/lib/engine/pipeline.ts", "An ASSUMED rate is never written hands-free", "an assumed rate books with a flag since 08-27"],
  ["app/lib/engine/pipeline.ts", "The ONE case that still holds is money", "the money hold went on 08-27"],
  ["app/lib/engine/compiler.ts", "staging it is the whole point", "orders go to OnSinch as To Confirm (Q1)"],
  ["app/api/mail-poll/route.ts", "\"/api/reconcile\",      \"schedule\"", "a cron GET of /api/reconcile is a dry run"],
];

for (const [file, phrase, why] of GONE) ok(!readFileSync(file, "utf8").includes(phrase), `${file}: "${phrase}" is gone (${why})`);

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
