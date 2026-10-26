# OPERATING §11.3: the true order injected into the planner's candidates (dev set)

Agent: diagnostic-11-3. Brief hash: 7b8bd993. Written 2026-10-25T23:03Z (UTC).
Inputs: git 569ed2757ace+dirty (branch v2); gold dataset hash 9b809529e0917927; labels hash 16622f2f47f6267b
(eval/harness/labels/live-week.jsonl); split test hash 8aaf7ecd8b29ba86. Dev set only (280 emails). No test-set email
was replayed or scored. Cost $0: in both runs the replay's own counters read 0 model calls and 0 network attempts.

## Summary

**Verdict: selection-bound.** "Selection" here means what the brief means by it: picking the order, then making the
change. Retrieval work is not justified now.

- **Retrieval is close to its ceiling already.** As is, the finder's pool holds the true order for 46/46 emails
  about an existing order. The true order ranks in the top 5 of the finder's evidence order for 43/46 = 93.5%
  (CI 82.1-98.6), and the reader was shown it among its bookings for 41/46 = 89.1% (CI 76.4-96.4).
- **Perfect retrieval barely changes the result.** With the true order injected as the thread's link, the finder's
  own pick is the true order 46/46 (recall@1, up from 32/46). selection_given_correct_candidate goes from 58/72 =
  80.6% (CI 69.5-88.9) to 62/75 = 82.7% (CI 72.2-90.4). Only 12 of 75 decisions change at all: 3 picks go from
  wrong to right and none from right to wrong. Correct order plus correct change, end to end, goes from 4/75 to
  7/75.
- **With the right order in hand, the pick still fails on 11 of 46 existing-order emails.** In 10 of the 11 the
  stored reading carries no new request, so the planner stays silent. Five of those readings are `info_only` with
  0 requests (plan.ts:476), 3 hold only requests read from the thread's history (plan.ts:539), and 2 are bookings
  with 0 requests. The 11th is a hand-off that names no order. On 6 of those 10 silent emails, staff then changed
  bookings on the injected order.
- **The change is where most of the loss is.** Injected, action_accuracy is **7/50 = 14.0% (CI 5.8-26.7)**; as is,
  it is 4/50 = 8.0%. These are the 50 items whose order-or-NONE is right:
  - 17 are hand-offs under the 14-day rule (plan.ts:775). The rule requires them, and they propose no change.
  - 8 are reading_unproven hand-offs, 3 are request_unsupported, 1 is client_unknown and 1 is
    policy_confirmed_proposal.
  - 20 are writes: 7 completed, 4 partial and 9 wrong by value. The 9 wrong writes break down as: crew-chief
    composition 3, time values 2, a cancel where staff re-timed 1, and new-order composition 3.
- **The model reader's choice of order is sound when it makes one.** The stored reading named an order on 36 of 46
  existing-order emails, and 34 of those were the true order. The replay cannot re-read, so this is production's
  reading.
- **The high-confidence subset gives the same verdict.** It holds 37 emails: staff's act plus an independent source
  that agrees, and all 37/37 agree with scripts/gold/truth.mts. recall@5 is 24/24. Selection goes from 31/37 to
  32/37 when injected. Injected action_accuracy is 4/28 = 14.3% (CI 4.0-32.7).
- **Retrieval misses barely matter.** Only 3 emails had the true order outside the top 5 (see "Retrieval misses"),
  and the planner picked one of the 3 correctly anyway. The way to recover them is better reading of what the
  client asks: the info_only and history-only "nothing to do" decisions, and the hand-offs on unproven readings.
  The other recovery is better change planning: crew-chief positions, the values of time changes, and new-order
  composition.

**One measurement note changes the numbers.** Audit rows hold slot times as UTC "YYYY-MM-DD HH:MM:SS" with no zone.
`score.ts` `truthKeys` (:99, then `windowOf` :52) passes them to `utcToLondon` (bot/ops.ts:72-73). Its
`new Date(iso)` reads a string with no zone in the process's own time zone, and this box runs America/New_York
(`Intl.DateTimeFormat().resolvedOptions().timeZone`). So every staff re-time reads 4 h late, and every correct time
change is judged wrong. Before judging, I zoned these values the way harness/real/world.ts:155 does. Without that
step, injected writes judged completed are 1 rather than 7. Any `judge()` over week-truth-acts in a process that is
not on UTC carries the same error, for example scripts/week-review.mts:54.

