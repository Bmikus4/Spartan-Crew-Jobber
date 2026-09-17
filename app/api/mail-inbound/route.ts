export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Intake with no credential on the hot path.
// ----------------------------------------------------------------------------
// /api/n8n-inbound depends on a Gmail OAuth refresh token, and a refresh token
// carrying Gmail scopes is revoked when the mailbox password changes — documented
// by Google, with no exemption for Internal apps, Workspace domains or admin-
// trusted clients. That is not a bug to fix; it is the design. It cost Spartan
// five days of intake across 2026-08-26/27 and 09-09..11, ~69 enquiry threads that
// were then audited by hand. Recall on every other day was 99.5%.
//
// This route is the alternative: a Workspace routing rule copies inbound mail to an
// address that a provider turns into an HTTP POST. Mail PUSHES to us. Nothing here
// holds a token, so nothing here can have one revoked, and rotating the mailbox
// password is once again ordinary hygiene. See docs/CREDENTIAL-DURABILITY-PLAN.md.
//
// WHAT IS LOST, AND WHY IT IS SURVIVABLE. A routing rule delivers messages, so
// Gmail's `threadId` never arrives and the conversation has to be rebuilt from
// `Message-ID`, `In-Reply-To` and `References`. Measured against Gmail's own
// grouping over 298 messages (scripts/score-header-threading.mjs): 1 of 40 threads
// split, 0 merged. Zero merges is the number that mattered — see mail/threading.ts.
//
// The two routes coexist but MUST NOT BOTH RUN ON THE SAME MAILBOX. They key a
// message differently — Gmail's id there, the RFC Message-ID here — so the same
// mail arriving down both paths is two rows in thread_messages, two thread ids and
// two conversations for one enquiry. Cutting over means turning the n8n trigger off
// in the same change that turns the routing rule on.
// ============================================================================

import { authorizeMailWebhook } from "../../lib/apiAuth";
import { parseRfc822 } from "../../lib/mail/rfc822";
import { resolveThreadId } from "../../lib/mail/threading";
import { extractRawMail } from "../../lib/mail/providers";
import { storeMessage, threadIdForMessageIds, rebuildThread } from "../../lib/threadMessagesDb";
import { captureInboundRaw } from "../../lib/inboundRawDb";
import { handleThread } from "../../lib/engine/pipeline";
import { activeIntake, mayRunEngine } from "../../lib/intakePath";
import { coerceThread } from "../../lib/engine/intake";
import { buildDeps } from "../../lib/deps";
import { replyDeliveryForWire } from "../../lib/settingsDb";
import { upsertTicketFromState } from "../../lib/ticketsDb";
import { reportError } from "../../lib/errorReport";

const SPARTAN = /@spartancrew\.co\.uk$/i;

