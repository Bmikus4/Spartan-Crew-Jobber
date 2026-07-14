// Offline mocks so the compiler runs with zero network. The reasoner mock is
// intentionally simple: it reads the latest body for a "N crew" count, a date,
// and a venue, so a follow-up email that changes the count produces a
// different DesiredOrder (exercising the patch path).
import type { Reasoner, ClassifyResult, ReplyResult } from "../src/reason.js";
import type { ConversationFacts, ThreadMessage } from "../src/types.js";
import type { Transport } from "../src/onsinch.js";

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
      location_text: "2 Savoy Place London WC2R 0BL United Kingdom",
      requests: [
        { date: "2026-03-09", start_time: "08:00", end_time: "18:00", size, task: "Exhibition stand build" },
      ],
    };
  },
  async composeReply(_latest, _history, classification): Promise<ReplyResult> {
    return {
      subject: "Re: Crew request",
      html: `<div><p>Hello,</p><p>Got it — all noted for the 9th (${classification}).</p><p>Thanks,<br>Spartan Crew</p></div>`,
      priority: "high",
    };
  },
};

// Mock OnSinch transport: resolves the fixture company/place/user, and returns
// 201 for order creation, 204 for patch.
export const mockTransport: Transport = async (method, path) => {
  if (path.startsWith("/companies"))
    return { status: 200, data: { data: [{ id: 42, name: "RedBeast Energy" }] } };
  if (path.startsWith("/places"))
    return {
      status: 200,
      data: {
        data: [
          { id: 88, name: "Savoy Place", address: "2 savoy place", city: "london", zip: "wc2r 0bl", country: "GB", lat: 51.5, lng: -0.12 },
        ],
      },
    };
  if (path.startsWith("/users"))
    return { status: 200, data: { data: [{ id: 1337, email: "pier@redbeast.co.uk" }] } };
  if (method === "POST" && path === "/orders")
    return { status: 201, data: { data: [{ id: 9001, number: "SC-9001" }] } };
  if (method === "PATCH" && path === "/orders") return { status: 204, data: null };
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
