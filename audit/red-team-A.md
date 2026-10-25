# Red team A: what is wrong with the Checkpoint A conclusions

- Agent: red-team-A
- Brief hash: 9ed3bb6c
- Written: 2026-10-25T01:44Z (UTC, the box's `date -u`)
- Code at 6a98170 (branch v2; `origin/main` is the same commit). Data: `.tmp-data/gold/` (taken 2026-10-23T01:45Z), `.tmp-data/week-review-1014.json`, `.tmp-data/week-truth*.json`. Read only. No network, no credentials, no model call, no git write. The harness was run only in-process with the oracle reader. Scratch scripts lived in `.tmp-v2/redteam/` and are deleted. The script that reproduces the data hits is in the appendix.

## Summary (ranked by how much each hit would change the owner's decision)

The no-revert conclusion survives, and so do most of the headline numbers. I reproduced 227/500, 114/500 and the 71 crash-passes at fb01342, and 304/154 at HEAD. I also reproduced 9 creates equal to staff's order, 14 of 16 rebuilt, 10 deleted, the 84 arithmetic and the 98.8% interval. What fails is the case for the highest-leverage move, and the claim that production is healthy as it stands.

1. **The move's gain is measured in a regime the same proposal keeps switched off.** With writes off, an unexecuted write is already a listed needs-created/needs-updated card (`app/lib/feed/v2.ts:89`). So there are no hidden bot creates to list. The table's wide 19→4, durable 4→13 and "listed creates 9/12" rows have no object until writes return, which the stabilization section defers until Phase 1. (changes-the-decision)
2. **The move reverses two enforced owner rulings, and the checkpoint says it does not.** "It is not an owner ruling" is contradicted by `serve.ts:103-106` (the owner, 10-13: bot-made orders and questions are "counted, not shown"), by register entries B32 and B30(6) (`audit/history-and-assumptions.md:210,212`), and by commit 1f3ae9a's body. (changes-the-decision)
3. **The 4 strict silent misses reached staff, and the move would have changed none of the 4 outcomes.**
   - Staff acted on all 4 within 0.30-0.97 h.
   - Our mailbox answered all 18 needs-reply emails of the week, at a median of 0.19 h.
   - A needs-reply item leaves the TV when our email follows (`project.ts:439`). So under the move, 2 of the 3 would have left the TV before staff started the booking.
   - "4 reached nobody" is false as worded. (changes-the-decision)
4. **The only natural experiment on visibility argues against the move's adoption premise.**
   - Gmail labels reached bookings threads from 10-16 04:37Z (S-0191), not "since 10-15".
   - 8 of the 14 rebuilds came before any label existed.
   - Every create made after labels went live was still rebuilt or deleted: 6 of 6.
   - "Up to 13/84 if staff confirm" assumes adoption that 6 of 6 did not show. (changes-the-decision)
5. **The silent-miss metric, and health check 4, cannot see the §4 worst case.**
   - The denominator is "real inquiries with staff work", so a request that neither the system nor staff acted on is excluded by construction.
   - 246 "nothing to do" emails (95 of them with no reply from our mailbox either) and 45 no-work handoffs were never read.
   - 95.2% is recall among the requests staff caught anyway. (changes-the-decision)
6. **"Keep production exactly as it is" keeps `intake_paused=true`.**
   - That setting switches off the TV's only intake alarm (`serve.ts:140`).
   - It shows the office "Intake Paused" (`LiveFeedScreen.tsx:259-260`), and the Help assistant tells staff that "new emails are not being read" (`help/liveState.ts:19`). Intake is in fact live.
   - Health check 2 reads `thread_messages`, so it cannot see mail that never got stored. That is the 08-26 failure mode (`intakeHealth.ts:1-8`).
   - This conflicts with the owner's "nothing is supposed to be stopped". (changes-the-decision)
7. **Durable completions are 3/84, not 4/84. New bookings have 0 durable completions, not "1 in 59".** The counted create, R11562, has been gone since 10-15. The one bot create that survived (R11552) is bucketed label_wrong. (changes-a-number)
8. **"12 bot creates were correct" is 9 equal by day, times and crew, and 7 of those also equal by trade split.** The 2 "completed" creates differ from staff's order in times and crew. (changes-a-number)
9. **The label_wrong verdicts that set the strict count rest on one agent's reading.**
   - In 6 of the 31 "asked for nothing" emails, a staff act falls on a day the email itself names.
   - The "independent check" also scores the one confirmed real miss as unbacked, so it cannot tell a real miss from a label error. (changes-a-number)
10. **Every live-week figure is relabelled data presented as measurement.** One agent relabelled 37 rows and added 16 by its own rule, and only 14 of 117 were re-checked, without the text. Meanwhile other figures are discounted elsewhere as "relabelled". (changes-a-number)
11. **The rest change smaller numbers or wording.**
    - Client resolution is 89.1% as a replay, but 85.9% and 82.2% in what production actually decided, with 2 wrong-company decisions.
    - At most 15 of the 23 "parser fixes" are parser-side.
    - One of the 7 company-null emails resolves at HEAD.
    - The residual of the wide reading is internally inconsistent.
    - The rest is tier wording, Q6 figures that do not match the live-state file, and the 53% figure, which is a projection.

---

## Detail: one entry per hit

### H1. The expected gain describes writes-on production; the recommendation keeps writes off
- **Claim.** "Expected gain, live week ... silent_miss_count (wide) 19 → 4 ... listed creates: at least 9/12 equal ... durable completions 4/84 → up to 13/84" (`audit/checkpoint-A.md:39-49`). "Writes stay off until Phase 1 shows the §4 gates on real mail" (`checkpoint-A.md:20`). "On the live week: strict silent misses 4 to 1, and work no one sees 19 to 4" (`audit/alignment.md:51`).
- **What is wrong.** The wide-reading misses are verified bot writes that the TV hides as `created-check`/`updated-check`. A verified write exists only when writes are on. With writes off, `classify()` turns every write decision into `needs-created`/`needs-updated` (`app/lib/feed/v2.ts:88-89`), and `isFailure` lists those (`serve.ts:109`). That is production today: 22 write decisions, none executed (`audit/live-state-2026-10-24.md:11`). In the state the checkpoint recommends, the move has no create to list and cannot add a single durable completion. What remains is listing needs-reply items, and H3 shows that part changes no outcome on the measured week. The two parts of the proposal assume opposite regimes, and the gain table does not say which one it applies to. A different bucket is larger in the recommended state. Parse failures (23) and wrong actions (13) are decision errors that week-review can grade in shadow ("planned, not sent", `scripts/week-review.mts:61-62`). The move's visible effect in shadow is 3 emails a week.
- **Evidence.** `v2.ts:88-89`, `serve.ts:109,115`, `live-state-2026-10-24.md:11`.
- **Severity.** changes-the-decision.

### H2. "It is not an owner ruling" is false: hiding questions and bot-made orders is the owner's enforced 10-13 rule
- **Claim.** "This leak was already on record on 10-21 ... It is not an owner ruling." (`checkpoint-A.md:31`). The owner's list asks only to "authorize the hand-over display change" (`alignment.md:60`).
- **What is wrong.**
  - `serve.ts:103-106` quotes the owner on 10-13: "Only those cases should be moved to the display TV". It then states that "an order the bot made or changed is the system's own work and a question is answered from the inbox; both are counted, not shown".
  - The historian's register records B32 (10-13), "The TV shows only what the system could not do", as **enforced** (`history-and-assumptions.md:212`). It also records B30(6), "only that reaches the TV" (`:210`).
  - Commit 1f3ae9a's body says: "Needs Reply is still counted, not listed: [the owner's] 10-13 rule is that the TV shows only what the system could not do."
  - The move therefore asks the owner to reverse two of his own enforced rulings. It also runs against his standing direction that the display show only real, actionable inquiries (`audit/STATE.md:66-67`). He is told it is a leak and not his rule. B31 (`history-and-assumptions.md:211`) records the mirror-image error, a rule presented as the owner's that was not his.
