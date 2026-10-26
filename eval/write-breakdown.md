# The 27 replay writes on dev, case by case (owner's item 3, 10-26)

Fork of the orchestrator, 2026-10-26.

**Inputs**
- **Replay:** `replay()` (harness/real/replay.ts) over the 561 dev emails (labels/all.jsonl, split-all.json), run twice under TZ=UTC: at HEAD 305bf84 (main checkout) and with eval/patches/p1-fixes.diff (C:\Users\thera\spartan-v2-p1). Both runs give 27 writes, the same 27 ids with identical ops. Each counted 0 model calls and 0 network attempts.
- **Staff's acts:** read from the 10-26 audit copy (.tmp-data/gold-1026/timeline.json, through 10-25 19:10Z). Order-level rows are keyed by number, cancels flagged automated are dropped, and the bot (user 2257) is excluded.
- **Order states:** week-truth-orders, then the 10-22 copy, then the 10-26 copy, as eval/item-correctness.md read them.
- **Judging:** `truthKeys`/`judge` from the patched app/lib/v2/score.ts.

**Constraints**
- Production was never touched; $0.
- No email body was read. A request is described from the two blind readers' labels and the stored reading's structured values.
- Times are London times (BST until 10-25).
- The scratch scripts were deleted.

## Summary

- **27 replay writes, 23 assessable.** The other 4 are unscored because staff acted on several orders and nothing singles one out (section 1).
- **The patched scorer itself gives 6 completed, 8 partial, 9 wrong, not 8/6/9.** Checkpoint B's 8/23 is a by-value judgement: the 2 planned creates equal staff's orders shift by shift. The patch's truthKeys fix (score.ts:75-78) skips only "add shift" and "add position" on an order staff made. It still counts the build's own "add job" and the slot edits made while building, so both creates stay partial.
  - **The scorer fix in the patch (item 4) is incomplete**, and test/scoreStrict.ts does not plant those acts.
- **Read against the audit trail, 16 of 23 writes did what their email asked (69.6%, CI 47.1-86.8).**
  - 7 are real errors and 1 is a sequencing risk.
  - The other "partial" and "wrong" verdicts are scorer artefacts:
    - intermediate values kept as separate keys;
    - a position added and deleted within seconds, counted as work;
    - shift keys read from the order's final state after a later email changed it;
    - unrelated PO-field bookkeeping inside the 96 h window.
  - This is my reading of the audit timing, not a relabel. The reported metric stays the scorer's until the scorer is fixed and re-run.
- **The 7 real errors:**
  - a time change for a named role and trade applied to every position on the shift, so 14 of 16 people would be an hour off (1);
  - change_crew ignoring the request's window or length (2);
  - an availability question planned as 4 edits to an order staff had built 31 minutes earlier (1);
  - a known venue not matched, so a new OnSinch place (1);
  - trade mix on a create (2).
- **None of the 3 "crew-chief composition" cases is a disagreement with the chief rule.** In both that are in the 27, the plan books exactly staff's headcount and chief count. Both are window errors. The third (dev-2) is an "add 3" against "3 in all" headcount question (section 5).
- **History is not the replay.**
  - Production made a write decision on 11 of the 27.
  - 8 were blocked at their first op by the signed-on-crew guard, 2 never ran, and 1 ran and verified.
  - That one was a create that staff deleted and rebuilt 32 minutes later: a duplicate.
  - In 5 of the 11, production's older planner wrote different time values from HEAD's: it kept the old end when the start moved, once making a shift 17:00-17:00. HEAD's values equal staff's in all 5.
- **Verified read-back exists for 1 of the 27.** It proves OnSinch holds what the bot sent, not that it was right. Both verified writes in this note were undone by staff (section 4).
- **"Selection-bound" was the wrong word.** The diagnostic shows retrieval is not the bottleneck. The loss is in reading (no request read) and in making the change (section 6).

## 1. From 27 writes to 23 assessable, and the 6/8/9 against 8/6/9

**The 4 unscored writes.** Each is labelled none-derivable under the item-correctness rules: staff acted on several of the client's orders on named days in the window, and no R/J number or independent link singles one out.

