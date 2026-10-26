# Red team B2: the revised Phase 1 final claim (Checkpoint B)

Agent: red-team-B2. Brief hash: 668a4048 (the red-team-B brief, run again). Written 2026-10-26T02:58Z (UTC, box clock).
Attacked: `audit/final-state.md` as on disk (blob 62409a34d9dc, uncommitted), `eval/iterations.md` iterations 3-4 and the checkpoint run, and `eval/patches/p1-fixes.diff` (blob 227ede34cefa) on HEAD 569d4bb.
Method: dev replays ($0) in three scratch worktrees under `.tmp-v2/rtb/` (HEAD; HEAD + patch; HEAD + patch with only the `work` flag removed), score-production on dev (frozen, and `--display current` with the patch), `npm run test:all` with the patch, and small in-process probes of patched functions. For the prospective set I read only its committed label and split files, `production-shown-gold-1026.jsonl`, and the orchestrator's run outputs (main checkout and the `sandbox/p1-fixes` worktree). I ran no harness mode on it and no `--set test`, `--set all` or `--checkpoint`. No network, no model, no tracked file edited. Scratch removed.

## Summary

**What holds.** All four dev columns reproduce exactly: production 121/184, HEAD replay 133/184 (51 silent), patch without the display rule 155/184, whole patch 169/184 (15 silent), with every precision, review rate and none_precision as printed. With the patch, `npm run test:all` prints "ALL 228 TEST FILES PASS", and harnessReal passes 20 of 20 at HEAD and with the patch (H7 answered). `systemFailureOf` flags 6 of the 847 stored decisions, as stated. H2 holds on the snapshot: no free-mail host on 2 or more companies is outside CONSUMER_DOMAINS. The prospective labels are as stated (79 emails, 75/79 agree, 4 settled, 24 B42), and the run files give production and the HEAD replay 20/24 each, with the same 4 silent ids. The new read files carry no address, phone number or company name.

**Decision-changing (1)**
- **B2-1. Item 7 brings back H4's harm, and the claim says H4 is fixed.** 7 of the burst rule's 8 dev cards are "Order Needs Created". 5 of those 7 are on emails the readers do not call a new booking. One is a cancellation of a booking both readers name. The thread then wears the Gmail label "Order Needs Created", which outranks every other label. The H4 row says "update, never Needs Created".

**Material (4)**
- **B2-2. The dev evidence describes a reader that production replaced.** A reader before the 10-15 switch to GPT-6.1 Sol read 160 of the 184 dev inquiries and all 11 misses called "the reader's". The only misreads by the current reader are the 4 locked test emails, so Decision 4 has no clean set to tune on. Production's silent reply cards on B42 inquiries fell from 33/184 on dev to 0/24 on the prospective set. The display rule's lever is therefore unobserved on current production.
- **B2-3. The prospective set is not thread-disjoint from the tuned sets.** 27 of its 79 emails (7 of the 24 inquiries) sit on threads that have dev, dev-2 or live-week-dev emails. That includes 2 of the 4 misses and 3 of the 6 emails the patch changes. One of its emails was named in Phase 0's failure taxonomy on 10-24. §8.8 says to keep threads together.
- **B2-4. The patch's own rule picks the denominator for the "20/28 against 24/28" counterfactual.** 7 prospective emails are excluded as already done, and both readers read a new booking in all 7. The 28 adds only the 4 the patch reaches, so the patch's recall on acceptances is 4 of 4 by construction.
- **B2-5. §14.4 "Blocked" still does not hold.** The claim's own gap table lists a $0 next step whose "needs" column reads "none". The card-kind faults in B2-1 and B2-6, 1 known-wrong label and 1 unsettled miss are further $0 moves.

**Minor (7)**
- **B2-6.** 28 of the 39 dev acceptance cards carry no order. 4 of the 27 that are study acceptances had no quote order, yet each is drawn as "Needs Updated".
- **B2-7.** The widened crew-count parser reads times and addresses as crew counts, and that weakens the grounding guard.
- **B2-8.** "6 of 6 known" is self-defined. 3 blocked writes of the system's own making are not flagged.
- **B2-9.** "Production, as shown" is a reconstruction drawn with 10-23 TV code. It does not show what staff saw.
- **B2-10.** Several small statements are stale or wrong.
- **B2-11.** Decision 1 offers a subset of the patch that has never been built or tested on its own.
- **B2-12.** The whole patch's prospective run, "staff worked on 3 of 4" and "scored once" cannot be checked from the permitted files.

