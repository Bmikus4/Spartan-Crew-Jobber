# Phase 1 iterations (OPERATING §13.2)

Each entry records the change, the hypothesis, the result on the dev set per metric and per bucket, and the next step. Results come from the harness's replay mode on dev only. The test set is reported only at checkpoints.

## Pre-analysis for iteration 1 (P5a, the parser). Measured 2026-10-25, before the harness baseline

**What was run.**
- Every `reading_unproven` hand-off in the snapshot's 799 read emails: 67 hand-offs carrying 105 "reads as null / reads as X" reasons.
- Each failing quote went back through HEAD's own parsers: `parseDate`/`parseNewDate`, `parseTime`, `parseDuration`, `parseCount`, `amountIn`, plus the `*In` value sets.
- Only counts and masked shapes were printed: number words, units, weekdays and months kept, every other word masked.
- Scripts: `.tmp-v2/p5a3.mts`, `.tmp-v2/p5a4.mts`. Both are to be moved into the harness once it lands.

**Result.**
- HEAD already reads 56 of the 105. Parser work done since those decisions were made fixed them.
- 53 failure instances remain:

| shape (masked) | n | cause | fix |
|---|---|---|---|
| "20-Nov", "28-Nov" | 7 | a day-month form with a hyphen and the month's name is not read | `parseDate`: `(\d{1,2})-([a-z]{3,9})` |
| "24th & 25th october", "29–31 october 2026" | 6 | a list or range of days under one month yields the first day only | `datesIn`: expand "N & N month" and "N–N month" |
| "duration: 3" | 2 | the label "duration" is not read, though "hours:" is | `parseDuration`: accept `duration\s*[:\-]\s*N` |
| "increase this crew to 5" | 1 | "this crew" between the verb and "to" | `parseCount`: allow `(this\|the) (crew\|call\|shift)` |
| "de-rig", "this call", "the [shift]" as a target | 7 | the target is named by the shift, not by a value | not a parser fix: the planner resolves a target by shift name on the linked order (planner feature, P5a-2) |
| "20.11.26" read 365 days off; "15th" 61 days off | 3 | the model's year or month was wrong; the parser is right | none: the refusal is correct |
| "friday 23rd november" | 1 | 23 Nov 2026 is a Monday; the words contradict | none |
| "1 for [...] call time", "a [...] crew [...]", "1 [...]" after a date | 11 | a count with no crew word, or a team of unknown size | none yet: loosening would read stray numbers as crew. Revisit with the eval set's false-positive count |
| no date words at all ("[...] morning", "for the [...] of the week") | 4 | nothing to parse | none: needs context, not a parser |
| other single cases | 11 | mixed | per case, after the replay shows which change an outcome |

**Hypothesis for iteration 1.** The four parser changes turn up to 16 failing quotes into read values. Each hand-off whose only problems were those quotes becomes a write or a needs-created card with its values. The harness's replay on dev measures how many outcomes change and whether any wrong write appears. The change goes in only if wrong writes stay at 0 on dev.

**The change is prepared, and not applied, so the harness baseline is taken on unchanged code.** It lives in `.tmp-v2/patch/ground.ts`, a copy of `app/lib/v2/interpret/ground.ts` with four edits:
- `parseDate` reads a hyphen before the month ("28-Nov").
- `parseDuration` reads "duration: N".
- `countsIn` reads totals after change, reduce, drop, cut, bring, lower, decrease and amend.
- `datesIn` expands "N & N month" and "N-N month" (a range of at most 14 days).

Measured offline:
- The 53 recorded failures fall to 38.
- `test/v2Ground.ts` passes 112 of 112 against the patch.
- Over all 1,336 value quotes in the 724 stored readings, 13 more values are grounded (12 dates, 1 crew), 0 are lost, and 0 single parses change.

Scripts: `.tmp-v2/patch/diff.mts`, `.tmp-v2/p5a4-patched.mts`. Still to measure: the harness replay on dev, outcomes and wrong writes.

## Pre-analysis for P5d (client resolution). Measured 2026-10-25

Script: `.tmp-v2/p5d.mts`. It prints sender classes only, never an address.

