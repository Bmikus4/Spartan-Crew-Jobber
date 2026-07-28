// ============================================================================
// intake — the seam between the n8n bookings workflow and the engine.
// ----------------------------------------------------------------------------
// Everything arriving at /api/n8n-inbound passes through here. It was inline in
// the route, which meant the one join in the system that can silently drop an
// enquiry -- a payload whose shape we do not recognise -- had no test around it.
// Pulled out so n8n/nodes/build-engine-payload.js can be proven to produce
// something this accepts, without n8n and without a credential.
//
// Tolerant by design: the workflow was copied from House of Hud and still speaks
// a mix of Gmail (`id`, `threadId`), normalized (`email_id`, `thread_id`) and
// Outlook (`conversationId`) spellings. We accept all of them rather than 400 a
// real enquiry over a field name.
// ============================================================================
import type { HydratedThread, ThreadMessage } from "./types";
import { isFromSpartan } from "./normalize";

/** Best-effort address extraction: "Jane <j@x.com>" | {address} -> "j@x.com" */
function addrOf(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return addrOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return addrOf(o.address ?? o.email ?? o.value ?? "");
  }
  const s = String(v);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}

function addrList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(addrOf).filter(Boolean);
  return String(v).split(",").map(addrOf).filter(Boolean);
}

/**
 * Coerce an arbitrary inbound payload into a HydratedThread, or null when there
 * is nothing usable. Returning null is not an error — the caller stores the
 * payload in inbound_raw and answers 200, so nothing is ever lost.
 */
export function coerceThread(body: unknown): HydratedThread | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const oe = (b.original_email ?? {}) as Record<string, unknown>;

  const thread_id = String(
    b.thread_id ?? b.threadId ?? oe.thread_id ?? oe.threadId ?? b.conversationId ?? ""
  ).trim();

  const rawMsgs = Array.isArray(b.messages) ? b.messages : [];
  let messages: ThreadMessage[] = rawMsgs.map((m) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const from = addrOf(r.from ?? r.fromAddress);
    return {
      message_id: String(r.message_id ?? r.messageId ?? r.id ?? ""),
      from,
      to: addrList(r.to ?? r.toRecipients),
      date_iso: String(r.date_iso ?? r.dateIso ?? r.date ?? r.sentDateTime ?? new Date().toISOString()),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? r.text ?? r.bodyContent ?? ""),
      is_from_spartan:
        typeof r.is_from_spartan === "boolean" ? r.is_from_spartan : isFromSpartan(from),
    };
  });

  // A single-email payload (the workflow's older shape) is still a thread of one.
  if (!messages.length && (oe.body || oe.email_id)) {
    const from = addrOf(oe.from);
    messages = [
      {
        message_id: String(oe.email_id ?? oe.message_id ?? ""),
        from,
        to: [],
        date_iso: String(oe.date_iso ?? b.sentDateTime ?? new Date().toISOString()),
        subject: String(oe.subject ?? b.subject ?? ""),
        body: String(oe.body ?? ""),
        is_from_spartan: isFromSpartan(from),
      },
    ];
  }

  messages = messages.filter((m) => m.body && m.body.trim());
  if (!thread_id || !messages.length) return null;
  return { thread_id, messages };
}
