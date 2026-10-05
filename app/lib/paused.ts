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

export function automationPaused(pathname: string, flag: string | undefined = process.env.SPARTAN_PAUSED): boolean {
  if ((flag || "").trim() !== "1") return false;
  return AUTOMATION_ROUTES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
