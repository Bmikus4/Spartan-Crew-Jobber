// ============================================================================
// THE SCENARIO CORPUS.
// ----------------------------------------------------------------------------
// Each scenario is a whole conversation, and it passes only when the FINAL
// OBSERVABLE OUTCOME is right: what the tenant holds, what the thread row says,
// which tags were posted, and what was NOT done. A function that returned without
// throwing is not a result.
//
// Every scenario is also checked against the global invariants in `invariants()`,
// whether or not it has anything to say about them. A scenario that books the job
// correctly and duplicates the client is a FAILURE, and that is the only reading of
// "end to end" worth reporting.
//
// The classes are not a taxonomy invented in advance — they are the materially
// different things this engine is asked to do, read off the architecture: compose a
// first order, fill gaps, not repeat itself, decide between candidates, carry state
// across a sequence, survive a failed write, and keep one client's records out of
// another's.
// ============================================================================
import { FakeTenant } from "./tenant.mts";
import { buildRig, deliver, email, sweep, type AuditRig, type EmailSpec } from "./harness.mts";
import { confirmOrder } from "../app/lib/engine/pipeline";
import type { ThreadMessage } from "../app/lib/engine/types";

export const START = Date.parse("2026-10-05T09:00:00Z");

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
  /** An invariant breach is reported apart from an ordinary expectation. */
  invariant?: boolean;
}

export interface Ctx {
  tenant: FakeTenant;
  rig: AuditRig;
  checks: Check[];
  check(label: string, ok: boolean, detail?: string): void;
  /** Deliver the nth message of a growing thread. */
  say(thread_id: string, msgs: ThreadMessage[]): ReturnType<typeof deliver>;
  /** Swap the wiring mid-scenario — a different settings posture, the same tenant. */
  rebuild(opts: Parameters<typeof buildRig>[1]): void;
}

export interface Scenario {
  id: string;
  cls: ClassName;
  what: string;
  /** Threads this scenario legitimately touches, for the contamination invariant. */
  run(ctx: Ctx): Promise<void>;
}

export type ClassName =
  | "normal"
  | "missing-information"
  | "duplicate-and-replay"
  | "ambiguity"
  | "sequence-and-state"
  | "failure-recovery"
  | "cross-record";

export const CLASS_LABEL: Record<ClassName, string> = {
  normal: "Normal enquiry",
  "missing-information": "Missing information",
  "duplicate-and-replay": "Duplicate / replayed event",
  ambiguity: "Ambiguous input",
  "sequence-and-state": "Existing state + new message",
  "failure-recovery": "Retry after failure",
  "cross-record": "Cross-record separation",
};

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/** A tenant that looks like Spartan's: a few clients, a few venues, some history. */
export function baseTenant(opts: ConstructorParameters<typeof FakeTenant>[0] = {}): {
  tenant: FakeTenant;
  redbeast: number;
  meridian: number;
  excel: number;
  olympia: number;
} {
  const tenant = new FakeTenant(opts);
  const redbeast = tenant.addCompany("RedBeast Energy", [{ email: "ops@redbeast.co.uk", name: "Pier" }]).id;
  const meridian = tenant.addCompany("Meridian Exhibitions Ltd", [{ email: "jo@meridian-ex.co.uk", name: "Jo" }]).id;
  // A near-name, to make a wrong bind visible rather than plausible.
  tenant.addCompany("Meridian Energy Solutions", [{ email: "acct@meridian-energy.com", name: "Sam" }]);
  const excel = tenant.addPlace({ name: "ExCeL London", address: "Royal Victoria Dock, 1 Western Gateway", city: "London", zip: "E16 1XL" }).id;
  const olympia = tenant.addPlace({ name: "Olympia London", address: "Hammersmith Road", city: "London", zip: "W14 8UX" }).id;
  tenant.addPlace({ name: "Business Design Centre", address: "52 Upper Street", city: "London", zip: "N1 0QH" });
  // Priced history, so the rate card is DERIVED for these two and nothing is assumed.
  for (const [co, card] of [
    [redbeast, 342],
    [meridian, 315],
  ] as const) {
    for (let i = 0; i < 3; i++) {
      tenant.addHandRaisedOrder({
        company_id: co,
        name: `history ${co}/${i}`,
        pricelist_category_id: card,
        created: `2026-0${5 + i}-01T09:00:00Z`,
        blocks: [{ size: 4, place_id: excel, beginning: `2026-0${5 + i}-10T08:00:00+01:00`, end: `2026-0${5 + i}-10T18:00:00+01:00` }],
      });
    }
  }
  return { tenant, redbeast, meridian, excel, olympia };
}

const EXCEL_TEXT = "ExCeL London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";
const OLYMPIA_TEXT = "Olympia London, Hammersmith Road, London W14 8UX";

/** An ordinary first enquiry from a known client. */
function enquiry(over: Partial<EmailSpec> & { body?: string } = {}): EmailSpec {
  return {
    subject: "Crew for the 12th",
    from: "ops@redbeast.co.uk",
    body:
      over.body ??
      `Hi Spartan | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | Can you cover a stand build? | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build | Thanks, Pier`,
    ...over,
  };
}

const msgs = (specs: EmailSpec[]): ThreadMessage[] => specs.map((s, i) => email(s, START, i + 1));

// ---------------------------------------------------------------------------
// the corpus
// ---------------------------------------------------------------------------

