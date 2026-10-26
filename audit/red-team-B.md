# Red team B: the Phase 1 final claim (Checkpoint B)

Agent: red-team-B. Brief hash: 668a4048. Written 2026-10-26T01:54Z (UTC).
Attacked: `audit/final-state.md` as on disk (git blob 8829a1feae58), with `eval/patches/p1-fixes.diff` (blob 913c28aa1467) on HEAD 90529c9.
Method: the harness replay on dev ($0), at HEAD and with the patch in a scratch worktree (`.tmp-v2/rtb/wt`, since removed), each run twice, on the box's zone (America/New_York) and with `TZ=UTC`. I did not run `--set test`, `--set all` or `--checkpoint`. I read the orchestrator's existing `eval/harness/runs/all-replay-test.json` (the HEAD test run) for the ids of its silent misses. No network, no model, no tracked file edited.

## Summary

**What holds.** The dev headline reproduces exactly: HEAD 131/184 = 71.2% (53 silent), patched 163/184 = 88.6% (21 silent), review_rate 189/216, display_precision (any request) 207/216. With the patch, no dev email loses an item and the 27 dev writes are the same 27. Item 6 is as claimed for the replay: HEAD and patched runs are identical row for row on New York time and on UTC (561 of 561 rows each). `tsc --noEmit` is clean on the patched tree.

**Decision-changing (3)**
- **H1. The locked test set was used to tune and to diagnose, so 95.7% is not a held-out figure.** 60 of its 238 emails are live-week dev emails, and iterations 1-2 tuned on live-week dev. The acceptance rule was fit on all 799, including 25 of the 73 acceptances and 29 of the 88 fires that are test emails. 6 of the 9 test emails HEAD missed were examined during tuning. The patch removed 6 test misses.
- **H2. Item 4 opens a wrong-client write path for personal mail domains.** The new shared-domain rule has no consumer-domain guard. resolve.ts has that guard because such matches attach strangers to clients. Five personal mail domains sit on exactly 2 companies. In a probe, a new sender on one of them, whose company name shares one word with one of those 2 companies, gets a `create_order` for that unrelated company; HEAD hands it off. The same rule also stops any gmail.com sender becoming a new client, because 34 companies hold a gmail.com contact.
- **H3. "With the patch" depends on the unauthorized display change.** The reply-card rule (item 7, which needs authorization) supplies 14 of the 32 dev gains. Items 1-6 alone reach 149/184 = 81.0%, not 88.6%. Measured on production's own stored decisions, item 7 alone moves dev from 65.2% to 83.7%. Decisions 1 and 2 are asked separately, but no figure is given for each.

**Material (7)**
- **H4.** 4 quote-acceptance cards are drawn as "Order Needs Created" on orders that already exist (Gmail label "Order Needs Created"). none_precision falls from 79.5% to 76.1%, and the claim does not report it. Items 1-6 also change the live TV and Gmail labels, so "shadow" here does not mean unseen.
- **H5.** The precision reported is the one that did not move. display_precision (B42) falls from 84.9% to 74.1% on dev and is left out.
- **H6.** The owner alert and the System Problem chip catch 2 of the live week's 5 system failures. The 3 crew-chief writes stopped part-way have a shape that the predicate and its test do not cover. The code comment still carries the retracted "8 of 81".
- **H7.** "The full suite passes" is false with the patch: `test/harnessReal.ts` fails (1 of 226 files). The patch also re-scores production's unchanged decisions, moving production's dev recall from 65.2% to 83.7%. The baseline moves with the code under test.
- **H8.** The "HEAD" column is a replay, not production. Production scored 120/184 = 65.2% on the same dev set, and the replay matches production's outcome on 476 of 561 emails. The "48 of 48" check proves the scorer, not the replay.
- **H9.** "What remains" lists 4 misses from an older 280-email run, one of them a test email. Dev has 21 misses, and 8 of them are not reader-prompt problems.
- **H10.** §14.4 "Blocked" does not hold. Evidence-backed $0 moves remain, some named by the claim itself, and §13.2 says to continue while one exists.

**Minor (5)**
- **H11.** "New writes 0" covers dev only. The one new create the patch is known to make (iterations.md:112) is on a test email.
- **H12.** recall@5 = 43/46 leaves out the 8 hardest retrieval cases of the 95. If all 8 are misses, it is 43/54.
- **H13.** Stale or wrong small statements: "n = 79", "committed harness run", "1 of those asks for nothing", "did not affect any figure above".
- **H14.** The labels hash depends on the checkout's line endings.
- **H15.** Blocked from the files: the test set "run once", "Production runs in UTC", and the patched 95.7% itself.

