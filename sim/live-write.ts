// ============================================================================
// Does the composed order actually post to OnSinch, and does the destructive path
// really destroy and rebuild? Five orders, on the test company, deleted after.
// ----------------------------------------------------------------------------
//   npx tsx sim/live-write.ts            create, verify, delete
//   npx tsx sim/live-write.ts --keep     create and verify, leave them for eyes
//   npx tsx sim/live-write.ts --cleanup  delete whatever the ledger still lists
//
// The 100-case run is offline and proves the engine builds the right order. It
// cannot prove OnSinch accepts it: every 400 this system has ever produced was a
// field the fixture happily took (a slot team name over 80 characters, a missing
// place_id). So a handful go to the real tenant.
//
// EVERY id IS WRITTEN TO THE LEDGER BEFORE THE CALL THAT CREATES IT, and the
// ledger is on disk, not in memory. A crash between the POST and the response
// still leaves a file naming what to go and delete — which is the same reasoning
// replaceOrder.ts uses for its snapshot, for the same reason.
//
// Company 515 is "TEST - Eventz", whose only contact is accounts@spartancrew.co.uk.
// Nothing here touches a client's account.
// ============================================================================
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "../scripts/_env.mjs";
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { buildOrderBody, validateOrder } from "../app/lib/engine/format";
import { composeOrder } from "../app/lib/engine/compose";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import type { DesiredOrder } from "../app/lib/engine/types";
import { loadProfessions } from "./harness";

const OUT = join(import.meta.dirname, "..", ".tmp-data/sim");
const LEDGER = join(OUT, "live-ledger.json");

/** The designated test account. Verified live: "TEST - Eventz", contact 1591. */
const COMPANY_ID = 515;
const USER_ID = 1591;
/** id 5 — "Spartan Crew", Ffinch Street SE8 5QA. Their own yard. */
const PLACE_ID = 5;
/** 315 — the house standard, measured at 70.3% of orders that carry a card. */
const RATE_CARD = 315;

interface Ledger {
  started: string;
  created: Array<{ id: number; number?: string; label: string; deleted: boolean }>;
}

function readLedger(): Ledger {
  if (existsSync(LEDGER)) return JSON.parse(readFileSync(LEDGER, "utf8"));
  return { started: new Date().toISOString(), created: [] };
}
function writeLedger(l: Ledger) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(l, null, 2));
}

loadEnv();
const key = requireEnv("ONSINCH_API_KEY");
const onsinch = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: key }));
const professions = loadProfessions();

const ledger = readLedger();
const mode = process.argv.includes("--cleanup") ? "cleanup" : process.argv.includes("--keep") ? "keep" : "full";

/** Compose an order the same way the engine does, so what posts is what it builds. */
function order(label: string, requests: Parameters<typeof composeOrder>[0]["facts"]["requests"]): DesiredOrder {
  const r = composeOrder({
    facts: { requests },
    company_id: COMPANY_ID,
    user_id: USER_ID,
    place_id: PLACE_ID,
    pricelist_category_id: RATE_CARD,
    orderName: `SIM ${label} — delete me`,
    jobName: `SIM ${label}`,
    specification: `Simulation probe: ${label}. Created and deleted by sim/live-write.ts.`,
    professions,
  });
  if (!r.order) throw new Error(`${label}: composed nothing`);
  return r.order;
}

const D = "2026-11-18"; // well clear of anything real

/** The five shapes worth spending a real write on. */
const PROBES: Array<{ label: string; requests: Parameters<typeof composeOrder>[0]["facts"]["requests"] }> = [
  {
    label: "carved chief",
    requests: [{ date: D, start_time: "08:00", end_time: "16:00", size: 4, task: "Simulation: 4 crew, one carved chief" }],
  },
  {
    label: "two windows",
    requests: [
      { date: D, start_time: "08:00", end_time: "12:00", size: 6, task: "Simulation: get-in" },
      { date: D, start_time: "14:00", end_time: "18:00", size: 3, task: "Simulation: get-out" },
    ],
  },
  {
    label: "day-rate twin",
    requests: [{ date: D, start_time: "07:00", end_time: "17:00", size: 2, profession_hint: "telehandler", task: "Simulation: plant on a day rate" }],
  },
  {
    label: "name over 80 chars",
    requests: [{
      date: D, start_time: "08:00", end_time: "16:00", size: 5,
      task: "Rig: unloading vans, shunting cases, assist lighting tech putting out lights, hanging mirror balls, working at heights",
    }],
  },
  {
    label: "mixed professions",
    requests: [
      { date: D, start_time: "09:00", end_time: "17:00", size: 5, profession_hint: "chippies", task: "Simulation: carpentry" },
      { date: D, start_time: "09:00", end_time: "17:00", size: 12, task: "Simulation: general crew" },
    ],
  },
];

