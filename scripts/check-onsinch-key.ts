// ============================================================================
// Is this OnSinch key a SERVICE key or a PERSON'S key?
// ----------------------------------------------------------------------------
// It matters more than it sounds. A create made with a service key logs `order_create`
// plus a child row per Job, SlotTeam and Slot, each carrying its id — which is the only
// route by which a nested slot team's id is ever readable, and therefore the only reason
// an order can be amended in place instead of destroyed and rebuilt. A create made with
// a person's own API key logs ONE childless `order_created_via_api` row: no ids, nothing
// to amend.
//
// There is no endpoint that will tell you which kind you hold — no /apiKeys, /tokens or
// /integrations — and `GET /users/profile` answers with a user either way. The only way
// to know is to write one order and read the audit trail back. So that is what this does,
// on TEST company 515 ("TEST - Eventz", hardcoded), and then deletes it.
//
//   ONSINCH_TEST_KEY=<the key to check> npx tsx scripts/check-onsinch-key.ts
//
// With no ONSINCH_TEST_KEY it checks ONSINCH_API_KEY, the one already in .env.local.
// ============================================================================
import { loadEnv } from "./_env.mjs";

loadEnv();

const base = (process.env.ONSINCH_BASE_URL || "https://spartancrew.onsinch.com/api/v1").replace(/\/$/, "");
const key = (process.env.ONSINCH_TEST_KEY || process.env.ONSINCH_API_KEY || "").trim();
const which = process.env.ONSINCH_TEST_KEY ? "ONSINCH_TEST_KEY" : "ONSINCH_API_KEY";
if (!key) { console.error("Set ONSINCH_TEST_KEY (or ONSINCH_API_KEY) to the key you want checked."); process.exit(2); }

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `apikey ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let data: any = null;
  try { data = t ? JSON.parse(t) : null; } catch { data = t.slice(0, 200); }
  return { status: r.status, data };
};

const DAY = "2027-12-01";

(async () => {
  console.log(`\nchecking ${which} against ${base}`);

  const me = await call("GET", "/users/profile");
  if (me.status !== 200) { console.error(`  the key was rejected: ${me.status} ${JSON.stringify(me.data).slice(0, 200)}`); process.exit(1); }
  console.log(`  authenticates as user ${me.data?.data?.id} (${me.data?.data?.email ?? "no email"})`);

  console.log("\ncreating one throwaway order on TEST company 515…");
  const created = await call("POST", "/orders", [{
    name: "KEY CHECK - safe to delete",
    company_id: 515, user_id: 1591, request_approval: true, provisional: true, quote: false,
    Job: { name: "KEY CHECK - safe to delete", pricelist_category_id: 122 },
    SlotTeam: [{ name: "KEY CHECK", profession_id: 1, beginning: `${DAY}T08:00:00+00:00`, end: `${DAY}T18:00:00+00:00`, size: 2, place_id: 49 }],
  }]);
  const id = Number(created.data?.data?.[0]?.id);
  if (!Number.isInteger(id)) {
    console.error(`  create failed: ${created.status} ${JSON.stringify(created.data).slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`  order #${id} created`);

  const au = await call("GET", `/timelineAudits?limit=100&${encodeURIComponent("data[like]")}=${encodeURIComponent(`%Order:${id}%`)}`);
  const rows = (au.data?.data ?? []) as any[];
  const actions: string[] = [];
  let slotTeamIds = 0, slotIds = 0;
  for (const row of rows) {
    let p: any;
    try { p = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { continue; }
    actions.push(`${row.action}|${p?.model}`);
    if (row.action === "common_create" && p?.model === "SlotTeam") slotTeamIds++;
    if (row.action === "common_create" && p?.model === "Slot") slotIds++;
  }
  console.log(`\n  audit rows: ${rows.length}`);
  console.log(`  actions: ${JSON.stringify(actions)}`);
  console.log(`  slot team ids recorded: ${slotTeamIds}   slot ids recorded: ${slotIds}`);

  const del = await call("DELETE", "/orders", [id]);
  console.log(`\n  deleted order #${id} (${del.status})`);

  const service = slotTeamIds > 0;
  console.log(
    service
      ? "\n  => SERVICE KEY. Nested slot team ids are readable, so this key can amend orders in place." +
          (slotIds > 0 ? "\n     Slot ids are recorded too, so it can also run scripts/verify-shrink-staffed.ts." : "")
      : "\n  => A PERSON'S KEY. Creates log one childless `order_created_via_api` row, so nothing\n" +
          "     created with it can be amended in place. Not the key the engine should use."
  );
  process.exit(service ? 0 : 1);
})();
