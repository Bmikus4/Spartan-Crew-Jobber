export const runtime = "nodejs";
export const maxDuration = 60;

// Inbound trigger from n8n. The n8n workflow watches the Spartan mailbox and,
// for each new/updated thread, POSTs the FULL hydrated thread here:
//   { thread_id, messages: [{ message_id, from, to[], date_iso, subject, body }] }
// We run the compile+execute pipeline (draft-only by default) and return the
// resulting state. If no Gmail draft webhook is configured, the composed reply
// is included so n8n can create the draft. n8n builds the trigger; the
// automation itself runs here on Vercel.

import { authorizeMachineCall } from "../../lib/apiAuth";
import { handleThread } from "../../lib/engine/pipeline";
import { coerceThread } from "../../lib/engine/intake";
import { buildDeps } from "../../lib/deps";
import { captureInboundRaw } from "../../lib/inboundRawDb";
import { replyDeliveryForWire } from "../../lib/settingsDb";
import { upsertTicketFromState } from "../../lib/ticketsDb";
import { reportError } from "../../lib/errorReport";

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  // `if (secret && header !== secret)` meant an absent secret was an absent gate, and
  // this route is in the middleware SKIP list so nothing else stands in front of it. A
  // preview deployment has no secret and the production database, which made every
  // preview URL an unauthenticated way to inject an enquiry. The shared rule refuses an
  // unconfigured caller in a production build and keeps the local-dev allowance the
  // offline harnesses rely on.
  if (!authorizeMachineCall(request).ok) return unauthorized();

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // Durable capture FIRST — no inbound is ever lost, and re-posts dedupe.
  const cap = await captureInboundRaw(payload, "n8n");

  const thread = coerceThread(payload);
  if (!thread) {
    // Accept + keep any non-contract payload (e.g. the live workflow's current
    // shape) so we can align without dropping it. Return 200, not 400.
    return Response.json({
      ok: true,
      captured: cap.captured,
      stored: true,
      note: "payload kept verbatim in inbound_raw for contract alignment (not the { thread_id, messages[] } shape)",
      dedup_key: cap.dedup_key,
    });
  }

  try {
    const deps = await buildDeps();
    const state = await handleThread(thread, deps);
    await upsertTicketFromState(state); // project onto the Jobs Board tickets table
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
    void reportError({
      route: "engine-threw",
      where: "api/n8n-inbound",
      what: String((err as Error)?.message ?? err),
      detail: `thread ${thread.thread_id}
${String((err as Error)?.stack ?? "").slice(0, 1200)}`,
    });
    console.error("[n8n-inbound] pipeline failed", err);
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