## How the true order was derived (no reader label names it)

**Population.** The dev emails that are booking work. The readers' consensus, after reader V settled any split, has
to read booking work (`resolved.strict` = inquiry, 99), or the email is a B42 quote (9). OnSinch portal notices (13) are left out. That
leaves 95. Every source below is independent of the planner's pick on the same email.

- **Days.** The days are the readers' (`A.days` ∪ `B.days`), never the model's.
- **Client.** Production's company_id, plus `companiesOf` (threadState.ts:146) over the thread's client addresses,
  plus the companies of the thread's links.
- **S, the staff act.** Each audit row not made by the bot (creator ≠ 2257): order create, copy, cancel or confirm;
  Job, SlotTeam or Slot create; a delete; or an edit to a booking field (Slot size, beginning, end, profession_id,
  cancelled or role; Order intern_name). Rows come from .tmp-data/gold/timeline.json up to 22:51Z on 10-22, and
  from .tmp-data/week-truth-acts.json after that. The act must fall between 1 h before and 96 h after the email
  (36 h when the readers named no day), be on the client's orders, and fall on a named day. The day is the act's
  slot's day, or any day of its order.
- **Links.** A row in .tmp-data/gold/links.json for the thread whose order holds a named day.
  - `bot write`, `planner find`, `finder` and `planner` links are the system's own earlier picks. They may
    corroborate staff's act. They never label alone and never overrule it.
  - A system link first seen while this email was the thread's newest client email is this email's own pick, and
    is ignored.
  - `staff copy` and `jobs board` links are independent.
- **N.** An R or J number written anywhere in the thread, on either side, or in a reader's `target_ref`. It must be
  on the client's orders and hold a named day.

**Labels**

- **existing X.** Staff acted on exactly one order, X, and X existed at the email.
  - **high:** N, an independent link or another email's system link also names X.
  - **medium:** nothing else names an order.
  - **conflict:** N or an independent link names a different order that existed at the email.
- **NONE.** Staff acted only on orders created after the email (they built the job), and a reader read a new
  booking or a quote. It is high when corroborated in the same way.
- **existing (medium), when staff acted on several orders.** Allowed only when exactly one of those orders is
  singled out by N or a link. Otherwise the email is `several`.
- **No staff act.** A system link alone gives no label.

| derived label | confidence | emails | agrees with .tmp-data/gold/truth.jsonl |
|---|---|---|---|
| existing | high | 24 | 24/24 |
| existing | medium | 22 | 17/22 (5 have gold `no-order-signal`) |
| NONE | high | 13 | 13/13 |
| NONE | medium | 16 | 14/16 (2 have gold `no-order-signal`) |
| existing | conflict | 2 | not scored |
| several | low | 6 | not scored |
| underived | - | 12 | not scored |
| **scored** | | **75 of 95 = 78.9%** | high 37/37, medium 31/38 |

`truth.jsonl` (scripts/gold/truth.mts) is a cross-check, not a source. It reads the same timeline with the model's
days and the adjudications. The 20 unscored emails are listed at the end.

## Method

**Hook.** The replay runs on a scratch copy of harness/real/, with its imports pointed back at the repo. app/ was not
touched. The copy has one change, and it is the least invasive hook the planner allows. For a scored email, the
thread's order (harness/real/replay.ts:125) is the injected value instead of the link as it stood:

```
-      threadOrderId: async () => link.order_id,
+      threadOrderId: async () => (evalSet.has(m0.message_id) && inject.has(m0.message_id) ? inject.get(m0.message_id) : link.order_id),
```

`inject` maps each scored email to its true order's OnSinch id, or to null for NONE. The per-email table gives the
values in its "injected link" column. One run injected all 75 at once.

- **What the link does.** It puts the order into the finder's pool (plan.ts:225). It is also the finder's strongest
  evidence when it holds an asked day (threadState.ts:76).
- **Why the pool alone would not do.** Forcing the order into the pool would change nothing, because the pool held
  it for 46/46 as is.
- **What the link replaced.** It changed for 36 of 46 existing-order emails: 28 had no link and 8 had another
  order. On the 10 others the link was already the true order. None of the 29 NONE emails had a link.
- **The baseline matches the harness.** The as-is run equals the harness's own replay
  (eval/harness/runs/live-week-replay-all.json, same dataset and labels hashes) on outcome and code for 95/95.