| id | the write | orders staff acted on in the window | production at the time |
|---|---|---|---|
| 1a1214440d06cbef | PO on R11500 | R11500 (made in the window) and R11224. The readers named no day, so the day test is dropped. | none |
| 1a121640a61d9b46 | crew changes on R11461 | R11461 and R11511 (made in the window) | hand-off |
| 1a134990c712db28 | crew to 7 on R11404 | R11404, R10778, R11454 | hand-off |
| 1a13a8890d485caa | retime and crew on R11404 | R11404, R11454 | write, blocked |

1a121640a61d9b46 is unscored, but it shows a planner defect: one write holds two set_position_size ops on the same position (3, then 2) plus a cancel. Two change_crew requests for the same day and start were both applied to one position.

**How 6/8/9 became "8/6/9".**
- item-correctness judged 6 completed, 8 partial, 9 wrong with HEAD's scorer.
- It noted that the 2 partial creates, 1a121423eac99289 and 1a13af10fc5250eb, equal staff's orders by value. Counted as completed, that gives 8/23.
- The patch then changed truthKeys to skip "add shift" and "add position" on an order staff created.

**Re-derived here with the patched scorer, it is still 6/8/9.** Staff's build also logs:
- "add job" (R11529 and R11561);
- slot edits made while building:
  - R11529's 11-07 shift entered as 06:30-18:30 and moved to 20:30-02:30 in the same minute;
  - R11561's position changed from Crew to Bar Staff 5 minutes after creation.

truthKeys still counts these as extra staff work. So 8/23 holds as a by-value judgement, not as the patch's output. No other verdict differs from eval/item-correctness.md.

## 2. The 27 cases

- **Replay prediction:** the ops at HEAD, identical with the patch, as booking keys. `R…/slot` is the position, and times are London.
- **Scorer:** the patched judge().
- **Audit reading:** this note's reading of the audit trail.