| case | n | what the sender rule sees | design |
|---|---|---|---|
| no client: the domain belongs to 2 OnSinch companies | 3 | `matchCompanyByDomain` abstains, so the model is shown no bookings (process.ts:109-110) | §9.3, resolve by content: show the model the bookings of every company on that domain (at most 3), each labelled with its company. The client is then the company of the order the evidence finder picks. Nothing is written when no order is picked |
| no client: domain unknown to OnSinch | 3 | no company. 2 of the 3 threads carry an order link in the snapshot | the replay settles it. If the link existed when the email arrived, process.ts:418-426 should have used it, which would be a defect. If it came later, the case is right as it stands |
| no client: personal domain, exact contact | 1 | resolves at HEAD (company 875) | already fixed |
| wrong client: one contact on company 804 who books for other clients | 3 | the exact-contact rule picks 804 | a sender with history on several companies' orders (from job_links and orders.user_id) is treated as multi-client: content decides, as above |

Measure in the harness replay on dev: client_resolution_accuracy, and wrong writes, which must stay 0.

**P5d is built in the sandbox (branch sandbox/p1-fixes), not yet measured on dev.**
- `plan.ts`: when the sender's domain sits on 2 or 3 companies and the email names exactly one of them, that one is the client.
- `plan.ts`: a domain OnSinch already holds never becomes a new client. A name that matches none of the domain's companies goes to a person. Before, the planner would create one more company.
- Tested in `test/v2SharedDomain.ts` (5/5). The planner suites v2Plan, v2Finder, v2CrewDefault, v2History and v2RealEmails all pass, as does `test/harnessGate.ts` (every set, 0 wrong writes).
- The 3 wrong-client emails from one multi-client contact (company 804) are not addressed yet.

**P5e is built in the sandbox. It changes the display, so it waits for the owner's and Paz's authorization (§5, §10) before it ships.**
- A needs-reply item whose reading asks for crew carries `work: true` (v2.ts). It is listed (serve.ts) and can be ticked (check.ts).
- Our reply no longer clears it (project.ts). A plain question still leaves when we answer it.
- Tested in `test/feedReplyWithWork.ts` (5/5). Every feed test passes, and tsc is clean.
- Target: the 8 needs-reply silent misses of the live week, and 35 across all 799 emails.

**P5b is built in the sandbox: a quote acceptance is a card, never `none`.**
- `acceptance.ts` holds the rule from eval/acceptance-study.md, which acceptance-study 49f7e423 measured.
  - `decideMessage` turns a `none` of "no change asked for", "already booked" or "already as asked" into a hand-off ("confirm the order in OnSinch"), carrying the found order when there is exactly one. The reason code is `quote_accepted`.
  - Over the 799 emails, my implementation reproduces the study: 88 fires, 71 are booking work or B42 quotes for both readers, and 1 is "nothing".
  - It catches 68 of the 73 acceptances. The figures are in-sample.
- It builds no shifts: our quotes carry them in an attached PDF, and 0 of 73 are fully readable.
- Tested in `test/v2QuoteAccepted.ts` (8/8, with a control).

**§10 B, built in the sandbox. Display changes ship only with authorization.**
- Each card says what kind of need it is: "System Problem" (`system_failed`, or a write stopped part-way) or "Ready, Writes Paused" (a write never run). With no chip, it is a person's decision.
- Each card says how its order was found, from `job_links.source`, now read by live.ts.
- When the planner finds several orders, its hand-off carries up to 3 candidates (`Decision.candidates`), and the card lists them as "R… or R…".
- Tested in `test/feedNeedKind.ts`. Every feed test passes.

## Iteration 1, measured: every sandbox fix (a-g) against HEAD. 2026-10-25, harness replay on dev (live-week labels, 280 emails)

**Change.** `eval/patches/p1-fixes.diff`: 19 files, applying cleanly to v2 569ed27. It contains:
- a: the parser;
- b: quote acceptances;
- c: the owner alert;
- d: shared-domain clients;
- e: reply cards that ask for crew;
- f: the replay guard;
- g: the kind chip, found-by and candidates.

The harness edit counts a needs-reply item with `work` as listed, as the patched serve.ts does. HEAD's figures are unchanged by it.

| metric (dev, B42) | HEAD | patched |
|---|---|---|
| silent_miss_count | 16 of 79 | **7 of 79** |
| inquiry_recall | 63/79 = 79.7% (CI 69.2-88.0) | **72/79 = 91.1% (CI 82.6-96.4)** |
| review_rate (listed ÷ items) | 60/77 = 77.9% | 84/102 = 82.4% |
| display_precision (any request, both readers) | 72/77 = 93.5% | 96/102 = 94.1% |
| display_precision (B42 inquiry) | 63/77 = 81.8% | 72/102 = 70.6% |
| none_recall | 32/49 | 32/49 |
| model calls / network | 0 / 0 | 0 / 0 |