---

## Decision-changing

### B2-1. The burst rule draws "Order Needs Created" on existing bookings, including a cancellation; H4 is answered "Fixed"

- **Claim:**
  - final-state.md:106 answers H4: "Fixed (update, never Needs Created; none_precision back to 79.5% before item 7)".
  - final-state.md:67 describes item 7: "On dev: 8 cards, 4 of them inquiries".
  - The patch's `settleEarlier` comment says "an unread email is never 'Order Needs Created' for a booking OnSinch holds (red-team-B H4)" (p1-fixes.diff:495-496).
  - Decision 2 offers items 4-7 as one release.
- **Why it fails:**
  - **The card kind.** `settleEarlier` attaches an order only when the newest email's `none` found exactly one (p1-fixes.diff:497-498). The earlier email has no reading, so feed/v2.ts draws it as Needs Created unless the subject or reason names an R number (p1-fixes.diff:206). On dev, 7 of the 8 burst cards are `needs-created` with no order. Only 1a0fc5e980577c5b is an update.
  - **Labels on the 7:**

    | message_id | both readers | NONE label |
    |---|---|---|
    | 1a11c0d97069083c | cancel, each naming the target (booking work) | no |
    | 1a15eca19d0839c8 | PO only, each naming the target | no |
    | 1a11b38c4dccb611 | question | no |
    | 1a15fb80f5389c39 | question | no |
    | 1a11b4dfffaf96eb | nothing | no |
    | 1a11c1dba37edfea | new booking | yes |
    | 1a11bdb9afb11330 | B42 quote | yes |

  - **The fall the claim attributes to item 7 is this.** none_precision falls from 70/88 to 72/95: 7 new proposals, of which 2 are right.
  - **The Gmail label.** `labelsFor` ranks "Order Needs Created" above every other open label (app/lib/mail/threadLabels.ts:39-50). Each of these threads is therefore labelled "Order Needs Created", whatever its other cards say.
  - **A wrong item counted as a hit.** A cancellation shown as "create an order" is OPERATING §4's second-worst outcome. Recall still counts it, because the harness scores any item: 1a11c0d97069083c is one of the 4 inquiries item 7 "reaches".
- **Evidence:**
  - The patched dev replay's `rows` (`card`, `proposes_new`, `code = reading_burst_unread`).
  - A probe over the replay's decisions (`decision.order_id` null on the 7).
  - Labels from `eval/harness/labels/all.jsonl` (`A.asks`, `B.asks`, `target_ref`).
  - Command, in a patched worktree: `npx tsx harness/real/run.ts --mode replay --set dev`, then diff its rows against HEAD's for `proposes_new`.
- **Severity:** decision-changing for Decision 2 as packaged ("4-7, then 8"). The owner would approve item 7 on an H4 answer that does not hold for it. The fix is small: draw a burst card as an update when the earlier email's own words or the thread name an order, or never as Needs Created without a reading.

## Material

### B2-2. The dev diagnosis and the dev levers come from a reader production no longer runs

- **Claim:**
  - final-state.md:8: "On dev, at least 11 of the 15 left are the reader's".
  - :77 asks for a paid run of a reader-prompt change over "the misses and a control sample" (Decision 4).
  - :9 and :78 call the display rule "the largest single lever on dev" and say "ship it".
  - The HEAD column at :34 is labelled "HEAD replay".
- **Why it fails:**
  - **The replay reuses old readings.** It decides on the readings stored in the 10-22 copy (README "replay"). Those readings were made by the reader production ran when each email arrived.
  - **Production switched readers.** Production moved to GPT-6.1 Sol at 275c296 (2026-10-15 23:35 -04:00). The reader's prompt and grounding changed again at 17ebdc6 (10-20) and fb01342 (10-23).
  - **By decision code_version** (decisions.json, ancestry checked with `git merge-base --is-ancestor <cv> 275c296`):
    - Of the 184 dev B42 inquiries, 106 were decided by builds before that switch and 54 carry no code_version (decided 10-09..10-11). So **160 of 184 were read by the earlier reader**, and 24 by the Sol-era reader.
    - **All 11 "reader's" misses** were decided 10-09..10-15 by builds before the switch: 3 with no code_version, then ec938be, 645b5b8 and bdda899. All 8 `none_nothing_to_do` misses carry the reason "no change asked for" (checked).
  - **The only current-reader misreads are test emails.** These are the 4 prospective misses, which are in the locked test set. Decision 4 is left without a clean set:
    - tuned on the 11 dev misses, it fits errors the current model may not make, and a re-read with the current prompt would credit the model switch to the prompt change;
    - tuned on the 4, it spends the test set.
  - **The display rule's target has not been seen on current production.**
    - Production's silent reply cards on B42 inquiries are 33 of 184 on dev, but 0 of 24 on the prospective set. At the dev rate, 0 of 24 has probability about 0.009.
    - The HEAD replay with old readings still has 14 of 184 on dev, and 0 of 24 on the prospective set.
    - On clean mail the display rule added 1 card, on a quote that is not an inquiry (1a1698db8139299b), and no recall.
    - The "18 points" on production's decisions (:43) are measured on decisions made by builds before 10-23.
