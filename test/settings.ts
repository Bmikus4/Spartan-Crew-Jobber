// ============================================================================
// The settings whitelist. Ben asked for exactly two reply controls - a master
// on/off, and draft-vs-send - both defaulting to the safe side.
//
// This exists because the POST route accepted ONLY order_mode: the Settings
// screen's replies toggle POSTed replies_enabled, the route dropped it on the
// floor, and the toggle appeared to work while changing nothing. A whitelist
// that silently discards valid input is worse than a loud rejection, so the
// round-trip is pinned here.
//
// Run: npx tsx test/settings.ts
// ============================================================================
import { DEFAULT_SETTINGS, type Settings } from "../app/lib/engine/types";
// The REAL whitelist and the REAL wire rule - not reimplementations, so this
// test cannot drift away from what the route actually does.
import { coerceSettings, replyDeliveryForWire } from "../app/lib/settingsDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const whitelist = coerceSettings;
/** saveSettings' merge, minus the database. */
const merge = (stored: Settings, body: unknown): Settings => ({ ...stored, ...coerceSettings(body) });

console.log("\n[1] the launch defaults are the safe ones");
ok(DEFAULT_SETTINGS.order_mode === "draft-only", "order_mode draft-only", DEFAULT_SETTINGS.order_mode);
ok(DEFAULT_SETTINGS.replies_enabled === false, "replies OFF");
ok(DEFAULT_SETTINGS.reply_delivery === "draft", "delivery DRAFT", DEFAULT_SETTINGS.reply_delivery);

console.log("\n[2] every setting survives the round trip (the bug)");
{
  // exactly what SettingsScreen POSTs when the replies toggle is flipped on
  const posted = { ...DEFAULT_SETTINGS, replies_enabled: true };
  const saved = merge(DEFAULT_SETTINGS, posted);
  ok(saved.replies_enabled === true, "replies_enabled persisted (was silently dropped)");
  ok(saved.order_mode === "draft-only", "order_mode untouched");
}
{
  const saved = merge({ ...DEFAULT_SETTINGS, replies_enabled: true }, { reply_delivery: "send" });
  ok(saved.reply_delivery === "send", "reply_delivery persisted");
  ok(saved.replies_enabled === true, "other fields not clobbered by a partial update");
}
{
  const saved = merge(DEFAULT_SETTINGS, { order_mode: "auto" });
  ok(saved.order_mode === "auto", "order_mode persisted");
  ok(saved.replies_enabled === false, "a partial update leaves the rest alone");
}

console.log("\n[3] junk is rejected without disturbing what is stored");
{
  const stored: Settings = { order_mode: "auto", replies_enabled: true, reply_delivery: "send" };
  const saved = merge(stored, { order_mode: "yolo", replies_enabled: "yes", reply_delivery: "post" });
  ok(saved.order_mode === "auto", "bad order_mode ignored", saved.order_mode);
  ok(saved.replies_enabled === true, "non-boolean replies_enabled ignored");
  ok(saved.reply_delivery === "send", "bad reply_delivery ignored", saved.reply_delivery);
  ok(Object.keys(whitelist({ nonsense: 1 })).length === 0, "unknown keys never reach the store");
}

console.log("\n[4] replies OFF forces delivery to draft on the wire");
{
  // the real rule /api/n8n-inbound applies before reporting to n8n
  const wire = replyDeliveryForWire;
  ok(wire({ ...DEFAULT_SETTINGS, replies_enabled: false, reply_delivery: "send" }).delivery === "draft",
    "delivery=send while replies are off can never send");
  ok(wire({ ...DEFAULT_SETTINGS, replies_enabled: false }).enabled === false, "enabled reported false");
  ok(wire({ ...DEFAULT_SETTINGS, replies_enabled: true, reply_delivery: "send" }).delivery === "send",
    "send honoured once replies are on");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
