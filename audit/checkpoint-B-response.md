# Response to the owner's Checkpoint B instructions (10-26)

Orchestrator, 2026-10-26. Instructions: decisions/2026-10-26-checkpoint-b-response.md.

**Checkpoint B stays closed:** nothing deployed, writes off, no prompt change. Spent: $0.1485 of the $0.20 reader budget.
Every other check was $0, offline, or a read-only query.

## 1. Evidence index and current state: audit/evidence-index.md

- **Verified today:**
  - HEAD = origin/main = the deployed revision 305bf84 (GitHub's Production deployment; today's production decisions carry
    305bf84).
  - Production app code unchanged since 6a98170 (10-24). The held patch is not live, and no harness code runs in production.
  - Reader: openai/gpt-6.1-sol with prompt extract@f3e1a862322b, on every decision since 10-16 07:00:44Z.
  - bot_writes_enabled = false; 0 runs since 10-21; intake on.
- **Remembered, not re-checked today:** the n8n workflows.
- **Corrections, appended to audit/final-state.md (7 items) and eval/iterations.md:**
  - the prompt did not change 10-20 or 10-23;
  - 233 of the 238 "dev-2" emails were read by the current reader, so labelled current-reader dev mail already exists;
  - and the further items below.
- **Red-team B2:** in full in audit/red-team-B2.md, with my answers in final-state.md. Today's checks overturn B2-2,
  correct B2-5, extend B2-10 and close B2-11; the other eight stand.

## 2. Items 1-4, cut and tested: eval/patches/items-1-4.md

- **Two diffs on 305bf84:**
  - `items-1-3-runtime.diff`: owner alert, replay guard, zone-less time is UTC;
  - `item-4-scoring.diff`: the scorer.
- Each applies alone with tsc clean and its tests green. Together, the full suite passes. Every new test goes red
  without its fix.
- **What OnSinch's zone-less times mean, measured on its own data:**
  - The audit timeline writes slot times with no zone, and the API writes them with +00:00 (23,942 of 23,942).
  - In British Summer Time, 1,810 of 1,813 last-audited values equal the API's when read as UTC, and 0 when read as London.
  - Tests cover both 2026 clock changes, the repeated 01:30, midnight crossings including a real slot, and five process zones.
  - No production input is zone-less, so item 3 changes only scoring.
- **Item 4 was incomplete in the held patch.** Its own scorer still gave 6/23 completed writes, because "add job" and
  in-build edits still counted. Fixed and re-judged on the audit copy: the scorer now gives 8 completed, 6 partial,
  9 wrong.
- **Rollback:** revert the one commit per diff through the gate. No schema, setting or data change.

## 3. Execution correctness: eval/write-breakdown.md

- **27 writes, 23 assessable.** The 4 unscored ones are cases where staff acted on several orders and nothing singles
  one out. One of the 4 shows a planner defect: two size ops on one position.
- **Read against the audit trail, 16 of 23 did what the email asked (69.6%, CI 47.1-86.8).** That is a reading, not a
  relabel. 7 are real errors:
  - a re-time for a named role applied to the whole shift (14 of 16 people an hour off);
  - an added crew or chief that ignores the requested window or length (2);
  - an availability question planned as 4 edits;
  - a known venue not matched;
  - a trade mix on creates (2).

  The remaining scorer "failures" are artefacts of 5 scorer faults, listed in §7 of the breakdown.
- **Crew-chief.** None of the 3 is the chief rule disagreeing with staff, so "within Ben's 4%" was wrong. Two are window
  errors. The third, "add 3" against "3 in all", **happened in production on 10-20**: an extra Crew Chief booked for
  25 h, until staff cancelled it. The rule (plan.ts:60-71) puts chiefs inside the headcount, and a chief is a different
  profession with its own role and pay. The error is material.
- **History is kept apart from the replay:**
  - production made a write decision on 11 of the 27: 8 blocked by the signed-on-crew guard, 2 never ran, 1 ran;
  - the one that ran, R11546, verified by read-back, was a create staff deleted the same morning (10:19Z);
  - read-back proves OnSinch holds what was sent, not that it was right.
- **"Selection-bound" was the wrong word.** In the §11.3 diagnostic, action_accuracy 7/50 = writes judged completed ÷
  items whose order-or-NONE was right (live-week dev, true order injected). Of the 43 that fail:
  - 30 are hand-offs that propose no change by design: 17 under the lead-days rule, 8 reading_unproven,
    3 request_unsupported, 1 client_unknown, 1 policy_confirmed_proposal;
  - 13 are writes, partial or wrong.

  Retrieval is not the bottleneck (46/46 in the pool). Reading and making the change are.
- **No tier is proposed for unattended running.**
  - Each class needs the scorer fixed, a shadow window, and 0 wrong in at least 368 consecutive ops before a 1% bound
    holds.
  - The least-risk candidates, with their checks: PO set; a whole-shift re-time naming no role; a crew count with no
    chief change.
  - Not candidates: chief changes, cancels and creates.
  - Model confidence is no gate: every wrong write came from a confident, grounded reading.

## 4. Items 5-8, held, one component at a time: eval/component-assessment.md

| | current mail (prospective, 24 B42) | dev B42 recall (HEAD 133/184) | regressions | testable alone |
|---|---|---|---|---|
| 5 parser | 0 cards change | +0 (1 reason changes) | none | yes |
| 6 quote acceptance | +6 cards: 4 real acceptances, 2 not | +18 (16 old reader, 2 current) | 21 dev and 2 prospective cards "Needs Updated" with no order; a thread can keep "Needs Created" | yes, with 2 import lines trimmed |
| 7 domain matching | 0 | +0 (1 card right) | none; the TV would still show "Unknown client" | yes |
| 8 display rule | +1 card, unnecessary | +14 (11 old, 2 current, 1 repeat) | 6 listed reply cards with no order, 1 wrong order | no: needs item 1's systemFailureOf |

