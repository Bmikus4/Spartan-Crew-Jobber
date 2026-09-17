// ============================================================================
// WHICH DOOR THE ENGINE LISTENS AT.
// ----------------------------------------------------------------------------
// There are two intakes and they key a message differently: /api/n8n-inbound holds
// Gmail's thread id, /api/mail-inbound rebuilds the thread from the RFC Message-ID. The
// same enquiry arriving down both is two rows, two thread ids, two conversations — and
// then two orders for one job.
//
// CREDENTIAL-DURABILITY-PLAN §3b says cut over "in one change", but the two halves live
// in different systems: the routing rule is a Google Workspace admin setting, the
// trigger is an n8n workflow. Between the two clicks the system either double-runs or
// does not run. Neither is acceptable at 16 orders a day — on 2026-09-16 three days of
// live output had to be deleted, and 25 of those 39 were already duplicated by hand.
//
// So the ordering is made irrelevant instead of being managed. This variable decides
// which route may run the engine, and test/intakePath.ts pins the property that matters:
// for any value at all, exactly one route is live. Never both, never neither.
//
// WHAT THAT BUYS, and it is the reason this exists rather than a runbook step: the
// routing rule can be switched on EARLY and left in shadow mode. Real mail arrives, gets
// stored, rebuilds real threads and feeds the intake watchdog — and runs nothing. You
// watch it agree with the live path for as long as you want to, and only then flip. The
// flip is one variable, it is atomic, there is no window, and it reverses in one edit.
//
//   INTAKE_PATH unset or "n8n"   the n8n Gmail trigger runs the engine   (today)
//   INTAKE_PATH "routing"        /api/mail-inbound runs it, n8n is inert (after cutover)
//
// The default is deliberately TODAY'S WORLD. If the default were "routing", deploying
// this file would itself be the cutover, performed by whoever merged it.
// ============================================================================

export type IntakePath = "n8n" | "routing";

// An index signature rather than `{ INTAKE_PATH?: string }`: the latter is a weak type,
// and TypeScript refuses `process.env` against it for having no properties in common.
type Env = { readonly [key: string]: string | undefined };

/**
 * Which intake owns the engine right now.
 *
 * Anything unrecognised is the n8n path, because the two ways of being wrong are not
 * equally priced. Falling through to "routing" on a typo would double-book every enquiry
 * until someone noticed; falling through to "neither" would stop intake silently, which
 * is the failure that ran for 42 hours on 2026-08-26 with every dashboard green. Falling
 * back to the path that is already live does neither.
 */
export function activeIntake(env: Env = process.env): IntakePath {
  return String(env.INTAKE_PATH ?? "").trim().toLowerCase() === "routing" ? "routing" : "n8n";
}

/**
 * May this route run the engine on what it just received?
 *
 * A route told "no" must still STORE what it was given — that is what makes shadow mode
 * worth having, and it is what keeps the intake watchdog answering across the cutover,
 * since it reads MAX(received_at) from inbound_raw and does not care which door wrote it.
 */
export function mayRunEngine(route: IntakePath, env: Env = process.env): boolean {
  return activeIntake(env) === route;
}
