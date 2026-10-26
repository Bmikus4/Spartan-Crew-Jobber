# Verification, 2026-10-26 evening: no order writes, and the TV is current and accurate

Orchestrator. Read-only throughout:
- every database read in a READ ONLY transaction (proveReadOnly shown first);
- OnSinch through GETs only;
- the TV's own feed code run on production data with its verify and remember steps removed.

## 1. Nothing is creating or updating orders

| check | result | how |
|---|---|---|
| The Settings switch | bot_writes_enabled = false (set 10-25 13:21Z); intake on | app_settings |
| Decisions that ran a write since 10-21 | **0** | v2_decisions.executed |
| Write decisions planned since 10-21 | 28, none run | v2_decisions.kind |
| OnSinch audit rows made by the API user (2257) since 10-21 | **0** of 15,049 rows read, 10-20 18:58Z to 10-26 20:21Z | GET /timelineAudits, newest pages back to 10-21 |

The system has written nothing to OnSinch since 10-21. Every order change in that window was made by a person.

The switch above does not cover one path. `/api/confirm-order`, the old engine's one-click confirm, is left open on
purpose as a staff-driven route (app/lib/paused.ts:7, absent from lines 11 and 19), and it never reads
bot_writes_enabled. A signed-in click on one of the 16 stale `proposed` tickets would write (the system audit, §1). The
API-user count above (user 2257, the system's own OnSinch identity, ops-truth.mts:14) shows it has not been used.

## 2. The TV is current

- **The feed computes cleanly** at 21:15Z (status 200) with production's code (305bf84's app/, unchanged since 10-24).
- **A screen refreshed at 20:58:45Z.** That is the verify step, which only a TV's refresh runs. Its note: 549 new audit
  rows, 78 staff changes.
- **Intake:** 132 of 132 client messages since 10-23 have a decision. The last email was 17:30Z; it was evening, so
  intake was quiet and not stale.
- **This check wrote nothing.** My first attempt to force read-only transactions did not engage: the feed used its own
  connection. But its verify and remember steps were removed. So the only statements beyond reads were its idempotent
  create-if-absent and insert-if-absent setup lines, which every TV refresh runs. The newest feed mark is 20:58:52Z,
  before the check.

## 3. The TV is accurate: every write and hand-off since 10-23 is accounted for

- **39 write or hand-off decisions since 10-23:**
  - **12 are on the TV now.**
  - **20 resolved because the work is already in OnSinch.** The re-planner reads each row every minute and now answers
    "already booked" (15), or finds the PO or the times already as asked (5). Staff did the work.
  - **4 turned green on a staff edit and left after the 24 h dwell.**
  - **3 are reply cards ("a detail is missing") the TV does not list while the reply lane is off.** Two are from today
    (1a1772a650bb0419, 1a1780267b99e31c). This is the case the held display rule (item 8) addresses.
- **Open needs on the TV: 4.**

**Two faults found:**
1. **A system failure is shown as booking work, and was never retried.**
   - 1a144c619a140ea6 (10-23 15:41Z): "the system could not read this email (extract: OpenRouter 429)".
   - It is drawn as an open "Needs Created" card, and has been red for 3 days.
   - OPERATING §2 and §15: a rate limit must be retried with backoff and never shown to the team.
   - Item 1 (the owner alert, held) would at least have reported it.
2. **Open needs do not age.** Three hand-offs (10-13, 10-15, 10-19) have stayed red for 7-13 days with later mail on
   their threads, because no aging policy exists (audit/display-proposals.md §A, proposed at Checkpoint A). The 10-13
   one leaves on 10-27 under the 14-day undated rule.

**Accuracy against labels (prospective-1, 10-23..10-25, measured at Checkpoint B):** inquiry recall 20/24. Display
precision 82.6% strict and 91.3% broad (eval/component-assessment.md).
