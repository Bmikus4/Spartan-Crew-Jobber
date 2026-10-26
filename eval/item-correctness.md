# item_correctness on the dev set: HEAD and the held patch

Agent: item-correctness. Brief hash: c0245716. Written 2026-10-26T03:14Z (UTC).
Inputs: git 569d4bb (branch v2; the working tree differs only outside app/ and harness/); patch eval/patches/p1-fixes.diff
(23 files, text hash cf8854e8fe3c7f07), applied in a scratch worktree; gold dataset hash 9b809529e0917927; labels
eval/harness/labels/all.jsonl hash 55e6f3e99cfd95d5; split test hash d2790450e2c9ae4f. Dev set only (561 emails). No
test-set or prospective email was replayed or read. Cost $0: every replay counted 0 model calls and 0 network attempts.

## Summary

The items are the dev emails the TV shows, listed or check. `npx tsx harness/real/run.ts --mode replay --set dev` prints
152 items at HEAD (125 listed, 27 check) and 216 with the patch (189 listed, 27 check). Every HEAD item is also a patch
item. The patch adds 64 cards and no write: quote_accepted 39, reply_detail_missing 13, reply_unclear 11 and
request_unsupported 1.

| metric | HEAD | patch |
|---|---|---|
| **item_correctness, all items** | **6/152 = 3.9% (CI 1.5-8.4)** | **6/216 = 2.8% (CI 1.0-5.9)** |
| **item_correctness, high-confidence items** | **4/53 = 7.5% (CI 2.1-18.2)** | **4/65 = 6.2% (CI 1.7-15.0)** |
| item_correctness, scored items (high + medium) | 6/114 = 5.3% (CI 2.0-11.1) | 6/159 = 3.8% (CI 1.4-8.0) |
| upper bound: the 4 writes with no derivable order counted right | 10/152 = 6.6% (CI 3.2-11.8) | 10/216 = 4.6% (CI 2.2-8.3) |
| lenient: a judged-partial write counted right | 14/152 = 9.2% (CI 5.1-15.0) | 14/216 = 6.5% (CI 3.6-10.6) |
| order-or-NONE right, scored items (writes and cards) | 92/114 = 80.7% (CI 72.3-87.5) | 109/159 = 68.6% (CI 60.7-75.7) |
| order-or-NONE right, high-confidence items | 46/53 = 86.8% (CI 74.7-94.5) | 50/65 = 76.9% (CI 64.8-86.5) |

- **Writes: the order is right and the change mostly is not.** Both columns hold the same 27 writes with the same ops.
  - Order: right on 23/23 that can be scored, 100% (CI 85.2-100). The other 4 have labels graded none-derivable, because
    staff acted on several orders.
  - Change, of the 23: completed 6/23 = 26.1% (CI 10.2-48.4), partial 8, wrong 9.
  - High-confidence: order right 17/17, completed 4/17 = 23.5% (CI 6.8-49.9).
- **Cards: there is no change to judge, so the order is reported apart.** Unscored means the label is none-derivable or
  conflict.

  | cards | right | wrong | absent | unscored |
  |---|---|---|---|---|
  | HEAD (125) | 69/91 = 75.8% (CI 65.7-84.2) | 15/91 = 16.5% | 7/91 = 7.7% | 34 |
  | HEAD, high (36) | 29/36 = 80.6% (CI 64.0-91.8) | 5/36 | 2/36 | 0 |
  | patch (189) | 86/136 = 63.2% (CI 54.5-71.3) | 16/136 = 11.8% | 34/136 = 25.0% | 53 |
  | patch, high (48) | 33/48 = 68.8% (CI 53.7-81.3) | 5/48 | 10/48 | 0 |

  - The patch's 64 new cards:
    - right 17: 11 quote_accepted cards that carry the planner's order, and 6 reply-with-work cards that carry the
      handoff's order;
    - absent 27: 21 quote_accepted cards drawn as Needs Updated that name no order, and 6 reply-with-work cards;
    - wrong 1: a reply_unclear card that names another order;
    - unscored 19.
  - 28 of the 39 quote_accepted cards name no order (21 absent, 7 unscored), so staff must find the quote's order
    themselves.
  - Every HEAD card keeps its order verdict under the patch.
  - Both columns have 11 wrong cards drawn as Needs Created on an existing-order email.
- **Why the figure is this low.** A card carries no change that a confirm would make (reconstruction.md §6.7). Cards are
  125 of 152 items at HEAD and 189 of 216 with the patch, and so no card can count as correct. The patch changes no write,
  so its lower figure comes from a larger denominator (6/152 to 6/216). It is not a regression in any decision.
- **Labels** (216 distinct items in the two columns):
  - high 65 (46 existing, 19 NONE), medium 94 (54 existing, 40 NONE), conflict 5;
  - none-derivable 52: 25 with no staff act on the client's orders in the window (9 with no named day), 4 with no client
    company, and 23 where staff acted on several orders and nothing singles out one;
  - at HEAD's 152: high 53, medium 61, conflict 2, none-derivable 36.

  65 of the 216 items are also in eval/diagnostic-11-3.md's tables, and my label and grade agree on 65/65.
