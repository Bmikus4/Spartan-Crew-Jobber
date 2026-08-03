// Tickets — the first-class Postgres store behind the Jobs Board (HoH tickets
// mechanics, Spartan-native columns): thread_id PK, COALESCE-merge upsert (a
// sparse follow-up never blanks a stored fact), an append-only ticket_events
// audit log, and a projection to the Job read-model the UI already renders.
// Written from the engine's ConversationState after each processed thread.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { ConversationState } from "./engine/types";
import type { Job } from "./jobsDb";

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
export function ticketsDbEnabled(): boolean {
  return !!connString();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS tickets (
      thread_id            TEXT PRIMARY KEY,
      subject              TEXT,
      contact              TEXT,
      company_id           INT,
      user_id              INT,
      place_id             INT,
      onsinch_order_id     BIGINT,
      onsinch_order_number TEXT,
      classification       TEXT,
      status               TEXT,
      is_client_inquiry    BOOLEAN,
      gate_reason          TEXT,
      priority             TEXT,
      crew_size            INT,
      dates                JSONB,
      location             TEXT,
      reply_state          TEXT,
      reply_draft_id       TEXT,
      ai_replied           BOOLEAN,
      needs_human          BOOLEAN,
      extracted            JSONB,
      notes                JSONB,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  // Several threads may own the SAME order, because a client raises one job and
  // then emails about it more than once — a new thread for the crew change,
  // another for the invoice query. Order dedup matches on company + happening
  // date, so all of them correctly resolve to one order, and that is right:
  // one job, one order. Ben, 2026-08-03: "both threads should own it, its the
  // same job."
  //
  // This was a UNIQUE index, which enforced one TICKET per ORDER and refused the
  // second thread's link — live, 19fb8a6d756a916b lost to 19fb421845dd47b4 over
  // order 13639 and ended up with no ticket at all. It also never matched its own
  // comment ("a second order can't link to the same ticket twice" is the reverse
  // relation, already guaranteed by thread_id being the primary key).
  //
  // The invariant that DOES matter — never create a duplicate order for one job —
  // lives in resolve.matchExistingOrder and is untouched.
  await sql`DROP INDEX IF EXISTS tickets_order_uniq`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_order ON tickets (onsinch_order_id) WHERE onsinch_order_id IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_updated ON tickets (updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status)`;
  await sql`
    CREATE TABLE IF NOT EXISTS ticket_events (
      id        BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      meta      JSONB,
      ts        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS ticket_events_thread ON ticket_events (thread_id, ts DESC)`;
  _ready = true;
}

/** Project a ConversationState into the ticket columns. */
function project(s: ConversationState) {
  const desired = s.pending_order?.desired ?? s.desired_order ?? null;
  const crew = desired?.slot_teams?.length
    ? desired.slot_teams.reduce((n, t) => n + (t.size || 0), 0)
    : null;
  const dates = [...new Set((s.facts?.requests ?? []).map((q) => q.date).filter(Boolean))];
  return {
    subject: s.subject || null,
    contact: s.facts?.contact_name || s.facts?.contact_email || s.participants?.[0] || null,
    company_id: s.company_id ?? null,
    user_id: s.user_id ?? null,
    place_id: s.place_id ?? null,
    onsinch_order_id: s.onsinch_order_id ?? null,
    onsinch_order_number: s.onsinch_order_number ?? null,
    classification: s.classification,
    status: s.status,
    is_client_inquiry: s.classification !== "not-a-job",
    gate_reason: s.classification === "not-a-job" ? (s.notes?.[0] ?? null) : null,
    priority: s.priority,
    crew_size: crew,
    dates,
    location: s.facts?.location_text ?? null,
    reply_state: s.reply_draft_id ? "drafted" : "none",
    reply_draft_id: s.reply_draft_id ?? null,
    ai_replied: !!(s.reply_draft_id || s.last_reply_hash),
    needs_human: !!s.needs_human,
    extracted: { facts: s.facts, desired_order: desired },
    notes: s.notes ?? [],
  };
}

/**
 * Upsert the ticket for a processed thread. COALESCE-merge on the fact columns
 * (a sparser later pass never blanks a known fact); current-state columns
 * (status/classification/needs_human/…) always take the latest. Appends a
 * ticket_event. Never throws — a projection failure must not break the pipeline.
 */
export async function upsertTicketFromState(s: ConversationState): Promise<void> {
  const sql = db();
  if (!sql) return;
  // Declared outside the try: the order-link-conflict fallback in the catch needs
  // the same projection to write the ticket without its order link.
  const p = project(s);
  try {
    await ensure(sql);
    await sql`
      INSERT INTO tickets (
        thread_id, subject, contact, company_id, user_id, place_id,
        onsinch_order_id, onsinch_order_number, classification, status,
        is_client_inquiry, gate_reason, priority, crew_size, dates, location,
        reply_state, reply_draft_id, ai_replied, needs_human, extracted, notes, updated_at)
      VALUES (
        ${s.thread_id}, ${p.subject}, ${p.contact}, ${p.company_id}, ${p.user_id}, ${p.place_id},
        ${p.onsinch_order_id}, ${p.onsinch_order_number}, ${p.classification}, ${p.status},
        ${p.is_client_inquiry}, ${p.gate_reason}, ${p.priority}, ${p.crew_size},
        ${JSON.stringify(p.dates)}, ${p.location},
        ${p.reply_state}, ${p.reply_draft_id}, ${p.ai_replied}, ${p.needs_human},
        ${JSON.stringify(p.extracted)}, ${JSON.stringify(p.notes)}, now())
      ON CONFLICT (thread_id) DO UPDATE SET
        subject              = COALESCE(EXCLUDED.subject, tickets.subject),
        contact              = COALESCE(EXCLUDED.contact, tickets.contact),
        company_id           = COALESCE(EXCLUDED.company_id, tickets.company_id),
        user_id              = COALESCE(EXCLUDED.user_id, tickets.user_id),
        place_id             = COALESCE(EXCLUDED.place_id, tickets.place_id),
        onsinch_order_id     = COALESCE(EXCLUDED.onsinch_order_id, tickets.onsinch_order_id),
        onsinch_order_number = COALESCE(EXCLUDED.onsinch_order_number, tickets.onsinch_order_number),
        classification       = EXCLUDED.classification,
        status               = EXCLUDED.status,
        is_client_inquiry    = EXCLUDED.is_client_inquiry,
        gate_reason          = EXCLUDED.gate_reason,
        priority             = EXCLUDED.priority,
        crew_size            = COALESCE(EXCLUDED.crew_size, tickets.crew_size),
        dates                = EXCLUDED.dates,
        location             = COALESCE(EXCLUDED.location, tickets.location),
        reply_state          = EXCLUDED.reply_state,
        reply_draft_id       = COALESCE(EXCLUDED.reply_draft_id, tickets.reply_draft_id),
        ai_replied           = EXCLUDED.ai_replied,
        needs_human          = EXCLUDED.needs_human,
        extracted            = EXCLUDED.extracted,
        notes                = EXCLUDED.notes,
        updated_at           = now()`;
    await sql`INSERT INTO ticket_events (thread_id, kind, meta) VALUES (${s.thread_id}, ${"processed"}, ${JSON.stringify({ classification: s.classification, status: s.status, order_id: p.onsinch_order_id })})`;
  } catch (err) {
    // Sharing an order across threads is no longer an error, so there is no
    // conflict path to recover from here — a failure now is a real failure.
    console.error("[tickets] upsert failed", s.thread_id, err);
  }
}

export interface TicketDetail extends Job {
  user_id: number | null;
  place_id: number | null;
  is_client_inquiry: boolean;
  gate_reason: string | null;
  reply_state: string | null;
  notes: string[];
  extracted: { facts?: unknown; desired_order?: unknown } | null;
  created_at: string;
}

/** Full ticket for the detail panel (includes the composed draft order + notes). */
export async function getTicketDetail(thread_id: string): Promise<TicketDetail | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT *, extract(epoch from updated_at) * 1000 AS uts, extract(epoch from created_at) * 1000 AS cts
      FROM tickets WHERE thread_id = ${thread_id} LIMIT 1`) as any[];
    const r = rows[0];
    if (!r) return null;
    return {
      thread_id: r.thread_id,
      subject: r.subject || "(no subject)",
      contact: r.contact || "—",
      company_id: r.company_id ?? null,
      user_id: r.user_id ?? null,
      place_id: r.place_id ?? null,
      order_id: r.onsinch_order_id ?? null,
      order_number: r.onsinch_order_number ?? null,
      classification: r.classification,
      status: r.status,
      priority: r.priority,
      needs_human: !!r.needs_human,
      ai_replied: !!r.ai_replied,
      is_client_inquiry: !!r.is_client_inquiry,
      gate_reason: r.gate_reason ?? null,
      reply_state: r.reply_state ?? null,
      crew_size: r.crew_size ?? null,
      dates: Array.isArray(r.dates) ? r.dates : [],
      location: r.location ?? null,
      notes: Array.isArray(r.notes) ? r.notes : [],
      extracted: r.extracted ?? null,
      created_at: new Date(Number(r.cts)).toISOString(),
      updated_at: new Date(Number(r.uts)).toISOString(),
    };
  } catch (err) {
    console.error("[tickets] detail failed", thread_id, err);
    return null;
  }
}

/** The Jobs Board read-model — projects tickets rows into Job[]. */
export async function listTickets(limit = 300): Promise<Job[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT thread_id, subject, contact, company_id, onsinch_order_id, onsinch_order_number,
             classification, status, priority, needs_human, ai_replied, crew_size, dates, location,
             extract(epoch from updated_at) * 1000 AS ts
      FROM tickets
      WHERE is_client_inquiry = true OR onsinch_order_id IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT ${limit}`) as any[];
    return rows.map((r) => ({
      thread_id: r.thread_id,
      subject: r.subject || "(no subject)",
      contact: r.contact || "—",
      company_id: r.company_id ?? null,
      order_id: r.onsinch_order_id ?? null,
      order_number: r.onsinch_order_number ?? null,
      classification: r.classification,
      status: r.status,
      priority: r.priority,
      needs_human: !!r.needs_human,
      ai_replied: !!r.ai_replied,
      crew_size: r.crew_size ?? null,
      dates: Array.isArray(r.dates) ? r.dates : [],
      location: r.location ?? null,
      updated_at: new Date(Number(r.ts)).toISOString(),
    }));
  } catch (err) {
    console.error("[tickets] list failed", err);
    return [];
  }
}
