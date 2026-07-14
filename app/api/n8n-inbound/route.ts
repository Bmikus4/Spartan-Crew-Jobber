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
import type { HydratedThread, ThreadMessage } from "../../lib/engine/types";
import { isFromSpartan } from "../../lib/engine/normalize";
import { buildDeps } from "../../lib/deps";

function unauthorized(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function coerceThread(body: unknown): HydratedThread | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const thread_id = String(b.thread_id ?? b.threadId ?? "").trim();
  const rawMsgs = Array.isArray(b.messages) ? b.messages : [];
  if (!thread_id || rawMsgs.length === 0) return null;
  const messages: ThreadMessage[] = rawMsgs.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const from = String(r.from ?? "");
    return {
      message_id: String(r.message_id ?? r.id ?? ""),
      from,
      to: Array.isArray(r.to) ? r.to.map(String) : r.to ? [String(r.to)] : [],
      date_iso: String(r.date_iso ?? r.date ?? new Date().toISOString()),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? r.text ?? ""),
      is_from_spartan: typeof r.is_from_spartan === "boolean" ? r.is_from_spartan : isFromSpartan(from),
    };
  });
  return { thread_id, messages };
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-webhook-secret") !== secret) return unauthorized();

  let payload: unknown;
  try { payload = await request.json(); } catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  const thread = coerceThread(payload);
  if (!thread) return Response.json({ ok: false, error: "expected { thread_id, messages[] }" }, { status: 400 });

  try {
    const deps = await buildDeps();
    const state = await handleThread(thread, deps);
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