| id | email (UTC) | class | true order | replay prediction (HEAD = patch) | scorer | audit reading | production at the time |
|---|---|---|---|---|---|---|---|
| 1a11b960c83ae418 | 10-08 12:56 | re-time | R11275 high | R11275/58571 → 10-10 11:00-15:00 | completed | right | write, same op; not run (executed empty) |
| 1a1206f2acc35678 | 10-09 11:31 | PO | R11351 high | PO on R11351 | partial | right (typo artefact) | none (info_only) |
| 1a12078a52daae2c | 10-09 11:42 | crew count | R11475 med | R11475/59428 → 5 (6 in all) | partial | right (bookkeeping artefact) | hand-off: the day word not grounded |
| 1a121423eac99289 | 10-09 15:22 | create | NONE (R11529) high | new order: 11-05 06:30-18:30 and 11-07 20:30-02:30, each 8 Crew + 2 Crew Chief, place 2 | partial | right (by value) | hand-off: client asked for a quote |
| 1a1214440d06cbef | 10-09 15:23 | PO | none-derivable | PO on R11500 | unscored | - | none |
| 1a121640a61d9b46 | 10-09 15:59 | crew count | none-derivable | R11461/59378 → 3, cancel 59379, 59378 → 2 | unscored | - | hand-off: crew not grounded |
| 1a1217a58683c4a6 | 10-09 16:23 | PO | R11453 med | PO on R11453 | completed | right (see note a) | none (info_only) |
| 1a1259926be7623f | 10-10 11:35 | re-time | R11224 high | R11224/58403, 58404 → 10-11 17:00-23:00 | partial | right (add/delete artefact) | write, value differs (17:00-00:00); not run |
| 1a12c17f9c71e222 | 10-11 17:52 | re-time | R11498 high | R11498/59496 → 10-13 20:30-22:30 | partial | right (PO 43 h later) | hand-off: no day in the words |
| 1a12fc76a35c018d | 10-12 11:01 | re-time | R11224 high | R11224/58405, 58406 → 10-12 20:30-00:30 | partial | right (add/delete artefact) | hand-off: 2 shifts on the day |
| 1a1308b99b2eaf9b | 10-12 14:36 | add shift + re-time | R11508 high | R11508/59529, 59530 → 10-15 19:00-01:00; new shift 10-16 08:30-12:30, 3 Crew + 1 Crew Chief | wrong | right (final-state artefact) | write, same 3 ops; op 1 blocked (signed-on crew), 2-3 not run |
| 1a13438a3dd67400 | 10-13 07:44 | create | NONE (R11527) med | new order: 11-13 05:00-09:00 and 23:59-03:59, each 5 Crew + 1 Crew Chief, at a NEW place | wrong | **wrong: venue** | hand-off: quote |
| 1a1345c6d25b4669 | 10-13 08:23 | re-time | R11224 high | R11224/58407, 58408 → 10-13 18:45-00:45 | partial | right (add/delete artefact) | write, same ops; op 1 blocked (signed-on crew) |
| 1a134990c712db28 | 10-13 09:29 | crew count | none-derivable | R11404/59153 → 7 | unscored | - | hand-off: 2 crew positions |
| 1a13585d743572a8 | 10-13 13:48 | re-time | R10522 high | all 3 positions of shift 35069 → 10-18 07:00-12:00; all 3 of shift 35068 → 07:00-17:00 | wrong | **wrong: whole shift** | hand-off: client not resolved |
| 1a139bb8ded24cbd | 10-14 09:25 | crew count + chief + re-time | R11541 high | add Crew Chief 09:00-13:00; R11541/59680 → 3; 59679, 59680 → 10-21 09:00-12:00 | wrong | **wrong: question read as change** | hand-off: linked order unreadable |
| 1a139bd196d4eff6 | 10-14 09:27 | create | NONE (R11549) med | new order: 10-30 09:30-13:30 and 20:00-00:00, each 3 Crew, place 7061 | wrong | **wrong: trade mix** | **write, same op; ran, verified (R11546); staff deleted it** |
| 1a13a8890d485caa | 10-14 13:09 | re-time + crew | none-derivable | R11404/59595, 59596 → 10-15 16:15-20:15; 59156 → 5 | unscored | - | write, same ops; op 1 blocked (signed-on crew) |
| 1a13a979194ef05f | 10-14 13:26 | cancel | R11508 high | cancel R11508/59604, 59605 | wrong | right for its email; **reversed 3 h later** | write, same ops; op 1 blocked (signed-on crew) |
| 1a13af10fc5250eb | 10-14 15:03 | create | NONE (R11561) high | new order: 10-29 16:00-20:00, 1 Bar Staff, place 76 | partial | right (by value) | hand-off: times not grounded |
| 1a13b4ff18f0a1da | 10-14 16:47 | re-time | R11508 high | R11508/59604, 59605 → 10-16 10:00-14:00 | completed | right | write, value differs (10:00-12:30); op 1 blocked |
| 1a13e9ba4edde86b | 10-15 08:08 | re-time | R11479 med | R11479/59441 → 10-15 14:30-18:30 | completed | right | write, value differs (14:30-19:30); blocked |
| 1a13e9ff8d34c9e2 | 10-15 08:13 | re-time | R11029 high | R11029/58505 → 10-21 17:00-20:00 | completed | right | write, value differs (**17:00-17:00**); blocked |
| 1a13f49e6e01c4ab | 10-15 11:18 | create | NONE (R11602) high | new order: 11-02 Crew 09:00-11:00 and Crew 09:00-12:00 (two shifts); 11-03 2 Crew 17:30-19:30; place 6954 | wrong | **wrong: trade** (partly an artefact) | hand-off: a day plus a time read as the year |
| 1a13fea576aeda13 | 10-15 14:14 | crew count + chief | R11613 high | add Crew Chief 17:00-23:00; R11613/59905 → 3 | wrong | **wrong: window** | hand-off: crew not grounded |
| 1a1405bd65b444b6 | 10-15 16:18 | re-time | R11029 high | R11029/58343 → 10-19 15:15-18:15 | completed | right | write, value differs (15:15-19:00); blocked |
| 1a154d69fc48ba38 | 10-19 15:44 | crew count + chief | R11349 med | add Crew Chief 22:00-03:00; R11349/58866 → 4 | wrong | **wrong: window** | hand-off: OnSinch GET /orders 404 |

Note a: on 1a1217a58683c4a6 the readers also read a new booking, and staff made R11505 in the window. The write sets only the PO, so the new booking is a recall gap outside this write.

## 3. The partial and wrong cases

### Partial by the scorer (8)

