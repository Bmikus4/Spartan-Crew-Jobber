# STATE.md

Updated: 2026-10-26   Session: 5

## Phase and section
Phase: 1   Current section: Checkpoint B response (decisions/2026-10-26-checkpoint-b-response.md)   Status: in progress
Checkpoint B stays closed: nothing deployed, writes off, no prompt change. The owner authorized a bounded investigation.

## Session 5 plan (the owner's 7 items, 10-26)
Summary for the owner: audit/checkpoint-B-response.md.
- [x] O1 audit/evidence-index.md. Verified: HEAD = deployed = 305bf84; app unchanged since 6a98170; reader gpt-6.1-sol /
      extract@f3e1a862322b since 10-16 07:00:44Z; writes off. 7 corrections appended to final-state.md and iterations.md.
- [x] O2 eval/patches/items-1-3-runtime.diff + item-4-scoring.diff + items-1-4.md (worktree C:/Users/thera/spartan-v2-i14).
      OnSinch's zone-less audit times are UTC: BST 1,810/1,813 as UTC, 0 as London (scripts/onsinch-zone-evidence.cjs).
      Item 4 was incomplete in the held patch (6/23 by its own scorer); fixed, 8/6/9 re-judged on the audit copy.
- [x] O3 eval/write-breakdown.md (fork; accepted after re-deriving: the 6/8/9, 11 production write decisions 8 blocked/2 not
      run/1 verified, R11546 deleted 10:19Z, 1a158a5e6bd47095 written in production 10-20). 16/23 right by audit reading.
- [x] O4 eval/component-assessment.md + audit/paz-acceptance-examples.md (fork; 4/4 acceptance completions re-derived from
      Order-level rows by number). Paz not contacted: the owner sends the draft.
- [x] O5 eval/reader-diagnostic/ (manifest 833df054c5676fd5 fixed before any call): 14 calls, $0.1485; stop rule ended at 3
      of 9 controls. 9/11 old misses stay silent with the current reader.
- [x] O6 audit/workflow-proposal.md (fork; tick = addMark only, check.ts:24-53, and untargeted Needs Updated,
      v2.ts:85-91, re-read by me). Display precision under both definitions in component-assessment.md.
- [x] O7 eval/dev-windows.md: D-cur 107 labelled current-reader inquiries (HEAD 17 silent); W2 10-26..10-28 labelled at
      close; E3 from 10-29 00:00Z untouched. Next block recommended (checkpoint-B-response.md §7).

## Session 5, next block (the owner: "then once you are fully done begin the next phase"; sandbox only, $0)
- [x] N1 DONE in sandbox C:/Users/thera/spartan-v2-n1 (items 1-4 + N1): eval/patches/n1-write-judging.diff, eval/next-block.md.
      23 assessable: 13 completed / 2 partial / 8 wrong; agrees with the hand reading on 21/23. Held with item 4 (score.ts).
- [ ] N2 Planner op fixes, red-first on synthetic cases of the real shapes: role-named re-time, added crew/chief window,
      add-N vs N-in-all hands off, two size ops on one position, a question planned as edits
- [ ] N3 Re-measure on D-old and D-cur: wrong writes on these cases to 0, no new wrong write, recall unchanged

Checkpoint A passed on 10-25: the owner, "bro the alignment is for you wtf" (decisions/2026-10-25-alignment-is-the-orchestrators.md).
The eight questions were settled from the owner's own rulings or held without blocking (same file).

## Session 3 plan (Phase 1, OPERATING §13): the owner, 10-25: "keep going one by one, finish and build phase 1"
Each step starts only when the one before it is verified. Each build agent works in new files or its own sandbox paths,
and I gate every merge. Nothing is deployed: shipping waits for Checkpoint B (§14).