- **Evidence.** `app/lib/feed/serve.ts:103-106`, `audit/history-and-assumptions.md:210,212`, and `git show -s 1f3ae9a`.
- **Severity.** changes-the-decision.

### H3. All 4 strict silent misses reached staff; the move would not have changed any of them
- **Claim.** "4 reached nobody (inquiry_recall 95.2%). 3 of them were questions the system could not answer, which became needs-reply cards that neither the TV nor Gmail shows" (`alignment.md:26`). "nothing replies to them" (`checkpoint-A.md:31`). "silent_miss_count (strict) 4 → 1" (`checkpoint-A.md:43`).
- **What is wrong.**
  - Staff did the booking work on all 4, in 0.30, 0.65, 0.97 and 0.42 h. The reconstruction says the same thing (`reconstruction.md:267`, "staff did the booking work anyway"; `eval/failure-taxonomy.md:104`).
  - All 18 needs-reply emails of the week have a later message from our mailbox in the same thread: 17 within 24 h, at a median of 0.19 h.
  - The projection drops a needs-reply item as soon as our email follows it (`app/lib/feed/project.ts:436-439`).
  - So had the move listed these items, 1a140632ce4d5e99 would have left the TV at 0.01 h and 1a144c619a140ea6 at 0.10 h, before staff's first act (0.97 h and 0.42 h). 1a13f8312ae75c73 would have stayed only until our reply at 1.62 h.
  - The 4th, 1a1399db710f7409, is a `none` decision, which the move does not touch.
  - The 4 → 1 is therefore a change in the system's own accounting, with no change in what reached a person.
  - The table was not produced by the $0 projection replay that `checkpoint-A.md:37` names. A replay would have hit `project.ts:439`.
  - Wording: 1a144c619a140ea6 is an attachment the pipeline does not carry, not a question. The other two are details the planner chose to ask for rather than assume (`failure-taxonomy.md:105-107`).
- **Evidence.** Appendix script, section [2].
- **Severity.** changes-the-decision.