**What changed, email by email (28 of 280).**
- 18 `none`s became quote-accepted cards: 8 "nothing to do", 8 "already booked", 2 "already as asked".
- 7 needs-reply items that ask for crew are now listed.
- 1 email with no client is now resolved and reaches the lead-days rule.
- 1 unproven reading is now grounded and reaches the lead-days rule.
- 1 unproven reading became a create: 1a144942ca8851d1. It is a quote listing 4 days, 20, 21, 28 and 29 Nov, and both readers name exactly those days. The owner's B42 makes it an order, and as a new order it waits in To Confirm.

No new write contradicts a label. The labels carry no order id, so a write's order and crew are checked only against the readers' days and crew.

**Reading.**
- Recall rose by 11.4 points. That is more than the ±8 the interval allows at n = 79 (§8.9), so this is evidence and not noise.
- The cost is more cards that are requests but not bookings: B42-inquiry precision fell to 70.6%, while 94.1% of cards are still a request of some kind.
- §4 ranks noise third, after a silent miss and a wrong item.

**Next.** Re-measure on all 799 once the labels are extended (harness-engineer, running). Then the remaining 7 silent misses by kind. Then P4's diagnostic.

## Iteration 2: a reply card the reader found unclear is shown (OPERATING §4: "uncertain ... treat as inquiry, show it")

**Change.** In v2.ts, a needs-reply item is `work` when its reading carries a request, or when its intent is "unclear". A quote with no shifts stays a reply (B42). The test is `test/feedReplyWithWork.ts`, now 6/6. The patch is regenerated, and it applies cleanly to v2.

| metric (dev, B42) | HEAD | iteration 1 | iteration 2 |
|---|---|---|---|
| silent_miss_count | 16 of 79 | 7 | **5** |
| inquiry_recall | 79.7% | 91.1% | **93.7% (CI 85.8-97.9)** |
| display_precision (any request) | 93.5% | 94.1% | 94.3% |
| review_rate | 77.9% | 82.4% | 83.0% |

**The 5 left.**
- 4 are the model reading "no change asked for" (`info_only`):
  - a quote with day, times and crew (1a1399db710f7409);
  - a site-contact change (1a13aaf92b3b564e);
  - 2 acceptances the rule's wording does not catch (1a13fc34f09bf745, 1a14105b82e3493e).
- 1 is HEAD's "nothing new asked for: the requests are the thread's earlier ones" (1a13aa2b6fca0312; uncoded, so it is tallied as "other"). Production listed it. This is a per-email miss only if the thread's earlier need had already left the TV, which a thread-level count must settle.

**Next.**
- The four `info_only` misreads are the model's. A prompt change needs a capped paid run to measure (P01, the owner's yes), so they are held.
- Code the "nothing new asked for" reason, and check that case at thread level.

## Iterations 1-2 on all 799 (dev 561 emails, 184 B42 inquiries; split locked at d2790450e2c9ae4f). 2026-10-25

| metric (dev, B42) | HEAD | patched (iterations 1 + 2) |
|---|---|---|
| silent_miss_count | 53 | **21** |
| inquiry_recall | 131/184 = 71.2% (CI 64.1-77.6) | **163/184 = 88.6% (CI 83.1-92.8)** |
| display_precision (any request, both readers) | 146/152 = 96.1% | 207/216 = 95.8% |
| review_rate (listed ÷ items) | 125/152 = 82.2% | 189/216 = 87.5% |
| new writes | | **0** |

76 emails changed:
- 39 `none`s became quote-accepted cards;
- 25 reply cards that ask for crew, or that the reader found unclear, are now listed;
- 10 `none`s got their own code where they were "other";
- 2 reach the lead-days rule.

The 21 silent misses left:

| code | n | what it would take |
|---|---|---|
| none_nothing_to_do (the model read no change) | 8 | a reader-prompt change, measured on a capped paid run: the owner's yes (P01) |
| none_read_together, whose later email also ends in `none` | 5 | the same misreading, carried by the later email |
| none_already_as_asked | 4 | possibly correct: the time-correct world may confirm them. A reader settles them |
| none_thread_history (repeats an earlier request) | 2 | a thread-level count: is the earlier need still on the TV? |
| booking_not_identified, request_unsupported | 2 | single cases |

