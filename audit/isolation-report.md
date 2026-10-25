# Isolation report: the real-mail harness

Agent: isolation-verifier. Brief hash: e102bf03. Written 2026-10-25T23:00Z (runs 22:52Z to 22:58Z).
Branch v2, HEAD 569ed27 (the tree is dirty). The harness under test (harness/real/, eval/harness/) is untracked. Another session edited it three times during this check, so the verdict holds for these file hashes (sha256, first 16 hex characters):
data.ts ed9529b4a2b02a05, labels.ts 941f61d86186be49, metrics.ts 1ad3e94a4af50398,
replay.ts ff4ea22a9eaec8e3, reproduce.ts a60937c5f3d67d72, run.ts e876684a736b1045, split.ts 3165845c934e96c9,
stats.ts 99f3e3ef6aefcec6, system.ts 7a2b0dc3350d17d3, world.ts 0c2269dea9007d7b, harness/core/preflight.ts
68de9731925c4362, test/harnessReal.ts b67afb035febf606. Any later edit needs a fresh check.

## Summary

**Verdict: ISOLATED.** I found no leak. No harness run reached the network, the database, OnSinch, Gmail, n8n or a model. No run wrote anything outside `eval/harness/runs/` (gitignored), apart from tsx's own compile cache in %TEMP%. One control does not work as the brief requires (attempt 1, score-production), and three other gaps are listed below. None is a leak today.

How I checked: every harness process ran under a tripwire preload (`.tmp-v2/iso/tripwire.mjs`). It blocks and logs every socket connect, TLS connect, DNS lookup, http/https request, WebSocket and fetch, and it logs every child process and every file write. A control run (`control.mjs`, `control2.mjs`) showed that it blocks Node's native fetch at tls.connect, below any fetch patch. I also checked reachability statically. An esbuild bundle of `harness/real/run.ts` with tree shaking (`reach.mjs`) keeps no database call, no OnSinch transport, no model call, no browser launch, no bot writer, no error-report webhook and no fetch call. The same holds for `test/harnessReal.ts`.

| # | attempt | result |
|---|---|---|
| 1 | Planted fake credentials | **replay refuses (exit 1)** for each of the 13 listed names alone, for both together and for a lowercase name. **score-production does NOT refuse:** it exits 0 with planted DATABASE_URL and ONSINCH_API_KEY, because that mode never calls the preflight. It made no network attempt. Replay also starts with 15 unlisted credential names planted, and it made 0 network attempts across 568 runs. |
| 2 | Network-capable modules | 69 first-party files are in the import graph. Every sink in them is replaced by a fake, is never called, or is both, and none survives tree shaking. The fetch lock is a second layer for fetch only. |
| 3 | Faults in a scratch harness | Over 9 broken-dependency variants × 40 dev emails, no fetch was attempted. decideMessage never falls back to a production dependency. A deliberately mis-wired production world made 7 fetches: the lock refused all 7, and with the lock off they reached tls.connect (stopped by the tripwire). Isolation therefore rests on the wiring plus the lock. |
| 4 | Outbound mail | No draft, send or label path is constructed. 37 files match a mail pattern: 34 are outside the graph, and the 3 inside it match only in comments. The alarm-email webhook is tree-shaken and was never called, even with the send flags set. |
| 5 | Files written | The tripwire logs show the only repo writes were `eval/harness/runs/all-{replay,score-production}-dev.{md,json}`. The git status diff shows one new path, `eval/harness/baseline-all.md`, which another session wrote and none of my processes did. |

Gaps. None is a leak; each weakens a guarantee that §8.1 says must hold by construction.
- **G1, attempt 1 fails for score-production.** `harness/real/run.ts` calls `preflight` only inside `replay()` (`harness/real/replay.ts:58`). The score-production branch (`run.ts`, `mode === "score-production"`) never checks the environment. eval/harness/README.md:20 says "the preflight refuses a process that holds any production credential", but that is true for replay only. Fix: run `preflight` and `closeNetwork([])` in `main()` before either mode.
- **G2, the preflight's list is incomplete.** `PRODUCTION_SECRETS` (`harness/core/preflight.ts:13-18`, 13 names) leaves out at least 15 credential or endpoint names the app reads, listed under attempt 1. A process holding any of them passes the preflight.
- **G3, the lock covers fetch only.** `closeNetwork` (`preflight.ts:32-39`) and the `netAttempts` counter (`replay.ts:63`) see only `globalThis.fetch`. The following are not covered: node:http/https, raw sockets, WebSocket and child processes, including Playwright Chromium (`app/lib/v2/bot/browser.ts:57,62`), which is a separate OS process. None is reachable today. Nothing stops a future import from bringing one in.
- **G4, decideMessage has no guard of its own** (`app/lib/v2/process.ts:323-327`, by design: "There is no test branch here"). Handed production's world, it fetches (attempt 3). So G1 and G3 are the controls that matter.