---

## Decision-changing

### H1. The "locked test set" was tuned on; 95.7% is in-sample

- **Claim:** final-state.md:16, "inquiry_recall, locked test set (238 emails, 69 inquiries; run once, here) ... 95.7% (3 silent)". At :25 the claim calls it the test set and treats the gain on it as confirmation.
- **Why it fails:** OPERATING.md:338 (§8.8) says "Tune on dev only", and :336 says "Labels derived from the test set are never in the index". Four pieces of the Phase 1 work read test emails:
  - **Iterations 1 and 2** were measured, and their next step chosen, on the live-week dev split (iterations.md:84, :123-143). That split is independent of the 799's split (eval/harness/README.md:88-89). **60 of the live-week dev split's 280 emails are in the 799's locked test set (238).**
    - Iteration 2's new rule (show a reply card the reader found unclear) was chosen after reading the live-week dev misses.
    - 1a1456a614874008 is a live-week dev email that HEAD decides `needs-reply / reply_unclear`, and it is one of HEAD's 9 test-set misses.
  - **The acceptance rule** was tuned on all 799. Its own study says so: eval/acceptance-study.md:69, :305, "tuned on these 799 emails ... in-sample". The patch carries the same warning (p1-fixes.diff:244-245). **25 of the 73 acceptances and 29 of the 88 fires are test emails.**
  - **The parser pre-analysis** read "every reading_unproven hand-off in the snapshot's 799 read emails" (iterations.md:8), test included.
  - **The §11.3 diagnostic** replayed and per-email-analysed 23 test emails (23 of its 95 ids), and final-state.md:41-59 reports it. Two ids named in iterations.md are test emails: 1a14105b82e3493e (:138) and 1a144942ca8851d1 (:112).
- **How much it touches the figure:** HEAD misses 9 test emails, and the patch leaves 3, so 6 were removed. 6 of the 9 were examined during tuning:
  - 1a14105b82e3493e (live-week dev and the acceptance study);
  - 1a1456a614874008 (live-week dev);
  - 1a14638ee5140233 (live-week dev and the acceptance study);
  - 1a158ba2b8c735d6, 1a159376628160f2 and 1a163a317d8f7476 (the acceptance study).

  The data cannot say which 6 the patch removed without running the test set, which I may not do. Either way, 87.0% → 95.7% cannot be read as held-out confirmation, and the CI 87.8-99.1 does not describe performance on new mail.
- **Evidence (from the repo root):**
  ```
  node -e "const f=require('fs'),r=p=>JSON.parse(f.readFileSync(p,'utf8'));const t=new Set(r('eval/harness/labels/split-all.json').test);console.log(r('eval/harness/labels/split.json').dev.filter(x=>t.has(x)).length)"   # 60
  ```
  - Acceptance ids: the 73 rows of the T1 table and the 20 ids of the T3 table in eval/acceptance-study.md, intersected with `split-all.json` `.test`. Result: 25 of the 73 and 29 of the 88 fires.
  - HEAD's test misses: `metrics.headline.silent_ids` in `eval/harness/runs/all-replay-test.json`, run 569ed27+dirty.
- **Severity:** decision-changing. It is the only figure offered as out-of-sample evidence. A clean estimate needs a test set no step has read, such as mail after 10-22.

### H2. Item 4 attaches a new private sender to an unrelated client (consumer-domain guard missing)

- **Claim:** final-state.md:32-33 says "a domain shared by 2-3 companies is resolved by the company the email names; a known domain never becomes a new client".
- **Why it fails:**
  - **No guard in the patch.** The patched planner computes `onDomain` from `domainOfEmail(msg.from)` (p1-fixes.diff:387-391).
  - **The guard exists elsewhere.** `domainOfEmail` does not exclude personal mail hosts (resolve.ts:52-55). `matchCompanyByDomain` excludes them on purpose (resolve.ts:41-44, :81: "would attach every gmail.com sender to whichever client happened to have a personal address on file").
  - **Domains on exactly 2 companies.** In the snapshot (companies.json, 811 companies): hotmail.co.uk, outlook.com, icloud.com, me.com and aol.com. The rule therefore picks between 2 unrelated clients by one shared non-stop word of the model-read company name.
  - **Domains on many companies.** gmail.com is on 34 companies (googlemail.com 5, hotmail.com 3). `!onDomain.length` (diff:395) therefore stops every new private client on those hosts from being created. The hand-off then says "no single client company", which is not why it was stopped.
