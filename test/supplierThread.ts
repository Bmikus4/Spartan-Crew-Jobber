// ============================================================================
// A thread in which Spartan is buying a vehicle is a supplier, never a booking.
// ----------------------------------------------------------------------------
// 2026-09-30, first live night: Tracy asked KB Event and Mango Couriers to quote for a
// van for The Pembroke Club job, mentioning "4 crew members on site". The engine read
// each supplier as a client and booked 8 crew for each (orders 16321, 16323) on top of
// the real order (16322). Over all 806 stored threads, Spartan's own words asking for a
// vehicle quote occur in exactly those supplier threads (three, with EST's) and in no
// client thread.
//
// Offline.  npx tsx test/supplierThread.ts
// ============================================================================
import { createHash } from "node:crypto";
import { handleThread, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { supplierAsk } from "../app/lib/engine/triage";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics } from "../app/lib/engine/metrics";
import { DEFAULT_SETTINGS, type ConversationFacts } from "../app/lib/engine/types";
import type { Reasoner, ClassifyResult, ReplyResult } from "../app/lib/engine/reason";
import { buildOrderBody } from "../app/lib/engine/format";
import { mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const FACTS: ConversationFacts = {
  company_name: "KB Event Ltd", contact_email: "seanm@kbevent.com", location_text: "6-7 Grosvenor Place London SW1X 7SH",
  requests: [{ date: "2026-10-02", start_time: "08:00", end_time: "18:00", size: 4, task: "Load out" }],
};

function rig() {
  let calls = 0, creates = 0, patches = 0;
  const reasoner: Reasoner = {
    async classifyAndExtract() {
      calls++;
      return { classification: "new-job", priority: "high", job_summary: "crew", facts: FACTS } as ClassifyResult & { facts: ConversationFacts };
    },
    async classify(): Promise<ClassifyResult> { calls++; return { classification: "new-job", priority: "high", job_summary: "x" }; },
    async extractFacts() { calls++; return FACTS; },
    async composeReply(): Promise<ReplyResult> { return { subject: "Re", html: "<p>ok</p>", priority: "low" }; },
  };
  const onsinch = new OnsinchClient(mockTransport);
  const executor: Executor = {
    async createReplyDraft() { return "draft"; },
    async createOrder(order) { creates++; return onsinch.createOrder(buildOrderBody(order)); },
    async patchOrder() { patches++; return []; },
  };
  let clock = Date.parse("2026-09-29T09:00:00Z");
  const deps: PipelineDeps = {
    reasoner, onsinch, executor, store: new InMemoryStore(), metrics: new InMemoryMetrics(), now: () => ++clock,
    settings: { ...DEFAULT_SETTINGS },
    hashOrder: (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16),
  };
  return { deps, calls: () => calls, creates: () => creates, patches: () => patches };
}

const TAG = "All the best,\nTracy | Senior Account Handler\n*** We now provide Van services! Get in touch for pricing and availability.***";
const spartan = (id: string, at: string, body: string) =>
  msg({ message_id: id, date_iso: at, from: "bookings@spartancrew.co.uk", is_from_spartan: true, subject: "Re: This weekend", body: `${body}\n${TAG}` });
const client = (id: string, at: string, from: string, body: string) =>
  msg({ message_id: id, date_iso: at, from, subject: "RE: This weekend", body });

async function main() {
  console.log("\n[1] the rule, on the words that were live");
  {
    ok(!!supplierAsk([spartan("a", "2026-09-29T13:28:00Z", "Could you please quote for either 2 x Luton vans or 2 x long-wheelbase Sprinters?")]), "KB Event: quote for Luton vans");
    ok(!!supplierAsk([spartan("b", "2026-09-21T10:00:00Z", "The truck will need to be around for up to 3 hours. Could we get a quote asap please.")]), "Mango: could we get a quote, truck");
    ok(!!supplierAsk([msg({ message_id: "c", date_iso: "2026-09-30T09:00:00Z", from: "paz@spartancrew.co.uk", is_from_spartan: true, subject: "This weekend", body: "Could you please quote me for a 7.5 On Friday 09:00, load furniture?" })]), "EST: quote me for a 7.5");
    ok(!supplierAsk([spartan("d", "2026-09-01T09:00:00Z", "Hi there, Please can you quote for the below crew: Wednesday 2nd 16:00 - 20:00 x 8 crew")]), "a crew ask relayed through info@ is not a supplier");
    ok(!supplierAsk([spartan("e", "2026-09-01T09:00:00Z", "Please find the quote for your order attached.")]), "the tagline's 'Van services' alone is not a vehicle ask");
    ok(!supplierAsk([spartan("f", "2026-09-01T09:00:00Z", "Can we quote you for a Luton van as well?")]), "Spartan OFFERING a van to a client is not buying one");
    ok(!supplierAsk([client("g", "2026-09-01T09:00:00Z", "ops@client.co.uk", "Could you please quote for a Luton van and 4 crew?")]), "a CLIENT asking Spartan for a van is a job");
  }

  console.log("\n[2] the supplier's reply books nothing and costs no model call");
  {
    const r = rig();
    const s = await handleThread({ thread_id: "t-kb", messages: [
      spartan("k1", "2026-09-29T13:28:00Z", "Could you please quote for either 2 x Luton vans? Load out 02/10 08:00, load in 05/10 08:00. There will be 4 crew members on site to assist."),
      client("k2", "2026-09-29T15:07:00Z", "seanm@kbevent.com", "Hey Tracy, please find attached quote for this run. 4 crew on site noted."),
    ] }, r.deps);
    ok(s.classification === "not-a-job" && s.status === "ignored", "read as not a job", `${s.classification} ${s.status}`);
    ok(r.creates() === 0 && r.calls() === 0, "no order, no model call", `creates ${r.creates()} calls ${r.calls()}`);
    ok(s.notes.some((n) => /supplier/i.test(n)), "and the reason is on the ticket", JSON.stringify(s.notes));
  }

  console.log("\n[3] a supplier thread already carrying a (false) order writes nothing more");
  {
    const r = rig();
    await r.deps.store.put({ thread_id: "t-mg", onsinch_order_id: 16323, status: "ordered", classification: "new-job", notes: [], order_action_log: [{ ts: 1, kind: "create", order_id: 16323, ok: true }], last_message_id: "m0" } as never);
    await handleThread({ thread_id: "t-mg", messages: [
      spartan("m1", "2026-09-21T10:00:00Z", "The truck will need to be around for up to 3 hours to load. Could we get a quote asap please."),
      client("m2", "2026-09-30T10:00:00Z", "josh@mangocouriers.co.uk", "Hi, the Monday load in is cancelled, 4 crew still needed Friday."),
    ] }, r.deps);
    ok(r.creates() === 0 && r.patches() === 0 && r.calls() === 0, "no create, no patch, no model call", `creates ${r.creates()} patches ${r.patches()} calls ${r.calls()}`);
  }

  console.log("\n[4] an ordinary client thread with Tracy's signature still books");
  {
    const r = rig();
    await handleThread({ thread_id: "t-ok", messages: [
      client("o1", "2026-09-29T09:00:00Z", "jack.quin@thepembrokeclub.com", "4 people for 2 hours early on Saturday 3 October at 6-7 Grosvenor Place London SW1X 7SH, back Monday morning."),
      spartan("o2", "2026-09-29T10:00:00Z", "Thanks Jack, I'll get a quote over to you shortly."),
    ] }, r.deps);
    ok(r.calls() > 0, "the model reads it", String(r.calls()));
  }

  console.log("\n[5] Spartan's ask survives only inside the supplier's reply");
  {
    // Verified 2026-10-01: the original was sent before the poll began, so the quote in
    // the supplier's answer is the only copy of the ask, and the thread was booked.
    const quoted = client("q1", "2026-09-29T15:00:00Z", "seanm@kbevent.com",
      "Hey Tracy, quote attached for the Luton.\n\nOn Mon, 29 Sep 2026 at 14:28, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:\n> Could you please quote for a Luton van on 2 Oct 08:00?\n> There will be 4 crew members on site to assist.");
    ok(!!supplierAsk([quoted]), "the quoted ask is Spartan's, so the thread is a supplier's");
    const deeper = client("q2", "2026-09-29T15:00:00Z", "ops@client.co.uk",
      "Great, thanks.\n\nOn Mon, 29 Sep 2026, Bookings Spartan Crew <bookings@spartancrew.co.uk> wrote:\n> Thanks, we'll get that booked in.\n>> On Sun, Client wrote:\n>> Could you please quote for a Luton van and 4 crew?");
    ok(!supplierAsk([deeper]), "a client's own ask quoted beneath Spartan's reply is not Spartan's");
  }

  console.log("\n[6] \"quote your PO number\" is not asking for a price");
  {
    const po = spartan("p1", "2026-09-29T09:30:00Z", "Thanks Pier. Could you quote your PO number when you confirm? Our van will be on site from 07:30.");
    ok(!supplierAsk([po]), "a real client thread with our van on site stays a job");
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
