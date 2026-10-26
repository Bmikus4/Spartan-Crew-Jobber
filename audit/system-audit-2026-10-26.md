# System audit: the Enquiry Engine as a whole (2026-10-26)

Scope: the whole running system, not the engagement's held patches. Method, all read-only:
- Repo at HEAD 5f3f561. Its `app/` is byte-identical to production's 305bf84: `git log 6a98170..HEAD -- app` is empty.
- The local production copy `.tmp-data/gold`, taken 2026-10-26 12:21Z: 958 decisions, 7,510 messages, 452 links, 917 tickets.
- `npx tsc --noEmit` (clean), and six offline tests run with the PGlite preload: writeRoutesAuthorised, machineRouteAuth, apiAuth,
  feedServe, everyEmailDecided, allowlistClosedInProduction. All exit 0.
- No network, no database, no credentials. Severity tags: **[H]** high, **[M]** medium, **[L]** low.

## Summary

1. The core loop holds where it matters most. Every captured client email reaches a recorded decision: 948 of 958 since 10-09, and the 10 gaps are non-client mail from before the 10-11 fix. The bot's write path is idempotent and verified, and every route has a gate that fails closed.
2. Operations (OPERATING §15) are the weakest part:
   - the model call has no retry;
   - a failed read becomes a red booking card for staff and is never read again;
   - the v2 path raises no alert to the owner;
   - pausing intake refuses mail before it is stored: the 10-21 pause left 40 client emails unstored. **[H]**
3. n8n Cloud is a single point of failure for intake, the minute sync, labels, the watchdog and the alarm channel itself. When it stops, all of them go quiet together. **[H]**
4. The paused old engine is 40% of app code (16,095 lines), and 39 of its 47 files are still reachable from live routes. One of them is a live write path: `/api/confirm-order` writes to OnSinch outside the bot write switch, and 16 stale tickets still carry its button. **[H]**
5. The Gmail-API intake already written (`/api/mail-poll`) feeds only the old engine. Switching intake to it today would not reach v2. **[M]**
6. 145 of the 219 test files target the old engine. The minute re-planner, the feed's production reads and all 27 route handlers are never executed by any test. **[M]**
7. Code quality is uneven:
   - good: tsc is clean and there are no ts-ignores;
   - weak: 373 any-casts (243 of them in v2), a 411-line planner function, the schema created by 33 runtime `CREATE TABLE IF NOT EXISTS` statements, and comments that disagree on whether auth is enforced.
8. Security is mostly good: no committed secrets, and machine routes fail closed. Two gaps: any signed-in staff member can flip the write and auto-send switches with no record of who did it, and preview deployments share the production database. **[M]**
9. Observability is per email, not per system:
   - each decision row carries the model, prompt, cost, code version and, since 10-24, a reason code;
   - stage tracing is a no-op in production;
   - the minute sync always answers `ok: true`.
10. The highest-value moves:
    - retry, re-queue and alert on failed reads (S);
    - shut the old write path (XS);
    - a heartbeat that does not run on n8n (S);
    - wire the new intake to v2 (M);
    - then retire the old engine (M-L).

---

## 1. Architecture and data flow

### The path one email takes