- [x] P1 Harness (harness-engineer, bd19ffb1) ACCEPTED: score-production 48/48 reproduced on my re-run; test/harnessReal.ts
      11/11; replay dev at HEAD 16 silent of 79. Extension to all 799 running (same agent, resumed). score-production reproduces eval/live-week-reads.md exactly; replay gives
      HEAD's baseline on stored readings ($0). Deviation, recorded: the agent works in the main checkout, but only in new
      paths, because .tmp-data/ and node_modules/ are not in a worktree.
- [x] P2 Isolation ACCEPTED (isolation-verifier e102bf03): ISOLATED, no leak. Gaps G1-G3 closed by me and re-verified
      (audit/isolation-report.md addendum): score-production runs the preflight; credential names refused by shape; the lock covers
      http/https, sockets, child processes. Was: P2 Isolation (isolation-verifier, a different agent). It tries to make the harness reach production, OnSinch or mail.
      A leak halts everything (§8.4).
- [x] P3 Eval set (§13.1 step 2) DONE: 799 read, 785/799 agree, 14 settled by V/V2; split dev 561 / test 238 (test hash d2790450e2c9ae4f). Was:
      - read the 399 other snapshot emails with two readers (A3, B3, A4 running; B4 queued);
      - a third blind reader settles disagreements;
      - apply the B42 rule;
      - make a chronological dev/test split with test locked.
      The target is about 500 outstanding inquiries, so the interval is about ±4 (§8.9).
