AGENT: harness-engineer   PHASE: 1   MODE: build, confined to new paths (see SCOPE)

GOAL: A versioned eval harness that scores the production decision code on REAL client mail
against the reader labels, per OPERATING §8 and the §13.2 metric list. Before any pipeline work
it must reproduce the live week's measured baseline (eval/live-week-reads.md).

INPUTS:
- OPERATING.md §4, §8, §13.2 and Appendix A.3: the definitions you must implement exactly.
- The existing harness: harness/README.md, harness/core/ (preflight, network lock, recorder,
  Wilson), harness/adapters/spartan/ (fake OnSinch world.ts, adapter.ts calling decideMessage).
  Reuse it. Do not edit it.
- Data (read only): C:\Users\thera\spartan-v2\.tmp-data\gold\ (messages.json, orders.json,
  timeline.json, decisions.json, readings.json, links.json, companies.json, places.json).
- Labels: eval/reads/{A,B}-{1,2}.csv, eval/reads/scripts/ (how they join and score),
  eval/reads/adjudicate.csv, and the B42 rule in decisions/2026-10-25-alignment-is-the-orchestrators.md.

BUILD:
1. A label file format (eval/harness/labels/*.jsonl, one row per email: consensus, both readers'
   fields, provisional flag) and a converter from the reads.
2. A time-correct world per email (§8.7): orders created before the email; shifts and statuses
   rolled back to the email's time using timeline.json where its rows allow it; thread history
   and links only from before the email. Count and report every case where the rollback is
   incomplete.
3. A chronological dev/test split, threads kept together, about 70/30. The test set's ids are
   locked by a hash written into the report. Tuning uses dev only.
4. Two modes:
   - score-production: production's stored decisions, scored against the labels. This MUST
     reproduce the figures in eval/live-week-reads.md exactly; that is the baseline proof.
   - replay: the stored model readings (readings.json, or decisions' interpretation) put
     through the CURRENT planner via decideMessage on the time-correct fake world, scored the
     same way. This is HEAD's baseline. It makes no model call.
5. Every §13.2 metric, per bucket, with exact intervals: silent_miss_count first. Record the
   suppression count by rule, the reason_code distribution, and cost/latency where it is
   measurable. Each report carries the git sha, the dataset hash and the labels hash.

OUTPUT: code in harness/real/; eval/harness/README.md (how to run, what each number means);
eval/harness/baseline-live-week.md (agent, brief hash, UTC time, ≤1-page summary, then both
modes' reports, and the reproduction check line by line against eval/live-week-reads.md).
Optional: one $0 test, test/harnessReal.ts, under 20 s.

SCOPE: You may create files ONLY under harness/real/, eval/harness/ and test/harnessReal.ts.
You may run `npx tsx` on your own files, and `npx tsc --noEmit`.
You may NOT:
- edit any existing file;
- read .env.local, or run anything with --env-file;
- make any network call or any model call (record mode is off-limits);
- use any production credential; the harness preflight must stay on;
- commit;
- write an email body, address, person's name or company name into any committed file.

BLOCKED: If score-production cannot reproduce a figure, stop and report the gap with the
email ids. Do not tune the scorer to match.

VERIFICATION: The orchestrator re-runs both modes, checks 10% of the reproduction lines, and
sends a separate isolation-verifier to try to make the harness leak.
