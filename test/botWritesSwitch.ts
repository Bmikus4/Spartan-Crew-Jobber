// ============================================================================
// THE MASTER SWITCH (Ben, 2026-10-21): "allow a master order and update switch in the settings".
// The bot creates and updates orders for real clients only when Settings bot_writes_enabled is on
// AND the server's SPARTAN_WRITES=live; off by default, and a settings read that fails is off.
// Offline.  npx tsx test/botWritesSwitch.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../app/lib/engine/types";
import { coerceSettings } from "../app/lib/settingsDb";
let fails = 0;
const ok = (c: boolean, m: string, d = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + d}`); if (!c) fails++; };

(async () => {
  for (const k of ["DATABASE_URL", "POSTGRES_URL", "STORAGE_DATABASE_URL"]) delete process.env[k];
  const { botWrites } = await import("../app/lib/v2/process");
  process.env.SPARTAN_WRITES = "off";
  ok(await botWrites() === false, "the server switch off: no writes, whatever Settings says");
  process.env.SPARTAN_WRITES = "live";
  ok(DEFAULT_SETTINGS.bot_writes_enabled === false && await botWrites() === false, "the server on and Settings at its default: still no writes (off by default)");
  ok(coerceSettings({ bot_writes_enabled: true }).bot_writes_enabled === true && !("bot_writes_enabled" in coerceSettings({ bot_writes_enabled: "yes" })), "the switch saves a true or false, nothing else");

  const src = readFileSync("app/lib/v2/process.ts", "utf8");
  ok(!/testOnly: !v2Writes\(\)|execute: v2Writes\(\)|!v2Writes\(\)\) continue/.test(src), "no write path reads the server switch alone");
  ok(/execute: await botWrites\(\)/.test(src) && /testOnly: !\(await botWrites\(\)\)/.test(src) && /testOnly: !writing/.test(src), "intake, the bot's runner and the minute retry all ask the master switch");
  ok(/\.catch\(\(\) => false\)/.test(src.slice(src.indexOf("export async function botWrites"), src.indexOf("export async function botWrites") + 400)), "a settings read that fails is off");
  const screen = readFileSync("app/components/SettingsScreen.tsx", "utf8");
  ok((screen.match(/label="Bot orders and updates"/g) ?? []).length === 1, "Settings shows the one master switch");
  console.log(fails ? `\n${fails} FAILED` : "\nall passed");
  process.exit(fails ? 1 : 0);
})();
