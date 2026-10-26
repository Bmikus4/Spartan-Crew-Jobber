# Next block: make writes correct, measured truthfully (started 10-26)

Orchestrator. The owner, 10-26: "then once you are fully done begin the next phase". The block is
audit/checkpoint-B-response.md §7. Sandbox only, $0. **Nothing is deployed, and writes stay off.**

## N1: write judging as a committed, tested module (done in the sandbox)

**Diff:** `eval/patches/n1-write-judging.diff` (sha256 3a1e44a92b2c503d).
- It is stacked on items 1-4 (`items-1-3-runtime.diff`, `item-4-scoring.diff`), and applies to them cleanly.
- It touches app/lib/v2/score.ts, the scoring file production does not call (only `fullyWritten`, unchanged). So it
  ships, if ever, with the owner's yes on item 4.

**What it fixes** (eval/write-breakdown.md §7, faults 1-6):
- **score.ts:**
  - staff's edits count by their net effect: a PO typed then corrected is one PO, and a value moved and moved back is no
    change;
  - PO values are compared without surrounding spaces;
  - a position or shift added and deleted inside the window is dropped;
  - deleting a position that existed before the email is the cancel the system would send;
  - edits to an added part are inside its key.
- **harness/real/writes.ts:**
  - acts are read from the audit copy with Order rows keyed by number, deletes kept, and the bot and automated cancels
    left out;
  - an email's window runs 1 h before it to the first of 96 h after it or the thread's next client email the readers
    read as booking work, so a follow-up that asks nothing new does not cut it;
  - an order staff created before the email is not this email's create;
  - acts count on the readers' days;
  - orders are read as they stood when the window closed, through the time-correct world.
- **harness/real/writes-run.ts:** `npx tsx harness/real/writes-run.ts --set dev|dev-2` replays the set and judges every
  write. The output masks PO values and new venue names.

**Tests:**
- test/scoreStrict.ts gains 6 cases; with item 4 only, all 6 fail.
- test/harnessWrites.ts (new, 8 checks): number-keyed Order rows, deletes, the bot, automated cancels, and the window.

**Result on dev (27 replay writes; fresh copy, dataset b0436e50bc1bf7f4):**

| | completed | partial | wrong |
|---|---|---|---|
| the 23 assessable | **13** | 2 | 8 |
| the 4 none-derivable | 0 | 2 | 2 |

- **The module agrees with the breakdown's hand reading of the audit trail on 21 of the 23.**
  - The 8 wrong are the 7 real errors plus the reversed cancel (1a13a979194ef05f: right for its email, reversed by the
    client 3 h later, so wrong against what staff did).
  - The 2 it still calls partial are known shape limits:
    - 1a12c17f9c71e222: a PO staff entered 43 h later, for which the email gave no PO;
    - 1a1308b99b2eaf9b: the planned new shift that staff built as positions on the existing shift.
- **The scorer no longer hides the planner's errors behind its own artefacts.** What is left wrong is the work of N2.

## N2: planner op fixes (built in the sandbox; held)

**Diff:** `eval/patches/n2-planner-ops.diff` (sha256 5e15c0445f0373fb), stacked on n1.
- Files: plan.ts, reasons.ts (codes for the new hand-offs), and 2 tests.
- The four diffs apply in order on 305bf84 (items-1-3-runtime, item-4-scoring, n1-write-judging, n2-planner-ops). With
  them, tsc is clean and the full suite passes (ALL 225 TEST FILES PASS).
- **Not deployed:** plan.ts is runtime code.

