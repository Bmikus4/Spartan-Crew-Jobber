/**
 * THE FOLLOW-UP FEATURE IS HIDDEN UNTIL BEN SAYS OTHERWISE (2026-09-29).
 *
 * Ops are not to see it yet: the dashboard row and both /api/followups routes are off
 * unless NEXT_PUBLIC_SPARTAN_FOLLOWUPS=1. NEXT_PUBLIC because the dashboard is a client
 * component and the same switch must govern the routes; it is inlined at build, so
 * turning it on is setting the variable in Vercel and redeploying. Nothing else of the
 * feature runs on its own: the chase composer and decide() have no caller.
 * test/followupsHidden.ts pins every place it can surface.
 */
export function followupsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SPARTAN_FOLLOWUPS === "1";
}