### H4. The visibility experiment already ran: Gmail labels (from 10-16) did not stop rebuilds (6 of 6)
- **Claim.** "Gmail's 'Order Created' label (since 10-15) did not stop the rebuilds" (`checkpoint-A.md:35`; also `reconstruction.md:306`). "durable completions ... up to 13/84, if staff confirm the 9 equal creates instead of rebuilding" (`checkpoint-A.md:49`). "If the reason is habit or visibility, the listing is the fix" (`checkpoint-A.md:62`).
- **What is wrong.**
  - Labels first reached a bookings thread on 10-16 at 04:37Z. Commit 726c02a says "No Gmail label had reached a bookings thread since the old engine stopped", and its ticket is S-0191. `threadLabels.ts:9-11` is a design note dated 10-15, not a deployment.
  - 10 of the 16 verified creates were made before labels went live, and 8 of the 14 rebuilds predate any label.
  - Every one of the 6 creates made after labels went live (1a144f983605bc19, 1a153e512dae2620, 1a1541de84b036b8, 1a158632aed55e9a, 1a15984719fbd60e, 1a15984f57ab3251) was rebuilt by staff 0.16-1.08 h later. None survives in the snapshot.
  - Staff work from Gmail (`threadLabels.ts:9-11`). So making the bot's create visible where staff work was tried, and 0 of 6 were adopted. The "up to 13/84" depends on the adoption this experiment did not show.
  - The TV tick also approves nothing in OnSinch (`check.ts:1-6`). A listed create would still need a confirm in OnSinch, and staff gave that to 1 of 21 bot creates.
- **Evidence.** Appendix [1]. The create time is the decision's `created_at`. Labels went live at the S-0191 ticket time (`public/data/feed.json`).
- **Severity.** changes-the-decision.

### H5. The silent-miss count and health check 4 cannot see a request nobody acted on
- **Claim.** "The denominator is 84 real inquiries with staff work" (`reconstruction.md:261`). "inquiry_recall 80/84 = 95.2%" (`checkpoint-A.md:45`). Health check 4: "Count the real inquiries with no TV item, by day, against what staff then did in OnSinch. This is the §4 worst case" (`checkpoint-A.md:26`).
- **What is wrong.** §4's worst case is "a real request that reaches nobody" (`alignment.md:15`). If it reached nobody, staff did nothing, so it has no staff act. That puts it in week-review's "nothing to do" or "handed off" rows, which never enter the 84. The method can only find misses that staff caught anyway, and all 4 it found were caught (H3).
  - The candidate pool for true silent misses was not read:
    - 246 "nothing to do" `none` decisions, of which 95 also have no later message from our mailbox in the thread;
    - 45 handoffs with no staff work (`failure-taxonomy.md:380-382`: "not read one by one", "not settled").
  - Health check 4 carries the same blind spot into daily monitoring. The only bucket the move leaves unfixed (a model `info_only` → `none`) is also the only one that cannot be found unless staff act.
- **Evidence.** Appendix [2] (a variant prints the tally of `none` × "our reply after"). `scripts/week-review.mts:63-64`.
- **Severity.** changes-the-decision.

### H6. "Keep production exactly as it is" keeps a setting that blinds the TV's intake alarm and tells staff intake is stopped
- **Claims.**
  - "The recommendation is to keep production exactly as it is: shadow, with the TV on" (`checkpoint-A.md:20`).
  - "Production is already in its safest state ... Intake and decisions are live" (`checkpoint-A.md:13-14`).
  - "`intake_paused=true` does not stop intake. It only tells the TV that silence is expected" (`reconstruction.md:27`).
  - Health check 2, "No lost email" (`checkpoint-A.md:24`).
- **What is wrong.**
  - `serve.ts:140` sets `intake_stale: intake.stale && !paused`. With `intake_paused=true`, a dead intake never turns the TV's sync state to "error" (`LiveFeedScreen.tsx:551-556`).
  - The TV header shows "Intake Paused" and "Email intake is paused; jobs still sync with OnSinch" (`LiveFeedScreen.tsx:259-260`).
  - The Help assistant tells staff "new emails are not being read" (`app/lib/help/liveState.ts:19`).
  - None of this is true while intake is live, and it contradicts the owner's own words, "nothing is supposed to be stopped right now" (`STATE.md:61-62`).
  - This is the failure the alarm exists for: on 08-26 "the mail simply stopped arriving and every dashboard stayed green for 42 hours" (`app/lib/intakeHealth.ts:1-8`).
  - Health check 2 counts only stored messages with no decision (`week-review.mts:39-41`; the sweep `process.ts:256-264` reads `thread_messages`). So it cannot see mail that never reached `thread_messages`.
  - The out-of-band watchdog (`app/api/health/intake/route.ts`) depends on an n8n schedule whose state was not read, and it is not among the four checks.
  - Illustration of the blind spot: during the 10-21 pause, Wednesday 10-21 holds 19 client emails in the snapshot, all first seen on 10-22, against 54-103 on each other weekday 10-14..10-20. Whether every email was recovered cannot be told from the table health check 2 reads.
  - Smaller points:
    - "within 10 minutes" is not the sweep's claim. The sweep starts at 10 minutes, takes two threads a minute, and stops looking after 24 h first-seen or 7 days sent (`process.ts:233-237`).
    - Check 3 is a unit test on synthetic rows (`test/feedKeepsEveryNeed.ts:19-24`). It says nothing about production, yet it is listed among checks that "can run every day".
    - The deployed version was not read: `v2_decisions.code_version` for 10-24 rows is not in the live-state file. `origin/main` = 6a98170 makes HEAD likely, but that is unconfirmed.
- **Evidence.** The cited lines. For the 10-21 count, filter `messages.json` to client senders by `date_iso` day, then compare `first_seen_at`.
- **Severity.** changes-the-decision. A setting healthier than current production exists without any revert, so "already in its safest state" does not hold.

