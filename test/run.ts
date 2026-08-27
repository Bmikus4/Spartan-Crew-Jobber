// ============================================================================
// Offline end-to-end proof of the foundational design + metrics + the write path.
// Proves: (1) a new job -> reply drafted + order WRITTEN to OnSinch as To Confirm,
//         (2) re-handling the SAME thread is idempotent,
//         (3) a follow-up crew-count change patches the order straight through,
//         (4) a bare "thanks" -> confirmation-only,
//         (5) dashboard aggregate reflects the funnel,
//         (5b) an ASSUMED rate card is WRITTEN and flagged, never staged,
//         (6) no mode has to be flipped for any of it.
// ============================================================================
import { createHash } from "node:crypto";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { matchCompany, matchPlace, matchContact, matchExistingOrder } from "../app/lib/engine/resolve";
import { createOrderWithPlace } from "../app/lib/deps";
import { InMemoryStore } from "../app/lib/engine/store";
import { InMemoryMetrics, aggregate } from "../app/lib/engine/metrics";
import { buildOrderBody } from "../app/lib/engine/format";
import { handleThread, confirmOrder, type Executor, type PipelineDeps } from "../app/lib/engine/pipeline";
import { DEFAULT_SETTINGS, type HydratedThread, type Settings } from "../app/lib/engine/types";
import { mockReasoner, mockTransport, msg } from "./mocks";

let clock = 1_700_000_000_000;
const onsinch = new OnsinchClient(mockTransport);
const store = new InMemoryStore();
const metrics = new InMemoryMetrics();
const settings: Settings = { ...DEFAULT_SETTINGS }; // draft-only by default
const hashOrder = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex").slice(0, 16);

const executor: Executor = {
  async createReplyDraft() { return "draft-" + clock; },
  async createOrder(order) { return onsinch.createOrder(buildOrderBody(order)); },
  async patchOrder(p) { await onsinch.patchOrder([{ id: p.order_id }]); },
};

const deps: PipelineDeps = {
  reasoner: mockReasoner, onsinch, now: () => ++clock, store, metrics, executor, settings, hashOrder,
};

