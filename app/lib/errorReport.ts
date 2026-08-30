// The one way Spartan tells a human something broke.
//
// WHY IT EXISTS
// Eleven console.error sites in the pipeline and deps wrote to Vercel's logs, which nobody
// opens. On 2026-08-26 the Gmail credential expired and the intake failed every five minutes
// for 42 hours; every dashboard looked healthy and nobody knew until someone looked directly.
//
// THE TWO FAILURE MODES PULL OPPOSITE WAYS. Stay quiet and a dead route loses bookings for a
// week unnoticed. Email every occurrence and a route failing on every request sends hundreds,
// after which the sender is filtered and the channel is worse than useless — it looks alive
// while reaching nobody. So: the first sighting emails, repeats inside a window collapse into a
// count, and the count travels with the next email so the reader can judge severity.
//
// EVERY OCCURRENCE IS RECORDED EVEN WHEN NO EMAIL IS SENT. That is the property that makes
// suppression safe: an empty inbox has to mean an empty system, not a suppressed one.
//
// Ported from D:\Code\HoH-Quote-Tool-GH\app\lib\errorReport.ts rather than designed a second
// time — two error paths is two things to keep working. What changed for Spartan: the four
// named routes below, its own notify gate (Spartan has no dataCollection module), and a store
// interface so the counting is testable without a database.
//
// Rules pinned by test/errorReport.ts.

export type Severity = "alert" | "log";

/**
 * The four things worth waking someone for, distinguished by what they MEAN to the person
 * reading them rather than by where they were thrown.
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
export type Route = "booking-lost" | "write-unconfirmed" | "engine-threw" | "intake-quiet";

const ROUTE_TITLE: Record<Route, string> = {
  "booking-lost": "A BOOKING WAS LOST",
  "write-unconfirmed": "A WRITE COULD NOT BE CONFIRMED",
  "engine-threw": "THE ENGINE THREW",
  "intake-quiet": "THE INTAKE WENT QUIET",
};

/** Default gap between emails about the same thing. Long enough to stop a flood, short enough
 *  that an unfixed problem resurfaces the same working day. */
export const DEFAULT_WINDOW_MS = 6 * 3600_000;

// Substrings that change on every occurrence. If these reached the fingerprint, each repeat
// would look like a new problem and the suppression window would never apply — the exact
// failure this normalisation exists to prevent.
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
 * credential and a broken server, and collapsing 401 with 500 would hide one behind the other
 * for six hours.
 */
export function fingerprint(where: string, what: string): string {
  let norm = String(what ?? "").toLowerCase();
  for (const [re, sub] of VOLATILE) norm = norm.replace(re, sub);
  norm = norm.replace(/[^a-z0-9<>]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);

  // A short non-cryptographic digest bounds the key when the message is long. `where` is kept
  // verbatim rather than folded into the hash so a collision can only ever over-suppress two
  // unrelated errors in the SAME place, never across places.
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  const digest = (h >>> 0).toString(36);

  const place = String(where ?? "").toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").slice(0, 28);
  return `${place}:${digest}`;
}

/**
 * Whether to email now, given when this fingerprint was last emailed.
 *
 * A lastEmailedAt in the FUTURE suppresses rather than emails: serverless instances disagree
 * about the clock, and the safe direction for a disagreement is quiet, not a flood.
 */
export function shouldEmail(
  { lastEmailedAt, now, windowMs = DEFAULT_WINDOW_MS }:
  { lastEmailedAt: number | null; now: number; windowMs?: number },
): boolean {
  if (lastEmailedAt == null) return true;
  return now - lastEmailedAt >= windowMs;
}

/** Plain text: the n8n Gmail node renders this template verbatim, so no markup. */
export function errorEmailText(
  { route, where, what, detail, count, firstSeenAt }:
  { route: Route; where: string; what: string; detail?: string; count: number; firstSeenAt: string },
): string {
  const lines = [
    `Automated error report from the Spartan Crew booking engine. No reply is read.`,
    "",
    ROUTE_TITLE[route],
    "",
    `Where: ${where}`,
    `What:  ${what}`,
  ];

  if (count > 1) {
    lines.push(
      "",
      `Seen ${count} times, first at ${firstSeenAt}.`,
      "Repeats are collapsed to one email per problem per 6 hours, so that is a running total",
      "rather than one message per occurrence.",
    );
  } else {
    lines.push("", `First seen at ${firstSeenAt}. This is the first occurrence.`);
  }

  if (detail && detail.trim()) lines.push("", "Detail:", detail.trim().slice(0, 2000));

  lines.push(
    "",
    "Every occurrence is recorded whether or not it emails, so no news here genuinely means",
    "nothing is failing rather than that the reporter itself is broken.",
  );
  return lines.join("\n");
}