### N1. Durable completions are 3/84; new bookings 0/44
- **Claims.**
  - "New bookings made 1 durable completion in 59" (`alignment.md:28`; `reconstruction.md:51,306`).
  - "durable completions 4/84" (`checkpoint-A.md:49`).
  - "4 were completed by the system and stayed completed" (`reconstruction.md:299`).
  - "Completed 7 is also overstated: staff undid or rebuilt 3 of the 7" (`reconstruction.md:279`).
- **What is wrong.**
  - The one "durable" new booking is 1a13b2a104b579ab (R11562, order 16617). Its link has been `held` since 2026-10-15T09:43Z with the note "the order and its job are not in OnSinch, and no rebuild was found" (`links.json`). `v2.ts:145-146` names that R number as an order deleted while still on a card, and order 16617 is absent from the snapshot. The snapshot does hold 101 orders in ids 16500-16700, so the absence means the order is gone.
  - So 4 of the 7 "completed" did not last. Durable completions are 3/84, all of them edits: 2 `set_po` and 1 `cancel_position`.
  - "1 in 59" also counts 15 label_wrong rows, which the same file says belong to other emails (`failure-taxonomy.md:313`). The real figure is 0 of 44.
  - The only bot create that did survive is R11552 (1a13a07828a2d598), and it is bucketed label_wrong, outside the 84.
- **Evidence.** Appendix [1] (the link state column) and [4].
- **Severity.** changes-a-number.

### N2. "12 bot creates were correct" is 9 by day, times and crew, and 7 with trades
- **Claims.**
  - "12 bot creates were correct, or equal to staff's order by day, times and crew, and staff rebuilt them anyway" (`alignment.md:27`).
  - "15 were written by the system and then undone: 12 right creates rebuilt by staff" (`reconstruction.md:300`).
  - "listed creates: at least 9/12 equal" (`checkpoint-A.md:46`).
- **What is wrong.**
  - I reproduced 9 creates that are equal to a staff order created 0.11-1.08 h later. Every matching staff order has a higher id than the bot's.
  - 2 of those 9 differ in trade split (professions 45 and 46 against plain crew): 1a139bd196d4eff6 and 1a15984719fbd60e. That leaves 7 fully equal.
  - The 2 "completed" creates in the 12 are not equal to any staff order by value:
    - 1a13fb4d5be6a768: 16:30-21:00 ×2 against staff's 16:00-20:00 ×4;
    - 1a1541de84b036b8: an 08:00-20:00 shift against staff's 08:00-10:00.
  - The taxonomy's "staff built the same job" (`failure-taxonomy.md:508,513`) is not a value test. By its own pipeline_break rule ("the plan equals the email, or staff's final state, by value", `:164`), these 2 do not qualify on the staff side. That makes pipeline_break 19, not 21.
  - 1a13f5382ff22bed equals the email, but staff booked other days and crew.
  - The upper bound under writes-on falls from 13/84 to 3 + 7 = 10/84.
- **Evidence.** Appendix [1].
- **Severity.** changes-a-number.

### N3. The "31 asked for nothing" verdicts rest on one agent's reading, and the independent check cannot separate them
- **Claims.**
  - "31 of its 32 'missed changes' were emails that asked for nothing" (`alignment.md:23`).
  - "An independent check agrees: the gold labels' day-matched staff signal backs only 2 of the 32" (`failure-taxonomy.md:21`).
  - "14 of 14 agree" (`reconstruction.md:250`).
- **What is wrong.**
  - In 6 of the 31 label_wrong rows, a staff act falls on a day the email itself names (`factsOf` over the subject and newest words), 0.1-23 h after the email: 1a13a095eedb8695, 1a13acdf4936c4fb, 1a13ea9ff621fe7c, 1a13fd94ac637812, 1a14531a92b261d0, 1a159cd5eefd359d.
  - 1a13ea9ff621fe7c, labelled "information only", drew 68 staff acts within 0.1 h, including 5 order creates.
  - The taxonomist's own re-attribution leaves 9 of the 32 with an act backed by a day or an R number (`failure-taxonomy.md:433`). The final 31 therefore rests on reading the text.
  - The orchestrator's every-tenth sample covered 2 of these 6 and read no text.
  - The gold "independent check" scores the one confirmed real miss, 1a1399db710f7409, as unbacked too: its signals all say "no days read". So the check cannot tell a real miss from a label error.
  - If any of the 4 unsampled rows is a real request, the strict count rises above 4, and the extra miss lands in the one bucket the move does not fix (`none` from `info_only`).
- **Evidence.** Appendix [3]. Gold signals are in `truth.jsonl`, `truth.candidates[0].sig`.
- **Severity.** changes-a-number.

### N4. Relabelled data is presented as real-mail measurement
- **Claim.** The live-week figures (84, 4, 95.2%, 67, 23, 7, 12) are stated as measured ("On the live week, 84 real inquiries had staff work", `alignment.md:25`). Figures from other versions are qualified as "unrelabelled" (`reconstruction.md:50,181`).
- **What is wrong.**
  - The 84 is one agent's relabelling of week-review. 37 rows were relabelled label_wrong, and 16 were added through "my own rule" of re-attribution (`failure-taxonomy.md:135-139,433`). About 72 emails were read to settle stages (`:153`).
  - The re-check covered 14 of 117 without reading text (`reconstruction.md:250`).
  - The documents apply "unrelabelled" as a standard against older versions but not to the figures for the current system.
  - Not every figure is affected: the 400-email join, the verdict counts and the op kinds reproduce exactly.
