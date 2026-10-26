# Items 1-4, cut from the held patch and tested on their own (owner's item 2, 10-26)

Built in the sandbox worktree C:/Users/thera/spartan-v2-i14 from 305bf84 (production's revision). **Not deployed. Nothing
is shipped without the owner's yes.**

| diff | items | what it touches | sha256 (16) |
|---|---|---|---|
| `items-1-3-runtime.diff` | 1 owner alert, 2 replay guard, 3 zone-less time is UTC | errorReport.ts, reasons.ts, process.ts, bot/ops.ts + 3 tests | 4f33d7f261adf337 |
| `item-4-scoring.diff` | 4 scorer judges a staff-built order once | score.ts (truthKeys only) + test/scoreStrict.ts | 59ac4b0372c9d78b |

- Each diff applies alone on 305bf84 with tsc clean and its tests green. Both together: tsc and the full suite
  (`npm run test:all`, 222 test files) pass.
- Left out on purpose: the reason-code additions (quote_accepted, none_thread_history, the bare "already as asked"),
  the feed and TV code, acceptance, the parser and client resolution. Those belong to items 5-8.

## Item 1: the system's own failures email the owner (runtime)

- **Change.**
  - `systemFailureOf(decision, executed)` (reasons.ts) names four failures:
    - a write stopped part-way;
    - the bot failed on OnSinch's page;
    - a write used a contact OnSinch does not hold for its client;
    - the system could not read, plan or decide an email.
  - process.ts calls it after every record and sends route `system-failed` through the existing `reportError`.
- **Volume.** Over the stored decisions it reports 9 of 847 (10-23 copy, 13 days) and 10 of 936 (10-26 copy, 16 days):
  - 3 part-way stops;
  - 2 bot failures on OnSinch's page;
  - 2 or 3 read, plan or decide failures;
  - 2 contacts OnSinch does not hold.

  While writes are off, only the read, plan or decide failure can fire (3 in 16 days).
- **Repeats.** `reportError` keeps one fingerprint per (where, what). The four messages give at most four fingerprints,
  each mailed at most once per 6 h (DEFAULT_WINDOW_MS); further occurrences are counted, not mailed.
- **Who receives it.** The same inbox as every existing alert route. Outside Vercel it never sends (`notifyAllowed`),
  so no test or script can email anyone. The suite forces every database URL to PGlite (test/fixtures/pg.ts:13).
- **Test.** test/systemFailureToOwner.ts: the failure shapes the live data holds, each reported, and the refusals by
  rule and a booking gone not reported.

## Item 2: deciding an email again never erases what was sent for it (runtime)

- **Change.** processMessage refuses an email whose decision row holds a non-empty `executed` array, before reading
  anything: "something was sent for this email: its record stands".
- **Bug fixed.** The upsert wrote `executed` as JSON null, which `coalesce` keeps, so a replay through
  /api/bot/process replaced the record of what reached OnSinch with nothing.
- **Test.** test/replayKeepsWriteRecord.ts, against PGlite, with the reader's key removed so no model is called.
  - Without the guard it goes red: the email is decided again and its `executed` record becomes null.
  - With the guard it is refused and the record stands.
  - An email that sent nothing is still decided again.
- **Behaviour to know.** An email whose write was blocked (8 of production's 11 dev-week write decisions were blocked by
  the signed-on-crew guard) also counts as "something was sent". It can no longer be re-decided through
  /api/bot/process; replan.ts already refuses these rows. A person handles them from the card. New mail is unaffected:
  intake decides emails with no decision row.

## Item 3: an OnSinch time with no zone is UTC (runtime file, scoring effect)

**Evidence of what OnSinch's zone-less times mean** (`scripts/onsinch-zone-evidence.cjs`, on the 10-22 copy):
- **The two forms.**
  - The API writes every slot time with an explicit offset: 23,942 of 23,942 values, all `+00:00`.
  - The audit timeline writes old and new slot times with none: 3,247 values, all `YYYY-MM-DD HH:MM:SS`.
- **Comparing them.** For each slot whose beginning or end was audited, the last audited value is compared with the
  API's value for the same slot.
  - **British Summer Time (the only season where UTC and London differ):** 1,810 of 1,813 equal the API's when read as
    UTC, and **0** when read as London time.
  - The other 3 are off by -5, +1 and -4 hours, which fits neither reading. Those slots have later audit rows the Slot
    diffs do not carry.
  - GMT season (215) cannot tell the two apart.
- **So:** a zone-less audit time is UTC. This is measured on OnSinch's own data, not inferred from a platform default.

**Effect.**
- No runtime input is zone-less: every API time carries its offset, so production's planner, matcher and bot never pass
  `utcToLondon` a zone-less string.
- The fix changes what scoring code computes from audit rows:
  - `truthKeys` in week-review, score-vs-ops and the harness;
  - on any machine not on UTC (this box: America/New_York, 4 h late in BST).
- That is why eval/diagnostic-11-3.md judged 1 completed write instead of 7.

**Test.** test/zonelessIsUtc.ts runs every case in five process zones (America/New_York, UTC, Europe/London,
Asia/Kolkata, Pacific/Auckland).
- **Both 2026 clock changes:**
  - 29 Mar 00:59 UTC is 00:59 GMT; 01:00 UTC is 02:00 BST;
  - 25 Oct 00:59 UTC is 01:59 BST; 01:00 UTC is 01:00 GMT;
  - London's twice-occurring 01:30 on 25 Oct, from 00:30 and from 01:30 UTC.
- **Midnight:**
  - slot 52076's audited end, 2026-08-25 23:30 UTC, is 26 Aug 00:30 London; the API holds 2026-08-25T23:30:00+00:00;
  - 30 Jun 23:00 UTC is 1 Jul 00:00 London;
  - 31 Dec 23:30 UTC stays 31 Dec in GMT.
- **Other forms:** fractional seconds and the T form.
- **Zoned inputs read as written:** +00:00, Z and +01:00.
- **A night shift across the autumn change:** 00:00 BST to 05:00 GMT.
- **Red without the fix:** 48 checks fail.

**Limit.** London's 01:00-01:59 on 25 Oct occurs twice, so a wall-clock key cannot tell the two apart. Staff and the
bot both work in wall time. In the 10-26 copy, no slot begins or ends in that hour (0 of every slot time between
00:00Z and 02:00Z on 25 Oct).

## Item 4: the scorer judges a staff-built order once (scoring only)

- **Change** (`truthKeys`): on an order staff created, only the create (and a cancel of that order) count.
  - The create key reads the order as it now stands, so it already holds every job, shift, position and edit made while
    building it.
  - Counting those again judged equal creates "partial".
- **Corrected today.** The held patch skipped only "add shift" and "add position".
  - eval/write-breakdown.md §1 showed that "add job" and in-build slot edits still made both real creates partial.
  - So the patch's own scorer gave 6/23 completed, not the 8/23 reported at Checkpoint B.
  - With this diff, both are re-judged on the 10-26 audit copy and come out completed (extra 0, lacking 0):
    - 1a121423eac99289 (R11529: add job, a shift re-timed in the same minute);
    - 1a13af10fc5250eb (R11561: add job, a trade changed 5 minutes on).
  - With the patch's version they are partial (lacking 3 and 2).
  - The scorer now gives 8 completed, 6 partial, 9 wrong on the 23.
- **Tests** (test/scoreStrict.ts):
  - a built order with its job and in-build edits is completed;
  - a cancel of an order staff made still counts.
  - Red with the patch's version.
- **Production impact: none.** Production imports only `fullyWritten` from score.ts (app/lib/v2/metrics.ts:19), which
  is unchanged. `truthKeys`/`judge` are used by scripts/week-review.mts, scripts/score-vs-ops.mts and the harness.
- **Known limits, not fixed here** (eval/write-breakdown.md §7):
  - the create key reads the order's final state, so a later email's change to a made order makes an earlier create
    look wrong;
  - intermediate values of one slot are separate keys;
  - positions added and deleted within seconds are counted.

  These belong to the next block's scorer work.

## Assumptions

1. OnSinch's audit timeline keeps writing UTC with no zone, and its API keeps writing explicit offsets (both measured above).
2. Vercel runs the functions in UTC. Nothing in items 1-4 depends on it.
3. The alert inbox is the one the existing routes use. `reportError` never throws, and a failed send cannot fail a booking.
4. No schema, setting or data change is needed.

## Rollback

- Each diff ships as one commit through the gate, and a push to v2 deploys production.
- To roll back: revert that commit through the gate, then the push redeploys.
- **Item 1:** alerts stop on revert. The error-count rows it wrote stay and are harmless.
- **Item 2:** no state; on revert, /api/bot/process can again overwrite a run record. Never replay an executed email
  while reverted.
- **Item 3:** no production effect either way; the scoring scripts return to reading audit times in the machine's zone.
- **Item 4:** scripts only.
- **Order, if approved:** item 4 first (no runtime effect), then items 1-3. Each is checked after deploy: item 1 by the
  next system-failed decision or the health route; item 2 by POST /api/bot/process on an email with a run.
  Item 2's check is the owner's call, because the route belongs to the bot.
