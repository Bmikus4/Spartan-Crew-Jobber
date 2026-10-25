# Pipeline trace addendum: failure modes and logging for the stages pipeline-trace.md left open

- agent: stage-gaps
- brief hash: d279ecf8
- generated (UTC): 2026-10-25T21:51:36Z
- code: branch v2, HEAD f084d53. `git diff --stat 6a98170 HEAD -- app/` is empty (only `scripts/backfill-pause-window.mts` was added), so every `app/` line cited here is the same at 6a98170.
- data: `.tmp-data/gold/` (meta.json `taken_at` 2026-10-23T01:45:22.758Z). Stage numbers and boundaries are pipeline-trace.md §2.
- covered: S3 and S9 (failure modes), S5 (logging), and S10, S12, S13, S14, S15, S16, S17 (both).

Paths used in citations: `process.ts`, `links.ts`, `replan.ts`, `threadOrder.ts`, `trace.ts`, `read.ts`, `metrics.ts` are in `app/lib/v2/`, and `run.ts` is in `app/lib/v2/bot/`. `live.ts`, `serve.ts`, `v2.ts`, `project.ts`, `verify.ts`, `marksDb.ts`, `check.ts` and `cardNote.ts` are in `app/lib/feed/`. The routes are `sync/route.ts` (`app/api/bot/sync`), `labels/route.ts` (`app/api/bot/labels`), `bot/process/route.ts`, `feed/route.ts` (`app/api/feed`) and `feed/check/route.ts`. `onsinch.ts` and `pipeline.ts` are in `app/lib/engine/`. `threadLabels.ts` is in `app/lib/mail/`. `LiveFeedScreen.tsx` is in `app/components/`. `install-sync-workflow.mjs` and `_labelNodes.mjs` are in `scripts/`. The commands for every count are in Appendix A.

## Summary

1. **No stage from S3 on reports a failure to a person.** `app/lib/v2` and `app/api/bot` contain no `reportError` call and no `console.*` call (`grep -rln "reportError\|console\.\(error\|log\|warn\)" app/lib/v2 app/api/bot`: 0 files). `app/lib/feed` has four `console.error` lines, all in serve.ts (66, 81, 91, 99), and `feed/check/route.ts:19` adds one more. Those lines go to Vercel's logs, which errorReport.ts:4-6 records nobody opens. The trace sink in production is `noTrace` (process.ts:519; trace.ts:39-40). The only alarms on this path are intake's (n8nInbound.ts:71, 78).
2. **The minute sync's work (S12-S14) is recorded only in its HTTP answer, and nothing keeps that answer.** The route answers `ok: true` whatever its parts did (sync/route.ts:29-42). The n8n node uses `neverError` and continues on error (install-sync-workflow.mjs:31-35). Execution data is saved only if the workflow says so: the installer's default is `"none"` (install-sync-workflow.mjs:45), and 3 of the 5 backed-up sync workflows say `"none"`, 2 `"all"` (A9). The live workflow was not read, because that is a network call.
3. **Silent ends: an email with no card, no label and no alarm.**
   - Client mail stored more than 24 h before the undecided sweep reaches it is never decided (process.ts:235, 262). A pause, or a sync that is off or failing for a day, produces exactly that.
   - Mail sent more than 7 days before it was stored is skipped (process.ts:269).
   - Filtered senders: 53 of 847 decisions (31 sinch.cz no-reply, 11 mailer-daemon, 10 other no-reply, 1 spartancrew.co.uk; A1).
   - Rows a workstation records as `local` are hidden (live.ts:80) and count as decided (process.ts:263).
   - A carried older need that a replan answers leaves its card with no green mark (project.ts:425; v2.ts:187).
   - A card whose last job day passes leaves silently (project.ts:417), and its Gmail labels are stripped with it (threadLabels.ts:67-70).
4. **States that cannot go back.**
   - Every mark is insert-once (marksDb.ts:62-69), and only a tick can be removed (marksDb.ts:71-76). A replan's `resolved` green, or a verifier's `order-found` or `staff-edit`, therefore stays green even if the need returns. That includes a wrong match.
   - A need-created card whose `create_order` made the order but did not verify is closed by neither the verifier (verify.ts:301, 328) nor the replan (replan.ts:63). This is 3 of 27 `create_order` writes in the snapshot (A8).
   - "Order not found in OnSinch" cards cannot be ticked (check.ts:15).
   - No code writes the `dismissed` mark that project.ts:347 honours: its only writers are check.ts:28, live.ts:126 and verify.ts:312, 319, 407, 416.
5. **A replay erases a write's record.** Re-deciding a message through `POST /api/bot/process` upserts `executed = 'null'::jsonb`. `coalesce` does not treat jsonb null as SQL NULL, so the stored execution array is lost (process.ts:514-516). This was checked in an in-memory Postgres (A10). The intake alarm tells the reader to replay with that route (n8nInbound.ts:78).
6. **Jobs-board links are not re-checked.** The link sweep takes 40 links a minute, TV links first (links.ts:150-151). At the snapshot the 80 TV links had all been checked within the previous 1.8 min, and the 177 jobs-board links 1,039-1,871 min earlier (A6). Sweeps also never check whether an order is cancelled (links.ts:162-169; compare 130).
7. **The replan cannot see some rows.** It skips rows with no stored reading: 21 of 268 write/handoff rows (A7). It skips writes that sent anything: 52 of 69. It overwrites `replan` with no history and no build stamp (replan.ts:128).
8. **The verifier runs only while a screen polls `/api/feed`** (live.ts:118-124; labels/route.ts:43). Two cases can only be measured by running it:
   - a failed bot-identity read is cached for the life of the instance and makes the bot's own edits count as staff edits (verify.ts:73-74, 193-201);
   - more than 600 timeline rows between rounds are skipped for good (verify.ts:339, 365-366).
9. **Other behaviour that can only be known by running.** How often the sync overruns its 300 s (sync/route.ts:12), whether minute runs overlap, and how large `thread_labels` has grown (§S17).

---

## S3. Sender filter