/**
 * NO WEBHOOK-CAPABLE ENVIRONMENT MEANS NO EMAIL. A preview deployment and a local run have no
 * business emailing anyone: in HoH, local test runs sent 17 real emails before this gate
 * existed. `SPARTAN_ERROR_NOTIFY=1` is the deliberate override for verifying the channel by
 * hand — one env var, typed on purpose, rather than a default that has to be remembered.
 *
 * The gate is about the CHANNEL, not the count: a blocked report is still recorded.
 */
export function notifyAllowed(): boolean {
  if ((process.env.SPARTAN_ERROR_NOTIFY || "").trim() === "1") return true;
  return !!(process.env.VERCEL || "").trim();
}

// --- counting -----------------------------------------------------------------------------

export interface Occurrence {
  fingerprint: string;
  where: string;
  what: string;
  detail?: string;
  deploySha: string | null;
  now: number;
}

/**
 * Where occurrences are counted and email slots are claimed.
 *
 * Split from reportError so the rules above can be pinned without a database — and because the
 * atomic claim is the one part that MUST be a single statement in Postgres and cannot be
 * verified by reading.
 */
export interface ErrorStore {
  /** Count this occurrence. Returns the running total and when it was first seen. */
  record(o: Occurrence): Promise<{ count: number; firstSeenAt: string }>;
  /** Claim the right to email about this fingerprint. True for exactly one caller per window. */
  claimEmail(fingerprint: string, windowMs: number, now: number): Promise<boolean>;
}

export class InMemoryErrorStore implements ErrorStore {
  readonly rows = new Map<string, { count: number; firstSeenAt: string; lastEmailedAt: number | null }>();

  async record(o: Occurrence) {
    const row = this.rows.get(o.fingerprint);
    if (!row) {
      const fresh = { count: 1, firstSeenAt: new Date(o.now).toISOString(), lastEmailedAt: null };
      this.rows.set(o.fingerprint, fresh);
      return { count: 1, firstSeenAt: fresh.firstSeenAt };
    }
    row.count += 1;
    return { count: row.count, firstSeenAt: row.firstSeenAt };
  }