- **Evidence.** The cited lines, plus N3.
- **Severity.** changes-a-number.

### N5. Client resolution: 89.1% is a replay; production resolved 85.9% and 82.2%, with 2 wrong companies
- **Claims.**
  - "the deterministic spine: client first at 89.1% with 0 of 92 disagreements" (`alignment.md:39`).
  - "The client is resolved before the email is read, for 89.1% of client emails" (`reconstruction.md:43`).
- **What is wrong.**
  - 89.1% is today's rule replayed over 30 days of mail against the 10-23 company list (`audit/data-map.md:14`).
  - Production's own decisions carried a company for 311 of 362 live-week client emails (85.9%) and for 653 of 794 across the snapshot (82.2%).
  - The taxonomist's gold check found 2 decisions naming a company other than the label's order company (`failure-taxonomy.md:272`). A wrong company is the dangerous direction. "0 of 92" holds only for the hand-linked sample.
- **Evidence.** Appendix [5].
- **Severity.** changes-a-number.

### N6. The 23 "grounding failures" are not all parser fixes
- **Claims.** "The reader and the parser hand off what the client clearly wrote. 23 of the 67" (`alignment.md:30`). "Each is a deterministic parser fix with a test, and none is a model change" (`checkpoint-A.md:53`).
- **What is wrong.** I sorted the stored handoff reasons of the 21 `reading_unproven` rows:
  - 13 carry only "reads as null" reasons, the parser-side kind;
  - 4 carry "... is not in the email", meaning the model's quote is absent from the newest words;
  - 4 carry a parser reading that differs from the model's. One of these, 1a13b45143681d8d, the taxonomist calls "a year misread by the model and correctly refused by code" (`failure-taxonomy.md:197`).

  The appendix gives the same generic reason for all 21 (`:462-484`). Sub-kinds are shown for 8 rows only. At most 15 of the 23 (13 plus the 2 cancellations) are parser-side on the face of the reasons.
- **Evidence.** Appendix [6].
- **Severity.** changes-a-number.

### N7. Client unresolved: 1 of 7 already resolves at HEAD, and the named signals cannot resolve the rest
- **Claim.** "Client unresolved: 7. Candidate signals are the thread's own link and the RFC headers stored since 10-23 (159/169)" (`checkpoint-A.md:56`).
- **What is wrong.**
  - 1a15a6583c83e5ba (a free-mail sender) gets a client from HEAD's `matchCompanyBySender` against the snapshot's company list.
  - None of the 7 threads had a link before its decision.
  - The thread link is already a fallback (`process.ts:416-426`).
  - In-Reply-To and References tie messages inside a thread, which Gmail's threadId already does, and they name no company.
- **Evidence.** Appendix [5].
- **Severity.** changes-a-number.

### N8. The wide residual "4" contradicts its own note
- **Claim.** "silent_miss_count (wide: system work no one sees) | 19 | 4 | the 3 wrong writes stay wrong, but become visible" (`checkpoint-A.md:44`).
- **What is wrong.**
  - 2 of the 3 wrong writes are live `add_shift` edits (1a13a5fb091090aa, 1a158ba2b8c735d6). The move lists questions and creates "waiting in To Confirm" (`checkpoint-A.md:37`), so these 2 stay unseen.
  - If they did become visible, they would leave a count of work no one sees.
  - The residual is 3 (1 + 2) as specified, or 1 if every write is listed. It is not 4.
- **Evidence.** Appendix [7].
- **Severity.** changes-a-number.

### N9. The proposed real-mail metric inputs cannot see company-null emails
- **Claim.** "Inputs are `scripts/ops-truth.mts` and `scripts/week-review.mts` for the live week" (`checkpoint-A.md:87`).
- **What is wrong.** ops-truth reads only decisions with a company (`scripts/ops-truth.mts:21`, `d.company_id IS NOT NULL`). That excludes 51 of the 362 live-week client emails by construction, and with them the whole wrong_client bucket. The checkpoint fixes the attribution rule (`:64`) but not this exclusion.
- **Evidence.** `ops-truth.mts:21`, Appendix [5].
- **Severity.** changes-a-number.

### N10. inquiry_recall counts an ambiguous `none` as recalled
- **Claim.** "inquiry_recall 80/84 = 95.2%" (`checkpoint-A.md:45`).
- **What is wrong.** The 84 includes the 3 genuinely ambiguous rows. One of them, 1a13eb94f0ccb389, is a `none` with no item, yet it is not among the 4.
  - Counting it as a miss gives 79/84 = 94.0% (exact 95% CI 86.7-98.0%).
  - Dropping the ambiguous rows gives 77/81 = 95.1%.
  - The "now" interval (88.3-98.7%) overlaps the "with the move" interval (93.5-99.97%) almost entirely.
- **Evidence.** Exact binomial intervals: the ones I computed match the checkpoint's 93.5-99.97%.
- **Severity.** changes-a-number (small).

### N11. "The correct none on all 31 non-inquiries" is true by construction
- **Claim.** "What is not broken, and should be kept: ... the correct `none` on all 31 non-inquiries" (`alignment.md:41`).
- **What is wrong.**
  - week-review's "missed change" verdict is defined as a `none` decision plus a staff act (`week-review.mts:64`). Any row taken from it is `none`, so the 31 are evidence of nothing.
  - Non-inquiries that did get an item are the noise case, and those were not tested:
    - label_wrong itself holds 2 listed handoffs on emails that asked nothing new (1a13aa2b6fca0312, 1a1598e6aaaba9d0);
    - 30 listed handoffs with no staff work are "not settled" (`failure-taxonomy.md:382`).