| # | case | fix | test |
|---|---|---|---|
| 1 | 1a13585d743572a8 | A re-time naming crew_chief or a trade moves only those positions. A trade OnSinch books as plain crew hands off. | test/planNamedRoleRetime.ts: 6 checks, 5 red on the unfixed planner |
| 2 | 1a13fea576aeda13, 1a154d69fc48ba38 | A crew change carrying hours other than its shift's hands off (request_unsupported). | test/planCrewHours.ts: 7 checks, 5 red unfixed (with 4) |
| 4 | 1a121640a61d9b46 | Two crew counts, or two times, for one shift in one email hand off. So does the same op twice on one position (request_inconsistent). | test/planCrewHours.ts |
| 3 | 1a158a5e6bd47095 | **Not built.** "Add 3" read where the client meant 3 in all. Telling them apart needs the reading's quoted words; that is a grounding check for the next step. | |
| 5 | 1a139bb8ded24cbd | **Not built.** An availability question planned as edits. That is the reader's intent, so it belongs with the reader work. | |

## N3: re-measured on dev ($0, the fresh copy)

- **Writes: 27 → 23.** No new write appears.
- **4 now hand off:**
  - 1a13fea576aeda13 and 1a154d69fc48ba38 (both wrong before);
  - 1a121640a61d9b46 (the two-counts defect);
  - 1a134990c712db28 (unscored; a crew count with its own hours).
- **The 21 assessable writes left:** 13 completed, 2 partial, 6 wrong.
  - Shape limits: 1a12c17f9c71e222 and 1a1308b99b2eaf9b (§N1).
  - Wrong:
    - the named-role re-time: it now moves only the chief and the forklift, but staff acted after the client's next
      booking email, so their changes sit in that email's window, and their end times differ from the plan's;
    - the reversed cancel (sequencing);
    - the unmatched venue;
    - the question read as edits;
    - two trade mixes on creates.
- **Recall unchanged:** run.ts replay on dev gives 133/184, the same as HEAD. The 4 hand-offs are listed cards, so
  review_rate moves 125 → 129 of 152 items, and display precision is unchanged.
- **dev-2 is not run yet.** It is the next measurement, with fixes 3 and 5.

## Appendix: the N2 case notes as first written


Each fix is built on a synthetic case with the real case's shape, and no email text:
1. **1a13585d743572a8:** a re-time that names a role or trade is applied to the whole shift.
   - The reading: two change_times requests on 10-18, both naming trade "forklift driver" (profession 22); one also
     names crew_chief.
   - What staff did:
     - on shift 35069 they moved only the chief (51207) and the forklift driver (51215) to 07:00 London, and the forklift
       driver's end to 12:00; crew 51208 was moved and moved back, so net no change;
     - on 35068 they moved the forklift driver (51216) to 07:00-17:00, and the chief's and crew's ends to 17:00.
   - The plan moved all three positions of both shifts.
   - **Fix:** a re-time naming crew_chief or a trade moves only the role-1 positions and/or that profession's positions.
     A trade with no live profession hands off.
   - **Status:** built in the sandbox (plan.ts change_times). test/planNamedRoleRetime.ts has 6 checks; 5 fail on the
     unfixed planner. v2Plan, v2Interpret and v2WrongBookingPaths still pass.
   - **Fix 2 (items 2 and 4 here) is in progress:** a crew change carrying hours other than its shift's hands off, and
     so does a plan that changes one position twice.
2. **1a13fea576aeda13, 1a154d69fc48ba38:** an added crew or chief position ignores the requested window or length.
3. **1a158a5e6bd47095** (written in production 10-20): "add N" read where the client meant "N in all". When the reading
   cannot tell the two apart, hand off instead of writing.
4. **1a121640a61d9b46:** two size ops on one position in one plan.
5. **1a139bb8ded24cbd:** an availability question planned as edits.

Creates are left for later: a venue not matched (1a13438a3dd67400) and the trade mix (1a139bd196d4eff6,
1a13f49e6e01c4ab). They go to To Confirm, and staff rebuilt 14 of 16 bot creates historically.

### (superseded) N3 plan

- writes-run on dev and dev-2: the wrong writes above go to 0, with no new wrong write.
- run.ts replay: recall unchanged.
- The prospective set and E3 are not used.
