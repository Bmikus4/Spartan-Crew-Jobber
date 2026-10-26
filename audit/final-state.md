# Final state (Checkpoint B, OPERATING §14)

Orchestrator, 2026-10-26. Two red-team passes attacked this claim: `audit/red-team-B.md` and `audit/red-team-B2.md`, brief 668a4048. Their hits and my answers close this file.

Every figure comes from the real-mail harness (`harness/real/`). Its replay runs at $0, with no network and no model.

The proposed change is `eval/patches/p1-fixes.diff` (25 files on 569d4bb). It was built in a sandbox, and the full suite passes with it. **It is not deployed. Nothing reached production, and writes stay off.**

## Summary

**The exit that holds is §14.4, Blocked.** Each remaining lever needs the owner, or mail that has not arrived yet:
- **The reader on current mail.** On mail no step has read, all 4 misses are the model reading "no change asked for".
  - Production changed its reader on 10-15. The dev misses blamed on the reader were all made before that.
  - So a reader-prompt change has no clean set to tune on until current-reader mail is labelled as a new dev window. That is two blind readers over mail that keeps arriving: $0, and it needs time, not a decision.
- **The display rule.** On dev it is the largest single lever. On current mail, production showed no silent reply card on any of 24 inquiries (dev: 33 of 184). Its value on current mail is unproven, and shipping it needs authorization (§16) with Paz.
- **One definition.** Is completing an accepted quote's order booking work the TV should show? On clean mail, that answer is the only difference between production and the patch.

**The held-out figure.** Mail sent after the 10-22 copy is the prospective set:
- 79 emails, 24 B42 inquiries;
- read by two blind readers (75/79 agree), with a third settling the 4 splits;
- locked before any run (7f277f8725036c76) and scored once.

The run files are kept in `eval/harness/checkpoint-b/`.

| prospective (24 B42 inquiries) | production, as shown | HEAD replay | patch without the display rule | whole patch |
|---|---|---|---|---|
| inquiry_recall | 20/24 = 83.3% (CI 62.6-95.3) | 20/24 | 20/24 | 20/24 |
| on threads no tuned set touched (17) | 15/17 | 15/17 | 15/17 | 15/17 |
| items / display_precision, B42 | 23 / 87.0% | 23 / 87.0% | 29 / 69.0% | 30 / 66.7% |
| writes | | 13 | | 13, the same ids |

- **The patch reaches none of the 4 misses.** It adds 6 acceptance cards and 1 reply card. 27 of the 79 emails sit on threads the tuned sets touched; the 17 inquiries on untouched threads give the same 15/17 in every column.
- **The run used the patch before iteration 5.** Its figures hold for the final patch:
  - the parser gives identical counts on all 514 prospective texts;
  - the removed burst rule fired 0 times there;
  - the other changes report or score, and decide nothing.
- **The acceptance definition.** 7 prospective emails are excluded as already done: production said "already booked", and both readers read a new booking in all 7. The patch draws a card on 4 of them. Staff then worked on 3 of those 4 quote orders: admin notes, team descriptions, contact lists (eval/iterations.md, the checkpoint run). If completing the quote order is booking work, all 7 count: production 20/31, patch 24/31. That is the owner's to say; no label was changed after scoring.

**Dev (561 emails, 184 B42 inquiries).** These are tuned on. They show direction only, and most of their misses come from the reader production replaced on 10-15.

| metric (dev, B42) | production, as shown | HEAD replay | patch without the display rule | whole patch |
|---|---|---|---|---|
| inquiry_recall (≥ 99.5%) | 121/184 = 65.8% (CI 58.4-72.6) | 133/184 = 72.3% | 151/184 = 82.1% | 165/184 = 89.7% (CI 84.3-93.7) |
| display_precision, any request / B42 | / 82.4% | 96.1% / 84.9% | 95.8% / 77.0% | 95.8% / 74.1% |
| none_precision | | 70/88 = 79.5% | 70/88 | 70/88 |
| review_rate (≤ 5%) | 126/142 = 88.7% | 125/152 = 82.2% | 164/191 = 85.9% | 189/216 = 87.5% |
| **item_correctness (≥ 99%)** | | **8/152 = 5.3% (CI 2.3-10.1)** | | **8/216 = 3.7% (CI 1.6-7.2)** |
| writes / new-order proposals | | 27 / 88 | 27 / 88 | 27 / 88, the same ids |

**item_correctness** (eval/item-correctness.md, accepted): the true order is derived from staff's own acts and graded.
- It is a card-carries-no-change figure. Only a write judged completed by value counts.
- **Writes** pick the right order 23 of 23 times where it can be derived. They complete the change 8 of 23 times (34.8%): 2 more after the scorer stopped counting a staff-built order twice.
- **Cards** name the right order 69/91 (HEAD) and 86/136 (patch). The patch adds 64 cards and no write.
- **The 238 emails first called the test set are tuned on (H1)**, so they are dev-2. The 95.7% once reported on them is in-sample, and from an earlier patch.
- **"Production, as shown" is a reconstruction.** It is production's stored decisions drawn by the TV code of 10-23 (90529c9), frozen once. The TV code changed 27 times over the dev weeks, and re-plans are not in the copy (B2-9).
- **The replay is not production.** On dev it runs 6.5 points above production and matches its outcome on 476 of 561. On the prospective set the two agree on the headline.
- **The §11.3 diagnostic says the loss is selection-bound.**
  - recall@5 is 43/46; counting the 8 multi-order emails as misses gives 43/54.
  - With the true order injected, selection is 62/75 and action_accuracy 7/50.

