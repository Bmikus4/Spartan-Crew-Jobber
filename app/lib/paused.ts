/**
 * Two switches over the engine's automatic routes.
 *
 * SPARTAN_PAUSED=1 stops every route through which the engine acts without a person:
 * intake, the dedupe claim, the sweeps and the mail hooks. They answer 503 before any
 * auth or engine code runs, so nothing is read, written, drafted or labelled.
 *
 * SPARTAN_SIMULATE=1 keeps intake running and makes the engine write nothing outside its
 * own database (deps.ts and handleThread read `simulating()`). Only the routes that exist
 * to change real orders or the mailbox stop: the sweeps and the mail hooks, which are not
 * the live intake. n8n-inbound and dedupe stay open, because a simulation that reads no
 * mail measures nothing.
 *
 * Deliberately left open under both: /api/health (read-only, and the restore check reads
 * it), the login flow, and every human-driven route (the TV feed, confirm-order,
 * settings), so the app stays usable. Deactivating the n8n workflows alone does not pause
 * the engine: anything still holding the webhook secret could drive it.
 */
export const AUTOMATION_ROUTES = ["/api/n8n-inbound", "/api/mail-inbound", "/api/mail-poll", "/api/dedupe", "/api/sweep-ingest", "/api/reconcile"];
const INTAKE_ROUTES = new Set(["/api/n8n-inbound", "/api/dedupe"]);

const on = (flag: string | undefined) => (flag || "").trim() === "1";

export function simulating(flag: string | undefined = process.env.SPARTAN_SIMULATE): boolean {
  return on(flag);
}

export function automationPaused(
  pathname: string,
  flag: string | undefined = process.env.SPARTAN_PAUSED,
  simulate: string | undefined = process.env.SPARTAN_SIMULATE,
): boolean {
  const route = AUTOMATION_ROUTES.find((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!route) return false;
  if (on(flag)) return true;
  return on(simulate) && !INTAKE_ROUTES.has(route);
}