- **Evidence:** decisions.json `code_version` and `created_at` for each dev label. The run files' `rows` with outcome `needs-reply`: `all-score-production-dev.json` (33) and `prospective-score-production-test.json` (0 on B42).
- **Severity:** material. It changes how Decision 4 should be run: first re-read the dev misses with the current reader unchanged, as the control. It also changes how much the dev columns can be relied on for Decision 2.

### B2-3. The prospective set breaks threads, and one of its emails was read before the lock

- **Claim:** final-state.md:12-15, "Mail sent after the 10-22 copy ... locked before any run". The commit subject (569d4bb) says "a locked test set that no tuning step has read".
- **Why it fails:** OPERATING.md:338-339 (§8.8) requires a split "by time into dev and locked test, keeping threads together". The prospective set is a cut in time, so threads that began in the tuned sets run into it:

  | prospective emails on a thread that also has | emails (of 79) | B42 inquiries (of 24) |
  |---|---|---|
  | 799 dev emails | 16 | 4 |
  | dev-2 (the 238) emails | 11 | 3 |
  | live-week dev emails | 18 | 5 |
  | any of these | **27** | **7** |

  - These 27 hold 2 of the 4 misses (silent ids in `prospective-score-production-test.json`).
  - They also hold 3 of the 6 rows the patch changes (sandbox `prospective-replay-test.json` against main's).
  - test/harnessReal.ts:46 checks "no thread straddles dev and test" only within one split. Nothing checks the prospective set against the others.
  - eval/failure-taxonomy.md:244 (committed 5b54a78, 10-24) names prospective email 1a168607d1875747. Phase 0's truth data gives it later staff booking acts. It is one of the 6 emails the patch turns into acceptance cards.
- **Evidence:** thread ids from `eval/harness/labels/{prospective,all,live-week}.jsonl`, intersected with `split-all.json` dev and test and with `split.json` dev. Then grep the 79 ids across the repo.
- **Severity:** material. The figure shows no gain for the patch, so the overlap did not inflate a reported gain. But "clean" and "no step has read" overstate it, and later re-scorings of this set inherit the overlap.

### B2-4. The acceptance counterfactual's denominator is set by the rule under test

- **Claim:** final-state.md:26-27, "If that is booking work, the 4 are inquiries production missed ... Production is then 20/28 and the patch 24/28".
- **Why it fails:**
  - **7 excluded, not 4.** 7 prospective emails carry `excluded: already_done` (basis: "production said none_already_booked; confirmed: the R named has a live shift on the asked day"). For all 7, both readers read a new booking.
  - **The 28 adds only what the patch reaches.** The patch turns 4 of the 7 into acceptance cards: 1a1685bf51fb7ef6, 1a1685cd856e3d9a, 1a16915c98972d9e and 1a1695fbc4797b55. The other 3 stay `none_already_booked`: 1a1691cf73519e44, 1a169539cc7a2408 and 1a169712b33a563d. So 24 + 4 = 28.
  - **No reader recorded "acceptance".** Which of the 7 accept a quote is decided only by `acceptsQuote`, the rule under test. The patch's 4/4 on acceptances is true by construction, and an acceptance the rule misses would leave the denominator rather than count as a miss. The in-sample miss rate was 5 of 73 (acceptance-study.md:65).
  - **What can be said.** If all 7 counted, the figures are 20/31 for production and 24/31 for the patch. If only acceptances count, the correct denominator is unknown until a reader marks them.
- **Evidence:** `eval/harness/labels/prospective.jsonl` (`excluded`, `consensus.new_booking`), the main and sandbox prospective replay rows, and `prospective-score-production-test.json`.
- **Severity:** material. The owner is told (:10) that this definition "decides whether the patch gains anything" on clean mail.

### B2-5. §14.4 "Blocked" still does not hold

- **Claim:** final-state.md:7, "The exit condition that holds is §14.4, Blocked. Iterations 3 and 4 used up the $0 moves the evidence backs". The H10 row (:112) says the same.
- **Why it fails:** OPERATING.md:631 (§13.2) says "Continue while a specific, evidence-backed next move exists". §14.4 (:646) needs data, labels, access or an owner decision that the work cannot do without. These moves need none of them:
  - **The claim's own table**, at final-state.md:81: "item_correctness unmeasured | ... Label the true order with blind readers plus staff acts ($0) | none: next phase's first step". That is a $0 step with no owner, on a primary target.
  - **The card-kind faults** in B2-1 (7 burst cards drawn Needs Created without an order) and B2-6 (acceptances with no quote order drawn as updates). Both are measurable on dev at $0.
  - **1 known-wrong label** (1a163b198663b88e, iterations.md:229) to relabel, and **1 unsettled miss** (1a12b778ce6be39a) for a blind reader.
  - **A $0 check before Decision 4:** whether the 11 dev misreads came from the replaced reader (B2-2). Only the paid re-read needs the owner.
- **Severity:** material. "Recall" moves may be exhausted. The claim's own measurement and correctness moves are not.

## Minor

### B2-6. Acceptance cards with no order are drawn as "Needs Updated", including where no quote order exists

- Item 5 (final-state.md:62) draws every acceptance as an update (p1-fixes.diff:204).
- On dev, the 39 `quote_accepted` cards are all `needs-updated`. 28 of them carry no order (`decision.order_id` absent), and both readers read a new booking for 18 of those 28.
- 27 of the 39 are among the acceptance study's 73. For 4 of them, its T1 table finds no quote order before the email: 1a12129a60b6ebf8, 1a1217605fa76233, 1a1230b2ceeda6bb and 1a153bcb54f7f266. These are drawn as an order to update where none exists.
- 1a12129a60b6ebf8 was one of H4's 4. The study found no quote order for it, so its Needs Created card was the right one and the fix made it wrong.
- The study itself counts 19 of 73 acceptances with no quote order (acceptance-study.md:34, :76).

### B2-7. The widened crew-count parser reads times and addresses as crew

- The patch adds change, reduce, drop, cut, bring, lower, decrease and amend as verbs before "to N" in `countsIn` (p1-fixes.diff:345).
- A probe of the patched `countsIn`:

  | text | patched | HEAD |
  |---|---|---|
  | "change the start time to 8:00" | 8 | nothing |
  | "bring the call forward to 7.30" | 7 | nothing |
  | "amend the finish to 10" | 10 | nothing |
  | "change the venue to 12 high street" | 12 | nothing |

- `countsIn` is the set a model's crew value is checked against (interpret.ts:129, `check(... crew, parseCount, countsIn ...)`, :169). A misread crew value equal to the new hour is now treated as quoted.
- The pre-analysis measured 1 more crew value grounded on stored readings (iterations.md:41), so the effect is rare. It is still a loosening of the guard against invented values, on the write path once writes are on.

### B2-8. "6 of 6 known" counts only what the function was written to catch

- Over the 847 decisions there are 20 `blocked` writes. `systemFailureOf` flags 1 of them, and the 3 `mismatch` writes.
- The 16 unflagged ones it calls rule refusals: signed-on crew 13, workers on a position 3.
- 3 more are not rule refusals:
  - 1 write blocked on OnSinch's page because several company options matched ("company: N options match"). That is the bot failing on OnSinch's page, the shape the comment says counts (p1-fixes.diff:626-628).
  - 2 writes blocked because the address the plan used "is not a contact" of the company.
- So the H6 row (final-state.md:108), "6 of 6 known", is self-defined.

### B2-9. "Production, as shown" is a reconstruction, not what staff saw

- The frozen outcomes draw each production decision through the TV code at 90529c9, whose app is 6a98170's (shown.ts; final-state.md:109).
- **Dev.** v2.ts, serve.ts and project.ts had 27 commits between 10-01 and 10-22, including 8d36336 and 9b9e68c, which changed what is listed. The TV also draws `row.replan` (v2.ts:103), and the copy has none.
- **Prospective.** 69 of the 79 emails arrived before the 10-23 evening app commits (1f3ae9a..6a98170). They were decided by an earlier build.
- No measurement of what the TV actually showed exists. The "production" column is a model of production, like the replay. This is beside H8, which the claim answered by printing it.

### B2-10. Small statements that are stale or wrong

- **final-state.md:43 and :78, "154/184 = 83.7%".** score-production `--display current` with the current patch gives **155/184 = 84.2%**. The 154 predates iteration 4's harness change.
- **:42, "The patch moved them from 87.0% to 95.7%".** That is the iteration-2 patch at 569ed27. The current patch has not been measured on dev-2.
- **:23, "both readers read a change or a new booking".** For 1a16d5c74ba606ad, reader B read a question. It was a split settled 2-1.
- **iterations.md:125 and p1-fixes.diff:217, "A quote with no shifts stays a reply".** The one reply card the display rule lists on the prospective set, 1a1698db8139299b, is a quote with no day or crew for either reader (`b42_shifts` false). It is listed because its reading carries a request.
- **:44, "The prospective set is where they first agree (20/24 each)".** Production and the HEAD replay agree on the same 4 silent ids. Their TV outcomes agree on 66 of 79 (83.5%), against 476 of 561 (84.8%) on dev, so the prospective agreement is no closer.
- **The dev table leaves production's any-request precision blank.** It is 133/142 = 93.7%.

### B2-11. Decision 1 offers a subset nobody has built or tested

- Decision 1 (:90) asks to "Ship items 1-3 now".
- The patch is one diff. process.ts carries items 1, 2, 5 and 7 together, and reasons.ts carries items 1, 5 and 7 and the new codes.
- The suite, the harness and the sandbox runs were made only on the whole patch and on the patch without `work`.
- The session gate would test a 1-3 split before it ships. No figure or test result in the claim is for that subset.

### B2-12. Claims these files cannot check

- **The whole patch on the prospective set:** 20/30, "13 / 15, same ids" and "1 reply card". No run file holds it. Main's `prospective-replay-test.json` is the HEAD run (23 items, 02:29:48Z). The sandbox's is the no-display run (29 items, 02:31:49Z). Each run overwrites the last.
- **"Staff then worked on 3 of those 4 quote orders":** it rests on the 10-26 copy's audit trail, which is outside the inputs I may read for this set.
- **"Scored once":** nothing records how many times a mode ran on the set. The split was written at 02:29:29Z, 16 s before the earliest run file left (02:29:45Z).

## Checked and found to hold

- **Dev reproduces exactly:**

  | metric | production | HEAD replay | patch without the display rule | whole patch |
  |---|---|---|---|---|
  | inquiry_recall | 121/184 | 133/184 | 155/184 | 169/184 |
  | display_precision, any request | (133/142) | 146/152 | 190/199 | 214/224 |
  | display_precision, B42 | 117/142 | 129/152 | 151/199 | 164/224 |
  | none_precision | | 70/88 | 72/95 | 72/95 |
  | review_rate | 126/142 | 125/152 | 172/199 | 197/224 |

  The HEAD replay matches production's outcome on 476 of 561 emails.
- **H7:** with the patch, `npm run test:all` prints "ALL 228 TEST FILES PASS". harnessReal passes 20 of 20 at HEAD and with the patch.
- **H14:** a fresh CRLF worktree hashes the labels to 55e6f3e99cfd95d5.
- **H2:** no free-mail host on 2 or more companies is missing from CONSUMER_DOMAINS. hotmail.fr is missing, but it sits on 1 company, so the shared-domain rule does not apply.
- **H6:** 6 of the 847 decisions are flagged: 2 system_failed, 3 crew-chief `mismatch` writes, 1 bot error.
- **Prospective labels:**
  - 79 rows, of which 24 are B42 inquiries;
  - booking-work agreement 75/79, with 4 settled;
  - test hash 7f277f8725036c76;
  - production 20/23 and HEAD 20/23 on display_precision (B42), and 20/29 without the display rule.
- **Privacy:** the notes in A-5, B-5 and V-v3 contain no email address, no phone number and no company name. The one name-shaped word is a month.

Scratch: `.tmp-v2/rtb/` held three worktrees (with junctions to node_modules and .tmp-data, removed first), their run copies, logs and four probe scripts. All of it was removed after these checks. The main checkout's `eval/harness/runs/` was not touched.
