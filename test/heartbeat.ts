// ============================================================================
// The heartbeat raises each stale signal to the owner, and stays quiet when all is well.
// ----------------------------------------------------------------------------
// Addendum F32 (26 Oct): n8n carried intake, the minute sync, labels and the watchdog itself, so
// when n8n stopped the owner heard nothing. The owner ruled no heartbeat runs in n8n, ever
// (DECISIONS O1): a Vercel cron asks /api/health/heartbeat every 5 minutes instead. The judgement's
// IO is injected and no report is sent; the lag query runs against PGlite (fixtures/pg.ts).
// npx tsx test/heartbeat.ts
// ============================================================================
import { clock, syncSqlClock } from "./fixtures/pg";
import { heartbeat, type HeartbeatIO, LAG_MINUTES, SYNC_STALE_MINUTES, LABELS_STALE_MINUTES } from "../app/lib/heartbeat";
/* eslint-disable @typescript-eslint/no-require-imports */
process.env.VERCEL_GIT_COMMIT_SHA = "test";
const { captureInboundRaw } = require("../app/lib/inboundRawDb.ts");
const { oldestUndecidedAt, storeOnly } = require("../app/lib/v2/process.ts");

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };

// Wednesday 4 Nov 2026, 11:00 London (GMT): inside working hours.
const NOW = Date.parse("2026-11-04T11:00:00Z");
const MIN = 60_000;
const fresh: Record<"inbound" | "undecided" | "sync" | "labels", number | null> = { inbound: NOW - 5 * MIN, undecided: null, sync: NOW - MIN, labels: NOW - MIN };

function rig(over: Partial<typeof fresh> = {}, paused = false) {
  const v = { ...fresh, ...over };
  const reports: Array<{ route: string; where: string }> = [];
  const io: HeartbeatIO = {
    now: () => NOW,
    paused: () => paused,
    lastInboundAt: async () => v.inbound,
    oldestUndecidedAt: async () => v.undecided,
    lastRun: async (name) => (name === "sync" ? v.sync : v.labels),
    report: (async (a: { route: string; where: string }) => { reports.push({ route: a.route, where: a.where }); return true; }) as HeartbeatIO["report"],
  };
  return { io, reports };
}
const wheres = (r: Array<{ where: string }>) => r.map((x) => x.where).sort().join();

(async () => {
  console.log("\n[control] all fresh: nothing raised");
  {
    const r = rig();
    const h = await heartbeat(r.io);
    ok(h.ok && r.reports.length === 0, "ok, and no report", { h, reports: r.reports });
  }

  console.log("\n[stale] each signal raises its own report, route heartbeat");
  const cases: Array<[string, Partial<typeof fresh>]> = [
    ["heartbeat/intake", { inbound: NOW - 3 * 60 * MIN }],
    ["heartbeat/lag", { undecided: NOW - (LAG_MINUTES + 1) * MIN }],
    ["heartbeat/sync", { sync: NOW - (SYNC_STALE_MINUTES + 1) * MIN }],
    ["heartbeat/labels", { labels: NOW - (LABELS_STALE_MINUTES + 1) * MIN }],
  ];
  for (const [where, over] of cases) {
    const r = rig(over);
    const h = await heartbeat(r.io);
    ok(!h.ok && wheres(r.reports) === where && r.reports.every((x) => x.route === "heartbeat"), `${where.split("/")[1]} stale: one report, ${where}`, { reports: r.reports });
  }
  {
    const r = rig({ sync: null, labels: null });
    await heartbeat(r.io);
    ok(wheres(r.reports) === "heartbeat/labels,heartbeat/sync", "a run never recorded is stale, not fine", r.reports);
  }
  {
    const r = rig({ undecided: NOW - (LAG_MINUTES - 1) * MIN });
    await heartbeat(r.io);
    ok(r.reports.length === 0, `an email undecided for ${LAG_MINUTES - 1} minutes is still within the sweep's reach`, r.reports);
  }

  {
    const r = rig();
    r.io.lastRun = async () => { throw new Error("run_marks unreadable"); };
    const h = await heartbeat(r.io);
    ok(!h.ok && wheres(r.reports) === "heartbeat/labels,heartbeat/sync", "a signal that cannot be read is raised, never taken as fine", r.reports);
  }

  console.log("\n[paused] the sweep and the labels stand still by design");
  {
    const r = rig({ undecided: NOW - 60 * MIN, labels: NOW - 60 * MIN }, true);
    const h = await heartbeat(r.io);
    ok(h.paused && r.reports.length === 0, "lag and labels are not judged while paused", { h, reports: r.reports });
    const s = rig({ sync: NOW - 60 * MIN }, true);
    await heartbeat(s.io);
    ok(wheres(s.reports) === "heartbeat/sync", "the sync still is: its reads keep running while paused", s.reports);
  }

  console.log("\n[lag] the oldest email the sweep should have decided, and nothing it should not");
  {
    const T0 = Date.parse("2026-11-04T09:00:00Z");
    const at = async (ms: number) => { clock.set(ms); await syncSqlClock(); };
    const mail = (id: string, from: string, sent: string) => ({ message_id: id, from, to: ["bookings@spartancrew.co.uk"], date_iso: sent, subject: "Crew", body: "2 more crew please" });
    await at(T0);
    await captureInboundRaw({ thread_id: "lq1", messages: [mail("lq1a", "sam@client.co.uk", "2026-11-04T08:59:00Z")] });
    await storeOnly(["lq1a"], "arrived while the automation was paused");
    await at(T0 + MIN);
    await captureInboundRaw({ thread_id: "lq2", messages: [mail("lq2a", "sam@client.co.uk", "2026-10-01T09:00:00Z")] });
    await at(T0 + 2 * MIN);
    await captureInboundRaw({ thread_id: "lq3", messages: [mail("lq3a", "noreply@onsinch.com", "2026-11-04T09:01:00Z")] });
    ok(await oldestUndecidedAt() === null, "store-only mail, history stored late and non-client mail are no lag", await oldestUndecidedAt());
    await at(T0 + 3 * MIN);
    await captureInboundRaw({ thread_id: "lq4", messages: [mail("lq4a", "sam@client.co.uk", "2026-11-04T09:02:00Z")] });
    await at(T0 + 30 * MIN);
    ok(await oldestUndecidedAt() === T0 + 3 * MIN, "a client email nothing decided: its storing time", await oldestUndecidedAt());
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