## Attempt 1: run with planted fake credentials

Every planted value is fake: `postgres://planted.invalid/x` for URLs and `planted` for everything else. No `--env-file` was used. Before the runs, the shell held none of the 13 listed names (I printed names only).

1a. The brief's command, replay:
```
DATABASE_URL=postgres://planted.invalid/x ONSINCH_API_KEY=planted npx tsx harness/real/run.ts --mode replay --set dev
```
Exit 1. Stderr: `preflight failed: no production credentials loaded (present: DATABASE_URL, ONSINCH_API_KEY)`. Stdout: 0 bytes. Under the tripwire (log `trip-a1-replay.json`): 0 network attempts, child processes `git rev-parse HEAD` and `git status --porcelain` (local; the worktree index mtime was unchanged by `git status`), 0 repo writes. The refusal comes after labels, split and hashes are loaded but before the first email.

1b. The same with `--mode score-production`: **exit 0, no refusal.** It wrote `eval/harness/runs/all-score-production-dev.{md,json}`. Under the tripwire (`trip-a1-sp.json`): 0 network attempts, git only, no other writes. This is G1.

1c. Each of the 13 listed names planted alone, for replay (`env "$k=$v" node --import tsx harness/real/run.ts --mode replay --set dev`): 13 of 13 exit 1, each naming the planted variable. A lowercase `database_url` is also refused (exit 1), because Windows environment names are case-insensitive.

1d. Replay with 15 unlisted credential or endpoint names planted: OPENROUTER_API_KEY, STORAGE_POSTGRES_URL, GMAIL_SA_PRIVATE_KEY, GMAIL_SA_CLIENT_EMAIL, GOOGLE_CLIENT_SECRET, GMAIL_OAUTH_CLIENT_SECRET, ONSINCH_SERVICE_API_KEY, ONSINCH_TEST_KEY, MAIL_INBOUND_SECRET, CRON_SECRET, ADMIN_SECRET, SESSION_PASSWORD, ERROR_REPORT_WEBHOOK, GMAIL_DRAFT_WEBHOOK and MANUAL_TAG_WEBHOOK. The URL values were `https://planted.invalid/...`. Five channel switches were planted with them: ONSINCH_BASE_URL, VERCEL=1, SPARTAN_ERROR_NOTIFY=1, SPARTAN_WRITES=live and SPARTAN_ENGINE=v2. Result: exit 0, preflight "ok, none of 13 present", 568 runs, "Network requests attempted: 0. Model calls: 0". Tripwire (`trip-a1d-replay.json`): 0 network attempts. The names came from a grep of every `process.env.X` in app/, lib/ and scripts/ (89 distinct names). This is G2. OPENROUTER_API_KEY is left off the list on purpose for recording mode (`preflight.ts:26` allows only openrouter.ai), but replay allows no host and could refuse it.

## Attempt 2: modules that could make a network call

Graph: `node .tmp-v2/iso/graph.mjs harness/real/run.ts` lists 69 first-party inputs and 4 network-capable packages: @neondatabase/serverless, next/server, playwright-core and @sparticuz/chromium. `test/harnessReal.ts` has the same 69. No first-party file imports node:http, https, net, tls, dgram, ws, undici or worker_threads (grep over the 69 matched comments only). The tripwire therefore sees everything, because it patches the main thread.

| sink | where | in a harness run | reachable from the entry? |
|---|---|---|---|
| Model call (`extractWithMeta`, fetch) | app/lib/v2/interpret/extract.ts:109, :114 | **fake:** `extract` returns the stored reading or throws (replay.ts:120) | no (tree-shaken) |
| OnSinch API (`httpTransport` -> fetch) | app/lib/engine/onsinch.ts:26, :83; built in process.ts:85 (`onsinchWorld`), links.ts:46, bot/run.ts:31, bot/apiCreate.ts:40 | **fake:** `world` is `TimeWorld` (replay.ts:104, :124); **lock:** refused (attempt 3) | no |
| Database (`neon()`) | process.ts:50, settingsDb.ts:19, bot/db.ts:25, errorReport.ts:257 | **fake:** `record` holds the row in memory (replay.ts:135), `threadOrderId`, `thread`, `prior` and `threadMessages` are in memory; the preflight refuses DB URLs; the driver resolves `fetch` at call time (`(k??fetch)` in @neondatabase/serverless index.mjs), so the lock applies | no |
| Bot writer (`runOp`: OnSinch UI login, Chromium, API create) | bot/run.ts:251, session.ts:44 and :87, browser.ts:49, :57, :62 | **fake:** `run` is a recorder that answers "verified" (replay.ts:132); a browser is a separate process that **no lock covers** (G3) | no |
| Thread links (`recordLink`, `linkFound`, `linkedOrderId`) | links.ts:57, :74; threadOrder.ts:16 | **fake:** `link` is a no-op (replay.ts:134) | no |
| Error alarm (`reportError` -> webhook -> mail) | errorReport.ts:320 (DEFAULT_WEBHOOK), :336, :373; callers settingsDb.ts:80, pipeline.ts:643, :1640 | never called; also gated by `notifyAllowed` (errorReport.ts:159-162) | no |
| Settings (`getSettings`) | settingsDb.ts:73; called by process.ts `botWrites` and `processMessage` | never called (replay passes no `leadDays`) | no |
| git | harness/real/data.ts:45-46 | `git rev-parse` and `git status`: local, read-only | yes, local only |