- **Two more corrections:**
  - Staff completed **all 4** accepted quote orders (confirmed from provisional and set the PO within an hour of the
    acceptance), not 3, with "no confirm row". The count had missed the order-level audit rows, which are keyed by number.
  - The display rule's value on current mail is not zero: on the current reader's dev and dev-2 mail, 7 of 83
    inquiries are silent reply cards.
- **Paz:** audit/paz-acceptance-examples.md is a draft for the owner to send, with real order numbers for the three cases:
  - complete an identified order: 4, all completed by staff;
  - find/confirm among candidates: 3;
  - investigate with no quote order: 2.

  Case 1 carries Order Needs Updated. Cases 2 and 3 carry none of the four labels, because a fifth would break the
  invariant. It also asks Paz 6 questions.
- **A separate quote-work metric** (quote_work_recall and quote_work_precision) is defined there. It is never summed with
  inquiry_recall.

## 5. Reader diagnostic: eval/reader-diagnostic/results.md

- **Setup.**
  - The cases were fixed in a manifest (sha256 833df054c5676fd5, recorded before any call).
  - Re-read with production's model and prompt (checked before the first call) on the replay's reconstruction of the
    reader's input.
  - 14 calls, $0.1485.
  - The fixed stop rule ended the run after all 11 misses and 3 of the 9 controls.
- **Paired result, at HEAD and with the patch alike:**
  - **9 of 11 old-reader misses stay silent with the current reader** (81.8%, CI 48.2-97.7);
  - 7 of the 8 "no change asked for" readings recur;
  - 1 is now read correctly;
  - 1 reaches a person only as an "unsupported request" card;
  - the 3 controls read are unchanged.
- **The 10-16 model switch did not fix this failure.** The old misses are valid dev evidence for the current reader. With
  the 4 prospective misses and the 3 dev and dev-2 ones, the current reader's reading failure has 16 dev cases: 15 "nothing
  asked" and 1 partial reading.
- This is a diagnostic on known mail. Any prompt change needs the owner's separate yes.

## 6. Workflow and safety: audit/workflow-proposal.md

- **Today, a tick only records who ticked** (check.ts:24-53). It turns the card green, clears its Gmail labels within a
  minute and drops it after 24 h. Nothing is checked or changed in OnSinch. One tick means seen, approved and done at once.
- **A hand-off with no order found is still drawn "Order Needs Updated"** (feed/v2.ts:85-91).
- **Proposal:**
  - separate states: acknowledged, approved, verified-done, claimed-but-unverified, and held/rejected with a reason;
  - a tick starts a field-level check against OnSinch instead of being the evidence;
  - writes stay off.
- **Crew notifications.**
  - OnSinch's help lists "Shift change" and "Removed by admin" notices, each set ON/OFF/Optional per agency.
  - Our copies cannot settle whether they fire: the audit timeline has no notification rows.
  - Inferred: time and size edits on staffed positions notify crew if the setting is on. New positions do not, because
    the bot creates them hidden.
  - $0 next step: an admin reads Settings → Notification settings. A controlled test on test order 515 would write to
    OnSinch, so it is the owner's call. No crew were contacted.
- **Display precision, both definitions** (component-assessment.md). No floor is proposed.
  - The worst class is "Needs Created on an existing order": 11 on dev, 1 on prospective. None comes from the patch.
  - Prospective, HEAD: strict 82.6%, broad 91.3%. With the whole patch: 63.3% and 83.3%.
- **The unfinished clarification-draft / Needs Follow Up workflow is not built** (only draftContext, called from a
  test). It cannot help:
  - the "nothing asked" misses, which make no card to draft from;
  - the wrong or partial writes.

  It could help booking_not_identified and reply-detail cases. So it is not the next block.

## 7. Evaluation discipline and the next block: eval/dev-windows.md

- **Windows:**
  - D-cur: 393 labelled current-reader emails, 107 B42. HEAD leaves 17 silent (84.1%, CI 75.8-90.5): "nothing asked" 7,
    reply cards 7, other 3.
  - W2: mail 10-26..10-28, labelled in one batch when it closes; dev.
  - **E3: mail from 10-29 00:00Z, untouched until a frozen fix is scored once.**
  - The 40 pause-window emails are in no window. Their store runs on or after 10-28 16:06Z, unchanged.
- **Recommended next block (small, sandbox only, $0): make writes correct, measured truthfully.**
  1. **Scorer:** fix the 5 remaining faults (eval/write-breakdown.md §7), each with a targeted test built from the real
     case's shape. Then re-judge every dev and dev-2 write, per class.
  2. **Planner:** fix the demonstrated op errors, each red-first on a synthetic case of the same shape:
     - a role-named re-time applied to the whole shift;
     - added crew or chief ignoring the requested window;
     - "add N" against "N in all", which hands off instead of writing;
     - two size ops on one position;
     - a question planned as edits.
  3. **Re-measure on D-old and D-cur:** the wrong writes on these cases go to 0, with no new wrong write and recall unchanged.
- **Next after that, each needing the owner:**
  - the current reader's reading failure (16 dev cases; a prompt change, capped paid run, measured on E3);
  - "Needs Created on an existing order" (12 cards; a display change, with Paz);
  - acceptance cards per Paz's answers.

**Started on the owner's "then begin the next phase":** step 1 of the block, in the sandbox, under every prohibition above.
