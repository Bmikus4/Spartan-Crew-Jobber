/**
 * SPARTAN_PAUSED=1 stops every route through which the engine acts without a person:
 * intake, the dedupe claim, the sweeps and the mail hooks. They answer 503 before any
 * auth or engine code runs, so nothing is read, written, drafted or labelled. Under v2,
 * intake and its dedupe claim stay open and store without deciding (automationPaused).
 *
 * Deliberately left open: /api/health (read-only, and the restore check reads it), the
 * login flow, and every human-driven route (the TV feed, settings), so the app stays usable
 * while the automation is off. confirm-order is human-driven but the old engine's: see below. Deactivating the n8n workflows alone does
 * not pause the engine: anything still holding the webhook secret could drive it.
 */
export const AUTOMATION_ROUTES = ["/api/n8n-inbound", "/api/mail-inbound", "/api/mail-poll", "/api/dedupe", "/api/sweep-ingest", "/api/reconcile"];

/**
 * SPARTAN_ENGINE=v2: the rebuild decides on what the n8n intake captures, and the old
 * engine's own routes stay shut. Intake and its dedupe claim are the only automation the
 * rebuild shares with the old engine, so they are the only ones that open. Without this,
 * lifting SPARTAN_PAUSED would hand the sweeps and the mail hooks back to the old engine.
 *
 * /api/confirm-order is shut with them although a person drives it. It runs the old executor
 * (create, amend in place, delete and re-post) and never reads bot_writes_enabled or
 * SPARTAN_WRITES, so while it answered, one click on a stale `proposed` ticket (16 of them, the
 * newest from 10-07, 12 on live orders) could change an order the owner believed nothing could
 * touch (audit/system-audit-2026-10-26.md §1).
 */
export const OLD_ENGINE_ROUTES = [...AUTOMATION_ROUTES.filter((p) => p !== "/api/n8n-inbound" && p !== "/api/dedupe"), "/api/confirm-order"];

export function v2Engine(flag: string | undefined = process.env.SPARTAN_ENGINE): boolean {
  return (flag || "").trim().toLowerCase() === "v2";
}

/**
 * SPARTAN_WRITES=live (under SPARTAN_ENGINE=v2): the bot carries out the rebuild's decisions
 * in OnSinch, for any client. Unset, it decides and records only (shadow) and the bot writes
 * on TEST 515 alone. It turns writes off without stopping intake; SPARTAN_PAUSED=1 still
 * stops everything.
 */
export function v2Writes(flag: string | undefined = process.env.SPARTAN_WRITES, engine: string | undefined = process.env.SPARTAN_ENGINE): boolean {
  return v2Engine(engine) && (flag || "").trim().toLowerCase() === "live";
}

/**
 * SPARTAN_PAUSED=1, read where the automation acts as well as at the routes above: /api/bot/*
 * is not among them (middleware skips it to reach each route's own machine gate), so until
 * 10-23 the minute sync kept retrying writes, clearing test data and handing labels out while
 * paused (addendum F3). retryStopped, maybeSweep, sweepUndecided and the labels route check it.
 */
export function automationPausedFlag(flag: string | undefined = process.env.SPARTAN_PAUSED): boolean {
  return (flag || "").trim() === "1";
}

/**
 * UNDER V2 A PAUSE NEVER SHUTS INTAKE OR ITS DEDUPE CLAIM (addendum F31). Shut at the door, the
 * 10-21 pause left 40 client emails unstored, beyond intake's 72 h catch-up. Intake stores
 * what arrives while paused and marks it store-only (n8nInbound.ts), so nothing decides it, then
 * or after (the owner's store-only ruling, decisions/2026-10-25-pause-window-store-only.md). [DECISIONS O3]
 */
export function automationPaused(pathname: string, flag: string | undefined = process.env.SPARTAN_PAUSED, engine: string | undefined = process.env.SPARTAN_ENGINE): boolean {
  const shut = v2Engine(engine) ? OLD_ENGINE_ROUTES : automationPausedFlag(flag) ? AUTOMATION_ROUTES : [];
  return shut.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