**1a1206f2acc35678 (R11351, PO)**
- Requested: both readers read a PO only, with R11351 named. The reading is info_only with a PO and no requests.
- Staff: set the PO 18 minutes after the email, first with a trailing space, then the same value without it in the same minute.
- Proposed: the PO staff ended with.
- Difference: none in the final value.
- Stage: scorer (every intermediate value is a key, score.ts:96-108).
- Risk: low.
- Production at the time: none.

**1a12078a52daae2c (R11475, crew count)**
- Requested: readers read a change on 10-12, crew 6. The reading has 08:00-12:00, 6 in all, 2 more.
- Staff: position 59428 from 3 to 5, 1 h 7 min after the email (6 with the chief). Hours later, and again on 10-13, staff wrote invoice references into the order's PO field.
- Proposed: 59428 to 5.
- Difference: the invoice-reference edits, which neither reader nor the reading holds.
- Stage: attribution (the 96 h window).
- Risk: none.
- Production at the time: hand-off, because the weekday was not grounded.

**1a121423eac99289 (NONE → R11529, create)**
- Requested: readers read a quote or availability request for 11-05 and 11-07, crew 20. The reading has two new shifts of 10.
- Staff: built R11529 on 10-13, 90 h after the email: both shifts, 8 Crew + 2 Crew Chief each, place 2.
- Proposed: identical.
- Difference: none by value.
- Stage: scorer (section 1).
- Risk: none by value.
- Policy: it was a quote request, and staff booked it as an order (not a quote).

**1a1259926be7623f (R11224, re-time 10-11)**
- Requested: a change on 10-11. The reading has start 17:00 and no end.
- Staff: moved both positions of shift 41611 from 18:00-00:00 to 17:00-23:00 the day before.
- Proposed: the same (the start moves and the length is kept).
- Difference: 4 positions added to R11224 that were all deleted: one on 10-11 at 19:27Z (deleted next morning), two added and deleted in the same minute on 10-12, one added and deleted within 13 s on 10-13. Net zero.
- Stage: scorer (it counts the add and ignores the delete).
- Risk: none.
- Production at the time: write 17:00-00:00, keeping the old end (7 h); not run.

**1a12c17f9c71e222 (R11498, re-time 10-13)**
- Requested: a change on 10-13, 20:30-22:30. The day comes from the subject.
- Staff: position 59496 from 21:30-23:30 to 20:30-22:30, 5 minutes after the email.
- Proposed: the same.
- Difference: a PO set 43 h later, which neither reader nor the reading holds.
- Stage: attribution.
- Risk: none.
- Production at the time: hand-off, "no day the client wrote".

**1a12fc76a35c018d (R11224, re-time 10-12)**
- Requested: a change on 10-12, 20:30-00:30 (one reader also read a question).
- Staff: both positions of shift 41612 from 21:00-01:00 to 20:30-00:30, 18 minutes after the email.
- Proposed: the same.
- Difference: the 10-13 add-and-delete.
- Stage: scorer.
- Risk: none.
- Production at the time: hand-off, "2 shifts on 2026-10-12 could be the one meant".

**1a1345c6d25b4669 (R11224, re-time 10-13)**
- Requested: a change on 10-13, 18:45-00:45.
- Staff: both positions of shift 41613 from 19:00-01:00 to 18:45-00:45, 15 minutes after the email.
- Proposed: the same.
- Difference: the same add-and-delete.
- Stage: scorer.
- Risk: none.
- Production at the time: write, same ops; op 1 blocked by signed-on crew. Staff made it.

**1a13af10fc5250eb (NONE → R11561, create)**
- Requested: a new booking or quote for 10-29, 1 person. The reading has 16:00-20:00, a bartender.
- Staff: built R11561 17 minutes after the email: 1 Bar Staff 16:00-20:00 at place 76. It was entered as Crew and changed 5 minutes later.
- Proposed: identical.
- Difference: none by value.
- Stage: scorer.
- Production at the time: hand-off (start and end not grounded).

### Wrong by the scorer (9)

**1a1308b99b2eaf9b (R11508)**
- Requested: readers read a new booking on 10-15 and 10-16. The reading has a 19:00 start on 10-15 and a new 10-16 shift at 08:30 with 4 crew.
- Staff, 35-94 minutes after the email:
  - both 10-15 positions to 19:00-01:00;
  - a new 10-16 shift 08:30-12:30 with 3 Crew + 1 Crew Chief;
  - an invoice reference in the PO field;
  - a telehandler position added and deleted in the same minute.