  async claimEmail(fp: string, windowMs: number, now: number) {
    const row = this.rows.get(fp);
    if (!row) return false;
    if (!shouldEmail({ lastEmailedAt: row.lastEmailedAt, now, windowMs })) return false;
    row.lastEmailedAt = now;
    return true;
  }
}

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS error_reports (
      fingerprint      TEXT PRIMARY KEY,
      where_at         TEXT NOT NULL,
      what             TEXT NOT NULL,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      occurrences      BIGINT NOT NULL DEFAULT 1,
      last_emailed_at  TIMESTAMPTZ,
      last_detail      TEXT,
      deploy_sha       TEXT
    )`;
  await sql`CREATE INDEX IF NOT EXISTS error_reports_last_seen ON error_reports (last_seen_at DESC)`;
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
      const rows = (await sql`
        INSERT INTO error_reports (fingerprint, where_at, what, last_detail, deploy_sha)
        VALUES (${o.fingerprint}, ${o.where}, ${o.what}, ${o.detail ?? null}, ${o.deploySha})
        ON CONFLICT (fingerprint) DO UPDATE SET
          last_seen_at = now(),
          occurrences  = error_reports.occurrences + 1,
          last_detail  = COALESCE(${o.detail ?? null}, error_reports.last_detail),
          deploy_sha   = ${o.deploySha}
        RETURNING occurrences, first_seen_at
      `) as { occurrences: number | string; first_seen_at: string | Date }[];
      return {
        count: Number(rows[0]?.occurrences ?? 1),
        firstSeenAt: new Date(rows[0]?.first_seen_at ?? o.now).toISOString(),
      };
    },

    // CLAIM the email slot atomically. Rows come back only if this statement is the one that
    // moved last_emailed_at, so exactly one caller emails per window however many lambdas
    // arrive together. A concurrent identical UPDATE blocks on the row lock, re-checks the
    // WHERE against the committed new value, and matches nothing — which is why this is a
    // conditional UPDATE rather than a read-then-write.
    async claimEmail(fp: string, windowMs: number) {
      await ensure(sql);
      const claim = (await sql`
        UPDATE error_reports SET last_emailed_at = now()
        WHERE fingerprint = ${fp}
          AND (last_emailed_at IS NULL
               OR now() - last_emailed_at >= ${`${Math.round(windowMs / 1000)} seconds`}::interval)
        RETURNING fingerprint
      `) as { fingerprint: string }[];
      return claim.length > 0;
    },
  };
}

// Fallback when no store is available. Per warm instance only, which is the point: it bounds a
// flood to one email per fingerprint per instance instead of one per request, without losing
// the first sighting entirely.
const _seenInProcess = new Set<string>();

// --- sending ------------------------------------------------------------------------------

/**
 * The live n8n "Send Support Tickets" workflow, which emails ben@ and
 * samuraisolutionsofficial@. Chosen because it is already live, already proven and needs no new
 * workflow — the same reason HoH's reporter uses it.
 */
const DEFAULT_WEBHOOK = "https://samuraisolutions.app.n8n.cloud/webhook/support-ticket";

/**
 * A 200 WITH AN EMPTY BODY IS A FAILURE, not a delivery. n8n answers 200 when the workflow
 * throws, which is exactly what a rejected secret produces — the same trap postTag() documents
 * in deps.ts. Reporting that as sent would mark the window claimed for six hours on an email
 * nobody received.
 */
async function post(body: Record<string, unknown>): Promise<boolean> {
  const url = (process.env.ERROR_REPORT_WEBHOOK ?? DEFAULT_WEBHOOK).trim();
  if (!url) return false;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return false;
  const j = (await res.json().catch(() => null)) as unknown;
  return j !== null && typeof j === "object";
}

/**
 * Report a failure a human needs to know about.
 *
 * NEVER THROWS and never blocks the caller's own error handling — a reporting failure must not
 * turn a handled error into an unhandled one, and must never be the reason a booking fails.
 * Always call it with `void`. Returns whether an email was sent, which callers may ignore.
 *
 * `severity: "log"` records the occurrence and never emails: worth counting, not worth
 * interrupting anyone over.
 */
export async function reportError(
  { route, where, what, detail, severity = "alert", windowMs = DEFAULT_WINDOW_MS, store, now }:
  {
    route: Route;
    where: string;
    what: string;
    detail?: string;
    severity?: Severity;
    windowMs?: number;
    /** Injected by tests. Production uses the Neon-backed store. */
    store?: ErrorStore;
    now?: () => number;
  },
): Promise<boolean> {
  try {
    const fp = fingerprint(where, what);
    const at = (now ?? Date.now)();
    const deploySha = process.env.VERCEL_GIT_COMMIT_SHA || null;
    const sink = store ?? neonErrorStore();

    let count = 1;
    let firstSeenAt = new Date(at).toISOString();
    let emailNow: boolean;

    if (!sink) {
      emailNow = severity === "alert" && notifyAllowed() && !_seenInProcess.has(fp);
      if (emailNow) _seenInProcess.add(fp);
      console.error(`[error-report] ${fp} (no store) ${where}: ${what}`);
    } else {
      // Step 1: always count. No email decision here — this is the half that makes silence
      // trustworthy, so it happens before anything that can decide not to send.
      const rec = await sink.record({ fingerprint: fp, where, what, detail, deploySha, now: at });
      count = rec.count;
      firstSeenAt = rec.firstSeenAt;

      // THE GATE COMES BEFORE THE CLAIM, and the order is the whole point. There is no
      // separate development database — a local run writes to production — so claiming the
      // slot first would let `npx tsx test/all.ts` mark the real fingerprint emailed and
      // suppress the real alert for six hours without ever sending anything.
      if (severity === "alert" && !notifyAllowed()) {
        // Logged rather than swallowed: a suppressed notification that leaves no trace is how
        // you end up believing a channel works when it is dead.
        console.error(`[error-report] not sent (not a deployment; set SPARTAN_ERROR_NOTIFY=1): ${where}: ${what}`);
        return false;
      }
      emailNow = severity === "alert" && (await sink.claimEmail(fp, windowMs, at));
    }

    if (!emailNow) return false;

    return await post({
      record_id: fp,
      user_name: `Spartan error report (automated) - ${route}`,
      user_email: "error-report@spartancrew",
      ts: new Date(at).toISOString(),
      route: where,
      deploy_sha: deploySha,
      ticket_text: errorEmailText({ route, where, what, detail, count, firstSeenAt }),
      transcript: `Automated error report. Fingerprint ${fp}. Repeats within ${Math.round(windowMs / 3600_000)} hours are counted, not re-sent.`,
    });
  } catch (err) {
    // The last line of defence: reporting must never be the thing that breaks a booking.
    console.error("[error-report] reporter itself failed", err);
    return false;
  }
}
