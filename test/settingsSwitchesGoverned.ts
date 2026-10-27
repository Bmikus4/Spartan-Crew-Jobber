// ============================================================================
// The write and reply switches are an admin's to change, and every change is kept and reported.
// ----------------------------------------------------------------------------
// Addendum F34 (26 Oct): any signed-in staff member could flip bot_writes_enabled, replies_enabled
// and reply_delivery from Settings, with no record of who or when, and isAdmin was checked nowhere.
// Now a non-admin is refused those three (other settings stay theirs), and each change by an admin
// is stored with its actor and time and raised to the owner as "settings-changed". IO injected.
// npx tsx test/settingsSwitchesGoverned.ts
// ============================================================================
import { handleSettingsPost, type SettingsIO } from "../app/lib/routes/settings";
import { isSwitchAdmin } from "../app/lib/apiAuth";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

function rig() {
  let stored: Record<string, unknown> = { bot_writes_enabled: false, replies_enabled: false, reply_delivery: "draft", create_lead_days: 14 };
  const history: any[] = [], reports: any[] = [];
  const io: SettingsIO = {
    get: (async () => ({ ...stored })) as unknown as SettingsIO["get"],
    save: (async (next: Record<string, unknown>) => { stored = { ...stored, ...next }; return stored; }) as unknown as SettingsIO["save"],
    history: async (row) => { history.push(row); },
    report: (async (a: unknown) => { reports.push(a); return true; }) as SettingsIO["report"],
  };
  return { io, history, reports, stored: () => stored };
}
const post = (body: unknown) => new Request("http://localhost/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  console.log("\n[who] the admin list");
  ok(isSwitchAdmin(null, true), "the break-glass admin session");
  ok(isSwitchAdmin("ben@samuraisolutions.co.uk") && isSwitchAdmin("BenjaminTMikus@gmail.com"), "the owner's addresses, in any case");
  ok(!isSwitchAdmin("paz@spartancrew.co.uk") && !isSwitchAdmin(null), "a staff member, or nobody, is not");
  process.env.SPARTAN_ADMIN_EMAILS = "paz@spartancrew.co.uk";
  ok(isSwitchAdmin("paz@spartancrew.co.uk"), "SPARTAN_ADMIN_EMAILS adds an address");
  delete process.env.SPARTAN_ADMIN_EMAILS;

  console.log("\n[refused] a non-admin cannot flip a switch");
  for (const body of [{ bot_writes_enabled: true }, { replies_enabled: true }, { reply_delivery: "send" }]) {
    const r = rig();
    const res = await handleSettingsPost(post(body), r.io, { actor: "staff@spartancrew.co.uk", admin: false });
    ok(res.status === 403 && r.history.length === 0 && r.stored().bot_writes_enabled === false && r.stored().reply_delivery === "draft", `${Object.keys(body)[0]}: 403, nothing saved`, { status: res.status });
  }
  {
    const r = rig();
    const res = await handleSettingsPost(post({ create_lead_days: 10 }), r.io, { actor: "staff@spartancrew.co.uk", admin: false });
    ok(res.status === 200 && r.stored().create_lead_days === 10 && r.reports.length === 0, "control: other settings stay a signed-in user's, unreported");
    const same = await handleSettingsPost(post({ bot_writes_enabled: false }), r.io, { actor: "staff@spartancrew.co.uk", admin: false });
    ok(same.status === 200 && r.history.length === 0, "re-saving a switch at its current value is no change, so not refused");
  }

  console.log("\n[kept] an admin's change is stored with actor and time, and raised to the owner");
  {
    const r = rig();
    const res = await handleSettingsPost(post({ bot_writes_enabled: true, create_lead_days: 7 }), r.io, { actor: "ben@samuraisolutions.co.uk", admin: true });
    ok(res.status === 200 && r.stored().bot_writes_enabled === true, "saved", { status: res.status });
    const h = r.history[0];
    ok(r.history.length === 1 && h.field === "bot_writes_enabled" && h.from === false && h.to === true && h.actor === "ben@samuraisolutions.co.uk" && !Number.isNaN(Date.parse(h.at)), "one history row: field, from, to, actor, time", r.history);
    ok(r.reports.length === 1 && r.reports[0].route === "settings-changed", "the owner is told: route settings-changed", r.reports);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
