// The /api/dedupe POST handler after its auth gate, IO injected for tests (SP-50). The
// claim-once rule itself lives in messageLedgerDb (one conditional insert).

import { claimMessage } from "../messageLedgerDb";

export interface DedupeIO { claim: typeof claimMessage }

export const productionDedupeIO: DedupeIO = { claim: claimMessage };

export async function handleDedupe(request: Request, io: DedupeIO = productionDedupeIO): Promise<Response> {
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

  const result = await io.claim({
    message_id,
    thread_id,
    subject: body.subject ? String(body.subject) : null,
    from_address: String(body.from_address ?? body.fromAddress ?? body.from ?? oe.from ?? "") || null,
    note: body.note ? String(body.note) : null,
  });
  return Response.json(result);
}