- **Evidence:** the probe called the patched `plan()` with a 2-company world. Each company had one contact on icloud.com. The email was a booking from a new icloud.com address whose company_name shares one word with company 501. Result:
  - patched: `write: create_order company 501`;
  - HEAD: `handoff: no single client company`.

  The same booking from a new gmail.com address with 6 gmail-contact companies:
  - patched: `handoff: no single client company`;
  - with no gmail-contact company (control): `create_order` for a new client.

  The test file test/v2SharedDomain.ts has no consumer-domain case. The replay cannot see this, because its contacts are as of the snapshot (23 of 546 clients already differ from production's).
- **Severity:** decision-changing for Decision 1 as worded ("ship 1-6"). It is a §4 second-worst outcome (wrong item, wrong client) that HEAD does not have. Writes are off today, so it shows as a wrong card until writes are turned on. The fix is one line: skip `CONSUMER_DOMAINS` as resolve.ts does.

### H3. The headline gain depends on the display change the owner has not authorized

- **Claim:** final-state.md:15 gives one "with the patch" column. Decision 1 (:67) asks to ship items 1-6 and Decision 2 (:68) to authorize item 7, with no figure for either alone.
- **Why it fails:** the dev gains split between the two decisions.
  - **The 32 gains:**
    - 18 come from item 2 (`none` → `quote_accepted`: 14 were none_nothing_to_do, 4 none_already_booked);
    - 13 from item 7's reply-card rule (`needs-reply` → listed with `work`: reply_detail_missing 9, reply_unclear 3, request_unsupported 1);
    - 1 from a read-together email whose later card became listed.
  - **Items 1-6 alone.** I removed only the `work` flag (diff:209) and replayed dev: **149/184 = 81.0% (CI 74.6-86.4), 35 silent.** So the reply-card rule supplies 14 of the 32 gains.
  - **Production's own decisions.** Scored through the patched TV code, production's stored dev decisions go from 120/184 = 65.2% to **154/184 = 83.7%** (score-production mode in the patched tree). That gain is almost all the display rule, with no planner change. The display change is the biggest single lever, and it is the one that waits on Paz.
- **Evidence:**
  - Per-email diff of `rows` and `metrics.headline.silent_ids` between the HEAD and patched `eval/harness/runs/all-replay-dev.json`.
  - The patch-minus-`work` replay.
  - `--mode score-production --set dev` in the patched tree.
- **Severity:** decision-changing for how Decisions 1 and 2 are weighed and in which order. Report three columns: HEAD, items 1-6, items 1-7.

## Material

### H4. Quote-acceptance cards say "Order Needs Created" for orders that exist; the change is visible, not shadow

- **Claim:** item 2 (final-state.md:29) turns an acceptance into "a card to confirm the order". Decision 1 (:67) calls items 1-6 a shadow ship.
- **Why it fails:**
  - **4 of the 39 dev `quote_accepted` cards are drawn as needs-created and propose a new order:** 1a11b442a6f1d6a5, 1a12083a6b0a0ea1, 1a12129a60b6ebf8 and 1a13af9c9a1d50e8.
    - At HEAD, each was `none` "already as asked". Its label excludes it as `already_done`.
    - The acceptance study finds a quote order on the day for 3 of the 4 (acceptance-study.md T1 rows).
    - The handoff carries an order only when `planned.found` has exactly one (diff:439). Otherwise v2.ts:91 draws a booking reading as needs-created.
  - **The thread gets the Gmail label "Order Needs Created"** (threadLabels.ts:40-42). The label route derives labels from every card (labels/route.ts:45-47). Staff told to create an order that exists may create a duplicate: a §4 wrong item.
  - **none_precision falls** from 70/88 = 79.5% to 70/92 = 76.1% on dev, and the claim omits it.
  - **"Shadow" here** is production's mode: writes off, TV on (reconstruction.md:25). Items 1, 2 and 4 change what the TV lists and what Gmail labels say. On dev that is 39 more listed cards out of 561 emails, and review_rate rises to 87.5%. That is not the OPERATING.md:650 shadow ("outputs compared, nothing written"). Staff will act on the patched TV, so a later shadow comparison "with what staff do" (final-state.md:64) is no longer independent of the patch.
- **Severity:** material.

### H5. The precision that fell is not reported

- **Claim:** final-state.md:17 reports display_precision (any request) as 96.1% → 95.8% ("track").
- **Why it fails:** the harness computes 2 precisions (README.md:108). The B42-inquiry one falls from **129/152 = 84.9% to 160/216 = 74.1%** on dev (patched run: 160/216; items 1-6 alone: 147/191 = 77.0%). Iteration 1 reported this drop (iterations.md:103). The 799 iteration and the final claim do not. The fall is the cost of the gain: 64 more items, of which 31 are B42 inquiries.
- **Severity:** material. §4 ranks noise third, so the decision may stand, but the owner should see the trade.

### H6. The system-failure alert and chip catch 2 of 5 known failures

- **Claim:** item 3, "The system's own failures email the owner" (final-state.md:30), and item 7's chip (:38).
- **Why it fails:** `systemFailureOf` (diff:449-453) and `isSystemFailure` (diff:193-196) flag a write only when some ops are verified and some are not.
  - **The real crew-chief stops do not match.** The live week's 3 "stopped part-way" writes are one op each, with status `mismatch` and the reason "stopped part-way: ... crew_chief: blocked". They are 1a139a998169549f, 1a13fb70176c781c and 1a139a068a0023e7.
  - **Run over all 847 production decisions,** the patched `systemFailureOf` reports 2 (1a154d69fc48ba38 and 1a158fb5c03d300b), and `reported=NO` for those 3.
  - **The test cannot see this.** test/systemFailureToOwner.ts:705 tests a `[verified, mismatch]` shape that never occurs in the data. Its own header counts "three writes stopped part-way" among the 5.
  - **The code carries a retracted figure.** process.ts's comment (diff:471-472) still says "8 of the live week's 81 listed cards", which reconstruction.md:369 corrected to 5 on 10-25. This is the S-0001 pattern CLAUDE.md warns about.
- **Severity:** material. Also match the single-op "stopped part-way" reason, and fix the comment.

### H7. The suite does not pass with the patch, and the patch rewrites production's baseline

- **Claim:** final-state.md:27, "the full suite passes".
- **Why it fails:** `npm run test:all` on HEAD + patch prints **"1 of 226 FAILED: harnessReal.ts"**. HEAD alone passes (`npx tsx test/harnessReal.ts`, exit 0, 18 PASS). The failure remains after normalising line endings, and it has two causes:
  - **"score-production reproduces all 48 figures" fails.** The harness scores production's stored decisions through the current `v2Source` and `reasons.ts`. With the patch, the live-week figures change while production's decisions do not:
    - silent misses go from 16 to 8 of 90;
    - needs-reply goes from 18 to 2;
    - listed goes from 81 to 97.

    On dev, production reads 65.2% → 83.7% (H3).
  - **"The label file equals the converted blind reads" fails.** labels.ts:23 and :148 code production's reasons with the patched `reasons.ts`, so 7 `excluded_basis` strings in all.jsonl change. The exclusion sets are unchanged (62 = 62).

  The session gate (CLAUDE.md) would refuse the patch as published. Once it lands, "production" in every harness report stops meaning what production did.
- **Severity:** material. Score production through a frozen copy of the TV code, or re-pin and say so.

### H8. "HEAD" is a replay, not what production did

- **Claim:** final-state.md:3, "Every figure comes from the real-mail harness (accepted after 48 of 48 production figures reproduced)". The HEAD column at :15 reads 71.2%.
- **Why it fails:**
  - **The 48 figures** are score-production on the live week. They prove the scorer, not the replay (baseline-live-week.md:12).
  - **Production on the same dev set** is **120/184 = 65.2% (64 silent)** (`all-score-production-dev.md`).
  - **The HEAD replay** matches production's TV outcome on 476 of 561 emails. The 85 that differ are not explained in the claim. Known causes include current code, contacts as of the snapshot (23 clients differ), 39 readings made over 1 h late, 14 emails with no stored reading, and the planner's default lead days, because the copy lacks the setting.
  - **The effect:** the patched figure is relative to a baseline 6 points better than production. How well a replay figure predicts production behaviour has not been measured.
- **Severity:** material.

### H9. "What remains" describes 4 misses, while dev has 21

- **Claim:** final-state.md:62 gives "4 silent misses where the model read 'no change asked for'", movable only by a reader-prompt change.
- **Why it fails:** that is iteration 2's live-week list (iterations.md:134-139), and one of its 4, 1a14105b82e3493e, is a test email (H1). The patched dev run has 21:

  | code | n |
  |---|---|
  | none_nothing_to_do | 8 |
  | none_read_together | 5 |
  | none_already_as_asked | 4 |
  | none_thread_history | 2 |
  | booking_not_identified | 1 |
  | needs-reply request_unsupported | 1 |

  At least 8 of the 21 are not reader-prompt problems:
  - 4 that a reader settles (iterations.md:167);
  - 2 that a thread-level count settles (:168);
  - 2 single cases.

  The test set's 3 misses are not described at all.
- **Severity:** material. The owner is asked for a paid run (Decision 3) on the basis of this list.

### H10. §14.4 "Blocked" is not the exit that holds

- **Claim:** final-state.md:7, "The exit condition that holds is §14.4, Blocked".
- **Why it fails:** OPERATING.md:631 says "Continue while a specific, evidence-backed next move exists". Several $0 moves exist that need no owner and no paid call:
  - the claim's own "next levers": crew-chief positions, time values and new-order composition (final-state.md:57). These are 9 wrong-value writes with ids (diagnostic-11-3.md:249-253);
  - the thread-level count for none_thread_history;
  - a blind reader to settle the 4 already-as-asked;
  - labelling the true order (blind readers are agents, already used);
  - the fixes for H2, H4 and H6.

  Only the reader-prompt change needs the owner.
- **Severity:** material.

## Minor

### H11. "0 new writes" covers dev only

- final-state.md:19 reports new writes on dev only. Dev holds the same 27 writes, confirmed.
- The one new create the patch is known to make is on a test email: 1a144942ca8851d1, "an unproven reading became a create" (iterations.md:112).
- The claim does not report the test run's write count.

### H12. recall@5 "close to its ceiling" leaves out the hardest cases

- final-state.md:21 and :43-44 give 43/46. The diagnostic leaves out:
  - 6 `several` emails, where staff acted on 2 to 9 orders;
  - 2 `conflict` emails, where an R/J number names another order.

  These 8 of the 95 are exactly the multi-order retrieval cases (diagnostic-11-3.md:96-97). If all 8 were misses, the figure would be 43/54 = 79.6%.
- The finder's own pick is right on 32/46 = 69.6% (recall@1, :183).
- The verdict, selection-bound, still follows from the injected run. "Close to its ceiling" overstates.

### H13. Small statements that are stale or wrong

- **final-state.md:64, "n = 79".** That is live-week dev. The 799 dev holds 184 inquiries and the test set 69.
- **:59, "the committed harness run".** `eval/harness/runs/` is gitignored (eval/harness/.gitignore), and every run overwrites it.
- **:29, "1 of those asks for nothing".** Both readers say nothing for 1. One reader also says nothing for a second (1a140936e8627133), and 15 of the 88 are PO-only. Precision on booking work is 70/88 = 79.5%, in-sample.
- **:58, "It did not affect any figure above".** action_accuracy at :23 is a `judge()` figure. Without the diagnostic's zoning step it would read 1/50, not 7/50 (diagnostic-11-3.md:49-50). The figure is right only because the diagnostic corrected it.

### H14. The labels hash depends on line endings

- The same committed blob (e895f4ab) gives 2 different labels hashes:

  | checkout | labels hash |
  |---|---|
  | main checkout (LF, written by labels.ts) | 55e6f3e99cfd95d5 |
  | fresh worktree on this box (`core.autocrlf=true`, CRLF) | c062eafe94d3393b |

- The eval/reads CSVs check out as CRLF too.
- §8.6 says "reproducible from a commit hash". That does not hold on this box's own git configuration. Fix: add a `.gitattributes` entry with `eol=lf` for eval/harness/labels and eval/reads.

### H15. Claims these files cannot check

- **"Run once" on the test set.** There is no patched test-run file. `runs/` holds only the HEAD test run (569ed27+dirty), and every run overwrites it.
- **"Production runs in UTC".** No TZ is set in the repo (next.config.ts, package.json). It rests on the platform default.
- **The patched 95.7% itself.** I may not run `--set test`.

## Checked and found to hold

- **The dev headline reproduces:**

  | | HEAD | patched |
  |---|---|---|
  | inquiry_recall (B42) | 131/184 | 163/184 |
  | silent misses | 53 | 21 |
  | review_rate | 125/152 | 189/216 |
  | display_precision (any request) | 146/152 | 207/216 |

  The patch takes no item from any email, and the 27 writes are the same 27.
- **Item 6:** the HEAD and patched replays are identical on America/New_York and on UTC (0 of 561 rows differ in each pair). Its change is confined to strings with no zone, and no caller is client-side code.
- **`tsc --noEmit`:** exit 0 on the patched tree.
- **Item 5:** `retryStopped` (process.ts:124-160) does not go through `processMessage`, so the new guard does not block the retry of stopped writes.
- **The suite made no network or model call.** The "402 out of credit" and "venue judge (gemini) timed out" lines in the suite output are stubs (test/venueAdjudicate.ts:126, test/venueRetry.ts:49).
- **Excluding "already done" emails** from the recall denominator changes little: counting all 19 dev exclusions gives HEAD 136/203 and patched 178/203.

Scratch: `.tmp-v2/rtb/` (worktree, run copies, two probe scripts), all removed after this report.
