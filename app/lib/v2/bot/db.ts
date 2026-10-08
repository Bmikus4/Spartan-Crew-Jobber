// ============================================================================
// The bot's own tables. It writes nothing else in the database; the frozen engine's tables
// are read-only to the rebuild.
//
//   bot_session  one row: the browser's storage state, AES-256-GCM under BOT_SESSION_KEY.
//                The OnSinch session cookie lives 24h; keeping it saves a login per run.
//   bot_lease    one row: who may drive OnSinch right now. A LEASE, not an advisory lock:
//                the Neon HTTP driver gives every query its own connection, so a session
//                lock would be released the moment it was taken.
//   bot_ledger   one row per operation key. Intent is written BEFORE the submit, so a crash
//                between submit and read-back leaves a row that says "sent, outcome
//                unknown" rather than nothing. An unknown outcome is never retried by the
//                bot; it is reconciled by reading OnSinch, or handed to ops.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function need(): NeonQueryFunction<false, false> {
  if (_sql) return _sql;
  const url = (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
  if (!url) throw new Error("no database configured");
  _sql = neon(url);
  return _sql;
}

async function ready(): Promise<NeonQueryFunction<false, false>> {
  const sql = need();
  if (_ready) return sql;
  await sql`CREATE TABLE IF NOT EXISTS bot_session (id INT PRIMARY KEY, state TEXT NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  await sql`CREATE TABLE IF NOT EXISTS bot_lease (id INT PRIMARY KEY, holder TEXT, until TIMESTAMPTZ NOT NULL DEFAULT 'epoch')`;
  await sql`INSERT INTO bot_lease (id) VALUES (1) ON CONFLICT (id) DO NOTHING`;
  await sql`
    CREATE TABLE IF NOT EXISTS bot_ledger (
      op_key     TEXT PRIMARY KEY,
      source     TEXT NOT NULL,
      kind       TEXT NOT NULL,
      op         JSONB NOT NULL,
      status     TEXT NOT NULL,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  _ready = true;
  return sql;
}

// --- session state, encrypted -------------------------------------------------

function key(): Buffer {
  const k = Buffer.from((process.env.BOT_SESSION_KEY || "").trim(), "hex");
  if (k.length !== 32) throw new Error("BOT_SESSION_KEY must be 32 bytes of hex");
  return k;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function unseal(sealed: string): string {
  const [iv, tag, body] = sealed.split(".").map((s) => Buffer.from(s, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString("utf8");
}

export async function loadState(): Promise<object | null> {
  const sql = await ready();
  const rows = (await sql`SELECT state FROM bot_session WHERE id = 1`) as { state: string }[];
  if (!rows.length) return null;
  try { return JSON.parse(unseal(rows[0].state)); } catch { return null; }
}

export async function saveState(state: object): Promise<void> {
  const sql = await ready();
  const s = seal(JSON.stringify(state));
  await sql`INSERT INTO bot_session (id, state) VALUES (1, ${s}) ON CONFLICT (id) DO UPDATE SET state = ${s}, saved_at = now()`;
}

export async function clearState(): Promise<void> {
  const sql = await ready();
  await sql`DELETE FROM bot_session WHERE id = 1`;
}

// --- the lease ------------------------------------------------------------------

export async function acquireLease(holder: string, seconds: number): Promise<boolean> {
  const sql = await ready();
  const rows = await sql`
    UPDATE bot_lease SET holder = ${holder}, until = now() + make_interval(secs => ${seconds})
    WHERE id = 1 AND (until < now() OR holder = ${holder}) RETURNING holder`;
  return rows.length === 1;
}

export async function releaseLease(holder: string): Promise<void> {
  const sql = await ready();
  await sql`UPDATE bot_lease SET until = 'epoch' WHERE id = 1 AND holder = ${holder}`;
}

// --- the ledger -------------------------------------------------------------------

export type LedgerStatus =
  | "intent"          // written before the browser touched anything
  | "blocked"         // a contract or guard refused; nothing was sent
  | "submitted"       // OnSinch answered success; not yet read back
  | "unknown"         // sent, and the answer was lost or unreadable: never retried
  | "verified"        // read back and matching
  | "mismatch"        // read back and NOT matching: ops
  | "failed";         // OnSinch refused (validation); nothing changed

export type LedgerRow = { op_key: string; source: string; kind: string; op: unknown; status: LedgerStatus; detail: Record<string, unknown> | null };

export async function ledgerGet(op_key: string): Promise<LedgerRow | null> {
  const sql = await ready();
  const rows = (await sql`SELECT op_key, source, kind, op, status, detail FROM bot_ledger WHERE op_key = ${op_key}`) as LedgerRow[];
  return rows[0] ?? null;
}

/** Inserts the intent row; false when the key already exists (the operation was seen before). */
export async function ledgerIntent(op_key: string, source: string, kind: string, op: unknown): Promise<boolean> {
  const sql = await ready();
  const rows = await sql`
    INSERT INTO bot_ledger (op_key, source, kind, op, status) VALUES (${op_key}, ${source}, ${kind}, ${JSON.stringify(op)}::jsonb, 'intent')
    ON CONFLICT (op_key) DO NOTHING RETURNING op_key`;
  return rows.length === 1;
}

export async function ledgerSet(op_key: string, status: LedgerStatus, detail: Record<string, unknown>): Promise<void> {
  const sql = await ready();
  await sql`
    UPDATE bot_ledger SET status = ${status}, detail = coalesce(detail, '{}'::jsonb) || ${JSON.stringify(detail)}::jsonb, updated_at = now()
    WHERE op_key = ${op_key}`;
}
