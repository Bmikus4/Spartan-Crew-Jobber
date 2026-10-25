# STATE.md

Updated: 2026-10-24   Session: 1

## Phase and section
Phase: 0   Current section: §7 Checkpoint A   Status: awaiting checkpoint

## Session 1 plan
Runbook §1: created this ledger; read OPERATING §0-§5, §16, §6, §7, §12, A.1-A.3. Recorded Memory.
Wrote the six Phase 0 briefs (audit/briefs/, each with audit/briefs/_common.md) and dispatched
all six in parallel, read-only. Session 2: receive, spot-check at least 10% of each, accept or
re-dispatch, write handoffs.

## Section checklist
- [x] §6.1 Purpose: owner self: /audit/reconstruction.md#61-purpose (drafted)
- [x] §6.2 Anatomy: owner archaeologist: /audit/pipeline-trace.md
- [x] §6.3 History: owner historian: /audit/history-and-assumptions.md
- [x] §6.4 Metrics: owner metric-definer: /eval/metrics.md
- [x] §6.5 Ground truth: owner label-auditor: /eval/label-audit.csv + /eval/label-audit.md
- [x] §6.6 Data map: owner data-cartographer: /audit/data-map.md
- [x] §3 Glossary and Q1: owner glossary-verifier: /audit/glossary.md
- [x] §6.7 Failure taxonomy: owner taxonomist: /eval/failure-taxonomy.md
- [x] Reconstruction: owner self: /audit/reconstruction.md (draft, before red team)
- [x] Alignment: owner self: /audit/alignment.md (draft) + /audit/checkpoint-A.md (items 4-7)
- [x] Red team A: owner red-team-A (fresh agent): /audit/red-team-A.md (move withdrawn and replaced; see checkpoint-A.md)
- [x] Checkpoint A message (Runbook §6): /audit/alignment.md (one page) + /audit/checkpoint-A.md (items 4-7, red-team responses)

## Active subagents
| agent | brief hash | dispatched | expected output | status |
|---|---|---|---|---|
| archaeologist | b6c84053 | 2026-10-24 S1 | audit/pipeline-trace.md | ACCEPTED: extract.ts:114 (the one model call), process.ts:109-115 (client before orders, context scoped), no In-Reply-To/References read on the v2 path: all re-opened and true |
| historian | 70667283 | 2026-10-24 S1 | audit/history-and-assumptions.md | ACCEPTED: 7 sampled rulings (A10, B12, B22, B32, B42, B52, B62) re-opened at their cited lines, all as stated |
| taxonomist | fb98f168 | 2026-10-24 S1 | eval/failure-taxonomy.md | ACCEPTED: 14/117 re-bucketed (every 10th row + both strict silent-miss kinds) from decision, executed, staff acts, final order state: 14/14 agree; caveat: "equal" ignores trade split |
| red-team-A | 9ed3bb6c | 2026-10-25 S1 | audit/red-team-A.md | ACCEPTED: 6 hits re-run (H1 v2.ts:89, H2 B30(6)/B32 words, H3 18/18 replies median 0.20 h, H4 S-0191 10-16 04:37Z, H6 serve.ts:140 + LiveFeedScreen:259 + liveState:19, N1 R11562 absent), all true; every hit answered in checkpoint-A.md |
| label-auditor | 37c65576 | 2026-10-24 S1 | eval/label-audit.csv + .md | ACCEPTED: 10/10 sampled rows re-run, system answers match, classes follow current rulings |
| data-cartographer | 9b5d88d5 | 2026-10-24 S1 | audit/data-map.md | ACCEPTED: 7,289 msgs / 1,279 threads / 0 header rows reproduced; R/J subjects 184 (validated against real orders) vs 248 any R/J token (mine): definition, not error |
| metric-definer | 844d70d1 | 2026-10-24 S1 | eval/metrics.md | ACCEPTED: 227/114 and 71 crash-passes, 236/40/500 crashes reproduced exactly from my own pre-fix run |
| glossary-verifier | bb818e87 | 2026-10-24 S1 | audit/glossary.md | ACCEPTED with a note: request_approval (apiCreate.ts:92), 3,435/3,500 one-Job orders, 1,864 API orders reproduced; "4 of 1,864 confirmed" is 0 on my id join (same conclusion) |

