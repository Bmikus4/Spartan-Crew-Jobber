// The /api/n8n-inbound handler after its auth gate, with its IO injected so a test can drive the real code
// (SP-12, SP-50). It lives here and not in route.ts because Next.js refuses any export
// from a route file other than the HTTP methods and route config.
//
// n8n watches the Spartan mailbox and, for each new or updated thread, POSTs the FULL
// hydrated thread: { thread_id, messages: [{ message_id, from, to[], date_iso, subject, body }] }.
// We run the compile+execute pipeline (draft-only by default) and return the resulting
// state. If no Gmail draft webhook is configured, the composed reply is included so n8n
// can create the draft.

import { handleThread, flagManualIfNeeded } from "./engine/pipeline";
import { markThrew } from "./engine/retryHeld";
import { NeonStateStore } from "./stateDb";
import type { HydratedThread } from "./engine/types";
import { activeIntake, mayRunEngine } from "./intakePath";
import { coerceThread } from "./engine/intake";
import { buildDeps } from "./deps";
import { captureInboundRaw } from "./inboundRawDb";
import { replyDeliveryForWire } from "./settingsDb";
import { upsertTicketFromState } from "./ticketsDb";
import { reportError } from "./errorReport";
import { v2Engine } from "./paused";
import type { decideOnce } from "./v2/process";

export interface InboundIO {
  capture: typeof captureInboundRaw;
  report: typeof reportError;
  /** The rebuild's decision on one captured message (SPARTAN_ENGINE=v2). */
  decide: typeof decideOnce;
  buildDeps: typeof buildDeps;
  handleThread: typeof handleThread;
  upsertTicket: typeof upsertTicketFromState;
  /** Hold a thread the engine threw on, so the hourly sweep reads it again (SP-15). */
  onThrew: (thread: HydratedThread, err: unknown) => Promise<void>;
}

export const productionInboundIO: InboundIO = {
  capture: captureInboundRaw,
  report: reportError,
  // Loaded on use: the rebuild pulls in the browser bot, which the old path never needs.
  decide: async (id) => (await import("./v2/process")).decideOnce(id),
  buildDeps,
  handleThread,
  upsertTicket: upsertTicketFromState,
  async onThrew(thread, err) {
    // The state store directly, not through buildDeps: buildDeps is what throws when the
    // settings read fails (SP-17), and the hold must not depend on the thing that broke.
    const latest = thread.messages[thread.messages.length - 1];
    const held = await markThrew(new NeonStateStore(), { thread_id: thread.thread_id, subject: latest?.subject }, err);
    await upsertTicketFromState(held);
    // The label is best-effort here; the sweep's next pass labels a held thread anyway.
    try { await flagManualIfNeeded(held, await buildDeps()); } catch (e) { console.error("[n8n-inbound] held but not labelled", e); }
  },
};