- [x] P4 DONE, ACCEPTED (7b8bd993): selection-bound. recall@5 43/46, selection 62/75 injected, action_accuracy 7/50; 75/75 as-is codes equal the committed run. Its clock finding (zone-less audit times read in the box's zone) fixed in the patch, test/zonelessIsUtc.ts red without it; dev replay unchanged. Was: §11.3 diagnostic: inject the correct order into the planner's candidates on dev. It decides whether retrieval or
      selection is the bottleneck.
- [ ] P5 Fixes, largest bucket first, each measured on dev in replay ($0) and logged in eval/iterations.md (§13.2):
      a. grounding and parser (reading_unproven 34 listed; at most 15 parser-side: crew in words, "Duration: N", a day
         plus a time read as the year, ordinal months, ranges);
      b. "nothing to do" on acceptances and confirmations of quotes or bookings (8 silent; info_only gives none, plan.ts:476);
      c. operational failures reported to the owner (5 of 81 listed; the first count of 8 wrongly included 3 gone bookings);
      d. client resolution (8: 5 none, 3 wrong);
      e. needs-reply that carries a booking need (8 silent): built in the sandbox only, because it is a display change;
      f. the replay that erases the write record (process.ts:514-517);
      g. the §10 display proposals: sandbox only; shown to the owner at Checkpoint B.
      A fix that needs a model call to measure waits for the owner's yes on a capped paid run (P01).
      BUILT, not yet measured, in the sandbox worktree C:/Users/thera/spartan-v2-p1 (branch sandbox/p1-fixes):
      - a. the parser change (ground.ts), with 7 new cases in test/v2Ground.ts; all pass. 1,336 stored quotes: +13 grounded, 0 lost.
      - c. `systemFailureOf` plus the `system-failed` alert route (process.ts, errorReport.ts); test/systemFailureToOwner.ts 7/7.
      - f. processMessage refuses to re-decide an email with something sent; test/replayKeepsWriteRecord.ts passes, and goes red
           without the guard.
      - d. shared-domain client resolution; a known domain never becomes a new client (plan.ts); test/v2SharedDomain.ts 5/5;
           planner suites and harnessGate pass.
      - e. needs-reply cards that ask for crew are listed and survive our reply (v2.ts, project.ts, serve.ts, check.ts);
           test/feedReplyWithWork.ts 5/5. A display change: shipped only with the owner's and Paz's authorization (Checkpoint B).
      - b. quote acceptances become hand-offs to confirm the order (acceptance.ts, from eval/acceptance-study.md, accepted:
           the rule reproduced at 88 fires / 1 false positive); test/v2QuoteAccepted.ts 8/8.
      - g. §10 B: a kind chip (System Problem / Ready, Writes Paused), found-by under the R, up to 3 candidates on a
           several-orders hand-off (plan.ts candidates); test/feedNeedKind.ts passes. Display: ships only with authorization.
      tsc is clean. To merge: measure a, b and d on dev with the harness (wrong writes must stay 0), then run the gate.
- [x] P3 (labels) 799 emails labelled by two readers; 14 disagreements settled by a third (eval/reads/settled.csv); verifiers
      match the consensus on 38/40 and 39/39. Split and lock: harness-engineer.
- [x] P5 MEASURED (eval/iterations.md, iterations 1-2): dev silent 16 -> 5 of 79, recall 79.7% -> 93.7%, display 94.3%;
      patch eval/patches/p1-fixes.diff (20 files, applies cleanly; NOT deployed: pushing app code to v2 deploys production).
- [ ] P6 After each iteration, check the exit conditions (§14). When one holds: red-team-B, audit/final-state.md, Checkpoint B.

## Session 4 plan (Phase 1 continues): red-team-B (668a4048) landed H1-H3 decision-changing, H4-H10 material
§14.4 "Blocked" did not hold (H10): $0 moves remain. Each step verified before the next; nothing deployed.
- [x] R1 DONE 10-26 (iterations.md iteration 3): Patch harms: H2 consumer mail domains in the shared-domain rule (resolve.ts CONSUMER_DOMAINS); H6 a single-op
      crew-chief stop is a system failure, and process.ts's "8 of 81" comment says 5; H4 an acceptance on a thread whose
      planner found the order is a confirm card on that order, never "Order Needs Created".
- [x] R2 DONE 10-26: production-shown.jsonl frozen at 90529c9 (847); harnessReal 18/18 at HEAD and patched. Harness honesty: H7 "production" in the harness is what production showed (frozen per-email outcomes at
      90529c9), not production's decisions through the TV code on disk; H14 labels/reads hash on content, eol=lf.
- [x] R3 DONE 10-26: production 65.2 / HEAD 71.2 / no display 81.0 / patch 88.6; production through patched TV 83.7. Re-measure dev in three columns (HEAD, items without display, all items), both precisions, production beside
      the replay (H3, H5, H8).
- [x] R4 DONE 10-26 (iteration 4): burst rule + repeat reach, dev 91.8% (15 silent, >=11 the reader's); no evidence-backed $0 recall move left; crew-chief 3 = Ben's rule's 4%, creates 3 single cases. Was: $0 levers, largest first, each on dev: none_thread_history (2), crew-chief composition (3 wrong writes),
      time values (2), new-order composition (3), already-as-asked settled by a blind reader (4).
- [x] R5 DONE 10-26 (569d4bb, S-0226): prospective set 79 emails locked 7f277f8725036c76, scored once: production 20/24, HEAD 20/24, patch 20/24; all 4 misses none_nothing_to_do (the reader). A clean test set (H1).
      readers + a third, locked before any step reads it. The 238 stay as a second dev set, named as tuned-on.
- [x] R6 DONE 10-26: red-team-B2 (1 decision-changing, 4 material) answered in iteration 5 (burst rule removed, parser and failure check fixed); item_correctness measured (accepted, c0245716): 8/152 HEAD, 8/216 patch; final-state.md + checkpoint-B.md written.

## Work units (from audit/spec-compliance.md "Order of work"; row ids in brackets)
- [x] W1 Ledger and decisions: this file rewritten; decisions/ holds the five dated entries (RB2-*, RB3-g, S16-2, S16-3, A2-13)
- [x] W2 item_correctness: 18/23 writes that ran, 28/40 write proposals, 18/104 over all items shown (reconstruction.md §6.7); cards re-judged after W4 (S4-3, S10-2)
- [x] W3 All 400 live-week client emails read blind by two readers (brief baffb5cd): eval/live-week-reads.md. Readers agree
      394/400 on booking work (kappa 0.97). Silent misses over all mail 16 of 90 outstanding requests (inquiry_recall 82.2%);
      26 "requests" are OnSinch portal notices, rightly suppressed; display_precision 96/104; noise 5/104. ACCEPTED: verifier V
      re-read a 10% sample blind and matches the consensus on 38/40 (both misses on the PO and quote boundaries), days 10/10. 34 rows for the owner/Paz: eval/reads/adjudicate.csv
      (S67-9, S4-2, S67-1, S4-5, S17-4)
- [x] W4 audit/card-anatomy.md (accepted: 22 of 222 citations re-opened, all hold); audit/display-proposals.md: aging policy
      (every exit marked, a passed day with an open need counted as a miss) and the minimal flagged-item change (kind chip,
      how the order was found, up to 3 candidates), proposed only; §10 status model mapped (S10-6, S10-4, S4-10, S99-2,
      S10-3, S10-7, S10-8)
- [x] W5 Glossary discrepancies raised (checkpoint-A.md §7); Q1 re-asked in OnSinch's terms (S3-3)
- [x] W6 One meaning of item (reconstruction.md §6.4): review_rate 99/122 = 81.1% on the live week (S4-4, A3-3)
- [x] W7 Spot-checks topped up (RB3-e1, RB3-e2, RB3-e4, S6-2):
      archaeologist 34 of 340 citations (every 10th) re-opened, 34 hold; TV admission re-traced (serve.ts:103-128, v2.ts:68-91);
      historian 15 of 113 rulings (A05 A15 A35 B08 B28 B38 B58 P01 added), all statuses hold; B28 cites professions.ts:14-19,
      the rule is at :227-241 (citation off, conclusion right);
      data-cartographer 15 figures (11 added: outbound 3,775, 994/1,279 threads, R/J 184 = 4.9%, 3,500 orders, statuses
      2,815/557/128, provisional 500, quote 88, 847 decisions, 653 with company, links 249/178/6/2, 1,355 first seen 08-23), all exact
- [x] W8 checkpoint-A.md: reason_code distribution of the 99 flagged items; client_resolution_accuracy 115/123 (gold, strong +
      adjudicated); NONE precision 12/19 creates; Q3 crew notices rest only on run.ts:11-14, unmeasurable offline; Q1 settled
      by the owner's own 10-13/10-16 words for creates (S99-6, S4-7, S4-8, S17-3)
- [x] W9 audit/plans-read.md (accepted: 7 quotes re-opened at source, all exact). Best fits: owner's audit = Spartan Audit
      10-03 (Claude Doc 3159313d); previous 99% plan = harness/reports/01-discovery.md §2.5. Two 10-03 owner rulings missing
      from the history (dedup AI step; several orders per enquiry). Folded into reconstruction.md §6.3 (S2-8, S2-9)
- [x] W10 Operational failures on the TV: 5 of 81 listed cards (corrected from 8); no curve because the gate has no thresholds (reconstruction.md
      §6.7) (S2-6, S4-13). audit/pipeline-trace-addendum.md (accepted: 35 of 353 citations re-opened, all hold): failure
      modes and logging for S3, S5, S9, S10, S12-S17, top findings in reconstruction.md §6.2 (S62-5, S62-6)
- [x] W11 alignment.md rewritten (669 words in short bullets, every file path, 8 decisions with their evidence);
      checkpoint-A.md has a summary; the subagents' own summaries are left as returned (S7-3, RB6-1, RB6-4, RB6-5, RB6-8,
      S121-5)

## Section checklist
- [x] §6.1 Purpose: self: audit/reconstruction.md §6.1
- [x] §6.2 Anatomy: archaeologist (b6c84053, accepted; 34 of 340 citations + one stage re-traced, W7): audit/pipeline-trace.md
- [x] §6.3 History: historian (70667283, accepted; 15 of 113, W7): audit/history-and-assumptions.md
- [x] §6.4 Metrics: metric-definer (844d70d1, accepted): eval/metrics.md
- [x] §6.5 Ground truth: label-auditor (37c65576, accepted, 10 of 98): eval/label-audit.csv + eval/label-audit.md
- [x] §6.6 Data map: data-cartographer (9b5d88d5, accepted; 15 figures, W7): audit/data-map.md
- [x] §3 Glossary and Q1: glossary-verifier (bb818e87, accepted): audit/glossary.md
- [x] §6.7 Failure taxonomy: taxonomist (fb98f168, accepted, 14 of 117): eval/failure-taxonomy.md
- [x] Reconstruction §6.1-6.7: self: audit/reconstruction.md (revised after red team A)
- [x] Red team A: red-team-A (9ed3bb6c, accepted, 6 of 20 hits re-run): audit/red-team-A.md
- [x] §7.3 Alignment: self: audit/alignment.md (revised after red team A; length W11)
- [x] §7.4 Stabilization: self: audit/checkpoint-A.md §4
- [x] §7.5 Highest-leverage move: self: audit/checkpoint-A.md §5
- [x] §7.6 Risk tiers and metric replacements: self: audit/checkpoint-A.md §6
- [x] §7.7 §17 answers: self: audit/checkpoint-A.md §7
- [x] §10 aging policy, proposed at Checkpoint A: self: audit/display-proposals.md §A
- [x] §10 minimal display change for flagged items, proposed: self: audit/display-proposals.md §B
- [x] §9.9 reason_code distribution, reported at the checkpoint: self: checkpoint-A.md §6
- [x] Spec compliance review: spec-compliance (056ac5ff, accepted): audit/spec-compliance.md

## Active subagents
| agent | brief hash | dispatched | expected output | status |
|---|---|---|---|---|
| (none running) | | | | |

Accepted on 10-26: readers A5, B5 (76fe3b9c), 79 prospective emails, 75/79 agree on booking work; third reader Vv3 matched the pair on 7/8 sampled agreements and settled the 4 splits (all A+V).
Accepted on 10-26: item-correctness c0245716 (headline recounts from its table: 6/152, 6/216; its labels agree with the diagnostic on 65/65 shared items; its two scorer faults confirmed and fixed).
Returned 10-26: red-team-B2 668a4048 (audit/red-team-B2.md): every dev column reproduced; hits answered in final-state.md.
Returned 10-26: red-team-B 668a4048 (audit/red-team-B.md): 3 decision-changing, 7 material, 5 minor. H1 re-checked by me (60 of live-week dev in the 238 test); H7 reproduced (harnessReal fails with the patch). Session 4 plan answers each.
Accepted on 10-25: diagnostic-11-3 7b8bd993 (75/75 as-is codes equal eval/harness/runs/live-week-replay-all.json; headline counts recount from its table).
Returned 10-25: readers A3, B3, A4, B4 (all 399; strict agreement 785/799 across both batches).
Accepted on 10-25: readers A1, A2, B1, B2 (baffb5cd), checked by a third blind reader V on a 10% sample, 38/40 + days 10/10.
Accepted on 10-25: card-anatomy a4ae517a (22 of 222 citations re-opened, all hold).
Accepted on 10-25: isolation-verifier e102bf03 (attempts 1 and 5 re-run by me after closing G1-G3).
Accepted on 10-25: harness extension to 799 (dev 561 / test 238, test hash d2790450e2c9ae4f; harnessReal 18 checks green).
Accepted on 10-25: plans-reader 65fcb127 (7 quotes re-opened at source, all exact).
Accepted on 10-25: acceptance-study 49f7e423 (rule re-run through acceptance.ts: 88 fires, 1 false positive, as reported).
Accepted on 10-25: stage-gaps d279ecf8 (35 of 353 citations re-opened, all hold).
Accepted on 10-25: spec-compliance 056ac5ff. About 25 of 218 rows re-opened at their cited lines, all as stated: every §6.5,
§6.7 and SUPERSEDED row (label-audit.md:11-22, failure-taxonomy.md:331-382, data-map.md:238-261), glossary.md:148-163,
review_rate 100% vs 207/275, no aging policy anywhere in the package, alignment.md 966 words, and every RB2 row against
this file as it stood.

## Handoff notes
- §6.1 purpose -> alignment: the system exists so every client email that asks for crew, or a change to a booking, becomes
  the right OnSinch order or change without staff re-keying it, and anything it cannot do reaches staff on the TV. Staff
  consume the TV and the To Confirm orders; "correct" for them is the order they would have built, from the email's words.
- §6.4 metrics -> §6.7: A (227) and B (114) are one metric, the harness's oracle e2e bit, on two disjoint GENERATED sets;
  71 of A's 227 were planner crashes scored as correct handoffs. Not a baseline for §4. The real-mail first cut (gold:
  inquiry_recall 194/298, silent misses 104) was checked: 79 of its `none_nothing_to_do` misses are a label artefact
  (failure-taxonomy.md:64), so it is not a baseline either.