- **Injecting one email at a time gives the same answer.** I re-ran 8 of the 75 (every 10th, starting with the
  4th) with only that email injected. All 8/8 matched the all-at-once run on kind, code and outcome.

**Definitions** (all intervals are exact 95% Clopper-Pearson, `exact()` at harness/real/stats.ts:45):

- **recall@5.** HEAD exposes no ranked list (eval/metrics.md:298), so the candidates are those of plan.ts
  `evidenceOf` (:215-235): the orders of up to 4 companies, rolled back to the email's time, plus the linked order.
  They are ranked by `threadState.findOrder`'s own order of evidence, from first to last:
  1. the link, when it holds an asked day (:76);
  2. an R or J number in the thread, on an order that holds one (:87);
  3. a PO or project reference (:97);
  4. the day plus N more facts, most facts first, then most days held (:102-123);
  5. the link, when it holds none of the asked days (:129);
  6. the day alone;
  7. an R or J number on an order that holds no asked day;
  8. the rest, nearest shift first;
  9. cancelled orders.

  Ties go to the highest id. The denominator is existing-order labels only, because a NONE has no order to
  retrieve.
- **pick.** The order the decision acts on or names, taken from the first of these that applies:
  - a write's op `order_id` (a `create_order` op counts as NEW);
  - a hand-off's `order_id` (plan.ts:248 settle), else the R numbers in its reasons, else NEW when the TV draws it
    as Needs Created;
  - a `none`'s `found`, else the R numbers in its reason.

  A pick is right for existing X when it includes X and creates nothing. It is right for NONE when it is NEW and
  names no other order.
- **selection_given_correct_candidate.** Right picks ÷ emails whose true order was a candidate. As is, that is the
  existing-order emails with the order in the top 5, plus every NONE. Injected, it is every scored email.
- **action_accuracy.** The numerator is items whose write `judge()` (app/lib/v2/score.ts:118) calls completed. The
  denominator is items (TV listed or check, harness/real/system.ts) with a right pick.
  - Staff's side is the booking acts in week-truth-acts by users other than the bot, on the true order(s), between
    1 h before and 96 h after the email, on a named day. They go through `truthKeys` (score.ts:72) with times
    zoned.
  - A hand-off proposes no change, so it is not a correct one. A lenient variant and one that leaves out policy
    hand-offs are also given.

**Limits**

- **The reading is fixed.** Every decision uses production's stored reading, which production made with its own
  context. Injection therefore tests the deterministic planner given that reading. The model's own pick is
  reported separately.
- **Injection can carry along a thread.** Injecting into an earlier email on a thread can change the `prior`
  requests a later scored email on that thread receives.
- **Staff acts can pool across emails.** Staff acts within 96 h on the same order and day can belong to a later
  email, and `judge` pools them. For example, 1a13a979194ef05f asked for a cancel, staff re-timed the shift after
  the next email, and the cancel is judged wrong.
- **Readings with no proof stay as they are.** The 8 reading_unproven hand-offs are counted as no change rather
  than re-read.

## Results

### All 75 labelled emails (46 existing, 29 NONE)

