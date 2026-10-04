# SpartanCrew Enquiry Engine — repo rules

## The session gate

`scripts/session.py` is the only sanctioned `git commit` and `git push` in this repo.

```
python scripts/session.py -m "one line, a fact about the software" \
       --headline "what moved" -- app/lib/engine/venueMatch.ts test/venuePoolExcludes.ts
```

It confirms (`npx tsc --noEmit`, then `npm run test:all`), appends one ticket to
`public/data/feed.json`, then commits by pathspec and pushes. It stops at the first
failure and writes nothing when it stops. Never hand-commit past it.

`python scripts/session.py --self-test` proves the gate can still go red. A gate nobody
has watched fail is a gate nobody has reason to believe; re-run it whenever the runner
or the confirm step changes.

**The suite is `npm run test:all`, not `npm test`.** `npm test` is `tsx test/run.ts` and
runs exactly one file. The discovery runner is `test/all.ts`, which finds every test file itself. Three handoffs
have claimed "117 test files, `npm test` ALL PASS" — that sentence names a command which
does not run them.

**A number that moved without a ticket explaining it is a regression.** All measured data
goes into the one feed, never a directory of dated files. Old entries may be thinned to
their headlines; they are never rewritten and never deleted. A measurement script writes
`.tmp-data/gate-measurements.json` and the gate folds it into the ticket and deletes it,
so one number can never be carried twice and read as two confirmations of itself.

Read `public/data/feed.json` before trusting any figure quoted in a handoff. Ticket
`S-0001` is there because a figure withdrawn on 2026-09-03 was still being planned
around on 2026-09-28: the retraction lived in two files and lost to a one-line summary.

## Invariants — do not "tidy" these

- **`unreconciled` and `unactionable` are different claims.** One is a fact about OnSinch,
  the other a fact about the engine's own record. Collapsing them loses the only signal
  separating "OnSinch refused" from "we never asked".
- **A decline is not a failure, and it is also not a success.** `amendOrderInPlace`
  declining every block is deterministic: never retried on a timer, never logged as an
  amend.
- **Never write `Job.min_beginning` / `max_end`.** The rule stands; the REASON given for it
  no longer does. It was "the window is derived — it is the envelope of the blocks". Measured
  2026-09-29 on reference order #16317: after positions were added by hand on 2026-10-01, the
  job window still read 2026-12-07 08:00..20:00. So the envelope is not recomputed on at least
  some events, and the field can be **stale**. It is a cache, or create-time only, or derived
  from something other than positions — undetermined.
  The consequence is not academic: drift detection compares a desired window against the job's,
  so "window drift" may sometimes be a stale field rather than a real disagreement, and six of
  eight live amendment refusals were window-drift cases. **Treat the window as unreliable
  input, not as truth**, until somebody establishes which events recompute it.
- **`6922 "No Location"` is exempt from every venue phase.** Exactly one may exist, and
  the compiler finds it by name — the id is incidental.
- **Zero references is permission to delete, never a reason to.**
- **FOUR, AND ONLY FOUR order labels** (`app/lib/mail/gmailWrite.ts`). They are mutually
  exclusive because a thread wearing "Order Built" and "Order Needs Built" together says
  the work is both done and outstanding. Conversation state — follow-up — is a different
  axis and must not join that set.
- **A draft is not a message.** An unsent Gmail draft of ours must never count as Spartan
  having replied; counting one inverts who is waiting for whom, and that fact cannot be
  rebuilt afterwards.
