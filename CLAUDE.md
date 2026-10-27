# Spartan Crew booking engine (v2): repo map

Client emails to Spartan's bookings mailbox are read, matched to OnSinch orders and planned by code; the office
TV shows what a person must do. **The plan and the status of every item: ADDENDUM.md. Read it first, and after
every step update its status line, its §0 table and any measurement.**

## The live pipeline
1. **Intake.** n8n posts each thread to `/api/n8n-inbound`: `app/lib/n8nInbound.ts` stores it first
   (`app/lib/inboundRawDb.ts`, `app/lib/threadMessagesDb.ts`), then `decideDelivery` (`app/lib/v2/process.ts`).
   While paused, it stores and marks the mail store-only, and nothing decides it.
2. **Read.** One model call: `app/lib/v2/interpret/extract.ts` (openai/gpt-6.1-sol, `SPARTAN_INTERPRET_MODEL`;
   PROMPT_ID is the prompt's hash). The context the reader sees: `interpret/context.ts`.
3. **Ground.** Every value must be in the email's words: `interpret/interpret.ts`, `interpret/ground.ts`.
4. **Plan: which booking, which change.** `interpret/plan.ts` (findOrder, bookedAt, targetShift),
   `app/lib/v2/evidence.ts`, `threadState.ts`, `threadOrder.ts`, `links.ts`. **A booking is matched here, in
   v2, never in app/lib/engine.**
5. **Record.** One `v2_decisions` row per email (`process.ts`), with stable reason codes (`app/lib/v2/reasons.ts`).
6. **Write.** The bot (`app/lib/v2/bot/`: `run.ts`, `builder.ts`, `ops.ts`, `db.ts`, `apiCreate.ts`).
   **Off:** the Settings switch bot_writes_enabled is false (owner, 25 Oct).
7. **Every minute.** `/api/bot/sync`: stopped writes, the undecided sweep, failed reads, the re-plan
   (`app/lib/v2/replan.ts`), test data; ok only when every step succeeded. A Vercel cron (`vercel.json`); n8n's
   schedule until the switch-over (ADDENDUM R3). Every 5 minutes `/api/health/heartbeat` (`app/lib/heartbeat.ts`)
   raises a stalled intake, sweep, sync or labels to the owner.
8. **TV.** `app/lib/feed/` (`v2.ts` rowsOnCard, `serve.ts`, `live.ts`) behind `/api/feed`.
   **Labels:** `/api/bot/labels` from `app/lib/mail/threadLabels.ts`, applied by n8n with the mailbox's Gmail
   credential after each sync. **Alarms:** `app/lib/errorReport.ts`.

The old engine is deleted (ADDENDUM Prompt 12). `app/lib/engine/` holds only what v2 imports: the OnSinch client and
its types and helpers (`app/lib/engine/README.md`).

## Safety rules (ADDENDUM §2): build around them, never loosen them
- Capture before deciding. A throw before Save is blocked; after Save it is unknown and never retried.
- The op ledger runs a seen key once. Edits are read back and diffed against OnSinch's audit rows.
- Two write keys, failing closed: SPARTAN_WRITES=live and the Settings switch (`process.ts` botWrites).
- The planner refuses: a partial email, the day alone, a past day, staff's own edits, an ambiguous shift.
- A failed read or plan becomes a card. A failed TV read is a 500, never an empty list.

## Tests and data
- **The suite is `npm run test:all`** (`test/all.ts` finds every file). `npm test -- test/x.ts` runs one file.
- Every test runs on PGlite (`test/fixtures/pg.ts`). **Never run anything against the production DATABASE_URL;**
  read production only through `scripts/_readonly.mts`. Never call OnSinch write paths, /api/bot/* or the canary.
- Never print email bodies, addresses or client names. Counts, ids and code locations only.
- The harness: `harness/` (`harness/real/` replays real mail on the time-correct world at $0).

## Where things live
- The plan and its status: `ADDENDUM.md`. Rulings: `DECISIONS.md` (dated ones in `decisions/`).
- Measured numbers: `public/data/feed.json`, one ticket per ship. The docs index: `docs/README.md`.
- The schema: `app/lib/migrations.ts`, append only; each store calls `ensureSchema()`. Never a CREATE or ALTER elsewhere.
- History, not instructions: `OPERATING.md`, `RUNBOOK.md`, `audit/`, `fleet/resume/`.

## The session gate
`python -u scripts/session.py -m "one line, a fact about the software" --headline "what moved" -- <paths>` is the
only sanctioned commit and push. It runs `npx tsc --noEmit` and `npm run test:all`, appends one ticket to
`public/data/feed.json`, commits by pathspec and pushes; it writes nothing when it stops. **A push to main
deploys production.** `--self-test` proves it can still go red. A number that moved without a ticket explaining
it is a regression. A measurement script writes `.tmp-data/gate-measurements.json`; the gate folds it into the
ticket and deletes it. Old tickets may be thinned to headlines, never rewritten or deleted.

## Invariants: do not "tidy" these
- **No heartbeat runs in n8n, ever** (owner, 26 Oct). Timers live in the app as vercel.json crons
  (authorizeCronCall). A replacement goes live before the n8n workflow is switched off.
  scripts/install-intake-watchdog-workflow.mjs is overruled and must not be run again.
- **Four, and only four, order labels** (`app/lib/mail/threadLabels.ts`): Order Created, Order Updated, Order
  Needs Created, Order Needs Updated, mutually exclusive. Needs Follow Up is another axis. They are derived from
  the TV's cards every minute; nothing sets one by hand.
- **A draft is not a message.** An unsent draft of ours never counts as Spartan having replied.
- **Never write Job.min_beginning / max_end**, and treat the job window as unreliable input
  (`app/lib/engine/README.md` has the measurement).
- **`6922 "No Location"` is exempt from every venue phase.** Exactly one may exist; code finds it by name.
- **Zero references is permission to delete, never a reason to.**
