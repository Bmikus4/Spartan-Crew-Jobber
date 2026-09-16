// ============================================================================
// Five inbound-mail providers, one contract: RAW MIME.
// ----------------------------------------------------------------------------
// Every provider that forwards mail to a webhook can be configured to send the
// original RFC 822 message, and every one of them also offers a pre-parsed JSON of
// its own design. Taking the raw mail means one parser (mail/rfc822.ts) with one
// set of tests, and switching provider costs an entry in the table below rather
// than a new dialect to be wrong about. Taking the JSON would mean five.
//
// It is also the only choice that keeps threading possible: `Message-ID`,
// `In-Reply-To` and `References` are what rebuild the conversation, and several of
// these providers' parsed payloads simply do not carry them.
//
// Configuration, per provider, so this is recoverable six months from now:
//   SendGrid Inbound Parse   tick "POST the raw, full MIME message"
//   Mailgun routes           store(notify) with raw MIME, arrives as `body-mime`
//   Postmark inbound         tick "Include raw email content" -> `RawEmail`
//   CloudMailin              message format "raw"
//   Google Workspace routing no webhook of its own; it feeds one of the above
// ============================================================================

export interface InboundDelivery {
  raw: string;
  provider: string;
  /** Envelope recipients as the transport saw them — survives BCC and aliasing. */
  envelope_to: string[];
  /** Envelope sender, when the provider states it separately from the From header. */
  envelope_from: string;
}

const addr = (v: unknown): string => {
  const s = String(v ?? "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).replace(/^"|"$/g, "").trim().toLowerCase();
};
const addrs = (v: unknown): string[] => {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(addr).filter((a) => a.includes("@"));
  return String(v).split(",").map(addr).filter((a) => a.includes("@"));
};

/** SendGrid sends the SMTP envelope as a JSON string in a form field. */
function envelopeField(v: unknown): { to: string[]; from: string } {
  try {
    const j = JSON.parse(String(v ?? "")) as { to?: unknown; from?: unknown };
    return { to: addrs(j.to), from: addr(j.from) };
  } catch {
    return { to: [], from: "" };
  }
}

/**
 * Pull the raw message out of whatever shape arrived.
 *
 * Returns null rather than guessing when no raw mail is present. A provider
 * configured for parsed JSON instead of raw would otherwise be silently accepted
 * and produce threads with no headers, which is a merge risk — better a loud
 * refusal at the door on the day the setting is wrong.
 *
 * Never throws: a malformed body is a null, not a 500 that makes the provider
 * retry mail forever.
 */
export async function extractRawMail(request: Request): Promise<InboundDelivery | null> {
  const ctype = (request.headers.get("content-type") || "").toLowerCase();

  try {
    // ---- raw MIME as the whole body (CloudMailin "raw", curl, our own replays)
    if (ctype.includes("message/rfc822") || ctype.startsWith("text/plain") || !ctype) {
      const raw = await request.text();
      if (!raw.trim()) return null;
      return { raw, provider: ctype.includes("rfc822") ? "rfc822" : "raw", envelope_to: [], envelope_from: "" };
    }

    // ---- multipart form (SendGrid Inbound Parse, Mailgun routes)
    if (ctype.includes("multipart/form-data") || ctype.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const get = (k: string) => {
        const v = form.get(k);
        return typeof v === "string" ? v : null;
      };
      // Mailgun first: it also sets `to`, and checking `email` first would pick
      // SendGrid's field name off a Mailgun post that happens to have one.
      const raw = get("body-mime") || get("email") || get("message") || get("raw");
      if (!raw || !raw.trim()) return null;
      const provider = get("body-mime") ? "mailgun" : "sendgrid";
      const env = envelopeField(get("envelope"));
      return {
        raw,
        provider,
        envelope_to: env.to.length ? env.to : addrs(get("recipient") || get("to")),
        envelope_from: env.from || addr(get("sender") || get("from")),
      };
    }

    // ---- JSON (Postmark, CloudMailin json, anything of ours)
    if (ctype.includes("application/json")) {
      const j = (await request.json()) as Record<string, unknown>;
      const raw = String(j.RawEmail ?? j.raw ?? j.rawEmail ?? j.mime ?? j.message ?? "");
      if (!raw.trim()) return null;
      const envelope = (j.envelope ?? {}) as Record<string, unknown>;
      return {
        raw,
        provider: j.RawEmail ? "postmark" : "json",
        envelope_to: addrs(j.OriginalRecipient ?? envelope.to ?? j.to ?? j.recipient),
        envelope_from: addr(j.From ?? envelope.from ?? j.from ?? ""),
      };
    }

    return null;
  } catch {
    return null;
  }
}