## What the patch does

25 files; each behaviour has a test that fails without it. The full suite passes with it.

**Not visible to staff:**
1. **The system's own failures email the owner** (`systemFailureOf`). Over the 847 stored decisions it reports 9:
   - 2 read or plan failures;
   - 3 part-way stops;
   - 2 bot failures on OnSinch's page;
   - 2 writes naming a contact the client does not hold.
   The other 16 blocked writes are rule refusals.
2. A replay can no longer erase what a write sent.
3. An OnSinch time with no zone is read as UTC.
4. The scorer judges a staff-built order once (`truthKeys`, score.ts). Only scoring scripts call it. Production imports only `fullyWritten` from that file, which is unchanged.

**Visible on the TV and in Gmail labels:**

5. The parser reads "28-Nov", "duration: 4", day lists and ranges, and "reduce this crew to 5", but never a time or a place as a headcount.
6. A client's acceptance of a quote is a card to complete the quote's order. It is drawn as an update, because a duplicate order is the worse error. 4 of the 27 study acceptances had no quote order, and 28 of 39 dev cards name no order (B2-6).
7. Client resolution:
   - a domain shared by 2-3 companies is settled by the company the email names;
   - personal mail hosts are never evidence;
   - a known business domain is never a new client.
8. **The display rule:**
   - a reply card that asks for crew, or that the reader found unclear, is listed and survives our reply;
   - System Problem / Ready, Writes Paused chips;
   - the card shows how its order was found and up to 3 candidates.

Items 1-4 have not been built or tested as their own subset (B2-11). On a yes, they are cut and tested before shipping.

**Committed outside the patch:**
- the harness (production frozen as shown; repeats reached through the earlier card; a second copy for the prospective set);
- two measurement scripts that read an Order's audit rows by id where OnSinch writes its number (`scripts/ops-truth.mts`, `scripts/gold/truth.mts`; test/orderAuditByNumber.ts). Before the fix, week-review dropped or misfiled order cancels, copies and PO edits.

## What remains, and what would move it

