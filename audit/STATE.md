# STATE.md

Updated: 2026-10-25   Session: 2

## Phase and section
Phase: 0   Current section: §7 Checkpoint A (re-presented 10-25)   Status: awaiting checkpoint

Checkpoint A was presented on 10-25. The owner then asked "review the original spec and continue with your audit one by one"
(decisions/2026-10-25-spec-review-reopens-checkpoint-a.md). That is read as: close the spec gaps one by one, then present
Checkpoint A again. It is not read as confirmation; Phase 1 does not start.

## Session 2 plan
1. spec-compliance (fresh agent, read-only) lists every Phase 0 / Checkpoint A requirement as MET / PARTIAL / MISSING /
   SUPERSEDED: done, audit/spec-compliance.md, accepted.
2. Close its 60 PARTIAL and MISSING rows as the work units W1-W11 below, in that order, each committed through the gate.
3. Present Checkpoint A again (W11) and stop.

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
- [x] W10 Operational failures on the TV: 8 of 81 listed cards; no curve because the gate has no thresholds (reconstruction.md
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
| (none) | | | | |

Accepted on 10-25: readers A1, A2, B1, B2 (baffb5cd), checked by a third blind reader V on a 10% sample, 38/40 + days 10/10.
Accepted on 10-25: card-anatomy a4ae517a (22 of 222 citations re-opened, all hold).
Accepted on 10-25: plans-reader 65fcb127 (7 quotes re-opened at source, all exact).
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
Await the owner's response to the re-presented Checkpoint A (audit/alignment.md, audit/checkpoint-A.md). Do not begin
Phase 1. Separately, on or after 2026-10-28 16:06Z: `npx tsx --env-file=.env.local scripts/backfill-pause-window.mts store`,
then confirm 40/40 stored and 0/40 decided.