- Then, after the next email (1a13b4ff18f0a1da, a later start of 10:00), staff moved the 10-16 shift to 10:00-14:00 on 10-15.
- Proposed: exactly staff's work for this email.
- Difference: none. The scorer reads the 10-16 shift as it ended and pools the later email's retime.
- Stage: scorer (keys read from the final state; the window pools emails).
- Risk: none.
- Production at the time: write, the same 3 ops. Op 1 was blocked by signed-on crew (3 on position 59529), and ops 2-3 never ran.

**1a13438a3dd67400 (NONE → R11527, create): real error**
- Requested: a quote or availability request for 11-13. The reading has two 4-hour calls at 05:00 and 23:59, 6 each.
- Staff: built R11527 45 minutes after the email: 05:00-09:00 and 23:59-03:59, 5 Crew + 1 Crew Chief each, at existing place 167, provisional.
- Proposed: the same shifts and crew at a NEW place made from the email's venue text ("new to OnSinch and was added").
- Difference: the place.
- Stage: venue resolution.
- Risk: a duplicate place for a known venue. The existing place's address and access notes would not be used. A create goes to To Confirm, so it can be caught before the job.
- Production at the time: hand-off (quote).

**1a13585d743572a8 (R10522, 10-18): real error**
- Requested: both readers read a change on 10-18. The reading names the AM Crew Chief and forklift driver for 07:00-12:00 and the PM forklift for 07:00-17:00.
- Staff, 30 minutes after the email:
  - AM: the chief starts 07:00 (end stays 13:00), the Counterbalance forklift goes to 07:00-12:00, and the 6 Crew stay 08:00-13:00;
  - PM: the forklift goes to 07:00-17:00, and the chief and 6 Crew end 17:00 (start stays 08:00).
- Proposed: every position on the AM shift to 07:00-12:00 and every position on the PM shift to 07:00-17:00.
- Difference: the AM 6 Crew an hour early and an hour short of 13:00, the AM chief ending at 12:00, and the PM chief and 6 Crew starting at 07:00. Only the two forklifts are right: 14 of 16 people would be an hour off.
- Stage: composition. change_times retimes every position of the shift (plan.ts:587-590) and ignores the role and trade the reading carries.
- Risk: high. Edits are live with no confirm, and crew arrive early or leave early.
- Production at the time: hand-off (client not resolved).

**1a139bb8ded24cbd (R11541): real error**
- Requested: both readers read a question plus a quote or availability request for 10-21. The reading is quote_request with a new shift 09:00-12:00 (3 hours rather than 4), 4 crew.
- Staff: built R11541 31 minutes before the email (09:00-13:00: a Crew Chief, a Carpool Driver, 2 Crew). They changed nothing after the email and cancelled the order on 10-20.
- Proposed: 4 edits to R11541: a Crew Chief added, crew to 3, both positions to 09:00-12:00.
- Difference: edits where staff made none. The scorer's one staff key is staff's own build before the email.
- Stage: planning. bookedAt (plan.ts:378-397, Ben 10-20) treats a requested shift that differs from one booked at the same start as the client's change. Here it was a question about an order staff had just made.
- The added chief is also a replay limit. Staff's chief position (slot 59678) is gone from the copy, so the time-correct world shows no role-1 position.
- Risk: unasked live edits that cut an hour and add a second chief.
- Production at the time: hand-off (linked order unreadable).

**1a139bd196d4eff6 (NONE → R11549, create): real error, and it happened**
- Requested: a quote or availability request for 10-30, 3 crew. The reading has load-in 09:30-13:30 and load-out 20:00-00:00, 3 each.
- Staff: built R11549 32-47 minutes after the email: both shifts at place 7061, 2 Crew + 1 Carpool Driver each. The order was cancelled on 10-19.
- Proposed: the same shifts and place, 3 Crew each.
- Difference: one Crew per shift is a driver in staff's build. The scorer cannot judge the create itself: the order's positions are all cancelled now, so truthKeys reads "created, now empty".
- Stage: create composition (a trade inside the headcount that the email did not name; 1 case).
- **Production created it** (R11546, 09:27Z, verified by read-back). Staff built R11549 instead and deleted R11546's job at 10:19Z.
- eval/iterations.md:266 says staff "amended the client's existing quote order". The audit shows a new order_create, not a copy, and the bot's order deleted.

