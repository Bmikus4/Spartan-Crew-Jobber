# Two n8n workflows retired on 17 Nov 2026

The owner, 17 Nov: "deactivate the watchdog, stop sending me emails", then "delete those workflows, just keep
track of the data". Both were deactivated, exported here, and deleted from n8n. Deleting a workflow drops its
execution history, so the history is kept here instead.

| workflow | n8n id | what it did | kept here |
|---|---|---|---|
| Spartan Intake Watchdog | baVlgOkVMCpvj1N7 | Every 15 minutes it asked /api/health/intake whether mail was reaching the engine, and on a stale answer posted to the spartan-alarm webhook | `spartan-intake-watchdog.workflow.json`; `spartan-intake-watchdog.checks.csv`, all 2,450 checks n8n held (18 Oct 22:45Z to 17 Nov 23:20Z, every one answered, 21 alerts) |
| Spartan Alarms | mQkxdu2rLkTovYwn | The spartan-alarm webhook: emailed each alarm it received to the owner | `spartan-alarms.workflow.json`; `spartan-alarms.sends.csv`, all 35 sends (3 Nov to 17 Nov) |

The alarm workflow kept no content for its runs, so each send in `spartan-alarms.sends.csv` is joined to the watchdog
alert that fired it, within 2 minutes. Sends with no watchdog alert came from the app's own error reports, which were
emailed until the owner turned that off on 4 Nov (SPARTAN_ERROR_NOTIFY). The 13 sends from 13 to 17 Nov were the
watchdog reporting the 12-17 Nov intake outage.

**Why the watchdog had to go.** It was a heartbeat running in n8n, against O1 ("no heartbeats should run in n8n
ever for this automation"). The app's own heartbeat (/api/health/heartbeat, a vercel.json cron every 5 minutes) does
the same check and records every stale moment in error_reports.

**Where the same facts live from now on.** This record is everything the two workflows held.
- Alarms: `error_reports` records every report, emailed or not (app/lib/errorReport.ts). No alarm emails anyone
  now. Turning email back on needs both SPARTAN_ERROR_NOTIFY=1 in Vercel and a webhook that sends it, since this one is
  deleted.
- Intake flow: `inbound_raw.received_at` and `thread_messages.first_seen_at` hold every email's arrival, so any intake
  gap can be rebuilt from the database (scripts/backfill-outage-window.mts audit).
- The Live Feed shows a red banner whenever intake is stale (S-0318).

**Sanitized.** Email addresses are replaced by [email] and header secrets by [secret]. Credential references keep
their id and name, which are not secrets. Exported by a session script from n8n's public API.