Tree shaking (`node .tmp-v2/iso/reach.mjs harness/real/run.ts .tmp-v2/iso/bundle-run.mjs`) found all 15 sink patterns absent from the bundle: neon(, fetch(, httpTransport(, chromium.launch, openBot/launchBrowser, runOp(, extractWithMeta, reportError, onsinchWorld(, getSettings(, recordLink/linkFound, the model host, the n8n host, the OnSinch host and Gmail. The bundle keeps the `import` lines of neon, next/server `after` and playwright-core `chromium`, but no code uses those bindings. Importing those packages made no network attempt (tripwire, attempts 1 and 5).

## Attempt 3: faults, in a scratch copy

Nothing in the repo was patched. `.tmp-v2/iso/a3-faults.ts` imports production's `decideMessage` unchanged and feeds it the first 40 dev-set client emails that have a stored reading, using the harness's deps with one fault at a time. It ran under the tripwire with `TRIP_KEEP_FETCH=1`, so `globalThis.fetch` was Node's real fetch, and with ONSINCH_BASE_URL=`https://planted.invalid/api`. Only counts are printed.
```
TRIP_LABEL=a3 TRIP_KEEP_FETCH=1 node --import ./.tmp-v2/iso/tripwire.mjs --import tsx .tmp-v2/iso/a3-faults.ts
```
| variant (lock on unless stated) | outcomes | fetch calls | below-fetch attempts |
|---|---|---|---|
| control: deps as replay.ts wires them | handoff 14, none 25, write 1 (writer stub called 1) | 0 | 0 |
| fake world throws synchronously | handoff 21, none 19 | 0 | 0 |
| fake world rejects | handoff 16, none 24 | 0 | 0 |
| fake world has no methods | handoff 16, none 24 | 0 | 0 |
| extract throws / extract missing | handoff 40 / handoff 40 | 0 | 0 |
| threadOrderId throws | handoff 40 | 0 | 0 |
| run undefined | handoff 14, none 25, write 1 (writer called 0) | 0 | 0 |
| every optional dep removed, run null | handoff 14, none 25, write 1 (writer called 0) | 0 | 0 |
| only `record` and `trace` given | handoff 40 | 0 | 0 |
| MIS-WIRED: production `onsinchWorld()`, lock on (3 emails) | handoff 1, none 2 | 7, all `harness isolation: refused a request to planted.invalid` | 0 |
| MIS-WIRED: production `onsinchWorld()`, lock off (3 emails) | handoff 1, none 2 | 7, `fetch failed` | **7 x tls.connect planted.invalid** (blocked by the tripwire) |

No variant threw. When the fake fails or a dependency is missing, the email becomes a handoff (process.ts:374-378, :436-440, :458). `decideMessage` never substitutes a production dependency. The only constructor of production deps is `processMessage` (process.ts:488-520), and the harness does not reach it. The last two rows show that a wiring mistake would reach the network if the lock were off. When the lock is on, `run.ts` exits 1 with "REPLAY ISOLATION BROKEN" on any fetch (`run.ts:120`, `:128`).

## Attempt 4: outbound mail paths

37 files match a draft, send, label or webhook-to-mail pattern (grep for drafts, messages/send, users/me/messages, addLabelIds, modify, GMAIL_DRAFT_WEBHOOK, MANUAL_TAG_WEBHOOK, gmail.googleapis, nodemailer and resend over app, lib and scripts). They include app/lib/mail/* (10 files), app/lib/v2/draft.ts, app/api/bot/labels/route.ts, app/lib/n8nInbound.ts and the n8n workflow installers. Of the 37, 3 are in the harness graph: app/lib/engine/pipeline.ts:302, app/lib/engine/types.ts:520, :542 and app/lib/v2/bot/builder.ts:12, :158, and all of those matches are comments. No app/lib/mail file is in the graph (0 of 69). The bundled harness has no draft, send or label code; the only "gmail" string left is a consumer domain in a list. The one mail-capable path in the graph is the error alarm (errorReport.ts:336, a webhook whose workflow sends mail). It is tree-shaken. With VERCEL=1, SPARTAN_ERROR_NOTIFY=1 and a planted ERROR_REPORT_WEBHOOK it was still never called: 0 attempts over 568 runs (attempt 1d).

## Attempt 5: files written by a run

Before: `git status --porcelain --untracked-files=all` (44 lines) and a manifest of path, size and mtime for 1,661 files (`node .tmp-v2/iso/manifest.mjs`, which skips node_modules and .git), both at 22:52:11Z. After: 22:56:49Z. Other sessions were writing to the same tree during this window, so the authority on what a harness process wrote is the tripwire's per-process write log:
```
TRIP_LABEL=a5-replay node --import ./.tmp-v2/iso/tripwire.mjs --import tsx harness/real/run.ts --mode replay --set dev
TRIP_LABEL=a5-score-production node --import ./.tmp-v2/iso/tripwire.mjs --import tsx harness/real/run.ts --mode score-production --set dev
node .tmp-v2/iso/sum.mjs .tmp-v2/iso/trip-*.json
```
- Replay: exit 0, 568 runs, "Network requests attempted: 0. Model calls: 0", tripwire 0 network attempts. Writes: `eval/harness/runs/` (mkdir), `all-replay-dev.md` and `all-replay-dev.json`. Child processes: git rev-parse and git status only.
- Score-production: exit 0, 0 network attempts. Writes: `eval/harness/runs/all-score-production-dev.md` and `.json`. Child processes: git only.
- Across all 6 harness and fault processes I ran, every write landed in `eval/harness/runs/` or `%TEMP%\tsx-<user>\` (tsx's compile cache).
- The git status diff before and after is one line, `?? eval/harness/baseline-all.md`, inside eval/harness/ and written by another session (it is in no tripwire log). The manifest diff also shows changes from other sessions: `.tmp-v2/diag/*`, `eval/harness/README.md`, `baseline-*.md`, `harness/real/run.ts`, `replay.ts`, `test/harnessReal.ts` and `tsconfig.tsbuildinfo` (gitignored, mtime 22:54:25Z, 4 s after replay.ts was saved; none of my processes ran tsc). None of them is in any tripwire log.
- My runs overwrote `eval/harness/runs/all-{replay,score-production}-dev.*`. These are the harness's designated outputs, gitignored, and every run rewrites them (eval/harness/.gitignore).
- I ran the test set and `--set all` at no point; every run used `--set dev`.

Scratch files kept in `.tmp-v2/iso/` (gitignored) so the orchestrator can reproduce these results: tripwire.mjs, control.mjs, control2.mjs, graph.mjs, reach.mjs, a3-faults.ts, manifest.mjs, sum.mjs and the trip-*.json logs. Everything else was deleted.

---

## Orchestrator addendum, 2026-10-25: the three gaps are closed and re-verified

- **G1, score-production started with planted credentials.** It now runs the same preflight and closes the network (harness/real/run.ts).
- **G2, the preflight's list of 13 names was stale.** It now refuses any variable whose NAME has the shape of a credential (harness/core/preflight.ts `CREDENTIAL_SHAPE`). Two exceptions:
  - the agent runner's own `CLAUDE_CODE_*`;
  - `OPENROUTER_API_KEY`, and only while record mode's model host is open.
- **G3, the lock covered `fetch` only.** It now also refuses `http`/`https` requests, `net`/`tls` sockets and every `child_process` call to a host not allowed.

**Re-verified by the orchestrator:**
- **Attempt 1:** both modes, with `DATABASE_URL`, `STORAGE_POSTGRES_URL` and `ERROR_REPORT_WEBHOOK` planted as `*.invalid` values, exit 1 with "present: DATABASE_URL, ERROR_REPORT_WEBHOOK, STORAGE_POSTGRES_URL".
- **Clean runs** exit 0 with unchanged figures: production 64 and replay 53 silent misses on dev.
- **Attempt 5:** `git status --porcelain` is identical before and after a replay run.
- **Tests:** `test/harnessReal.ts` and `test/harnessGate.ts` pass.
- **Still true:** `decideMessage` has no guard of its own (G4). The harness wiring and the lock are its protection, and both are now pinned by tests.
