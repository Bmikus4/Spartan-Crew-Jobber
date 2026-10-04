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

import { peekMessage } from "../../lib/messageLedgerDb";
import { handleDedupe } from "../../lib/routes/dedupe";
import { authorizeMachineCall } from "../../lib/apiAuth";

// An unconfigured secret used to mean "allowed". On a preview deployment the secret is
// absent and the database variables are not, so that branch was an open write path into
// production data. The shared rule allows an unconfigured caller outside production only.
const authorized = (request: Request): boolean => authorizeMachineCall(request).ok;

export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return handleDedupe(request);
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