**1a13a979194ef05f (R11508, cancel 10-16): sequencing risk**
- Requested: both readers read a cancel on 10-16. The reading has cancel_shift on R11508.
- Staff: no cancel. 3 h 21 min later the next email asked for a 10:00 start, and staff moved both positions to 10:00-14:00 the next morning.
- Proposed: cancel both positions (Crew Chief + 3 Crew).
- Difference: the client reversed itself.
- Stage: none for this email. The scorer pools the next email.
- Risk: high if it had run: crew released (whether OnSinch notifies them is Q3, unmeasured), and the later retime finds cancelled positions.
- Production at the time: write, same ops; the signed-on-crew guard blocked it.

**1a13f49e6e01c4ab (NONE → R11602, create): real error, partly an artefact**
- Requested: a quote or availability request for 11-02 and 11-03, 4 people. The reading has "stage builder" and crew on each day.
- Staff, 26 minutes after the email:
  - 11-02: Crew 09:00-11:00 + Crew 09:00-12:00, in one shift;
  - 11-03: 1 Crew.
- At 1 h 37 min after the email: 11-03 went to 2 Crew, and the 11-02 09:00-12:00 person became a Carpenter to 13:00.
- Proposed: the 11-02 pair as two shifts, and 11-03 2 Crew. "Stage builder" was booked as Crew because no live profession has that name.
- Difference: one 11-02 trade and an hour, set later. Staff themselves used Crew for the stage builder on 11-03. The shift grouping is the scorer's distinction.
- Stage: trade mapping.
- Production at the time: hand-off (a day plus a time read as the year).

**1a13fea576aeda13 (R11613, 10-19): real error (a crew-chief case)**
- Requested: a change on 10-19, crew 4. The reading has "4 in all", call at 17:00, a 4-hour call, no end.
- Staff: set the shift to 17:00-23:00 with 2 Crew 11 minutes before the email. 35 minutes after the email: a Crew Chief added, crew to 3, both 17:00-21:00.
- Proposed: a Crew Chief 17:00-23:00 and crew to 3. Times untouched.
- Difference: the headcount and chief count equal staff's (3 + 1 chief). The end is 23:00 against 21:00 for all 4 people.
- Stage: reading and grounding (the 4-hour length was not carried as an end) and composition (change_crew ignores a request's times; the new chief copies the shift's window, plan.ts:638-641).
- Risk: 8 person-hours over, live.
- Production at the time: hand-off.

