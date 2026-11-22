// ============================================================================
// Stop B (Ben, 21 Nov): every setting but Needs Created is the Samurai team's.
// ----------------------------------------------------------------------------
// The Samurai team is Ben's two addresses, any samuraisolutions.co.uk address and the break-glass
// session (apiAuth isSwitchAdmin). Anyone else signed in, Spartan's staff included, is a client: the
// GET answers them with needs_created_enabled alone, and the POST refuses a body naming any other
// field, whole. The server is the lock; the screen only hides panels. IO injected.
// npx tsx test/settingsClientLock.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { handleSettingsGet, handleSettingsPost, CLIENT_FIELDS, type SettingsIO } from "../app/lib/routes/settings";
import { isSwitchAdmin } from "../app/lib/apiAuth";
import { DEFAULT_SETTINGS } from "../app/lib/onsinch/types";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

function rig(start: Record<string, unknown> = {}) {
  let stored: Record<string, unknown> = { ...DEFAULT_SETTINGS, replies_enabled: true, default_rate_card: 342, ...start };
  let saves = 0;
  const io: SettingsIO = {
    get: (async () => ({ ...stored })) as unknown as SettingsIO["get"],
    save: (async (next: Record<string, unknown>) => { saves++; stored = { ...stored, ...next }; return stored; }) as unknown as SettingsIO["save"],
    history: async () => {},
    report: (async () => true) as SettingsIO["report"],
  };
  return { io, stored: () => stored, saves: () => saves };
}
const post = (body: unknown) => new Request("http://localhost/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const STAFF = { actor: "paz@spartancrew.co.uk", admin: isSwitchAdmin("paz@spartancrew.co.uk") };
const SAMURAI = { actor: "someone@samuraisolutions.co.uk", admin: isSwitchAdmin("someone@samuraisolutions.co.uk") };
const SERVICE = { actor: "n8n", admin: false };

(async () => {
  console.log("\n[roles]");
  ok(STAFF.admin === false && SAMURAI.admin === true, "a Spartan address is a client; a samuraisolutions.co.uk address is Samurai", { STAFF, SAMURAI });
  ok(CLIENT_FIELDS.length === 1 && CLIENT_FIELDS[0] === "needs_created_enabled", "the client sees and sends Needs Created alone", CLIENT_FIELDS);

  console.log("\n[GET] a client is answered with Needs Created alone");
  for (const [who, caller] of [["staff", STAFF], ["the webhook secret", SERVICE], ["no caller given", undefined]] as const) {
    const r = rig({ needs_created_enabled: true });
    const body = await (await handleSettingsGet(r.io, caller)).json() as Record<string, unknown>;
    ok(JSON.stringify(Object.keys(body).sort()) === JSON.stringify(["needs_created_enabled", "samurai"]) && body.needs_created_enabled === true && body.samurai === false,
      `${who}: { needs_created_enabled, samurai: false } and nothing else`, body);
  }
  {
    const r = rig({ needs_created_enabled: "yes" });
    const body = await (await handleSettingsGet(r.io, STAFF)).json() as Record<string, unknown>;
    ok(body.needs_created_enabled === false, "a stored value that is not exactly true reads as off, as the TV applies it (S-0338)", body);
  }
  {
    const r = rig();
    const body = await (await handleSettingsGet(r.io, SAMURAI)).json() as Record<string, unknown>;
    ok(body.samurai === true && body.replies_enabled === true && body.default_rate_card === 342 && "bot_writes_enabled" in body && "create_lead_days" in body,
      "the Samurai team gets every setting", Object.keys(body));
  }
  {
    const down = { get: async () => { throw new Error("neon down"); } } as unknown as SettingsIO;
    ok((await handleSettingsGet(down, STAFF)).status === 500 && (await handleSettingsGet(down, SAMURAI)).status === 500, "a failed read is a 500 for both, never a quiet default");
  }

  console.log("\n[POST] a client may send Needs Created and nothing else");
  {
    const r = rig();
    const res = await handleSettingsPost(post({ needs_created_enabled: true }), r.io, STAFF);
    const body = await res.json() as any;
    ok(res.status === 200 && r.stored().needs_created_enabled === true, "staff turns Needs Created on: saved", { status: res.status });
    ok(JSON.stringify(Object.keys(body.settings)) === JSON.stringify(["needs_created_enabled"]), "and the answer carries their own field only", body.settings);
  }
  for (const field of ["test_data_autoclear", "intake_paused", "default_rate_card", "reply_scope", "replies_enabled", "bot_writes_enabled", "create_lead_days", "bot_write_classes"]) {
    const value = { test_data_autoclear: true, intake_paused: true, default_rate_card: 245, reply_scope: "enquiries", replies_enabled: false, bot_writes_enabled: true, create_lead_days: 3, bot_write_classes: {} }[field];
    for (const [who, caller] of [["staff", STAFF], ["the webhook secret", SERVICE]] as const) {
      const r = rig();
      const before = JSON.stringify(r.stored());
      const res = await handleSettingsPost(post({ [field]: value }), r.io, caller);
      ok(res.status === 403 && r.saves() === 0 && JSON.stringify(r.stored()) === before, `${who} sends ${field}: 403, nothing saved`, { status: res.status });
    }
  }
  {
    const r = rig();
    const res = await handleSettingsPost(post({ needs_created_enabled: true, test_data_autoclear: true }), r.io, STAFF);
    ok(res.status === 403 && r.saves() === 0 && r.stored().needs_created_enabled === false, "Needs Created alongside a Samurai field: refused whole, not trimmed", { status: res.status });
    const full = await handleSettingsPost(post({ ...r.stored() }), r.io, STAFF);
    ok(full.status === 403 && r.saves() === 0, "the whole settings row re-posted unchanged: refused", { status: full.status });
    const junk = await handleSettingsPost(post({ nonsense: 1 }), r.io, STAFF);
    const none = await handleSettingsPost(post({}), r.io, STAFF);
    const arr = await handleSettingsPost(post([true]), r.io, STAFF);
    ok(junk.status === 403 && none.status === 403 && arr.status === 403 && r.saves() === 0, "an unknown field, an empty body or an array: refused");
  }

  console.log("\n[POST] the Samurai team may change everything");
  {
    const r = rig();
    const res = await handleSettingsPost(post({ needs_created_enabled: true, test_data_autoclear: true, intake_paused: true, reply_scope: "enquiries", bot_writes_enabled: true }), r.io, SAMURAI);
    const s = r.stored();
    ok(res.status === 200 && s.needs_created_enabled === true && s.test_data_autoclear === true && s.intake_paused === true && s.reply_scope === "enquiries" && s.bot_writes_enabled === true,
      "saved in one body", { status: res.status });
  }

  console.log("\n[screen] the Settings screen sends only the field that changed");
  {
    // A client's save of the whole row would be refused (above), so every save must post its patch alone.
    const src = readFileSync("app/components/SettingsScreen.tsx", "utf8");
    ok(!/save\(\{\s*\.\.\.s\b/.test(src), "no save() spreads the current row into its body");
    ok(/body: JSON\.stringify\(patch\)/.test(src), "the POST body is the patch");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