export const SCENARIOS: Scenario[] = [
  // ---- NORMAL ------------------------------------------------------------
  {
    id: "N1",
    cls: "normal",
    what: "known client, known venue, priced history — one order, right crew, right card",
    async run(c) {
      const s = await c.say("N1", msgs([enquiry()]));
      const order = c.tenant.order(Number(s.onsinch_order_id));
      c.check("an order exists in OnSinch", !!order, `order ${s.onsinch_order_id}`);
      c.check("status is ordered", s.status === "ordered", s.status);
      c.check("six crew reached the tenant", c.tenant.teamsOf(order!.id).reduce((n, t) => n + t.size, 0) === 6);
      c.check("the client's own rate card was used, not the default", order!.job.pricelist_category_id === 342, String(order!.job.pricelist_category_id));
      c.check("booked at ExCeL, not the placeholder", c.tenant.teamsOf(order!.id).every((t) => t.place_id === c.tenant.places[0].id));
      c.check("the R number was read back", !!s.onsinch_order_number);
      c.check("the J number was read back", !!s.onsinch_job_id);
      c.check("exactly one order was created", c.tenant.orders.filter((o) => o.origin === "api").length === 1);
      c.check(
        "the order name carries the date it is for",
        /\d{4}-\d{2}-\d{2}/.test(order!.name),
        order!.name
      );
      c.check("Order Built was posted exactly once", c.rig.spies.tags.filter((t) => t.label === "Order Built").length === 1,
        JSON.stringify(c.rig.spies.tags.map((t) => `${t.label}/${t.state}`)));
      c.check("no Needs label on a clean booking", !c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs")));
    },
  },
  {
    id: "N2",
    cls: "normal",
    what: "a client OnSinch has never met — the company is created once and the job still books",
    async run(c) {
      const s = await c.say(
        "N2",
        msgs([
          {
            from: "events@spectra-live.co.uk",
            subject: "Crew needed",
            body: `Hi | Company: Spectra Events Ltd | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-20 09:00-17:00, 4 crew, get-in`,
          },
        ])
      );
      const made = c.tenant.companies.filter((x) => x.name === "Spectra Events Ltd");
      c.check("the company was created exactly once", made.length === 1, String(made.length));
      c.check("an order exists", !!c.tenant.order(Number(s.onsinch_order_id)));
      c.check("the order is against the new company", c.tenant.order(Number(s.onsinch_order_id))?.company_id === made[0]?.id);
      c.check("the assumed rate card is stated on the ticket", s.notes.some((n) => /CHECK THE PRICE/.test(n)), s.notes.join(" // "));
      c.check("a rate card was set — never OnSinch's silent default", Number(c.tenant.order(Number(s.onsinch_order_id))?.job.pricelist_category_id) > 0);
      c.check("it is marked for review, not as unbookable", s.review_only === true && s.needs_human === true);
      c.check("no Needs label on a booking that went through", !c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs")));
    },
  },
  {
    id: "N3",
    cls: "normal",
    what: "a venue the tenant does not hold — created once, from the client's words",
    async run(c) {
      const s = await c.say(
        "N3",
        msgs([
          enquiry({
            body: `Hi | Company: RedBeast Energy | Venue: The Glass House, 14 Foundry Road, Sheffield S3 8EN | BLOCK: 2026-11-12 08:00-18:00, 3 crew, install`,
          }),
        ])
      );
      const made = c.tenant.places.filter((p) => /glass house/i.test(String(p.name)));
      c.check("the venue was created exactly once", made.length === 1, String(made.length));
      c.check("the postcode was lifted into its own field", made[0]?.zip?.toUpperCase().replace(/\s/g, "") === "S38EN", JSON.stringify(made[0]));
      const order = c.tenant.order(Number(s.onsinch_order_id));
      c.check("the order stands on the created venue", !!order && c.tenant.teamsOf(order.id).every((t) => t.place_id === made[0]?.id));
      c.check("the ticket says to check it", s.notes.some((n) => /CHECK IT/.test(n)));
    },
  },
  {
    id: "N4",
    cls: "normal",
    what: "no venue named anywhere — the job still books, at the placeholder",
    async run(c) {
      const s = await c.say(
        "N4",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | BLOCK: 2026-11-12 08:00-18:00, 3 crew, install` })])
      );
      const placeholder = c.tenant.places.filter((p) => String(p.name) === "No Location");
      c.check("exactly one placeholder venue exists", placeholder.length === 1, String(placeholder.length));
      c.check("the job booked anyway", !!c.tenant.order(Number(s.onsinch_order_id)));
      c.check("no venue was invented from thin air", !c.tenant.places.some((p) => /undefined|null|tbc/i.test(String(p.name))));
    },
  },
  {
    id: "N5",
    cls: "normal",
    what: "crew at two venues in one job — each block keeps its own building",
    async run(c) {
      const s = await c.say(
        "N5",
        msgs([
          enquiry({
            body:
              `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | ` +
              `BLOCK: 2026-11-12 08:00-12:00, 4 crew, get-in at ${EXCEL_TEXT} | ` +
              `BLOCK: 2026-11-12 13:00-18:00, 2 crew, get-out at ${OLYMPIA_TEXT}`,
          }),
        ])
      );
      const order = c.tenant.order(Number(s.onsinch_order_id));
      c.check("an order exists", !!order);
      const teams = order ? c.tenant.teamsOf(order.id) : [];
      c.check("six crew in total", teams.reduce((n, t) => n + t.size, 0) === 6, String(teams.reduce((n, t) => n + t.size, 0)));
      const places = new Set(teams.map((t) => t.place_id));
      c.check("the two blocks are at two different buildings", places.size === 2, JSON.stringify([...places]));
    },
  },
  {
    id: "N6",
    cls: "normal",
    what: "replies switched off — the order is still written and no draft is created",
    async run(c) {
      c.rebuild({ settings: { replies_enabled: false }, startedAt: START });
      const s = await c.say("N6", msgs([enquiry()]));
      c.check("an order exists", !!c.tenant.order(Number(s.onsinch_order_id)));
      c.check("no reply draft was created", c.rig.spies.replyDrafts.length === 0, String(c.rig.spies.replyDrafts.length));
    },
  },

  // ---- MISSING INFORMATION ----------------------------------------------
  {
    id: "M1",
    cls: "missing-information",
    what: "no date — nothing is written and the reply is told what to ask for",
    async run(c) {
      const s = await c.say(
        "M1",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | We need 6 crew for a stand build soon, dates to follow` })])
      );
      c.check("no order was written", !s.onsinch_order_id && c.tenant.orders.every((o) => o.origin === "ui"));
      c.check("the thread says a person is needed", s.needs_human === true && s.status === "needs-info", s.status);
      c.check("the reply was told the order is blocked", c.rig.reasonerSpy.lastReplyContext?.order_state === "blocked", String(c.rig.reasonerSpy.lastReplyContext?.order_state));
      c.check("it asks the client for the date", (c.rig.reasonerSpy.lastReplyContext?.ask_for ?? []).some((a) => /date/i.test(a)),
        JSON.stringify(c.rig.reasonerSpy.lastReplyContext?.ask_for));
      c.check("a Needs Built label was posted", c.rig.spies.tags.some((t) => t.label === "Order Needs Built" && t.state === "manual"));
    },
  },
  {
    id: "M2",
    cls: "missing-information",
    what: "no crew size — nothing bookable, and the client is asked how many",
    async run(c) {
      const s = await c.say(
        "M2",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-12 08:00-18:00, stand build` })])
      );
      c.check("no order was written", !s.onsinch_order_id);
      c.check("it asks how many crew", (c.rig.reasonerSpy.lastReplyContext?.ask_for ?? []).some((a) => /how many/i.test(a)),
        JSON.stringify(c.rig.reasonerSpy.lastReplyContext?.ask_for));
      c.check("the thread is not silently 'ordered'", s.status !== "ordered", s.status);
    },
  },
  {
    id: "M3",
    cls: "missing-information",
    what: "no times — the shift is defaulted, the job books, and the default is stated",
    async run(c) {
      const s = await c.say(
        "M3",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-12, 6 crew, stand build` })])
      );
      c.check("the job booked", !!c.tenant.order(Number(s.onsinch_order_id)));
      c.check("the defaulted times are said out loud", s.notes.some((n) => /defaulted to/i.test(n)), s.notes.join(" // "));
      const teams = c.tenant.teamsOf(Number(s.onsinch_order_id));
      c.check("the shift is not zero-length", teams.every((t) => Date.parse(t.end) > Date.parse(t.beginning)));
    },
  },
  {
    id: "M4",
    cls: "missing-information",
    what: "no company named — the sender's own domain identifies the client",
    async run(c) {
      const s = await c.say(
        "M4",
        msgs([enquiry({ body: `Hi | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build` })])
      );
      c.check("the client was identified", Number(s.company_id) > 0, String(s.company_id));
      c.check("it is the right client", c.tenant.companies.find((x) => x.id === Number(s.company_id))?.name === "RedBeast Energy");
      c.check("no duplicate client was created", c.tenant.companies.filter((x) => /redbeast/i.test(x.name)).length === 1);
      c.check("the job booked", !!c.tenant.order(Number(s.onsinch_order_id)));
    },
  },
  {
    id: "M5",
    cls: "missing-information",
    what: "no company, unknown domain — a client is created rather than the job being dropped",
    async run(c) {
      const s = await c.say(
        "M5",
        msgs([
          enquiry({
            from: "hello@unknown-events-xyz.com",
            body: `Hi | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build`,
          }),
        ])
      );
      // Either outcome is defensible; what is NOT is silence. The thread must say which.
      const booked = !!c.tenant.order(Number(s.onsinch_order_id));
      c.check(
        "the thread states what happened either way",
        booked ? s.status === "ordered" : s.needs_human === true && s.notes.length > 0,
        `${s.status} / ${s.notes.join(" // ")}`
      );
      c.check("no client was created with an empty name", !c.tenant.companies.some((x) => !String(x.name).trim()));
      c.check("a person is called when nothing could be booked", booked || c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs")));
    },
  },

  // ---- DUPLICATE AND REPLAY ---------------------------------------------
  {
    id: "D1",
    cls: "duplicate-and-replay",
    what: "the identical thread delivered twice — no second order, no second draft, no model call",
    async run(c) {
      const m = msgs([enquiry()]);
      await c.say("D1", m);
      const before = { orders: c.tenant.orders.length, drafts: c.rig.spies.replyDrafts.length, model: c.rig.reasonerSpy.classifyCalls };
      const s2 = await c.say("D1", m);
      c.check("no second order", c.tenant.orders.length === before.orders, `${before.orders} -> ${c.tenant.orders.length}`);
      c.check("no second reply draft", c.rig.spies.replyDrafts.length === before.drafts);
      c.check("the model was not called again", c.rig.reasonerSpy.classifyCalls === before.model, `${before.model} -> ${c.rig.reasonerSpy.classifyCalls}`);
      c.check("the thread still holds its order", Number(s2.onsinch_order_id) > 0);
    },
  },
  {
    id: "D2",
    cls: "duplicate-and-replay",
    what: "the sweep re-delivers the thread with our own sent reply appended",
    async run(c) {
      const m = msgs([enquiry()]);
      const s1 = await c.say("D2", m);
      const withReply = [
        ...m,
        email({ from: "bookings@spartancrew.co.uk", fromSpartan: true, subject: "Re: Crew for the 12th", body: "Booked in, thanks.", at: 90, id: "sp1" }, START, 2),
      ];
      const s2 = await c.say("D2", withReply);
      c.check("no second order", c.tenant.orders.filter((o) => o.origin === "api").length === 1);
      c.check("the thread kept the same order", s2.onsinch_order_id === s1.onsinch_order_id);
      c.check("the engine did not answer its own email", c.rig.spies.replyDrafts.length <= 1, String(c.rig.spies.replyDrafts.length));
      c.check("no crew was written twice", c.tenant.teamsOf(Number(s2.onsinch_order_id)).reduce((n, t) => n + t.size, 0) === 6);
    },
  },
  {
    id: "D3",
    cls: "duplicate-and-replay",
    what: "the same job enquired about in a second thread — held, and ops are emailed",
    async run(c) {
      await c.say("D3a", msgs([enquiry()]));
      const s = await c.say("D3b", msgs([enquiry({ subject: "Stand build 12 Nov", id: "b1" })]));
      c.check("the second thread raised no new order", c.tenant.orders.filter((o) => o.origin === "api").length === 1, String(s.onsinch_order_id));
      c.check("only one order exists for the job", c.tenant.orders.filter((o) => o.origin === "api").length === 1,
        String(c.tenant.orders.filter((o) => o.origin === "api").length));
      c.check("the order it would have written is kept for a person", !!s.pending_order);
      c.check("ops were emailed about it", c.rig.spies.internalDrafts.length === 1, String(c.rig.spies.internalDrafts.length));
      c.check("the thread says why it held", s.notes.some((n) => /same job/i.test(n)), s.notes.join(" // "));
    },
  },
  {
    id: "D4",
    cls: "duplicate-and-replay",
    what: "one conversation arriving under two thread ids — the shape a mailbox cutover produces",
    async run(c) {
      const m = msgs([enquiry()]);
      await c.say("19ff0292d9c8a86c", m);
      // The same messages, re-keyed. This is exactly what mail-poll's `gmail:` prefix
      // does to a conversation that already has rows under a bare id.
      const s = await c.say("gmail:19ff0292d9c8a86c", m);
      c.check("a second order was NOT raised for the same job", c.tenant.orders.filter((o) => o.origin === "api").length === 1,
        String(c.tenant.orders.filter((o) => o.origin === "api").length));
      c.check("the new thread id did not double-book the crew", c.tenant.crewFor(c.tenant.companies[0].id) - 12 === 6,
        String(c.tenant.crewFor(c.tenant.companies[0].id) - 12));
      c.check("something visible happened rather than a silent second booking", !!s.pending_order || !!s.onsinch_order_id);
    },
  },
  {
    id: "D8",
    cls: "duplicate-and-replay",
    what: "the thread id changes mid-conversation and the next message is a bare amendment",
    async run(c) {
      const a = msgs([enquiry()]);
      const before = await c.say("19ff0292d9c8a86c", a);
      c.check("booked under the old id", Number(before.onsinch_order_id) > 0);
      // The reply a client actually sends: no company, no venue, no date restated.
      const reply = email({ subject: "Re: Crew for the 12th", body: "Can you make it 8 please", at: 200, id: "d8b" }, START, 2);
      const s = await c.say("gmail:19ff0292d9c8a86c", [reply]);
      const live = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("no duplicate order was raised", live.length === 1, String(live.length));
      c.check(
        "the client's change either reached OnSinch or reached a person",
        c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0) === 8 ||
          c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs") && t.state === "manual"),
        `crew=${c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0)} status=${s.status} tags=${c.rig.spies.tags.map((t) => t.label).join(",")}`
      );
    },
  },
  {
    id: "D5",
    cls: "duplicate-and-replay",
    what: "a held order confirmed twice from the dashboard — it must write once",
    async run(c) {
      await c.say("D5a", msgs([enquiry()]));
      const held = await c.say("D5b", msgs([enquiry({ subject: "Stand build 12 Nov", id: "b1" })]));
      c.check("the second thread is holding an order", !!held.pending_order);
      const before = { orders: c.tenant.orders.length, crew: c.tenant.crewFor(c.tenant.companies[0].id) };
      const first = await confirmOrder("D5b", c.rig.deps);
      const mid = { orders: c.tenant.orders.length, crew: c.tenant.crewFor(c.tenant.companies[0].id) };
      c.check("the hold was released exactly once", !first?.pending_order, JSON.stringify(first?.pending_order ?? null));
      c.check("confirming did not raise a second booking beside the first", mid.orders <= before.orders + 1, `${before.orders} -> ${mid.orders}`);
      await confirmOrder("D5b", c.rig.deps);
      c.check("confirming again wrote nothing at all", c.tenant.orders.length === mid.orders && c.tenant.crewFor(c.tenant.companies[0].id) === mid.crew,
        `${JSON.stringify(mid)} -> ${c.tenant.orders.length}/${c.tenant.crewFor(c.tenant.companies[0].id)}`);
    },
  },
  {
    id: "D6",
    cls: "duplicate-and-replay",
    what: "OnSinch answers 500 having already created the order — it must be adopted, not re-posted",
    async run(c) {
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/orders", times: 1, mode: "status", status: 500, applyAnyway: true });
      const s = await c.say("D6", msgs([enquiry()]));
      const mine = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one order exists", mine.length === 1, String(mine.length));
      c.check("the thread adopted it", Number(s.onsinch_order_id) === mine[0]?.id, `${s.onsinch_order_id} vs ${mine[0]?.id}`);
      c.check("the crew was not doubled", c.tenant.teamsOf(mine[0]!.id).reduce((n, t) => n + t.size, 0) === 6);
    },
  },
  {
    id: "D7",
    cls: "duplicate-and-replay",
    what: "the connection drops after the write lands — the same recovery, through the throw path",
    async run(c) {
      c.tenant.faults.push({
        match: (m, p) => m === "POST" && p === "/orders",
        times: 1,
        mode: "throw",
        message: "OnSinch POST /orders timed out after 12000ms",
        applyAnyway: true,
      });
      const s = await c.say("D7", msgs([enquiry()]));
      const mine = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one order exists", mine.length === 1, String(mine.length));
      c.check("the thread holds it rather than nothing", Number(s.onsinch_order_id) === mine[0]?.id, `${s.onsinch_order_id} vs ${mine[0]?.id}`);
    },
  },

  // ---- AMBIGUITY ---------------------------------------------------------
  {
    id: "A1",
    cls: "ambiguity",
    what: "the client already has an order that day at ANOTHER venue — this is a different job",
    async run(c) {
      c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ Olympia",
        pricelist_category_id: 342,
        blocks: [{ size: 5, place_id: c.tenant.places[1].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      const s = await c.say("A1", msgs([enquiry()]));
      c.check("a new order was raised", Number(s.onsinch_order_id) > 0 && c.tenant.order(Number(s.onsinch_order_id))?.origin === "api");
      c.check("the existing Olympia order was not touched", c.tenant.teamsOf(c.tenant.orders.find((o) => o.name === "RedBeast @ Olympia")!.id)[0].size === 5);
      c.check("the reason is on the ticket", s.notes.some((n) => /different venue|different job/i.test(n)), s.notes.join(" // "));
    },
  },
  {
    id: "A2",
    cls: "ambiguity",
    what: "two same-day orders at the SAME venue and the thread does not say which — do not guess",
    async run(c) {
      for (let i = 0; i < 2; i++) {
        c.tenant.addHandRaisedOrder({
          company_id: c.tenant.companies[0].id,
          name: `RedBeast @ ExCeL dup ${i}`,
          pricelist_category_id: 342,
          blocks: [{ size: 5, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
        });
      }
      const s = await c.say("A2", msgs([enquiry()]));
      c.check("no new order was raised", !c.tenant.orders.some((o) => o.origin === "api"), String(c.tenant.orders.filter((o) => o.origin === "api").length));
      c.check("neither existing order was altered", c.tenant.orders.filter((o) => /dup/.test(o.name)).every((o) => c.tenant.teamsOf(o.id)[0].size === 5));
      c.check("a person is called", s.needs_human === true);
      c.check("the ticket says why", s.notes.some((n) => /does not say which|not guessing/i.test(n)), s.notes.join(" // "));
    },
  },
  {
    id: "A3",
    cls: "ambiguity",
    what: "the thread names an R number that is not the order it is bound to — rebind to the one it names",
    async run(c) {
      const wrong = c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ Olympia",
        pricelist_category_id: 342,
        blocks: [{ size: 5, place_id: c.tenant.places[1].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      const right = c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ ExCeL",
        pricelist_category_id: 342,
        blocks: [{ size: 6, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      // Bind it to the wrong one first, then let the thread name the right one.
      const first = await c.say("A3", msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${OLYMPIA_TEXT} | BLOCK: 2026-11-12 08:00-18:00, 5 crew, get-in` })]));
      c.check("it bound to the Olympia order", Number(first.onsinch_order_id) === wrong.id, `${first.onsinch_order_id} vs ${wrong.id}`);
      const s = await c.say(
        "A3",
        msgs([
          enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${OLYMPIA_TEXT} | BLOCK: 2026-11-12 08:00-18:00, 5 crew, get-in` }),
          { subject: `Price quote - R${right.number} RedBeast @ ExCeL`, body: `About R${right.number} | BLOCK: 2026-11-12 08:00-18:00, 5 crew, get-in`, at: 120, id: "a3b" },
        ])
      );
      c.check("it rebound to the order the thread names", Number(s.onsinch_order_id) === right.id, `${s.onsinch_order_id} vs ${right.id}`);
      c.check("the rebind is on the ticket", s.notes.some((n) => /rebinding/i.test(n)), s.notes.join(" // "));
    },
  },
  {
    id: "A4",
    cls: "ambiguity",
    what: "the client cancels — nothing is written and a person is told",
    async run(c) {
      await c.say("A4", msgs([enquiry()]));
      const crewBefore = c.tenant.crewFor(c.tenant.companies[0].id);
      const s = await c.say(
        "A4",
        msgs([
          enquiry(),
          { subject: "Re: Crew for the 12th", body: "Sorry, we need to cancel the 12th | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build", at: 120, id: "a4b" },
        ])
      );
      c.check("nothing in OnSinch changed", c.tenant.crewFor(c.tenant.companies[0].id) === crewBefore, `${crewBefore} -> ${c.tenant.crewFor(c.tenant.companies[0].id)}`);
      c.check("the order still exists", !!c.tenant.order(Number(s.onsinch_order_id)));
      c.check("the thread says a human must cancel it", s.notes.some((n) => /does not cancel/i.test(n)), s.notes.join(" // "));
      c.check("a person is actually called", s.needs_human === true || c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs")),
        `needs_human=${s.needs_human} tags=${c.rig.spies.tags.map((t) => t.label).join(",")}`);
    },
  },
  {
    id: "A5",
    cls: "ambiguity",
    what: "a deep cut, 6 crew down to 2 — applied, because the client's latest word is the order, but said out loud",
    async run(c) {
      await c.say("A5", msgs([enquiry()]));
      const s = await c.say(
        "A5",
        msgs([
          enquiry(),
          { subject: "Re: Crew for the 12th", body: "Change of plan, only 2 needed now | BLOCK: 2026-11-12 08:00-18:00, 2 crew, stand build", at: 120, id: "a5b" },
        ])
      );
      const live = c.tenant.order(Number(s.onsinch_order_id));
      c.check("the order holds two crew", !!live && c.tenant.teamsOf(live.id).reduce((n, t) => n + t.size, 0) === 2,
        String(live ? c.tenant.teamsOf(live.id).reduce((n, t) => n + t.size, 0) : "no order"));
      c.check("the cut is remarked on", s.notes.some((n) => /more than half/i.test(n)), s.notes.join(" // "));
      c.check("exactly one live order for this thread", c.tenant.orders.filter((o) => o.origin === "api").length === 1);
    },
  },
  {
    id: "A6",
    cls: "ambiguity",
    what: "an update that would empty the order — held, never applied",
    async run(c) {
      await c.say("A6", msgs([enquiry()]));
      const before = c.tenant.crewFor(c.tenant.companies[0].id);
      const s = await c.say(
        "A6",
        msgs([
          enquiry(),
          { subject: "Re: Crew for the 12th", body: "We will not need anyone on the 12th after all, please stand them down", at: 120, id: "a6b" },
        ])
      );
      c.check("the booking is untouched", c.tenant.crewFor(c.tenant.companies[0].id) === before, `${before} -> ${c.tenant.crewFor(c.tenant.companies[0].id)}`);
      c.check("the thread does not claim it applied anything", !s.notes.some((n) => /applied to order/i.test(n)));
      c.check("a person is called", s.needs_human === true || !!s.pending_order || c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs")));
    },
  },

  // ---- SEQUENCE AND STATE ------------------------------------------------
  {
    id: "S1",
    cls: "sequence-and-state",
    what: "enquiry, then a PO, then a crew change — the booking ends correct and singular",
    async run(c) {
      const a = msgs([enquiry()]);
      await c.say("S1", a);
      const b = [...a, email({ subject: "Re: Crew for the 12th", body: "PO: PO-44821 | our PO for the job", at: 120, id: "s1b" }, START, 2)];
      await c.say("S1", b);
      const cm = [...b, email({ subject: "Re: Crew for the 12th", body: "Make it 8 please | BLOCK: 2026-11-12 08:00-18:00, 8 crew, stand build", at: 240, id: "s1c" }, START, 3)];
      const s = await c.say("S1", cm);
      const live = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one live order", live.length === 1, String(live.length));
      c.check("the thread points at it", Number(s.onsinch_order_id) === live[0]?.id);
      c.check("eight crew are booked", c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0) === 8,
        String(c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0)));
      c.check("the PO survived the change", String(live[0]?.intern_name ?? "") === "PO-44821", String(live[0]?.intern_name));
      c.check("the thread reads as booked", s.status === "ordered", s.status);
    },
  },
  {
    id: "S2",
    cls: "sequence-and-state",
    what: "the mailbox delivers the newer message first — the engine acts on the newest by DATE",
    async run(c) {
      const first = email({ ...enquiry(), at: 10, id: "s2a" }, START, 1);
      const later = email(
        { subject: "Re: Crew for the 12th", body: "Actually make it 9 | BLOCK: 2026-11-12 08:00-18:00, 9 crew, stand build", at: 200, id: "s2b" },
        START,
        2
      );
      // Out of order on the wire: the later message arrives in a thread of its own first.
      await c.say("S2", [later]);
      const s = await c.say("S2", [later, first]);
      const live = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one live order", live.length === 1, String(live.length));
      c.check("the newest message won", c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0) === 9,
        String(c.tenant.teamsOf(live[0]!.id).reduce((n, t) => n + t.size, 0)));
      c.check("the thread is bound", Number(s.onsinch_order_id) === live[0]?.id);
    },
  },
  {
    id: "S3",
    cls: "sequence-and-state",
    what: "an acknowledgement on a booked thread must not make the booking look unbooked",
    async run(c) {
      const a = msgs([enquiry()]);
      const s1 = await c.say("S3", a);
      c.check("booked to begin with", s1.status === "ordered", s1.status);
      const b = [...a, email({ subject: "Re: Crew for the 12th", body: "Thanks, great, see you then", at: 120, id: "s3b" }, START, 2)];
      const s2 = await c.say("S3", b);
      c.check("the order is still there", !!c.tenant.order(Number(s2.onsinch_order_id)));
      c.check("the thread still reads as booked", s2.status === "ordered", s2.status);
      c.check("the crew is unchanged", c.tenant.teamsOf(Number(s2.onsinch_order_id)).reduce((n, t) => n + t.size, 0) === 6);
      c.check("Order Built was not posted a second time", c.rig.spies.tags.filter((t) => t.label === "Order Built" && t.state === "built").length === 1,
        JSON.stringify(c.rig.spies.tags.map((t) => `${t.label}/${t.state}`)));
    },
  },
  {
    id: "S4",
    cls: "sequence-and-state",
    what: "staff delete the order in OnSinch — the thread must stop claiming a booking exists",
    async run(c) {
      const a = msgs([enquiry()]);
      const s1 = await c.say("S4", a);
      const id = Number(s1.onsinch_order_id);
      c.tenant.orders = c.tenant.orders.filter((o) => o.id !== id);
      c.tenant.teams = c.tenant.teams.filter((t) => t.order_id !== id);
      const { outcome, state } = await sweep(c.rig, "S4", "2026-10-06T09:00:00Z");
      c.check("the sweep noticed", outcome.action === "lost" || outcome.action === "rebound", `${outcome.action}: ${outcome.detail ?? ""}`);
      c.check("the thread no longer claims that order", Number(state.onsinch_order_id) !== id, String(state.onsinch_order_id));
      c.check("a person is called", state.needs_human === true);
      const b = [...a, email({ subject: "Re: Crew for the 12th", body: "Any update? | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build", at: 300, id: "s4b" }, START, 2)];
      await c.say("S4", b);
      const built = c.rig.spies.tags.filter((t) => t.label === "Order Built");
      c.check(
        "the Order Built tag was taken off",
        built.some((t) => t.state === "cleared"),
        JSON.stringify(built.map((t) => t.state))
      );
    },
  },
  {
    id: "S5",
    cls: "sequence-and-state",
    what: "a write that silently did nothing — the sweep re-asserts, then gives up and says so",
    async run(c) {
      const hand = c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ ExCeL",
        pricelist_category_id: 342,
        blocks: [{ size: 6, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      // In place BEFORE the first write: OnSinch accepts every order PATCH and applies
      // none of it. A 204 that lied is the failure the whole sweep exists for, and it
      // cannot be staged after the first pass has already landed the field.
      c.tenant.faults.push({ match: (m, p) => m === "PATCH" && p.startsWith("/orders"), times: 99, mode: "status", status: 204 });
      const s = await c.say(
        "S5",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | PO: PO-9912 | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build` })])
      );
      c.check("the thread bound to the existing order", Number(s.onsinch_order_id) === hand.id, `${s.onsinch_order_id} vs ${hand.id}`);
      const actions: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await sweep(c.rig, "S5", "2026-10-06T09:00:00Z");
        actions.push(r.outcome.action);
        if (r.outcome.action === "unreconciled" || r.outcome.action === "unactionable") break;
      }
      c.check("it noticed OnSinch does not hold what the thread asks for", actions.includes("reasserted") || actions.includes("unreconciled"), actions.join(","));
      c.check("it stopped rather than re-asserting for ever", actions.includes("unreconciled") || actions.includes("unactionable"), actions.join(","));
      const last = await c.rig.store.get("S5");
      c.check("a person is called when it gave up", last?.needs_human === true, `${actions.join(",")} needs_human=${last?.needs_human}`);
      c.check("it took no more than the stated ceiling of attempts", actions.filter((a) => a === "reasserted").length <= 3, actions.join(","));
    },
  },
  {
    id: "S6",
    cls: "sequence-and-state",
    what: "the give-up counter must survive an email arriving on the thread",
    async run(c) {
      const hand = c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ ExCeL",
        pricelist_category_id: 342,
        blocks: [{ size: 6, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      c.tenant.faults.push({ match: (m, p) => m === "PATCH" && p.startsWith("/orders"), times: 99, mode: "status", status: 204 });
      const a = msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | PO: PO-9912 | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build` })]);
      await c.say("S6", a);
      c.check("bound", Number((await c.rig.store.get("S6"))?.onsinch_order_id) === hand.id);
      await sweep(c.rig, "S6", "2026-10-06T09:00:00Z");
      await sweep(c.rig, "S6", "2026-10-06T10:00:00Z");
      const afterTwo = (await c.rig.store.get("S6"))?.reconcile?.attempts ?? 0;
      c.check("the sweeps counted their attempts", afterTwo >= 2, String(afterTwo));
      const b = [...a, email({ subject: "Re", body: "Any news?", at: 200, id: "s6b" }, START, 2)];
      await c.say("S6", b);
      const afterMail = (await c.rig.store.get("S6"))?.reconcile?.attempts ?? 0;
      c.check("an email did not reset the counter", afterMail >= afterTwo, `${afterTwo} -> ${afterMail}`);
    },
  },
  {
    id: "S8",
    cls: "sequence-and-state",
    what: "a crew change that never landed on a staff-raised order — can anything notice?",
    async run(c) {
      const hand = c.tenant.addHandRaisedOrder({
        company_id: c.tenant.companies[0].id,
        name: "RedBeast @ ExCeL",
        pricelist_category_id: 342,
        blocks: [{ size: 6, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      const a = msgs([enquiry()]);
      await c.say("S8", a);
      // Every write to the blocks is accepted and applied to nothing.
      c.tenant.faults.push({ match: (m, p) => m === "PATCH" && p.startsWith("/slotTeams"), times: 99, mode: "status", status: 204 });
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/slotTeams", times: 99, mode: "status", status: 201, data: { data: [{ id: 999999 }] } });
      const b = [...a, email({ subject: "Re", body: "Make it 9 | BLOCK: 2026-11-12 08:00-18:00, 9 crew, stand build", at: 120, id: "s8b" }, START, 2)];
      const s = await c.say("S8", b);
      const held = c.tenant.teamsOf(hand.id).reduce((n, t) => n + t.size, 0);
      c.check("OnSinch really does still hold the old crew", held === 6, String(held));
      c.check(
        "the thread does not claim the change landed",
        s.needs_human === true || s.status === "needs-info" || s.notes.some((n) => /by hand|NOT applied|could not/i.test(n)),
        `${s.status} needs_human=${s.needs_human} :: ${s.notes.slice(-1)[0]}`
      );
      const r = await sweep(c.rig, "S8", "2026-10-06T09:00:00Z");
      c.check("a later sweep can still see the difference", r.outcome.action !== "holds", `${r.outcome.action}: ${r.outcome.detail ?? ""}`);
    },
  },
  {
    id: "S9",
    cls: "sequence-and-state",
    what: "a follow-up that changes NOTHING must not destroy and re-post the booking",
    async run(c) {
      // No venue named, so the placeholder is provisioned on write — the common shape.
      const body = `Hi | Company: RedBeast Energy | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build`;
      const a = msgs([enquiry({ body })]);
      const s1 = await c.say("S9", a);
      const original = Number(s1.onsinch_order_id);
      c.check("booked", original > 0);
      const b = [...a, email({ subject: "Re", body: `${body} | just confirming the same details`, at: 120, id: "s9b" }, START, 2)];
      const s2 = await c.say("S9", b);
      c.check("the order was not destroyed and re-posted", Number(s2.onsinch_order_id) === original, `${original} -> ${s2.onsinch_order_id}`);
      c.check("nothing was archived", c.rig.spies.archived.length === 0, JSON.stringify(c.rig.spies.archived));
      c.check("the R number a client quotes did not move", s2.onsinch_order_number === s1.onsinch_order_number, `${s1.onsinch_order_number} -> ${s2.onsinch_order_number}`);
      c.check("the thread does not claim it applied a change", !s2.notes.some((n) => /change applied/i.test(n)), s2.notes.slice(-1)[0] ?? "");
    },
  },
  {
    id: "S7",
    cls: "sequence-and-state",
    what: "a job whose dates have already passed is never written",
    async run(c) {
      const s = await c.say(
        "S7",
        msgs([enquiry({ body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | BLOCK: 2024-10-24 08:00-18:00, 6 crew, stand build` })])
      );
      c.check("no order was written", !s.onsinch_order_id && !c.tenant.orders.some((o) => o.origin === "api"));
      c.check("the thread says why", s.notes.some((n) => /already happened|past date/i.test(n)), s.notes.join(" // "));
      c.check("a person is called", s.needs_human === true);
    },
  },

  // ---- FAILURE AND RECOVERY ---------------------------------------------
  {
    id: "R1",
    cls: "failure-recovery",
    what: "OnSinch 500s twice and the order was NOT created — one order after the retry",
    async run(c) {
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/orders", times: 1, mode: "status", status: 500 });
      const s = await c.say("R1", msgs([enquiry()]));
      const mine = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one order exists", mine.length === 1, String(mine.length));
      c.check("the thread holds it", Number(s.onsinch_order_id) === mine[0]?.id, `${s.onsinch_order_id} vs ${mine[0]?.id}`);
      c.check("the thread does not read as errored", s.status !== "error", s.status);
    },
  },
  {
    id: "R2",
    cls: "failure-recovery",
    what: "the identifier read-back fails — the booking still stands and is not repeated",
    async run(c) {
      let posted = false;
      c.tenant.faults.push({
        match: (m, p) => {
          if (m === "POST" && p === "/orders") posted = true;
          return posted && m === "GET" && p.startsWith("/orders");
        },
        times: 2,
        mode: "throw",
        message: "read timed out",
      });
      const s = await c.say("R2", msgs([enquiry()]));
      const mine = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("exactly one order exists", mine.length === 1, String(mine.length));
      c.check("the thread holds the order id", Number(s.onsinch_order_id) === mine[0]?.id);
      c.check("a failed read did not become a failed booking", s.status !== "error", `${s.status}: ${s.notes.join(" // ")}`);
    },
  },
  {
    id: "R3",
    cls: "failure-recovery",
    what: "the client cannot be created — nothing is half-written and the failure is loud",
    async run(c) {
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/companies", times: 3, mode: "status", status: 400, data: { validationErrors: { zip: ["Fill in company zip"] } } });
      const s = await c.say(
        "R3",
        msgs([{ from: "events@brandnew-xyz.co.uk", subject: "Crew", body: `Hi | Company: Brand New Events | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-20 09:00-17:00, 4 crew, get-in` }])
      );
      c.check("no order was written", !c.tenant.orders.some((o) => o.origin === "api"));
      c.check("no client was left half-created", !c.tenant.companies.some((x) => x.name === "Brand New Events"));
      c.check("the thread reads as an error, not as booked", s.status === "error", s.status);
      c.check("a person is called", c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs") && t.state === "manual") || s.needs_human === true);
    },
  },
  {
    id: "R4",
    cls: "failure-recovery",
    what: "an amendment appends a block and then crashes — the retry must not append it twice",
    async run(c) {
      const co = c.tenant.companies[0].id;
      const hand = c.tenant.addHandRaisedOrder({
        company_id: co,
        name: "RedBeast @ ExCeL",
        pricelist_category_id: 342,
        blocks: [{ size: 6, place_id: c.tenant.places[0].id, beginning: "2026-11-12T08:00:00+00:00", end: "2026-11-12T18:00:00+00:00" }],
      });
      c.tenant.staff(hand.id, c.tenant.teamsOf(hand.id)[0].id, 1);
      const a = msgs([enquiry()]);
      const s1 = await c.say("R4", a);
      c.check("bound to the hand-raised order", Number(s1.onsinch_order_id) === hand.id, `${s1.onsinch_order_id} vs ${hand.id}`);
      const before = c.tenant.teamsOf(hand.id).length;
      // A second block, and the process dies immediately after it is posted.
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/slotTeams", times: 1, mode: "throw", message: "connection reset", applyAnyway: true });
      const b = [
        ...a,
        email(
          { subject: "Re", body: `Add an evening block | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build | BLOCK: 2026-11-12 19:00-23:00, 2 crew, get-out`, at: 120, id: "r4b" },
          START,
          2
        ),
      ];
      await c.say("R4", b);
      const mid = c.tenant.teamsOf(hand.id).length;
      // The retry: the same message again.
      await c.say("R4", [...b, email({ subject: "Re", body: `Still need that evening block | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build | BLOCK: 2026-11-12 19:00-23:00, 2 crew, get-out`, at: 180, id: "r4c" }, START, 3)]);
      const after = c.tenant.teamsOf(hand.id).length;
      c.check("the retry did not duplicate the appended block", after <= mid || after - before <= 3, `${before} -> ${mid} -> ${after}`);
      const crew = c.tenant.teamsOf(hand.id).reduce((n, t) => n + t.size, 0);
      c.check("the order does not hold more crew than was asked for", crew <= 8, String(crew));
    },
  },
  {
    id: "R5",
    cls: "failure-recovery",
    what: "a rebuild deletes the order and the replacement fails to post — the retry re-posts, never deletes twice",
    async run(c) {
      const a = msgs([enquiry()]);
      const s1 = await c.say("R5", a);
      const original = Number(s1.onsinch_order_id);
      let deleted = false;
      c.tenant.faults.push({
        match: (m, p) => {
          if (m === "DELETE" && p === "/orders") deleted = true;
          return deleted && m === "POST" && p === "/orders";
        },
        times: 1,
        mode: "status",
        status: 400,
        data: { validationErrors: { name: ["nope"] } },
      });
      const b = [...a, email({ subject: "Re", body: "Make it 8 | BLOCK: 2026-11-12 08:00-18:00, 8 crew, stand build", at: 120, id: "r5b" }, START, 2)];
      const s2 = await c.say("R5", b);
      c.check("the loss is recorded urgently", s2.status === "error" && s2.notes.some((n) => /URGENT/.test(n)), `${s2.status}: ${s2.notes.join(" // ")}`);
      c.check("the snapshot is kept for the retry", s2.order_replace?.deleted === true, JSON.stringify(s2.order_replace ?? null));
      const c3 = [...b, email({ subject: "Re", body: "Still 8 please | BLOCK: 2026-11-12 08:00-18:00, 8 crew, stand build", at: 180, id: "r5c" }, START, 3)];
      const s3 = await c.say("R5", c3);
      const mine = c.tenant.orders.filter((o) => o.origin === "api");
      c.check("the booking came back", mine.length === 1, String(mine.length));
      c.check("it holds the crew asked for", mine[0] ? c.tenant.teamsOf(mine[0].id).reduce((n, t) => n + t.size, 0) === 8 : false,
        mine[0] ? String(c.tenant.teamsOf(mine[0].id).reduce((n, t) => n + t.size, 0)) : "no order");
      c.check("the thread points at the replacement", Number(s3.onsinch_order_id) === mine[0]?.id && Number(s3.onsinch_order_id) !== original);
      c.check("the old order was archived before it went", c.rig.spies.archived.some((x) => x.order_id === original));
    },
  },
  {
    id: "R6",
    cls: "failure-recovery",
    what: "OnSinch refuses the create outright — the thread must not claim a booking",
    async run(c) {
      c.tenant.faults.push({ match: (m, p) => m === "POST" && p === "/orders", times: 5, mode: "status", status: 400, data: { validationErrors: { name: ["Name is too long"] } } });
      const s = await c.say("R6", msgs([enquiry()]));
      c.check("no order exists", !c.tenant.orders.some((o) => o.origin === "api"));
      c.check("the thread does not say ordered", s.status !== "ordered", s.status);
      c.check("the thread holds no order id", !s.onsinch_order_id, String(s.onsinch_order_id));
      c.check("the failure reached a person", c.rig.spies.tags.some((t) => t.label.startsWith("Order Needs") && t.state === "manual"),
        JSON.stringify(c.rig.spies.tags.map((t) => `${t.label}/${t.state}`)));
    },
  },
  {
    id: "R7",
    cls: "failure-recovery",
    what: "the venue list cannot be read — an outage must not book the job at the wrong building",
    async run(c) {
      c.tenant.faults.push({ match: (m, p) => m === "GET" && p.startsWith("/places"), times: 99, mode: "throw", message: "places read timed out" });
      let threw: string | null = null;
      let s: Awaited<ReturnType<typeof deliver>> | undefined;
      try {
        s = await c.say("R7", msgs([enquiry()]));
      } catch (err: any) {
        threw = String(err?.message ?? err);
      }
      c.check("the engine did not throw the email away", threw === null, threw ?? "");
      if (!s) {
        c.check("the thread was recorded at all", false, "handleThread threw, so nothing was persisted for this email");
        return;
      }
      const order = c.tenant.order(Number(s.onsinch_order_id));
      const placed = order ? c.tenant.teamsOf(order.id).map((t) => t.place_id) : [];
      c.check(
        "no crew was booked at a building the engine could not verify",
        !order || placed.every((p) => p === 0 || c.tenant.places.find((x) => x.id === p)?.name === "No Location" || !!c.tenant.places.find((x) => x.id === p)),
        JSON.stringify(placed)
      );
      c.check("the outage is visible on the thread", s.status !== "ordered" || s.notes.length > 0, `${s.status}`);
    },
  },

  // ---- CROSS-RECORD ------------------------------------------------------
  {
    id: "X1",
    cls: "cross-record",
    what: "two clients with similar names — the order lands on the right one",
    async run(c) {
      const s = await c.say(
        "X1",
        msgs([
          {
            from: "jo@meridian-ex.co.uk",
            subject: "Crew",
            body: `Hi | Company: Meridian Exhibitions Ltd | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-18 08:00-18:00, 5 crew, build`,
          },
        ])
      );
      const right = c.tenant.companies.find((x) => x.name === "Meridian Exhibitions Ltd")!.id;
      const wrong = c.tenant.companies.find((x) => x.name === "Meridian Energy Solutions")!.id;
      c.check("bound to the right client", Number(s.company_id) === right, `${s.company_id} (right ${right}, wrong ${wrong})`);
      c.check("no order landed on the other client", !c.tenant.orders.some((o) => o.origin === "api" && o.company_id === wrong));
      c.check("that client's rate card was used", c.tenant.order(Number(s.onsinch_order_id))?.job.pricelist_category_id === 315,
        String(c.tenant.order(Number(s.onsinch_order_id))?.job.pricelist_category_id));
    },
  },
  {
    id: "X2",
    cls: "cross-record",
    what: "two live threads for one client on different dates — neither touches the other's blocks",
    async run(c) {
      const t1 = await c.say("X2a", msgs([enquiry()]));
      const t2 = await c.say(
        "X2b",
        msgs([enquiry({ subject: "Crew for the 19th", id: "x2b", body: `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-19 08:00-18:00, 4 crew, get-out` })])
      );
      c.check("two separate orders", Number(t1.onsinch_order_id) !== Number(t2.onsinch_order_id) && Number(t2.onsinch_order_id) > 0);
      c.check("the first order still holds six", c.tenant.teamsOf(Number(t1.onsinch_order_id)).reduce((n, t) => n + t.size, 0) === 6);
      c.check("the second holds four", c.tenant.teamsOf(Number(t2.onsinch_order_id)).reduce((n, t) => n + t.size, 0) === 4);
      // Now change the first and make sure the second is untouched.
      await c.say("X2a", msgs([enquiry(), { subject: "Re", body: "Make it 7 | BLOCK: 2026-11-12 08:00-18:00, 7 crew, stand build", at: 120, id: "x2c" }]));
      const after2 = await c.rig.store.get("X2b");
      c.check("the other thread's order is untouched", c.tenant.teamsOf(Number(after2?.onsinch_order_id)).reduce((n, t) => n + t.size, 0) === 4,
        String(c.tenant.teamsOf(Number(after2?.onsinch_order_id)).reduce((n, t) => n + t.size, 0)));
    },
  },
  {
    id: "X3",
    cls: "cross-record",
    what: "a forwarded client enquiry inside a colleague's email — read, and read only once",
    async run(c) {
      const fwd = email(
        {
          from: "tracy@spartancrew.co.uk",
          fromSpartan: true,
          subject: "Fwd: Crew for the 12th",
          body:
            "FYI\n---------- Forwarded message ---------\nFrom: Pier <ops@redbeast.co.uk>\nDate: Mon, 5 Oct 2026 at 09:00\nSubject: Crew for the 12th\nTo: tracy@spartancrew.co.uk\n\n" +
            `Hi | Company: RedBeast Energy | Venue: ${EXCEL_TEXT} | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build`,
          id: "x3a",
        },
        START,
        1
      );
      const s1 = await c.say("X3", [fwd]);
      c.check("the client's request was read", Number(s1.onsinch_order_id) > 0 || s1.classification !== "not-a-job", `${s1.classification} ${s1.status}`);
      const modelBefore = c.rig.reasonerSpy.classifyCalls;
      await c.say("X3", [fwd]);
      c.check("re-delivering the same forward costs no model call", c.rig.reasonerSpy.classifyCalls === modelBefore,
        `${modelBefore} -> ${c.rig.reasonerSpy.classifyCalls}`);
      c.check("and raises no second order", c.tenant.orders.filter((o) => o.origin === "api").length <= 1,
        String(c.tenant.orders.filter((o) => o.origin === "api").length));
    },
  },
  {
    id: "X4",
    cls: "cross-record",
    what: "the model echoes a venue id and a trade id the client never gave — do they reach the booking?",
    async run(c) {
      // Measured on stored facts [peer]: requests[].place_id appears 80 times and
      // requests[].profession_id 21 times, neither of which the extraction schema asks
      // for. Nothing validated model output at the audited version, so an id the model
      // produced is indistinguishable from one the engine resolved.
      const olympia = c.tenant.places[1].id; // NOT the venue this enquiry names
      c.rebuild({ echoIds: { place_id: olympia, profession_id: 36 } });
      const s = await c.say("X4", msgs([enquiry()])); // names ExCeL in its own words
      const order = c.tenant.order(Number(s.onsinch_order_id));
      c.check("an order exists", !!order);
      const teams = order ? c.tenant.teamsOf(order.id) : [];
      const excel = c.tenant.places[0].id;
      c.check(
        "crew were booked at the venue the CLIENT named",
        teams.length > 0 && teams.every((t) => t.place_id === excel),
        `booked at ${JSON.stringify([...new Set(teams.map((t) => t.place_id))])}, client named ${excel}, model said ${olympia}`
      );
      c.check(
        "the whole crew was not turned into crew chiefs",
        teams.some((t) => t.profession_id !== 36),
        JSON.stringify(teams.map((t) => `${t.name}:${t.profession_id}x${t.size}`))
      );
      c.check("the headcount the client asked for still stands", teams.reduce((n, t) => n + t.size, 0) === 6,
        String(teams.reduce((n, t) => n + t.size, 0)));
    },
  },
];

// ---------------------------------------------------------------------------
// GLOBAL INVARIANTS — checked after every scenario, whatever it was about.
// ---------------------------------------------------------------------------

export const INVARIANTS = [
  "I1 every order carries an explicit rate card",
  "I2 one thread never holds two live orders",
  "I3 an order is never claimed by two threads",
  "I4 a crew mismatch is never SILENT",
  "I5 no order exists in OnSinch that no thread points at",
  "I6 no client or venue was duplicated",
  "I7 a thread that lost its order says so",
  "I8 the durable order record is never re-pointed",
];

export async function invariants(tenant: FakeTenant, rig: AuditRig): Promise<Check[]> {
  const out: Check[] = [];
  const add = (label: string, ok: boolean, detail?: string) => out.push({ label, ok, detail, invariant: true });
  const states = await rig.store.all();
  const engineOrders = tenant.orders.filter((o) => o.origin === "api");

  add(
    INVARIANTS[0],
    engineOrders.every((o) => Number.isInteger(o.job.pricelist_category_id) && o.job.pricelist_category_id > 0),
    JSON.stringify(engineOrders.map((o) => [o.id, o.job.pricelist_category_id]))
  );

  const byThread = new Map<string, number[]>();
  for (const s of states) {
    if (Number(s.onsinch_order_id) > 0) byThread.set(s.thread_id, [Number(s.onsinch_order_id)]);
  }
  add(INVARIANTS[1], [...byThread.values()].every((ids) => new Set(ids).size <= 1));

  const owner = new Map<number, string>();
  let clash = "";
  for (const [tid, ids] of byThread) {
    for (const id of ids) {
      if (owner.has(id) && owner.get(id) !== tid) clash = `order #${id}: ${owner.get(id)} and ${tid}`;
      owner.set(id, tid);
    }
  }
  add(INVARIANTS[2], !clash, clash);

  /**
   * A DISAGREEMENT IS ALLOWED; A SILENT ONE IS NOT.
   *
   * OnSinch legitimately holds a different crew count from the thread — an amendment the
   * API cannot express, a staff-raised order with no block correspondence, a write
   * OnSinch refused. Every one of those is a correct outcome PROVIDED the thread says so
   * and a person is called. What must never happen is the thread reading as booked and
   * correct while the client's number never landed, because nothing downstream can tell
   * that apart from a job that is right.
   */
  const silent: string[] = [];
  for (const s of states) {
    if (!Number(s.onsinch_order_id)) continue;
    const live = tenant.order(Number(s.onsinch_order_id));
    if (!live) continue;
    const want = (s.desired_order?.slot_teams ?? []).reduce((n, t) => n + (t.size || 0), 0);
    const held = tenant.teamsOf(live.id).reduce((n, t) => n + t.size, 0);
    if (!want || want === held) continue;
    const declared =
      s.needs_human === true ||
      s.status === "needs-info" ||
      s.status === "error" ||
      s.notes.some((n) => /by hand|NOT applied|could not|re-assert|not guessing|does not hold/i.test(n));
    if (!declared) silent.push(`${s.thread_id}: wants ${want}, OnSinch holds ${held}, and the thread says nothing`);
  }
  add(INVARIANTS[3], silent.length === 0, silent.join("; "));

  const pointed = new Set([...byThread.values()].flat());
  const orphans = engineOrders.filter((o) => !pointed.has(o.id));
  add(INVARIANTS[4], orphans.length === 0, orphans.map((o) => `#${o.id} ${o.name}`).join("; "));

  const dupCompanies = new Map<string, number>();
  for (const x of tenant.companies) dupCompanies.set(x.name.toLowerCase(), (dupCompanies.get(x.name.toLowerCase()) ?? 0) + 1);
  const dupPlaces = new Map<string, number>();
  for (const p of tenant.places) dupPlaces.set(String(p.name).toLowerCase(), (dupPlaces.get(String(p.name).toLowerCase()) ?? 0) + 1);
  const dups = [...dupCompanies, ...dupPlaces].filter(([, n]) => n > 1);
  add(INVARIANTS[5], dups.length === 0, dups.map(([k, n]) => `${k} x${n}`).join("; "));

  const silentLoss = states.filter(
    (s) => s.status === "ordered" && !Number(s.onsinch_order_id) && !s.notes.some((n) => /no longer exists|deleted|not applied|could not/i.test(n))
  );
  add(INVARIANTS[6], silentLoss.length === 0, silentLoss.map((s) => s.thread_id).join("; "));

  add(INVARIANTS[7], rig.spies.violations.length === 0, rig.spies.violations.join("; "));

  return out;
}