| # | Stage | Code | Driven by | Writes |
|---|---|---|---|---|
| 1 | Capture: Gmail trigger every minute, plus a 30-minute sweep of the last 24 h, posts the whole thread | `n8n/spartan-inbound-trigger.workflow.json` (repo copy); `api/n8n-inbound/route.ts:11-21`; `n8nInbound.ts:61-62` | n8n | inbound_raw, thread_messages |
| 2 | Decide: newest new client message, read with the earlier ones; one model call, then ground, then plan | `n8nInbound.ts:69-81` → `process.ts:187-226`, `413-461` | inside the intake request (300 s) | v2_decisions |
| 3 | Catch-up: emails undecided after 10 min (up to 24 h old), 2 threads a minute | `process.ts:255-304` | minute sync | v2_decisions |
| 4 | Write: lease → ledger → browser → read-back | `process.ts:392-407`; `bot/run.ts:1-14` | only with `SPARTAN_WRITES=live` and `bot_writes_enabled` (`process.ts:33-36`); off since 10-21 | bot_ledger, job_links |
| 5 | Re-plan every open card from its stored reading: 20 cards, 90 s budget | `replan.ts:71-90` | minute sync | v2_decisions.replan |
| 6 | Links: J-number backfill and sweep | `api/bot/sync/route.ts:29-31` | minute sync | job_links |
| 7 | TV: merges v2 rows, marks, held links, the reply lane and jobs-board tiles | `feed/serve.ts:59-153`; `feed/live.ts:111-129` | every screen, every 20 s (`LiveFeedScreen.tsx` REFRESH_MS) | feed marks |
| 8 | Labels: the same feed's `all` becomes 4+1 Gmail labels, which n8n applies | `api/bot/labels/route.ts:24-67`; `mail/threadLabels.ts` | minute sync | thread_labels |
| 9 | Alarms: `reportError` → n8n webhook → Gmail | `errorReport.ts:320-336` | on error | error store |

### Where responsibilities blur

- **[M] The minute sync is seven jobs in one 300-second function** (`api/bot/sync/route.ts:29-41`):
  - link backfill, board backfill and the link sweep;
  - write retries and the undecided sweep (which makes model calls);
  - the re-plan and the OnSinch test-data delete.

  Every error is folded into the JSON body behind `ok: true` (line 42), so n8n records success whatever happened. Only the re-plan has its own budget, so a slow step starves the ones after it.
- **[M] The TV re-derives meaning from prose.** A card's kind comes from regexes over the planner's reason text: `REPLY_REASON` (`feed/v2.ts:45`) and `classify` (`v2.ts:68-91`). Rewording a planner reason can therefore change what the TV shows and which label Gmail wears.
- **[L] Labels are a function of the TV.** The labels route reads `serveFeed(...).all` (`labels/route.ts:43-47`, and `serve.ts:53-58` says so). A display rule change is also a label change, deliberately, but nothing tests the pair together.

### Single points of failure

| Dependency | What stops | Who finds out |
|---|---|---|
| n8n Cloud | intake, the 30-min sweep, the minute sync (retries, undecided sweep, re-plan, links), labels, the intake watchdog, and alarm delivery (`errorReport.ts:320`) | Staff only: the TV's sync dot turns red after 90 quiet minutes in working hours (`intakeHealth.ts:17`, `LiveFeedScreen.tsx:549-587`). The owner's alarm channel is the thing that is down. |
| One Gmail OAuth credential in n8n | intake | 08-26 precedent: 42 h unnoticed (`intakeHealth.ts:3-6`); the watchdog now covers it unless n8n itself is down |
| OpenRouter, one model, one attempt (`extract.ts:102-123`) | every reading becomes a "could not read" card | staff only |
| Neon, one database shared with Preview (`middleware.ts:53-56`) | everything | a capture failure alarms through n8n (`n8nInbound.ts:70-72`) |
| OnSinch API key plus one staff UI login (`bot/session.ts:87`) | planning, re-plan, verify, writes | hand-off cards ("could not plan") |

### What the old engine still does in production

