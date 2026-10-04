// ============================================================================
// SP-17: a settings read or write that fails is a failure, not the defaults.
// ----------------------------------------------------------------------------
// getSettings swallowed a database error and returned DEFAULT_SETTINGS, so a Neon blip
// priced the next order at the default rate card; saveSettings logged its error and
// returned the merged value, so the screen said "saved" for a write that never happened.
// Both now throw when a database is configured. With no database (a local run) the
// defaults stand. The SQL is injected; nothing here reaches a real database.
//
// Offline.  npx tsx test/settingsFailClosed.ts
// ============================================================================
import { getSettings, saveSettings } from "../app/lib/settingsDb";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const rejects = async (p: Promise<unknown>) => { try { await p; return false; } catch { return true; } };

/** A tagged-template SQL function that fails every query, as Neon does when it is down. */
const down = (async () => { throw new Error("neon: fetch failed"); }) as any;

async function main() {
  console.log("\n[1] the database is down");
  ok(await rejects(getSettings(down)), "getSettings rejects instead of returning the defaults");
  ok(await rejects(saveSettings({ replies_enabled: true }, down)), "saveSettings rejects instead of claiming it saved");

  console.log("\n[2] no database configured: a local run keeps the defaults");
  const local = await getSettings(null);
  ok(local.default_rate_card === DEFAULT_SETTINGS.default_rate_card && local.replies_enabled === DEFAULT_SETTINGS.replies_enabled,
    "defaults, as before");

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
