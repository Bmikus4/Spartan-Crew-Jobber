export const runtime = "nodejs";
export const maxDuration = 60;

// Inbound trigger from n8n. The n8n workflow watches the Spartan mailbox and,
// for each new/updated thread, POSTs the FULL hydrated thread here:
//   { thread_id, messages: [{ message_id, from, to[], date_iso, subject, body }] }
// We run the compile+execute pipeline (draft-only by default) and return the
// resulting state. If no Gmail draft webhook is configured, the composed reply
// is included so n8n can create the draft. n8n builds the trigger; the
// automation itself runs here on Vercel.

import { handleThread } from "../../lib/engine/pipeline";
import { coerceThread } from "../../lib/engine/intake";
import { buildDeps } from "../../lib/deps";
import { captureInboundRaw } from "../../lib/inboundRawDb";
import { upsertTicketFromState } from "../../lib/ticketsDb";

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-webhook-secret") !== secret) return unauthorized();

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
      note: "payload stored in inbound_raw for contract alignment (not the { thread_id, messages[] } shape)",
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
      // returned so n8n can create the Gmail draft when no draft webhook is set
      reply: { subject: state.reply_subject ?? null, html: state.reply_body_html ?? null, draft_id: state.reply_draft_id ?? null },
      pending_order: state.pending_order ?? null,
      notes: state.notes,
    });
  } catch (err) {
    console.error("[n8n-inbound] pipeline failed", err);
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