- §6.5 labels -> §6.7 / Phase 1: 532/1000 harness labels wrong under current rulings (projection from 98 hand checks;
  426 "never the day alone", 70 two-week rule). The 500 are synthetic; NONE/not-inquiry only in the simple set. System bug
  seen: "move a shift to another day" finder searches the new day (plan.ts:229), 10 cases.
- §6.2 anatomy -> §6.7: one model call per email (extract.ts:114), the rest code; client resolved first and the reader
  shown only that client's bookings; In-Reply-To/References read nowhere on the v2 path; "not an inquiry" has no decision
  kind; the TV lists only needs-created/updated, one card per thread; an unconfirmed card stays red with a follow-up flag
  and leaves silently when its last job day passes.
- §6.3 history -> alignment: 113 rulings: 76 enforced, 12 dead, 25 contradicted. No known-good tag. Every >=97% figure came
  from a scripted or perfect reader, generated mail, or already-linked threads; real mail never above 81% unrelabelled.
- §6.6 data -> §6.7: thread headers stored only since 10-23; outbound kept (3,775), R/J in 4.9% of our subjects;
  sender->client 89.1% on replay (1,175/1,319, 30 d), but production stored a company for 85.9% (week) and 82.2%
  (snapshot), with 2 wrong; candidate pool median 2, 83.4% <=5.