**Reading.** Recall rose by 17.4 points on n = 184. The interval is about ±6, so this is evidence (§8.9). Display precision is unchanged within its interval, and no write was added. The test set has not been run; it is reported only at Checkpoint B (§8.8).

## Iteration 3: red-team-B's harms fixed, and the harness's "production" frozen. 2026-10-26, dev (561 emails, 184 B42 inquiries)

audit/red-team-B.md landed three hits that change a decision and seven material ones. Re-checked before acting: H1 (60 of
the live-week dev split's 280 are in the 238 test set) and H7 (test/harnessReal.ts fails with the patch) both reproduce.

**Patch changes** (eval/patches/p1-fixes.diff, now 23 files; each fix has a test that fails without it):
- **H2, personal mail hosts.** The shared-domain rule now skips resolve.ts CONSUMER_DOMAINS. Without it, a new icloud.com
  sender was booked under another icloud.com client (icloud.com sits on 2 of 811 companies). Every new gmail.com client
  was also refused, because gmail.com is on 34. test/v2SharedDomain.ts +3.
- **H6, the owner alert.** The two copies of the failure test (process.ts, feed/v2.ts) are now one, `systemFailureOf` in
  reasons.ts. It matches the shapes the data holds: a single op with status `mismatch` (the live week's 3 crew-chief stops),
  or the bot's own error on OnSinch's page. Over all 847 stored decisions it reports 6: 2 read or plan failures, 3 stops,
  1 bot error. The old test reported 2. process.ts's comment said "8 of 81"; it now says 5. test/systemFailureToOwner.ts +5.
- **H4, acceptance cards.** An acceptance is drawn as an update to the quote's order, never Needs Created. "Already as
  asked" now carries the order it checked, so one found order goes on the card. Dev: the 4 acceptance cards that proposed
  a new order are gone. none_precision is back to 70/88 = 79.5% (it was 76.1%). test/feedQuoteAcceptedIsUpdate.ts, new.

**Harness changes** (committed, not in the patch):
- **H7.** score-production drew production's stored decisions through the TV code on disk. So the patch rewrote
  "production": live-week silent misses read 8 of 90, not the 16 production had. What the TV showed is now frozen once,
  at 90529c9 (the code production runs), in eval/harness/production-shown.jsonl: 847 rows, ids and codes only. Production
  figures and the labels' exclusion codes read it. `--display current` keeps the other question (production's decisions
  through the new TV), filed under its own name. harnessReal is 18/18 at HEAD and with the patch.
- **H14.** Label and read files hash as text (CRLF folded), and .gitattributes pins them to LF. The labels hash is
  unchanged: 55e6f3e99cfd95d5.

**Dev, three columns (H3, H5, H8):**

| metric (dev, B42) | production, as shown | HEAD replay | patch without the display rule | whole patch |
|---|---|---|---|---|
| inquiry_recall | 120/184 = 65.2% (64 silent) | 131/184 = 71.2% (53) | **149/184 = 81.0% (35; CI 74.6-86.4)** | **163/184 = 88.6% (21; CI 83.1-92.8)** |
| display_precision, any request | | 146/152 = 96.1% | 183/191 = 95.8% | 207/216 = 95.8% |
| display_precision, B42 inquiry | 117/142 = 82.4% | 129/152 = 84.9% | 147/191 = 77.0% | 160/216 = 74.1% |
| none_precision | | 70/88 = 79.5% | 70/88 = 79.5% | 70/88 = 79.5% |
| review_rate | 126/142 = 88.7% | 125/152 = 82.2% | 164/191 = 85.9% | 189/216 = 87.5% |
| writes / new-order proposals | | 27 / 88 | 27 / 88 | 27 / 88, same ids |

- Production's own stored decisions drawn through the patched TV reach 154/184 = 83.7%. The display rule is the
  largest single lever, and it waits on the owner and Paz.
- The B42 precision falls by 10.8 points. That is the trade for 32 fewer silent misses: §4 ranks noise third, behind
  missing an inquiry and confirming the wrong thing.
- The replay's HEAD is 6 points above production. The replay matches production's outcome on 476 of 561; the causes of
  the other 85 are listed in its limits table. How well a replay figure predicts production has not been measured.

**The 238 "test" emails are tuned on (H1).** They are now dev-2: reported, never called held out. A clean set is mail no
step has read, from after the 10-22 snapshot (Session 4 plan, R5).
