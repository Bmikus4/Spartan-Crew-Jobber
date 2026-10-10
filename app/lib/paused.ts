/**
 * SPARTAN_PAUSED=1 stops every route through which the engine acts without a person:
 * intake, the dedupe claim, the sweeps and the mail hooks. They answer 503 before any
 * auth or engine code runs, so nothing is read, written, drafted or labelled.
 *
 * Deliberately left open: /api/health (read-only, and the restore check reads it), the
 * login flow, and every human-driven route (the TV feed, confirm-order, settings), so the
 * app stays usable while the automation is off. Deactivating the n8n workflows alone does
 * not pause the engine: anything still holding the webhook secret could drive it.
 */
export const AUTOMATION_ROUTES = ["/api/n8n-inbound", "/api/mail-inbound", "/api/mail-poll", "/api/dedupe", "/api/sweep-ingest", "/api/reconcile"];

/**
 * SPARTAN_ENGINE=v2: the rebuild decides on what the n8n intake captures, and the old
 * engine's own routes stay shut. Intake and its dedupe claim are the only automation the
 * rebuild shares with the old engine, so they are the only ones that open. Without this,
 * lifting SPARTAN_PAUSED would hand the sweeps and the mail hooks back to the old engine.
 */
export const OLD_ENGINE_ROUTES = AUTOMATION_ROUTES.filter((p) => p !== "/api/n8n-inbound" && p !== "/api/dedupe");

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

export function automationPaused(pathname: string, flag: string | undefined = process.env.SPARTAN_PAUSED, engine: string | undefined = process.env.SPARTAN_ENGINE): boolean {
  const shut = (flag || "").trim() === "1" ? AUTOMATION_ROUTES : v2Engine(engine) ? OLD_ENGINE_ROUTES : [];
  return shut.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