- **Evidence.** The cited lines.
- **Severity.** wording. The "keep" item stands without support.

### N12. The risk tiers state as fact what §7 calls open, and describe a T4 the code forbids
- **Claims.**
  - "OnSinch notifies the workers on a position when it is edited (`run.ts:11-14`)", listed among the "Facts the tiers rest on" (`checkpoint-A.md:73`).
  - T3 "the workers have already been notified" (`:80`).
  - T4 "`cancel_position`, `set_position_size` (cut) on a staffed position: workers are dropped and told" (`:81`).
- **What is wrong.**
  - The notification is a code comment that cites the owner (`run.ts:11-14`). It was never measured. §7 Q3 calls it open (`checkpoint-A.md:99`).
  - `staffedRefusal` refuses any `cancel_position` on a position with workers, and any cut below the workers (`app/lib/v2/bot/run.ts:77-81`, applied in `preflight` at `:216-217`). So at HEAD no op can drop a worker, and T4 is empty as built.
- **Evidence.** The cited lines.
- **Severity.** wording.

### N13. Q6 figures do not match the live-state file they come from
- **Claim.** "57-103 model calls a day ... $0.006-0.010 on gpt-6.1-sol ... That is $0.4-3.4 a day" (`checkpoint-A.md:106-108`).
- **What is wrong.** The live-state file reads "3 to 103 a day ... $0.005-0.010 each ... $0.02-3.42 a day" (`live-state-2026-10-24.md:13`). "one per decided email" is not shown either: the file counts decisions that carry `interpretation.meta`.
- **Severity.** wording.

### N14. Smaller overstatements
- **The 53% stale labels.** "53% of those labels are stale" (`alignment.md:22`). This is a projection from 98 hand checks (`eval/label-audit.md:16-26`), not a count. wording.
- **Headers.** "Thread headers are now stored" (`checkpoint-A.md:103`). A Message-ID is present on 159 of 169 (94%), and every RFC message has one, so 10 of 169 were not captured. "Outbound is kept" leaves open whether an outbound row is an unsent draft (`audit/data-map.md`, blocked list). wording.
- **Clearing To Confirm.** "Creates wait in OnSinch To Confirm, which staff almost never clear (1 of 21)" (`alignment.md:33`). Staff did clear them: 11 by deletion. 20 of the 21 are gone (`audit/glossary.md:29`). wording.

---

## What I reproduced and found sound

- 227/500 and 114/500, with 236 and 40 planner-crash decisions, 71 of which scored e2e-correct on simple, at fb01342. I extracted the tree with `git archive` into scratch and ran the oracle reader in-process. At HEAD the figures are 304/500 and 154/500 (`npx tsx test/harnessGate.ts`).
- The 400-row join (0 unjoined). 16 verified creates, 14 followed by a staff order within 1.1 h, 10 with a delete row, and 1 in the snapshot. 9 equal by day, times and crew. 18 needs-reply emails. 59 of 62 listed rows real. 84 = 117 − 37 + 4. The interval of 93.54-99.97% for 83/84.
- No revert: no candidate version is shown to be better while writes are off, so the conclusion follows. What it rests on (H6) is the part that does not hold.

## Appendix: reproduction

Save as `.tmp-v2/redteam/rt.mts` and run `npx tsx .tmp-v2/redteam/rt.mts` from the repo root. It reads local files only and prints ids, booleans and counts, never email text.

