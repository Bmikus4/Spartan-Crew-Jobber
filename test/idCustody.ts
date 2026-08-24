// ============================================================================
// The ids the engine created must survive the compile seam.
// ----------------------------------------------------------------------------
// last_ordered_teams was correct and unreachable for weeks because compile()
// built its next state without carrying it, so every second email saw undefined.
// This field has the same failure mode and the same consequence — an amendment
// that silently cannot address the blocks it owns — so the seam is pinned before
// anything writes to it.
//
// Run: npx tsx test/idCustody.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = readFileSync(join(ROOT, "app/lib/engine/compiler.ts"), "utf8");
const types = readFileSync(join(ROOT, "app/lib/engine/types.ts"), "utf8");

async function main() {
  console.log("the compile seam");
  ok(/last_ordered_team_ids\?\: number\[\]/.test(types), "ConversationState declares last_ordered_team_ids");
  ok(
    /last_ordered_team_ids:\s*prior\?\.last_ordered_team_ids/.test(compiler),
    "compile() carries last_ordered_team_ids forward from prior state"
  );
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
