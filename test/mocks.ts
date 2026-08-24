// Offline mocks so the compiler runs with zero network. The reasoner mock is
// intentionally simple: it reads the latest body for a "N crew" count, a date,
// and a venue, so a follow-up email that changes the count produces a
// different DesiredOrder (exercising the patch path).
import type { Reasoner, ClassifyResult, ReplyResult, ReplyContext } from "../app/lib/engine/reason";
import type { ConversationFacts, ThreadMessage } from "../app/lib/engine/types";
import type { Transport } from "../app/lib/engine/onsinch";

export const mockReasoner: Reasoner = {
  async classify(latest, _history, priorOrderExists): Promise<ClassifyResult> {
    const b = latest.body.toLowerCase();
    if (b.includes("thanks") && !/\d+\s*crew/.test(b) && priorOrderExists)
      return { classification: "confirmation-only", priority: "low", job_summary: "ack" };
    if (priorOrderExists && /(change|instead|make it|update)/.test(b))
      return { classification: "update", priority: "medium", job_summary: "change crew count" };
    if (/\d+\s*crew|need a crew|booking/.test(b))
      return { classification: "new-job", priority: "high", job_summary: "new crew request" };
    return { classification: "not-a-job", priority: "low", job_summary: "n/a" };
  },
  async extractFacts(latest, history): Promise<ConversationFacts> {
    const all = [latest, ...history].map((m) => m.body).join("\n");
    const size = Number((all.match(/(\d+)\s*crew/i) || [])[1] || 0) || undefined;
    return {
      company_name: "RedBeast Energy",
      contact_name: "Piergiorgio Mammone",
      contact_email: latest.from,
      customer_reference: "PO-44821",
      location_text: "2 Savoy Place London WC2R 0BL United Kingdom",
      requests: [
        { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size, task: "Exhibition stand build" },
      ],
    };
  },
  /**
   * Records the ReplyContext it was handed, so a test can assert the compiler ran
   * the order path FIRST and told the writer what came of it. A mock that quietly
   * ignored the argument would let the whole commitment fix regress unnoticed.
   */
  async composeReply(_latest, _history, classification, context): Promise<ReplyResult> {
    lastReplyContext = context ?? null;
    return {
      subject: "Re: Crew request",
      html: `<div><p>Hello,</p><p>Got it — all noted for the 9th (${classification}).</p><p>Thanks,<br>Spartan Crew</p></div>`,
      priority: "high",
    };
  },
};

/** The context passed to the most recent composeReply call, for assertions. */
export let lastReplyContext: ReplyContext | null = null;
export const resetReplyContext = () => { lastReplyContext = null; };

// Mock OnSinch transport: supports pull-all dedup (companies/places with
// pagination + a company Client list), order-dedup (empty), and create/patch.
export const mockTransport: Transport = async (method, path) => {
  if (method === "POST" && path === "/places")
    return { status: 201, data: { data: [{ id: 777 }] } };
  if (method === "POST" && path === "/companies")
    return { status: 201, data: { data: [{ id: 999 }] } };
  // POST /orders returns the id and NOTHING ELSE. This mock used to invent a
  // `number: "SC-9001"`, and test/jobNumber.ts asserted the engine stored it — so a
  // field that is always undefined against the real tenant looked covered. Probed
  // live 2026-08-19: the body is `{"id":13744}`, and a GET on that id returns
  // `number: "10638"`. A fixture more generous than the API it stands in for hides
  // exactly the bugs a fixture exists to catch.
  if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9001 }] } };
  if (method === "PATCH" && path === "/orders") return { status: 204, data: null };
  // The create is two-phase — an empty order, then one block per POST /slotTeams, which
  // is the only call that ever hands back a block's id (API reference §12). So the
  // freshly created order has to be readable for its job id, and it is read by id.
  if (method === "GET" && /[?&]id=9001\b/.test(path))
    return { status: 200, data: { data: [{ id: 9001, number: "10999", Job: [{ id: 7900 }] }], pagination: { count: 1, pageCount: 1, nextPage: false } } };
  if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 35900 }] } };
  if (path.startsWith("/companies"))
    return {
      status: 200,
      data: {
        data: [{ id: 42, name: "RedBeast Energy", invoice_name: "RedBeast Energy", Client: [{ id: 1337, email: "pier@redbeast.co.uk", name: "Pier" }] }],
        pagination: { count: 1, pageCount: 1, nextPage: false },
      },
    };
  if (path.startsWith("/places"))
    return {
      status: 200,
      data: {
        data: [{ id: 88, name: "Savoy Place", address: "2 savoy place", city: "london", zip: "wc2r 0bl", country: "GB", lat: 51.5, lng: -0.12 }],
        pagination: { count: 1, pageCount: 1, nextPage: false },
      },
    };
  if (path.startsWith("/orders")) // company history: one old order (rate card 197), different date so it doesn't dedup-match
    return { status: 200, data: { data: [{ id: 8000, happening: "2025-01-01T08:00:00+00:00", Job: [{ id: 7000, pricelist_category_id: 197 }] }], pagination: { count: 1, pageCount: 1, nextPage: false } } };
  return { status: 200, data: { data: [] } };
};

export function msg(over: Partial<ThreadMessage>): ThreadMessage {
  return {
    message_id: "m1",
    from: "pier@redbeast.co.uk",
    to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-02-12T10:00:00Z",
    subject: "Crew request",
    body: "",
    is_from_spartan: false,
    ...over,
  };
}