- §6.7 taxonomy -> Checkpoint A: live week, 84 real inquiries with staff work: silent 4 (95.2%; 79/84 if the ambiguous
  case counts). The denominator is only emails staff acted on: 291 of 400 were never read (W3). 31/32 week-review "missed
  changes" are label error. System misses: parse 23 (at most 15 parser-side), pipeline 21, wrong_action 13, wrong_client 7.
  Of 16 bot creates, 14 were rebuilt by staff: 9 equal by day, times and crew, 7 also by trade.
- red team A -> Checkpoint A: "close the hand-over" withdrawn (decisions/2026-10-25-hand-over-move-withdrawn.md). The move
  is a real-mail eval set over every client email, two readers, owner or Paz adjudicate.
- §3 glossary -> §6.1: every order has a Job from creation (3,435/3,500), so "job" is not a later stage; draft->booked is
  the provisional flag. Bot creates go to To Confirm; bot edits are live with no confirm. There is no confirm-ready
  waiting state: a write runs at once.

## Open questions (OPERATING §17 + new)
| # | question | evidence | status |
|---|---|---|---|
| Q1 | May the system book directly when confident, and what should the TV tick do in OnSinch? | Creates go to To Confirm (apiCreate.ts:92); edits are live; 1 of 21 bot creates confirmed, 11 deleted; rulings conflict (checkpoint-A.md §7). The order->job framing is wrong (glossary). | owner |
| Q2 | What are metrics A and B? | One harness metric on two generated sets, broken fake world; 304/154 at HEAD (eval/metrics.md) | answered |
| Q3 | Which actions are reversible? | Tiers T1-T4 (checkpoint-A.md §6). Open part: does an edit or a new position notify crew? Rests on a 10-15 comment, unmeasured (W8). | owner (crew notices) |
| Q4 | display_precision floor? | Unmeasured over all mail; 59 of 62 on a staff-worked set (checkpoint-A.md:71). W3 measures it. | owner, after W3 |
| Q5 | Outbound and headers retained? Ids in subjects? | Outbound kept 3,775 rows; headers since 10-23 (159/169 Message-ID); R/J in 4.9% of our subjects | answered |
| Q6 | Which usage limit was hit? | OpenRouter credit (402) on 10-11, balance not rate; 3-103 model calls a day, $0.02-3.42 a day | answered |
| N1 | What do OPERATING §2's placeholders name? | Best fits (plans-read.md): owner's audit = Spartan Audit 10-03; 99% plan = the harness plan (99% reported met, its set later 227/500). No known-good version anywhere. | owner to confirm |
| N5 | Do the owner's 10-03 rulings still hold: an AI step on every dedup, and several orders per enquiry? | A .28403, .43260; v2 plans one order per change (plan.ts:190-239); not yet assessed | owner |
| N2 | Does "client" count as the second fact beside the day (evidence.ts:2-3)? | Decides 426 generated labels | owner |
| N3 | Who labels the eval set, and who settles disagreements? | checkpoint-A.md §5 | owner |
| N4 | Why did staff rebuild the bot's orders? Ask through Paz. | 14 of 16 rebuilt, 9 equal by day, times and crew | owner |

