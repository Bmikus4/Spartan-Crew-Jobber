# §10 proposals: aging policy and the minimal flagged-item display change

The orchestrator wrote this on 2026-10-25. It rests on `audit/card-anatomy.md` (card-anatomy, a4ae517a, accepted after 22 of its 222 citations were re-opened), `eval/live-week-reads.md` and `audit/reconstruction.md` §6.7.

**Nothing here is built.** OPERATING §5 and §10 keep the display untouched until the owner and Paz authorize a change. Three rules bind every proposal:
- the owner's 10-13 rule: "Only those cases should be moved to the display TV", meaning the work the system cannot do;
- §2: operational failures are never visible to the team;
- §4: never drop silently.

## Summary

- **The TV shows only flagged items today, and they all look alike.** It lists only what the system could not do, and verified writes are hidden (serve.ts:109-116). So §10's "distinguish flagged from confirm-ready" has nothing to separate yet.
- **Three different things share one look:** a decision for a person, the system's own failure, and a planned write that did not run because writes are off. Each has the same red edge, amber badge and Confirm button (LiveFeedScreen.tsx:51-52, 299).
- **A card never shows a top-3 or evidence.** No decision stores the candidates it weighed (plan.ts:41-50). The link's `source`, which records how its order was found, is read nowhere (live.ts:83-85).
- **A card can leave without anyone seeing it go, in six ways.** The commonest is "its job day passed".
- **Two proposals follow.** A. Every exit is visible, and every miss is counted. B. The smallest change that tells staff what kind of item they are looking at, and why that order.

## A. Aging policy (proposed)

| situation | today | proposed |
|---|---|---|
| a need whose job starts within 48 h | the date turns amber (LiveFeedScreen.tsx:40, 176-180) | keep the amber; under 24 h with no activity, sort it first and show the time left |
| no activity for 24 h | "Needs Follow Up" badge (order.ts:26) | keep |
| no activity for 7 days | sinks under "Nothing New For 7+ Days" (order.ts:18) | keep |
| undated and 14 days old | becomes a number in the footer (project.ts:69, 442) | consolidate: one "N older items" card that opens to the list, never only a count |
| the last job day passes with the need still open | leaves silently (project.ts:417) | leaves the list, but is written as a missed need with its reason and counted in the owner's daily health report. This is §4's worst outcome, and today it is invisible |
| a replan turns a need into needs-reply | dropped from the list, with no `resolved` mark (v2.ts:105; serve.ts:109) | the booking need stays listed with a Needs Reply badge; our reply clears only the question (the needs-reply fix in checkpoint-A §5) |
| one need on a thread of several is dropped | no `resolved` mark | write `resolved` with its reason |
| a need resolves while no screen is open | no mark, because the verifier and `open` memory run only inside `/api/feed` (labels/route.ts:43) | run the verifier and the `open` memory in the minute sync as well, so that every exit leaves a mark |
| a newer verified write overtakes a need (dormant while writes are off) | the need gives way silently (v2.ts:225-242) | write `resolved`: "done by the system" |

Every exit writes a `resolved` or `missed` mark with its reason (marksDb.ts:27-35 already holds `by` and `evidence`). A "Cleared today" footer lists the day's exits, one line each.

## B. Minimal flagged-item display change (proposed)

1. **One chip that says what kind of item it is**, taken from the decision's reason code. The code is stamped on every decision but is read nowhere in the feed today (card-anatomy §1.5):
   - **Your decision:** policy rules, several candidate orders, an unclear request. These keep today's look.
   - **Ready, writes paused:** a planned write that did not run because `bot_writes_enabled` is off. It reads "Not written, do it by hand" today.
   - **System problem:** `system_failed`, or a write that stopped part-way. That was 5 of the live week's 81 listed cards. A booking link that cannot be read is a booking gone, not a fault (reasons.ts:27). Under §2 and §15 these should go to the owner's alerts and be retried, not shown to staff. Until that path exists, they at least carry this chip.
2. **Top-3 and evidence, for a need about an existing order:**
   - **Under the R/J:** one line saying how the order was found. The link's `source` is already stored, for example "R number in the email", "the thread's earlier order" or "day + venue".
   - **When the planner found several orders**, their R numbers (up to 3), each with the fact that matched: day, venue or start.
   - This needs one data-model addition: the decision keeps the candidates it weighed. Today only `none.found` holds a list (plan.ts:41-50).
3. **Needs-reply items that carry a booking need are listed** with their booking, instead of only counted. 8 of the 16 silent misses in the live week were needs-reply items.

Unchanged by B:
- Writes that ran stay hidden, per the owner's 10-13 rule.
- No reject path is built (§5).

## §10 status model

| §10 status | today |
|---|---|
| confirm_ready | no counterpart. Verified writes are hidden, and unexecuted writes are drawn as flagged |
| flagged | the listed needs (needs-created, needs-updated, held links) |
| confirmed | the `checked` mark (a person's tick), plus three automatic greens: order found, staff edit, resolved |
| suppressed | a `none` decision. It makes no item (v2.ts:109) and is logged with its reason in `v2_decisions` |
| future rejected / held | a new `feed_marks` mark kind, keyed (item_key, mark), with `by` and the reason in `evidence`. No Phase 0 choice blocks it |