| Old-engine part | Runs in production? | Evidence |
|---|---|---|
| Intake decision (`handleThread`) | No under `SPARTAN_ENGINE=v2`, but statically imported into the intake route | `n8nInbound.ts:11,17,69-81` |
| mail-inbound, mail-poll, sweep-ingest, reconcile | 503 | `paused.ts:19,46`; `middleware.ts:48` |
| **`/api/confirm-order` → `confirmOrder` → `executeOrder` (create, amend in place, delete-and-repost)** | **Yes, live** | `routes/confirmOrder.ts:3,23`; `pipeline.ts:1476`, `1593-1629`, `tryReplace` at `1268`; absent from `paused.ts:11` |
| Jobs Board tickets and conversation_state | Read: TV tiles via `listTickets(5000)` and the Jobs screen | `live.ts:29-32,115`; `AppShell.tsx:28-38` |
| TV verifier helpers | Yes: `staffChangeSince`, `matchExistingOrder` | `feed/verify.ts:25-27` |
| OnSinch client and resolver | Yes, v2 depends on them | 26 import lines from v2/feed/followup into `engine/*` |
| Test-data clear | 15-min sweep gated by writes; the Settings button is not | `testData.ts:288-296`; `api/test-data/route.ts:27-38` |
| Old-state branch of the TV projection | Dead: production passes `states: []` | `live.ts:113`; `project.ts:174-335` |

**[H] The live old write path.**
- Who can call it: anyone with a signed-in session, or anyone holding `N8N_WEBHOOK_SECRET` (`apiAuth.ts:63-85`).
- What does not stop it: it never consults `botWrites()` or `SPARTAN_WRITES`. The Jobs screen that shows its button is hidden unless `jobs_board_enabled` is on (default false, `types.ts:583`), but the route answers either way.
- What it would act on: the copy holds 16 tickets in `proposed`, last touched 2026-08-17..10-07. 12 carry an order id, so confirming one edits that live order, or deletes and re-posts it (`JobsScreen.tsx:440-452`), from a plan 3 to 10 weeks old.
- Why it matters: this is the one way an order can change while the owner believes writes are off.

---

## 2. Code cleanliness

### Size

| Area | Files | Lines | any-casts |
|---|---|---|---|
| `app/lib/engine` (paused) | 47 | 16,095 | 57 |
| `app/lib/v2` | 30 | 5,378 | 243 |
| `app/lib/feed` | 10 | 1,923 | 16 |
| `app/lib/mail` | 10 | 1,482 | 10 |
| other `app/lib` | 54 | 8,173 | 43 |
| `app/components` | 23 | 5,382 | 2 |
| `app/api` | 27 | 1,406 | 2 |
| **app total** (adds the 3 root files) | **204** | **39,931** | **373** |
| `test` | 222 | 27,881 | 348 |
| `scripts` | 149 | 20,250 | 201 |

**Largest files:** `engine/compiler.ts` 2,193; `engine/pipeline.ts` 1,650; `engine/onsinch.ts` 987; `v2/interpret/plan.ts` 853; `engine/resolve.ts` 811; `deps.ts` 781.

**Longest functions** (TypeScript AST): 40 named functions exceed 100 lines.

| Function | Lines | Location | Engine |
|---|---|---|---|
| `compile` | 1,098 | `compiler.ts:1095-2192` | old |
| `HelpWidget` | 560 | `HelpWidget.tsx:134-693` | UI |
| `decide` | 411 | `plan.ts:442-852` | the v2 planner, one function |
| `reconcileThread` | 377 | `sweep.ts:263-639` | old |
| `LiveFeedScreen` | 308 | `LiveFeedScreen.tsx:342-649` | UI |
| `executor` | 305 | `deps.ts:370-674` | old |
| `ground` | 280 | `interpret.ts:102-381` | v2 |
| `project` | 198 | `feed/project.ts:336-533` | feed |

### Dead and duplicated code

- **[M] Unreachable code.** 25 app files (3,763 lines) cannot be reached from any live route or the UI (import-graph walk):
  - 13 are reachable only through the four shut routes;
  - 12 are reachable from nothing: `match/*` (648 lines), `orderLink`, `jobMigration`, `fold`, `verifyWrite`, `sweepLabelsDb`, `v2/bot/parity`, `v2/draft` and `engine/score.ts`.
  - `engine/score.ts` is referenced by nothing at all, not even tests or scripts.
  - `verifyWrite.ts` is the only raiser of the `write-unconfirmed` alarm, so that alarm cannot fire.
