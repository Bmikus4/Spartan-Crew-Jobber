# The system audit's eight changes: build notes (10-26 night)

Orchestrator. **The owner, 10-26:** he pasted the system audit's ranked changes (audit/system-audit-2026-10-26.md §4)
with one ruling on top: "no heartbeats should run in n8n ever for this automation". A pasted plan is his approval
(memory: plan recommendations are decisions). So all eight are built in order, gated one at a time, and released
where nothing outside the code blocks them.

Standing rules still in force:
- writes stay off;
- the prompt is unchanged;
- no script runs against the production database;
- nothing calls OnSinch write paths or /api/bot/*.

## The ruling, and what it touches

At 10-26 these Spartan n8n workflows run on a schedule (read-only listing of the n8n API, 10-26 22:xxZ):

| workflow | id | schedule | does |
|---|---|---|---|
| Spartan Intake Watchdog | baVlgOkVMCpvj1N7 | every 15 min | GET /api/health/intake, emails if unreachable |
| Spartan Sync (every minute) | rfYGsZULF4PehLPm | every minute | POST /api/bot/sync, then the Gmail label steps |
| Email SamurAI v3.4 Spartan Crew Bookings (INTAKE) | CPIRu7CpezvKjU8d | Gmail poll every 1 and 3 min, plus a 30-min sweep | /api/dedupe, /api/n8n-inbound |

Spartan Alarms (mQkxdu2rLkTovYwn) is a webhook, not a schedule. The Reconciliation Sweep is already inactive.

**What blocks moving them out, outside the code:**
1. **The timer.** A Vercel cron calls with `Authorization: Bearer $CRON_SECRET`, and only when CRON_SECRET is set in
   Vercel's production environment. Setting it needs Vercel access to the project's team, which this session does
   not have (403). Until then a cron fires and is refused (6f9fd0e's crons did exactly that in September).
2. **Gmail.** Labels and intake read or change the bookings mailbox. Only n8n holds a credential for it: the app's
   service account was never granted domain-wide delegation (app/api/mail-poll/route.ts header; 7a0a951). The same
   grant is what would let alarms go out without n8n.

## Order

| # | change | release |
|---|---|---|
| 2 | /api/confirm-order shut under the v2 engine | ships |
| 1 | reads retried in-call; failed reads re-read; owner alerted on the system's own failures; a pause stores and does not decide | ships |
| 8 | tests for the minute path | ships (tests only) |
| 3 | heartbeat and minute sync as Vercel crons; n8n keeps no schedule | ships; goes live when CRON_SECRET is set, then the n8n schedules are switched off |
| 6 | switches: admin only, every change recorded with who and when, the owner told | ships |
| 4 | mail-poll decides through v2 | ships dormant; live with the Gmail grant |
| 7 | versioned migrations in one place; a Neon branch for Preview | migrations ship; the Preview branch needs Vercel access |
| 5 | the paused old engine retired | ships in stages |

## Log

(one entry per change as it lands)

### Change 2: /api/confirm-order shut under v2 (10-26)
- `OLD_ENGINE_ROUTES` (app/lib/paused.ts) now holds /api/confirm-order, so under SPARTAN_ENGINE=v2 the middleware
  answers 503 before auth or engine code. Under the old engine it still answers, because it belongs to that engine.
- `automationPaused` shuts the union when both switches are on. The pause no longer replaces the v2 list.
- Test: test/automationPaused.ts [6], 4 checks. The first is red on the old list.
- Not done: the 16 `proposed` tickets are not marked dead. That is a write to the production database, which this
  engagement does not make. With the route shut they are inert.
