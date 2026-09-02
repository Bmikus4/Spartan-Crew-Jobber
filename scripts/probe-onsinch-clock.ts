// ============================================================================
// WHAT FRAME DOES OnSinch KEEP A SLOT TEAM'S WINDOW IN?
// ----------------------------------------------------------------------------
// The engine stamps a client's wall clock with a fixed "+00:00". Whether that is
// right depends entirely on what OnSinch does with the offset, and the tenant's
// own data cannot answer it: `Job.min_beginning` and `Job.max_end` on the live
// orders disagree about which frame they are in, and every order old enough to
// compare has been edited by somebody since.
//
// So it is measured, on TEST company 515, with one block whose window is known:
// a BST date, 09:00 to 17:00, sent as "+00:00".
//
//   min_beginning = 08:00  ->  OnSinch READ our stamp as London local and stored a
//                              true instant. The engine's "+00:00" is CORRECT and
//                              adding an offset would book every job an hour early.
//   min_beginning = 09:00  ->  the offset was honoured; a UK 09:00 was booked as
//                              09:00 UTC, i.e. 10:00 on the client's clock, and the
//                              engine needs the real offset.
//
// max_end is printed beside it, because the live orders imply the two fields are
// NOT in the same frame and that is worth knowing either way.
//
// It ledgers the created id to disk BEFORE the call that creates it, and deletes it
// at the end. Run with --keep to leave it on the tenant.
//
//   npx tsx scripts/probe-onsinch-clock.ts [--keep]
// ============================================================================
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";

const KEEP = process.argv.includes("--keep");
const TEST_COMPANY = 515;
const USER = 2257;
const DAY = "2027-07-14"; // a Wednesday, comfortably inside BST
const LEDGER = ".tmp-data/clock-probe.json";

function env(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
}

// .env.local, since this runs outside Next.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const client = new OnsinchClient(
    httpTransport({ baseUrl: env("ONSINCH_BASE_URL"), apiKey: env("ONSINCH_API_KEY") })
  );

  mkdirSync(".tmp-data", { recursive: true });
  writeFileSync(LEDGER, JSON.stringify({ intent: "clock probe", day: DAY, at: new Date().toISOString() }, null, 1));

  const created = await client.createOrder([
    {
      name: `CLOCK PROBE ${DAY} — delete me`,
      company_id: TEST_COMPANY,
      user_id: USER,
      order_manager_id: USER,
      specification: "Timezone probe. 09:00-17:00 sent as +00:00 on a BST date.",
      request_approval: true,
      // An EMPTY SlotTeam array on the create, then one POST /slotTeams — the id
      // custody shape the engine itself uses, so the probe measures the real path.
      Job: { name: `clock probe ${DAY}`, pricelist_category_id: 197 },
      SlotTeam: [],
    },
  ]);
  const order_id = Number((created as { id: number }).id);
  writeFileSync(LEDGER, JSON.stringify({ order_id, day: DAY, at: new Date().toISOString() }, null, 1));
  console.log(`created order ${order_id} (ledgered to ${LEDGER})`);

  /**
   * The job id comes from GET /orders?with=Job, NOT from slotTeamsForOrder. An order
   * raised through the API logs one audit row — `order_created_via_api`, path
   * `Order:<id>` — and no per-child rows at all, so the audit route reads the job id
   * for a UI-raised order only and returns nothing here.
   */
  const first = await client.orderById(order_id);
  const jobRow = Array.isArray((first as any)?.Job) ? (first as any).Job[0] : (first as any)?.Job;
  const job_id = Number(jobRow?.id);
  if (!Number.isInteger(job_id)) throw new Error("no job id came back for the probe order");

  const team = await client.createSlotTeam({
    job_id,
    name: "clock probe block",
    size: 2,
    profession_id: 1,
    place_id: 49,
    beginning: `${DAY}T09:00:00+00:00`,
    end: `${DAY}T17:00:00+00:00`,
  });
  console.log(`created slot team ${team.id} with 09:00-17:00 +00:00`);

  const back = await client.orderById(order_id);
  const job = Array.isArray((back as any)?.Job) ? (back as any).Job[0] : (back as any)?.Job;
  console.log("\nSENT      beginning 09:00+00:00   end 17:00+00:00");
  console.log(`READ BACK min_beginning ${job?.min_beginning}   max_end ${job?.max_end}`);

  const h = (s: string) => Number(String(s).slice(11, 13));
  const bh = h(job?.min_beginning), eh = h(job?.max_end);
  console.log(
    `\nSTART: sent 09, read ${String(bh).padStart(2, "0")} -> ` +
      (bh === 8 ? "read as LONDON LOCAL, stored as a true instant. \"+00:00\" is CORRECT."
        : bh === 9 ? "the offset was HONOURED. A UK 09:00 became 09:00 UTC = 10:00 local."
        : "neither — look at it by hand.")
  );
  console.log(
    `END:   sent 17, read ${String(eh).padStart(2, "0")} -> ` +
      (eh === bh + 8 ? "same frame as the start." : "A DIFFERENT FRAME FROM THE START.")
  );

  if (!KEEP) {
    await client.deleteOrders([order_id]);
    console.log(`\ndeleted order ${order_id}`);
    writeFileSync(LEDGER, JSON.stringify({ order_id, deleted: true, at: new Date().toISOString() }, null, 1));
  } else {
    console.log(`\nkept order ${order_id} on TEST ${TEST_COMPANY} — delete it when done`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