**Failure modes.** The rule is a regex over the address only (process.ts:161, 163), applied in three places: intake (process.ts:192, 195), the undecided sweep (process.ts:275, 279) and `decideMessage` (process.ts:361). `is_from_spartan` comes from n8n's flag. When n8n gives no flag, or the mail came through a Google Group, it comes from an `@spartancrew.co.uk` address (threadMessagesDb.ts:205-211, 257-260).

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| F1 | A client's address contains `noreply`, `no-reply`, `onsinch`, `sinch.cz`, `postmaster`, `mailer-daemon` or `spartancrew.co.uk` anywhere, for example a web-form relay. | Records `none: not a client's email`. No model call is made (process.ts:195-201, 361-366). | No card, because the TV reads only write and handoff rows (live.ts:80). No label. The dashboard counts it as `filtered_out` (metrics.ts:32). | No, only in Gmail. Snapshot: 53 of 847 decisions. By address: sinch.cz no-reply 31, mailer-daemon 11, other no-reply 10, spartancrew.co.uk 1 (A1). 2 of the 53 were followed by a Spartan message on the same thread (A1). |
| F2 | Automated mail from an address the regex misses, such as `do-not-reply`, `donotreply`, `notifications@`, or an out-of-office from a person's own address. | Passes as a client. One model call. The headers that would mark it automated are not stored (pipeline-trace S1). | Usually `none: no change asked for`; a handoff if the model reads a request. | Only if it becomes a handoff card. Snapshot: 0 of 794 decisions past the filter have a sender matching `do-?not-?reply\|donotreply\|notifications?@\|alerts?@\|bounces?@\|mailer@\|automated\|auto-?reply` (A2). |
| F3 | Spartan's own mail (`is_from_spartan`). | Skipped with no `v2_decisions` row, at intake (process.ts:192, 195) and in the sweep (process.ts:260). | No row, by design. | n/a |
| F4 | A staff member writes from an address outside `@spartancrew.co.uk`, and n8n's flag is false or absent. | Read as a client (threadMessagesDb.ts:257-260). The full decision path runs. | Any decision kind. | Yes, if it becomes a card. |
| F5 | The INSERT of the filter row throws, for example on a database error. | `decideDelivery` throws before the newest client message is decided (process.ts:195-202). | Intake answers 500 and emails an `engine-threw` alarm (n8nInbound.ts:77-79). The sweep decides the client message after 10 min (process.ts:233, 261). | The alarm email only. |

**Logging.** Covered by pipeline-trace S3. Two additions:
- The row stores `from_address` (process.ts:199), so the matching alternative can be recomputed, but it is not recorded.
- The snapshot's decisions.json has `from_address` null on all 53 filter rows, so A1 joins messages.json instead.

Readers of these rows: the dashboard (metrics.ts:32), the sweep's existence check (process.ts:263), and its "overtaken" test, which excludes them (process.ts:285-286).

## S5. Context build

**Failure modes.** Covered by pipeline-trace S5. One addition: the thread lines are passed into `readContext` (process.ts:429). A failed OnSinch read makes `readRows` throw on any non-2xx answer (read.ts:22), and the `.catch(() => undefined)` at process.ts:429 then drops the bookings, the venues **and the earlier messages** together. The model gets `""` as context (process.ts:435). Grounding can then quote only the newest message (interpret.ts:104), so a value written only in an earlier message fails grounding. Staff see only the handoff that results, with a check such as "No date given" (cardNote.ts:33).

**Logging.**
- **Nothing about the context is stored.**
  - `v2_decisions.interpretation` holds `{extraction, grounded, meta}` (process.ts:460, 514).
  - The `ReadContext` is built (process.ts:429), rendered as text (process.ts:435; context.ts:61-70) and discarded: which bookings, shift ids, venues and thread lines the model saw is not kept.
  - There is no trace component for it (trace.ts:11), and the trace sink is off anyway (process.ts:519).
- **A failed context build leaves no trace.** It is swallowed at process.ts:429.
- **Indirect traces:**
  - `meta.input_tokens` (extract.ts:133) grows with the context.
  - Grounding notes record a pick dropped for not being among the shown bookings or venues (interpret.ts:239, 272). They live in `interpretation.grounded.notes`.
  - Some planner outcomes append those notes to the decision text (plan.ts:476, 540).
  - The TV note shows only fixed phrases (cardNote.ts:31-70, 79-86), so none of this reaches a screen.
- **The context cannot be rebuilt later from stored data.** The replan re-reads OnSinch as it is now (replan.ts:87), and pipeline-trace §0 had to rebuild it from the snapshot with an as-of filter.

## S9. Record

**Failure modes.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| R1 | No database URL, or the database is unreachable. | `db()` throws (process.ts:46-50) before the message is read (process.ts:489). | Intake answers 500 and sends an `engine-threw` alarm (n8nInbound.ts:77-79). The sweep retries, but it needs the same database (process.ts:257). | The alarm email. Repeats within 6 h are counted, not re-sent (errorReport.ts:66). |
| R2 | The decision upsert fails (process.ts:381). | `decideMessage` throws after the model call. Only `understand` is caught (process.ts:374). The earlier messages of the same delivery are not marked "read together", because that loop runs after the decision (process.ts:214-222). | No row. The sweep claims every message after 10 min and decides again, which is a second model call (process.ts:261-263, 289-293). If a later email on the thread was decided first, each becomes a "read it by hand" handoff (process.ts:285-290). | The alarm email. A card only through the sweep. |
| R3 | The per-op record after a write fails (process.ts:403). | Throws after OnSinch has changed, and later ops are not run. `executed` lacks the op that landed; only `bot_ledger` holds it (run.ts:260, 365). | A card that says "Not written, do it by hand" or "System stopped partway" (cardNote.ts:141-142) about a change OnSinch already holds. `retryStopped` ignores rows whose `executed` is not a JSON array (process.ts:130). | Yes, but with the wrong instruction, so staff may make the same change twice. |
| R4 | A decided message is decided again through `POST /api/bot/process` (bot/process/route.ts:13-18), the route the intake alarm names (n8nInbound.ts:78). | The upsert replaces kind, interpretation, decision, code_version and company (process.ts:515-517). `executed` is sent as `JSON.stringify(null)::jsonb`, which is jsonb `null` and not SQL NULL, so `coalesce(EXCLUDED.executed, ...)` keeps the null and drops the stored array (process.ts:514, 516). Checked in an in-memory Postgres (A10). | The original decision and its execution record are gone. A verified write's check card becomes "Not written, do it by hand" (v2.ts:76, 88-89; cardNote.ts:142), and the thread's fallback order id from `executed` is lost (threadOrder.ts:20-22). | The card changes. Nothing records the original. |
| R5 | A decision is made outside Vercel, for example by a workstation script against the production database. | `code_version` is `local` (process.ts:78). | Hidden from the TV and the replan (live.ts:80; replan.ts:80). The sweep sees a row and never revisits it (process.ts:263). | No. Snapshot: 0 `local` rows of 847 (A3). |
| R6 | Any later write to the same row (the sweep's claim then its decision, the replan, a retry). | Overwritten in place (process.ts:515-517; replan.ts:128; process.ts:153). The table has no `updated_at` (process.ts:54-67). | Only the latest state survives. `created_at` keeps the first insert, so a swept decision's `created_at` is the claim time. | No. |
| R7 | A "read together" INSERT fails after the newest message was decided (process.ts:217-220). | The remaining earlier messages have no row. | The sweep claims them and finds the thread overtaken by the newest decision. Each becomes a "read it by hand" handoff (process.ts:285-290) for an email that was in fact read. | An extra card with the note "Read the email" (cardNote.ts:73-76). |

Snapshot note: 140 of 847 rows have `code_version` set to `""`, all created between 10-09 10:07 and 10-11 19:01Z, before `deployed-unknown` existed (process.ts:73-78; A3).

**Logging.** Covered by pipeline-trace S9: the row is the log. Readers of `v2_decisions`:
- the TV (live.ts:76-80);
- the replan (replan.ts:76-80);
- the sweep (process.ts:263, 285);
- the retries (process.ts:129-130);
- the thread's order (threadOrder.ts:18-30);
- `prior` (process.ts:478-479);
- the dashboard (metrics.ts:50-51, 66-69).

## S10. Link

**Failure modes.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| L1 | The planner finds an order, but the thread already has a live link to another one. | `linkFound` returns `"kept"` (links.ts:78). The caller drops the return value (process.ts:389, 391, 509). | The card keeps the old order's R and J (v2.ts:143-148). | They see the old order, with nothing to say it was superseded. |
| L2 | The planner finds several orders. | Links `found[0]` only (process.ts:389). The comment first says several are left for a person, then revises to "first day first" (process.ts:386-388). | One order's R and J. | Yes, one order. |
| L3 | The OnSinch read inside `recordLink` gets a 5xx. GET is retried twice and then returned without throwing (onsinch.ts:76-78, 102-110); `recordLink` uses `rowsOf`, not `readRows` (links.ts:59). | Stores the link with `r_number`, `job_id` and `company_id` null and `shifts` empty (links.ts:60-64). | No R or J until the next sweep fills them (links.ts:188-189). `company_id` is never filled later (links.ts:184, 188). Both the R lookup and the rebuild search need it, and the rebuild also needs shifts (links.ts:169-175), so if that order is later rebuilt the link is held, not followed. | No, until it is held. Snapshot: 0 of 257 non-gone links have `company_id` null or empty shifts (A5). |
| L4 | An OnSinch timeout (12 s, onsinch.ts:31, 91-94) or a network error. | `recordLink` throws, and the throw is swallowed (process.ts:389, 391, 406; for retries, process.ts:151). | No link and no record of trying. A `none` decision is never retried, because the replan reads only write and handoff rows (replan.ts:80). An open card is retried by the replan each minute (replan.ts:133). | No. |
| L5 | The bot writes on a thread already linked to another live order. | `recordLink` has no displacement check (links.ts:57-65; process.ts:508). | The thread holds two live links, so the TV shows no R or J for it (live.ts:81-85). | It shows a job with no numbers. Snapshot: 0 of 255 threads with live links have two (A5). |
| L6 | No live link exists. | `linkedOrderId` falls back to an order id in any execution result, whatever its status, or in any write op, executed or not (threadOrder.ts:20-26). | A blocked or unwritten write's order becomes the thread's order for later emails. | Only through later cards. |
| L7 | A second link of the same thread and order arrives. | The upsert keeps the first `source` and `first_seen` (links.ts:61-64). | `source` says who linked it first. | n/a |

**Logging.**
- **The `job_links` row** (links.ts:37-41, 61-64) records `thread_id`, `order_id`, `r_number`, `job_id`, `company_id`, `state` and `source`, plus `shifts`, `first_seen`, `last_checked`, `held_since` and `note`.
  - Sources written by the app: `bot write`, `bot write (retry)`, `planner find`, `finder`, `planner`, `backfill` and `jobs board` (process.ts:151, 389, 391, 406; replan.ts:112, 124; links.ts:103, 136).
  - `staff copy` comes from a scratch script, not the app (`.tmp-v2/relink.mts:15`).
  - Snapshot, of 435 links: jobs board 355, bot write 28, planner find 22, finder 20, staff copy 6, backfill 2, planner 2 (A5).
- **A refused or failed link leaves no record.** The `"kept"` or `"same"` answer is dropped, errors are swallowed (L1, L4), and there is no trace event. The decision row holds the candidates (`decision.found`, `decision.order_id`), not the outcome.
- **Readers:**
  - the TV's R and J and the jobs-board tiles (live.ts:83-85, 103-108);
  - held cards (live.ts:93-99);
  - the planner's thread order (threadOrder.ts:28-29);
  - the sweeps and backfills (links.ts:101, 121, 150);
  - `testData.ts` and `threadState.ts` (`grep -rln job_links app`).

## S12. Minute retries and the undecided sweep

**Failure modes: `retryStopped`.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| T1 | `SPARTAN_PAUSED` is set. | Returns `paused` (process.ts:125). | The stopped write stays as recorded. Card: "System couldn't write it, do it by hand" (cardNote.ts:141-142). | Yes, the card. |
| T2 | Writes are off (`botWrites()` false). | Skips every row (process.ts:133, 140). | As T1. | Yes. |
| T3 | A deploy happened since the decision. | The row's `code_version` no longer matches this build, so it is never retried (process.ts:127-130). | As T1. | Yes, but not why. Snapshot: 20 distinct `code_version` values among 847 rows over 10-09..10-22 (A3). |
| T4 | The last status is `mismatch`, `unknown` or `seen`, or `blocked` with a reason outside `TRANSIENT`. | Never retried (process.ts:123, 139). This is by design for `unknown`. | "System couldn't write it" or "System stopped partway, check OnSinch" (cardNote.ts:142). | Yes. |
| T5 | Already tried twice, older than 6 h, or an op day before today in London. | Final (process.ts:130, 137, 140, 142). | As T4. | Yes. |
| T6 | A throw while retrying: `runOp`'s ledger read and lease sit outside its try (run.ts:253-255), or the UPDATE fails (process.ts:153). | There is no per-row catch (process.ts:134-155), so the remaining rows are skipped this minute. The sync answers `retry: {error}` (sync/route.ts:32). | Unchanged. | No. |
| T7 | The UPDATE fails after a retry that verified. | The next minute, the same `:retryN` key (process.ts:147) finds the ledger and returns `seen` "already verified" (run.ts:252-253). `seen` is never retried. | `executed` ends in `seen`, so the card says the write did not happen (v2.ts:76; cardNote.ts:141-142) while OnSinch has the change. | Yes, but wrong. |

Snapshot: 1 of 69 write rows carries `retries` (value 1), and its last status is `blocked` (A4).

**Failure modes: `sweepUndecided`.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| U1 | A client email stored more than 24 h ago with no decision. Causes include a pause longer than 24 h (process.ts:256), the n8n sync off for a day, or the route failing every minute. | Outside the window (process.ts:235, 262). | Never decided, never carded. This is the silent drop the sweep exists to prevent (process.ts:242-254), open again after 24 h. | No, only in Gmail. |
| U2 | Sent more than 7 days before it was stored, or a test sender or id. | Skipped (process.ts:237, 268-269). | No row, by design (backfill history). | No. |
| U3 | More than 2 threads waiting. | 2 threads a minute, oldest first (process.ts:264, 278-282). | The rest wait. Combined with U1, a backlog that ages past 24 h drops out. | No. |
| U4 | A later email on the thread has already been decided ("overtaken"). | Claims each email as a handoff: "this email was not decided when it arrived, and a later email on the thread was decided first: read it by hand" (process.ts:285-290). | A need card. There is no reading, so whether it is needs-created or needs-updated depends only on an R number in the subject or reason (v2.ts:86). The note is "Read the email" (cardNote.ts:73-76). | Yes. |
| U5 | Deciding throws. | Rewrites the claims to "..., and reading it again failed (...)" (process.ts:297-300). If that UPDATE fails too (`.catch`, 299), the claims keep "the system is reading it again" (287), although now that they have rows nothing reads them again (263). | As U4. | Yes, though the reason may be wrong. |
| U6 | Another writer records the newest email between the SELECT and the claim. | The earlier claims stay "the system is reading it again" and nothing reads them (process.ts:290). | As U4. | Yes, though the reason is wrong. |
| U7 | Writes are on. | The sweep decides with `execute = botWrites()` (process.ts:230, 293). `runWhenFree` waits up to 120 s (process.ts:311-316). | Two threads can use most of the sync's 300 s (sync/route.ts:12). If the function is killed, the replan and the test-data clear do not run that minute (sync/route.ts:36-41). | No. How often this happens can only be known by running. |

Snapshot: 0 sweep rows. Its last decision is 10-22 20:06Z, and the sweep shipped 10-23 (process.ts:243). (The 21 "arrived with a later client message" handoffs are the pre-10-11 rule, process.ts:204-208.)

**Logging.**
- **Retries:**
  - `v2_decisions.executed` is replaced and `decision.retries` set (process.ts:153).
  - Each retry adds `bot_ledger` rows under the source `<source>:retryN` (process.ts:147; run.ts:260).
  - `retries` is read only by `retryStopped` (process.ts:137; grep `retries` in app: no other reader).
  - `executed` is read by the TV (v2.ts:75-76; cardNote.ts:141-142) and the dashboard (metrics.ts:36-39, 66-69).
- **Sweep:**
  - The claim is a `v2_decisions` handoff row (process.ts:271-274, 289). A successful decision overwrites it (process.ts:511-517) and the earlier claims are rewritten to "read together" (process.ts:295).
  - So a successful sweep leaves no explicit mark. The only sign is `created_at` at least 10 min after `thread_messages.first_seen_at`, because `created_at` is not updated (R6).
- **Reports:** `{retried, results[]}` (process.ts:154-156) and `{threads, decided, carded, filtered}` (process.ts:240, 270) exist only in the sync's JSON answer (sync/route.ts:32-34, 42). Summary item 2 says why nothing keeps it.
- **No console or `reportError` call** (Summary item 1).

## S13. Replan

**Failure modes.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| P1 | No stored reading: the read failed, "could not decide", a sweep claim, or a pre-10-11 "arrived with a later client message" handoff. | Never replanned (replan.ts:62). | The card stays as first decided until a tick, its last day passing, or 14 undated days (project.ts:417, 442). | Yes, but it never updates. Snapshot: 21 of 268 write/handoff rows since V2_FROM have no stored reading, all "arrived with a later client message" (A7). |
| P2 | A write that sent anything, whatever the status. | Never replanned (replan.ts:63). | A blocked or mismatched write's red card stays after staff book the job by hand, until a tick or a verifier staff-edit (verify.ts:328, 402-411). The verifier skips needs-created (V6). | Yes. Snapshot: 52 of 69 writes executed (A7). |
| P3 | Many open cards. | 20 rows a minute, oldest-replanned first, 90 s budget (replan.ts:75, 84-91). | Each card is re-read at most every ⌈cards/20⌉ minutes. 155 rows on 102 threads pass the first three tests of `open()` at the snapshot. The day test needs grounding, which the snapshot lacks, so a full pass is at most 8 minutes. | No. |
| P4 | OnSinch fails during the replan. | The plan throws, and `decideMessage` turns that into the handoff "the system could not plan this email (...)" or "could not decide" (process.ts:374-378, 453-458), stored as the replan (replan.ts:127-129). Failed cache entries are dropped (replan.ts:40). | That minute the card's note becomes "Read the email" (cardNote.ts:73-76). Items already green stay green (project.ts:349, 355-359). | Yes, as the changed note. |
| P5 | A replan turns a need into `none`, and a later replan turns it back into a need, for example after staff remove what was matched. | The `resolved` mark is insert-once and green (project.ts:426-431; marksDb.ts:62-69), and only `checked` can be removed (marksDb.ts:71-76). | The item stays green and leaves after 24 h (project.ts:441). The returned need is never shown red. | No. |
| P6 | The replan's "already booked" match is wrong (plan.ts:710-747, `again: true`). | Turns the item green and links that order (replan.ts:124, 133). | Green with "Already booked in OnSinch: R..." (v2.ts:133, 159), on the wrong order. | It looks done. |
| P7 | A later decision on the thread answers an older need (v2.ts:199-210). | The need leaves `rowsOnCard` (v2.ts:184-189) and is never replanned (replan.ts:84). | V7. | No. |
| P8 | The sync function is killed before the replan step. | No replan that minute (sync/route.ts:12, 36). | Unchanged. | No. Can only be known by running. |

**Logging.**
- **`v2_decisions.replan` and `replanned_at`** (replan.ts:56, 128-131).
  - The replan is overwritten on change and has no history.
  - `code_version` is not updated (replan.ts:128; compare process.ts:514), so which build produced a replan is not recorded.
- **Links** go through `linkFound` (S10).
- **`{cards, planned, changed, linked, notes}`**, including per-thread errors (replan.ts:134-136) and the budget stop (replan.ts:91), exists only in the sync answer (sync/route.ts:36, 42).
- **Readers:**
  - `replan` is read by the TV and `rowsOnCard` (v2.ts:103, 192) and by the replan itself (replan.ts:119).
  - `replanned_at` is read only in replan.ts (`grep -rln replanned_at app`).
  - The only trace a screen shows is the green text "Already booked in OnSinch: R..." (v2.ts:133, 159; project.ts:429).
- **The snapshot cannot measure the replan.** Its decisions.json has neither `replan` nor `replanned_at` (A3 prints the field list).

## S14. Link sweeps

**Failure modes.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| K1 | At least 40 TV links are eligible every minute. | 40 a minute, unchecked for 50 s, TV links before jobs-board links (links.ts:145, 150-151). Jobs-board links are not reached. | Jobs-board tiles take their R and J from these links (live.ts:103-108; serve.ts:100-101), so a tile can name an order deleted since. | No. Snapshot: 80 TV links checked within the previous 1.8 min; 177 jobs-board links 1,039-1,871 min earlier (A6). |
| K2 | An OnSinch read fails (5xx after retries, or a throw). | The link is left as it was, with a note (links.ts:153-155, 197-199; read.ts:22). | Unchanged. | No. |
| K3 | The order has been cancelled (status -1) but still exists. | Sweeps A and B accept it (links.ts:162-169). Only `backfillBoardLinks` checks status (links.ts:130). `shape()` drops cancelled slots only (links.ts:52). | The card keeps a cancelled order's R and J as if it were live. | They see the wrong state. |
| K4 | The order is gone and the rebuild is not an exact copy: a shift changed, two candidates, or the rebuild is not among the client's newest 30 orders. | Held (links.ts:170-178, 192-195). Two candidates produce only a note (links.ts:177). | After 30 min an "Order not found in OnSinch" card (links.ts:25; live.ts:90-100; serve.ts:121-127), with item key `held:...`, which cannot be ticked (check.ts:15, 26-27). It leaves when the link is relinked, another live link appears (live.ts:98), the thread has a listed card (serve.ts:121) or all its days pass (serve.ts:121). | Yes. Snapshot: 2 held links, both from bot writes, held since 10-15 and 10-20. One's day has passed, so it is off the TV but still swept every minute (state not `gone`, links.ts:150). The other has days on 2026-11-18 (A5). |
| K5 | The R number has been reused by another client. | Refused by the company check (links.ts:169). | Held, as K4. | Yes, as K4. |
| K6 | A jobs-board read throws. | `backfillBoardLinks` has no per-row catch (links.ts:127-138), so the rest are skipped. The sync answers `board: {error}` (sync/route.ts:30). A `gone` row is never asked again (links.ts:131-132, 150). | Unchanged. | No. Snapshot: 178 `gone`, all jobs board (A5). |
| K7 | Minute runs overlap. The sync may take up to 300 s, and n8n fires every minute. | There is no claim column, so two sweeps can read and update the same links. | Possibly conflicting updates. | No. Can only be known by running. |

**Logging.**
- **`job_links`** records `state` (linked, relinked, held, gone), `last_checked`, `held_since` and `note` (links.ts:132, 184-194).
  - `note` is overwritten, is not cleared by a later good check, and `relinked` persists (links.ts:188-189).
  - Snapshot, of 435: linked 249, relinked 6, held 2, gone 178 (A5).
- **`{checked, linked, relinked, held, notes}`** and the backfill counts exist only in the sync answer (links.ts:142; sync/route.ts:29-31, 42).
- **Readers:**
  - `held()` selects `note` (live.ts:94), but the held card's text is built from `r_number` alone (serve.ts:126), so `note` reaches no screen.
  - `held_since` puts a card on the TV after 30 min (live.ts:97).
  - `state` is read by the TV's link query, the jobs-board links and the thread's order (live.ts:84, 107; threadOrder.ts:29).
- **No console or `reportError` call** (Summary item 1).

## S15. TV projection

**Failure modes.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| V1 | A base read fails: states, inbound, marks, replies or v2. | 500 "could not read the feed" (serve.ts:61-68). | The TV keeps its last tiles and its sync dot goes red, "the feed returned an error" (LiveFeedScreen.tsx:386-414, 587). A network failure turns it grey (LiveFeedScreen.tsx:382-385). | Yes, the dot. |
| V2 | A side read fails. | No log for `held()` (serve.ts:117), `links()` (100), `portedStates` (101), `verifyStatus` (96) or `intakePaused` (131). The jobs board logs (99). | A failed `held()` hides every "Order not found" card. A failed `intakePaused` read during a deliberate pause shows intake as stale (serve.ts:140), turning the dot red with "no new email for 90+ min" (LiveFeedScreen.tsx:549-553, 587). | Missing cards with no signal, or a false red dot. |
| V3 | Writing the remembered marks fails. | `console.error`. Marks are inserted one at a time (live.ts:126), so some may be stored (serve.ts:74-83). | A need resolved meanwhile leaves without going green. | No. |
| V4 | Not admitted. | `none` decisions produce no item (v2.ts:109; live.ts:80). Rows marked `local` and rows before V2_FROM are excluded (live.ts:70, 80), and so are items older than FEED_FROM (project.ts:75, 435). | No card. | No. |
| V5 | A verified bot write, or a needs-reply. | Carded but not listed (serve.ts:109-116). Counted instead. | A count, plus a label for writes (S17). | A count only. |
| V6 | The last job day passes, the card is undated and quiet for 14 days, or the thread is "dismissed". | Dropped (project.ts:417, 442, 409). | Leaves silently. "Dismissed" is dead code: nothing writes that mark (writers of `feed_marks`: check.ts:28, live.ts:126, verify.ts:312, 319, 407, 416). | No. |
| V7 | A replan answers a carried older need with `none`. | Only the lead source is compared with the thread's newest `open` mark (project.ts:381-387, 425). The need leaves `rowsOnCard` (v2.ts:187, 193-197). | The item disappears from the card with no `resolved` mark and no green state. | The item vanishes. |
| V8 | The thread is linked to two live orders. | Shows no R or J (live.ts:81-85). | A job with no numbers. | Yes. Snapshot: 0 such threads (A5). |
| V9 | A handoff with no reading: the read failed, "could not decide", or a sweep claim. | The kind is chosen from R numbers in the subject and reasons only (v2.ts:86). The note uses fixed phrases, otherwise "Read the email" (cardNote.ts:73-76). | A new booking with an R in its subject shows as needs-updated. | Yes. |

**Logging.**
- **`feed_marks` `open`** (`by` null, `evidence` null) **and `resolved`** (`evidence {text}`) (project.ts:429, 505; serve.ts:76-79; marksDb.ts:62-69).
  - Insert-once; `at` is the first sighting.
  - Written only by `GET /api/feed` (live.ts:126). The labels route and the dashboard pass no `remember` (labels/route.ts:43; metrics.ts:61-64), so while no screen is open nothing is remembered.
  - Readers: `project()` on every refresh (project.ts:347-387) and the dashboard's queue (metrics.ts:63-76).
- **`console.error`** on read, remember, verify and jobs failures (serve.ts:66, 81, 91, 99). No `reportError`.
- **The answer is not stored** (`counts`, `health`). Nothing records what the TV listed at a given time; pipeline-trace Appendix A had to re-run `serveFeed`.
- `feed_marks` is not in the snapshot (the `.tmp-data/gold` file list), so mark counts are unknown offline.

## S16. Verifier and tick

**Failure modes: the verifier.**

| # | trigger | what the stage does | email / card ends as | staff see it? |
|---|---|---|---|---|
| W1 | No screen is polling `/api/feed`. | The verifier is wired only there (live.ts:118-124; serve.ts:86-94). The labels route switches it off (labels/route.ts:43), and the dashboard does not call it (metrics.ts:61-64). | Needs wait for a person or a replan. | No. |
| W2 | The bot-identity read `GET /users/profile` fails. | Gets null, and the promise is cached for the instance's life (verify.ts:193-201). The bot's own timeline rows then pass the filter (verify.ts:73-74), and the stamp check is skipped (verify.ts:385). | The bot's own created-check and updated-check items are marked `staff-edit` green at the next round (verify.ts:357-363, 402-411), and their labels come off. | It looks done. How often can only be known by running. |
| W3 | More than 600 timeline rows since the cursor, for example about 6.7 h of staff edits at the "~90 an hour" in verify.ts:33. | Reads at most 6 pages back (verify.ts:34, 339), then moves the cursor to the newest row (verify.ts:365-366). Already-stamped items are not stamp-checked again (verify.ts:383-388). | Staff edits in the gap never close their items. | No. Can only be known by running. |
| W4 | The timeline cannot be read. | Note "timeline unreadable (...), used order stamps". Every watched item is stamp-checked each round (verify.ts:368-371, 388). | Same results by a slower path. | Yes: red dot, "OnSinch could not be read" (LiveFeedScreen.tsx:550, 587). |
| W5 | The 8 s budget (verify.ts:32) runs out inside the route's 30 s (feed/route.ts:2). | The matcher or stamp check stops, with a note (verify.ts:305, 389). | Waits for the next round. | No. |
| W6 | A needs-created card that has an order id, i.e. a `create_order` that made the order but did not verify. | The matcher skips cards with an order id (verify.ts:301), and the staff-edit watch excludes needs-created (verify.ts:328). The replan skips it too (replan.ts:63). | Stays red until a tick, its day passing, or 14 undated days. | Yes. Snapshot: 3 of 27 `create_order` writes, all `mismatch` (A8). |
| W7 | A card carries older needs. | Only the first non-reply item is watched (verify.ts:98-101; items order at project.ts:482). | Carried needs are never matched or edit-checked. | Yes, they stay red. |
| W8 | A wrong match by reference, date and venue, or shift times (verify.ts:220-270). | `order-found` closes a needs-created item (verify.ts:311-316). For updates, staff edits on the matched order close it (verify.ts:317-320, 357-363). Comments record measured wrong finds (project.ts:352-354; verify.ts:260-262). | Green on the wrong order. Insert-once, so the TV cannot undo it (marksDb.ts:62-76). | It looks done. |
| W9 | The verifier throws. | `console.error`, note "verify failed: ...", and the feed is served anyway (serve.ts:86-94). | Unchanged. | Yes, the red dot. |

**Failure modes: the tick.**

| # | trigger | what happens | staff see it? |
|---|---|---|---|
| C1 | Not signed in. | 401 (feed/check/route.ts:12-13). | Through C4. |
| C2 | The item is a needs-reply, `reply:...` or `held:...` item. | 400 (check.ts:15, 26-27). Held "Order not found" cards and reply items cannot be ticked. | Through C4. |
| C3 | Database error. | 500 and `console.error` (feed/check/route.ts:15-21). | Through C4. |
| C4 | Any of the above. | The TV ticks optimistically and never reads the POST's status (LiveFeedScreen.tsx:500-514). On the reload that follows, the tile turns back with no message. | The tick quietly undoes itself. |
| C5 | Untick. | Deletes the row (marksDb.ts:71-76). Nothing records that the tick existed or who removed it. | No. |
| C6 | Some items on the card are ticked. | The card goes green, and its labels come off, only when every item is green (project.ts:483; threadLabels.ts:49). | Yes. |

**Logging.**
- **`feed_marks`**, insert-once (marksDb.ts:62-69):
  - `checked`: `by` is the caller's identity, `evidence {name}` (check.ts:28; feed/check/route.ts:16);
  - `order-found`: `{text, order_id, r_number, by}` (verify.ts:312-315);
  - `matched`: `{order_id, r_number, j_number, text}` (verify.ts:319);
  - `staff-edit`: `{text, at, creator}` or `{text, held: true}` (verify.ts:407-410);
  - `stamps`: no evidence (verify.ts:416).
- **`feed_meta`** row 1 holds `last_verify_at`, `timeline_last_id` and `verify_note`, overwritten every round (marksDb.ts:36-43, 84-100; verify.ts:421-423).
  - A round that found nothing leaves only that note.
  - The timeline rows read and the bot identity used are not recorded.
- **Readers:**
  - `project()`, for green and the text a green item shows (project.ts:349-360, 371-376);
  - `verify()`, for `matched` and `stamps` (verify.ts:287-290, 383);
  - `verifyStatus`, which feeds `health.verify` (serve.ts:96, 145) and so the TV's sync dot (LiveFeedScreen.tsx:550);
  - the dashboard's queue (metrics.ts:63-76).
- **`console.error`** at serve.ts:91 and feed/check/route.ts:19. No `reportError`.

## S17. Labels

**Failure modes.**

| # | trigger | what the stage does | thread ends as | staff see it? |
|---|---|---|---|---|
| G1 | Unauthorized, paused, or the feed cannot be read. | 401 or 503 (labels/route.ts:25, 27, 43-44). n8n's "Ask the app" continues on error without `neverError` (_labelNodes.mjs:49-54), so no threads are planned. | Labels unchanged this minute. | No alarm. |
| G2 | More than 150 threads changed. | Cap of 150 per run (labels/route.ts:15, 53). | The rest wait. | No. |
| G3 | n8n dies after the app hands labels out but before "Report refused". | In live mode the app remembers a thread as soon as it hands it out, before Gmail applies anything (labels/route.ts:55-60). | Wrong until the hourly full resend at UTC minute 0 (labels/route.ts:51-52). A refusal that is reported is forgotten and resent next minute (labels/route.ts:36-39; _labelNodes.mjs:82-87). | No. |
| G4 | The Gmail credential is dead. | Every modify is refused and reported, so every thread is forgotten and resent each minute, indefinitely. The v2 path never raises `label-failed` (errorReport.ts:56-58; its only caller is pipeline.ts:644). | Stale labels. | No alarm. |
| G5 | The hourly full resend. | Every remembered thread is compared against "(resend)" (labels/route.ts:52). `thread_labels` is never pruned except for refused threads (labels/route.ts:36-39), so threads that left the TV long ago get a remove-all every hour (threadLabels.ts:67-70), capped at 150 with current cards first (threadLabels.ts:60-71). | Past 150 rows, the hourly correction misses departed threads. How large `thread_labels` is cannot be known offline. | No. |
| G6 | A card leaves for any reason, including its job day passing unresolved (project.ts:417). | All four order labels and Needs Follow Up are removed (threadLabels.ts:67-70). | No label. | The label vanishes with nobody having acted. |
| G7 | The card is a needs-reply, or a held card. | needs-reply has no order label (threadLabels.ts:40-46). A held card is labelled "Order Needs Updated" (serve.ts:123, 152). | As stated. | Yes. |
| G8 | Only some of a card's items are ticked. | The label follows the highest-ranked open item (threadLabels.ts:48-52). | A ticked lead plus an open carried need keeps that need's label. | Yes. |
| G9 | Every run. | The R number sent with each thread is unused by n8n (_labelNodes.mjs:36-46). The label steps run whether or not the sync step failed (install-sync-workflow.mjs:31-35, 41-42). | n/a | n/a |

**Logging.**
- **`thread_labels`** (`thread_id`, `order_label`, `follow_up`, `applied_at`) (labels/route.ts:32, 57-58).
  - It records what the app **handed out**, not what Gmail applied: one row per thread, overwritten.
  - Only this route reads it (`grep -rln thread_labels app scripts`: one file).
- **The JSON answer** (labels/route.ts:61-66) goes to n8n and is kept only according to the workflow's save setting (Summary item 2).
- **Refusals** leave only the DELETE (labels/route.ts:36-39): no count and no alarm.
- **No console or `reportError` call** in labels/route.ts or threadLabels.ts.

---

## Appendix A: commands (repo root, Git Bash, offline; each prints counts only)

```bash
# A1 filter rows by address pattern, and how many were followed by a Spartan message on the thread
node -e "const d=require('./.tmp-data/gold/decisions.json'),M=require('./.tmp-data/gold/messages.json'),m=new Map(M.map(x=>[x.message_id,x]));const P={sinch:/sinch\.cz/i,daemon:/mailer-daemon/i,noreply:/no-?reply/i,spartan:/spartancrew\.co\.uk/i};const f=d.filter(x=>x.decision.reason===\"not a client's email\");const c={};let r=0;for(const x of f){const a=String(m.get(x.message_id).from_address);const k=Object.keys(P).find(k=>P[k].test(a));c[k]=(c[k]||0)+1;if(M.some(y=>y.thread_id===x.thread_id&&y.is_from_spartan&&y.date_iso>x.sent_at))r++}console.log(f.length,c,r)"
# A2 automated-looking senders past the filter
node -e "const d=require('./.tmp-data/gold/decisions.json'),m=new Map(require('./.tmp-data/gold/messages.json').map(x=>[x.message_id,x]));const N=/spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i,A=/do-?not-?reply|donotreply|notifications?@|alerts?@|bounces?@|mailer@|automated|auto-?reply/i;let n=0,h=0;for(const x of d){const a=String(m.get(x.message_id)?.from_address||'').replace(/.*</,'').replace(/>.*/,'');if(N.test(a))continue;n++;if(A.test(a))h++}console.log(h,'of',n)"
# A3 code_version values, local rows, empty rows and their dates; decision field list
node -e "const d=require('./.tmp-data/gold/decisions.json');const e=d.filter(x=>x.code_version==='').map(x=>x.created_at).sort();console.log(new Set(d.map(x=>x.code_version)).size,d.filter(x=>x.code_version==='local').length,e.length,e[0],e[e.length-1],d.length,Object.keys(d[0]))"
# A4 write rows that carry retries
node -e "const w=require('./.tmp-data/gold/decisions.json').filter(x=>x.kind==='write');console.log(w.length,w.filter(x=>x.decision.retries).map(x=>[x.decision.retries,(x.executed||[]).map(e=>e.status)]))"
# A5 links: state, source, held, live threads with two orders, null company / empty shifts
node -e "const l=require('./.tmp-data/gold/links.json');const c=(f)=>l.reduce((o,x)=>(o[f(x)]=(o[f(x)]||0)+1,o),{});const live=l.filter(x=>x.state==='linked'||x.state==='relinked'),t={};for(const x of live)(t[x.thread_id]=t[x.thread_id]||new Set()).add(String(x.order_id));const ng=l.filter(x=>x.state!=='gone');console.log(l.length,c(x=>x.state),c(x=>x.source),Object.keys(t).length,Object.values(t).filter(s=>s.size>1).length,ng.length,ng.filter(x=>x.company_id==null||!(x.shifts||[]).length).length,l.filter(x=>x.state==='held').map(x=>[x.source,x.held_since,(x.shifts||[]).map(w=>String(w).slice(0,10))]))"
# A6 minutes since each link was last checked, at the snapshot instant
node -e "const l=require('./.tmp-data/gold/links.json'),T=Date.parse('2026-10-23T01:45:22.758Z');const g=f=>{const a=l.filter(f).map(x=>(T-Date.parse(x.last_checked))/6e4).sort((a,b)=>a-b);return[a.length,a[0].toFixed(1),a[a.length-1].toFixed(1)]};console.log(g(x=>x.state!=='gone'&&x.source!=='jobs board'),g(x=>x.state!=='gone'&&x.source==='jobs board'))"
# A7 replan candidates: rows since V2_FROM, without a reading, executed writes, passing the first three tests of open()
node -e "const d=require('./.tmp-data/gold/decisions.json'),r=new Set(require('./.tmp-data/gold/readings.json').map(x=>x.message_id));const V=Date.parse('2026-10-09T10:20:00Z'),F=Date.parse('2026-10-10T00:00:00+01:00');const rows=d.filter(x=>(x.kind==='write'||x.kind==='handoff')&&x.code_version!=='local'&&Date.parse(x.created_at)>=V);const ex=x=>x.kind==='write'&&Array.isArray(x.executed)&&x.executed.length;const p=rows.filter(x=>r.has(x.message_id)&&!ex(x)&&Date.parse(x.sent_at)>=F);console.log(rows.length,rows.filter(x=>!r.has(x.message_id)).length,d.filter(ex).length,d.filter(x=>x.kind==='write').length,p.length,new Set(p.map(x=>x.thread_id)).size)"
# A8 create_order writes that made an order but did not fully verify
node -e "const w=require('./.tmp-data/gold/decisions.json').filter(x=>x.kind==='write'&&x.decision.ops.some(o=>o.op.kind==='create_order'));const e=x=>Array.isArray(x.executed)?x.executed:[];console.log(w.length,w.filter(x=>e(x).some(r=>Number(r.detail?.order_id)>0)&&!(e(x).length===x.decision.ops.length&&e(x).every(r=>r.status==='verified'))).map(x=>e(x).map(r=>r.status).join(',')))"
# A9 save setting of each backed-up sync workflow
for f in n8n/backups/sync-*.json; do node -e "const w=require('./$f');console.log('$f',w.settings.saveDataSuccessExecution)"; done
# A10 jsonb null versus coalesce, in an in-memory Postgres (no network, nothing written to disk)
node --input-type=module -e "import {PGlite} from '@electric-sql/pglite';const db=new PGlite();await db.exec('CREATE TABLE t (id text primary key, executed jsonb)');await db.query('INSERT INTO t VALUES (\$1,\$2::jsonb)',['a',JSON.stringify([{status:'verified'}])]);await db.query('INSERT INTO t VALUES (\$1,\$2::jsonb) ON CONFLICT (id) DO UPDATE SET executed = coalesce(EXCLUDED.executed, t.executed)',['a',JSON.stringify(null)]);console.log((await db.query('SELECT executed IS NULL AS sql_null, jsonb_typeof(executed) AS ty FROM t')).rows)"
```

Results at the time of writing:
- A1: 53, {sinch 31, daemon 11, noreply 10, spartan 1}, 2.
- A2: 0 of 794.
- A3: 20 distinct values, 0 `local`, 140 empty (2026-10-09T10:07:34Z to 2026-10-11T19:01:48Z), 847 rows.
- A4: 69 writes; [[1, [blocked]]].
- A5: 435 links.
  - State: linked 249, relinked 6, held 2, gone 178.
  - Source: jobs board 355, bot write 28, planner find 22, finder 20, staff copy 6, backfill 2, planner 2.
  - 255 threads with live links, 0 with two live orders. 257 non-gone links, 0 with a null company or empty shifts.
  - Held: [bot write, 2026-10-15, day 2026-10-15] and [bot write, 2026-10-20, days 2026-11-18].
- A6: TV links [80, -0.2 to 1.8 min; the negative age is a check made while the snapshot was being copied]; jobs-board links [177, 1,038.8 to 1,870.7 min].
- A7: 268 rows, 21 with no reading, 52 of 69 writes executed, 155 rows on 102 threads.
- A8: 27 `create_order` writes, 3 partial (mismatch, mismatch, mismatch).
- A9: 3 `none`, 2 `all`.
- A10: `[{sql_null: false, ty: "null"}]`.