| gap | evidence | what would move it | needs |
|---|---|---|---|
| The current reader reads "no change asked for" | 4/4 prospective misses | A current-reader dev window (mail from 10-26, two blind readers), then a prompt change measured on a capped paid run | time, then the owner's yes |
| Whether the 10-15 reader switch fixed the old misses | 11 dev misses, all pre-switch | Re-read those 11 and a control sample with the current reader (about $0.10) | the owner's yes |
| The display rule | dev 82.1 → 89.7%; production's decisions 65.8 → 83.7%; 0 reply-card misses on current mail | Ship it, with Paz | the owner |
| Acceptance definition | 3 of 4 prospective quote orders worked after the acceptance | A ruling | the owner |
| item_correctness 3.7-5.3% (≥ 99%) | Cards carry no change; writes complete 8/23, with 6 partial and 9 wrong by value (eval/item-correctness.md) | Writes on by risk tier; the wrong writes by class (the diagnostic's 9 on live-week dev: 3 crew-chief within Ben's rule's 4%, 2 time, 1 cancel, 3 create) | the owner (Q1), then work per class |
| review_rate 82-88% (≤ 5%) | Writes are off, so every write is a card | Writes on, by tier | the owner (Q1) |
| Proof of 99% | 24 clean inquiries | The prospective set grows each working day: a shadow period, the patch beside production, nothing written (§14) | the owner, with the ship |

Two small items are recorded and not acted on, because changing labels only where the system missed would bias the score:
- 1a163b198663b88e is likely labelled wrong (the audit trail shows it was already done);
- 1a12b778ce6be39a is not settled.

## Decisions for the owner

1. **Ship items 1-4** (invisible to staff), cut and tested as their own patch first?
2. **Ship items 5-8 with Paz?** They change the TV and Gmail labels. The display rule (8) can go apart from 5-7.
3. **After a client accepts a quote,** staff complete its order. Is that work the TV should show?
4. **A ~$0.10 re-read** of the 11 old reader misses plus controls with the current reader? Then, once a current-reader dev window is labelled, a capped prompt run?
5. **§17, still open:**
   - Q1: may the system book directly when confident, and what should the TV tick do in OnSinch?
   - Q3: does an edit or a new position notify crew?
   - Q4: what display_precision floor? Measured with the patch: any request 95.8% (dev) and 100% (clean); B42 74.1% and 66.7%.

## Red-team hits and answers

**red-team-B** (H1-H15):

| hit | severity | answer |
|---|---|---|
| H1 test set tuned on | decision-changing | Confirmed: 60 overlap and 29 fires. The 238 are dev-2. A prospective set was built, locked and scored once. |
| H2 personal mail domains | decision-changing | Confirmed and fixed; test +3. |
| H3 gain needs the display rule | decision-changing | Columns are split everywhere. |
| H4 acceptance as Needs Created | material | Acceptances are drawn as updates (trade in item 6). |
| H5 B42 precision fall | material | Reported. |
| H6 alert caught 2 of 5 | material | One function, 9 reported (B2-8 included). |
| H7 suite failed; production rewritten | material | Production is frozen as shown; harnessReal 20/20 both ways. |
| H8 HEAD is a replay | material | Production is shown beside it. |
| H9 stale "what remains" | material | Rewritten from the current misses. |
| H10 Blocked did not hold | material | Iterations 3-5 and item_correctness done; see B2-5. |
| H11-H15 | minor | Answered in iterations 3-5. Checkpoint runs are kept. "Production runs in UTC" rests on the platform default. |

**red-team-B2** (B2-1..B2-12):

| hit | severity | answer |
|---|---|---|
| B2-1 burst rule draws Needs Created on existing bookings | decision-changing | Confirmed; the rule is removed (iteration 5). Dev recall 91.8 → 89.7%. It fired 0 times on clean mail. |
| B2-2 dev misses are a replaced reader's | material | Confirmed. The summary, gaps and Decision 4 are reframed. |
| B2-3 prospective not thread-disjoint | material | Confirmed (27/79). On untouched threads: 15/17 in every column. |
| B2-4 counterfactual denominator | material | Corrected to 20/31 against 24/31. |
| B2-5 Blocked did not hold | material | item_correctness measured ($0, accepted). Card kinds fixed or traded (B2-1, B2-6). The wrong label and the unsettled miss are recorded, not relabelled. What remains needs the owner or new mail. |
| B2-6 acceptance cards with no order | minor | A trade, stated in item 6. |
| B2-7 parser read times as crew | minor | Fixed; test +3. Identical on all prospective texts. |
| B2-8 3 blocked writes unflagged | minor | Fixed; 9 reported; test +2. |
| B2-9 production is a reconstruction | minor | Stated. |
| B2-10 stale statements | minor | Corrected throughout. |
| B2-11 subset untested | minor | Decision 1 says it is cut and tested first. |
| B2-12 unverifiable claims | minor | Checkpoint run files kept in eval/harness/checkpoint-b/. The staff edits after the acceptances are in eval/iterations.md (ids, models, fields). |

## Corrections after Checkpoint B (10-26, the owner's checks)

These are found by the owner-authorized checks (decisions/2026-10-26-checkpoint-b-response.md). The text above stands as
presented; read it with these.

1. **The scorer's own output was 6/23 completed writes, not 8.**
   - The patch's truthKeys fix skipped only "add shift" and "add position". Staff's "add job" and in-build slot edits
     still made both creates partial (eval/write-breakdown.md §1).
   - Fixed in eval/patches/item-4-scoring.diff. Re-judged on the audit copy, both are completed, so the scorer now gives
     8/6/9 and item_correctness 8/152, 8/216 as stated.
2. **"3 crew-chief within Ben's rule's 4%" (gaps table) is wrong on the facts.**
   - Two of the three book exactly staff's headcount and chief count with the wrong window.
   - The third (1a158a5e6bd47095, dev-2) is "add 3" against "3 in all". Production wrote it on 10-20 (both ops verified),
     and staff cancelled the extra Crew Chief position the next day (eval/write-breakdown.md §5).
3. **The dev misses are not only the replaced reader's (B2-2).**
   - The current reader, on the same reconstructed inputs, still leaves 9 of the 11 silent (eval/reader-diagnostic/results.md).
   - dev-2 is current-reader mail (233 of 238). With prospective-1 and dev's 81, that makes 107 labelled current-reader
     inquiries; HEAD leaves 17 silent (eval/dev-windows.md).
   - So "no clean set to tune on" was wrong: the evidence for a reader change exists.
4. **"0 silent reply cards on current mail" held only for prospective-1.** On current-reader dev and dev-2 mail, 7 of
   83 inquiries are silent reply cards.
5. **"Selection-bound" was the wrong word.** Retrieval is not the bottleneck; reading and making the change are (eval/write-breakdown.md §6).
6. **The reader's prompt did not change on 10-20 or 10-23.** prompt_id extract@f3e1a862322b is on every decision
   since 10-13; what changed is the checks and planner after the reading (audit/evidence-index.md).
7. **Staff completed all 4 accepted quote orders, not 3 of 4.**
   - Each was confirmed from provisional (`order_confirm_provisional`) and given its PO within 0.0-0.9 h of the
     client's acceptance (R11806, R11807, R11827, R11838).
   - The Checkpoint B count read only Job, SlotTeam and Slot rows. It missed the Order-level rows, which name the order by
     its number: the trap test/orderAuditByNumber.ts pins.
   - "All four orders stay status 0 with no confirm row" is wrong.