- **[M] Duplication.**
  - Database setup is repeated in 28 files (28 `neon(` sites).
  - The connection URL is looked up 26 times, and 4 of those lookups skip one of the three variable names (`bot/sync/route.ts:27`, `labels/route.ts:31`).
  - The OnSinch base URL is written out in 10 places, and `rowsOf` is copied 6 times.
- **[M] The schema is created at request time.** There are 33 `CREATE TABLE IF NOT EXISTS` and 18 `ALTER TABLE` statements in 25 files (e.g. `process.ts:52-68`, `labels/route.ts:32`). The schema is whatever the first request created, with no migration history.
- **[M] Configuration sprawl.** The app reads 69 environment variables, 20 of them `SPARTAN_*` flags. The question "can the system write?" is spread across six controls:
  - `SPARTAN_PAUSED`, `SPARTAN_ENGINE` and `SPARTAN_WRITES`;
  - the `bot_writes_enabled` setting, the `testOnly` flags and `INTAKE_PATH`.

  The old confirm path above sits outside all six.
- **[L] Two oddities.** An `import` sits after a function body (`process.ts:37`), and 59 npm scripts are mostly one-file aliases.

### Type safety

- **[M] Untyped boundaries.** v2 holds 65% of the app's any-casts in 13% of its lines: `bot/run.ts` 34, `process.ts` 28, `threadState.ts` 28.
  - OnSinch rows are `any` end to end (`process.ts:80,89-104`).
  - The model's answer is cast, not validated (`extract.ts:132`: `JSON.parse(...) as Extraction`). Grounding catches bad values; it does not catch a wrong shape.
- tsc is clean and there are no ts-ignores.

### Comments, against the CLAUDE.md rule

The rule is that a comment states a constraint the code cannot show.
- **Mostly met.** Most comments do name the measurement that settled a rule.
- **Very heavy.** There are 13,088 comment lines against 24,039 code lines (0.54). The ratio is 0.82 in the engine and 0.90 in `deps.ts`.
- **History-laden [L].** 531 comment lines carry a date, 82 narrate "until X it did Y", and 247 name Ben. That narrative belongs in commits.
- **[M] They contradict each other on a security fact:**
  - `middleware.ts:12-13` says auth is off until Google sign-in is set up;
  - `middleware.ts:53` says AUTH_REQUIRED "is set for Production only";
  - `settings/route.ts:25-26` and `test/writeRoutesAuthorised.ts:11-12` say it "is set nowhere".
- **[L] Stale comments:**
  - `n8nInbound.ts:5-9` describes the old compile-and-execute pipeline;
  - `api/n8n-inbound/route.ts:2-3` justifies 300 s with old-engine model calls that no longer run.

### Tests

- **How they run:** `test/all.ts:30-47` discovers 219 files and runs each in a fresh `npx tsx`, serially, against PGlite (`fixtures/pg.ts:13`).
- **[M] What they guard.** By primary import, 145 files target the old engine, 22 target v2, 3 the feed, 6 mail, 27 other, and 16 only read source text. Two thirds of every gate run guards code that does not decide production mail.
- **[M] What is never executed by a test:**
  - all 27 route handlers (some are read as text);
  - all 23 components (7 are read as text, including the TV);
  - `v2/replan.ts`, which runs every minute and resolved 20 of the 39 cards in today's verification (`audit/verification-2026-10-26.md` §3);
  - `v2/threadOrder.ts`, `v2/read.ts`, `feed/live.ts`, `feed/marksDb.ts`, `bot/session.ts` and `bot/db.ts`.

---

## 3. What works and what does not

### Against OPERATING §15

