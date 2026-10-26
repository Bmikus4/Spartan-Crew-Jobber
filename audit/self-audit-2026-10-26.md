# Audit of my own work on the engagement (10-24 to 10-26)

Orchestrator. **Scope:** what I built, measured and claimed under OPERATING.md: the real-mail harness, the held
patches, the measurements and reports, and how I worked. The system as a whole is a separate audit, done
independently: audit/system-audit-2026-10-26.md.

## Summary

- **Committed and working:**
  - a $0, offline real-mail harness (harness/real/, 12 files, about 1,600 lines) that rebuilds OnSinch as it stood at
    each email;
  - 1,197 blindly labelled emails across four sets;
  - a write-judging module;
  - gated pushes today: S-0228, S-0229, S-0230, plus this audit's.

  None changed production's app code.
- **Held, not deployed:** six diffs. Together the five stacked ones change 4 dev decisions, all intended, and leave
  recall unchanged:
  - p1-fixes (items 1-8, now superseded for 1-4);
  - items-1-3-runtime;
  - item-4-scoring;
  - n1-write-judging;
  - n2-planner-ops;
  - c-current-mail.
- **What the system scores on current mail** (current-reader labels, HEAD):
  - recall 90/107 = 84.1% (CI 75.8-90.5);
  - replay writes completed 10/20 on dev-2 with the stack, against 7/20 at HEAD;
  - item_correctness is far below 99%, because cards carry no change and writes are off.
- **My worst failures:**
  - seven Checkpoint B claims I had to correct;
  - local data lost through a junction delete by an agent I dispatched;
  - three privacy slips into my own session output (a client name, a subject line, a venue name), none into any file.
- **In your shoes**, the first three moves: ship the operational fixes; decide the TV rules with Paz; fund the reader
  work. All three need your yes, and I can't do any of them without it.

## 1. What exists, and its state

