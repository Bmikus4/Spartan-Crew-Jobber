// ============================================================================
// One row per message. The table inbound_raw should always have been.
// ----------------------------------------------------------------------------
// n8n POSTs the FULL hydrated thread on every new message, and captureInboundRaw
// stored that body verbatim. A thread of N messages therefore cost N deliveries
// each carrying up to N messages: on the live database, 6,644 message-copies for
// 1,354 actual messages, 4.9x, growing with the square of thread length. The
// worst single thread held 4.4 MB across 21 rows.
//
// Keyed on message_id with ON CONFLICT DO NOTHING, so a re-delivery is a no-op
// and the cost of a thread is the mail in it, once.
//
// The body is nullable ON PURPOSE. After the retention window
// scripts/archive-thread-bodies.mjs writes it to data/archive/ and nulls it here;
// the headers stay forever because they are small and are what the board and the
// ledgers actually read.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { idsIn } from "./mail/rfc822";
import { ensureSchema } from "./migrations";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}
function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}
async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await ensureSchema(sql);
  _ready = true;
}

/** Create the table without writing to it. For readers, and for tests that run before
 *  anything has stored a message. */
export async function ensureThreadMessages(): Promise<void> {
  const sql = db();
  if (!sql) return;
  try { await ensure(sql); } catch (err) { console.error("[thread_messages] ensure failed", err); }
}

export interface StoredMessage {
  message_id: string;
  thread_id: string;
  from_address: string;
  to_addresses: string[];
  date_iso: string;
  subject: string;
  body: string | null;
  is_from_spartan: boolean;
  /**
   * Gmail's labels, when the caller has them. Present so BOTH inserts can refuse a
   * draft — `storeMessage` takes a built row and never passes through
   * messagesFromPayload, so a guard living only there covered the sweep and missed
   * the poller, which is the path that actually watches the mailbox this engine
   * writes its drafts into. Optional: a caller with no labels (the Mailgun webhook
   * has none) makes no claim either way and its message is stored as before.
   */
  labelIds?: string[];
  /** The RFC Message-ID, normalised by parseRfc822. Null when the sender set none. */
  rfc_message_id?: string | null;
  /** In-Reply-To and References as parsed, nearest ancestor first. Absent when not known. */
  in_reply_to?: string[];
  reference_ids?: string[];
  /** Cc as sent; absent when the sender of the payload could not read the header. */
  cc_addresses?: string[];
  /** The files' names; absent when the message's parts could not be read. */
  attachment_names?: string[];
}

/**
 * The row for a message read from Gmail by its own API.
 *
 * Keyed exactly as the n8n intake keyed it — Gmail id, bare Gmail threadId — because
 * every row already stored is in that form (4,236/4,239 messages, 749/749 thread
 * states, 2026-09-29). A prefix "so the routes cannot collide" is what split each
 * existing conversation in two: the first reply after a restart found no state under
 * `gmail:<id>` and was read as a fresh enquiry.
 */
export function rowFromGmail(
  gmailId: string,
  gmailThreadId: string,
  mail: { message_id: string; from: string; to: string[]; cc: string[]; date_iso: string; subject: string; body: string; in_reply_to?: string[]; references?: string[] },
  labelIds: string[],
): StoredMessage {
  return {
    message_id: gmailId,
    thread_id: gmailThreadId || `mail:${mail.message_id || gmailId}`,
    from_address: mail.from,
    to_addresses: [...new Set([...mail.to, ...mail.cc])],
    date_iso: mail.date_iso,
    subject: mail.subject,
    body: mail.body || null,
    is_from_spartan: /@spartancrew\.co\.uk$/i.test(mail.from),
    labelIds,
    rfc_message_id: mail.message_id || null,
    in_reply_to: mail.in_reply_to ?? [],
    reference_ids: mail.references ?? [],
    cc_addresses: mail.cc,
  };
}

/** "Jane <j@x.com>" | {address} -> "j@x.com". Same rule as engine/intake.ts addrOf. */
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
 * Split an inbound payload into its messages. Pure and total: an unrecognised payload
 * yields an empty array rather than throwing, because the caller is on the no-data-loss
 * path and must not fail because a shape surprised it.
 *
 * Tolerant of the same three spellings engine/intake.ts accepts — the workflow was copied
 * from House of Hud and still mixes Gmail, normalized and Outlook names.
 */