| §15 requirement | State | Evidence | Sev |
|---|---|---|---|
| Intake durable, nothing dropped | **No, during a pause** | Capture runs first (`n8nInbound.ts:61-62`), backed by the 30-min resend and the undecided sweep (`process.ts:255`). But pausing refuses mail at the door, before capture: `SPARTAN_PAUSED` 503s `/api/n8n-inbound` (`paused.ts:11`, `middleware.ts:48`). The app reads the Settings `intake_paused` switch only for display (`live.ts:127`, `serve.ts:131-141`), so whatever stops intake lives in n8n. The 10-21 pause left 40 client emails unstored, beyond intake's 72 h catch-up (`decisions/2026-10-25-pause-window-store-only.md:8-11`). A failed capture is alarmed but not re-queued (`n8nInbound.ts:70-72`). | **H** |
| Backoff with jitter; budgets; degrade | **No, in v2** | One attempt with a 60 s timeout (`extract.ts:114-123`). The old reasoner tried 3 times with backoff on 429/5xx (`engine/reason.ts:259-270`). v2 has no spend ceiling or balance check; `spend.ts` and `keyBalance.ts` serve only the old engine. | **H** |
| Idempotent | Writes yes; record no | Ledger keys never re-run, and "unknown" is final (`bot/run.ts:7-10`). A re-post buys no second read (`process.ts:213-214`). A replay can overwrite a write record (`process.ts:514-517`); that fix exists only in the held patch. | M |
| Dead letter with replay after fixes | Partly | The undecided sweep is a dead letter for unrecorded mail. A *recorded* failure is final: 7 of 223 hand-offs are system failures (1 OpenRouter 429, 2 OnSinch 404 while planning, 4 linked order unreadable). The 429 card sat red for 3 days (verification §3, 1a144c619a140ea6). | **H** |
| Alerts reach the owner, never the team | **No, in v2** | `app/lib/v2`, `feed`, `mail` and `api/bot` contain no `reportError`. v2 raises only capture-failed and decide-threw (`n8nInbound.ts:71,78`). Three of the 8 alarm routes (booking-lost, write-unconfirmed, label-failed) are raised only by old-engine code. A failed read alerts nobody and paints a card for staff. | **H** |
| Display never stale silently | Partly | The TV dot goes red on a feed error or 90 quiet minutes. Nothing watches decision lag, the minute sync or the labels. No aging policy exists (verification fault 2). | M |
| Every stage emits {decision, confidence, reason} | Partly | Tracing is a no-op in production (`process.ts:519`, `trace.ts:39-40`). The decision row does keep the reading, grounding, plan, run results, model and cost. Reason codes are on 32 of 32 rows since 10-24, and on 0 of the 926 before. | M |

### The TV and labels pipeline

- **Works.**
  - A failed feed read answers 500, never an empty list (`serve.ts:5-8,65-68`).
  - Today's verification accounted for every write and hand-off since 10-23 (§3 there).
  - Since 10-11, every client-side message in the copy has a decision row.
- **[M] Some cards reach nobody.** A reply-only card wears no label (`threadLabels.ts:40-45` has no `needs-reply`), and it is not listed while the reply lane is off. 3 such cards since 10-23 reached nobody (verification §3).
- **[L] Labels can be recorded but not applied.**
  - A label is marked applied when it is handed out (`labels/route.ts:55-60`), before Gmail applies it.
  - A dropped run is repaired only when n8n posts the refusal back (lines 36-40), or by the hourly full resend.
  - That resend is capped at 150 threads (lines 15, 53), so past 150 labelled threads it never completes in an hour.
- **[L] Every refresh rereads everything.** Each TV refresh, every 20 s, reads all thread_messages rows (`live.ts:41-45`; 7,510 today), up to 5,000 tickets (`live.ts:115`) and every write or hand-off since 10-09. The labels route repeats the same reads every minute. The cost grows linearly; it is fine today.

### Intake health and cost

- **The watchdog** polls `/api/health/intake` every 15 min (`install-intake-watchdog-workflow.mjs:29,63`).
  - It measures capture only (`MAX(first_seen_at)`, `live.ts:44`; `serve.ts:129`), Mon-Fri 08-18 London, with bank holidays.
  - Volume is 70-125 client-side messages per weekday. 10-21, the pause window, stored none.
  - **[M]** Nothing measures capture-to-decision lag: a stalled decider with healthy capture is invisible.
