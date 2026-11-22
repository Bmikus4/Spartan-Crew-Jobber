// The one record of what broke: every failure the system reports is counted in error_reports.
//
// WHY IT EXISTS
// Eleven console.error sites in the pipeline and deps wrote to Vercel's logs, which nobody
// opens. On 2026-08-26 the Gmail credential expired and the intake failed every five minutes
// for 42 hours; every dashboard looked healthy and nobody knew until someone looked directly.
//
// IT SENDS NOTHING (Stop 2 deletion D6, 22 Nov). It used to email through an n8n webhook: the owner
// switched error email off on 4 Nov and the webhook was later deleted, so the sending half could only
// fail. The alarm that replaces it is O48, one email to the owner when the app or intake goes quiet,
// raised from the heartbeat and not from here. A report is a row, never a message to a person.
//
// One row per fingerprint, counted, so a route failing on every request is one row, not thousands.
//
// Rules pinned by test/errorReport.ts.

/**
 * The kinds of failure, by what they MEAN to the person reading them rather than by where they
 * were thrown.
 *
 *   booking-lost        the client asked for crew and there is none. A create or amendment
 *                       failed outright.
 *   write-unconfirmed   we wrote and cannot prove it landed — verifyCreate's verdict.
 *   engine-threw        an unhandled exception escaped handleThread.
 *   intake-quiet        nothing has reached the engine for too long.
 *
 * `intake-quiet` CANNOT COME FROM THE ENGINE, and that is the whole point: an engine that is
 * not running cannot report that it is not running. It is asked from outside on a schedule —
 * see app/api/health/intake. The other three are the engine reporting on itself.
 */
export type Route = "booking-lost" | "write-unconfirmed" | "engine-threw" | "intake-quiet" | "mail-undeliverable" | "mail-pull-failed" | "label-failed" | "help-report" | "system-failed" | "heartbeat" | "settings-changed" | "ladder-rollback";

// Substrings that change on every occurrence. If these reached the fingerprint, each repeat
// would be a new row and a route failing on every request would bury every other one.
const VOLATILE: [RegExp, string][] = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
  [/\b\d{4}-\d{2}-\d{2}t[\d:.]+z?\b/gi, "<ts>"],
  [/\b\d+\s*ms\b/gi, "<ms>"],
  [/\b[a-z0-9_-]{16,}\b/gi, "<id>"],
  [/\b\d{4,}\b/g, "<n>"],
];

/**
 * A stable key for "the same error again".
 *
 * Short numbers are deliberately KEPT: an HTTP status is the difference between an expired
 * credential and a broken server, and collapsing 401 with 500 would hide one behind the other.
 */
export function fingerprint(where: string, what: string): string {
  let norm = String(what ?? "").toLowerCase();
  for (const [re, sub] of VOLATILE) norm = norm.replace(re, sub);
  norm = norm.replace(/[^a-z0-9<>]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  // A short non-cryptographic digest bounds the key when the message is long. `where` is kept
  // verbatim rather than folded into the hash so a collision can only ever merge two
  // unrelated errors in the SAME place, never across places.
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  const digest = (h >>> 0).toString(36);

  const place = String(where ?? "").toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").slice(0, 28);
  return `${place}:${digest}`;
}

export interface Occurrence {
  fingerprint: string;
  where: string;
  what: string;
  detail?: string;
  deploySha: string | null;
  now: number;
}

/** Where occurrences are counted. An interface so the counting is testable without a database. */
export interface ErrorStore {
  record(o: Occurrence): Promise<void>;
}

export class InMemoryErrorStore implements ErrorStore {
  readonly rows = new Map<string, { count: number; firstSeenAt: string }>();
  async record(o: Occurrence) {
    const row = this.rows.get(o.fingerprint);
    if (row) row.count += 1;
    else this.rows.set(o.fingerprint, { count: 1, firstSeenAt: new Date(o.now).toISOString() });
  }
}

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { after } from "next/server";
import { ensureSchema } from "./migrations";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await ensureSchema(sql);
  _ready = true;
}

/** The durable store, or null when no connection string is configured. */
export function neonErrorStore(): ErrorStore | null {
  if (!_sql) {
    const url = connString();
    if (!url) return null;
    _sql = neon(url);
  }
  const sql = _sql;
  return {
    async record(o: Occurrence) {
      await ensure(sql);
      await sql`
        INSERT INTO error_reports (fingerprint, where_at, what, last_detail, deploy_sha)
        VALUES (${o.fingerprint}, ${o.where}, ${o.what}, ${o.detail ?? null}, ${o.deploySha})
        ON CONFLICT (fingerprint) DO UPDATE SET
          last_seen_at = now(),
          occurrences  = error_reports.occurrences + 1,
          last_detail  = COALESCE(${o.detail ?? null}, error_reports.last_detail),
          deploy_sha   = ${o.deploySha}`;
    },
  };
}

/**
 * Keeps the lambda alive until the row is written. Every caller writes `void reportError()` and
 * returns its response; on Vercel the function is then frozen and an unawaited write dies with it
 * (the 29 "fetch failed" lines of 1-3 Oct). Outside a request (a script, a test) after() throws,
 * and the promise simply runs to completion.
 */
function keepAlive(p: Promise<unknown>): void {
  try { after(p); } catch { /* not in a request scope */ }
}

/**
 * Record a failure. NEVER THROWS and never blocks the caller's own error handling: a reporting
 * failure must not turn a handled error into an unhandled one, and must never be the reason a
 * booking fails. Call it with `void`. Resolves to whether the occurrence was recorded.
 */
export function reportError(args: ReportArgs): Promise<boolean> {
  const p = reportNow(args);
  (args.keepAlive ?? keepAlive)(p);
  return p;
}

type ReportArgs = {
  route: Route;
  where: string;
  what: string;
  detail?: string;
  /** Injected by tests. Production uses the Neon-backed store. */
  store?: ErrorStore;
  now?: () => number;
  /** Injected by tests. Production hands the pending write to Next's after(). */
  keepAlive?: (p: Promise<unknown>) => void;
};

async function reportNow({ route, where, what, detail, store, now }: ReportArgs): Promise<boolean> {
  try {
    const fp = fingerprint(where, what);
    const sink = store ?? neonErrorStore();
    if (!sink) {
      console.error(`[error-report] ${fp} (no store) ${route} ${where}: ${what}`);
      return false;
    }
    await sink.record({ fingerprint: fp, where, what, detail, deploySha: process.env.VERCEL_GIT_COMMIT_SHA || null, now: (now ?? Date.now)() });
    return true;
  } catch (err) {
    // The last line of defence: reporting must never be the thing that breaks a booking.
    console.error("[error-report] reporter itself failed", err);
    return false;
  }
}