/**
 * A DRAFT IS NOT A MESSAGE.
 *
 * Gmail keeps a draft on its thread and hands it back beside the real mail. Its From
 * is bookings@spartancrew.co.uk, so `is_from_spartan` comes out true — accurate, and
 * completely misleading: the client never saw it. Every reader downstream then
 * believes Spartan answered, and the direction of the thread inverts, turning a
 * client waiting on us into us waiting on the client. That fact cannot be rebuilt
 * later: once further mail lands, the tail of the thread no longer shows who was owed
 * a reply.
 *
 * DROPPED, NOT FLAGGED, and the reason is the ON CONFLICT clause below. A draft keeps
 * its message id when it is sent. Stored-and-flagged, the send hits
 * `ON CONFLICT DO NOTHING`, changes nothing, and the row stays marked a
 * draft for good — a real reply permanently invisible. Never stored, the send inserts
 * cleanly as a first sighting.
 *
 * MEMBERSHIP, NOT EQUALITY: a draft also wears INBOX and whatever else the thread
 * carries. And several spellings are accepted because the callers differ — the poller
 * sends Gmail's own `labelIds`, an n8n Code node may send `labels`, and a caller that
 * has already decided can send `is_draft` outright.
 *
 * WHAT THIS CANNOT DO: invent a signal nobody sent. The n8n sweep's payload builder
 * never reads `labelIds`, so its messages arrive with no label information and are
 * stored exactly as before. That path stays blind until the workflow is redeployed;
 * test/draftIsNotAMessage.ts [5] pins the hole so it is not mistaken for coverage.
 */
function isAnUnsentDraft(r: Record<string, unknown>): boolean {
  if (typeof r.is_draft === "boolean") return r.is_draft;
  const labels = r.labelIds ?? r.label_ids ?? r.labels;
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => String(l).trim().toUpperCase() === "DRAFT");
}

/**
 * The real author of mail that came through one of our Google Groups (info@ is one).
 * The group rewrites From to its own address, so a client's booking arrived "from
 * info@spartancrew.co.uk" and read as Spartan's own mail (Vivid, 6 crew, 10-09; 29 such
 * messages since January). Google keeps the author in X-Original-Sender. Trusted only on a
 * message the group itself relayed (X-Google-Group-Id) and from one of our addresses:
 * anything else could claim an author it is not.
 */
export function groupAuthor(r: Record<string, unknown>): string | null {
  const h = (r.headers ?? {}) as Record<string, unknown>;
  if (!h["x-google-group-id"]) return null;
  if (!/@spartancrew\.co\.uk$/i.test(addrOf(r.from ?? r.fromAddress))) return null;
  const author = addrOf(h["x-original-sender"]);
  return author && author.includes("@") && !/@spartancrew\.co\.uk$/i.test(author) ? author : null;
}

export function messagesFromPayload(payload: unknown): StoredMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const b = payload as Record<string, unknown>;
  const oe = (b.original_email ?? {}) as Record<string, unknown>;
  const thread_id = String(
    b.thread_id ?? b.threadId ?? oe.thread_id ?? oe.threadId ?? b.conversationId ?? ""
  ).trim();
  if (!thread_id) return [];

  const raw = Array.isArray(b.messages) && b.messages.length
    ? (b.messages as unknown[])
    : (oe.body || oe.email_id) ? [oe] : [];

  const out: StoredMessage[] = [];
  for (const m of raw) {
    const r = (m ?? {}) as Record<string, unknown>;
    const message_id = String(r.message_id ?? r.messageId ?? r.id ?? r.email_id ?? "").trim();
    if (!message_id) continue;          // no id means no identity means not storable
    if (isAnUnsentDraft(r)) continue;   // the client never saw it — see the note above
    const from = groupAuthor(r) ?? addrOf(r.from ?? r.fromAddress);
    // The reply-chain headers, as n8n's "Build Engine Payload" sends them (SP-18), or inside
    // its curated `headers` from builds before 10-22, which carried In-Reply-To and References
    // there and nowhere else. Absent keys stay absent: "not sent" and "the message had none"
    // are different facts.
    const header = (v: unknown) => (Array.isArray(v) ? v.join(" ") : String(v ?? ""));
    const hd = (r.headers && typeof r.headers === "object" ? r.headers : {}) as Record<string, unknown>;
    const rfc = r.rfc_message_id ?? hd["message-id"], irt = r.in_reply_to ?? hd["in-reply-to"], refs = r.references ?? hd["references"];
    const files = Array.isArray(r.attachments) ? r.attachments.map((a) => (a && typeof a === "object" ? (a as { filename?: unknown }).filename : a)).filter((a): a is string => typeof a === "string" && !!a) : null;
    const chain = {
      ...(rfc != null ? { rfc_message_id: idsIn(header(rfc))[0] || null } : {}),
      ...(irt != null ? { in_reply_to: idsIn(header(irt)) } : {}),
      ...(refs != null ? { reference_ids: idsIn(header(refs)) } : {}),
      ...(r.cc != null ? { cc_addresses: addrList(r.cc).map((a) => a.toLowerCase()) } : {}),
      ...(files ? { attachment_names: files } : {}),
    };
    out.push({
      ...chain,
      message_id,
      thread_id,
      from_address: from,
      to_addresses: addrList(r.to ?? r.toRecipients),
      date_iso: String(r.date_iso ?? r.dateIso ?? r.date ?? r.sentDateTime ?? ""),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? r.text ?? r.bodyContent ?? "") || null,
      is_from_spartan:
        typeof r.is_from_spartan === "boolean" && !groupAuthor(r)
          ? r.is_from_spartan
          : /@spartancrew\.co\.uk$/i.test(from),
    });
  }
  return out;
}

