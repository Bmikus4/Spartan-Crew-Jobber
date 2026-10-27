// ============================================================================
// The heartbeat: is the automation still running? Asked by a Vercel cron every 5 minutes.
// ----------------------------------------------------------------------------
// No heartbeat for this automation runs in n8n, ever (owner, 26 Oct; DECISIONS O1). Until then
// n8n carried intake, the minute sync, labels and the watchdog itself, so when n8n stopped the
// owner heard nothing and staff saw the TV's sync dot turn red after 90 quiet minutes (addendum
// F32). Four signals, each raised to the owner on its own fingerprint:
//   intake  no mail captured during working hours (intakeHealth's own judgement)
//   lag     a client email stored more than 15 minutes ago that nothing has decided
//   sync    the minute sync has not finished for 5 minutes
//   labels  the labels have not been handed out for 10 minutes
// While the automation is paused the sweep and the labels stand still by design, so lag and
// labels are not judged; intake stays open under v2 and is.
// ============================================================================
import { intakeHealth } from "./intakeHealth";
import type { reportError } from "./errorReport";

export const LAG_MINUTES = 15;
export const SYNC_STALE_MINUTES = 5;
export const LABELS_STALE_MINUTES = 10;

export interface HeartbeatIO {
  now: () => number;
  paused: () => boolean;
  lastInboundAt: () => Promise<number | null>;
  /** When the oldest client email that nothing has decided was stored, or null. */
  oldestUndecidedAt: () => Promise<number | null>;
  /** When a run last finished (runMarks.ts): "sync" or "labels". */
  lastRun: (name: "sync" | "labels") => Promise<number | null>;
  report: typeof reportError;
}

export type Beat = { signal: "intake" | "lag" | "sync" | "labels"; stale: boolean; minutes: number | null; what: string };

const minutesSince = (now: number, at: number | null) => (at == null ? null : Math.floor((now - at) / 60_000));

export async function heartbeat(io: HeartbeatIO): Promise<{ ok: boolean; paused: boolean; beats: Beat[] }> {
  const now = io.now();
  const paused = io.paused();
  const beats: Beat[] = [];

  // A signal that cannot be read is stale: the check failing is itself something the owner must hear.
  const read = async (signal: Beat["signal"], f: () => Promise<number | null>, judge: (at: number | null) => Omit<Beat, "signal">) => {
    try { beats.push({ signal, ...judge(await f()) }); } catch (e) {
      beats.push({ signal, stale: true, minutes: null, what: `the ${signal} signal could not be read: ${String((e as Error)?.message ?? e).slice(0, 120)}` });
    }
  };

  await read("intake", io.lastInboundAt, (at) => {
    const h = intakeHealth({ lastReceivedAt: at, now });
    return { stale: h.stale, minutes: h.minutes_since, what: h.what };
  });
  if (!paused) await read("lag", io.oldestUndecidedAt, (at) => {
    const lag = minutesSince(now, at);
    return { stale: lag != null && lag > LAG_MINUTES, minutes: lag, what: `a client email stored ${lag} minutes ago has not been decided` };
  });
  await read("sync", () => io.lastRun("sync"), (at) => {
    const m = minutesSince(now, at);
    return { stale: m == null || m > SYNC_STALE_MINUTES, minutes: m, what: m == null ? "the minute sync has never finished" : `the minute sync last finished ${m} minutes ago` };
  });
  if (!paused) await read("labels", () => io.lastRun("labels"), (at) => {
    const m = minutesSince(now, at);
    return { stale: m == null || m > LABELS_STALE_MINUTES, minutes: m, what: m == null ? "the labels have never been handed out" : `the labels were last handed out ${m} minutes ago` };
  });

  // `where` names the signal, so each one collapses into its own email per window however often
  // the cron asks; the changing minutes live in `what`'s detail, which is not fingerprinted.
  for (const b of beats.filter((b) => b.stale)) {
    void io.report({ route: "heartbeat", where: `heartbeat/${b.signal}`, what: `the ${b.signal} heartbeat is stale`, detail: b.what });
  }
  return { ok: !beats.some((b) => b.stale), paused, beats };
}
