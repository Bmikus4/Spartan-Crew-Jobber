// ============================================================================
// Does an amendment work END TO END, against the real tenant?
// ----------------------------------------------------------------------------
//   npx tsx sim/live-amendment.ts            run it, then delete what it made
//   npx tsx sim/live-amendment.ts --keep      leave the orders for eyes
//   npx tsx sim/live-amendment.ts --cleanup   delete whatever the ledger lists
//
// The 100-case run proves the engine composes the right amendment, but it proves it
// against a fixture. sim/live-write.ts proves OnSinch accepts what the engine builds,
// but it calls replaceProvisionalOrder directly. NEITHER proves the whole path — an
// email arriving, compile, compose, the replace decision, the write — has ever run
// against the live API. That is the claim this file tests, because it is the claim
// "are updates working" actually means.
//
// Two emails through handleThread on ONE store, exactly as Gmail would deliver them.
// The model is still scripted: what is under test is the engine and the API, and a
// live model call would add a second variable and a bill.
//
// Company 515 "TEST - Eventz". Every order id is ledgered to disk before the call
// that creates it, and deleted at the end.
// ============================================================================
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv, onsinchBase } from "../scripts/_env.mjs";
import { OnsinchClient, httpTransport, __resetListCache, type Transport } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { replaceProvisionalOrder } from "../app/lib/engine/replaceOrder";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type ConversationFacts, type HydratedThread, type ThreadMessage } from "../app/lib/engine/types";
import type { Reasoner } from "../app/lib/engine/reason";
import { loadProfessions } from "./harness";

const OUT = join(import.meta.dirname, "..", ".tmp-data/sim");
const LEDGER = join(OUT, "live-amend-ledger.json");
const led: { orders: number[] } = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, "utf8")) : { orders: [] };
const save = () => { mkdirSync(OUT, { recursive: true }); writeFileSync(LEDGER, JSON.stringify(led, null, 2)); };

loadEnv();
const KEY = requireEnv("ONSINCH_API_KEY");
const BASE = onsinchBase();
const mode = process.argv.includes("--cleanup") ? "cleanup" : process.argv.includes("--keep") ? "keep" : "full";

/** The designated test account, and a venue that resolves against the real place list. */
const COMPANY_NAME = "TEST - Eventz";
// NOT a spartancrew.co.uk address: triage correctly kills own-mail before the model,
// and the test company's only contact is an internal one. The company still resolves
// by NAME, and resolveContact then falls back to its existing contact with a note —
// which is the real behaviour for an unknown sender at a known client.
const CONTACT = "bookings@test-eventz-sim.co.uk";
const VENUE = "The O2, Peninsula Square, SE10 0DX";
const DATE = "2026-11-25";

// Every call is logged, so the report can show what the engine actually asked the API
// for rather than what it meant to.
const wire: string[] = [];
const logged: Transport = async (m, p, b) => {
  const real = httpTransport({ baseUrl: BASE, apiKey: KEY });
  const r = await real(m, p, b);
  if (m !== "GET") wire.push(`${m} ${p} -> ${r.status}`);
  return r;
};

const onsinch = new OnsinchClient(logged);

/** How many crew the current email asks for. Flipped between the two messages. */
let want = 6;
const reasoner: Reasoner = {
  async classify() {
    return want === 6
      ? { classification: "new-job" as const, priority: "high" as const, job_summary: "live amendment probe" }
      : { classification: "update" as const, priority: "medium" as const, job_summary: "crew increased" };
  },
  async extractFacts(): Promise<ConversationFacts> {
    return {
      company_name: COMPANY_NAME,
      contact_name: "Sim Contact",
      contact_email: CONTACT,
      location_text: VENUE,
      requests: [{ date: DATE, start_time: "08:00", end_time: "16:00", size: want, task: "SIM live amendment probe" }],
    };
  },
  async composeReply() {
    return { subject: "Re: SIM", html: "<p>noted</p>", priority: "high" as const };
  },
};

const msg = (id: string, at: string, body: string): ThreadMessage => ({
  message_id: id, from: CONTACT, to: ["bookings@spartancrew.co.uk"],
  date_iso: at, subject: "SIM live amendment probe", body, is_from_spartan: false,
});
const thread = (msgs: ThreadMessage[]): HydratedThread => ({ thread_id: "sim-live-amend", messages: msgs });

const store = new InMemoryStore();
let clock = 1_800_000_000_000;