async function cleanup(): Promise<void> {
  const live = ledger.created.filter((c) => !c.deleted);
  if (!live.length) { console.log("ledger is clean — nothing to delete"); return; }
  console.log(`\ndeleting ${live.length} order(s)`);
  for (const c of live) {
    try {
      await onsinch.deleteOrders([c.id]);
      c.deleted = true;
      writeLedger(ledger);
      console.log(`  deleted #${c.id}  ${c.label}`);
    } catch (err) {
      console.error(`  FAILED to delete #${c.id}: ${(err as Error).message}`);
    }
  }
  // Prove it, rather than trusting the 200.
  for (const c of ledger.created) {
    const still = await onsinch.orderById(c.id);
    console.log(`  #${c.id} ${still ? "STILL PRESENT — delete by hand" : "gone"}`);
  }
}

(async () => {
  console.log(`tenant: ${onsinchBase()}`);
  const me = await onsinch.profile();
  console.log(`token: ${me.status === 200 ? "ok" : "status " + me.status}`);

  if (mode === "cleanup") { await cleanup(); return; }

  const report: Array<Record<string, unknown>> = [];

  for (const probe of PROBES) {
    const o = order(probe.label, probe.requests);
    const errs = validateOrder(o);
    const body = buildOrderBody(o);
    const teams = o.slot_teams.map((t) => `${t.profession_id}x${t.size}`).join(" ");
    console.log(`\n${probe.label}\n  composed: ${o.slot_teams.length} team(s) [${teams}]  validate: ${errs.length ? errs.join("; ") : "clean"}`);
    if (errs.length) { report.push({ label: probe.label, posted: false, refused: errs }); continue; }

    // On the ledger BEFORE the call. An id learned from a response that never
    // arrives is an id nobody can clean up.
    const slot = { id: -1, label: probe.label, deleted: false };
    ledger.created.push(slot);
    writeLedger(ledger);

    try {
      const created = await onsinch.createOrder(body);
      slot.id = created.id;
      (slot as { number?: string }).number = created.number;
      writeLedger(ledger);
      console.log(`  POSTED  api id ${created.id}, R${created.number}`);

      const live = await onsinch.orderById(created.id);
      const job = (live as { Job?: Array<{ id: number; pricelist_category_id?: number }> })?.Job?.[0];
      const readNumber = (live as { number?: string })?.number;
      console.log(`  read back: R${readNumber} J${job?.id}  provisional=${live?.provisional} quote=${live?.quote} card=${job?.pricelist_category_id}`);
      report.push({
        label: probe.label, posted: true, order_id: created.id, order_number: created.number,
        job_id: job?.id, provisional: live?.provisional, quote: live?.quote,
        // POST returned no number; this one came from the read-back.
        order_number_from_post: created.number ?? null, order_number_read_back: readNumber ?? null,
        card_on_job: job?.pricelist_category_id, card_sent: RATE_CARD,
        teams_sent: body[0].SlotTeam.length, crew_sent: body[0].SlotTeam.reduce((n, s) => n + s.size, 0),
        longest_name: Math.max(...body[0].SlotTeam.map((s) => s.name.length)),
      });
    } catch (err) {
      // A refusal is a result. It is the whole reason these five go to the real API.
      slot.id = slot.id === -1 ? 0 : slot.id;
      writeLedger(ledger);
      console.error(`  REFUSED: ${(err as Error).message}`);
      report.push({ label: probe.label, posted: false, error: (err as Error).message });
    }
  }

  // The destructive path, live: replace the first probe order with a bigger one.
  const first = ledger.created.find((c) => !c.deleted && c.id > 0);
  if (first) {
    console.log(`\ndelete-and-repost, live, on #${first.id}`);
    const bigger = order("carved chief (amended to 9)", [
      { date: D, start_time: "08:00", end_time: "16:00", size: 9, task: "Simulation: amended to 9 crew" },
    ]);
    const res = await replaceProvisionalOrder(
      onsinch,
      { order_id: first.id, desired: bigger, weCreatedIt: true },
      {
        async onIntent() { /* the ledger already names it */ },
        async onDeleted() { first.deleted = true; writeLedger(ledger); },
      }
    );
    if (res.created) {
      ledger.created.push({ id: res.created.id, number: res.created.number, label: "replacement of " + first.id, deleted: false });
      writeLedger(ledger);
      console.log(`  #${first.id} deleted, replaced by #${res.created.id} (R${res.created.number})`);
      const gone = await onsinch.orderById(first.id);
      console.log(`  old order now reads: ${gone ? "STILL PRESENT" : "gone"}`);
      report.push({ label: "live replace", posted: true, replaced: first.id, order_id: res.created.id, old_order_gone: !gone });
    } else {
      console.log(`  refused: ${res.refused}`);
      report.push({ label: "live replace", posted: false, refused: res.refused });
    }
  }

  writeFileSync(join(OUT, "live-write.json"), JSON.stringify({ tenant: onsinchBase(), company_id: COMPANY_ID, probes: report }, null, 2));

  if (mode === "full") await cleanup();
  else console.log(`\n--keep: ${ledger.created.filter((c) => !c.deleted).length} order(s) left. Run with --cleanup to remove them.`);

  console.log(`\nwritten: ${join(OUT, "live-write.json")}\n`);
})();
