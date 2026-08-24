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
import { buildOrderBody } from "../app/lib/engine/format";
import type { DesiredOrder } from "../app/lib/engine/types";

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

  const shell: DesiredOrder = {
    name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
    provisional: true, quote: false, pricelist_category_id: 122,
    job_name: "X @ Y", slot_teams: [],
  };

  console.log("\nthe blockless order body");
  const body = buildOrderBody(shell)[0] as any;
  // OMITTING the key is a 400 ("Please fill the SlotTeam for this Order"); an EMPTY
  // ARRAY is a 201. The difference is the whole two-phase create, so it is pinned.
  ok("SlotTeam" in body, "SlotTeam is present as a key");
  ok(Array.isArray(body.SlotTeam) && body.SlotTeam.length === 0, "and it is an empty array",
     JSON.stringify(body.SlotTeam));
  ok(body.Job && body.Job.pricelist_category_id === 122, "the Job and its rate card still ride along");
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