| metric | as is | true order injected |
|---|---|---|
| recall@5 (existing orders; finder's evidence order) | 43/46 = 93.5% (CI 82.1-98.6) | 46/46 = 100.0% (CI 92.3-100.0) |
| recall@1 (the finder's own pick, threadState.findOrder) | 32/46 = 69.6% (CI 54.2-82.3) | 46/46 = 100.0% (CI 92.3-100.0) |
| true order anywhere in the finder's pool | 46/46 = 100.0% (CI 92.3-100.0) | 46/46 = 100.0% (CI 92.3-100.0) |
| true order among the bookings the reader was shown (context.ts:29-51, up to 20) | 41/46 = 89.1% (CI 76.4-96.4) | (reading not re-run) |
| selection_given_correct_candidate, existing | 31/43 = 72.1% (CI 56.3-84.7) | 35/46 = 76.1% (CI 61.2-87.4) |
| selection_given_correct_candidate, NONE | 27/29 = 93.1% (CI 77.2-99.2) | 27/29 = 93.1% (CI 77.2-99.2) |
| **selection_given_correct_candidate, all** | 58/72 = 80.6% (CI 69.5-88.9) | **62/75 = 82.7% (CI 72.2-90.4)** |
| items with the right order-or-NONE | 50 | 50 |
| **action_accuracy** (completed ÷ those items) | 4/50 = 8.0% (CI 2.2-19.2) | **7/50 = 14.0% (CI 5.8-26.7)** |
| action_accuracy, lenient (completed or partial) | 6/50 = 12.0% (CI 4.5-24.3) | 11/50 = 22.0% (CI 11.5-36.0) |
| action_accuracy, policy_* hand-offs left out | 4/32 = 12.5% (CI 3.5-29.0) | 7/32 = 21.9% (CI 9.3-40.0) |
| writes on the right order: completed (partial, wrong) | 4/13 = 30.8% (CI 9.1-61.4) (2, 7) | 7/20 = 35.0% (CI 15.4-59.2) (4, 9) |
| `none` on emails where staff changed no booking either (rightly quiet; not in the rows above) | 10 | 11 |
| end to end: right order and right change ÷ emails | 4/75 = 5.3% (CI 1.5-13.1) | 7/75 = 9.3% (CI 3.8-18.3) |

Counted against the whole pool, the as-is selection for existing orders is 32/46. One of the 3 retrieval misses,
1a14401e46254083, was picked right anyway.

### High-confidence subset (37: 24 existing, 13 NONE)

| metric | as is | true order injected |
|---|---|---|
| recall@5 | 24/24 = 100.0% (CI 85.8-100.0) | 24/24 = 100.0% (CI 85.8-100.0) |
| recall@1 (finder's own pick) | 18/24 = 75.0% (CI 53.3-90.2) | 24/24 = 100.0% (CI 85.8-100.0) |
| true order among the bookings the reader was shown | 22/24 = 91.7% (CI 73.0-99.0) | (reading not re-run) |
| selection_given_correct_candidate, existing | 18/24 = 75.0% (CI 53.3-90.2) | 19/24 = 79.2% (CI 57.8-92.9) |
| selection_given_correct_candidate, NONE | 13/13 = 100.0% (CI 75.3-100.0) | 13/13 = 100.0% (CI 75.3-100.0) |
| **selection_given_correct_candidate, all** | 31/37 = 83.8% (CI 68.0-93.8) | **32/37 = 86.5% (CI 71.2-95.5)** |
| **action_accuracy** | 3/29 = 10.3% (CI 2.2-27.4) | **4/28 = 14.3% (CI 4.0-32.7)** |
| action_accuracy, lenient | 4/29 = 13.8% (CI 3.9-31.7) | 7/28 = 25.0% (CI 10.7-44.9) |
| action_accuracy, policy_* left out | 3/20 = 15.0% (CI 3.2-37.9) | 4/19 = 21.1% (CI 6.1-45.6) |
| end to end | 3/37 = 8.1% (CI 1.7-21.9) | 4/37 = 10.8% (CI 3.0-25.4) |

### Per bucket (bucket = derived label × what the readers say the email asks)

| bucket | n | recall@5 as is | selection as is (÷ all emails) | selection injected | items with right order, injected | action_accuracy injected |
|---|---|---|---|---|---|---|
| existing: change or cancel | 26 | 25/26 = 96.2% (CI 80.4-99.9) | 22/26 = 84.6% (CI 65.1-95.6) | 24/26 = 92.3% (CI 74.9-99.1) | 22 | 7/22 = 31.8% (CI 13.9-54.9) |
| existing: new shifts or a PO on it | 20 | 18/20 = 90.0% (CI 68.3-98.8) | 10/20 = 50.0% (CI 27.2-72.8) | 11/20 = 55.0% (CI 31.5-76.9) | 1 | 0/1 = 0.0% (CI 0.0-97.5) |
| NONE: new booking | 22 | n/a | 21/22 = 95.5% (CI 77.2-99.9) | 21/22 = 95.5% (CI 77.2-99.9) | 21 | 0/21 = 0.0% (CI 0.0-16.1) |
| NONE: quote with a day and crew (B42) | 7 | n/a | 6/7 = 85.7% (CI 42.1-99.6) | 6/7 = 85.7% (CI 42.1-99.6) | 6 | 0/6 = 0.0% (CI 0.0-45.9) |
| **total** | 75 | 43/46 = 93.5% (CI 82.1-98.6) | 59/75 = 78.7% (CI 67.7-87.3) | 62/75 = 82.7% (CI 72.2-90.4) | 50 | 7/50 = 14.0% (CI 5.8-26.7) |

In the "new shifts or a PO on it" bucket, 9 of the 11 right picks are `none` "already booked" decisions on the true
order. On 6 of those 9, staff changed no booking. The 9 wrong picks are all `none` decisions that name no order.

### What fails when the right order is present (injected run)

| what the planner did | existing (46) | NONE (29) | of which high-confidence |
|---|---|---|---|
| right order, hand-off: policy_lead_days (14-day rule, plan.ts:775) | 0 | 17 | 8 |
| right order, write judged wrong by value | 6 | 3 | 6 |
| right order, hand-off: reading_unproven | 4 | 4 | 5 |
| right order, write completed | 7 | 0 | 4 |
| right order, write partial (all ops right, staff did more) | 2 | 2 | 3 |
| right order, hand-off: request_unsupported | 3 | 0 | 1 |
| right order, hand-off: client_unknown / policy_confirmed_proposal | 1 | 1 | 1 |
| right order, silent reply card (reply_detail_missing) | 1 | 0 | 0 |
| right order, `none` (already booked / as asked / nothing new), staff changed no booking either | 7 | 0 | 2 |
| right order, `none` (already booked / as asked), but staff then changed bookings | 4 | 0 | 2 |
| wrong: `none` naming no order: `info_only`, no change asked (plan.ts:476) | 5 | 1 | 2 |
| wrong: `none` naming no order: only the thread's history asked (plan.ts:539), or no request | 5 | 0 | 3 |
| wrong: hand-off naming no order (reading_unproven) | 1 | 0 | 0 |
| wrong: hand-off naming an existing order on a NONE email (reply_unclear, the finder's day-and-fact find) | 0 | 1 | 0 |

The 9 writes judged wrong by value are listed below; the per-email table gives their ids.

- **Crew-chief composition, 3** (1a13fea576aeda13, 1a154d69fc48ba38, 1a158a5e6bd47095). The planner adds a chief
  position within the count (plan.ts:68 chiefsFor), where staff set the crew size instead.
- **Time values, 2** (1a13f516bb4f171f, 1a13f8312ae75c73).
- **A cancel where staff re-timed, 1** (1a13a979194ef05f).
- **Create-order composition (place or positions), 3** (1a139bd196d4eff6, 1a13f49e6e01c4ab, 1a14063b8d8dd75c).

### What the injection changed

12 of 75 decisions changed in kind, code or pick, and every change was on an existing-order email whose link
changed. The 3 picks that went from wrong to right:

- 1a139ada42ba1d76: client_unknown, which proposed a new order, became a partial write on R10522.
- 1a1405f822867a84: booking_not_identified on another order became a completed write on R11614.
- 1a158c5ac15f6fdc: a reply card naming no order became the same reply card naming R11349.

The other 9 changes kept a right pick. On 7 of them, a booking_not_identified or reading_unproven hand-off became
one of: completed writes (2), a partial (1), wrong writes (2), or `none` already-as-asked (2, one where staff then
changed bookings). On 2 of them, booking_not_identified became request_unsupported. No pick went from right to
wrong.

### Retrieval misses as is (true order outside the finder's top 5)

| message_id | true | as-is rank / pool | as-is link | among the reader's bookings | as-is pick (code) |
|---|---|---|---|---|---|
| 1a13a02e4c08a985 | R11382 | 100 / 109 | none | no | none named (reading_unproven) |
| 1a14401e46254083 | R11588 | 85 / 111 | none | no | R11588, right (uncoded none) |
| 1a14506bcabaaa3a | R11618 | 6 / 156 | none | yes | none named (uncoded none) |

### The model reader's own pick (stored readings, not re-run)

The stored reading named an order on 36 of 46 existing-order emails, and 34 of those were the true order. On 7
emails, the reader was shown the true order and named none.

## Unscored emails (no usable label)

| message_id | derived | orders staff acted on or named | why no label |
|---|---|---|---|
| 1a139a998169549f | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a139d57839581af | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a139f0f10a9d1c9 | several | R11404 R11454 R11560 R11587 R11589 R11591 R11592 R11593 R11594 | staff acted on 9 orders for named days (2 existing, 7 made after) |
| 1a139f824146018a | underived | system link R11520 | no staff act on a named day; only a system link (the system's own pick) |
| 1a13a15d0ca3317b | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a13a408e18d3802 | underived | system link R11520 | no staff act on a named day; only a system link (the system's own pick) |
| 1a13a8890d485caa | several | R11404 R11454 | staff acted on 2 orders for named days (2 existing, 0 made after) |
| 1a13aaf92b3b564e | underived | system link R11520 | no staff act on a named day; only a system link (the system's own pick) |
| 1a13ae4bb1dab34e | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a13b2a104b579ab | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a13ea2e0ba9a5e1 | several | R11404 R11454 | staff acted on 2 orders for named days (2 existing, 0 made after) |
| 1a140f173cd04965 | several | R11530 R11587 R11589 R11591 R11592 R11593 R11594 | staff acted on 7 orders for named days (7 existing, 0 made after) |
| 1a144c9861ea3c8b | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a1450b8dc7c1e6c | underived | - | no staff act on a named day, no link or R/J holding one |
| 1a14539d35697ee9 | several | R11598 R11601 R11663 | staff acted on 3 orders for named days (3 existing, 0 made after) |
| 1a1453ad2be0aa98 | several | R11598 R11601 R11663 | staff acted on 3 orders for named days (3 existing, 0 made after) |
| 1a1456a614874008 | underived | - | the readers named no day, and no staff act, link or R/J |
| 1a14638ee5140233 | underived | - | the readers named no day, and no staff act, link or R/J |
| 1a1493bc7c314c28 | existing (conflict) | R11737 R11093 | staff acted on it for a named day; an R/J or independent link names a different order |
| 1a1497d7b3445d5f | existing (conflict) | R11737 R11093 | staff acted on it for a named day; an R/J or independent link names a different order |

## Per email (the 75 scored)

`injected link` is the OnSinch order id that the injected run returned as the thread's order; for NONE it was null. `as-is rank` is the true order's place in the finder's evidence order. Each run cell gives the decision kind, the reason code, the `judge()` verdict for a write, and the pick: `true`, `other`, `NEW`, or `no order`. To re-run a case, apply the hook diff in "Method" to a scratch copy of harness/real/ and replay the dev ids with this column as `inject`. The scratch scripts were deleted, as _common.md requires.

| message_id | label | conf | evidence | bucket | injected link | as-is rank | as is | injected |
|---|---|---|---|---|---|---|---|---|
| 1a1391790a610f8f | R11410 | high | staff act + indep. link | change or cancel | 16450 | 1 | handoff/booking_not_identified; picks true | write/write/completed; picks true |
| 1a1399a92f4c792d | NONE (R11541) | medium | staff create | quote with day and crew | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a1399db710f7409 | NONE (R11544) | medium | staff create | quote with day and crew | none | - | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a139a068a0023e7 | NONE (R11545) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a139ada42ba1d76 | R10522 | high | staff act + sys. link | change or cancel | 13597 | 1 | handoff/client_unknown; NEW | write/write/partial; picks true |
| 1a139bd196d4eff6 | NONE (R11549) | medium | staff create | quote with day and crew | none | - | write/write/wrong; NEW | write/write/wrong; NEW |
| 1a139c08af1111d6 | NONE (R11547) | high | staff create + sys. link | new booking | none | - | handoff/reading_unproven; NEW | handoff/reading_unproven; NEW |
| 1a13a02e4c08a985 | R11382 | medium | staff act | change or cancel | 16421 | 100 | handoff/reading_unproven; no order | handoff/reading_unproven; no order |
| 1a13a07828a2d598 | NONE (R11552) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13a443201c1d31 | NONE (R11554) | medium | staff create | new booking | none | - | handoff/client_unknown; NEW | handoff/client_unknown; NEW |
| 1a13a5149fcd9455 | NONE (R11555) | medium | staff create | new booking | none | - | handoff/reply_unclear; picks other | handoff/reply_unclear; picks other |
| 1a13a5fb091090aa | NONE (R11555) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13a8bf26108f7b | NONE (R11558) | medium | staff create | new booking | none | - | handoff/reading_unproven; NEW | handoff/reading_unproven; NEW |
| 1a13a979194ef05f | R11508 | high | staff act + R/J | change or cancel | 16562 | 1 | write/write/wrong; picks true | write/write/wrong; picks true |
| 1a13a97ff7a30369 | R11547 | medium | staff act | new shifts or PO on it | 16601 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a13a9f85847ce8b | R11484 | medium | staff act + sys. link | change or cancel | 16535 | 1 | handoff/reading_unproven; picks true | write/write/completed; picks true |
| 1a13aa2b6fca0312 | R11484 | medium | staff act + sys. link | change or cancel | 16535 | 1 | none/other; no order | none/other; no order |
| 1a13abf5104b15b4 | NONE (R11557) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13ad05c65d0447 | R11554 | medium | staff act | new shifts or PO on it | 16609 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a13ad08da1ce2b9 | R11555 | medium | staff act | new shifts or PO on it | 16610 | 2 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a13ad1788e8c98c | NONE (R11560) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13af10fc5250eb | NONE (R11561) | high | staff create + sys. link | new booking | none | - | write/write/partial; NEW | write/write/partial; NEW |
| 1a13af9c9a1d50e8 | R11552 | high | staff act + sys. link | new shifts or PO on it | 16607 | 1 | none/other; no order | none/other; no order |
| 1a13b3fa256bdee2 | R11093 | high | staff act + R/J + sys. link | change or cancel | 16106 | 1 | handoff/booking_not_identified; picks true | write/write/partial; picks true |
| 1a13b45143681d8d | NONE (R11587 R11589 R11591 R11592 R11593 R11594) | medium | staff create | new booking | none | - | handoff/reading_unproven; NEW | handoff/reading_unproven; NEW |
| 1a13b4ff18f0a1da | R11508 | high | staff act + R/J | change or cancel | 16562 | 1 | write/write/completed; picks true | write/write/completed; picks true |
| 1a13b915f3a326a3 | NONE (R11588) | high | staff create + sys. link | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13e9ba4edde86b | R11479 | medium | staff act | change or cancel | 16530 | 1 | write/write/completed; picks true | write/write/completed; picks true |
| 1a13e9ff8d34c9e2 | R11029 | high | staff act + R/J + sys. link | change or cancel | 16035 | 1 | write/write/completed; picks true | write/write/completed; picks true |
| 1a13f0edc1eda260 | R11093 | high | staff act + R/J + sys. link | change or cancel | 16106 | 1 | handoff/booking_not_identified; picks true | none/none_already_as_asked; picks true |
| 1a13f3a53885b7c2 | R11093 | high | staff act + R/J + sys. link | change or cancel | 16106 | 1 | handoff/booking_not_identified; picks true | none/none_already_as_asked; picks true |
| 1a13f449f8efd6b3 | NONE (R11599) | high | staff create + indep. link | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13f49e6e01c4ab | NONE (R11602) | high | staff create + sys. link | quote with day and crew | none | - | write/write/wrong; NEW | write/write/wrong; NEW |
| 1a13f516bb4f171f | R11208 | medium | staff act | change or cancel | 16231 | 1 | handoff/booking_not_identified; picks true | write/write/wrong; picks true |
| 1a13f5382ff22bed | NONE (R11603) | high | staff create + indep. link | quote with day and crew | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13f6fc5782f7c3 | R11599 | high | staff act + indep. link | new shifts or PO on it | 16655 | 2 | none/other; no order | none/other; no order |
| 1a13f8312ae75c73 | R11349 | high | staff act + sys. link | change or cancel | 16385 | 1 | handoff/reading_unproven; picks true | write/write/wrong; picks true |
| 1a13f86e46191246 | R11602 | high | staff act + sys. link | new shifts or PO on it | 16659 | 1 | handoff/reading_unproven; picks true | handoff/reading_unproven; picks true |
| 1a13f9bc1c910e5c | R10522 | high | staff act + sys. link | change or cancel | 13597 | 1 | handoff/reading_unproven; picks true | handoff/reading_unproven; picks true |
| 1a13fb4d5be6a768 | NONE (R11613) | high | staff create + indep. link | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13fb70176c781c | NONE (R11614) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13fc34f09bf745 | R11590 | medium | staff act | new shifts or PO on it | 16645 | 1 | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a13fd80597e6e43 | R11614 | medium | staff act | new shifts or PO on it | 16671 | 2 | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a13fd94ac637812 | R11613 | high | staff act + indep. link | new shifts or PO on it | 16670 | 2 | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a13fe91532a3fb7 | NONE (R11617) | high | staff create + indep. link | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a13fea576aeda13 | R11613 | high | staff act + indep. link | change or cancel | 16670 | 2 | write/write/wrong; picks true | write/write/wrong; picks true |
| 1a1401fd187dd300 | R11617 | high | staff act + indep. link | new shifts or PO on it | 16674 | 2 | none/other; no order | none/other; no order |
| 1a1405bd65b444b6 | R11029 | high | staff act + R/J + sys. link | change or cancel | 16035 | 1 | write/write/completed; picks true | write/write/completed; picks true |
| 1a1405f822867a84 | R11614 | medium | staff act | change or cancel | 16671 | 2 | handoff/booking_not_identified; picks other | write/write/completed; picks true |
| 1a140632ce4d5e99 | NONE (R11619) | high | staff create + sys. link | quote with day and crew | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a14063b8d8dd75c | NONE (R11661) | high | staff create + sys. link | new booking | none | - | write/write/wrong; NEW | write/write/wrong; NEW |
| 1a140651f540d14f | NONE (R11662) | high | staff create + R/J + sys. link | new booking | none | - | handoff/reading_unproven; NEW | handoff/reading_unproven; NEW |
| 1a14105b82e3493e | R11616 | medium | staff act | new shifts or PO on it | 16673 | 1 | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a143d7e2ac72699 | R11619 | medium | staff act | new shifts or PO on it | 16677 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a14401e46254083 | R11588 | medium | staff act | new shifts or PO on it | 16643 | 85 | none/other; picks true | none/other; picks true |
| 1a14408c111b7d4a | R11662 | high | staff act + R/J | new shifts or PO on it | 16720 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a144326333c82b1 | NONE (R11666) | high | staff create + sys. link | quote with day and crew | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a1444323f1ac8c6 | NONE (R11667) | high | staff create + sys. link | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a1445e617f4b0b2 | R11666 | medium | staff act | new shifts or PO on it | 16728 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a1449b87f1f53ba | R11667 | medium | staff act | new shifts or PO on it | 16729 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a144a8d3a03a407 | NONE (R11725) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
| 1a144f983605bc19 | NONE (R11736) | medium | staff create | new booking | none | - | write/write/partial; NEW | write/write/partial; NEW |
| 1a14506bcabaaa3a | R11618 | medium | staff act | new shifts or PO on it | 16676 | 6 | none/other; no order | none/other; no order |
| 1a145429cbdfd32a | R11663 | medium | staff act + R/J | change or cancel | 16722 | 1 | handoff/reading_unproven; picks true | handoff/reading_unproven; picks true |
| 1a1533b5bd8afd4a | R11549 | high | staff act + sys. link | change or cancel | 16603 | 1 | handoff/reading_unproven; picks true | handoff/reading_unproven; picks true |
| 1a15344a323ab432 | R11736 | high | staff act + sys. link | new shifts or PO on it | 16798 | 1 | none/none_already_booked; picks true | none/none_already_booked; picks true |
| 1a1540528d5a2d27 | R11561 | high | staff act + sys. link | new shifts or PO on it | 16616 | 1 | none/none_nothing_to_do; no order | none/none_nothing_to_do; no order |
| 1a154d69fc48ba38 | R11349 | medium | staff act + sys. link | change or cancel | 16385 | 1 | write/write/wrong; picks true | write/write/wrong; picks true |
| 1a1588e0e23ce5ef | R11663 | medium | staff act + R/J | change or cancel | 16722 | 1 | handoff/booking_not_identified; picks true | handoff/request_unsupported; picks true |
| 1a158a5e6bd47095 | R11662 | high | staff act + R/J + sys. link | change or cancel | 16720 | 1 | write/write/wrong; picks true | write/write/wrong; picks true |
| 1a158c5ac15f6fdc | R11349 | medium | staff act + sys. link | new shifts or PO on it | 16385 | 1 | handoff/reply_detail_missing; no order | handoff/reply_detail_missing; picks true |
| 1a1596b0abbb0a66 | R11541 | high | staff act + sys. link | change or cancel | 16595 | 1 | handoff/request_unsupported; picks true | handoff/request_unsupported; picks true |
| 1a1598e6aaaba9d0 | R11662 | high | staff act + R/J + sys. link | change or cancel | 16720 | 1 | handoff/policy_confirmed_proposal; picks true | handoff/policy_confirmed_proposal; picks true |
| 1a159f0b5b42bf65 | R11545 | medium | staff act | change or cancel | 16599 | 1 | handoff/booking_not_identified; picks true | handoff/request_unsupported; picks true |
| 1a15a6583c83e5ba | NONE (R11791) | medium | staff create | new booking | none | - | handoff/policy_lead_days; NEW | handoff/policy_lead_days; NEW |
