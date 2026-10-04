// The /api/health/intake handler after its auth gate, IO injected for tests (SP-50). Why the
// route exists and who calls it: app/api/health/intake/route.ts.

import { lastInboundAt } from "../inboundRawDb";
import { intakeHealth, DEFAULT_QUIET_MINUTES } from "../intakeHealth";
import { reportError } from "../errorReport";

export interface IntakeHealthIO {
  lastInboundAt: () => Promise<number | null>;
  now: () => number;
  report: typeof reportError;
}

export const productionIntakeHealthIO: IntakeHealthIO = { lastInboundAt, now: Date.now, report: reportError };

export async function handleIntakeHealth(request: Request, io: IntakeHealthIO = productionIntakeHealthIO): Promise<Response> {
  const url = new URL(request.url);
  const quietMinutes = Math.min(
    24 * 60,
    Math.max(5, parseInt(url.searchParams.get("quiet_minutes") || "", 10) || DEFAULT_QUIET_MINUTES),
  );

  const health = intakeHealth({ lastReceivedAt: await io.lastInboundAt(), now: io.now(), quietMinutes });

  if (health.stale) {
    // `where` is constant so every silence in a run shares one fingerprint and collapses into
    // one email per window, however often the schedule asks. The changing minute count lives in
    // `detail`, which is not fingerprinted.
    void io.report({
      route: "intake-quiet",
      where: "health/intake",
      what: health.minutes_since == null ? "no inbound has ever been recorded" : "the intake has gone quiet during working hours",
      detail: `${health.what}. Last inbound: ${health.last_received_at ?? "never"}. Threshold: ${quietMinutes} minutes.`,
    });
  }

  // 200 whatever the verdict: a non-200 here would mean "the check failed", which is a
  // different thing from "the check ran and the answer is bad", and n8n has to tell them apart.
  // replace_path: whether delete-and-repost can run. The kill switch is stored as a sensitive
  // value and cannot be read back from Vercel; this says which way it is set, never the value.
  return Response.json({ ...health, replace_path: process.env.SPARTAN_BLOCK_ORDER_REPLACE === "1" ? "blocked" : "armed" });
}