## Decisions made this engagement
- 2026-10-24 decisions/2026-10-24-production-stays-shadow.md (owner)
- 2026-10-25 decisions/2026-10-25-only-bot-writes-paused.md (owner; done, commit 8f05615)
- 2026-10-25 decisions/2026-10-25-hand-over-move-withdrawn.md (orchestrator, on red team A)
- 2026-10-25 decisions/2026-10-25-pause-window-store-only.md (owner: "store them without deciding"; pulled 10-25, the
  store runs on or after 2026-10-28 16:06Z, see Next action)
- 2026-10-25 decisions/2026-10-25-spec-review-reopens-checkpoint-a.md (owner's request, and how it is read)

## Memory (OPERATING §5: do not act)
- The owner will email Paz about system login and confirming the display shows only real,
  actionable inquiries. Until then the display is untouched beyond what §10 permits.
- Significant display/screen work happens later, after Paz confirms.
- Intake runs on n8n. The owner is migrating intake to the Gmail API personally. Not my job; build
  no new intake logic on n8n and no replacement.
- Future swipe queue (approve / send back): not building it; keep the data model able to hold a
  rejected/held state with a reason.
- Client-facing auto-reply (asking for job number / address) is authorized for unresolvable
  inquiries; design per §9.6; always stubbed in the sandbox; sends nothing until the owner enables it.

## Context carried in (before this engagement; hypotheses, not inputs)
- Phases 1-3 of the 10-23 review addendum shipped as S-0213..S-0217 (6a98170). The test suite runs
  on PGlite; harnessGate in the gate; strict weekly scorer; live week 10-14..10-21: wrong writes 2,
  coverage 7/108, missed changes 32, lost emails 0.

## Live state (read-only transactions)
- 10-25: Settings intake_paused=false, bot_writes_enabled=false. Intake, Intake Watchdog, Spartan Sync and Spartan Alarms
  active. Production is shadow + TV.
- 10-24: 353 messages since 10-21, last decision 10-24 22:18Z; 22 write decisions since 10-21, 0 executed.

## Blockers
none

## Next action
N2 in C:/Users/thera/spartan-v2-n1: the five planner op fixes in eval/next-block.md, each red-first on a synthetic case of
the real shape, then N3 (writes-run dev and dev-2, run.ts recall). Nothing ships; writes stay off. On or after
2026-10-28 16:06Z: the pause-window store (scripts/backfill-pause-window.mts store). On 10-29: label W2 (eval/dev-windows.md).
Worktrees p1, i14, n1, rd, rdh hold junctions to this checkout: unlink each junction and verify before removing any of them
(audit/incident-2026-10-26-tmp-data.md).