- **Cost** is about $0.007 a reading (`extract.ts:96-100`); measured spend was $0.02-3.42 a day (`STATE.md:218`). Cost is low risk. The precedent that matters is the 10-11 credit exhaustion (402): today the same event turns every email into a "could not read" card, and the owner hears nothing.

### Security

- **Good:**
  - `decideCaller` fails closed in production (`apiAuth.ts:53-60`).
  - Every route on the skip list checks its own secret, enforced by `writeRoutesAuthorised.ts` and `machineRouteAuth.ts` (76 and 42 PASS lines today).
  - Previews are forced to authenticate (`middleware.ts:62`).
  - The bot has its own secret (`apiAuth.ts:182-197`), and its session is AES-256-GCM encrypted (`bot/db.ts:5,53-54`).
  - A pattern scan of the 922 tracked files found no secrets; the n8n JSON files carry placeholders.
- **[M] No roles.**
  - Any signed-in session can write `bot_writes_enabled`, `replies_enabled` and `reply_delivery` (`settings/route.ts:32-35`).
  - The settings singleton keeps no actor and no history (`settingsDb.ts:95-96`).
  - `isAdmin` exists in the session (`session.ts:6`) and is checked nowhere.
  - If `SPARTAN_WRITES=live` is set, one staff click turns writes on, and nobody can say later who did it.
- **[M] Previews share the production database** and run its runtime DDL (`middleware.ts:53-56`).
- **[M] The bot's OnSinch access is broad.** It is a full staff login in the agency role (`bot/session.ts:1-10,87`), plus an API key that can also delete (the old executor and the test-data clear). The Settings clear deletes by a company-name regex (`testData.ts:39`) and is gated by a session, not by the write switch. The regex matches 2 of 812 companies in the copy, both deliberate test companies.
- **[L] Break-glass and sessions.** The break-glass secret travels in a URL (`AppShell.tsx:46`). `POST /api/auth` has no rate limit (`auth/route.ts:17-30`). Sessions live a year with no revocation (`session.ts:16`).

### Observability: can a miss be diagnosed from logs?

- **After the decision row: yes.** The `v2_decisions` row names the stage: reading, grounding problems, plan reasons, run results, `code_version` and cost.
- **Before the row: no.** n8n delivery, the payload and capture live only in n8n's execution history and Vercel logs (68 `console.*` sites).
- **The minute sync** reports success whatever happened (`sync/route.ts:42`).
- **[M] No reason codes before 10-24.** The history before then cannot be grouped by reason without re-deriving it.

---

## 4. If I were the owner: the changes, ranked

