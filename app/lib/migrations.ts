// ============================================================================
// The database schema: every table, column and index the app uses, in one ordered list.
// ----------------------------------------------------------------------------
// Addendum F44 (26 Oct): 83 schema statements ran at request time from 27 files, each store making
// its own tables on first use, so no one place said what the database is. They are listed here in the
// order they must run (a table before its columns and indexes), each with the comment that stood over
// it, and run by migrate(): each once per database, recorded in schema_migrations. Every statement is
// idempotent (IF NOT EXISTS, IF EXISTS, or a DO block that checks first), so a database that already
// has the shape, production's included, records them without change.
//
// APPEND ONLY. A migration that has run is never edited or removed: a changed statement under an old id
// would never run where the old one had, and the schemas would part. A change is a new id at the end.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";

export const MIGRATIONS: ReadonlyArray<readonly [id: string, statement: string]> = [
  // lib/settingsDb.ts
  ["001_create_table_app_settings", `CREATE TABLE IF NOT EXISTS app_settings (id TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // api/bot/labels/route.ts
  ["002_create_table_thread_labels", `CREATE TABLE IF NOT EXISTS thread_labels (thread_id TEXT PRIMARY KEY, order_label TEXT, follow_up BOOLEAN NOT NULL DEFAULT false, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // lib/aliasesDb.ts
  ["003_create_table_entity_aliases", `CREATE TABLE IF NOT EXISTS entity_aliases (
      kind        TEXT NOT NULL,
      alias_norm  TEXT NOT NULL,
      entity_id   INT  NOT NULL,
      source      TEXT NOT NULL,
      seen_count  INT  NOT NULL DEFAULT 1,
      raw_example TEXT,
      first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, alias_norm)
    )`],
  // lib/aliasesDb.ts
  ["004_create_index_entity_aliases_entity", `CREATE INDEX IF NOT EXISTS entity_aliases_entity ON entity_aliases (kind, entity_id)`],
  // lib/aliasesDb.ts
  ["005_create_index_entity_aliases_source", `CREATE INDEX IF NOT EXISTS entity_aliases_source ON entity_aliases (source)`],
  // lib/errorReport.ts
  ["006_create_table_error_reports", `CREATE TABLE IF NOT EXISTS error_reports (
      fingerprint      TEXT PRIMARY KEY,
      where_at         TEXT NOT NULL,
      what             TEXT NOT NULL,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurrences      BIGINT NOT NULL DEFAULT 1,
      last_emailed_at  TIMESTAMPTZ,
      last_detail      TEXT,
      deploy_sha       TEXT
    )`],
  // lib/errorReport.ts
  ["007_create_index_error_reports_last_seen", `CREATE INDEX IF NOT EXISTS error_reports_last_seen ON error_reports (last_seen_at DESC)`],
  // lib/feed/marksDb.ts
  ["008_create_table_feed_marks", `CREATE TABLE IF NOT EXISTS feed_marks (
      item_key  TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      mark      TEXT NOT NULL,
      by        TEXT,
      evidence  JSONB,
      at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (item_key, mark)
    )`],
  // lib/feed/marksDb.ts
  ["009_create_table_feed_meta", `CREATE TABLE IF NOT EXISTS feed_meta (
      id               INT PRIMARY KEY,
      last_verify_at   TIMESTAMPTZ,
      timeline_last_id BIGINT,
      verify_note      TEXT
    )`],
  // lib/followup/suppressionDb.ts
  ["010_create_table_followup_suppressions", `CREATE TABLE IF NOT EXISTS followup_suppressions (
      thread_id         TEXT PRIMARY KEY,
      waiting_since_iso TEXT NOT NULL,
      suppressed_by     TEXT,
      reason            TEXT,
      suppressed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/inboundRawDb.ts
  ["011_create_table_inbound_raw", `CREATE TABLE IF NOT EXISTS inbound_raw (
      id          BIGSERIAL PRIMARY KEY,
      dedup_key   TEXT UNIQUE NOT NULL,
      source      TEXT,
      thread_id   TEXT,
      message_id  TEXT,
      payload     JSONB NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/inboundRawDb.ts
  ["012_create_index_inbound_raw_received", `CREATE INDEX IF NOT EXISTS inbound_raw_received ON inbound_raw (received_at DESC)`],
  // lib/inboundRawDb.ts
  ["013_create_index_inbound_raw_thread", `CREATE INDEX IF NOT EXISTS inbound_raw_thread ON inbound_raw (thread_id)`],
  // lib/inboundRawDb.ts
  // The payload column is EMPTIED, not dropped: reverting is then one line, and rows
  // captured before the restructure keep the copy the ops scripts may still read.
  ["014_alter_table_inbound_raw", `ALTER TABLE inbound_raw ALTER COLUMN payload DROP NOT NULL`],
  // lib/inboundRawDb.ts
  ["015_alter_table_inbound_raw", `ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS message_ids TEXT[]`],
  // lib/inboundRawDb.ts
  ["016_alter_table_inbound_raw", `ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS envelope JSONB`],
  // lib/mail/cursorDb.ts
  ["017_create_table_mail_cursor", `CREATE TABLE IF NOT EXISTS mail_cursor (
      mailbox     TEXT PRIMARY KEY,
      history_id  TEXT NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_run_at TIMESTAMPTZ,
      last_count  INTEGER NOT NULL DEFAULT 0
    )`],
  // lib/mail/cursorDb.ts
  ["018_create_table_mail_seen", `CREATE TABLE IF NOT EXISTS mail_seen (
      mailbox  TEXT NOT NULL,
      gmail_id TEXT NOT NULL,
      seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (mailbox, gmail_id)
    )`],
  // lib/mail/cursorDb.ts
  ["019_create_index_mail_seen_at", `CREATE INDEX IF NOT EXISTS mail_seen_at ON mail_seen (seen_at DESC)`],
  // lib/messageLedgerDb.ts
  ["020_create_table_message_ledger", `CREATE TABLE IF NOT EXISTS message_ledger (
      message_id    TEXT PRIMARY KEY,
      thread_id     TEXT,
      subject       TEXT,
      from_address  TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen_count    INT NOT NULL DEFAULT 1,
      note          TEXT
    )`],
  // lib/messageLedgerDb.ts
  ["021_create_index_message_ledger_thread", `CREATE INDEX IF NOT EXISTS message_ledger_thread ON message_ledger (thread_id)`],
  // lib/messageLedgerDb.ts
  ["022_create_index_message_ledger_first_seen", `CREATE INDEX IF NOT EXISTS message_ledger_first_seen ON message_ledger (first_seen_at DESC)`],
  // lib/metricsDb.ts
  ["023_create_table_metric_events", `CREATE TABLE IF NOT EXISTS metric_events (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      thread_id TEXT,
      meta JSONB
    )`],
  // lib/metricsDb.ts
  ["024_create_index_metric_events_kind_ts", `CREATE INDEX IF NOT EXISTS metric_events_kind_ts ON metric_events (kind, ts)`],
  // lib/onboardingDb.ts
  // org_key is the email DOMAIN — see orgProfile.ts for why that is the only
  // organisation identity this app has.
  ["025_create_table_org_terms_acceptance", `CREATE TABLE IF NOT EXISTS org_terms_acceptance (
      org_key TEXT NOT NULL,
      terms_version TEXT NOT NULL,
      accepted_by TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (org_key, terms_version)
    )`],
  // lib/onboardingDb.ts
  // The PRIMARY KEY carries the version, so bumping TERMS_VERSION re-prompts an
  // organisation instead of treating an old signature as covering new terms. That is
  // the whole reason the version is in the key.
  ["026_create_table_user_onboarding", `CREATE TABLE IF NOT EXISTS user_onboarding (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      contact_email TEXT,
      organisation TEXT NOT NULL,
      org_key TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/orderArchiveDb.ts
  ["027_create_table_order_archive", `CREATE TABLE IF NOT EXISTS order_archive (
      id             BIGSERIAL PRIMARY KEY,
      thread_id      TEXT NOT NULL,
      -- What was deleted.
      order_id       BIGINT NOT NULL,
      order_number   TEXT,
      job_id         BIGINT,
      -- What replaced it. Null while the rebuild is in flight, and null forever if the
      -- rebuild failed — which is precisely the row somebody needs to find.
      replaced_by_order_id     BIGINT,
      replaced_by_order_number TEXT,
      replaced_by_job_id       BIGINT,
      -- The whole thing, as it stood.
      live_order     JSONB,
      slot_teams     JSONB NOT NULL DEFAULT '[]'::jsonb,
      slot_teams_are_reconstruction BOOLEAN NOT NULL DEFAULT true,
      -- Why, in the words a human would use: "crew 6 -> 4".
      reason         TEXT,
      created        TIMESTAMPTZ,
      deleted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/orderArchiveDb.ts
  ["028_create_index_order_archive_thread", `CREATE INDEX IF NOT EXISTS order_archive_thread ON order_archive (thread_id)`],
  // lib/orderArchiveDb.ts
  // The lookups that matter are by the number a human types, not by the api id.
  ["029_create_index_order_archive_number", `CREATE INDEX IF NOT EXISTS order_archive_number ON order_archive (order_number)`],
  // lib/orderArchiveDb.ts
  ["030_create_index_order_archive_job", `CREATE INDEX IF NOT EXISTS order_archive_job ON order_archive (job_id)`],
  // lib/orderRecordsDb.ts
  ["031_create_table_order_records", `CREATE TABLE IF NOT EXISTS order_records (
      order_id      BIGINT NOT NULL,
      thread_id     TEXT NOT NULL,
      job_id        BIGINT,
      order_number  TEXT,
      sender_email  TEXT,
      sender_domain TEXT,
      company_id    INT,
      place_id      INT,
      shape_sent    JSONB NOT NULL,
      block_count   INT NOT NULL,
      crew_total    INT NOT NULL,
      id_source     TEXT NOT NULL DEFAULT 'api_response',
      verified_at   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (thread_id, order_id)
    )`],
  // lib/orderRecordsDb.ts
  /**
   * Migrate a table created under the old one-row-per-order key. Postgres names that
   * constraint `order_records_pkey`, and dropping it is safe because the composite key
   * added straight after is strictly weaker — every row that satisfied the old key
   * satisfies the new one, so nothing can fail to migrate.
   */
  ["032_alter_table_order_records", `ALTER TABLE order_records DROP CONSTRAINT IF EXISTS order_records_pkey`],
  // lib/orderRecordsDb.ts
  ["033_alter_table_order_records", `ALTER TABLE order_records ADD COLUMN IF NOT EXISTS id_source TEXT NOT NULL DEFAULT 'api_response'`],
  // lib/orderRecordsDb.ts
  ["034_alter_table_order_records", `ALTER TABLE order_records ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`],
  // lib/orderRecordsDb.ts
  ["035_do_block", `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_records_thread_order_pk') THEN
        ALTER TABLE order_records ADD CONSTRAINT order_records_thread_order_pk PRIMARY KEY (thread_id, order_id);
      END IF;
    END $$`],
  // lib/orderRecordsDb.ts
  ["036_create_index_order_records_order", `CREATE INDEX IF NOT EXISTS order_records_order ON order_records (order_id)`],
  // lib/orderRecordsDb.ts
  ["037_create_index_order_records_thread", `CREATE INDEX IF NOT EXISTS order_records_thread ON order_records (thread_id)`],
  // lib/orderRecordsDb.ts
  ["038_create_index_order_records_domain", `CREATE INDEX IF NOT EXISTS order_records_domain ON order_records (sender_domain)`],
  // lib/orderRecordsDb.ts
  ["039_create_index_order_records_unverified", `CREATE INDEX IF NOT EXISTS order_records_unverified ON order_records (id_source) WHERE verified_at IS NULL`],
  // lib/professionsDb.ts
  ["040_create_table_onsinch_professions", `CREATE TABLE IF NOT EXISTS onsinch_professions (
      id          INT PRIMARY KEY,
      name        TEXT NOT NULL,
      alias       TEXT,
      description TEXT,
      -- Deleted rows are STORED, not dropped. They still come back from OnSinch and
      -- the resolver has to know they are unbookable; a row missing from the cache
      -- is indistinguishable from a row we never fetched.
      deleted     BOOLEAN NOT NULL DEFAULT false,
      synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/rateCardsDb.ts
  ["041_create_table_rate_cards", `CREATE TABLE IF NOT EXISTS rate_cards (
      company_id INT PRIMARY KEY,
      card       INT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'history',
      share      REAL,
      n          INT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/runMarks.ts
  ["042_create_table_run_marks", `CREATE TABLE IF NOT EXISTS run_marks (name TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL, ok BOOLEAN NOT NULL, detail JSONB)`],
  // lib/senderLedgerDb.ts
  ["043_create_table_sender_ledger", `CREATE TABLE IF NOT EXISTS sender_ledger (
      addr         TEXT PRIMARY KEY,
      threads_seen INT NOT NULL DEFAULT 0,
      jobs_seen    INT NOT NULL DEFAULT 0,
      -- A human decision, and the only thing that outranks the counters in either
      -- direction: 'trusted' pins a sender open, 'parked' pins one shut.
      override     TEXT,
      last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
      first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_subject TEXT
    )`],
  // lib/senderLedgerDb.ts
  ["044_create_index_sender_ledger_jobs", `CREATE INDEX IF NOT EXISTS sender_ledger_jobs ON sender_ledger (jobs_seen DESC)`],
  // lib/senderLedgerDb.ts
  ["045_create_index_sender_ledger_seen", `CREATE INDEX IF NOT EXISTS sender_ledger_seen ON sender_ledger (threads_seen DESC)`],
  // lib/senderLedgerDb.ts
  // One row per (addr, thread) is what makes "threads_seen" honest under re-processing:
  // the same thread is compiled again on every new message and a naive counter would
  // climb on each pass.
  ["046_create_table_sender_ledger_threads", `CREATE TABLE IF NOT EXISTS sender_ledger_threads (
      addr TEXT NOT NULL, thread_id TEXT NOT NULL, was_job BOOLEAN NOT NULL DEFAULT false,
      PRIMARY KEY (addr, thread_id)
    )`],
  // lib/stateDb.ts
  ["047_create_table_conversation_state", `CREATE TABLE IF NOT EXISTS conversation_state (
      thread_id TEXT PRIMARY KEY,
      status TEXT,
      needs_human BOOLEAN,
      onsinch_order_id BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      state JSONB NOT NULL
    )`],
  // lib/stateDb.ts
  ["048_create_index_conversation_state_status", `CREATE INDEX IF NOT EXISTS conversation_state_status ON conversation_state (status)`],
  // lib/stateDb.ts
  // When this thread was last RECONCILED, which is not when it was last written.
  // updated_at moves every time the engine touches a thread, so ordering a sweep by it
  // means the busiest conversations are swept repeatedly and the quiet ones never --
  // and a quiet thread bound to a deleted order is exactly the drift the sweep exists
  // to find. NULL means never swept, and NULLS FIRST is what makes a new thread jump
  // the queue rather than sit behind 250 rows that were done yesterday.
  ["049_alter_table_conversation_state", `ALTER TABLE conversation_state ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ`],
  // lib/stateDb.ts
  ["050_create_index_conversation_state_swept", `CREATE INDEX IF NOT EXISTS conversation_state_swept ON conversation_state (swept_at NULLS FIRST)`],
  // lib/sweepDb.ts
  ["051_create_table_sweep_threads", `CREATE TABLE IF NOT EXISTS sweep_threads (
      thread_id     TEXT PRIMARY KEY,
      mailbox       TEXT,
      message_count INT NOT NULL DEFAULT 0,
      first_date    TIMESTAMPTZ,
      last_date     TIMESTAMPTZ,
      subject       TEXT,
      participants  JSONB,
      payload       JSONB NOT NULL,
      swept_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/sweepDb.ts
  ["052_create_index_sweep_threads_last", `CREATE INDEX IF NOT EXISTS sweep_threads_last ON sweep_threads (last_date DESC)`],
  // lib/sweepDb.ts
  ["053_create_index_sweep_threads_count", `CREATE INDEX IF NOT EXISTS sweep_threads_count ON sweep_threads (message_count DESC)`],
  // lib/sweepLabelsDb.ts
  ["054_create_table_sweep_labels", `CREATE TABLE IF NOT EXISTS sweep_labels (
      thread_id      TEXT NOT NULL,
      model          TEXT NOT NULL,
      classification TEXT,
      is_cancellation BOOLEAN NOT NULL DEFAULT false,
      priority       TEXT,
      job_summary    TEXT,
      company_name   TEXT,
      location_text  TEXT,
      blocks         JSONB NOT NULL DEFAULT '[]'::jsonb,
      first_start    TIMESTAMPTZ,
      last_end       TIMESTAMPTZ,
      -- PEAK crew, not the sum across blocks: four crew over three days is a job for
      -- four people, and summing read it as twelve (one thread scored 61).
      crew_peak      INT,
      crew_days      INT,
      error          TEXT,
      labelled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (thread_id, model)
    )`],
  // lib/sweepLabelsDb.ts
  // The first version of this table summed crew into crew_total. Rename rather than
  // drop, so the handful of rows labelled under the old meaning are still inspectable
  // — and re-labelling overwrites them with the peak.
  ["055_do_block", `DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'sweep_labels' AND column_name = 'crew_total') THEN
        ALTER TABLE sweep_labels RENAME COLUMN crew_total TO crew_peak;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'sweep_labels' AND column_name = 'crew_days') THEN
        ALTER TABLE sweep_labels ADD COLUMN crew_days INT;
      END IF;
    END $$`],
  // lib/sweepLabelsDb.ts
  ["056_create_index_sweep_labels_class", `CREATE INDEX IF NOT EXISTS sweep_labels_class ON sweep_labels (classification)`],
  // lib/sweepLabelsDb.ts
  ["057_create_index_sweep_labels_start", `CREATE INDEX IF NOT EXISTS sweep_labels_start ON sweep_labels (first_start)`],
  // lib/testData.ts
  ["058_create_table_test_data_clears", `CREATE TABLE IF NOT EXISTS test_data_clears (at TIMESTAMPTZ NOT NULL DEFAULT now(), trigger TEXT NOT NULL, result JSONB NOT NULL)`],
  // lib/threadMessagesDb.ts
  ["059_create_table_thread_messages", `CREATE TABLE IF NOT EXISTS thread_messages (
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
    )`],
  // lib/threadMessagesDb.ts
  ["060_create_index_thread_messages_thread", `CREATE INDEX IF NOT EXISTS thread_messages_thread ON thread_messages (thread_id, date_iso)`],
  // lib/threadMessagesDb.ts
  ["061_create_index_thread_messages_seen", `CREATE INDEX IF NOT EXISTS thread_messages_seen ON thread_messages (first_seen_at DESC)`],
  // lib/threadMessagesDb.ts
  // A second key, not a replacement for message_id: every historical row is keyed by
  // Gmail id and has no RFC id to backfill from. UNIQUE so the same email read by the
  // poller (Gmail id) and by mail-inbound (RFC id) is one row, not two.
  ["062_alter_table_thread_messages", `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS rfc_message_id TEXT`],
  // lib/threadMessagesDb.ts
  ["063_create_unique_index_thread_messages_rfc", `CREATE UNIQUE INDEX IF NOT EXISTS thread_messages_rfc ON thread_messages (rfc_message_id) WHERE rfc_message_id IS NOT NULL`],
  // lib/threadMessagesDb.ts
  // The reply chain, for the resolver (design §9.2: a reply-chain parent is strong
  // evidence). `reference_ids`, not `references`, which is a reserved word in Postgres.
  ["064_alter_table_thread_messages", `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS in_reply_to TEXT[]`],
  // lib/threadMessagesDb.ts
  ["065_alter_table_thread_messages", `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS reference_ids TEXT[]`],
  // lib/threadMessagesDb.ts
  // For the job matcher: who was copied in (a colleague on Cc is often the order's contact)
  // and the files' names (a PO arrives as "PO 1244.pdf"). Kept apart from to_addresses, which
  // finders already read: folding Cc in would change which companies a thread resolves to.
  ["066_alter_table_thread_messages", `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS cc_addresses JSONB`],
  // lib/threadMessagesDb.ts
  ["067_alter_table_thread_messages", `ALTER TABLE thread_messages ADD COLUMN IF NOT EXISTS attachment_names JSONB`],
  // lib/ticketsDb.ts
  ["068_create_table_tickets", `CREATE TABLE IF NOT EXISTS tickets (
      thread_id            TEXT PRIMARY KEY,
      subject              TEXT,
      contact              TEXT,
      company_id           INT,
      user_id              INT,
      place_id             INT,
      onsinch_order_id     BIGINT,
      onsinch_order_number TEXT,
      onsinch_job_id       BIGINT,
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
    )`],
  // lib/ticketsDb.ts
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
  // The CREATE above only runs on an empty database, so a column added later has
  // to be added here too or it exists in dev and nowhere else.
  ["069_alter_table_tickets", `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS onsinch_job_id BIGINT`],
  // lib/ticketsDb.ts
  ["070_drop_index_tickets_order_uniq", `DROP INDEX IF EXISTS tickets_order_uniq`],
  // lib/ticketsDb.ts
  ["071_create_index_tickets_order", `CREATE INDEX IF NOT EXISTS tickets_order ON tickets (onsinch_order_id) WHERE onsinch_order_id IS NOT NULL`],
  // lib/ticketsDb.ts
  ["072_create_index_tickets_updated", `CREATE INDEX IF NOT EXISTS tickets_updated ON tickets (updated_at DESC)`],
  // lib/ticketsDb.ts
  ["073_create_index_tickets_status", `CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status)`],
  // lib/ticketsDb.ts
  ["074_create_table_ticket_events", `CREATE TABLE IF NOT EXISTS ticket_events (
      id        BIGSERIAL PRIMARY KEY,
      thread_id TEXT NOT NULL,
      kind      TEXT NOT NULL,
      meta      JSONB,
      ts        TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/ticketsDb.ts
  ["075_create_index_ticket_events_thread", `CREATE INDEX IF NOT EXISTS ticket_events_thread ON ticket_events (thread_id, ts DESC)`],
  // lib/v2/bot/db.ts
  ["076_create_table_bot_session", `CREATE TABLE IF NOT EXISTS bot_session (id INT PRIMARY KEY, state TEXT NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // lib/v2/bot/db.ts
  ["077_create_table_bot_lease", `CREATE TABLE IF NOT EXISTS bot_lease (id INT PRIMARY KEY, holder TEXT, until TIMESTAMPTZ NOT NULL DEFAULT 'epoch')`],
  // lib/v2/bot/db.ts
  ["078_create_table_bot_ledger", `CREATE TABLE IF NOT EXISTS bot_ledger (
      op_key     TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      kind       TEXT NOT NULL,
      op         JSONB NOT NULL,
      status     TEXT NOT NULL,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/v2/links.ts
  ["079_create_table_job_links", `CREATE TABLE IF NOT EXISTS job_links (
    thread_id TEXT NOT NULL, order_id BIGINT NOT NULL, r_number TEXT, job_id BIGINT, company_id INTEGER,
    state TEXT NOT NULL DEFAULT 'linked', source TEXT, shifts JSONB,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_checked TIMESTAMPTZ, held_since TIMESTAMPTZ, note TEXT,
    PRIMARY KEY (thread_id, order_id))`],
  // lib/v2/process.ts
  ["080_create_table_v2_decisions", `CREATE TABLE IF NOT EXISTS v2_decisions (
      message_id     TEXT PRIMARY KEY,
      thread_id      TEXT,
      from_address   TEXT,
      sent_at        TEXT,
      kind           TEXT NOT NULL,
      interpretation JSONB,
      decision       JSONB NOT NULL,
      executed       JSONB,
      code_version   TEXT,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`],
  // lib/v2/process.ts
  // The client as the TV names it; resolved here because the TV must not read OnSinch per refresh.
  ["081_alter_table_v2_decisions", `ALTER TABLE v2_decisions ADD COLUMN IF NOT EXISTS company_id INTEGER, ADD COLUMN IF NOT EXISTS company TEXT`],
  // lib/v2/process.ts
  // Mail stored while the automation was paused: kept, never decided (storeOnly).
  ["082_create_table_v2_store_only", `CREATE TABLE IF NOT EXISTS v2_store_only (message_id TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // lib/v2/replan.ts
  ["083_alter_table_v2_decisions", `ALTER TABLE v2_decisions ADD COLUMN IF NOT EXISTS replan JSONB, ADD COLUMN IF NOT EXISTS replanned_at TIMESTAMPTZ`],
  // lib/settingsDb.ts settingsHistory: one row per change of a write or reply switch (addendum F34).
  ["084_create_table_settings_history", `CREATE TABLE IF NOT EXISTS settings_history (
    id BIGSERIAL PRIMARY KEY, field TEXT NOT NULL, from_value JSONB, to_value JSONB, actor TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // lib/v2/traceLive.ts
  ["085_create_table_v2_trace", `CREATE TABLE IF NOT EXISTS v2_trace (
    id BIGSERIAL PRIMARY KEY, trace_id TEXT NOT NULL, source TEXT NOT NULL, component TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL, ms INTEGER, data JSONB NOT NULL)`],
  ["086_create_index_v2_trace_at", `CREATE INDEX IF NOT EXISTS v2_trace_at ON v2_trace (at)`],
  ["087_create_index_v2_trace_trace_id", `CREATE INDEX IF NOT EXISTS v2_trace_trace_id ON v2_trace (trace_id)`],
  // lib/v2/loop/truth.ts: OnSinch's booking timeline, never deleted; part is the entity a row is about, parent
  // the one a delete row names; order_id is filled once either is known (ADDENDUM §12.2).
  ["088_create_table_onsinch_timeline", `CREATE TABLE IF NOT EXISTS onsinch_timeline (
    id BIGINT PRIMARY KEY, action TEXT NOT NULL, creator INTEGER, created TIMESTAMPTZ NOT NULL, model TEXT,
    model_id TEXT, part TEXT, parent TEXT, order_id BIGINT, data JSONB NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  ["089_create_index_onsinch_timeline_created", `CREATE INDEX IF NOT EXISTS onsinch_timeline_created ON onsinch_timeline (created)`],
  ["090_create_index_onsinch_timeline_order_id", `CREATE INDEX IF NOT EXISTS onsinch_timeline_order_id ON onsinch_timeline (order_id)`],
  ["091_create_table_onsinch_parts", `CREATE TABLE IF NOT EXISTS onsinch_parts (part TEXT PRIMARY KEY, order_id BIGINT NOT NULL)`],
  ["092_create_table_onsinch_contacts", `CREATE TABLE IF NOT EXISTS onsinch_contacts (
    email TEXT NOT NULL, company_id INTEGER NOT NULL, refreshed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (email, company_id))`],
  ["093_create_table_v2_loop_meta", `CREATE TABLE IF NOT EXISTS v2_loop_meta (key TEXT PRIMARY KEY, value JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`],
  // The rows resolveOrders looks at every minute: a part made before 29 Jul stays unknown until its order is read.
  ["094_create_index_onsinch_timeline_unowned", `CREATE INDEX IF NOT EXISTS onsinch_timeline_unowned ON onsinch_timeline (part) WHERE order_id IS NULL`],
  // lib/v2/loop/variants.ts: each rule that touched an email, planned the other way at intake (ADDENDUM §12.3).
  ["095_create_table_v2_variants", `CREATE TABLE IF NOT EXISTS v2_variants (
    message_id TEXT NOT NULL, variant TEXT NOT NULL, decision JSONB, same BOOLEAN NOT NULL, error TEXT, code_version TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (message_id, variant))`],
  // lib/v2/loop/outcomes.ts: each decision and differing variant judged against what staff did (ADDENDUM §12.2).
  ["096_create_table_v2_outcomes", `CREATE TABLE IF NOT EXISTS v2_outcomes (
    message_id TEXT NOT NULL, variant TEXT NOT NULL, thread_id TEXT, sent_at TIMESTAMPTZ, kind TEXT, code TEXT, plan JSONB,
    company_id INTEGER, client_match TEXT, window_from TIMESTAMPTZ, window_to TIMESTAMPTZ, cut_by TEXT, days JSONB, venues JSONB,
    bucket TEXT, why TEXT, orders JSONB, acts INTEGER, plan_keys JSONB, staff_keys JSONB, staff_other JSONB, ahead_days INTEGER,
    day_flag TEXT, day_control TEXT, confirm JSONB, scored_at TIMESTAMPTZ, scorer TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (message_id, variant))`],
  ["097_create_index_v2_outcomes_open", `CREATE INDEX IF NOT EXISTS v2_outcomes_open ON v2_outcomes (sent_at) WHERE scored_at IS NULL`],
  ["098_create_index_v2_outcomes_scored", `CREATE INDEX IF NOT EXISTS v2_outcomes_scored ON v2_outcomes (scored_at)`],
  // lib/v2/loop/truth.ts: the company's name, for telling the test company apart by name (testData.ts).
  ["099_alter_table_onsinch_contacts", `ALTER TABLE onsinch_contacts ADD COLUMN IF NOT EXISTS company_name TEXT`],
  ["100_create_table_onsinch_places", `CREATE TABLE IF NOT EXISTS onsinch_places (id INTEGER PRIMARY KEY, name TEXT, refreshed_at TIMESTAMPTZ NOT NULL)`],
  // lib/v2/loop/actions.ts: an order staff touched, as last read, for its client and days.
  ["101_create_table_onsinch_orders", `CREATE TABLE IF NOT EXISTS onsinch_orders (order_id BIGINT PRIMARY KEY, number TEXT, company_id INTEGER, body JSONB, read_at TIMESTAMPTZ NOT NULL)`],
  // lib/v2/loop/actions.ts: one row per staff action (one person's changes to one order, no 30-minute gap).
  ["102_create_table_v2_staff_actions", `CREATE TABLE IF NOT EXISTS v2_staff_actions (
    order_id BIGINT NOT NULL, by INTEGER NOT NULL, first_id BIGINT NOT NULL, first_at TIMESTAMPTZ NOT NULL, last_at TIMESTAMPTZ NOT NULL,
    rows INTEGER NOT NULL, what JSONB, moved_start JSONB, acts JSONB, number TEXT, company_id INTEGER, days JSONB, bucket TEXT,
    message_id TEXT, exception JSONB, recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), classified_at TIMESTAMPTZ,
    PRIMARY KEY (order_id, by, first_id))`],
  ["103_create_index_v2_staff_actions_open", `CREATE INDEX IF NOT EXISTS v2_staff_actions_open ON v2_staff_actions (first_at) WHERE classified_at IS NULL`],
  // lib/v2/loop/cards.ts: each need the TV showed, and how it left.
  ["104_create_table_v2_card_exits", `CREATE TABLE IF NOT EXISTS v2_card_exits (
    item_key TEXT PRIMARY KEY, thread_id TEXT NOT NULL, kind TEXT, days JSONB, opened_at TIMESTAMPTZ, last_seen_at TIMESTAMPTZ,
    exit TEXT, exit_by TEXT, exit_at TIMESTAMPTZ)`],
  // lib/v2/loop/truth.ts refreshOrders: OnSinch logs no delete for an order and drops its create row, so a deleted
  // order is known only by OnSinch no longer holding it.
  ["105_alter_table_onsinch_orders", `ALTER TABLE onsinch_orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`],
];

/**
 * A statement given as text. The pinned driver (@neondatabase/serverless 0.10) has no `.query` and takes
 * the call form sql(text, params); 1.x refuses the call form and has `.query`. Both are served, so a
 * driver upgrade cannot silently break every store's first query.
 */
function run(sql: NeonQueryFunction<false, false>, text: string, params: unknown[] = []): Promise<unknown> {
  const q = sql as unknown as { query?: (t: string, p: unknown[]) => Promise<unknown> } & ((t: string, p: unknown[]) => Promise<unknown>);
  return typeof q.query === "function" ? q.query(text, params) : q(text, params);
}

/** Runs every migration this database has not recorded, in order. Returns the ids it ran. */
export async function migrate(sql: NeonQueryFunction<false, false>): Promise<string[]> {
  await run(sql, "CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = new Set(((await run(sql, "SELECT id FROM schema_migrations")) as Array<{ id: string }>).map((r) => r.id));
  const ran: string[] = [];
  for (const [id, statement] of MIGRATIONS) {
    if (done.has(id)) continue;
    await run(sql, statement);
    await run(sql, "INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
    ran.push(id);
  }
  return ran;
}

const ready = new WeakMap<object, Promise<string[]>>();
/**
 * migrate() once per connection in this process: what each store calls before its first query. A
 * failure is not remembered, so the next call tries again rather than every later query failing.
 */
export function ensureSchema(sql: NeonQueryFunction<false, false>): Promise<string[]> {
  let p = ready.get(sql);
  if (!p) {
    p = migrate(sql).catch((e) => { ready.delete(sql); throw e; });
    ready.set(sql, p);
  }
  return p;
}