let fails = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}`);
  if (!cond) fails++;
};

const TID = "thread-A";
const thread = (msgs: Parameters<typeof msg>[0][]): HydratedThread => ({ thread_id: TID, messages: msgs.map(msg) });
const NEW = { message_id: "m1", body: "Hi, can I book 4 crew on 9th March at Savoy Place for an exhibition stand build?" };

(async () => {
  console.log("\n[1] New job -> reply drafted, order WRITTEN to OnSinch as To Confirm");
  let s = await handleThread(thread([NEW]), deps);
  assert(s.classification === "new-job", "classified new-job");
  assert(!!s.reply_draft_id, "reply draft created");
  assert(s.status === "ordered", "status = ordered");
  assert(s.onsinch_order_id === 9001, "order 9001 exists in OnSinch, no confirm click needed");
  assert(!s.pending_order, "nothing left sitting in the staging queue");
  assert(s.desired_order?.slot_teams[0].place_id === 88, "order has place_id 88");
  assert(s.desired_order?.pricelist_category_id === 197, "rate card 197 resolved onto the order (I1)");
  // To Confirm, not Price Quotes (Ben, 2026-08-09). test/draftPosture.ts owns the
  // reasoning and the wire-level check; this asserts the end-to-end path carries it.
  // It is what makes writing straight through safe: the human gate is in OnSinch.
  assert(!("provisional" in (s.desired_order ?? {})) && !("quote" in (s.desired_order ?? {})), "posture left to OnSinch: neither provisional nor quote is set");
  assert(!!s.desired_order?.slot_teams.some((t) => t.profession_id === 36), "crew-chief slot team carved out (4 crew -> 3 + chief)");
  assert(!!s.desired_order?.specification, "job summary emitted to specification");
  assert(s.desired_order?.intern_name === "PO-44821", "customer ref emitted to intern_name");
  // Ben, Q1: the queue stops being a gate, but every inbound request must still be
  // visible in the tool. The row is the record.
  assert((await store.get(TID))?.thread_id === TID, "the thread is still recorded in the tool");

  console.log("\n[2] Re-handle SAME thread (idempotency)");
  const createsBefore = (await metrics.all()).filter((e) => e.type === "order_created").length;
  s = await handleThread(thread([NEW]), deps);
  const createsAfter = (await metrics.all()).filter((e) => e.type === "order_created").length;
  assert(createsBefore === createsAfter, "no second order created (idempotent)");
  assert(!s.pending_order, "nothing newly proposed");

  console.log("\n[3] Follow-up crew-count change -> proposed PATCH -> confirm");
  s = await handleThread(thread([
    { message_id: "m1", date_iso: "2026-02-12T10:00:00Z", body: NEW.body },
    { message_id: "m2", date_iso: "2026-02-13T09:00:00Z", body: "Actually please make it 6 crew instead." },
  ]), deps);
  assert(s.classification === "update", "classified update");
  assert(!s.pending_order, "patch executed, not staged");
  // 6 crew is 5 crew and a chief carved out of them — the client's number is the
  // number that turns up, so the patch is checked on the total, not on one team.
  assert(s.desired_order?.slot_teams.reduce((n, t) => n + t.size, 0) === 6, "the patched order is 6 people");
  assert(s.desired_order?.slot_teams.find((t) => t.profession_id !== 36)?.size === 5, "of which 5 crew");
  assert(s.order_action_log.filter((l) => l.kind === "patch").length === 1, "one patch reached OnSinch");

  console.log("\n[4] Bare acknowledgement -> confirmation-only");
  s = await handleThread(thread([
    { message_id: "m1", date_iso: "2026-02-12T10:00:00Z", body: "Hi, can I book 4 crew on 9th March at Savoy Place?" },
    { message_id: "m3", date_iso: "2026-02-14T09:00:00Z", body: "Perfect, thanks!" },
  ]), deps);
  assert(s.classification === "confirmation-only", "classified confirmation-only");

  console.log("\n[5] Dashboard aggregate");
  const stats = aggregate(await metrics.all());
  console.log("   " + JSON.stringify(stats));
  assert(stats.orders_proposed === 0, "nothing was proposed — the queue is no longer a gate");
  assert(stats.orders_created === 1 && stats.orders_updated === 1, "1 created, 1 updated, both straight through");
  assert(stats.awaiting_confirmation === 0, "nothing left awaiting confirmation");

  console.log("\n[5b] an assumed rate card BOOKS the job and calls a human");
  {
    // A client with no order history has no card to derive, so the house standard is
    // applied. That guess reaches an invoice, which is why it is flagged — but it no
    // longer holds the booking. Ben, 2026-08-27: "as little unnecessary blockers to
    // creating a job as possible, as long as the actual content of the order can be
    // created properly." A rate card is not order content; it is Spartan's own number.
    //
    // The guess is still guarded, just not by a gate: `needs_human` puts the "Manual"
    // label on the thread in the bookings mailbox, which is where ops work. Holding the
    // order used to BE the notification, and that is the only reason it held.
    const noHistory: Transport = async (method, path) =>
      path.startsWith("/orders") && method === "GET"
        ? { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1, nextPage: false } } }
        : mockTransport(method, path);
    // Its own store: every thread in this file is the SAME enquiry, so the cross-thread
    // check would correctly hold it as a twin of thread-A and never reach the rate gate.
    const newClientDeps: PipelineDeps = {
      ...deps, onsinch: new OnsinchClient(noHistory), defaultRateCard: 315, store: new InMemoryStore(),
    };
    const sr = await handleThread({ thread_id: "thread-D", messages: [msg({ message_id: "d1", body: NEW.body })] }, newClientDeps);
    assert(sr.desired_order?.rate_card_source === "default", "the card was assumed");
    assert(sr.status === "ordered" && !sr.pending_order, "so it is WRITTEN, not staged");
    assert(sr.onsinch_order_id === 9001, "and it reached OnSinch");
    assert(sr.needs_human === true, "with a human called — what the Manual tag rides on");
    assert(sr.notes.some((n) => /CHECK THE PRICE — the job is booked/.test(n)),
      "and the ticket says the price was assumed AND that the job went");
  }

  console.log("\n[7] Newest message is our OWN Spartan reply -> act on the client email, never ourselves");
  const s7 = await handleThread({ thread_id: "thread-C", messages: [
    msg({ message_id: "c1", date_iso: "2026-03-01T10:00:00Z", body: NEW.body }),
    msg({ message_id: "c2", date_iso: "2026-03-01T12:00:00Z", from: "bookings@spartancrew.co.uk", is_from_spartan: true, body: "Hello, got it and all noted for the 9th. Thanks, Spartan Crew" }),
  ]}, deps);
  assert(s7.last_message_id === "c1", "latest = the client message, not our Spartan reply");
  assert(s7.classification === "new-job", "classified the client's request, not our own email");

  // Ben, Q1: the Neon staging queue stops being a gate — an order goes to OnSinch as
  // To Confirm the moment it composes. There is no mode to flip any more.
  console.log("\n[6] an order reaches OnSinch without a second gate (separate thread)");
  // Its own store, for the same reason as [5b].
  const autoDeps: PipelineDeps = { ...deps, settings: { ...DEFAULT_SETTINGS, replies_enabled: true }, store: new InMemoryStore() };
  const s2 = await handleThread({ thread_id: "thread-B", messages: [msg({ message_id: "b1", body: NEW.body })] }, autoDeps);
  assert(s2.status === "ordered" && s2.onsinch_order_id === 9001, "written without a confirm click");

  console.log("\n[8] Tool 2 dedup — pull-all EXACT match (resolve.ts)");
  const companies = [{ id: 1, name: "RedBeast Energy Ltd" }, { id: 2, name: "Acme Events" }];
  assert(matchCompany("redbeast energy", companies) === 1, "company exact-match ignores case + legal suffix");
  assert(matchCompany("Unknown Co", companies) === null, "unknown company -> null (needs creating)");
  const places = [{ id: 88, name: "Savoy Place", address: "2 savoy place", city: "london", zip: "wc2r 0bl", country: "GB" }];
  assert(matchPlace("2 Savoy Place, London WC2R 0BL, United Kingdom", places) === 88, "venue matched from a richer email address string");
  assert(matchPlace("Somewhere Else, Leeds", places) === null, "unknown venue -> null (provisioned on write)");
  const clients = [{ id: 1337, email: "Pier@RedBeast.co.uk" }];
  assert(matchContact("pier@redbeast.co.uk", clients) === 1337, "contact exact-match on email, case-insensitive (no dup)");
  assert(matchContact("new@person.com", clients) === null, "new contact -> null");
  const existing = [{ id: 5001, happening: "2026-03-09T08:00:00+00:00", Job: [{ id: 7001 }] }];
  const oneHit = matchExistingOrder("2026-03-09", existing);
  assert(!!oneHit && "order_id" in oneHit && oneHit.order_id === 5001, "order dedup: same-date match -> update, not create");
  assert(matchExistingOrder("2026-03-10", existing) === null, "different date -> no dup match");
  // Two orders on the day and no venue to tell them apart: ambiguous, never a guess.
  const twoSameDay = [
    { id: 5001, happening: "2026-03-09T08:00:00+00:00", name: "Acme @ Olympia", Job: [{ id: 7001 }] },
    { id: 5002, happening: "2026-03-09T14:00:00+00:00", name: "Acme @ ExCeL", Job: [{ id: 7002 }] },
  ];
  const amb = matchExistingOrder("2026-03-09", twoSameDay);
  assert(!!amb && "ambiguous" in amb && amb.ambiguous === 2, "two orders on the day -> ambiguous, not a coin flip");
  const byVenue = matchExistingOrder("2026-03-09", twoSameDay, "ExCeL London, Royal Victoria Dock");
  assert(!!byVenue && "order_id" in byVenue && byVenue.order_id === 5002, "the venue separates them -> the right order");

  console.log("\n[9] Tool 2 — new venue provisioned on write, then order created");
  const calls: string[] = [];
  const recTransport: Transport = async (m, p, b) => { calls.push(`${m} ${p.split("?")[0]}`); return mockTransport(m, p, b); };
  const recClient = new OnsinchClient(recTransport);
  const provOrder = {
    name: "New client @ New Venue", company_id: 42, user_id: 1337, request_approval: true as const,
    provisional: true, quote: true, pricelist_category_id: 197,
    job_name: "4 at New Venue on 2026-03-09",
    slot_teams: [{ name: "Crew", profession_id: 1, beginning: "2026-03-09T08:00:00+00:00", end: "2026-03-09T18:00:00+00:00", size: 4, place_id: 0 }],
    provision_place: { name: "New Venue", country: "GB", address: "1 New Road, Leeds" },
  };
  const provCreated = await createOrderWithPlace(recClient, provOrder);
  assert(calls.includes("POST /places"), "new venue created (POST /places) before the order");
  assert(provCreated.id === 9001, "order created after the place was provisioned");

  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}\n`);
  process.exit(fails === 0 ? 0 : 1);
})();