export async function POST(request: Request): Promise<Response> {
  if (!authorizeMailWebhook(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const delivery = await extractRawMail(request.clone());
  if (!delivery) {
    // The provider is configured for its own parsed JSON instead of raw MIME. Keep the
    // body so the setting can be corrected without the mail being gone, and answer 200
    // — a 4xx makes the provider retry for hours and, with several, bounce to the sender.
    let body: unknown = null;
    try { body = await request.text(); } catch { /* nothing readable is still a delivery */ }
    const cap = await captureInboundRaw({ unparsed_inbound: body }, "mail-webhook");
    void reportError({
      route: "mail-undeliverable",
      where: "api/mail-inbound",
      what: "delivery carried no raw MIME",
      detail: `content-type ${request.headers.get("content-type") || "(none)"} — the provider is sending parsed JSON, not raw. Kept in inbound_raw as ${cap.dedup_key}.`,
    });
    return Response.json({ ok: true, stored: true, engine: "skipped",
      note: "no raw MIME in this delivery; kept verbatim in inbound_raw", dedup_key: cap.dedup_key });
  }

  const mail = parseRfc822(delivery.raw);
  const hit = await resolveThreadId(mail, (ids) => threadIdForMessageIds(ids));

  const from = mail.from;
  const isFromSpartan = SPARTAN.test(from);
  // Storing before anything else can fail is the no-data-loss guarantee. Keyed on the
  // RFC Message-ID, so a retry inserts nothing.
  const stored = await storeMessage({
    message_id: mail.message_id || `mail:${hit.thread_id}:${mail.date_iso || Date.now()}`,
    thread_id: hit.thread_id,
    from_address: from,
    to_addresses: [...new Set([...mail.to, ...mail.cc, ...delivery.envelope_to])],
    date_iso: mail.date_iso,
    subject: mail.subject,
    body: mail.body || null,
    is_from_spartan: isFromSpartan,
  });
  await captureInboundRaw({
    thread_id: hit.thread_id,
    message_id: mail.message_id,
    provider: delivery.provider,
    envelope_to: delivery.envelope_to,
    envelope_from: delivery.envelope_from,
    joined_via: hit.via,
    attachments: mail.attachments,
  }, `mail:${delivery.provider}`);

  const base = {
    ok: true as const,
    thread_id: hit.thread_id,
    message_id: mail.message_id,
    provider: delivery.provider,
    joined: hit.joined,
    joined_via: hit.via,
    stored: stored.inserted,
  };

  // A message we already had changes nothing, and re-running the engine on it would
  // recompose a reply for mail the client sent hours ago.
  if (!stored.inserted) return Response.json({ ...base, engine: "skipped", reason: "already held" });

  // OUTBOUND IS STORED, NOT PROCESSED. Routing Spartan's own replies to us is what
  // keeps threading at the whole-thread split rate rather than the inbound-only one —
  // a client replying to a message we never received is an orphan, which is where
  // every measured inbound-only split came from. But the engine decides what changed
  // by reading the NEWEST message, and the newest message being our own reply would
  // have it answer itself.
  if (isFromSpartan) return Response.json({ ...base, engine: "skipped", reason: "outbound, stored for threading" });

  /**
   * SHADOW MODE — the routing rule may be live long before the engine moves here.
   *
   * The message is already stored above, so the thread is being rebuilt, the history is
   * accumulating and the intake watchdog is being fed; only the engine is withheld. That
   * is what lets the Workspace rule be switched on early and watched against the live
   * n8n path for as long as it takes to believe it, with no possibility of one enquiry
   * becoming two orders in the meantime. See app/lib/intakePath.ts.
   */
  if (!mayRunEngine("routing")) {
    return Response.json({ ...base, engine: "skipped", reason: `shadow mode — INTAKE_PATH is ${activeIntake()}, so n8n-inbound still owns the engine` });
  }

  const thread = await rebuildThread(hit.thread_id);
  if (!thread) {
    return Response.json({ ...base, engine: "skipped", reason: "thread could not be rebuilt (no database?)" });
  }
  const coerced = coerceThread(thread);
  if (!coerced) return Response.json({ ...base, engine: "skipped", reason: "thread did not coerce" });

  try {
    const deps = await buildDeps();
    const state = await handleThread(coerced, deps);
    await upsertTicketFromState(state);
    return Response.json({
      ...base,
      classification: state.classification,
      priority: state.priority,
      status: state.status,
      needs_human: state.needs_human,
      onsinch_order_id: state.onsinch_order_id ?? null,
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
    void reportError({
      route: "engine-threw",
      where: "api/mail-inbound",
      what: String((err as Error)?.message ?? err),
      detail: `thread ${hit.thread_id}
${String((err as Error)?.stack ?? "").slice(0, 1200)}`,
    });
    console.error("[mail-inbound] pipeline failed", err);
    // 200, not 500. The mail is already stored, so a retry would deliver a message we
    // hold and be skipped anyway — and several providers bounce to the sender after
    // enough 5xx, which would tell a client their enquiry failed.
    return Response.json({ ...base, engine: "failed", error: String((err as Error)?.message ?? err) });
  }
}

/** A liveness probe, so the routing rule can be proved reachable before mail depends on it. */
export function GET(request: Request): Response {
  if (!authorizeMailWebhook(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return Response.json({ ok: true, route: "mail-inbound", accepts: "raw RFC 822" });
}