## Handoff notes
- §6.4 metrics -> §6.7: A (227) and B (114) are one metric, the harness's oracle e2e bit, on two disjoint GENERATED sets; 71 of A's 227 were planner crashes scored as correct handoffs. Not a baseline for §4. Real-mail first cut (gold, unaudited labels): inquiry_recall 194/298, silent misses 104, review_rate 207/275, client agreement 186/189: VERIFY before use.
- §6.5 labels -> §6.7 / Phase 1: 532/1000 harness labels wrong under current rulings (projection from 98 hand checks; 426 "never the day alone", 70 two-week rule). The 500 are synthetic; NONE/not-inquiry only in the simple set. System bug seen: "move a shift to another day" finder searches the new day (plan.ts:229), 10 cases. Ben question: does "client" count as the second fact beside the day (evidence.ts:3)?
- §6.2 anatomy -> §6.7: one model call per email (extract.ts:114), the rest code; client resolved first and the reader shown only that client's bookings; In-Reply-To/References read nowhere (0/7,289 filled); "not an inquiry" has no decision kind or code; the TV lists only needs-created/updated, one card per thread; an unconfirmed card stays red with a follow-up flag and leaves silently when its last job day passes.
- §6.3 history -> §6.7 / alignment: 113 rulings: 76 enforced, 12 dead, 25 contradicted (e.g. "no step may require a human" vs To Confirm and the TV). No known-good tag: only v0.01-v0.03 (July prototype); six candidates, none measured near 99% on real mail. Every >=97% figure came from a scripted or perfect reader, generated mail, or already-linked threads; real mail never above 81% without relabelling. 227/114 first written in fb01342 on 10-24 from the broken harness.
- §6.6 data -> §6.7: thread headers 0/7,289 (node live 10-23, no mail since); outbound kept (3,775), R/J in 4.9% of our subjects; sender->client 89.1% (1,175/1,319, last 30 d), 0 disagreements on 92 hand links; candidate pool median 2, 83.4% <=5. inbound_raw not in snapshot.
- §6.7 taxonomy -> Checkpoint A: live week, 84 real inquiries with staff work: silent 4 (3 needs-reply cards neither TV nor Gmail shows, 1 info_only misread); 31/32 week-review "missed changes" are label error (ops-truth 36 h latest-email rule); 67 system misses: parse 23, pipeline 21 (12 right creates rebuilt by staff), wrong_action 13, wrong_client 7. Buckets are the code live at the time; start-only times, staffed time refusals, duplicate shifts fixed at HEAD.
- red team A -> Checkpoint A: "close the hand-over" WITHDRAWN (needed writes on; reverses Ben 10-13 "only those cases"; labels from 10-16 did not stop 6/6 rebuilds; the 4 strict silent misses reached staff via inbox). Highest-leverage move now: a real-mail eval set over every client email (291 of the live week never read), labels from the email's words, two readers, owner/Paz adjudicate. Production not healthy until intake_paused=false (owner yes needed): it blinds the intake alarm and tells staff intake is off.
- §3 glossary -> §6.1: every order has a Job from creation (3,435/3,500): "job" is not a later stage; draft->booked is the provisional flag (order_confirm_provisional). Bot creates go to To Confirm; bot edits are live with no confirm; staff confirm their own orders 59%, the bot's almost never (deleted 11/21). There is no confirm-ready waiting state: a write runs at once.

## Open questions (OPERATING §17 + new)
| # | question | evidence so far | status |
|---|---|---|---|
| Q1 | Must a person confirm every order -> job, or may the system book directly? | Lead: bot creates go to OnSinch "To Confirm" (request_approval: true); bot edits to existing orders are written directly. glossary-verifier to settle. | open |
| Q2 | What are [METRIC A] and [METRIC B]? | Lead: 227/500 and 114/500 are the harness's end-to-end score on two different GENERATED sets (simple, update), measured while its fake world was broken (83e4972: now 304 and 154). If so, OPERATING §2's "500 real inquiries ... true baseline" is not real mail and not one set. metric-definer to verify. | open |
| Q3 | Which action types are reversible? | not started | open |
| Q4 | display_precision floor? | owner's call after Phase 0 | open |
| Q5 | Outbound mail and headers retained? Opp ids in outbound subjects? | Lead: headers stored since S-0208 (10-23); our replies are in thread_messages. data-cartographer to count. | open |
| Q6 | Which service hit the usage limit, at what volume? | not started (OpenRouter 402 on 10-11 is in the code comments) | open |
| N1 | Which artifact is "the previous known-good version [NAME/TAG]", "the owner's audit", "the previous 99% plan"? (§2 placeholders are unfilled) | historian to propose candidates | open |

## Decisions made this engagement
- 2026-10-24, owner, on the live-state read (intake live, writes off, TV on): "thats fine nothing is supposed
  to be stopped right now, the dashboard is staying up". Production stays as it is; the
  stabilization proposal (checkpoint-A.md §4, no revert) matches it.

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

## Live state read 2026-10-24 (read-only transaction)
Settings intake_paused=true (a TV flag only, serve.ts:44), bot_writes_enabled=false. Intake live: 353 messages
since 10-21, last decision 10-24 22:18Z. 22 write decisions since 10-21, 0 executed: production is shadow + TV.

## Blockers
none

## Next action
Await the owner's response to Checkpoint A (audit/alignment.md, audit/checkpoint-A.md). Do not begin Phase 1;
if the owner corrects the alignment, revise and re-present.