```ts
import fs from "node:fs";
import { factsOf } from "../../app/lib/match/facts.ts";
import { matchCompanyBySender } from "../../app/lib/engine/resolve.ts";
const J = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")), P = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
const G = ".tmp-data/gold/", wr: any[] = J(".tmp-data/week-review-1014.json"), msgs: any[] = J(G + "messages.json"), decs: any[] = J(G + "decisions.json");
const truth: any[] = J(".tmp-data/week-truth.json"), wOrders: any[] = J(".tmp-data/week-truth-orders.json"), snap = new Map<number, any>(J(G + "orders.json").map((o: any) => [Number(o.id), o]));
const links: any[] = J(G + "links.json"), companies: any[] = J(G + "companies.json");
const dec = new Map(decs.map((d) => [d.message_id, d])), msg = new Map(msgs.map((m) => [m.message_id, m])), tr = new Map(truth.map((t) => [t.id, t]));
const k = (at: string, s: string) => `${new Date(at).toISOString()}|${s ?? ""}`, byKey = new Map<string, string>();
for (const m of msgs) if (!m.is_from_spartan && dec.has(m.message_id)) byKey.set(k(m.date_iso, m.subject), m.message_id);
const rows = wr.map((r) => ({ r, id: byKey.get(k(r.at, r.subject))!, d: dec.get(byKey.get(k(r.at, r.subject))!) }));
const thread = new Map<string, any[]>(); for (const m of msgs) thread.set(m.thread_id, [...(thread.get(m.thread_id) ?? []), m]);
const h = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600e3;
const ourAfter = (d: any, at: string) => (thread.get(d.thread_id) ?? []).filter((m) => m.is_from_spartan && Date.parse(m.date_iso) > Date.parse(at)).map((m) => h(at, m.date_iso)).sort((a, b) => a - b)[0];
const staffAfter = (id: string, at: string) => ((tr.get(id)?.staff ?? []) as any[]).filter((a) => a.by !== 2257).map((a) => h(at, a.at)).sort((a, b) => a - b)[0];
const off = (dt: string) => (dt >= "2026-10-25" ? 0 : 1);
const utc = (dt: string, hm: string, next = false) => { const [H, M] = hm.split(":").map(Number); return new Date(Date.parse(`${dt}T00:00:00Z`) + ((H - off(dt)) * 60 + M) * 60e3 + (next ? 864e5 : 0)).toISOString().slice(0, 16); };
const slots = (o: any) => ([] as any[]).concat(o.Job ?? []).flatMap((j) => [].concat(j.SlotTeam ?? [])).flatMap((t: any) => [].concat(t.Slot ?? []));
const shape = (o: any) => { const g = new Map<string, number>(); for (const s of slots(o)) { const x = `${s.beginning.slice(0, 16)}|${s.end.slice(0, 16)}`; g.set(x, (g.get(x) ?? 0) + Number(s.size)); } return [...g].map(([a, n]) => `${a}|${n}`).sort().join(";"); };
const trades = (o: any) => { const g: any = {}; for (const s of slots(o)) { const x = Number(s.role) === 1 ? "chief" : `p${s.profession_id}`; g[x] = (g[x] ?? 0) + Number(s.size); } return JSON.stringify(Object.entries(g).sort()); };
const LABELS_LIVE = "2026-10-16T04:37:57Z"; // S-0191 (726c02a)
function coded(d: any) { return P(d.decision); }

console.log("\n[1] verified creates: id | verdict | before labels | equal by day/times/crew | equal incl. trades | in snapshot | link");
let n = 0, pre = 0, eqN = 0, eqT = 0;
for (const { r, id, d } of rows) {
  const dd = coded(d); if (dd.kind !== "write") continue; const ops = dd.ops.map((o: any) => o.op), ex: any[] = P(d.executed) ?? [];
  const op = ops.find((o: any) => o.kind === "create_order"); if (!op || ex.length !== ops.length || !ex.every((e) => e.status === "verified")) continue;
  n++; const made = Number(ex.find((e) => e.detail?.order_id)?.detail.order_id), before = d.created_at < LABELS_LIVE; if (before) pre++;
  const bk = op.shifts.map((s: any) => `${utc(s.date, s.start)}|${utc(s.date, s.end, s.end <= s.start)}|${s.positions.reduce((a: number, p: any) => a + Number(p.size), 0)}`).sort().join(";");
  const bt: any = {}; for (const s of op.shifts) for (const p of s.positions) { const x = p.role === "crew_chief" ? "chief" : `p${p.profession_id}`; bt[x] = (bt[x] ?? 0) + Number(p.size); }
  const st = wOrders.filter((o) => Number(o.company_id) === Number(d.company_id) && Number(o.creator) !== 2257 && Math.abs(h(d.created_at, o.created)) < 48 && shape(o) === bk);
  const tEq = st.some((o) => trades(o) === JSON.stringify(Object.entries(bt).sort())); if (st.length) eqN++; if (tEq) eqT++;
  const link = links.find((l) => Number(l.order_id) === made);
  console.log(` ${id} | ${r.verdict} | ${before} | ${st.length ? `staff order ${st[0].id} +${h(d.created_at, st[0].created).toFixed(2)} h` : "no"} | ${tEq} | ${snap.has(made)} | ${link ? `${link.state}: ${link.note ?? ""}` : "-"}`);
}
console.log(` verified creates ${n}; before labels live ${pre}; equal ${eqN}; equal incl. trades ${eqT}`);

console.log("\n[2] needs-reply: first message from our mailbox after it");
const REPLY = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/;
const gaps: number[] = [];
for (const { r, d } of rows) { const dd = coded(d); if (dd.kind === "handoff" && (dd.reply ?? dd.reasons.every((s: string) => REPLY.test(s)))) gaps.push(ourAfter(d, r.at) ?? Infinity); }
gaps.sort((a, b) => a - b);
console.log(` ${gaps.length} needs-reply; with our mail after ${gaps.filter(isFinite).length}; within 24 h ${gaps.filter((g) => g <= 24).length}; median ${gaps[Math.floor((gaps.length - 1) / 2)].toFixed(2)} h`);
for (const id of ["1a1399db710f7409", "1a13f8312ae75c73", "1a140632ce4d5e99", "1a144c619a140ea6"]) { const m = msg.get(id); console.log(` ${id}: first staff act +${staffAfter(id, m.date_iso)?.toFixed(2)} h, first our mail ${ourAfter(dec.get(id), m.date_iso)?.toFixed(2) ?? "none"} h`); }

console.log("\n[3] 'missed change' rows whose staff act is on a day, or an R number, the email names");
const sd = new Map<number, string>(), od = new Map<number, string[]>(), lon = (x: string) => new Date(x).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
for (const o of wOrders) { od.set(Number(o.id), slots(o).map((s) => lon(s.beginning))); for (const s of slots(o)) sd.set(Number(s.id), lon(s.beginning)); }
let backed = 0;
for (const { id } of rows.filter((x) => x.r.verdict === "missed change")) {
  const m = msg.get(id), f = factsOf(m.subject, m.body, m.date_iso), acts = ((tr.get(id)?.staff ?? []) as any[]).filter((a) => a.by !== 2257);
  const day = acts.some((a) => (a.model === "Slot" && sd.has(a.model_id) ? [sd.get(a.model_id)!] : od.get(a.order_id) ?? []).some((x) => f.days.includes(x)));
  const rn = acts.some((a) => [...f.r, ...f.subjectR].map(String).includes(String(a.number)));
  if (day || rn) { backed++; console.log(` ${id}: day ${day}, R ${rn}, staff acts ${acts.length}, first +${staffAfter(id, m.date_iso)?.toFixed(1)} h`); }
}
console.log(` backed ${backed} of 32`);

console.log("\n[4] 'completed' rows: does the result stand in the 10-23 snapshot?");
for (const { id, d } of rows.filter((x) => x.r.verdict === "completed")) {
  const dd = coded(d), ex: any[] = P(d.executed);
  console.log(` ${id}: ${[...new Set(dd.ops.map((o: any, i: number) => `${o.op.kind}:${snap.has(Number(o.op.order_id ?? ex[i]?.detail?.order_id)) ? "present" : "ABSENT"}`))].join(", ")}`);
}

console.log("\n[5] company at decision (client emails)");
const cl = rows.filter((x) => x.r.code !== "none_not_client"); console.log(` live week ${cl.filter((x) => x.d.company_id != null).length}/${cl.length}`);
const all = decs.filter((d) => !(coded(d).kind === "none" && /not a client/.test(coded(d).reason ?? ""))); console.log(` snapshot ${all.filter((d) => d.company_id != null).length}/${all.length}`);
for (const id of "1a139ada42ba1d76 1a13a443201c1d31 1a13ad05c65d0447 1a13ae4bb1dab34e 1a13f9bc1c910e5c 1a153c8290d0aad3 1a15a6583c83e5ba".split(" ")) {
  const d = dec.get(id), m = msg.get(id), from = String(m.from_address ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();
  console.log(` ${id}: HEAD rule names a client ${matchCompanyBySender(from, companies as any) != null}; thread link before decision ${links.some((l) => l.thread_id === d.thread_id && l.first_seen < d.created_at)}`);
}

console.log("\n[6] reading_unproven parse_failure rows by stored reason");
const RU = "1a139c08af1111d6 1a13a8bf26108f7b 1a13af10fc5250eb 1a13b3fa256bdee2 1a13b45143681d8d 1a13b915f3a326a3 1a13ea2e0ba9a5e1 1a13ebde5287c063 1a13f49e6e01c4ab 1a13f86e46191246 1a13fea576aeda13 1a140651f540d14f 1a143eb3508a25f7 1a144942ca8851d1 1a1497d7b3445d5f 1a1533b5bd8afd4a 1a153f99b61947c3 1a154281bdb98ca3 1a1547e5ac397a7b 1a159118872d9ab5 1a159c377a25725b".split(" ");
const cls: any = {}; for (const id of RU) { const rs: string[] = (coded(dec.get(id)).reasons ?? []).map(String); const c = rs.some((x) => /is not in the email/.test(x)) ? "a quote not in the email" : rs.some((x) => /reads as "/.test(x)) ? "parser reads another value" : "only: reads as null"; cls[c] = (cls[c] ?? 0) + 1; }
console.log(" ", cls);

console.log("\n[7] the 3 wrong writes of the wide reading, by op kind");
for (const id of ["1a13a5fb091090aa", "1a153e512dae2620", "1a158ba2b8c735d6"]) console.log(` ${id}: ${coded(dec.get(id)).ops.map((o: any) => o.op.kind).join(",")}`);
```