| piece | where | state |
|---|---|---|
| Real-mail harness: replay, time-correct world, labels, splits, metrics, production frozen as shown | harness/real/*.ts | committed. Tests: test/harnessReal.ts (20 checks). Reproduces the committed results on the rebuilt copy (dev 561/561). |
| Labelled sets | eval/harness/labels/ (live-week 400, all 799, prospective 79), eval/reads/ | committed. Two blind readers per email, a third on splits. |
| Diagnostics and reports | eval/*.md, audit/*.md | committed |
| Measurement scripts | scripts/ops-truth.mts, scripts/gold/*, scripts/onsinch-zone-evidence.cjs | committed |
| p1-fixes.diff (items 1-8) | eval/patches | held. **Stale for item 4, and superseded for items 1-4.** Items 5-8 exist only here and must be re-cut on the new stack before they could ship. |
| items-1-3-runtime + item-4-scoring | eval/patches | held. Full suite green. |
| n1-write-judging (write judging) | eval/patches | held with item 4 |
| n2-planner-ops (named-role re-time; crew change with its own hours or two counts hands off) | eval/patches | held |
| c-current-mail (venue matching; the bot's own runs counted; failed reads retried) | eval/patches | held. The 5-diff stack applies on 305bf84 in order; on it, tsc and all 227 test files pass. |

## 2. Code cleanliness of my work

**Good:**
- Every behaviour change has a test built from the real case's shape, red on the old code: 8 new test files and 1
  extended, 159 checks in all.
- Comments state the constraint and the case that set it, as CLAUDE.md asks.
- Masking (PO values, new venue names) is in the output code, not left to discipline.

**Not good:**
1. **plan.ts keeps growing.** It is 852 lines at HEAD, and my stack adds about 90. Venue resolution (placesFor plus my
   rule) and crew/time changes are each a module waiting to be split out. I added to the debt rather than paying it.
2. **Audit rows are turned into acts in two places:** scripts/ops-truth.mts:55-75 and harness/real/writes.ts actsOf.
   The harness copy handles deletes, the bot split and automated cancels; the script's copy does not. They will drift.
   ops-truth should import actsOf.
3. **The six diffs are fragile.** Each is a text diff against a moving main, and three touch plan.ts. The longer they
   wait, the more each rebase costs. The p1-fixes.diff copy of item 4 is wrong (eval/write-breakdown.md §1), so anyone
   applying that file whole gets the old scorer.
4. **The regenerated-input pin in reproduce.ts.** Four baseline figures are shown, not gated, while the regenerated
   week-review files' hashes match. It is honest and narrow, but it is a workaround for lost data.
5. **Sandbox worktrees with junctions remain** (spartan-v2-p1, -i14, -n1, -n2s). They are the exact hazard of the
   10-26 incident. They are kept on purpose, because the held work lives in them, and only I may remove them, with
   verified unlinks (memory rule).
6. **Throwaway scripts in .tmp-v2/** are gitignored and some duplicate queries. Harmless, but the useful ones (the TV
   check, the read-only order-write check) should become committed scripts.

## 3. What works (measured)

- **Production is safe:**
  - writes off at the Settings switch. One old path, `/api/confirm-order`, sits outside it (found by the system audit;
    checked: app/lib/paused.ts:7-19). Shutting it is that audit's change 2;
  - 0 runs since 10-21;
  - 0 OnSinch rows by the API user since 10-21 (15,049 read, audit/verification-2026-10-26.md).
- **The TV is current** (a screen refreshed 20:58Z; 132/132 emails decided). Every write or hand-off since 10-23 is
  accounted for.
- **The harness is reproducible:** production as shown, 847/847 and 936/936 rows, identical after the data loss.
- **OnSinch's zone-less audit times are UTC:** 1,810/1,813 in summer time, 0 as London. Tested across both clock changes.
- **Write judging now agrees with a hand reading of the audit trail on 21 of 23 dev writes.** Six scorer faults are
  fixed; item 4 among them.
- **Planner fixes:** 4 dev writes that were wrong or defective now hand off. 1 dev create now books the client's
  venue. No new write appears, and recall is unchanged.

## 4. What does not work, or is not done

- **The current reader's misses are untouched.** 7 of the 17 current-reader misses are "nothing asked for" readings;
  9 of the old reader's 11 recur with the current one. The fix is a prompt change, which needs your yes and a paid run.
- **7 of the 17 current-reader misses are reply cards the TV does not list.** The fix is a display change, which needs
  you and Paz.
- **Writes on current mail:** 8 of 20 dev-2 replay writes are still wrong:
  - create shapes 3;
  - creates' crew mix or venue 3;
  - the chief rule 1;
  - a cancel 1.

  Creates go to To Confirm, so staff complete them. Edits would run live.
- **item_correctness stays near 4-5%,** because cards carry no change. Only writes or a tick that changes OnSinch can
  move it. Both are your decisions (Q1).
- **The venue rule** fixes the place on 2 of the 4 cases it was built from. The other 2 would need the client's words
  plus a person.
- **No daily shadow comparison yet.** OPERATING §14 recommends one before unattended running, and nothing runs the
  stack beside production on new mail.
- **Evidence windows:** W2 (10-26..10-28) is not labelled yet. E3 (from 10-29) must stay untouched until a fix is
  frozen.

## 5. How I worked: what went wrong

1. **Seven Checkpoint B claims were wrong:**
   - item 4's completion count;
   - crew-chief "within 4%";
   - "the dev misses are the old reader's";
   - "no current-reader set to tune on";
   - "0 silent reply cards";
   - "3 of 4 acceptances";
   - "the prompt changed".

   **Root cause:** figures came from one-off scripts (deleted after use) and hand counts, not from committed, tested
   code. Twice it was the same trap: Order rows keyed by number. N1 fixes this for writes. The rule I now hold: a figure
   in a report is produced by committed code with a test, or it is labelled a hand reading.
2. **Local data loss:**
   - **Cause:** an agent I dispatched removed worktrees whose junctions pointed into the main checkout.
   - **Recovered:** the results reproduce on a fresh copy.
   - **Prevention:** memory rule, a backup outside worktrees, and no subagent ever removes a worktree.
3. **Privacy slips into my own session output:** a client company name, an email subject line and a venue name, each
   in a log tail or a debug print. None reached a committed file. Every log I read is now filtered first.
4. **Rule breaks:**
   - I edited a script while a gate ran (outside its pathspec, type-safe, but against my rule);
   - my first read-only wrapper for the TV check silently did not engage. The check still wrote nothing (verified),
     but I only learned that afterwards.

## 6. If I were you

Ranked by value for the risk taken:

1. **Ship the operational fixes:**
   - the owner alert on the system's own failures;
   - the replay guard;
   - the retry of failed reads (C3);
   - the scorer and zone fixes (no runtime effect);
   - shut the old `/api/confirm-order` write path (the system audit's change 2, one line and a test, not yet built).

   **Why:** they stop the system's own failures reaching staff (OPERATING §2, §15), and they change no decision.
   **Effort:** cut and tested; about a day including a deploy check. **Risk of not doing it:** the next rate limit sits
   on the TV for days again, unseen by you.
2. **Decide the TV rules with Paz** (the draft is ready: audit/paz-acceptance-examples.md):
   - reply cards that ask for crew are listed;
   - no "Needs Updated" without an order;
   - a system failure is its own chip;
   - quote acceptances in three kinds;
   - old needs age.

   **Why:** on current mail, half the misses (7 of 17) are reply cards staff never see, and the worst misleading card
   is "Needs Created" on an existing order (11 dev, 1 current). **Effort:** built for the most part (items 5-8); a
   re-cut and Paz's answers. **Risk of not doing it:** silent work, and duplicate orders.
3. **Fund the reader work with a cap:**
   - a prompt change for "no change asked for", designed on the 16 dev cases;
   - measured once on E3 (mail from 10-29, about 2-3 weeks to reach about 100 inquiries).

   **Why:** it is the other half of current-reader misses, and no code rule can see it (eval/reader-diagnostic/).
   **Effort:** a day plus about $1-3 of model calls. **Risk of not doing it:** recall stays near 84%.
4. **Keep writes off until a shadow window says otherwise, per class.**
   - The least-risk classes are PO set and a whole-shift re-time; 0 wrong in at least 368 ops would bound the error
     under 1%.
   - Decide Q1 (may it book directly?) and Q3 (crew notices: an admin can read the setting at $0).
   - **Risk of turning writes on early:** the one production harm found (an extra crew chief, 10-20) repeats.
5. **Rule on the crew-chief question with Paz:** does a client's "add 3" to a shift of 1 get a chief? It is the only
   wrong write that reached production, and the rule decides it, not the code.
6. **Let me build the daily $0 shadow comparison:** the stack beside production on each day's mail, nothing written.
   **Why:** it is the only route to evidence near 99% (§14). **Effort:** about a day; no approval is needed to build
   it, only to act on it.
7. **Housekeeping, and the debt it removes:**
   - back up the data snapshots off this machine (it is failing, per memory);
   - split plan.ts;
   - retire the paused old engine's code paths.

## 7. Open decisions waiting on you

1. Items 1-4, C3, and shutting `/api/confirm-order`: ship?
2. Paz: send the draft; then items 5-8 and the TV rules.
3. A capped paid reader run.
4. The crew-chief question.
5. Q1: book directly, and what a tick should do.
6. Q3: an admin reads OnSinch's notification settings.
7. A display_precision floor, after the two task definitions in eval/component-assessment.md.