export async function handleInbound(request: Request, io: InboundIO = productionInboundIO): Promise<Response> {
  // Authorised by the route before this is called (route.ts keeps the gate; see there).
  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // Durable capture FIRST — no inbound is ever lost, and re-posts dedupe.
  const cap = await io.capture(payload, "n8n");

  /**
   * UNDER THE REBUILD THE OLD ENGINE NEVER RUNS HERE. The rebuild decides on the one
   * message n8n polled (n8n.latest_message_id; the thread's newest as a fallback), never on
   * the thread's history: an old message re-read as new is how a stale request gets
   * written. Shadow only: a decision is recorded in v2_decisions and nothing is written.
   */
  if (v2Engine()) {
    const p = (payload ?? {}) as { n8n?: { latest_message_id?: unknown } };
    const message_id = String(p.n8n?.latest_message_id ?? "") || coerceThread(payload)?.messages.slice(-1)[0]?.message_id || "";
    if (!message_id) {
      void io.report({ route: "mail-undeliverable", where: "api/n8n-inbound (v2)", what: "a delivery named no message, so the rebuild did not decide on it", detail: `kept in inbound_raw as ${cap.dedup_key}` });
      return Response.json({ ok: true, captured: cap.captured, engine: "v2", decided: false, dedup_key: cap.dedup_key });
    }
    try {
      const r = await io.decide(message_id);
      if (r.skipped === "message not captured") void io.report({ route: "mail-undeliverable", where: "api/n8n-inbound (v2)", what: "the message was not in thread_messages, so the rebuild did not decide on it", detail: `${message_id}; inbound_raw ${cap.dedup_key}` });
      return Response.json({ ok: true, captured: cap.captured, engine: "v2", message_id, decision: r.decision?.kind ?? null, skipped: r.skipped ?? null });
    } catch (err) {
      void io.report({ route: "engine-threw", where: "api/n8n-inbound (v2)", what: String((err as Error)?.message ?? err), detail: `message ${message_id}; replay with POST /api/bot/process` });
      return Response.json({ ok: false, engine: "v2", message_id, error: String((err as Error)?.message ?? err).slice(0, 300) }, { status: 500 });
    }
  }

  /**
   * AFTER THE CUTOVER THIS ROUTE IS INERT, and does not depend on n8n being switched off.
   *
   * The Workspace routing rule and the n8n trigger live in different systems, so there is
   * no single click that moves both. If this route kept working, the window between the
   * two clicks would put the same enquiry down both paths — two thread ids, two
   * conversations, two orders for one job, at 16 orders a day. Closing it here rather
   * than in a runbook means the order of the clicks stops mattering.
   *
   * The payload is captured above before this returns, so nothing is lost and the intake
   * watchdog still sees mail arriving. 200 rather than an error code: n8n retries a 4xx
   * for hours and alarms on it, and there is nothing wrong — this route is simply no
   * longer the one that acts.
   */
  if (!mayRunEngine("n8n")) {
    return Response.json({
      ok: true,
      captured: cap.captured,
      stored: true,
      engine: "skipped",
      note: `INTAKE_PATH is ${activeIntake()} — /api/mail-inbound owns the engine now. Kept for the record; turn this workflow off in n8n when convenient.`,
      dedup_key: cap.dedup_key,
    });
  }

  const thread = coerceThread(payload);
  if (!thread) {
    /**
     * A PAYLOAD THE ENGINE CANNOT READ IS MAIL NOBODY WILL ACT ON (SP-12). n8n sends each
     * message once, so a workflow edit that changes the shape stops intake with every
     * delivery answered 200 and nothing processed. Reported (one email per 6 hours, the
     * reporter's window), still 200 because n8n retries a 4xx for hours, and the payload is
     * kept verbatim in inbound_raw so it can be replayed once the shapes agree again.
     */
    const keys = payload && typeof payload === "object" ? Object.keys(payload as object).slice(0, 20).join(", ") : typeof payload;
    void io.report({
      route: "mail-undeliverable",
      where: "api/n8n-inbound (payload shape)",
      what: "an n8n delivery did not have the { thread_id, messages[] } shape, so the engine did not run on it",
      detail: `top-level keys: ${keys || "(none)"}; kept in inbound_raw as ${cap.dedup_key}`,
    });
    return Response.json({
      ok: true,
      captured: cap.captured,
      stored: true,
      note: "payload kept verbatim in inbound_raw for contract alignment (not the { thread_id, messages[] } shape)",
      dedup_key: cap.dedup_key,
    });
  }

  try {
    const deps = await io.buildDeps();
    const state = await io.handleThread(thread, deps);
    await io.upsertTicket(state); // project onto the Jobs Board tickets table
    return Response.json({
      ok: true,
      thread_id: state.thread_id,
      classification: state.classification,
      priority: state.priority,
      status: state.status,
      needs_human: state.needs_human,
      onsinch_order_id: state.onsinch_order_id ?? null,
      // Returned so n8n can create the Gmail draft when no draft webhook is set.
      // `delivery` tells its reply subflow which Gmail call to make:
      //   "draft" -> POST /users/me/drafts   (the default, human sends it)
      //   "send"  -> POST /users/me/messages/send
      // The decision lives here, not in n8n, so the Settings screen is the single
      // place it is controlled.
      reply: {
        subject: state.reply_subject ?? null,
        html: state.reply_body_html ?? null,
        draft_id: state.reply_draft_id ?? null,
        ...replyDeliveryForWire(deps.settings),
      },
      pending_order: state.pending_order ?? null,
      notes: state.notes,
    });
  } catch (err) {
    // ROUTE 3, "the engine threw". Anything escaping handleThread lands here, and until now
    // it went to Vercel's logs and nowhere else. This is the outermost catch on the only path
    // the engine runs on, so it is the last chance to tell anyone.
    void io.report({
      route: "engine-threw",
      where: "api/n8n-inbound",
      what: String((err as Error)?.message ?? err),
      detail: `thread ${thread.thread_id}
${String((err as Error)?.stack ?? "").slice(0, 1200)}`,
    });
    console.error("[n8n-inbound] pipeline failed", err);
    // Held for the sweep: n8n will not send this message again. A failure to hold is
    // logged and the 500 still goes back; the report above already reached a person.
    await io.onThrew(thread, err).catch((e) => console.error("[n8n-inbound] could not hold the thread", e));
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