- **Two measurement faults found on the way.**
  - **week-truth-acts files Order-level acts under the wrong order.** scripts/ops-truth.mts:58-59 and :64 key Order-level
    audit rows by `Order:${d.id}`, and for a cancel, a copy or a PO edit that id is the R number. So 26 cancels and PO
    edits and 1 copy sit under the order whose *id* equals the number: the cancel of R11557 is filed under order 11557
    (R8834). week-review and the diagnostic's action_accuracy therefore lose them. I re-keyed the 3 after the audit end
    by number.
  - **truthKeys counts a staff-built order twice** (score.ts:76-91). It gives the order its create key as the order now
    stands, then lists each shift and position staff added as separate keys. On the 2 partial creates,
    1a121423eac99289 and 1a13af10fc5250eb, the planned create equals staff's order by value. Counted as completed,
    writes would be 8/23 and item_correctness 8/152 and 8/216.

## How the true order was derived

These are the rules of eval/diagnostic-11-3.md, "How the true order was derived", applied to every item rather than to
booking work only.

- **Days.** The readers' A.days ∪ B.days (all.jsonl), never the model's.
- **Client.** Production's company_id (decisions.json), plus `companiesOf` (threadState.ts:146) over the from and to
  addresses of the thread's client messages, plus the companies of the thread's links.
- **S, the staff acts.** These are audit rows not made by the bot (creator ≠ 2257):
  - order create or copy, cancel or confirm;
  - Job, SlotTeam or Slot create;
  - a delete;
  - an edit to Slot size, beginning, end, profession_id, cancelled or role, or to Order intern_name.

  They are taken from .tmp-data/gold/timeline.json up to 22:51Z 10-22, and from week-truth-acts.json after that. In the
  overlap, my timeline acts reproduce 1,390 of week-truth's 1,411. The 21 it lacks are all acts week-truth files under
  the wrong order (see the summary).
- **Which acts count.** An act counts when it falls from 1 h before the email to 96 h after it (36 h when the readers
  named no day), is on the client's orders, and is on a named day. The day is the slot's day, or else any day of the
  order. With no day named, the day test is dropped, for acts, links and N alike.
  - Not counted: OnSinch's automated order cancels (`data.automated`; 174 audit rows). Each follows a staff edit,
    usually a slot cancel, which is counted.
- **Links.** A links.json row on the thread whose order holds a named day.
  - `bot write`, `planner find`, `finder`, `planner` and `backfill` are system links. They corroborate but never label.
    One first seen while this email was the thread's newest client email is this email's own pick, and is ignored.
  - `staff copy` and `jobs board` links are independent.
- **N.** An R or J number anywhere in the thread, either side, or in a reader's target_ref, matched with threadState.ts's
  R_RE and J_RE. It counts when it is on the client's orders and holds a named day.
- **Grades.**
  - **existing X:** staff acted on exactly one order, X, and X existed at the email.
    - high: N, an independent link or another email's system link names X.
    - medium: nothing else names it.
    - conflict: N or an independent link names a different order that existed at the email.
  - **NONE:** staff acted only on orders made after the email, and a reader (A, B or V) read a new booking or a quote.
    High when corroborated the same way. A NONE whose N names an existing order would be a conflict; none occurred.
  - **Several orders:** labelled medium only when exactly one of them is singled out by N or a link, never by this
    email's own pick. Otherwise none-derivable, as is no staff act.
- **Production's own writes hide nothing here.** Of the 25 items with a client but no staff act, 0 had a bot act on the
  client's orders in the window. None of them is a case where production's bot had already done the work. The 4 with no
  client cannot be checked this way.

## Method

- **Replay.** I replayed the dev set through `replay()` (harness/real/replay.ts) from the main checkout (HEAD) and from
  the scratch worktree with the patch, each item's decision kept.
  - Under TZ=UTC and under the box's America/New_York, the decisions are identical: 0 of 561 rows differ in either column.
  - The item counts equal run.ts's own in both columns.
- **The item's order.**
  - A write: the set of its ops' order_id, with a create_order read as NEW. It is right when that set is exactly {X},
    or {NEW} for a NONE.
  - A card, the first of these that applies:
    1. the handoff's order_id;
    2. the patch's candidates, when there is exactly one (none occurred on these items);
    3. the single R its reasons name, as the diagnostic read a pick (1 card, 1a1391790a610f8f);
    4. NEW, when drawn as Needs Created;
    5. otherwise the card names no order.
  - A card that names no order, or several, is order-absent.
- **The change (writes only).** judge() (score.ts:118) of the write's ops against truthKeys (score.ts:72) of staff's
  acts:
  - the acts are those of ops-truth's act set, on the true order (NONE: the orders staff made);
  - in the same window and on a named day;
  - with audit Slot times zoned as harness/real/world.ts:155 does, run under TZ=UTC;
  - with orders read from week-truth-orders.json, else the gold snapshot.
- **item_correctness.** Items with the right order-or-NONE and a write judged completed, ÷ items shown. "Lenient" also
  counts partial. An item whose label is none-derivable or conflict is unknown. It is counted as not correct in "all
  items", and the upper-bound row counts the 4 such writes as right.
- **Intervals.** Exact 95% Clopper-Pearson, `rate()` at harness/real/stats.ts:51 over `exact()` at :45.
- **Limits.**
  - The reading is production's stored one (replay cannot re-read).
  - Staff acts within 96 h on the same order and day pool across emails: 1a13a979194ef05f asked for a cancel, staff
    re-timed, and the cancel is judged wrong.
  - An order absent from the snapshot has no days, so it holds no named day.
  - The scratch scripts were deleted, as _common.md requires. To re-derive a row, apply the rules above to the ids in
    the table.

## Wrong writes (judge: an op staff did not make)