/** Store every message in a payload. Never throws: intake must not fail on a ledger error. */
export async function storeThreadMessages(payload: unknown):
  Promise<{ ok: boolean; inserted: number; seen: number; ids: string[] }> {
  const msgs = messagesFromPayload(payload);
  if (!msgs.length) return { ok: true, inserted: 0, seen: 0, ids: [] };
  const sql = db();
  if (!sql) return { ok: false, inserted: 0, seen: msgs.length, ids: [] };
  // Rows go in one at a time, so a failure part way has already stored some: those ids are
  // returned with ok:false. Reported as none, they were never "new" again and never decided.
  const ids: string[] = [];
  try {
    await ensure(sql);
    for (const m of msgs) {
      const rows = (await sql`
        INSERT INTO thread_messages
          (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan,
           rfc_message_id, in_reply_to, reference_ids, cc_addresses, attachment_names)
        VALUES (${m.message_id}, ${m.thread_id}, ${m.from_address},
                ${JSON.stringify(m.to_addresses)}, ${m.date_iso}, ${m.subject},
                ${m.body}, ${m.is_from_spartan},
                ${m.rfc_message_id || null}, ${m.in_reply_to ?? null}, ${m.reference_ids ?? null},
                ${m.cc_addresses ? JSON.stringify(m.cc_addresses) : null}, ${m.attachment_names ? JSON.stringify(m.attachment_names) : null})
        ON CONFLICT DO NOTHING
        RETURNING message_id`) as { message_id: string }[];
      if (rows.length) ids.push(m.message_id);
      else await fillHeaders(sql, m);
    }
    return { ok: true, inserted: ids.length, seen: msgs.length, ids };
  } catch (err) {
    console.error("[thread_messages] store failed", err);
    return { ok: false, inserted: ids.length, seen: msgs.length, ids };
  }
}

/**
 * A message already stored gets the header columns it lacks when its thread is delivered
 * again. Rows stored before 22 Oct have none, and a reply's In-Reply-To can only be followed
 * to a parent whose Message-ID is kept. Only empty columns are filled and nothing else on the
 * row moves; it is a separate UPDATE with no RETURNING, so a re-delivery still never counts as
 * a new message. Its own try: a failure here must not stop the rest of the thread being stored.
 */
async function fillHeaders(sql: NeonQueryFunction<false, false>, m: StoredMessage): Promise<void> {
  if (!m.rfc_message_id && !m.in_reply_to?.length && !m.reference_ids?.length && !m.cc_addresses && !m.attachment_names) return;
  const rfc = m.rfc_message_id || null;
  try {
    await sql`
      UPDATE thread_messages SET
        rfc_message_id = coalesce(rfc_message_id, CASE WHEN EXISTS (SELECT 1 FROM thread_messages x WHERE x.rfc_message_id = ${rfc}) THEN NULL ELSE ${rfc} END),
        in_reply_to = coalesce(in_reply_to, ${m.in_reply_to ?? null}),
        reference_ids = coalesce(reference_ids, ${m.reference_ids ?? null}),
        cc_addresses = coalesce(cc_addresses, ${m.cc_addresses ? JSON.stringify(m.cc_addresses) : null}::jsonb),
        attachment_names = coalesce(attachment_names, ${m.attachment_names ? JSON.stringify(m.attachment_names) : null}::jsonb)
      WHERE message_id = ${m.message_id}`;
  } catch (err) {
    console.error("[thread_messages] header fill failed", m.message_id, err);
  }
}