**1a154d69fc48ba38 (R11349, 10-22): real error (a crew-chief case)**
- Requested: a change on 10-22, 2 more crew, 22:00-01:00.
- Staff, after trial edits on 10-19: the 3 Crew stay 22:00-03:00, plus 1 Crew 22:00-01:00 and 1 Crew Chief 22:00-01:00. That is 5 people with 1 chief (10-22 copy).
- Proposed: crew 3 → 4 and a Crew Chief, all 22:00-03:00. Also 5 people with 1 chief.
- Difference: the 2 added people end at 03:00 instead of 01:00.
- Stage: composition (change_crew ignores the request's window, plan.ts:606-656).
- Risk: 4 person-hours over, live.
- Production at the time: hand-off (OnSinch read 404).

## 4. Replay, history and read-back, kept apart

**Replay prediction (all 27):** HEAD and the patch hold identical ops. This is what production would decide today on the stored reading, through the time-correct world.

**Historical production (the decision made at the time):**
- 11 write decisions, 13 hand-offs, 3 none.
- Of the 11 writes:
  - 6 hold the same booking keys as the replay;
  - 5 differ, all time changes where the older planner kept the old end: 17:00-00:00, 10:00-12:30, 14:30-19:30, **17:00-17:00**, 15:15-19:00. HEAD's values equal staff's in all 5.
- Execution:
  - 8 were blocked at op 1 by the signed-on-crew guard ("ops must make this change"), and later ops never ran;
  - 2 never ran (executed is empty; the copy does not say why);
  - 1 ran.
- The guard stopped the reversed cancel (1a13a979194ef05f) and 4 of the 5 old-planner time values. The fifth (1a1259926be7623f) never ran.

**Verified read-back:**
- Within the 27: 1 (1a139bd196d4eff6). The bot's R11546 read back as sent, and staff deleted it and rebuilt the order.
- Outside the 27, in dev-2: 1a158a5e6bd47095's 2 ops verified, and staff cancelled the added chief the next day (section 5).
- Read-back checks transport, not correctness.

## 5. Crew-chief cases

**The rule.** Ben, 10-15: 4 or more on a shift carry a Crew Chief, 10+ two, 20+ three, and one more per further 10, all inside the headcount. A chief the client asks for on a smaller shift is booked.
- Source: app/lib/v2/interpret/plan.ts:60-71 (`chiefsFor`); audit/history-and-assumptions.md B39 (C-items :42-44).
- It matched 96.0% of 3,145 staff shifts (1-3: 99.2%, 4-9: 93.3%, 10-19: 88.6%).
- "Inside the headcount" means the client's count does not grow: one of the N is the chief, who leads on site and is a different profession (Crew Chief, 36) from Crew (1). That makes the error material (who leads, and the role crew are booked and paid as), not cosmetic.

**The cases.** The diagnostic's "crew-chief composition, 3" (eval/diagnostic-11-3.md:249) were 1a13fea576aeda13, 1a154d69fc48ba38 and 1a158a5e6bd47095.

| case | plan | staff | what is actually wrong | consequence had it stood |
|---|---|---|---|---|
| 1a13fea576aeda13 (R11613) | 3 Crew + 1 Chief, 17:00-23:00 | 3 Crew + 1 Chief, 17:00-21:00 | the window, not the chief | 4 people booked 2 h long |
| 1a154d69fc48ba38 (R11349) | 4 Crew + 1 Chief, 22:00-03:00 | 3 Crew to 03:00, plus 1 Crew + 1 Chief to 01:00 | the window of the 2 added | 2 people 2 h long; the chief stays to 03:00 |
| 1a158a5e6bd47095 (R11662, dev-2, not in the 27) | "add 3" on a 1-Crew shift: 3 Crew + 1 Chief (4) | after the bot's write: 3 Crew, chief cancelled | headcount: the reading's "add 3" against staff's 3 in all (the readers' crew field says 3 and does not separate the two) | **it happened**: production wrote both ops (verified, 10-20 09:31Z); a 4th person booked as Crew Chief for 25 h until staff cancelled the position (10-21 10:05Z) |
| 1a139bb8ded24cbd (R11541) | a chief added | staff's build already had a chief | an availability question read as a change, plus a replay-world limit | a second chief on a just-booked order |

None of them is the rule disagreeing with staff on the same headcount. Calling them "within the 4%" (eval/iterations.md:263, final-state.md:103) was wrong on the facts, as well as on the reasoning.

## 6. "Selection-bound" and action_accuracy 7/50 (eval/diagnostic-11-3.md)

**Population**
- The live-week label set's dev split: 280 emails.
- 95 of them are booking work: strict inquiry 99 plus B42 quotes 9, less 13 portal notices.
- 75 have a derivable true order: 46 existing, 29 NONE.

**Injection.** For each scored email, the thread's link is the true order's id (null for NONE), at harness/real/replay.ts:125. The stored reading is fixed.

**Definitions**
- **selection_given_correct_candidate** = right picks ÷ emails whose true order was a candidate. It was 58/72 as is and 62/75 injected.
- **action_accuracy** = items whose write judge() calls completed ÷ items with a right order-or-NONE pick. Items are what the TV shows, listed or check.
  - The denominator is 50 in both runs.
  - It was 4/50 = 8.0% as is and **7/50 = 14.0% (CI 5.8-26.7)** injected.
  - A hand-off proposes no change, so it can never count.

**What still failed with the right order injected (43 of 50)**
- 17 hand-offs by the 14-day rule (plan.ts:775). By rule they propose no change.
- 8 reading_unproven hand-offs, 3 request_unsupported, 1 client_unknown, 1 policy_confirmed_proposal.
- 13 of 20 writes not completed: 4 partial, 9 wrong (crew-chief 3, time 2, a cancel staff re-timed 1, create composition 3).
- The diagnostic's 9 wrong overlap this note's 9 on 5 ids. The other 4 are 1a13f516bb4f171f and 1a13f8312ae75c73 (hand-offs as is, writes only when injected), and 1a158a5e6bd47095 and 1a14063b8d8dd75c (dev-2, outside the 561).
- The diagnostic's judge carried the same scorer artefacts as section 7. It also ran before the order-number fix, so cancels and PO edits were misfiled.