const executor: Executor = {
  async createReplyDraft() { return "no-draft-in-this-probe"; },
  async createOrder(order) {
    const created = await onsinch.createOrder(buildOrderBody(order));
    led.orders.push(created.id); save();          // ledgered the moment it exists
    return created;
  },
  async patchOrder(p) {
    const applied: string[] = [];
    const patch: Record<string, unknown> = { id: p.order_id };
    if (p.desired.specification) { patch.specification = p.desired.specification; applied.push("specification"); }
    if (p.desired.intern_name) { patch.intern_name = p.desired.intern_name; applied.push("intern_name"); }
    if (applied.length) await onsinch.patchOrder([patch as { id: number }]);
    return applied;
  },
  async replaceOrder(p) {
    const res = await replaceProvisionalOrder(
      onsinch,
      { order_id: p.order_id, desired: p.desired, alreadyDeleted: p.alreadyDeleted, weCreatedIt: p.weCreatedIt },
      { onIntent: p.onIntent, onDeleted: p.onDeleted }
    );
    if (res.created) { led.orders.push(res.created.id); save(); }
    return res;
  },
  async identifiersForOrder(order_id) {
    const live = (await onsinch.orderById(order_id)) as { Job?: { id: number }[]; number?: string } | null;
    const job = Array.isArray(live?.Job) ? live?.Job?.[0] : (live?.Job as { id: number } | undefined);
    return { job_id: job?.id, order_number: live?.number != null ? String(live.number) : undefined };
  },
};

const deps: PipelineDeps = {
  reasoner, onsinch, now: () => ++clock, store,
  metrics: new InMemoryMetrics(), executor, settings: { ...DEFAULT_SETTINGS },
  hashOrder: (o) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  professions: loadProfessions(),
  // Pinned so the probe tests the AMENDMENT and not the rate-card hold: the test
  // company has no order history, so a derived card would be "default" and the
  // thread would stage for a click before it ever reached the replace path.
  seededRateCard: async () => 315,
  archiveOrder: async () => 1,
  recordReplacement: async () => {},
};

async function cleanup() {
  const live = [...new Set(led.orders)];
  if (!live.length) { console.log("ledger clean — nothing to delete"); return; }
  console.log(`\ncleanup: ${live.length} order(s)`);
  for (const id of live) {
    try {
      const still = await onsinch.orderById(id);
      if (!still) { console.log(`  #${id} already gone`); continue; }
      await onsinch.deleteOrders([id]);
      const after = await onsinch.orderById(id);
      console.log(`  #${id} deleted -> ${after ? "STILL PRESENT, delete by hand" : "gone"}`);
    } catch (err) {
      console.error(`  #${id} FAILED: ${(err as Error).message}`);
    }
  }
  led.orders = []; save();
}

(async () => {
  __resetListCache();
  console.log(`tenant ${BASE}`);
  if (mode === "cleanup") { await cleanup(); return; }

  console.log(`\n--- EMAIL 1: ${want} crew on ${DATE}, 08:00-16:00 at the O2`);
  want = 6;
  const s1 = await handleThread(thread([msg("m1", "2026-08-19T09:00:00Z", "Please book 6 crew.")]), deps);
  console.log(`  classification ${s1.classification}  status ${s1.status}`);
  console.log(`  company ${s1.company_id}  contact ${s1.user_id}  place ${s1.place_id}`);
  console.log(`  ORDER ${s1.onsinch_order_id}  R${s1.onsinch_order_number}  J${s1.onsinch_job_id}`);
  console.log(`  teams: ${(s1.desired_order?.slot_teams ?? []).map((t) => `p${t.profession_id}x${t.size}`).join(" ")}`);
  for (const n of s1.notes) console.log(`  note: ${n}`);
  const first = s1.onsinch_order_id;

  console.log(`\n--- EMAIL 2: make it 9`);
  want = 9;
  const s2 = await handleThread(thread([
    msg("m1", "2026-08-19T09:00:00Z", "Please book 6 crew."),
    msg("m2", "2026-08-19T11:00:00Z", "Sorry — make that 9 crew please."),
  ]), deps);
  console.log(`  classification ${s2.classification}  status ${s2.status}`);
  console.log(`  ORDER ${s2.onsinch_order_id}  R${s2.onsinch_order_number}  J${s2.onsinch_job_id}`);
  console.log(`  teams: ${(s2.desired_order?.slot_teams ?? []).map((t) => `p${t.profession_id}x${t.size}`).join(" ")}`);
  console.log(`  action log: ${s2.order_action_log.map((a) => `${a.kind}${a.ok ? "" : "!"}`).join(", ")}`);
  for (const n of s2.notes) console.log(`  note: ${n}`);

  console.log(`\n--- VERDICT`);
  const replacedIt = s2.onsinch_order_id !== first;
  const oldGone = first ? !(await onsinch.orderById(first)) : false;
  const newLive = s2.onsinch_order_id ? await onsinch.orderById(s2.onsinch_order_id) : null;
  const crew = (s2.desired_order?.slot_teams ?? []).reduce((n, t) => n + t.size, 0);
  console.log(`  order replaced ......... ${replacedIt ? `yes, #${first} -> #${s2.onsinch_order_id}` : `NO — still #${first}`}`);
  console.log(`  old order gone ......... ${oldGone}`);
  console.log(`  new order live ......... ${!!newLive}  provisional=${newLive?.provisional}`);
  console.log(`  crew on the order ...... ${crew} (client asked for 9)`);
  console.log(`  fell back to "by hand" . ${s2.notes.some((n) => /by hand/.test(n))}`);
  console.log(`\n  writes to OnSinch:`);
  for (const w of wire) console.log(`    ${w}`);

  if (mode === "full") await cleanup();
  else console.log(`\n--keep: ${led.orders.join(", ")} left. Run --cleanup to remove.`);
})();