/**
 * Store one message. The routing-rule intake receives messages, not threads, so it
 * has nothing to hand storeThreadMessages — and inventing a one-message payload just
 * to take it apart again would put the shape-guessing of messagesFromPayload on a path
 * that already knows exactly what it has.
 *
 * Returns false when the row was already there, which is how a provider retry (Mailgun
 * retries for eight hours) costs nothing.
 */
export async function storeMessage(m: StoredMessage): Promise<{ ok: boolean; inserted: boolean }> {
  /**
   * THE GUARD BELONGS ON BOTH INSERTS, and for a while it was on one.
   *
   * messagesFromPayload covers the sweep, which does not yet send labels. This path
   * is the Gmail poller, which reads the very mailbox the engine writes its drafts
   * into — so it is the path where an unsent draft of ours would actually be seen,
   * stored with is_from_spartan: true, and read downstream as Spartan having replied.
   * Guarding only the other one protected the case that could not happen yet and
   * missed the case that will.
   */
  if (isAnUnsentDraft(m as unknown as Record<string, unknown>)) {
    return { ok: true, inserted: false };
  }
  const sql = db();
  if (!sql) return { ok: false, inserted: false };
  try {
    await ensure(sql);
    const rows = (await sql`
      INSERT INTO thread_messages
        (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan, rfc_message_id, in_reply_to, reference_ids, cc_addresses, attachment_names)
      VALUES (${m.message_id}, ${m.thread_id}, ${m.from_address},
              ${JSON.stringify(m.to_addresses ?? [])}, ${m.date_iso}, ${m.subject},
              ${m.body}, ${m.is_from_spartan}, ${m.rfc_message_id || null},
              ${m.in_reply_to ?? null}, ${m.reference_ids ?? null},
              ${m.cc_addresses ? JSON.stringify(m.cc_addresses) : null}, ${m.attachment_names ? JSON.stringify(m.attachment_names) : null})
      ON CONFLICT DO NOTHING
      RETURNING message_id`) as { message_id: string }[];
    return { ok: true, inserted: rows.length > 0 };
  } catch (err) {
    console.error("[thread_messages] store one failed", err);
    return { ok: false, inserted: false };
  }
}

/**
 * Which thread holds any of these message ids — answering for the FIRST one present,
 * in the order given.
 *
 * Order is the whole point and is the caller's, not the database's: referenceIdsOf
 * hands them over nearest ancestor first, so when a chain crosses two stored threads
 * the closer one wins. Returning whatever Postgres happened to sort first would make
 * that arbitrary, and fusing both would be a merge — two jobs on one conversation.
 */
export async function threadIdForMessageIds(ids: string[]):
  Promise<{ id: string; thread_id: string } | null> {
  if (!ids.length) return null;
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT message_id, rfc_message_id, thread_id FROM thread_messages
      WHERE message_id = ANY(${ids}) OR rfc_message_id = ANY(${ids})`) as
      { message_id: string; rfc_message_id: string | null; thread_id: string }[];
    if (!rows.length) return null;
    // A References header names RFC ids; a row the poller stored is keyed by Gmail id
    // and answers to its RFC id only through the second column.
    const byId = new Map<string, string>();
    for (const r of rows) {
      byId.set(r.message_id, r.thread_id);
      if (r.rfc_message_id) byId.set(r.rfc_message_id, r.thread_id);
    }
    for (const id of ids) {
      const t = byId.get(id);
      if (t) return { id, thread_id: t };
    }
    return null;
  } catch (err) {
    console.error("[thread_messages] reference lookup failed", err);
    return null;
  }
}

/**
 * Rebuild a thread in the exact shape engine/intake.ts coerceThread accepts, so a replay
 * does not need the original POST body. This is what makes storing the payload N times
 * unnecessary.
 */
export async function rebuildThread(thread_id: string):
  Promise<{ thread_id: string; messages: StoredMessage[] } | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
      FROM thread_messages WHERE thread_id = ${thread_id}
      ORDER BY date_iso ASC, first_seen_at ASC`) as StoredMessage[];
    if (!rows.length) return null;
    return { thread_id, messages: rows.map((r) => ({ ...r, to_addresses: r.to_addresses ?? [] })) };
  } catch (err) {
    console.error("[thread_messages] rebuild failed", err);
    return null;
  }
}