- **Creates whose composition differs, 3:** 1a13438a3dd67400, 1a139bd196d4eff6, 1a13f49e6e01c4ab.
- **A position added or a size set where staff set other values, 3:** 1a13fea576aeda13, 1a154d69fc48ba38 and
  1a139bb8ded24cbd. 1a139bb8ded24cbd also re-times.
- **Time values, 1:** 1a13585d743572a8.
- **A shift added whose values differ from the one staff added, 1:** 1a1308b99b2eaf9b.
- **A cancel where staff re-timed, 1:** 1a13a979194ef05f.

The 8 partial writes break down as:
- 3 lack a PO edit staff made, one of them differing only by a trailing space (1a1206f2acc35678);
- 3 lack staff positions that were deleted since;
- 2 are creates.

## Per item (216: every item in either column)

`true order` is the derived label: an R number, `NONE (R… staff made)`, or `-`. `evidence` gives the orders staff
acted on, then any R/J, independent link or other email's system link naming an order, or why no label. `order` is
right / wrong / absent / unscored. `change` is judge()'s verdict for a write, and "no change" for a card. `correct` is
yes / no / unknown. "not shown" means the item is not shown in that column, with its code.

| message_id | true order | grade | evidence | HEAD decision | HEAD pick | HEAD order | HEAD change | HEAD correct | patch decision | patch pick | patch order | patch change | patch correct |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1a0f84f659e9cba8 | R11224 | medium | staff R11339 R11224; sys. link R11224 | handoff/system_failed (needs-created) | NEW | wrong | no change | no | handoff/system_failed (needs-created) | NEW | wrong | no change | no |
| 1a11716abc3329f8 | - | none-derivable | no client company resolved, so no staff act can be placed | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown |
| 1a11a1bf717816f6 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown |
| 1a11a98082c309d0 | NONE (R11468) | medium | staff R11468 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11ac9f47699b23 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown |
| 1a11b1a8a0bb04ba | R11468 | medium | staff R11468 | handoff/system_failed (needs-created) | NEW | wrong | no change | no | handoff/system_failed (needs-created) | NEW | wrong | no change | no |
| 1a11b41485f0055e | NONE (R11475) | medium | staff R11475 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11b442a6f1d6a5 | - | none-derivable | no staff act on the client's orders on a named day in the window | not shown (other) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a11b93614a001a9 | R11475 | medium | staff R11475 | handoff/system_failed (needs-created) | NEW | wrong | no change | no | handoff/system_failed (needs-created) | NEW | wrong | no change | no |
| 1a11b960c83ae418 | R11275 | high | staff R11275; indep. link R11275 | write/write (updated-check) | R11275 | right | completed | yes | write/write (updated-check) | R11275 | right | completed | yes |
| 1a11bc834cd5dcbd | NONE (R11482) | medium | staff R11482 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11bcaca08fd2f9 | - | none-derivable | several: staff acted on 3 orders on named days (2 existing, 1 made after) and none is singled out | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown |
| 1a11bda7834b4090 | NONE (R11478) | medium | staff R11478 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a11c1176486253d | NONE (R11482) | medium | staff R11482 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11c236f8504b37 | NONE (R11484 R11500) | medium | staff R11484 R11500 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11c3919fdd9ee7 | NONE (R11486) | high | staff R11486; R/J R11486 | handoff/system_failed (needs-created) | NEW | right | no change | no | handoff/system_failed (needs-created) | NEW | right | no change | no |
| 1a11c4ded1d28237 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a11c837d668e9af | R11486 | high | staff R11486; R/J R11486 | handoff/system_failed (needs-created) | NEW | wrong | no change | no | handoff/system_failed (needs-created) | NEW | wrong | no change | no |
| 1a11c9e903a4efc5 | R11400 | medium | staff R11400 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11400 | right | no change | no |
| 1a11cb6e63edae50 | R10792 | conflict | staff R10792; R/J R10792 R11202; (an R/J in the thread names R11202) | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown | handoff/system_failed (needs-created) | NEW | unscored | no change | unknown |
| 1a11fbf5032c1be4 | R11342 | high | staff R11342; indep. link R11342 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a11fde9b93f8ab4 | R11468 | medium | staff R11468 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a1203227af049b2 | R11349 | high | staff R11349; sys. link R11349 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a1203afd588ac01 | R11486 | high | staff R11486; R/J R11486 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a120422b6fd3b9a | NONE (R11493) | high | staff R11493; sys. link R11493 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1204915fcb51a9 | R11489 | medium | staff R11489 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1204d1d5ec19a9 | NONE (R11490 R11499) | medium | staff R11490 R11499 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1205122d560ceb | NONE (R11491) | medium | staff R11491 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1205f36fa75880 | NONE (R11492) | medium | staff R11492 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1206a46fbabd4b | - | none-derivable | no client company resolved, so no staff act can be placed | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a1206f2acc35678 | R11351 | high | staff R11351; R/J R11351 | write/write (updated-check) | R11351 | right | partial | no | write/write (updated-check) | R11351 | right | partial | no |
| 1a12076a1cca653d | NONE (R11494) | medium | staff R11494 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12078a52daae2c | R11475 | medium | staff R11475 | write/write (updated-check) | R11475 | right | partial | no | write/write (updated-check) | R11475 | right | partial | no |
| 1a12082de9302ad6 | R11484 | medium | staff R11484 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a12083a6b0a0ea1 | R11493 | high | staff R11493; sys. link R11493 | not shown (other) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1208931db0f772 | R11494 | medium | staff R11494 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1208e4dea660a8 | R11493 | medium | staff R11493 | not shown (request_unsupported) |  |  |  |  | handoff/request_unsupported (needs-reply+work) | R11493 | right | no change | no |
| 1a120963d312ee58 | R11492 | medium | staff R11492 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11492 | right | no change | no |
| 1a1209a967fcf183 | - | none-derivable | several: staff acted on 3 orders on named days (2 existing, 1 made after) and none is singled out | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | none named | unscored | no change | unknown |
| 1a120a656b8d514c | R11493 | high | staff R11493; sys. link R11493 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a120c3891f966d3 | NONE (R11498) | high | staff R11498; sys. link R11498 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a120c460eaecaab | - | none-derivable | several: staff acted on 4 orders on named days (3 existing, 1 made after) and none is singled out | handoff/reading_unproven (needs-updated) | none named | unscored | no change | unknown | handoff/reading_unproven (needs-updated) | none named | unscored | no change | unknown |
| 1a120ded2d38f196 | R11498 | high | staff R11498; sys. link R11498 | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no |
| 1a120dfa4ee822fd | NONE (R11499) | medium | staff R11499 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a120e1aaf77f8fb | R11496 | medium | staff R11496 R11505 R11453; R/J R11496 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | R11496 | right | no change | no |
| 1a120ebd658db307 | R11498 | high | staff R11498; sys. link R11498 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11498 | right | no change | no |
| 1a120fe72b5982ac | R11475 | medium | staff R11475 | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11475 | right | no change | no |
| 1a1211e89bc15ce4 | R11493 | high | staff R11493; sys. link R11493 | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11493 | right | no change | no |
| 1a1212954c0b4e15 | - | none-derivable | no client company resolved, so no staff act can be placed | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown |
| 1a12129a60b6ebf8 | R10553 | medium | staff R10553 R11426; indep. link R10553 | not shown (other) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1212b34df3542d | R10553 | medium | staff R10553 R11426; R/J R10553 | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R10553 | right | no change | no |
| 1a121327f3dc6507 | NONE (R11502) | medium | staff R11502 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1213583238c22f | NONE (R11501) | medium | staff R11501 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1213ca43fb632e | - | none-derivable | several: staff acted on 2 orders on named days (2 existing, 0 made after) and none is singled out | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11500 | unscored | no change | unknown |
| 1a121423eac99289 | NONE (R11529) | high | staff R11529; sys. link R11529 | write/write (created-check) | NEW | right | partial | no | write/write (created-check) | NEW | right | partial | no |
| 1a1214440d06cbef | - | none-derivable | several: staff acted on 2 orders on named days (2 existing, 0 made after) and none is singled out | write/write (updated-check) | R11500 | unscored | unscored | unknown | write/write (updated-check) | R11500 | unscored | unscored | unknown |
| 1a1215769dd333fd | R11475 | medium | staff R11475 | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no |
| 1a121640a61d9b46 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | write/write (updated-check) | R11461 | unscored | unscored | unknown | write/write (updated-check) | R11461 | unscored | unscored | unknown |
| 1a1216e6f5c08444 | NONE (R11507) | high | staff R11507; sys. link R11507 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1217605fa76233 | R11478 | medium | staff R11478 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a12179d602c6df4 | NONE (R11508) | high | staff R11508; R/J R11508 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1217a58683c4a6 | R11453 | medium | staff R11505 R11453; R/J R11453 | write/write (updated-check) | R11453 | right | completed | yes | write/write (updated-check) | R11453 | right | completed | yes |
| 1a1218126b1d210b | R11351 | medium | staff R11351 | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no |
| 1a12185772e6ebe1 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | none named | unscored | no change | unknown |
| 1a1230b2ceeda6bb | R11426 | conflict | staff R11426; R/J R10553; (an R/J in the thread names R10553) | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a1254a1b3ef8391 | NONE (R11509) | medium | staff R11509 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1259926be7623f | R11224 | high | staff R11224; sys. link R11224 | write/write (updated-check) | R11224 | right | partial | no | write/write (updated-check) | R11224 | right | partial | no |
| 1a125bc994d79806 | R11509 | medium | staff R11509 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11509 | right | no change | no |
| 1a125f0789b8a40d | R11486 | high | staff R11486; R/J R11486 | handoff/booking_not_found (needs-updated) | R11509 | wrong | no change | no | handoff/booking_not_found (needs-updated) | R11509 | wrong | no change | no |
| 1a129ce2f3e401a2 | NONE (R11510) | medium | staff R11510 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a12b2a2199e0ed3 | R11509 | medium | staff R11509 | handoff/booking_not_found (needs-updated) | R11486 | wrong | no change | no | handoff/booking_not_found (needs-updated) | R11486 | wrong | no change | no |
| 1a12b5734c7b8276 | NONE (R11512) | medium | staff R11512 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12c17f9c71e222 | R11498 | high | staff R11498; sys. link R11498 | write/write (updated-check) | R11498 | right | partial | no | write/write (updated-check) | R11498 | right | partial | no |
| 1a12c1a240bbee4a | - | none-derivable | several: staff acted on 2 orders on named days (2 existing, 0 made after) and 2 are named | handoff/booking_not_identified (needs-updated) | R10792 | unscored | no change | unknown | handoff/booking_not_identified (needs-updated) | R10792 | unscored | no change | unknown |
| 1a12f13c7c4602d5 | - | none-derivable | several: staff acted on 6 orders on named days (5 existing, 1 made after) and none is singled out | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | unscored | no change | unknown |
| 1a12f19db16de614 | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/booking_not_identified (needs-updated) | none named | unscored | no change | unknown | handoff/booking_not_identified (needs-updated) | none named | unscored | no change | unknown |
| 1a12f46fb51031b3 | NONE (R11515) | high | staff R11515; indep. link R11515 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12f50cc50cbb33 | R11493 | high | staff R11493; sys. link R11493 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | R11493 | right | no change | no |
| 1a12f5348dc08d3c | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/reading_unproven (needs-created) | NEW | unscored | no change | unknown | handoff/reading_unproven (needs-created) | NEW | unscored | no change | unknown |
| 1a12f577b851895d | R11509 | medium | staff R11509 | handoff/policy_past_day (needs-updated) | R11486 | wrong | no change | no | handoff/policy_past_day (needs-updated) | R11486 | wrong | no change | no |
| 1a12f6443eb128ac | R11515 | high | staff R11515; indep. link R11515 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a12f6887ed713a4 | R11491 | medium | staff R11491 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a12f73cd20dfb4e | NONE (R11516) | medium | staff R11516 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12f99d4cc811b1 | NONE (R11517) | medium | staff R11517 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12f9c89806a92e | NONE (R11518) | medium | staff R11518 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12fae6327d39de | R11516 | medium | staff R11516 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11516 | right | no change | no |
| 1a12fba6cf817941 | R11518 | medium | staff R11518 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a12fc246b1151f2 | - | none-derivable | no client company resolved, so no staff act can be placed | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown |
| 1a12fc76a35c018d | R11224 | high | staff R11224; sys. link R11224 | write/write (updated-check) | R11224 | right | partial | no | write/write (updated-check) | R11224 | right | partial | no |
| 1a12fd770bf6ce9a | NONE (R11519) | high | staff R11519; R/J R11519 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12fd92dc5f880e | NONE (R11520) | medium | staff R11520 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a12ff87da3b5276 | R11516 | high | staff R11516; indep. link R11516 | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no |
| 1a1302af563ff312 | NONE (R11524) | medium | staff R11524 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a130467b150f06e | R11507 | high | staff R11507; sys. link R11507 | handoff/booking_not_found (needs-updated) | R11507 | right | no change | no | handoff/booking_not_found (needs-updated) | R11507 | right | no change | no |
| 1a13052f529bff9a | - | none-derivable | several: staff acted on 4 orders on named days (3 existing, 1 made after) and none is singled out | handoff/booking_not_identified (needs-updated) | R11404 | unscored | no change | unknown | handoff/booking_not_identified (needs-updated) | R11404 | unscored | no change | unknown |
| 1a13066d1a39485c | NONE (R11525) | medium | staff R11525 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1307f87ab752b3 | R11524 | medium | staff R11524 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1308567c26e478 | R11472 | medium | staff R11472 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1308b99b2eaf9b | R11508 | high | staff R11508; R/J R11508 | write/write (updated-check) | R11508 | right | wrong | no | write/write (updated-check) | R11508 | right | wrong | no |
| 1a1309f20ddc4045 | R11069 | medium | staff R11069 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a1309f7f0000dee | R11508 | high | staff R11508; R/J R11508 | handoff/policy_confirmed_proposal (needs-updated) | R11508 | right | no change | no | handoff/policy_confirmed_proposal (needs-updated) | R11508 | right | no change | no |
| 1a130a34df3bd1d4 | R11382 | medium | staff R11382 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a130a97919faa70 | NONE (R11525) | medium | staff R11525 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a130b4e27c044e7 | NONE (R11525) | medium | staff R11525 | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no | handoff/booking_not_identified (needs-updated) | none named | absent | no change | no |
| 1a130c9740330432 | R11520 | medium | staff R11520 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a130d2f1bd4b587 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a131a77a85ae6c0 | R11202 | high | staff R11202; R/J R11202 | handoff/booking_not_identified (needs-updated) | R11202 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11202 | right | no change | no |
| 1a13438a3dd67400 | NONE (R11527) | medium | staff R11527 | write/write (created-check) | NEW | right | wrong | no | write/write (created-check) | NEW | right | wrong | no |
| 1a1344a080edb10d | NONE (R11528) | medium | staff R11528 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a1345c6d25b4669 | R11224 | high | staff R11224; sys. link R11224 | write/write (updated-check) | R11224 | right | partial | no | write/write (updated-check) | R11224 | right | partial | no |
| 1a1346130e776e0a | - | none-derivable | several: staff acted on 5 orders on named days (3 existing, 2 made after) and none is singled out | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | R10778 | unscored | no change | unknown |
| 1a1347346c4f46c7 | - | none-derivable | several: staff acted on 4 orders on named days (2 existing, 2 made after) and none is singled out | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11224 | unscored | no change | unknown |
| 1a134990c712db28 | - | none-derivable | several: staff acted on 3 orders on named days (3 existing, 0 made after) and none is singled out | write/write (updated-check) | R11404 | unscored | unscored | unknown | write/write (updated-check) | R11404 | unscored | unscored | unknown |
| 1a134a4324d240f6 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a134a6d63f9f41b | NONE (R11531) | high | staff R11531; sys. link R11531 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a134bc0808ae334 | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a134c495b1271d6 | - | none-derivable | several: staff acted on 3 orders on named days (2 existing, 1 made after) and none is singled out | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a134cd95768b9bb | - | none-derivable | no staff act on the client's orders on a named day in the window | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11221 | unscored | no change | unknown |
| 1a134d4601dc07f2 | R11525 | medium | staff R11525 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a134e78be0cac0c | NONE (R11532) | medium | staff R11532 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a135109bb809c79 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | handoff/reply_detail_missing (needs-created) | NEW | unscored | no change | unknown | handoff/reply_detail_missing (needs-created) | NEW | unscored | no change | unknown |
| 1a1352eb400586cf | R11498 | medium | staff R11498 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1352f5e4f4c520 | R11531 | medium | staff R11531 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11531 | right | no change | no |
| 1a13560df44be6f6 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | handoff/reply_detail_missing (needs-updated) | none named | unscored | no change | unknown | handoff/reply_detail_missing (needs-updated) | none named | unscored | no change | unknown |
| 1a1357bc83414e00 | R11532 | medium | staff R11532 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a13585d743572a8 | R10522 | high | staff R10522; sys. link R10522 | write/write (updated-check) | R10522 | right | wrong | no | write/write (updated-check) | R10522 | right | wrong | no |
| 1a13595a58625348 | R10522 | high | staff R10522; sys. link R10522 | handoff/reading_unproven (needs-updated) | R10522 | right | no change | no | handoff/reading_unproven (needs-updated) | R10522 | right | no change | no |
| 1a135d12439df374 | R11480 | medium | staff R11480 R11539; R/J R11480; sys. link R11480 | handoff/reading_unproven (needs-created) | NEW | wrong | no change | no | handoff/reading_unproven (needs-created) | NEW | wrong | no change | no |
| 1a1362cc9126dca1 | R11528 | medium | staff R11528 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a1391790a610f8f | R11410 | high | staff R11410; indep. link R11410 | handoff/booking_not_identified (needs-updated) | R11410 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11410 | right | no change | no |
| 1a1399a92f4c792d | NONE (R11541) | medium | staff R11541 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a139a068a0023e7 | NONE (R11545) | medium | staff R11545 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a139a32371af418 | NONE (R11547) | high | staff R11547; sys. link R11547 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a139a998169549f | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a139ada42ba1d76 | R10522 | high | staff R10522; sys. link R10522 | handoff/client_unknown (needs-created) | NEW | wrong | no change | no | handoff/client_unknown (needs-created) | NEW | wrong | no change | no |
| 1a139bb8ded24cbd | R11541 | high | staff R11541; sys. link R11541 | write/write (updated-check) | R11541 | right | wrong | no | write/write (updated-check) | R11541 | right | wrong | no |
| 1a139bd196d4eff6 | NONE (R11549) | medium | staff R11549 | write/write (created-check) | NEW | right | wrong | no | write/write (created-check) | NEW | right | wrong | no |
| 1a139c08af1111d6 | NONE (R11547) | high | staff R11547; sys. link R11547 | handoff/reading_unproven (needs-created) | NEW | right | no change | no | handoff/reading_unproven (needs-created) | NEW | right | no change | no |
| 1a139d57839581af | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/booking_link_unreadable (needs-created) | NEW | unscored | no change | unknown | handoff/booking_link_unreadable (needs-created) | NEW | unscored | no change | unknown |
| 1a139f0f10a9d1c9 | - | none-derivable | several: staff acted on 9 orders on named days (2 existing, 7 made after) and none is singled out | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | unscored | no change | unknown |
| 1a139f824146018a | - | none-derivable | no staff act on the client's orders on a named day in the window; only a system link (R11520) | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a13a02e4c08a985 | R11382 | medium | staff R11382 | handoff/reading_unproven (needs-updated) | none named | absent | no change | no | handoff/reading_unproven (needs-updated) | none named | absent | no change | no |
| 1a13a07828a2d598 | NONE (R11552) | medium | staff R11552 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13a15d0ca3317b | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/request_unsupported (needs-updated) | R11500 | unscored | no change | unknown | handoff/request_unsupported (needs-updated) | R11500 | unscored | no change | unknown |
| 1a13a25e4a10c97b | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown |
| 1a13a2aff927527b | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | none named | unscored | no change | unknown |
| 1a13a3116bc14bf3 | - | none-derivable | several: staff acted on 2 orders on named days (1 existing, 1 made after) and none is singled out | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a13a408e18d3802 | - | none-derivable | no staff act on the client's orders on a named day in the window; only a system link (R11520) | handoff/request_inconsistent (needs-updated) | R11520 | unscored | no change | unknown | handoff/request_inconsistent (needs-updated) | R11520 | unscored | no change | unknown |
| 1a13a412d167cb95 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | none named | unscored | no change | unknown |
| 1a13a443201c1d31 | NONE (R11554) | medium | staff R11554 | handoff/client_unknown (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13a4d3c508d77a | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown |
| 1a13a5149fcd9455 | NONE (R11555) | medium | staff R11555; sys. link R11500 | not shown (reply_unclear) |  |  |  |  | handoff/reply_unclear (needs-reply+work) | R11500 | wrong | no change | no |
| 1a13a598b90c7a2a | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/reading_unproven (needs-created) | NEW | unscored | no change | unknown | handoff/reading_unproven (needs-created) | NEW | unscored | no change | unknown |
| 1a13a59eae9e3e44 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown | handoff/policy_confirmed_proposal (needs-created) | NEW | unscored | no change | unknown |
| 1a13a5c3d90489c1 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown | handoff/client_unknown (needs-created) | NEW | unscored | no change | unknown |
| 1a13a5fb091090aa | NONE (R11555) | medium | staff R11555 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13a8890d485caa | - | none-derivable | several: staff acted on 2 orders on named days (2 existing, 0 made after) and none is singled out | write/write (updated-check) | R11404 | unscored | unscored | unknown | write/write (updated-check) | R11404 | unscored | unscored | unknown |
| 1a13a8bf26108f7b | NONE (R11558) | medium | staff R11558 | handoff/reading_unproven (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13a979194ef05f | R11508 | high | staff R11508; R/J R11508 | write/write (updated-check) | R11508 | right | wrong | no | write/write (updated-check) | R11508 | right | wrong | no |
| 1a13a97ff7a30369 | R11547 | medium | staff R11547 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11547 | right | no change | no |
| 1a13a9f85847ce8b | R11484 | medium | staff R11484 R11588; sys. link R11484 | handoff/reading_unproven (needs-updated) | R11484 | right | no change | no | handoff/reading_unproven (needs-updated) | R11484 | right | no change | no |
| 1a13abf5104b15b4 | NONE (R11557) | medium | staff R11557 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13ad05c65d0447 | R11554 | medium | staff R11554 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11554 | right | no change | no |
| 1a13ad08da1ce2b9 | R11555 | medium | staff R11555; sys. link R11500 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11555 | right | no change | no |
| 1a13ad1788e8c98c | NONE (R11560) | medium | staff R11560 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13ae4bb1dab34e | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/reading_unproven (needs-updated) | R11492 | unscored | no change | unknown | handoff/reading_unproven (needs-updated) | R11492 | unscored | no change | unknown |
| 1a13af10fc5250eb | NONE (R11561) | high | staff R11561; sys. link R11561 | write/write (created-check) | NEW | right | partial | no | write/write (created-check) | NEW | right | partial | no |
| 1a13af9c9a1d50e8 | R11552 | high | staff R11552; sys. link R11552 | not shown (other) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a13b2a104b579ab | - | none-derivable | no staff act on the client's orders on a named day in the window | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown | handoff/policy_lead_days (needs-created) | NEW | unscored | no change | unknown |
| 1a13b3fa256bdee2 | R11093 | high | staff R11093; R/J R11093; sys. link R11093 | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no |
| 1a13b45143681d8d | NONE (R11587 R11589 R11591 R11592 R11593 R11594) | medium | staff R11587 R11589 R11591 R11592 R11593 R11594 | handoff/reading_unproven (needs-created) | NEW | right | no change | no | handoff/reading_unproven (needs-created) | NEW | right | no change | no |
| 1a13b4ff18f0a1da | R11508 | high | staff R11508; R/J R11508 | write/write (updated-check) | R11508 | right | completed | yes | write/write (updated-check) | R11508 | right | completed | yes |
| 1a13b915f3a326a3 | NONE (R11588) | high | staff R11588; sys. link R11588 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13e9ba4edde86b | R11479 | medium | staff R11479 | write/write (updated-check) | R11479 | right | completed | yes | write/write (updated-check) | R11479 | right | completed | yes |
| 1a13e9ff8d34c9e2 | R11029 | high | staff R11029; R/J R11029; sys. link R11029 | write/write (updated-check) | R11029 | right | completed | yes | write/write (updated-check) | R11029 | right | completed | yes |
| 1a13ea2e0ba9a5e1 | - | none-derivable | several: staff acted on 2 orders on named days (2 existing, 0 made after) and none is singled out | handoff/policy_past_day (needs-updated) | R11454 | unscored | no change | unknown | handoff/policy_past_day (needs-updated) | R11454 | unscored | no change | unknown |
| 1a13ecba7aedacb2 | - | none-derivable | no staff act on the client's orders on a named day in the window; only a system link (R11791) | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | unscored | no change | unknown |
| 1a13f0edc1eda260 | R11093 | high | staff R11093; R/J R11093; sys. link R11093 | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no |
| 1a13f22ec18faae5 | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a13f3a53885b7c2 | R11093 | high | staff R11093; R/J R11093; sys. link R11093 | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11093 | right | no change | no |
| 1a13f449f8efd6b3 | NONE (R11599) | high | staff R11599; indep. link R11599 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13f49e6e01c4ab | NONE (R11602) | high | staff R11602; sys. link R11602 | write/write (created-check) | NEW | right | wrong | no | write/write (created-check) | NEW | right | wrong | no |
| 1a13f516bb4f171f | R11208 | medium | staff R11208 | handoff/booking_not_identified (needs-updated) | R11208 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11208 | right | no change | no |
| 1a13f5382ff22bed | NONE (R11603) | high | staff R11603; indep. link R11603 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13f8312ae75c73 | R11349 | high | staff R11349; sys. link R11349 | handoff/reading_unproven (needs-updated) | R11349 | right | no change | no | handoff/reading_unproven (needs-updated) | R11349 | right | no change | no |
| 1a13f86e46191246 | R11602 | high | staff R11602; sys. link R11602 | handoff/reading_unproven (needs-updated) | R11602 | right | no change | no | handoff/reading_unproven (needs-updated) | R11602 | right | no change | no |
| 1a13f9bc1c910e5c | R10522 | high | staff R10522; sys. link R10522 | handoff/reading_unproven (needs-updated) | R10522 | right | no change | no | handoff/reading_unproven (needs-updated) | R10522 | right | no change | no |
| 1a13fb4d5be6a768 | NONE (R11613) | high | staff R11613; indep. link R11613 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13fb70176c781c | NONE (R11614) | medium | staff R11614 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13fd80597e6e43 | R11614 | medium | staff R11614 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a13fd94ac637812 | R11613 | high | staff R11613; indep. link R11613 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a13fe91532a3fb7 | NONE (R11617) | high | staff R11617; indep. link R11617 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a13fea576aeda13 | R11613 | high | staff R11613; indep. link R11613 | write/write (updated-check) | R11613 | right | wrong | no | write/write (updated-check) | R11613 | right | wrong | no |
| 1a1405bd65b444b6 | R11029 | high | staff R11029; R/J R11029; sys. link R11029 | write/write (updated-check) | R11029 | right | completed | yes | write/write (updated-check) | R11029 | right | completed | yes |
| 1a1405f822867a84 | R11614 | medium | staff R11614 | handoff/booking_not_identified (needs-updated) | R?id16669 | wrong | no change | no | handoff/booking_not_identified (needs-updated) | R?id16669 | wrong | no change | no |
| 1a140632ce4d5e99 | NONE (R11619) | high | staff R11619; sys. link R11619 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a140936e8627133 | - | none-derivable | no staff act on the client's orders on a named day in the window; only a system link (R11602) | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a143d7e2ac72699 | R11619 | medium | staff R11619 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11619 | right | no change | no |
| 1a1493bc7c314c28 | R11737 | conflict | staff R11737; R/J R11093; sys. link R11093; (an R/J in the thread names R11093) | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | R11093 | unscored | no change | unknown |
| 1a1497d7b3445d5f | R11737 | conflict | staff R11737; R/J R11093; sys. link R11093; (an R/J in the thread names R11093) | handoff/reading_unproven (needs-updated) | R11093 | unscored | no change | unknown | handoff/reading_unproven (needs-updated) | R11093 | unscored | no change | unknown |
| 1a1533b5bd8afd4a | R11549 | high | staff R11549; sys. link R11549 | handoff/reading_unproven (needs-updated) | R11549 | right | no change | no | handoff/reading_unproven (needs-updated) | R11549 | right | no change | no |
| 1a1537f6f674abca | - | none-derivable | no staff act on the client's orders in the window (the readers named no day) | handoff/reply_detail_missing (needs-updated) | none named | unscored | no change | unknown | handoff/reply_detail_missing (needs-updated) | none named | unscored | no change | unknown |
| 1a153bcb54f7f266 | R11529 | medium | staff R11744 R11529; sys. link R11529 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a153c3baf30122a | R11529 | medium | staff R11744 R11529; sys. link R11529 | handoff/booking_not_identified (needs-updated) | R11529 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11529 | right | no change | no |
| 1a153c6ae7df98a2 | R11737 | conflict | staff R11737; R/J R11093; (an R/J in the thread names R11093) | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | unscored | no change | unknown |
| 1a153fd7592e2239 | R10992 | medium | staff R10992 | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no | handoff/policy_lead_days (needs-created) | NEW | wrong | no change | no |
| 1a1540528d5a2d27 | R11561 | high | staff R11561; sys. link R11561 | not shown (none_nothing_to_do) |  |  |  |  | handoff/quote_accepted (needs-updated) | none named | absent | no change | no |
| 1a154d69fc48ba38 | R11349 | medium | staff R11349 R11029; sys. link R11349 | write/write (updated-check) | R11349 | right | wrong | no | write/write (updated-check) | R11349 | right | wrong | no |
| 1a158c5ac15f6fdc | R11349 | medium | staff R11349 R11029; sys. link R11349 | not shown (reply_detail_missing) |  |  |  |  | handoff/reply_detail_missing (needs-reply+work) | none named | absent | no change | no |
| 1a1596b0abbb0a66 | R11541 | high | staff R11541; sys. link R11541 | handoff/request_unsupported (needs-updated) | R11541 | right | no change | no | handoff/request_unsupported (needs-updated) | R11541 | right | no change | no |
| 1a159f0b5b42bf65 | R11545 | medium | staff R11545 | handoff/booking_not_identified (needs-updated) | R11545 | right | no change | no | handoff/booking_not_identified (needs-updated) | R11545 | right | no change | no |
| 1a15a6583c83e5ba | NONE (R11791) | medium | staff R11791 | handoff/policy_lead_days (needs-created) | NEW | right | no change | no | handoff/policy_lead_days (needs-created) | NEW | right | no change | no |
| 1a162ee6be44f3ac | R11029 | medium | staff R11029 R11349; R/J R11029 | handoff/reading_unproven (needs-updated) | R11029 | right | no change | no | handoff/reading_unproven (needs-updated) | R11029 | right | no change | no |
| 1a1637f32d75fe09 | R11298 | high | staff R11298; R/J R11298 | not shown (none_already_booked) |  |  |  |  | handoff/quote_accepted (needs-updated) | R11298 | right | no change | no |
| 1a1637eeed35ce33 | R11603 | high | staff R11603; indep. link R11603 | handoff/request_unsupported (needs-updated) | R11603 | right | no change | no | handoff/request_unsupported (needs-updated) | R11603 | right | no change | no |
| 1a163fc5755a93c1 | R11484 | medium | staff R11484 | handoff/reading_unproven (needs-updated) | R11484 | right | no change | no | handoff/reading_unproven (needs-updated) | R11484 | right | no change | no |
