# Evidence index and current state (owner's item 1, 10-26)

Orchestrator, 2026-10-26, about 13:00Z. **Verified** means re-read today, with how. **Remembered** means carried from
an earlier session and not re-checked today.

## Current state

| fact | value | status, and how |
|---|---|---|
| HEAD | 305bf84 (local branch v2, tracking origin/main) | verified: `git rev-parse`, `git ls-remote origin refs/heads/main` = 305bf84 |
| Deployed revision | 305bf84 | verified two ways: GitHub deployment 7323455337, environment Production, Vercel status "success" 03:33Z; and production's 14 decisions on 10-26 carry code_version 305bf84. Vercel's own API refused this account (team scope), so not read there. |
| App code in production | unchanged since 6a98170 (10-24 03:25Z) | verified: `git log -- app/` and `git diff 569d4bb 305bf84 -- app/` is empty. The four engagement commits (90529c9, bdf29fb, 569d4bb, 305bf84) changed only eval/, harness/, scripts/, audit/ and tests. |
| Production reader model | openai/gpt-6.1-sol | verified: the model OpenRouter returns, stored on every decision; first 10-16 07:00:44Z, still on 10-26. The last anthropic/claude-opus-4.8 reading was 10-15 19:24:50Z. The code default at HEAD is the same; whether SPARTAN_INTERPRET_MODEL is set on Vercel cannot be read, but the stored rows settle it. |
| Production prompt id | extract@f3e1a862322b | verified: stored on every decision since 10-13, and computed from extract.ts at HEAD. **Correction:** eval/iterations.md says "the prompt changed again on 10-20 and 10-23". The reader's prompt did not change; the planner and the checks after the reading did (17ebdc6 10-20, 0f2dcef 10-22, fb01342 10-23). |
| Model switch commit | 275c296, committed 10-16 03:35Z (10-15 23:35 local) | verified: git |
| Writes | bot_writes_enabled = false (app_settings, updated 10-25 13:21Z); 0 decisions with a run since 10-21 | verified: read-only query |
| Intake | intake_paused = false; 18 client messages on 10-26, all decided | verified: read-only query. The n8n workflows active: remembered (10-25). |
| What of the harness work is live | nothing | verified: no file under app/ imports harness/ (2 mention it in comments). harness/, eval/ and scripts/ are deployed as files but never run in production. The two truth-script fixes (ops-truth.mts, gold/truth.mts) are scripts. |
| The held patch | not deployed | verified: app/ identical to 6a98170 |

## Paths

**Prospective set (clean at Checkpoint B; inspected since, so now dev and regression evidence):**
- ids and frozen labels: eval/harness/labels/prospective.jsonl (79 emails, 24 B42; sha256 6a9d545a23025055)
- the lock: eval/harness/labels/split-prospective.json (all 79 test, test_hash 7f277f8725036c76)
- blind reads: eval/reads/A-5.csv, B-5.csv (two readers, brief 76fe3b9c); third reader on the 4 splits: eval/reads/V-v3.csv
- case-level results: eval/harness/checkpoint-b/prospective-prod.json, -head.json, -nodisp.json, -patch.json (each with .md)
- production as shown: eval/harness/production-shown-gold-1026.jsonl (936 rows)
- the data copy: .tmp-data/gold-1026 (local, not in git; taken 10-26 02:19:43Z, read-only)

**Dev sets and their provenance:**

| set | file | emails / B42 | decided by the old reader / by the current | tuning |
|---|---|---|---|---|
| dev | labels/all.jsonl + split-all.json dev | 561 / 184 | 480 (166 B42) / 81 (18 B42) | tuned on, iterations 1-5 |
| dev-2 (first called "test") | split-all.json test (hash d2790450e2c9ae4f) | 238 / 69 | 5 (4) / 233 (65) | tuned on (red-team-B H1: 60 overlap, 29 fires) |
| live-week | labels/live-week.jsonl + split.json | 400 | (within dev and dev-2) | tuned on |
| prospective-1 | above | 79 / 24 | 0 / 79 | scored once at Checkpoint B, then inspected |

- Reads: eval/reads/A-1..A-4, B-1..B-4, V-v, V-v2, settled.csv, adjudicate.csv.
- Production as shown: eval/harness/production-shown.jsonl (847).
- Copy: .tmp-data/gold (taken 10-23 01:45Z).
- **"Old reader"** = anthropic/claude-opus-4.8; **"current"** = openai/gpt-6.1-sol, by each decision's created_at against
  10-16 07:00:44Z.
- **Correction:** Checkpoint B said a reader change had "no clean set to tune on until current-reader mail is labelled".
  That was wrong. 314 labelled dev and dev-2 emails (83 B42) were read by the current reader, beside prospective-1's 79
  (24 B42). That makes 107 labelled current-reader inquiries now usable as dev evidence (eval/dev-windows.md).

**The held patch:**
- eval/patches/p1-fixes.diff: 25 files, sha256 d15def153dd09665, base 569d4bb (app/ identical to 305bf84);
- sandbox worktree C:/Users/thera/spartan-v2-p1, branch sandbox/p1-fixes;
- items 1-4 cut out of it today: eval/patches/items-1-3-runtime.diff and item-4-scoring.diff (eval/patches/items-1-4.md).

**Red team B2, in full:**
- the hits: audit/red-team-B2.md (217 lines, complete in the repo);
- my answers: audit/final-state.md, "Red-team hits and answers", B2-1..B2-12.

Today's checks change four answers:

| hit | answer at Checkpoint B | status after today |
|---|---|---|
| B2-2 dev misses are a replaced reader's | confirmed; the reader lever was deferred to a new dev window | **overturned:** the current reader still misses 9 of those 11 (eval/reader-diagnostic/results.md). And dev-2 is current-reader mail. |
| B2-5 Blocked did not hold | item_correctness measured: 8/152, 8/216 | **corrected:** the patch's scorer fix was incomplete, and its own output was 6/23 complete, not 8. Fixed today (item-4-scoring.diff): both creates re-judged completed on the audit data, so the scorer now gives 8/23. |
| B2-10 stale statements | corrected throughout | **more found:** "crew-chief errors within Ben's 4%" is wrong on the facts (eval/write-breakdown.md §5); R11546 was a bot create staff deleted, not a quote order staff amended; the prompt did not change 10-20/10-23 |
| B2-11 subset untested | to be cut and tested on a yes | **done:** cut and tested (eval/patches/items-1-4.md) |

The other eight answers stand as written.

## Other files from today
- eval/write-breakdown.md: the 27 writes case by case (owner's item 3)
- eval/component-assessment.md, audit/paz-acceptance-examples.md: items 5-8 (owner's item 4)
- eval/reader-diagnostic/: the $0.1485 re-read (owner's item 5)
- audit/workflow-proposal.md: workflow and safety (owner's item 6)
- eval/dev-windows.md: evaluation windows (owner's item 7)
- scripts/onsinch-zone-evidence.cjs: what OnSinch's zone-less times mean
