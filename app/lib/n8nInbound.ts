// The /api/n8n-inbound handler after its auth gate, with its IO injected so a test can drive the real code
// (SP-12, SP-50). It lives here and not in route.ts because Next.js refuses any export
// from a route file other than the HTTP methods and route config.
//
// n8n watches the Spartan mailbox and, for each new or updated thread, POSTs the FULL
// hydrated thread: { thread_id, messages: [{ message_id, from, to[], date_iso, subject, body }] }.
// The thread is stored first, then the v2 engine decides on the messages this delivery stored for
// the first time (app/lib/v2/process.ts decideDelivery). The old engine's pipeline is gone (addendum
// Prompt 12): nothing here drafts a reply or writes a ticket.

import { captureInboundRaw } from "./inboundRawDb";
import { messagesFromPayload } from "./threadMessagesDb";
import { reportError } from "./errorReport";
import { automationPausedFlag } from "./paused";
import type { decideDelivery, storeOnly } from "./v2/process";

export interface InboundIO {
  capture: typeof captureInboundRaw;
  report: typeof reportError;
  /** The v2 engine's decisions on the messages a delivery added. */
  decide: typeof decideDelivery;
  /** Marks what a delivery added as never to be decided: mail that arrives while paused. */
  storeOnly: typeof storeOnly;
}

export const productionInboundIO: InboundIO = {
  capture: captureInboundRaw,
  report: reportError,
  // Loaded on use: the engine pulls in the browser bot, which a capture never needs.
  decide: async (ids) => (await import("./v2/process")).decideDelivery(ids),
  storeOnly: async (ids, reason) => (await import("./v2/process")).storeOnly(ids, reason),
};

export async function handleInbound(request: Request, io: InboundIO = productionInboundIO): Promise<Response> {
  // Authorised by the route before this is called (route.ts keeps the gate; see there).
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // Durable capture FIRST: no inbound is ever lost, and re-posts dedupe.
  const cap = await io.capture(payload, "n8n");
  if (!cap.ok) {
    void io.report({ route: "mail-undeliverable", where: "api/n8n-inbound", what: "capture failed, so the engine did not decide on this delivery", detail: `dedup ${cap.dedup_key}, thread ${cap.thread_id ?? "?"}` });
    return Response.json({ ok: false, engine: "v2", error: "capture failed" }, { status: 500 });
  }

  /**
   * A PAYLOAD WITH NO MESSAGE THE STORE CAN READ IS MAIL NOBODY WILL ACT ON (SP-12). n8n sends each
   * message once, so a workflow edit that changes the shape stops intake with every delivery answered
   * 200 and nothing decided. Reported (one email per 6 hours, the reporter's window), still 200 because
   * n8n retries a 4xx for hours, and kept verbatim in inbound_raw to replay once the shapes agree.
   */
  if (!messagesFromPayload(payload).length) {
    const keys = payload && typeof payload === "object" ? Object.keys(payload as object).slice(0, 20).join(", ") : typeof payload;
    void io.report({ route: "mail-undeliverable", where: "api/n8n-inbound (payload shape)", what: "an n8n delivery held no message in the { thread_id, messages[] } shape, so nothing was decided",
      detail: `top-level keys: ${keys || "(none)"}; kept in inbound_raw as ${cap.dedup_key}` });
    return Response.json({ ok: true, captured: cap.captured, engine: "v2", stored: true, note: "kept verbatim in inbound_raw: no message in the { thread_id, messages[] } shape", dedup_key: cap.dedup_key });
  }

  // Paused: stored and marked, decided by nothing, now or after the pause lifts (addendum F31).
  if (automationPausedFlag()) {
    try {
      await io.storeOnly(cap.new_message_ids, "arrived while the automation was paused");
    } catch (err) {
      void io.report({ route: "mail-undeliverable", where: "api/n8n-inbound (paused)", what: "stored while paused but not marked store-only, so the sweep may decide it after the pause", detail: `new messages ${cap.new_message_ids.join(", ")}: ${String((err as Error)?.message ?? err).slice(0, 160)}` });
      return Response.json({ ok: false, engine: "v2", paused: true, error: "store-only mark failed" }, { status: 500 });
    }
    return Response.json({ ok: true, captured: cap.captured, engine: "v2", paused: true, stored_only: cap.new_message_ids.length });
  }
  try {
    const r = await io.decide(cap.new_message_ids);
    return Response.json({ ok: true, captured: cap.captured, engine: "v2", decided: r.map((x) => ({ message_id: x.message_id, decision: x.decision?.kind ?? null, skipped: x.skipped ?? null })) });
  } catch (err) {
    void io.report({ route: "engine-threw", where: "api/n8n-inbound", what: String((err as Error)?.message ?? err), detail: `new messages ${cap.new_message_ids.join(", ")}; replay each with POST /api/bot/process` });
    return Response.json({ ok: false, engine: "v2", error: String((err as Error)?.message ?? err).slice(0, 300) }, { status: 500 });
  }
}
