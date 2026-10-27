// ============================================================================
// WHICH INTAKE DECIDES.
// ----------------------------------------------------------------------------
// Two intakes read the one mailbox: n8n's Gmail trigger posts each thread to /api/n8n-inbound,
// and /api/mail-poll pulls it with the Gmail API (dormant until the domain-wide grant, addendum
// R14). Both store a message under Gmail's own ids (test/oneConversationOneThreadId.ts), so
// whichever stores first holds it and the other finds it held. Both always store. Only one
// DECIDES: two deciders would race on one message, a model call each and a write each that only
// the op ledger would catch. test/intakePath.ts pins that, for any value at all, exactly one
// decides. Never both, never neither.
//
//   INTAKE_PATH unset or "n8n"   n8n-inbound decides; the poll only stores    (today)
//   INTAKE_PATH "routing"        the poll decides; n8n-inbound only stores    (after the grant)
//
// The flip is one variable and reverses in one edit. While paused, neither decides and each
// marks what it stored first as store-only.
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
