# scripts/: what each one can touch

Made by `node scripts/scripts-index.mjs` from each script's own code; test/scriptsIndexed.ts fails when a script
is missing here or its class has changed. **Never run a script marked writes without reading it first**: the gate
(scripts/session.py) is the only sanctioned way to ship, and production is read only through scripts/_readonly.mts.

135 scripts: 43 can write, 66 read production, 26 are offline. npm marks the ones package.json runs.

| script | can touch | npm | what it says it is for |
|---|---|---|---|
| _labelNodes.mjs | writes: n8n, Gmail, bot routes |  | The Gmail label steps (Ben, 10-15), as n8n nodes. The app decides each bookings thread's labels |
| adoption.mts | writes: bot routes |  | THE EFFECT BEN MEASURES THE OFFER BY (10-15): the share of the bot's orders staff take as |
| alarm-recipients.mjs | writes: n8n |  | Lets a report sent to the "Spartan Alarms" webhook (4QTUkIbqSDrkTC6h) name its recipient, |
| archive-thread-bodies.mjs | writes: database | npm | Moves message bodies older than the retention window out of Postgres and into a JSONL |
| backfill-envelope.mjs | writes: database | npm | Fills inbound_raw.envelope and inbound_raw.message_ids for rows captured before the |
| backfill-gate-reason.mjs | writes: database |  | Give the already-dismissed tickets their reason back, deterministically. |
| backfill-job-numbers.ts | writes: database |  | Fill in the identifiers a human searches OnSinch with — J<Job.id> and |
| backfill-pause-window.mts | writes: n8n |  | Store, without deciding, the client emails intake never took during the 10-21 pause. |
| backfill-thread-messages.mjs | writes: database | npm | Decomposes the inbound_raw payloads already stored into thread_messages, so the history |
| build-n8n-workflow.mjs | writes: OnSinch, n8n, Gmail |  | PHASE C2/C3 — generate the NEW n8n trigger workflow that feeds the Vercel |
| build-sweep-workflow.mjs | writes: OnSinch, n8n | npm | Generate the 12-month sweep workflow: Gmail -> /api/sweep-ingest. |
| check-gate.mjs | writes: n8n |  | Production invariant: the n8n AI gate must NOT drop mail. |
| db-reclaim.mjs | writes: database | npm | Returns emptied space to Neon and reports the result. A plain UPDATE leaves dead tuples |
| e2e-test-515.mts | writes: OnSinch |  | End to end on TEST 515 (one paid reading per email): a client email -> the live reader -> grounding -> plan |
| export-sweep-corpus.mjs | writes: database | npm | Streams sweep_threads to data/corpus/sweep-threads.jsonl, verifies the file against the |
| gmail-label-admin.mjs | writes: OnSinch, n8n |  | Read and delete Gmail LABELS in the bookings mailbox, through a standalone n8n |
| gmail-login.mjs | writes: n8n, Gmail | npm | One-time Gmail login for the historical sweep, from this terminal. |
| health.ts | writes: Gmail |  | IS THE WHOLE SYSTEM HEALTHY? One command, six subsystems, no guessing. |
| install-engine-wiring.mjs | writes: n8n |  | Install the engine wiring into the LIVE bookings workflow (CPIRu7CpezvKjU8d). |
| install-intake-watchdog-workflow.mjs | writes: n8n |  | The intake watchdog: the one alarm that survives Spartan being dead. |
| install-label-workflow.mjs | writes: n8n |  | The Gmail labels' DRY RUN. The live label steps run inside "Spartan Sync (every minute)" |
| install-manual-tag-workflow.mjs | writes: n8n, Gmail |  | The "Manual" tag: a job this engine could not book, marked in the mailbox ops |
| install-payload-builder.mjs | writes: n8n |  | Put n8n/nodes/build-engine-payload.js live as the "Build Engine Payload" node of the |
| install-reconcile-schedule-workflow.mjs | writes: OnSinch, n8n |  | The daily reconciliation sweep — the schedule that makes /api/reconcile real. |
| install-reply-draft-workflow.mjs | writes: n8n, Gmail |  | The Gmail draft webhook: the last piece stopping replies from working. |
| install-sweep-workflow.mjs | writes: n8n |  | Install the sweep workflow into n8n, and run one window at a time. |
| install-sync-workflow.mjs | writes: n8n, bot routes |  | The Gmail labels after each minute sync (ADDENDUM R3, F32). No heartbeat for this automation |
| migrate-manual-label.ts | writes: database, OnSinch |  | Retire the last "Manual" label, thread by thread, without losing a signal. |
| probe-live-wiring.mjs | writes: database |  | Prove the DEPLOYED wiring the way n8n will actually call it: the dedupe claim |
| probe-threading.mjs | writes: n8n |  | Can RFC headers reproduce Gmail's own threading? Ask Gmail, then check. |
| prove-browser-bot.mts | writes: OnSinch |  | PROOF THAT THE BROWSER BOT WRITES THE ORDERS, from OnSinch's own log, not ours. |
| repoint-ai-model.mjs | writes: n8n |  | Repoint the workflow's AI classifier nodes at a model that actually exists. |
| repoint-gmail-cred.mjs | writes: n8n, Gmail |  | Repoint every Gmail node in the live workflow at a different, already-existing |
| restore-workflow.mjs | writes: n8n |  | Restore the live workflow from one of the timestamped backups in n8n/backups/. |
| scripts-index.mjs | writes: OnSinch, Gmail, bot routes |  | What each script in scripts/ can touch, read from its own code, and the index (scripts/README.md) made from it. |
| seed-rate-cards.mjs | writes: database |  | PHASE B2 — Seed Neon `rate_cards` from data/rate-map.json (rate-study output). |
| swap-gmail-credential.mjs | writes: n8n |  | Point every Gmail node at a reconnected credential. |
| test-backfill-runner.ts | writes: database |  | Exercise the REAL backfill runner end to end against LIVE OnSinch orders, by |
| test-dedupe.mjs | writes: database | npm | Prove the dedupe claim against the REAL Neon database, with no dev server: |
| vercel-bot-100.mts | writes: OnSinch, bot routes |  | THE VERCEL BROWSER BOT, 50 NEW JOBS AND 50 UPDATES, NO AI (Ben, 2026-10-16). |
| verify-gmail-sa.ts | writes: Gmail | npm | Prove the service account can read the mailbox and change a label — before any |
| verify-intake-e2e.mjs | writes: database, OnSinch | npm | End-to-end proof that the restructured intake works in PRODUCTION. |
| wire-engine.mjs | writes: n8n |  | Additively wire the LIVE bookings workflow into the Vercel engine: add one |
| _env.mjs | reads production |  | Tiny dependency-free helpers shared by the standalone scripts. |
| _peek.mjs | reads production |  |  |
| _q.mjs | reads production |  |  |
| _readonly.mts | reads production |  | The database for a measurement script: every query inside a READ ONLY transaction. |
| amendment-arrival.ts | reads production |  | HOW LONG AFTER A BOOKING DOES THE AMENDMENT ARRIVE? |
| analyse-contested.ts | reads production |  | WHY DO 19 ORDERS HAVE MORE THAN ONE THREAD? |
| approval-forensics.mjs | reads production |  | WHERE DO THE ENGINE'S ORDERS GO? |
| approval-request-theory.mjs | reads production |  | WHY DOES A DESTROYED ORDER LEAVE NO DELETE ROW? |
| audit-live-windows.mjs | reads production |  | Which live orders still hold the wrong hour? |
| audit-vocabulary.mjs | reads production |  | THE CONTROL patch-visible.mjs NEVER RAN |
| audit-workflow-refs.mjs | reads production |  | Read-only audit: nodes whose expressions reference a node that does not exist |
| build-testset.ts | reads production |  | The test set: every live thread, joined to what the engine did and what OnSinch holds. |
| change-and-copy.mjs | reads production |  | WHAT `common_change` CARRIES, AND WHETHER CONFIRM IS A COPY |
| check-new-enquiries.mjs | reads production |  | Read-only: what the engine made of every enquiry that arrived after a given |
| check-onsinch-key.ts | reads production |  | Does a POST /orders create leave slot-team ids behind? (It does not. Ever.) |
| clear-test-data.mts | reads production |  | Finds and clears what tests left in the live automation (app/lib/testData.ts holds the rules). |
| confirm-shape.mjs | reads production |  | §7.1 — IS "CONFIRM" ONE BUTTON? |
| contested-dates.ts | reads production |  | ARE THE COMPETING THREADS ABOUT THE SAME JOB, OR DIFFERENT ONES? |
| delete-anchored-successor.mjs | reads production |  | WORK AROUND THE DELETION — BIND ON THE DELETE EVENT, NOT ON A GUESS |
| dump-node.mjs | reads production |  | Dump one node's full parameters from the live workflow. Read-only. |
| engine-create-ledger.mjs | reads production |  | Read-only: how many orders does the ENGINE believe it created, and when? |
| executions.mjs | reads production |  | Read-only: recent executions of the live workflow, with the failing node and |
| export-contested-orders.ts | reads production |  | Export the orders that more than one email thread claims, with every conversation. |
| funnel-errors.mjs | reads production |  | The tickets that errored. What OnSinch actually said, in full. |
| funnel-stalls.mjs | reads production |  | The 76 client enquiries that never became an order, characterised. |
| funnel.mjs | reads production |  | Intake -> job conversion. How much of what arrives becomes an order in OnSinch, |
| grade-brain.mjs | reads production |  | Grade the brain against the REAL corpus, read-only. |
| inspect-live-state.mjs | reads production |  | Read-only: what the engine actually decided on real mail, and the exact |
| inspect-workflow.mjs | reads production |  | Read-only inspection of the LIVE bookings workflow: node inventory, the order |
| is-it-really-gone.mjs | reads production |  | THE ABSENCE THE WHOLE STORY RESTS ON |
| no-candidate.mjs | reads production |  | §7.2 — WHY 24 OF 67 VANISHED ORDERS OFFER NO CANDIDATE |
| onsinch-clock-evidence.mjs | reads production |  | Does OnSinch hold true UTC or naive London local? |
| onsinch-recent-orders.mjs | reads production |  | Read-only: the N most-recent OnSinch orders with everything the inbox |
| ops-truth.mts | reads production (read-only transaction) |  | What ops actually did for each client email: the ground truth the system is scored against. |
| patch-visible.mjs | reads production |  | §7.3 — DOES A PATCH LEAVE A TRACE ANYONE CAN READ? |
| peek-inbound.mjs | reads production |  | Read-only: how much has actually arrived from n8n, and the shape of the last |
| peek-thread.mjs | reads production |  | Read-only: everything stored for one thread - what each delivery carried, the mail |
| probe-live-shape.mjs | reads production |  | WHAT CAN ACTUALLY BE READ BACK OFF A LIVE ORDER. |
| probe-onsinch-clock.ts | reads production |  | WHAT FRAME DOES OnSinch KEEP A SLOT TEAM'S WINDOW IN? |
| pull-labelled-corpus.ts | reads production |  | Pull every labelled thread and its label to .tmp-data/labelled-corpus.json so the |
| pull-places.mjs | reads production |  | Pull the whole /places list to .tmp-data/places.json so the venue-duplication |
| rate-study.mjs | reads production |  | PHASE B1 — Rate ground truth from real OnSinch order history. |
| real-email-check-writes.mts | reads production |  | Read-only: each write the plan makes that a baseline run did not (or every write, --all), next to what ops built by hand. |
| real-email-scoreboard.mts | reads production (read-only transaction) |  | The real-email scoreboard (no model call): every stored client email since shadow began, |
| real-or-corpus.mjs | reads production |  | HOW MANY OF THE 85 ARE REAL CLIENT JOBS? |
| replay-execution.mjs | reads production |  | Replay a real n8n execution through the repo's payload builder, locally. |
| rnd-disproofs.mjs | reads production |  | The study's falsification tests, run. |
| rnd-study.mjs | reads production |  | R&D study: measure the corpus and the engine's behaviour over it. |
| run-sweep.mjs | reads production |  | Drive the 12-month sweep, one window at a time, and account for every window. |
| score-identity-rule.ts | reads production |  | SCORE THE SHIPPED MATCHER AGAINST EVERY LIVE BINDING. |
| score-successor-recovery.ts | reads production |  | When staff delete an order the engine raised, does the engine find the job it became? |
| score-vs-ops.mts | reads production (read-only transaction) |  | The system against what ops actually did. Every stored client email since FROM is re-read, |
| size-findings.mts | reads production (read-only transaction) |  | Prompt 0 (ADDENDUM §7): how often each finding happens, over the last 30 days. Counts only: no |
| status-live.mjs | reads production |  | Read-only snapshot of the whole live seam: the workflow's shape, its recent |
| study-corpus.ts | reads production |  | Score the engine against the OnSinch jobs the enquiries actually became. |
| successor-by-audit.mjs | reads production |  | IS THE SUCCESSOR LINK IN THE AUDIT LOG, RATHER THAN GUESSED? |
| successor-scan.mjs | reads production |  | Where does an engine order go when the team presses Confirm? |
| survey-inbound.mjs | reads production |  | Read-only: what real enquiry mail actually looks like when it reaches the |
| time-onsinch.mjs | reads production |  | Time the OnSinch whole-list pulls the resolver depends on, through the REAL |
| verify-readback-live.ts | reads production |  | CAN WE READ BACK WHAT WE CHANGED? Ben's protocol, on TEST 515. |
| verify-shrink-staffed.ts | reads production |  | THE ONE WRITE NOBODY HAS TESTED: shrinking a crew block that people are on. |
| verify-times.mjs | reads production |  | IS EVERY BOOKED TIME THE TIME THE CLIENT ASKED FOR? |
| watch-first-run.mjs | reads production |  | Wait for the FIRST non-erroring execution of the bookings workflow, i.e. the |
| week-review.mts | reads production (read-only transaction) |  | What the LIVE system decided in a week against what staff did after it, judged by value. No |
| were-we-second.mjs | reads production |  | WAS OPS ALREADY WORKING THE JOB BEFORE THE ENGINE POSTED IT? |
| who-deleted-it.mjs | reads production |  | THE DELETE ROW THE PATH FILTER COULD NEVER SEE |
| _corpus.mjs | offline |  | The swept corpus, read from disk. Replaces `SELECT payload FROM sweep_threads` for the |
| _corpusStats.mjs | offline |  | One pass over the on-disk corpus, producing everything rnd-study used to ask Postgres |
| _gateMeasure.mjs | offline |  | Hands a number to the next session gate: merges one named measurement into |
| _peek2.mjs | offline |  |  |
| _sha.mjs | offline |  |  |
| _thread.mjs | offline |  | Reconstructs what inbound_raw.payload used to hold: the envelope, with the messages put |
| amendment-horizon.mjs | offline |  | HOW LONG-HORIZON IS THE AMENDMENT PROBLEM, AND WHAT CAN WE STILL AMEND? |
| bench-professions.mts | offline |  | Bench: named professions through the bot, on TEST company 515 only. A new order whose shift |
| build-audit-page.py | offline |  | Builds the two 10-26 audits into one page with two views, from the committed markdown, so the page and |
| chronology-vs-ai.ts | offline |  | Q5: does the AI step replace the chronology rule, or sit on top of it? |
| env-names.mjs | offline |  | Writes .env.example: every process.env name read under app/, NAMES ONLY, each with the |
| followup-audit.ts | offline |  | Read what the follow-up clock decided about REAL threads, and judge it by hand. |
| followup-census.ts | offline |  | Run the follow-up clock over the whole stored corpus and report what it finds. |
| make-icons.mjs | offline |  | Generate PWA icons from the Spartan Crew arrow mark (extracted from the |
| onsinch-zone-evidence.cjs | offline |  | What OnSinch's zone-less audit times mean, measured on a local copy. |
| order-action-ledger.mjs | offline |  | Which order-write path actually fires, by month. |
| queue-audit.mjs | offline |  | What the dashboard's four tiles are actually holding. |
| rate-decay-experiment.mjs | offline |  | Offline experiment: how does the recency-decay factor change rate-card |
| resolver-gold-ben.json | offline |  |  |
| rnd-report.mjs | offline |  | Render the R&D study to one self-contained HTML file. |
| rnd-sections.mjs | offline |  | The R&D study's prose and figures, built from scripts/rnd-study.mjs --json. |
| sample-testset.ts | offline |  | Pick what to adjudicate, and render it for reading. |
| score-header-threading.mjs | offline |  | Does header threading reproduce Gmail's grouping? Scored against Gmail itself. |
| session.py | offline |  | The session gate. The only sanctioned `git commit` and `git push` in this repo. |
| test-engine-payload.mjs | offline | npm | Run the "Build Engine Payload" n8n Code node body OUTSIDE n8n, against |
| venue-duplicates.ts | offline |  | Which venues the tenant holds many times over, and which single row is worth |
