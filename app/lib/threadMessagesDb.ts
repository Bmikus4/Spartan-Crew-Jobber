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
  await sql`
    CREATE TABLE IF NOT EXISTS thread_messages (
      message_id      TEXT PRIMARY KEY,
      thread_id       TEXT NOT NULL,
      from_address    TEXT,
      to_addresses    JSONB,
      date_iso        TEXT,
      subject         TEXT,
      body            TEXT,
      is_from_spartan BOOLEAN NOT NULL DEFAULT false,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at     TIMESTAMPTZ
    )`;
  await sql`CREATE INDEX IF NOT EXISTS thread_messages_thread ON thread_messages (thread_id, date_iso)`;
  await sql`CREATE INDEX IF NOT EXISTS thread_messages_seen ON thread_messages (first_seen_at DESC)`;
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
    const from = addrOf(r.from ?? r.fromAddress);
    out.push({
      message_id,
      thread_id,
      from_address: from,
      to_addresses: addrList(r.to ?? r.toRecipients),
      date_iso: String(r.date_iso ?? r.dateIso ?? r.date ?? r.sentDateTime ?? ""),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? r.text ?? r.bodyContent ?? "") || null,
      is_from_spartan:
        typeof r.is_from_spartan === "boolean"
          ? r.is_from_spartan
          : /@spartancrew\.co\.uk$/i.test(from),
    });
  }
  return out;
}

/** Store every message in a payload. Never throws: intake must not fail on a ledger error. */
export async function storeThreadMessages(payload: unknown):
  Promise<{ ok: boolean; inserted: number; seen: number }> {
  const msgs = messagesFromPayload(payload);
  if (!msgs.length) return { ok: true, inserted: 0, seen: 0 };
  const sql = db();
  if (!sql) return { ok: false, inserted: 0, seen: msgs.length };
  try {
    await ensure(sql);
    let inserted = 0;
    for (const m of msgs) {
      const rows = (await sql`
        INSERT INTO thread_messages
          (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan)
        VALUES (${m.message_id}, ${m.thread_id}, ${m.from_address},
                ${JSON.stringify(m.to_addresses)}, ${m.date_iso}, ${m.subject},
                ${m.body}, ${m.is_from_spartan})
        ON CONFLICT (message_id) DO NOTHING
        RETURNING message_id`) as { message_id: string }[];
      if (rows.length) inserted++;
    }
    return { ok: true, inserted, seen: msgs.length };
  } catch (err) {
    console.error("[thread_messages] store failed", err);
    return { ok: false, inserted: 0, seen: msgs.length };
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
