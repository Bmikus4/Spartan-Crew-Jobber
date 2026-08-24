// ============================================================================
// Does a POST /orders create leave slot-team ids behind? (It does not. Ever.)
// ----------------------------------------------------------------------------
// THIS FILE USED TO ASK "is this a SERVICE key or a PERSON'S key?" and that question was
// incoherent, 2026-08-24. It creates through `POST /orders`, and an API create logs ONE
// childless `order_created_via_api` row **whatever key sent it** — so the old version
// could only ever answer "a person's key", for every key in existence, and sent a reader
// off to obtain one that does not exist.
//
// What actually differs is the ROUTE. Orders raised in the OnSinch UI log `order_create`
// plus a child row per Job, SlotTeam and Slot, each carrying its id; orders created
// through the API log one row and no ids. `creator` is never null anywhere in this
// tenant — 2,400 sampled audit rows, 800 most-recent orders, zero nulls — and there is no
// api/integration role among the 17. See §12 of docs/Spartan-Crew-Onsinch-API-Reference.md.
//
// So this is kept as a DEMONSTRATION of that fact, not a key test: it writes one order,
// reads the audit trail back, and shows you the childless row. If you are here because
// an amendment declined, the answer is not a different key — it is that the engine must
// create each block with `POST /slotTeams`, which RETURNS the id. Custody by
// construction. `POST /orders` with `SlotTeam: []` is legal (201) precisely so that can
// be done.
//
// Runs on TEST company 515 ("TEST - Eventz", hardcoded), and then deletes the order.
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

  const readable = slotTeamIds > 0;
  console.log(
    readable
      ? "\n  => Nested slot team ids came back, which contradicts everything measured on\n" +
          "     2026-08-24. Do not celebrate — re-read §12 of the API reference and work out\n" +
          "     which assumption changed, because the amendment path depends on this answer." +
          (slotIds > 0 ? "\n     Slot ids are recorded too, so scripts/verify-shrink-staffed.ts can run." : "")
      : "\n  => NO IDS, as expected. An API create always logs one childless\n" +
          "     `order_created_via_api` row — this is the ROUTE, not the key, so no other key\n" +
          "     will change it and there is no service key to go and get.\n" +
          "     To amend in place, the engine must create each block via POST /slotTeams and\n" +
          "     keep the id it returns. See §12 of docs/Spartan-Crew-Onsinch-API-Reference.md."
  );
  // Exit 0: this is the CORRECT and only outcome for an API create, so a green run means
  // "measured, as documented". It used to exit 1 here, which read as a fault to fix.
  process.exit(0);
})();