**Was "selection-bound" the right word? No.**
- The brief defined selection as picking the order and making the change, and the label hid what the data says.
- Retrieval is not the bottleneck: the true order was in the pool for 46/46 and in the top 5 for 43/46.
- Order choice given the candidate is 62/75. 10 of the 11 existing-order misses are the reader: no request read, info_only, or history only.
- The change is where the loss is.
- The accurate verdict: **not retrieval-bound; reading-bound and change-bound.**

## 7. Failure modes by class, then tiers

| class (23 assessable) | writes | scorer completed | right for the email (audit reading) | failure modes seen |
|---|---|---|---|---|
| PO set | 2 | 1 | 2/2 (CI 15.8-100) | none; one typo artefact |
| re-time a shift | 10 | 5 | 9/10 (CI 55.5-99.7) | a role- or trade-named time applied to the whole shift (1); historically 5/5 production values wrong under the older planner, fixed at HEAD |
| crew count, chief unchanged | 1 | 0 | 1/1 | none |
| crew count with a chief position | 3 | 0 | 0/3 (CI 0-70.8) | window or length ignored (2); a question read as a change (1); dev-2: add against total (1) |
| cancel | 1 | 0 | 1/1 for its email | the client reversed it 3 h later (sequencing) |
| add a shift to an order | 1 | 0 | 1/1 | none |
| create an order | 5 | 0 (2 by value) | 2/5 (CI 5.3-85.3) | venue not matched (1); a trade inside the headcount (1); an unnamed trade (1) |
| **all** | **23** | **6 (8 by value)** | **16/23 = 69.6% (CI 47.1-86.8)** | 7 real, 1 sequencing |

**Candidate tiers.** None is proposed for unattended running now. Turning writes on fixes none of the modes above.

1. **What every class needs before it could run unattended**
   - The scorer faults below are fixed and the verdicts re-run.
   - A shadow window on current-reader mail, scored per class.
   - Zero wrong over at least **368** consecutive ops of that class. That is the smallest n at which 0 errors puts the two-sided 95% upper bound under 1% (1-0.025^(1/n)). At dev's rate (10 re-times in about two weeks), it is months for the busiest class.
2. **Least-risk candidates, in order, each needing its own check**
   - **PO set:** the value appears verbatim after a PO label (the planner already leaves off a PO it cannot place).
   - **Whole-shift re-time:** only when the request names no role or trade and the shift has one window; the length rule stays tested; the signed-on-crew guard stays.
   - **Crew count with no chief change.**
3. **Not candidates**
   - Chief changes, which need the request's window honoured and add-against-total settled.
   - Cancels: hard to reverse and exposed to sequencing; a later email on the thread must be waited for. Crew notification is Q3.
   - Creates: venue and trade. They already go to To Confirm, and staff rebuilt 14 of 16 bot creates historically.
4. **Staff confirmation stays required for every class until the shadow evidence exists.** Model confidence is not a gate: every wrong write here came from a confident, grounded reading.

**Scorer faults to fix first** (score.ts truthKeys and judge, and the act window)
1. Every intermediate value is a separate key, so a typo-then-fix or a toggle counts as two changes.
2. An add is counted and its delete ignored. Delete rows name the parent as `id`; the deleted object is `data.model` / `data.id`.
3. On a staff-made order, "add job" and the build's own slot edits still count (the patch skips only add shift and add position).
4. Shift and create keys are read from the order's final state, so a later email's change turns an earlier right plan wrong.
5. The 96 h window pools the next email's work and unrelated bookkeeping. Attribution should stop at the next client email on the thread.
6. A create whose order was later cancelled cannot be judged ("created, now empty").

## Limits

- **No body was read.** "Requested" comes from the two readers' labels and the stored reading's structured values.
- **The audit reading is mine.** It was not adjudicated by the owner or Paz, and no label was changed.
- **R11541's chief at 09:25** could not be restored from the copy (replay-world limit).
- **Order states are as of 10-22, 10-23 and 10-26.** A later staff edit outside the window can still shape a final-state key (fault 4).