| # | Change | Why | Effort | Risk of not doing it |
|---|---|---|---|---|
| 1 | Reads that fail are retried and re-queued, and the owner is told: port the old reasoner's 3-attempt backoff (`reason.ts:259-270`) into `extract.ts`; record a failed read as `system_failed`, which the undecided sweep re-reads; ship the held owner alert (items 1-3); make a pause stop deciding but keep storing | The most likely failure (rate limit, credit, timeout) becomes a red staff card that is never retried, and a pause throws mail away. §2 and §15 both forbid that. | S (≤1 day) | The next 402/429 burst paints every email that day as booking work, with no alarm (10-11 precedent; the 429 card sat 3 days). The next pause loses mail again (40 emails on 10-21). |
| 2 | Shut the old write path: add `/api/confirm-order` to the paths shut under `SPARTAN_ENGINE=v2`, or gate `executeOrder` on `botWrites()`; mark the 16 `proposed` tickets dead | The only order write outside the master switch | XS (1 line + a test) | One click, or one holder of the n8n secret, edits or deletes and re-posts a live order from a 3-10 week old plan |
| 3 | A heartbeat that does not run on n8n: a Vercel cron (`authorizeCronCall` already exists, `apiAuth.ts:165`) checks last capture, capture-to-decision lag, the last minute-sync finish and the last label run. It alerts by a non-n8n channel, and the sync route stops answering `ok: true` over errors. | Intake, sync, labels, the watchdog and alarms all share one platform | S | n8n down is silent to the owner. The only signal is the TV's dot, to staff, after 90 minutes. |
| 4 | Finish the intake move on v2's terms: make `/api/mail-poll` call `decideDelivery`, not `handleThread` (`mail-poll/route.ts:73,158`), then retire the n8n trigger | The owner is migrating intake to the Gmail API; the path that exists feeds the paused engine | M (2-3 days) | The migration either re-opens the old engine or lands on a 503 (`paused.ts:19`) |
| 5 | Retire the old engine in stages: move the OnSinch client and resolver helpers into shared modules, delete `pipeline`/`compiler`/`deps` and the dead branch of `project.ts`, and move or delete the 145 engine tests | 40% of app lines and two thirds of the suite guard code that does not decide mail; v2 imports it in 26 places | M-L (3-5 days) | Every change pays for code nobody runs; stale comments mislead; live old paths (change 2) keep turning up |
| 6 | Govern the switches: an admin role for `bot_writes_enabled` and the reply settings, every change stored with actor and time, and the owner alerted on any change | The write and auto-send switches are one staff click, with no record | S | Writes or client auto-send turned on with nobody able to say who did it |
| 7 | A Neon branch for Preview, and versioned migrations replacing the 33 runtime DDL sites | Preview code runs against production rows and schema | S-M | A preview deploy alters or pollutes production data |
| 8 | Tests for the minute path: `replanOpen`, `feed/live.ts` against PGlite, and the labels route end to end | That code runs every minute and decides what the TV shows | S | A regression in the re-planner silently clears or keeps cards |

---

## 5. Other things the owner should know

- **The gate is also the release.** Every gated push to `v2` deploys production (`CLAUDE.md:5-14`), and there is no staging. That is why every engagement patch, including the owner alert, sits undeployed in worktrees (`STATE.md:85`).
- **[M] A deploy can cancel a retry.** `retryStopped` re-runs only decisions made by the current build (`process.ts:129-130`). A deploy within 6 h of a stopped write cancels its retry, and no record says so.
- **[M] Partial writes stay silent.** The bot's record in the copy: 61 runs between 10-12 and 10-20.
  - 38 verified;
  - 20 blocked: 13 were deliberate signed-on-crew refusals, and 1 was a browser timeout;
  - 3 stopped part-way, leaving an order half changed.

  By design "unknown" is never re-sent (`bot/run.ts:7-10`), but a part-way stop raises no alarm, so it waits for someone to notice the card.
- **[M] Most mail is set aside by one model reading.** 419 of 958 decisions (44%) are "no change asked for", and they never reach the TV (`live.ts:80` lists only writes and hand-offs). OPERATING §9.2's "possibly not an inquiry" lane does not exist. This is where the measured silent misses come from (`STATE.md:99`: all 4 prospective misses are `none_nothing_to_do`).
- **[L] Reply headers go unread.** `in_reply_to` and `reference_ids` have been stored since 10-23, and v2 reads neither (`STATE.md:192,197`). They are the cheapest thread-to-order signal available.
- **[L] n8n can drift from the repo.** The workflows in n8n are built by installer scripts, and nothing checks that n8n still matches them. Checkpoint B lists them as "remembered, not re-checked" (`checkpoint-B-response.md:16`).
- **[L] Operational hazards in the repo.**
  - Worktrees p1, i14, n1, rd and rdh hold junctions into this checkout (`STATE.md:261-262`). A careless cleanup deletes through them.
  - The repo holds 922 tracked files, including 124 markdown files and about 5 MB of audit, eval and harness prose, beside 40k lines of app code. `CLAUDE.md:31-33` already records a retracted figure that outlived its retraction.
