export const runtime = "nodejs";

// The dedupe endpoint the n8n bookings workflow calls in place of its four
// Airtable nodes. One POST per polled message:
//
//   POST /api/dedupe  { message_id, thread_id?, subject?, from_address? }
//   ->    { found, first_seen, thread_first_seen, thread_message_count, ... }
//
// `first_seen: true` means this execution is the one that should process the
// message — every duplicate poll gets false. `thread_first_seen` distinguishes a
// new job from an update on an existing thread.
//
// Authenticated with the same N8N_WEBHOOK_SECRET as /api/n8n-inbound (env only —
// no credential is created or stored here). When the secret is unset the route is
// open, matching the existing intake behaviour so nothing breaks before the real
// value lands.
//
// GET is a health probe: reports whether the DB and the secret are configured,
// without revealing either.

import { claimMessage, peekMessage } from "../../lib/messageLedgerDb";
import { safeEqual } from "../../lib/safeEqual";

function authorized(request: Request): boolean {
  const secret = (process.env.N8N_WEBHOOK_SECRET || "").trim();
  if (!secret) return true; // not yet configured — stay open, same as intake
  return safeEqual(request.headers.get("x-webhook-secret") || "", secret);
}

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; }
  catch { return Response.json({ ok: false, error: "bad json" }, { status: 400 }); }

  // Accept the several id spellings the workflow has floating around (Gmail
  // `id`/`threadId`, the normalized `email_id`/`thread_id`, Outlook leftovers).
  const oe = (body.original_email ?? {}) as Record<string, unknown>;
  const message_id = String(body.message_id ?? body.messageId ?? body.id ?? oe.email_id ?? oe.message_id ?? "").trim();
  const thread_id = String(body.thread_id ?? body.threadId ?? body.conversationId ?? oe.thread_id ?? "").trim() || null;

  if (!message_id) {
    // Fail OPEN: never let a missing id silently drop an enquiry.
    return Response.json({
      ok: false, found: false, first_seen: true, thread_first_seen: true,
      error: "missing message_id", degraded: "missing message_id",
    });
  }

  const result = await claimMessage({
    message_id,
    thread_id,
    subject: body.subject ? String(body.subject) : null,
    from_address: String(body.from_address ?? body.fromAddress ?? body.from ?? oe.from ?? "") || null,
    note: body.note ? String(body.note) : null,
  });
  return Response.json(result);
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("message_id");
  if (id) return Response.json({ ok: true, ...(await peekMessage(id)) });
  return Response.json({
    ok: true,
    db_configured: Boolean((process.env.DATABASE_URL || process.env.POSTGRES_URL || "").trim()),
    secret_configured: Boolean((process.env.N8N_WEBHOOK_SECRET || "").trim()),
  });
}