It prints, as run on 2026-10-25:
- [1] verified creates 16; 10 made before labels went live; 9 equal by day, times and total crew; 7 equal including trades. Only 1a13a07828a2d598 is in the snapshot. 1a13b2a104b579ab and 1a153e512dae2620 are `held`: "the order and its job are not in OnSinch".
- [2] 18 needs-reply emails, all 18 with our mail after them, 17 within 24 h, median 0.19 h. The strict misses had a first staff act at +0.30, +0.65, +0.97 and +0.42 h, and a first message from our mailbox at none, 1.62, 0.01 and 0.10 h.
- [3] 7 of 32 missed changes are backed by a day: 1a1399db710f7409 plus the 6 label_wrong rows named in N3. 0 are backed by an R number.
- [4] 1a13b2a104b579ab, 1a13fb4d5be6a768 and 1a1541de84b036b8 are ABSENT; the other 4 are present.
- [5] live week 311/362; snapshot 653/794. Only 1a15a6583c83e5ba gets a client from the HEAD rule. 0 of 7 had a link before the decision.
- [6] only "reads as null" 13; a quote not in the email 4; the parser reads another value 4.
- [7] add_shift, create_order, add_shift.

**Pre-fix harness (227/114).** Run `git archive fb01342 app/lib harness/adapters harness/core tsconfig.json | tar -x -C .tmp-v2/redteam/old`, then from that folder run a script that calls `runCase(c, oracleExtract(c))` over `generate()` and `generateUpdate()`. Count the `e2e` observations, plus the decisions whose JSON matches `/could not plan|could not decide|is not a function/`. Result: simple 227/500 with 236 crashes, 71 of them scored e2e-correct; update 114/500 with 40 crashes, 0 of them scored correct.

No fix or design is proposed here.
