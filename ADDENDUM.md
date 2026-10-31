# Spartan Crew booking engine: technical addendum

**The one plan for Spartan.** Written by Nico on 23 October 2026, and maintained since then by Claude for Ben.
- It is the only document the work runs from.
- OPERATING.md (24-26 Oct) and fleet/resume/Spartan-Handoff-2026-10-26.md are history. What they found is folded in
  below as findings and status.
- Every step updates this file: its status line, its measurement, and what moved.

**Last updated:** 30 October 2026, S-0268: **§13, the TV shows only what still needs doing. The final handoff is `fleet/resume/Spartan-TV-Handoff-2026-10-30.md`: steps 0-6, absolute data only, plain descriptions, clean and efficient code. Nothing is built yet. OnSinch's history is synced for the 3 days checked; a deleted order loses its create row there, and step 0 records it. Step 1 now carries the link rulings O17 (an absolute link overrules inferred ones) and O18 (several orders per email).** S-0264: **the owner's Part 2, the measurement loop (§12).** P2.5 DONE: each staff action is recorded once with whether a card came first (21-27 Oct: 21 of 215 had a card naming the day; 67 followed a card that showed no day), moved starts and one-order-per-venue exceptions; each TV need's exit is recorded. P2.4 DONE (S-0263): every client email since 9 Oct gets a judged outcome per plan from the minute sync; on production's data, planned writes 26 matched, 23 wrong (9 the venue), 11 staff did nothing, 19 can't tell. P2.3 DONE (S-0262): each new rule version is a planner option, today's rules the default (799 replayed decisions byte-identical); intake stores each rule that touched an email planned the other way; the lead rule's settings are an admin's, logged, with "applies to". P2.2 DONE (S-0261): the judge matches staff's orders by day and venue; on the 32 shadow writes it finds 15 matched, 2 partial, 3 wrong, 3 staff did nothing, 9 can't tell. P2.1 DONE (S-0260): OnSinch's booking timeline is stored from 29 Jul on, read forward every minute, with the contact lists daily. The Part 1 audit is in §12.1; the owner's five rulings are O6-O12 (decisions/2026-10-28-measurement-loop-and-rulings.md); the loop's spec and build steps P2.1-P2.6 are §12.2-§12.6, and the rulings go into code one a day after a 5-7 day baseline (§12.7). S-0259: F46 measured, not built (2 of 395 replies carry a parent from another thread). R22 DONE (S-0258): plan.ts decide() is 187 lines of steps in order, every decision of 799 replayed emails byte-identical. The review's builder steps are done; what is left is the owner's (§0 Blocked). R21 DONE (S-0257): scripts/README.md says what each of 135 scripts can touch; R20 measured and deferred with a trigger. R19 DONE (S-0256): what a reason means is read only in reasons.ts. R17 planner part DONE (S-0255): dev-2 writes 21, 12 completed, 2 partial, 7 wrong (was 22, 11, 2, 9); the 7 left are owner rules or judging limits, listed under R17. R16 DONE (S-0254): F49 and F50, the review's two write-path gaps, closed; the review's other steps are R17-R22. R15 DONE (S-0253): the V1 review, https://claude.ai/artifact/A3WyEdpcXRcehHoJVb6BQe; its write-path gaps are F49-F54, to close before writes go back on. S-0252: the re-plan no longer counts every card as changed every minute (found by the live trace). R13 DONE (S-0251): the assisted-card design, docs/ASSISTED-MODE-DESIGN-2026-10-27.md; at most 90 of 155 dev handoffs are near-misses. R14 DONE, dormant (S-0250): the Gmail poll decides through v2 once the grant exists and INTAKE_PATH=routing. R12 held for the owner and Paz. R11 DONE (S-0249): the live trace is on; 5.7 counted, its outbound change waits on the owner. R10 DONE (S-0248): the email-to-board harness and its 20-email case study. R9 DONE (S-0247). R8 DONE but e (S-0244 to S-0246); e waits on the owner's yes to a paid measurement. R3's switch-over waits on CRON_SECRET. The baseline was 0f2dcef. App code changed since then in these
commits only:

| commit | ticket | what |
|---|---|---|
| 1f3ae9a | S-0214 | Prompt 1 |
| fb01342 | S-0215 | Prompt 2 |
| 83e4972 | S-0216 | Prompt 3a |
| 6a98170 | S-0217 | Prompt 3b |
| 6988aa0 | S-0232 | /api/confirm-order shut under v2 |
| 40f7ca5 | S-0235 | Prompt 9: in-call retry, retryUnread, owner alerts, replay guard, UTC audit times, pause stores only |
| 4757c27 | S-0236 | Prompt 8: docs and ruling ids in comments only |
| 057dbb6 | S-0237 | Prompt 10: vercel.json crons, the heartbeat, an honest sync, sync and labels on CRON_SECRET |
| (R4) | S-0238 | Prompt 0: scripts/size-findings.mts (read-only); the scoreboard reads an email with no body |
| (R5) | S-0239 | Prompt 5 and 5.10: combined changes, trade totals, direction words, schema check, F13, F14, F18, the op key |
| (R6) | S-0240 | Prompt 11: the write and reply switches are an admin's, kept and reported; one migrations module |
| (R7.2) | S-0241 | Prompt 12 stage 2: the 12 files nothing reaches, deleted with the tests and scripts that existed only for them |
| (R7.3) | S-0242 | Prompt 12 stages 3 and 4: the old engine, its routes and SPARTAN_ENGINE deleted with their tests; a failed test file can no longer exit 0 (F48) |
| (R7.1) | S-0243 | Prompt 12 stage 1: app/lib/engine renamed app/lib/onsinch; imports only |
| (R8.ab) | S-0244 | Prompt 4 steps a and b: app/lib/v2/identity, one ladder for the planner and the thread state; F11, F12, the F9 "covered" half, held item 7 |
| (R8.c) | S-0245 | Prompt 4 step c: shifts by venue on multi-venue orders (F10), the near-miss hand-off (F9's strict half), held C1 |
| (R8.d) | S-0246 | Prompt 4 step d: the TV verifier finds an unbound need's order by the planner's rule; the old engine's matcher is called by nothing |
| (R9) | S-0247 | Prompt 6: v2/resume.ts resumes a write that stopped between or before operations after planning it again, or closes it with one result; any build (F38) |
| (R10) | S-0248 | Prompt 13: harness/board (cases, gold, a subagent reader, stage attribution), eval/board/2026-10-27.md, test/boardCases.ts in the gate |
| (R11) | S-0249 | 5.2: v2/traceLive.ts, v2_trace (migrations 085-087), intake and changed re-plans traced, 90-day prune in the minute sync; 5.7 counted |
| (R14) | S-0250 | F43: /api/mail-poll decides through mail/pollIntake.ts; n8n-inbound stores only under INTAKE_PATH=routing; the middleware's shut list removed |
| (R13) | S-0251 | Prompt 7: docs/ASSISTED-MODE-DESIGN-2026-10-27.md (design only) |
| (R11) | S-0252 | replan.ts sameAnswer: an answer read back from JSONB is compared by content, not key order |
| (R15) | S-0253 | The V1 review (builder and an independent reviewer, every claim checked); F49-F54 added; two misplaced process.ts comments moved |
| (R16) | S-0254 | F49: resume closes a write that died in its first operation as unknown, by its ledger row; F50: recordDecision keeps a write's record |
| (R17) | S-0255 | A chief counted on its own is one more on the call; set builders are Carpenters; venue initials read on the whole name; a call under 2 hours is a person's |
| (R19) | S-0256 | F52: feed/v2.ts and plan.ts ask reasons.ts (isReplyReason, isMissingDetail); the sweep reads the stored code for not-a-client |
| (R21) | S-0257 | scripts/scripts-index.mjs and scripts/README.md (test/scriptsIndexed.ts); authorizeMailWebhook and the two /api/mail-inbound scripts deleted; stale route comments |
| (R22) | S-0258 | plan.ts: decide() split into planChange, addToNamed, bookNew and setPo over one Draft; no decision changed |

bd10dae (S-0213) moved the test suite onto PGlite. Line references below are at HEAD unless a line says "at 0f2dcef".

**Read §0 first.** Nico's original text follows it unchanged in substance. Each item carries a **Status 26 Oct** line,
and §3 ends with the findings added after 23 Oct (F29 onward). §11 is the rebuild plan.

---

## 0. State at 26 October (read first)

### Production
- **The v2 engine decides every client email, in shadow:**
  - n8n posts each email to /api/n8n-inbound;
  - one model call reads it (openai/gpt-6.1-sol, prompt extract@f3e1a862322b, since 16 Oct);
  - code grounds and plans it;
  - the decision lands in v2_decisions.
- The office TV shows the open cards, and Gmail labels follow the TV every minute.
- **Writes to OnSinch are off:** bot_writes_enabled=false since 25 Oct 13:21Z, the owner's ruling.
  - Checked 26 Oct: none of the 15,049 OnSinch audit rows since 21 Oct were made by the system's user (2257).
  - 28 planned writes were never run.
- **The TV is current and accounts for every write and handoff since 23 Oct** (audit/verification-2026-10-26.md). Of the
  two faults it found, F29 is fixed (S-0235); F42 waits on the owner and Paz.
- **A push to main deploys production.** Work in C:/Users/thera/spartan-v2, branch v2 → origin/main. The only commit and
  push is `python -u scripts/session.py` (about 15 minutes).

### Status of every item

| item | status 26 Oct | where |
|---|---|---|
| F1 lost emails | **DONE** S-0214 | test/everyEmailDecided.ts; sweepUndecided (process.ts) |
| F2 open work drops off the TV | **DONE for the leak** S-0214 (every open need kept; outbound clears only Needs Reply). **OPEN: the Needs Reply lane** (F41) | test/feedKeepsEveryNeed.ts; feed/v2.ts rowsOnCard |
| F3 pause doesn't stop everything | **DONE for retries, the sweep, test-data and labels** S-0214. **Auth half built** S-0237: sync and labels take authorizeCronCall, which refuses the intake secret once CRON_SECRET is set; **live when the owner sets it** | test/pauseStopsSync.ts; test/cronEntryPoints.ts |
| F4 creates go through the API | **DONE for the docs** S-0239: run.ts says creates go through the API. The phase is still logged as "browser" | run.ts:5 |
| F5 two-week rule | **OPEN, owner decision** | plan.ts:54, :774-775 |
| F6 unknown sender creates a client | **OPEN, owner decision** | plan.ts:499-500, :834 |
| F7 suite writes to production | **DONE** S-0213 (PGlite). **OPEN: preview shares production's database** (F44; steps in §11 Prompt 11) | test/fixtures/pg.ts |
| F8 grounding checks presence, not selection | **DONE** S-0239: direction ("instead of", "rather than", "was X, make it Y", "make it") is read before membership; a reply's subject supplies no new value | test/v2EverydayRequests.ts [F8]; interpret.ts directed |
| F9 "already booked" too loose / too strict | **DONE** S-0244 (loose: identity covered, each request among everything the client has that day; a generic place is never the venue) and S-0245 (strict: a shift that day at the venue starting within an hour is a person's, never a second booking) | test/identity.ts [1] [2]; test/v2Shifts.ts |
| F10 venue ignored on multi-venue orders | **DONE** S-0245: bookedAt and targetShift count only the venue's shifts on an order at several | test/v2Shifts.ts |
| F11 lone R/J links the thread | **DONE** S-0244: a number in quoted text decides only when a day is asked and its order holds it | test/identity.ts [4] |
| F12 CC'd addresses widen the pool | **DONE** S-0244: To and Cc count only when no sender names a company, and only when they name exactly one | plan.ts evidenceOf |
| F13 failed company list → duplicate company | **DONE** S-0239: a list that cannot be read blocks the create | test/v2SmallFixes.ts [F13] |
| F14 deleted linked order blocks forever | **DONE** S-0239: an id from an old decision OnSinch has deleted is passed over | test/v2SmallFixes.ts [F14]; threadOrder.ts |
| F15 test-data clear on one setting | **DONE** S-0214 (pause, both write keys, logged) | testData.ts:285-288; sync/route.ts:39 |
| F16 J is the first Job only | **Measured** S-0238: 3 of 338 staff-built orders in 30 days have more than one Job. Left as is | links.ts |
| F17 lease can lapse | **Measured** S-0238: 0 of 159 ledger runs over 180 s (longest 51 s). Not a problem | run.ts, bot/db.ts |
| F18 NOT_CLIENT by substring | **DONE** S-0239: notClient by whole domain and mailbox name (1 of 64 in 30 days had been set aside wrongly) | test/v2SmallFixes.ts [F18]; process.ts notClient |
| F19 dates dd/mm | OPEN (right for UK clients; a decision, not a bug) | ground.ts:255 |
| F20 re-plan cache and limits | known behaviour | replan.ts:32 |
| F21 docs behind the code | **DONE** S-0236 (README and harness/STATE.md name the live reader) | README.md; harness/STATE.md |
| F22 duration beside an end dropped | **DONE** S-0215 | test/v2WrongBookingPaths.ts |
| F23 model pick on the day alone | **DONE** S-0215 | same test |
| F24 time change + crew total refused | **DONE** S-0239: a total written as one ("make it 8 crew") beside a time change is a second change; an added chief works the new times | test/v2EverydayRequests.ts [F24] |
| F25 trade totals/reductions refused | **DONE** S-0239: a total or reduction sets or cancels the trade's one position; two such positions hand off. "Forkies" is a forklift | test/v2EverydayRequests.ts [F25] |
| F26 failed reads / interrupted plans never recovered | **DONE for reads** S-0235 (retryUnread from the minute sync, after F29's in-call retry). **DONE for plans** S-0247 (v2/resume.ts) | test/retryUnread.ts; test/resumeStopped.ts |
| F27 "yes, book that" is a card | policy: the owner ruled on 20 Oct that it hands off. An acceptance card is built and held (held item 6) | plan.ts |
| F28 create read-back skips the venue | **DONE** S-0215 | run.ts createMismatches :124 |
| 5.1 scoring | **DONE** S-0216, S-0217 (strict scorer, context forwarded, reason codes, four numbers). Extended 25-26 Oct by the real-mail harness (§4) | app/lib/v2/score.ts; harness/real/ |
| 5.2 live trace | **DONE** S-0249: one v2_trace row per step, addresses hashed, no email text, 90 days | app/lib/v2/traceLive.ts; test/liveTrace.ts |
| 5.3 one shared finder | **DONE but e** S-0244 to S-0246 (the planner, shifts, venues, the near miss, the TV verifier); e (the reader's list) held for a paid measurement | Prompt 4; map claude.ai/artifact/6VWRB2Ymd3pst5QTbdL4zG |
| 5.4 faithful requests | **DONE** S-0239 (F24, F25, F8, "20-Nov" and held item 5's parser, schema check) | Prompt 5 |
| 5.5 recover interrupted work | **DONE:** F1; re-read S-0235; resume S-0247 | Prompt 6 |
| 5.6 every request visible | **PART:** every need kept (S-0214); the Needs Reply lane is open | F41 |
| 5.7 R number in our subjects | **COUNTED** (5 of 6 replied to us); the outbound change waits on the owner's yes | .tmp-v2/r57.mts |
| 5.8 assisted mode | **DESIGNED** S-0251; the build needs the owner's and Paz's yes | docs/ASSISTED-MODE-DESIGN-2026-10-27.md |
| 5.9 acceptance | policy, see F27 | |
| 5.10 small fixes | **DONE**: F15 S-0214; README and harness STATE S-0236; F13, F14, F18, the op key and run.ts:5 S-0239 | |
| §6 rules | **1-5 RULED** 28 Oct (O7-O9, O12); 6, 8, 9 open | §6; §12.7 |
| Part 2 measurement loop | **BUILDING** from 28 Oct: P2.1-P2.6, then a 5-7 day baseline | §12 |
| §10 / Prompt 8 docs | **DONE** S-0236: CLAUDE.md is the v2 map; engine invariants in app/lib/engine/README.md; docs/README.md; 35 code rulings and 5 standing ones in DECISIONS.md (V1-V35, O1-O5), each comment tagged | CLAUDE.md; DECISIONS.md |
| F29 one read attempt | **DONE** S-0235 | test/extractRetry.ts; extract.ts extractWithMeta |
| F30 owner never told of system failures | **DONE** S-0235 (system-failed alert) | test/systemFailureToOwner.ts |
| F31 a pause throws mail away | **DONE** S-0235 (a v2 pause stores, marks v2_store_only, decides nothing) | test/pauseStoresOnly.ts; paused.ts automationPaused |
| F35 replay erased the write record | **DONE** S-0235 | test/replayKeepsWriteRecord.ts |
| F36 zone-less audit times | **DONE** S-0235 | test/zonelessIsUtc.ts |
| F32 n8n runs this automation's heartbeats | **Code DONE** S-0237: vercel.json crons (sync every minute, heartbeat every 5), /api/health/heartbeat, the label workflow made webhook-triggered (scripts/install-sync-workflow.mjs), the watchdog installer refuses to run. **Switch-over OPEN: waits on CRON_SECRET** | test/cronEntryPoints.ts; test/heartbeat.ts |
| F37 the sync reports success whatever happened | **DONE for the sync** S-0237 (ok only when every step succeeded, 500 otherwise). Labels still count as applied when handed out | test/cronEntryPoints.ts |
| F34 any staff member flips the switches | **DONE** S-0240: admin only (DECISIONS A1), a settings_history row per change, a settings-changed alert to the owner | test/settingsSwitchesGoverned.ts |
| F44 schema at request time; preview on production's database | **DONE for the schema** S-0240: app/lib/migrations.ts, migrate() once per database, checked against production's schema. **OPEN: Preview's own branch** (needs access) | test/migrations.ts |
| F45 the old engine is 40% of the app | **DONE** S-0241 to S-0243: 53 app files (14,624 lines) deleted, 122 of 226 test files with them; the 7 files v2 imports are app/lib/onsinch/ | test/automationPaused.ts; scripts as in Prompt 12 |
| F48 a failed test file passed the gate | **DONE** S-0242 | test/exitCodeSurvivesPglite.ts |
| F49 a death inside a write's first operation is never resumed | **DONE** S-0254 | test/resumeStopped.ts [3b] |
| F50 the decision upsert's coalesce never keeps a record | **DONE** S-0254 | test/replayKeepsWriteRecord.ts |
| F51 a link takes new shifts whatever days its order holds | **OPEN, owner decision** (R15) | identity/index.ts:137 |
| F52 behaviour keyed to reason wording | **DONE** S-0256 for decisions; resume.ts's TRANSIENT reads the bot's own error words | test/reasonsOneSource.ts |
| F53 the minute reads grow with history | **MEASURED, deferred** (R20): 324 rows, about 400 KB a minute | replan.ts; feed/live.ts |
| F54 the n8n path cannot see our unsent drafts | **OPEN** (R15) | test/draftIsNotAMessage.ts [5] |
| F38 a deploy cancels a stopped write's retry | **DONE** S-0247: any build's stopped write is planned again and resumed or closed | test/resumeStopped.ts [5] |
| F39 a part-way write raises no alarm | **DONE** S-0235 (systemFailureOf) and S-0247 (resume.ts closes each with one result, told to the owner) | test/resumeStopped.ts [3] [4] |
| F33, F40-F43, F46, F47 (added 26 Oct) | see §3, "Added 26 October" | |

### Built and held (not deployed)
Each held diff is mapped to the item it serves. They sit in `eval/patches/` and stack in this order on 305bf84. Applied
together in worktree C:/Users/thera/spartan-v2-n1, they pass tsc and all 227 test files. **S-0235 shipped
items-1-3-runtime, item-4-scoring, n1-write-judging and c-current-mail's C2 and C3.** Still held: C1, n2, p1 items 5-8.

| diff | serves | in the rebuild |
|---|---|---|
| items-1-3-runtime | F30 owner alert, F35 replay guard, F36 UTC audit times | R1 |
| item-4-scoring, n1-write-judging | 5.1: the scorer judges a staff-built order once; write judging agrees with a hand reading on 21/23 | R1 (harness only) |
| n2-planner-ops | F47: re-timing one named role moves only that role; a crew change with its own hours, or two changes to one shift, hand off | **shipped S-0239** |
| c-current-mail | C1: a create books the client's or the one fitting OnSinch venue (F9 / 5.3 territory). C2: the harness counts the bot's own runs. C3: retryUnread (F26) | C3 → R1; C1 → R5; C2 → R1 |
| p1-fixes items 5-8 (stale for 1-4) | 5: parser (5.4), **shipped S-0239**; 6: quote acceptance (5.9); 7: shared-domain client (F12 / 5.3); 8: reply cards listed (F41) | re-cut in R4, R5 and R9; 6 and 8 need the owner and Paz |

### Owner rulings since 23 Oct (each binds the rebuild)
- **No heartbeat for this automation runs in n8n, ever** (26 Oct). It is in the repo's CLAUDE.md.
- **Writes stay off.** Model confidence alone is not an execution gate. No prompt change and no paid run without the
  owner's yes.
- **The 40 emails from the 21 Oct pause are stored, not decided** (decisions/2026-10-25-pause-window-store-only.md).
  - Run `scripts/backfill-pause-window.mts`: `plan` first, then `store`.
  - Only on or after **28 Oct 16:06Z**.
- **Display and TV changes** go only with the owner's and Paz's yes. The Paz draft is audit/paz-acceptance-examples.md,
  and the owner sends it.
- **Quote acceptances hand off** (20 Oct).

### Blocked outside the code
1. **CRON_SECRET in Vercel's production environment.** It is needed for any Vercel cron (F32). The Vercel connector is
   refused for the project's team (403), so the owner sets it.
2. **Gmail domain-wide delegation.**
   - A spartancrew.co.uk super-admin grants Client ID 104025308997865565766 the scopes
     `gmail.readonly,gmail.modify`.
   - The steps are in app/api/mail-poll/route.ts.
   - This lets intake, labels and alarms leave n8n entirely.
3. **A Neon branch for Preview** (F44). The steps are under Prompt 11 in §11.
4. **Paz's answers** (F41, F42, held items 6 and 8).
5. **SPARTAN_TRACE_SALT in Vercel's production environment** (5.2), any long random string. Without it the live trace
   blanks every address, so one sender's rows cannot be joined. Not urgent.
6. **The owner's yes to 5.7** (an R number in Spartan's subjects): outbound mail.
7. **R17's four rules** (the dev-2 writes still wrong are these). **The first is ruled (O10, 28 Oct): one order per
   venue, one order across days and weeks at one venue; the exceptions are flagged by the loop (§12.5).** When one
   email makes several orders (staff split 1a144942ca8851d1 by weekend); whether a quote with shifts becomes an order (13 Oct says To Confirm; staff made none
   for 1a1541de84b036b8); whether V15's default length should look at night starts; whether driver seats come from
   the client's history.
8. **The Jobs screen's confirm button** posts to /api/confirm-order, deleted in R7. 16 old tickets still show it as
   "proposed". Removing or rewording it changes what staff see, so it is for the owner and Paz.

### Dates
- **28 Oct 16:06Z:** the pause-window store.
- **29 Oct:** two blind readers label the 26-28 Oct mail (W2). Mail from 29 Oct (E3) stays untouched until a fix is
  frozen, as the held-out week 5.1 asks for.
- **Before 30 Oct:** ship R1, so retryUnread can still re-read the 23 Oct 429 card. Its window is 7 days. **Shipped
  26 Oct, S-0235.**

---

## How to use this document

**Baseline.** Nico's references were to Bmikus4/Spartan-Crew-Jobber at commit 0f2dcef750cc951e29b2a22ed6d465e3a6bb51b8,
paths relative to the repo root. The status lines above give HEAD's locations. Re-verify each line before acting.

**Method (Nico's).**
- This was a static review only. Nico read the code, the change log (public/data/feed.json), the systems overview PDF
  and the 21 Oct call transcript with Claude (Opus).
- Then a second model (Claude Fable) independently tried to disprove every finding.
- A third, GPT-6 Astra, audited the code separately before reading Nico's, and Fable checked its claims.
- Nothing was run and no endpoint was called. Production, the database, OnSinch, n8n and OpenRouter were not accessed.

**Labels:**
- Code-verified: the mechanism is visible in code at this commit.
- Reported: from the PDF or the call.
- Hypothesis: frequency or impact is unproven.
- Runtime-verified: none at the time of writing. Section 7 now carries the counts measured since.

**Ground rules for an agent acting on this:**
- Write the failing fixture first, then the fix, then show the fixture passing.
- Don't run npm run test:all while DATABASE_URL points at production (F7; the suite now runs on PGlite).
- Keep every item in section 2 intact.
- Items marked "owner decision" need Ben and Steven, not code.

---

## 1. Summary

**Can this work? Yes.**
- **The information is usually there.** In the study of 102 real emails (harness/STATE.md), 84 needed no question back,
  15 were unclear or missing a detail, and only 3 were unclear about which booking. So most handoffs aren't caused by
  missing information.
- **The hard, risky part already works.** Writing to OnSinch is guarded by the ledger, read-back, refusal rules and To
  Confirm (section 2).
- **The gap is in the middle, and it's engineering, not a limit of AI.** The system turns away common requests it can't
  represent (F22, F24, F25). Several components decide "which booking" with different rules (F9, F10, F23). Both are
  fixable with known techniques (5.3, 5.4).
- **Clients don't need to quote order numbers.** They rarely do (4 of 49 missed threads, per the context.ts header),
  and requiring it would push work back onto Spartan's clients. Date, venue and time pin down most bookings once one
  shared finder weighs them together (5.3). Spartan's own subject lines can carry the number for replies (5.7).
- **A realistic target:** the system completes routine requests itself, and pre-fills the rest so staff confirm with one
  click (5.8). How large "routine" is will come from the repaired weekly scoreboard (5.1). Nico put no percentage on it
  before that exists.

### What the records and the code show
The write path (bot, ledger, read-back, To Confirm) is the best-defended code in the repo. The measuring tools
(scripts/ops-truth.mts, score-vs-ops.mts, real-email-scoreboard.mts, week-review.mts) grade the system against what staff
actually did in OnSinch, which is the hard idea to get right.

**As of 23 Oct:**
- **Most work goes to staff.** Live week 9 to 14 Oct: 75 of 80 not done by the system (S-0177). That is a per-email
  verdict, not a count of staff actions.
- **Wrong writes are rare, but not zero.**
  - The v2 era had some:
    - an added shift on R11500 on 10-14;
    - creates losing their crew chief;
    - a shift written for the wrong day;
    - duplicates (S-0193, S-0197).
  - Their causes were fixed. Two live paths remained (F22, F23).
- **The scoring tools over-credited** (section 4).

**Status 26 Oct:**
- F22 and F23 are closed.
- The strict scorer's first week (14-21 Oct, S-0217) measured:
  - wrong writes 2;
  - coverage 7 of 108 emails with booking work;
  - missed changes 32;
  - lost emails 0.
- On the current reader's mail (16-25 Oct, labelled blind), 90 of 107 real inquiries produce an item on the TV (84.1%).
  The 17 misses split:
  - 7 are the reader reading "nothing asked for";
  - 7 are Needs Reply cards the TV does not list (F41);
  - the rest are single cases.

**Nico's read:** the rebuild is careful where it writes, but it can't yet represent or match ordinary requests well
enough to take them on. That is why most emails become handoffs, and some of those handoffs then disappeared (F1, F2).
The lever is request representation and candidate matching, not loosening the safeguards.

**Priorities** (Nico's order; status in §0):
1. Close the leaks (F1, F2, F3), so every handoff stays visible until someone deals with it. **Done, except F41.**
2. Repair the scoring, then run it weekly on held-out mail (5.1). **Done; weekly runs not yet scheduled.**
3. Close the two live wrong-write paths (F22, F23). **Done.**
4. Give the reader and planner one shared, corroborated candidate list (5.3).
5. Represent requests faithfully: durations, combined changes, trade counts (5.4).
6. Recover interrupted work safely (5.5).
7. Settle the business rules with Spartan (section 6), then decide on assisted mode (5.8) from the corrected tally.

---

## 2. Working components to preserve

These hold up in code and back the PDF's safety rules. Fixes go around them. References are at 0f2dcef.
- **Status 26 Oct:** all still hold.
- builder.ts, ops.ts and bot/db.ts are unchanged since.
- run.ts changed in 11 lines: createMismatches is still :124; auditExtras is now :184.
- process.ts moved substantially: retryStopped :124, decideDelivery :187, decideMessage :359, botWrites :33.

The components:
- **Capture before deciding.** Insert-once storage before engine work (app/lib/n8nInbound.ts:61-62;
  app/lib/inboundRawDb.ts:89-126).
- **Pre-click vs post-click outcomes.** A throw before Save means blocked; after Save it means unknown, which is never
  retried (app/lib/v2/bot/builder.ts:67-79,180-188; app/lib/v2/bot/run.ts:253-255,359-363; app/lib/v2/process.ts:115-154).
- **Op ledger idempotency.** A seen key never runs again (app/lib/v2/bot/ops.ts:39-43; run.ts:249-257;
  app/lib/v2/bot/db.ts:124-131). The key drops nested fields, but per-op sources keep it collision-free today (5.10).
- **Verification for edits.** Read-back plus an OnSinch audit-row diff that rejects extra changed fields
  (run.ts:84-142,181-232). Creates get read-back only (F28; the venue is now compared).
- **Form contract and concurrent-edit guard** for builder edits (builder.ts:120-194). This covers edits only (F4).
- **Two write keys, failing closed.** SPARTAN_WRITES=live and the Settings switch (process.ts:26-34;
  app/lib/paused.ts:31-33).
- **Planner refusals:**
  - whole email or nothing (app/lib/v2/interpret/plan.ts:463);
  - never the day alone in the deterministic finder (:176-207). The model-pick path now follows the same rule (F23,
    done);
  - past days refused (:504-515);
  - staff precedence on re-plan (:246-266);
  - ambiguous shifts refused (:88-117);
  - DST-ambiguous times refused (ops.ts:59-69).
- **TV failure posture.** A failed read returns 500, never an empty list (app/lib/feed/serve.ts:61-68). Labels skip a
  minute instead of stripping (app/api/bot/labels/route.ts:41).
- **Read failures become cards.** Model and planner exceptions inside decideMessage become a handoff
  (process.ts:299-312,323-330). Since S-0214, any throw before the record does too.
- **The harness itself.** Preflight isolation, a fake OnSinch, record/replay, a mutant control and binary scoring. Since
  S-0216 it is in the gate (test/harnessGate.ts). Since 25 Oct, harness/real/ replays real mail on the time-correct
  world at $0.
- **Added 26 Oct:** the strict scorer (app/lib/v2/score.ts) and the reason codes (app/lib/v2/reasons.ts). A reason
  reworded without its code fails the gate.

---

## 3. Findings

Each finding has the same parts: the mechanism (code-verified), why it matters, a candidate fix, and the fixture that
proves it. Severity reflects business effect if frequent; frequency is unmeasured unless stated.

### F1. A client email can be stored but never decided, with no card and no alarm (Leak, high)
**Status 26 Oct: DONE**, S-0214 (1f3ae9a).
- Each path below was reproduced first by test/everyEmailDecided.ts, red at 0f2dcef.
- storeThreadMessages returns the ids it did insert. captureInboundRaw returns ok:false and intake alarms.
- Any throw before the record becomes a handoff. Earlier messages are settled after the newest.
- sweepUndecided runs every minute: client mail stored 10 min to 24 h ago, sent in the last 7 days, with no decision.
- **Measured:**
  - 948 of 958 captured emails since 9 Oct have a decision; the 10 without are non-client mail from before the 11 Oct
    fix (the system audit, on the 26 Oct copy);
  - lost emails in the strict week: 0 (S-0217).

Three paths (at 0f2dcef):
- **(a) Partial insert, silent.** storeThreadMessages (app/lib/threadMessagesDb.ts:266-296) inserts row by row.
  - On a throw it returned { ok:false, inserted:0, ids:[] } even when earlier rows were already inserted.
  - captureInboundRaw never read msgs.ok (app/lib/inboundRawDb.ts:100,120-121) and returned ok:true with empty ids.
  - Those rows were stored, never "new" again, and never decided. The response was HTTP 200 with no alarm.
- **(b) Throw inside decide.** There were unguarded awaits in decideMessage:
  - deps.world.companies() at process.ts:292;
  - await deps.threadOrderId(), evaluated as a plan(...) argument at :325, outside the .catch at :330;
  - db() and deps.record at :410-417.

  Any throw went to n8nInbound.ts:77-79, which sent an alarm email and returned 500, but wrote no v2_decisions row.
- **(c) Earlier messages marked first.** decideDelivery recorded earlier messages in a delivery as none ("read
  together") at process.ts:206-214, before the newest was processed at :215-217. If the newest then threw, all of them
  were left undecided.

**Why it stayed lost:**
- new_message_ids contains only first-time inserts, so the 30-minute coverage re-post and later replies never re-offer
  the message.
- Every reader starts from v2_decisions (app/lib/feed/live.ts:79; app/lib/v2/replan.ts:79).
- Nothing queried for client messages with no decision.
- This contradicts PDF p4 rule 3, "every email ends in a recorded outcome".

**Candidate fix (as built):**
- Return the inserted ids, and alarm on ok:false.
- Record the earlier messages' none only after the newest is decided.
- Wrap the remaining awaits.
- Add the undecided sweep.

**Fixtures:** storeThreadMessages throws on row 2 of 3; threadOrderId throws; record throws. Each must end in exactly
one decision or a visible card.

### F2. Open work can drop off the TV (Leak, high)
**Status 26 Oct: the leak is DONE**, S-0214 (test/feedKeepsEveryNeed.ts).
- A thread's card carries every older need that no later decision answered (feed/v2.ts rowsOnCard), and our email
  clears a Needs Reply and nothing beside it.
- **Still OPEN: "list Needs Reply, or give it its own lane"** (F41). Reply cards are still unlisted (feed/v2.ts:90,
  serve.ts), and they are 7 of the current reader's 17 misses.

Mechanism (at 0f2dcef):
- The TV showed one decision per thread (app/lib/feed/v2.ts:171-174). An older need was kept only beneath a newer write
  (openNeedUnder, :183-200), so a newer handoff replaced it.
- The TV lists only needs-created and needs-updated (app/lib/feed/serve.ts:110,115), so a newer Needs Reply is unlisted.
- Any outbound email at or after a Needs Reply cleared it (app/lib/feed/project.ts:431).
- The older need's key was never marked resolved, because it exists (:417-426).
- Re-plan rebuilds the same projection every 5 minutes (replan.ts:83).

Trigger:
1. Email A says "book Tue" and becomes a handoff (needs-created).
2. Email B says "what's the rate?" and becomes Needs Reply.
3. Staff answer B.
4. A's need leaves the TV and the labels without being booked.

This matches PDF p6 #6, where 12 of 33 Needs Reply threads were later booked by staff.

**Candidate fix:**
- The TV keeps every unresolved need per thread (done).
- An outbound email clears only Needs Reply (done).
- List Needs Reply, or give it its own lane (open; F41).

**Fixture:** replay case R15 (A, then B, then outbound). A must stay visible.

### F3. The pause switch doesn't stop everything (Safety, high)
**Status 26 Oct: DONE in part**, S-0214 (test/pauseStopsSync.ts). SPARTAN_PAUSED=1 now stops:
- retryStopped;
- sweepUndecided;
- the test-data clear;
- /api/bot/labels.

**Still OPEN:** /api/bot/sync and /api/bot/labels still accept the intake secret through authorizeMachineCall
(sync/route.ts:26, labels/route.ts:25), against the comment in apiAuth.ts that the intake secret alone must not drive
the bot. Separately, a pause still refuses intake at the door and loses mail (F31).

Mechanism (at 0f2dcef):
- SPARTAN_PAUSED=1 gated only AUTOMATION_ROUTES (app/lib/paused.ts:11,35-38).
- middleware.ts:42 skips /api/bot, and the pause check at :48 runs after the skip.
- /api/bot/sync kept running retryStopped and maybeSweep, which includes the test-data clear
  (app/api/bot/sync/route.ts:27-37). n8n hits it every minute (scripts/install-sync-workflow.mjs:28-29).
- /api/bot/sync and /api/bot/labels accept the intake secret through authorizeMachineCall (app/lib/apiAuth.ts:106-115).

Bounds:
- Retries need both write keys, a 6-hour window and the same codeVersion() (process.ts:126-130).
- /api/bot/run is test-only.
- /api/bot/process with execute reaches runOp behind BOT_SECRET.

**Candidate fix:**
- Pause short-circuits retries and the clear (done).
- Move sync and labels to authorizeBotCall, or a dedicated secret (open; in R3, where the cron needs its own auth
  anyway).

### F4. Creates go through the OnSinch API, not the staff screens (Description gap)
**Status 27 Oct: DONE for the docs** (S-0239): run.ts:5 says a new order is created through the API.
- The phase is still logged as "browser" (run.ts:258-268).
- F28's venue check is DONE.

Mechanism (at 0f2dcef):
- Creates go through run.ts:262-294 to apiCreateOrder (app/lib/v2/bot/apiCreate.ts:103-131), which calls
  OnsinchClient.createOrder, createCompany and createPlace.
- Test-data deletes and the canary also use the API.

Why it matters: the PDF (p4 rule 13) tells the business owner every write goes through the staff screens with the form
and concurrent-edit guard. That is true for edits only.
- Creates have read-back and To Confirm (request_approval: true), but not the audit diff.
- Duplicate prevention and venue checks matter more for a create (F13, F28).

**Candidate fix:** correct run.ts:5 and the PDF wording.

### F5. The two-week rule isn't agreed between call, PDF and code (Rules, owner decision)
**Status 26 Oct: OPEN, owner decision.** Code at plan.ts:54 (CREATE_LEAD_DAYS = 14) and :774-775.

**Code:**
- The rule is daysBetween(sentDay, earliest) <= lead. Settings can override 0–365 or switch it off.
- It applies to brand-new orders only. Additions to named or found orders bypass it.
- The clock is the email's sent date, not decision time.

**Sources:**
- On the call, nothing inside two weeks is created or updated.
- The PDF says new orders only.
- DECISIONS.md has no ruling on the clock.

**Why the clock matters:** after a pause, backlog emails are decided days late. A booking 16 days after its email but 9
days from today would be auto-created.

**Decision needed:** which actions the rule covers, and which clock it counts from. Treat this together with F6.

### F6. An unknown sender can create a company and an order (Rules, owner decision)
**Status 26 Oct: OPEN, owner decision.** The newClient path is at plan.ts:499-500; `new:` company ids are emitted at
:834.
- The only gates are the 14-day lead and To Confirm.
- The invoice-domain fallback (resolve.ts, S-0207) narrows it. Held item 7 (a shared-domain rule) would narrow it again.

**Decision needed:** may the system ever create a brand-new client's first order, or does a new client always go to a
person?

### F7. The release test suite writes to whatever database the env names (Process safety)
**Status 26 Oct: DONE for the suite**, S-0213 (bd10dae).
- test/all.ts loads test/fixtures/pg.ts, which replaces the Neon driver with PGlite in memory and sets every database
  variable to "sim://pglite", which the real driver refuses.
- The suite had been emptying old bodies through bodyArchive --apply: a time bomb for 24-27 Oct, defused.

**Still OPEN:** "Give preview its own branch too" (F44).

Mechanism (at 0f2dcef):
- test/all.ts ran every test against .env.local's database.
- Ten tests called neon(requireEnv("DATABASE_URL")).
- middleware.ts:50-57 notes that preview and production share one database.

### F8. Grounding checks that a value is present, not that it's the right one (Matching)
**Status 27 Oct: DONE** (S-0239). interpret.ts `directed` reads "instead of / rather than", "was X, make it Y" and "make
it" before membership: when the side the value must come from holds a value of its kind, only that side counts. A change's
new values ground against the client's own words, so a reply's subject supplies none. Fixtures in
test/v2EverydayRequests.ts [F8].

Mechanism:
- A value is accepted when it is among the quote's values.
- timesIn returns every time in the quote.
- For change requests, start, end, duration and count ground only against the subject plus the newest message. Date
  and venue still ground against the whole thread.

Failure:
1. The newest message (or a reply subject) says "was 08:00, make it 09:00", so both values ground.
2. The model picks 08:00, and grounding passes.
3. The planner skips unchanged slots and records "already as asked".
4. The result is a silent no-op.

Grounding catches invented values. It can't catch the wrong selection among quoted ones.

**Candidate fix:** carry message and span provenance per value. Read "instead of / rather than / make it" direction
before the membership check, and keep reply subjects from supplying new values.

**Fixtures:** "was X, make it Y" in one message; a reply subject that holds the old time.

### F9. "Already booked" is too loose in one path and too strict in another (Matching)
**Status 26 Oct: OPEN.**
- evidence.ts:34-56 still takes venue, start or crew count as the second fact.
- bookedAt (plan.ts:379-396) still matches by exact beginning.
- Held C1 (a create books the client's or the one fitting venue) narrows the duplicate-venue side; it belongs in 5.3's
  resolver.

**Too loose:** evidence.ts accepts venue, start time or crew count as the second fact beside the day. coveredBy
(threadState.ts:166) and plan.ts:264 then settle a handoff as "covered". A client with two 4-crew bookings on the same
day at different venues can be told the second is already booked.

**Too strict:** bookedAt matches by exact beginning. The unnamed path needs exact start plus place. A staff-built 07:30
against an asked 08:00 counts as "fresh", which can lead to a duplicate To Confirm order.

**Root:** the evidence stack has no single notion of identity.

**Candidate fix:** one rule for both.
- A match counts only when the evidence picks out exactly one candidate among the client's orders and shifts that day.
- If two fit, hand off and list both.
- If none fit exactly but one is near (same day and venue, start within a tolerance), hand off as "possible duplicate".

**Fixtures:** R5 (two orders, same day), R16 (07:30 vs 08:00), and two same-crew bookings at different venues.

### F10. Shift matching ignores the venue on multi-venue orders (Matching)
**Status 26 Oct: OPEN.** bookedAt (plan.ts:379) is location-blind, called at :674 for a named order and :730 for the
unnamed path.

Mechanism: on a named order, new shifts are checked with bookedAt, which is location-blind. atPlace is used afterwards
to choose where an added shift goes; it doesn't narrow bookedAt.

Failure: the client asks for venue Y's shift in the same window as an existing venue-X shift. The planner treats it as
already booked, or turns it into change_crew/change_times on venue X's shift. That is an edit to the wrong venue's
shift.

**Candidate fix:** include location in bookedAt, targetShift and writer verification whenever the order has more than
one location (5.3).

**Fixture:** a two-venue order with an identical window, where the email asks for the second venue.

### F11. A lone R or J number anywhere in the thread links it (Matching)
**Status 26 Oct: OPEN** (threadState.ts:60-90: `holds` is true when no days are asked; R/J is read from the whole
thread).

Mechanism: R/J is searched across the whole thread, including Spartan-authored and quoted text. "Thanks, see R12345 for
the other job" attaches this thread to R12345.

**Candidate fix:** weigh R/J by provenance.
- A reference in the client's newest words, or in Spartan's own reply on this thread, is strong.
- One in quoted text about another job is weak.
- When references disagree with other facts, hand off (see 5.7).

### F12. CC'd addresses widen the company pool (Matching)
**Status 26 Oct: OPEN** (plan.ts:215 evidenceOf). Held item 7 (shared mail domains) is related.

Mechanism: evidenceOf collects the companies of every non-Spartan from/to address, and to_addresses stores To and Cc
together. Sender matching comes first, so the risk is the fallback when the sender is unmatched: a CC'd venue contact or
second client can then supply the company.

**Candidate fix:** in that fallback, hand off when recipients yield more than one company, and never let a
recipient-only company override a contradicting sender domain.

### F13. A failed company-list read creates a duplicate company (Matching)
**Status 27 Oct: DONE** (S-0239): the failed list read throws before anything is sent, so the create is blocked.
Measured (§7): 3 same-name groups among 814 companies.

**Candidate fix:** treat a list failure as blocked, not as an empty list.

**Count first:** same-name companies created by bot user 2257.

### F14. A deleted linked order blocks new shifts on that thread forever (Fail-safe, burden)
**Status 27 Oct: DONE** (S-0239): linkedOrderId passes over an id from an old decision that OnSinch no longer holds; a
read that fails keeps the id. Link rows are left to the links sweep.

**Candidate fix:** when a decision-derived id is unreadable, skip it and fall through to evidence.

Related, measured (the system audit): 4 of the 7 system-failure handoffs recorded so far were "linked order
unreadable".

### F15. Test-data cleanup runs automatically in the live tenant on one setting (Safety)
**Status 26 Oct: DONE**, S-0214.
- maybeSweep runs only with both write keys and no pause (testData.ts:285-288; sync/route.ts:39).
- Every clear is logged (testData.ts:256-261).

### F22. A duration beside an end time is dropped (Wrong write, live path)
**Status 26 Oct: DONE**, S-0215 (test/v2WrongBookingPaths.ts). A length in words reads as one, and a grounded end with
a length sets start = end - length. "six hours ending 18:00" books 12:00-18:00, for a new shift and a change.

### F23. A model-picked shift can stand on the day alone (Wrong write, possible)
**Status 26 Oct: DONE**, S-0215.
- A pick on a change stands on its R number in the client's words, on the thread's link, or on its day plus one more
  fact with no rival that day.
- Otherwise it becomes a card naming every booking that day.
- The day alone never settles which booking a change is for.

### F24. A time change plus a new crew total in one email is refused (Blocked)
**Status 27 Oct: DONE** (S-0239). A count beside a time change written as a new total ("make it 8 crew") is grounded as
crew_set and planned as a second change; a bare count still names the shift. A position the crew change adds takes the
time change's new times (a chief added beside "start an hour earlier" was put at the old times).

### F25. Trade totals and reductions are refused (Blocked)
**Status 27 Oct: DONE for totals and reductions** (S-0239): set_position_size or cancel_position on the trade's one
position; none and a total adds it; two positions, or more removed than booked, hand off. "Forkies" now reads as a
forklift (it fell through to plain crew).
- Still open: trade-only shift additions on existing orders.

### F26. Extraction failures and interrupted plans are never recovered (Missed)
**Status 26 Oct: DONE for failed reads** (S-0235); resuming interrupted plans OPEN (R9).
- **Re-plan:** it still skips rows with no extraction (replan.ts:62) and passes run: null (:102).
- **Shipped S-0235:** a bounded re-read, retryUnread (test/retryUnread.ts). It reads again at 5, 15 and 45 minutes, at
  most 3 times, from the minute sync, once F29's in-call retry has failed.
- **Not built:** resuming a plan interrupted after some ops verified.
- **Measured** (the system audit, on the 26 Oct copy):
  - 7 of 223 handoffs are the system failing: 1 OpenRouter 429, 2 OnSinch 404 while planning, 4 linked order
    unreadable.
  - Of 61 bot runs from 12 to 20 Oct, 3 stopped part-way.
  - The 429 card (1a144c619a140ea6, 23 Oct) sat on the TV as Needs Created for 3 days.

### F27. "Yes, book that" always becomes a card (Blocked by design)
**Status 26 Oct: policy.**
- The owner ruled on 20 Oct that acceptances hand off.
- Held item 6 makes them a "confirm the order" card instead of "Needs Created". It needs the owner's and Paz's yes.
- Measured on dev: 88 fires, 1 false positive (eval/acceptance-study.md).

### F28. Create read-back doesn't check location, and creates skip the audit diff (Verification gap)
**Status 26 Oct: DONE for the venue**, S-0215. The create read-back compares each position's venue, and a position read
back with none does not match. Creates still skip the audit diff: by design, since there is nothing to diff.

### Lower priority, recorded for completeness
- **F16.** J is the order's first Job only (links.ts). Bot-created orders are single-Job, so only staff-built multi-Job
  orders are affected. **Status:** count them (Prompt 0).
- **F17.** Lease can lapse mid-operation. The 240 s lease is set against builder timeouts and up to three logins.
  **Status:** measure from the ledger (Prompt 0).
- **F18.** NOT_CLIENT filtered by substring (process.ts:161). **Status: DONE** S-0239: notClient by whole domain and mailbox
  name.
- **F19.** Dates are parsed dd/mm (ground.ts:255). That is right for UK clients. **Status:** keep, unless a US-format
  sender appears.
- **F20.** Re-plan has a 5-minute cache (replan.ts:32), a 20-card limit and a time budget. The TV can lag a staff edit.
- **F21.** Docs that have fallen behind the code. **Status: OPEN** (Prompt 8).
  - README.md:54 still names anthropic/claude-opus-4.6.
  - harness/STATE.md:9 still names opus-4.8.
  - app/lib/match/ is reachable from no live route.

### Added 26 October (found by the 24-26 Oct audits; each is code-verified at HEAD)

**F29. A failed model read is tried once and then never again (Missed, high). DONE S-0235.** test/extractRetry.ts: 429
then 200 makes 2 calls; three 5xx throw after 3; a dropped connection retries; 400, 401, 402 and 501 make 1 call.
- extract.ts:114-123 makes one attempt with a 60 s timeout. The old engine tried three times with backoff on 429/5xx
  (engine/reason.ts:245-285).
- A failed read becomes a red booking card that nothing reads again. The 23 Oct 429 card sat for 3 days.
- **Fix:**
  - three attempts in the call, backing off 400 ms then 1,200 ms with jitter, on 429, 5xx except 501, a timeout or a
    dropped connection;
  - never on 400, 401 or 402;
  - no attempt starts after 120 s;
  - plus retryUnread (F26).
- **Do not touch the prompt** (PROMPT_ID is its hash).
- **Fixture:** a stubbed fetch giving 429 then 200 makes 2 calls; three 5xx throw after 3; 402 makes 1 call.

**F30. The v2 path never tells the owner when the system itself fails (Alert, high). DONE S-0235.**
- app/lib/v2, feed, mail and api/bot contain no reportError, apart from intake's capture-failed and decide-threw.
- **Built and held:** systemFailureOf plus the system-failed alert (items-1-3-runtime). It covers:
  - a write stopped part-way;
  - the bot failing on OnSinch's page;
  - a contact OnSinch does not hold;
  - "could not read, plan or decide".
- **Fixture:** test/systemFailureToOwner.ts.

**F31. A pause throws mail away (Leak, high). DONE S-0235** (test/pauseStoresOnly.ts; test/automationPaused.ts [5]
reversed).
- SPARTAN_PAUSED=1 answers 503 at /api/n8n-inbound and /api/dedupe, before capture. The 21 Oct pause left 40 client
  emails unstored, beyond intake's 72 h catch-up.
- **Fix:**
  - under the v2 engine a pause keeps intake and dedupe open;
  - handleInbound captures and then marks the new ids store-only (a v2_store_only table), and decides nothing;
  - sweepUndecided skips store-only rows, so pause-time mail is never decided after the pause lifts. That matches the
    owner's store-only ruling.
- **Fixture:**
  - while paused, decide is never called and the mark exists;
  - after unpausing, the sweep skips marked mail and decides unmarked mail;
  - test/automationPaused.ts [5] reverses its intake check.

**F32. n8n is the single point of failure, and it runs this automation's heartbeats (Ops, high; owner ruling).
Code DONE S-0237; the switch-over waits on CRON_SECRET (§0 blocked item 1).** The heartbeat checks last capture (working
hours), the oldest undecided client email past 15 minutes, the last sync finish (5 minutes) and the last label
hand-out (10 minutes); a signal that cannot be read counts as stale. Each raises reportError route "heartbeat".
- n8n carries intake, the minute sync, labels, the watchdog and the alarm channel itself. If it stops, the owner hears
  nothing; staff see the TV's sync dot turn red after 90 quiet minutes.
- **The owner ruled on 26 Oct: no heartbeat for this automation runs in n8n, ever.**
- n8n schedules that break the rule:

  | workflow | id | schedule |
  |---|---|---|
  | Spartan Intake Watchdog | baVlgOkVMCpvj1N7 | every 15 min |
  | Spartan Sync | rfYGsZULF4PehLPm | every minute: sync, then labels |
  | the intake Gmail trigger | CPIRu7CpezvKjU8d | every 1 and 3 min, plus a 30-min sweep |
- **Fix:**
  1. Add `GET` with authorizeCronCall on /api/bot/sync, and a new /api/health/heartbeat. It checks:
     - last capture;
     - capture-to-decision lag;
     - the last sync finish;
     - the last label run.
  2. Add `vercel.json` crons: sync every minute, heartbeat every 5. September's crons ran here (6f9fd0e); the Pro plan
     allows per-minute.
  3. The sync stops answering ok:true over errors.
  4. **Labels** need the mailbox's Gmail credential, which only n8n holds until the Gmail grant. Until then the n8n Sync
     workflow becomes webhook-triggered, called by the cron after the sync. A webhook is not a heartbeat.
  5. **Order of the switch:**
     1. CRON_SECRET is set.
     2. Deploy.
     3. Three cron firings are seen.
     4. Deactivate the Watchdog.
     5. Convert Sync to the webhook form.
     6. Labels are seen to apply.
- **Blind spot until the Gmail grant:** alarms still go out through the n8n alarm webhook.
- Never run scripts/install-intake-watchdog-workflow.mjs again.

**F33. The old engine's one-click confirm wrote to OnSinch past the write switch (Safety, high).**
- **Status: DONE**, S-0232.
- /api/confirm-order (create, amend, delete-and-repost) never read bot_writes_enabled or SPARTAN_WRITES. 16 stale
  "proposed" tickets carried its button, 12 of them on live orders.
- It is now shut under v2 (paused.ts OLD_ENGINE_ROUTES; test/automationPaused.ts [6]).
- The 16 tickets are inert. Marking them dead is a production write.

**F34. Any signed-in staff member can flip the write and auto-reply switches, with no record (Safety, medium). DONE S-0240.**
- Settings writes bot_writes_enabled, replies_enabled and reply_delivery for any session (settings/route.ts:32-35).
- The settings row keeps no actor or history.
- isAdmin (session.ts:6) is checked nowhere.
- **Fix:**
  - admin-only;
  - a history row with actor and time;
  - an owner alert on every change.

**F35. Deciding an email again erased the record of what was sent (Record, medium). DONE S-0235.**
- The decision upsert writes executed as JSON null, and coalesce keeps it, so a replay through /api/bot/process erased
  the only account of what reached OnSinch.
- **Built and held** in items-1-3-runtime: processMessage refuses an email with something sent.
- **Fixture:** test/replayKeepsWriteRecord.ts.

**F36. OnSinch's zone-less audit times were read in the machine's zone (Scoring). DONE S-0235.**
- OnSinch writes "2026-10-23 07:30:00" in UTC: 1,810 of 1,813 in summer time.
- **Built and held** in items-1-3-runtime. It affects scoring only.
- **Fixture:** test/zonelessIsUtc.ts.

**F37. The minute sync reports success whatever happened, and labels count as applied before Gmail applies them
(Observability, medium). DONE for the sync S-0237; the label half stays.**
- The sync's errors are folded under ok:true (sync/route.ts).
- A label is marked applied when handed out (labels/route.ts:55-60).
- The hourly full resend is capped at 150 threads.

**F38. A deploy within 6 hours of a stopped write cancels its retry, with no record (Missed, medium).**
- retryStopped re-runs only decisions made by the current build (process.ts:124-130).

**F39. A write that stops part-way raises no alarm (Alert, medium).**
- By design an unknown is never re-sent. But 3 of 61 runs stopped part-way, and nobody was told.
- F30's systemFailureOf covers it, shipped S-0235.

**F40. Most mail is set aside by one model reading (Recall, high).**
- 419 of 958 decisions (44%) are "no change asked for", and never reach the TV (the system audit, on the 26 Oct copy).
- On the current reader's labelled mail, 7 of 17 silent misses are such readings (eval/reader-diagnostic/).
- **Fix:** a prompt change. It needs the owner's yes and a capped paid run (about $1-3).
- **Measure first** with the email-to-board harness (R10) to see whether a better reading fixes the board.
- **Measured, R10 (S-0248):** of its 20 cases, 2 are read as nothing asked by production's reader and by a Haiku
  subagent alike (1a1540528d5a2d27, 1a168d83b151f870, the second a known prospective-1 miss). Another model on the same
  prompt did not fix them, which points at the prompt, not the model. Twenty cases cannot size it.

**F41. Needs Reply cards that carry booking work are not listed (Recall, high; F2's open half).**
- They are 7 of the current reader's 17 misses.
- Held item 8 lists reply cards that ask for crew. That is a TV change, so it needs the owner's and Paz's yes.

**F42. Old open needs never age off the TV (Display, medium).**
- Needs from 13, 15 and 19 Oct are still open.
- The proposal is audit/display-proposals.md §A:
  - every exit is marked;
  - a passed day with an open need counts as a miss.
- It needs the owner's and Paz's yes.

**F43. The Gmail-API intake already written feeds only the old engine (Intake, medium). DONE, dormant, S-0250.**
- **As built (R14):** the thread ids already matched: the poll stores Gmail's bare ids, as n8n does
  (test/oneConversationOneThreadId.ts; 7,509 of the gold copy's 7,510 messages carry them, the other is test mail).
  mail/pollIntake.ts settlePolled hands each thread's undecided client mail to decideDelivery, once per thread,
  whichever intake stored it first. Paused, it marks what it stored store-only. In shadow it decides nothing.
  n8n-inbound stores and decides nothing under INTAKE_PATH=routing. The middleware's shut list, which held
  /api/mail-poll alone, is gone. Without GMAIL_SA_* the route still answers idle (test/mailPollIntake.ts).
- **Switch-on:** the route's header lists it: grant, Gmail API, verify, env, a vercel.json cron for /api/mail-poll,
  INTAKE_PATH=routing in the same deploy, then n8n's Gmail trigger off. A long shadow sends n8n's deliveries to the
  undecided sweep, behind a card, because the poll stored their messages first.
- **Still after the grant:** labels and alarms leave n8n (the labels workflow applies /api/bot/labels with n8n's
  Gmail credential today).
- mail-poll/route.ts calls handleThread.
- **Fix:** call decideDelivery, keep the INTAKE_PATH interlock, and map Gmail's threadId to the stored thread id first.
  fad7c0f found that mail-poll would give every existing conversation a second thread id.
- It stays dormant until the Gmail grant.

**F44. Preview shares the production database, and the schema is made at request time (Process, medium). DONE for the
schema S-0240; Preview's branch OPEN (needs access).**
- There are 33 CREATE TABLE IF NOT EXISTS and 18 ALTER statements in 25 files.
- **Fix:**
  - one ordered migrations module with a schema_migrations table, idempotent on the current production schema;
  - a Neon branch for Preview, which needs access.

**F45. The paused old engine is 40% of the app (16,095 lines), and 145 of 219 test files guard it (Maintainability,
medium).**
- v2 imports it in 26 places: the OnSinch client, the resolver, the verifier helpers.
- 12 files are reachable from nothing.
- See §10.

**F48. A failed test file passed the gate (Process, high). DONE S-0242.** Added 27 Oct.
- test/all.ts counts a file failed only by its exit code. PGlite's start-up ends in Postgres's own exit, and
  emscripten writes that 0 to process.exitCode. So from S-0213, when the suite moved onto PGlite, a file whose
  failure was recorded before or during the start-up exited 0 and the gate counted it passed. 58 of 226 files report
  failure that way.
- **Measured:** one file was hiding a failure: routeHandlers' settings case, red since R6 (S-0240) made the switches
  an admin's. The test was wrong, not the code (it posted a switch change with no caller).
- **Fix:** harness/sim/pg.ts starts PGlite on first use, and for the start-up the global `process` is a view on which
  a 0 cannot overwrite a failure (Node will not let exitCode itself be redefined). test/exitCodeSurvivesPglite.ts
  runs a file failing before and during the start-up: red on the old sim, green now.
- Also: package.json had 36 one-file test scripts that ran tsx without the preload, so a single run could reach the
  database .env.local names (the 27 Oct incident's path). They are gone; `npm test -- test/x.ts` runs one file on
  PGlite.

**F49 to F54: found by the V1 review (R15, 27 Oct), each checked against the code.** The review: https://claude.ai/artifact/A3WyEdpcXRcehHoJVb6BQe
- **F49. A death inside a write's first operation is never resumed (Write, high once writes are on).** resume.ts:64
  takes only rows whose `executed` is an array, and the first record writes it as JSON null (process.ts:404). The
  ledger then holds intent or submitted, and the card shows a need for work OnSinch may hold. **DONE S-0254:** resume
  also takes a write with no result, and closes it as unknown when its first operation's ledger row has been still for
  RESUME_AFTER_MS. With no ledger row it is left: a write with no result is also every shadow decision, and taking
  those would run the last 6 hours' shadow plans the moment writes go on (test/resumeStopped.ts [3b] pins both).
- **F50. The decision upsert's `coalesce` never keeps a stored record (Write, medium).** `JSON.stringify(null)::jsonb`
  is a JSON null, not SQL NULL, so it overwrites the array (tested on PGlite). Only the non-atomic pre-check at
  process.ts:524 guards a replay. **DONE S-0254:** recordDecision (process.ts) writes no result as SQL NULL, so
  `coalesce` keeps a write's record; test/replayKeepsWriteRecord.ts drives it past the guard, with the old form as control.
- **F51. A thread's link takes new shifts whatever days its order holds (Wrong booking, owner decision).**
  identity/index.ts:137. A client reusing an old thread for a new job gets shifts on the old order. **Proposal:** the
  link takes new shifts only when its order holds an asked day or the venue.
- **F52. Behaviour is keyed to reason wording (Process, medium). DONE S-0256.** Retries, the sweep's claim, resume and the TV
  match stored reason text. **As done:** decisions carry their code since 24 Oct, so no column was needed. The TV's reply
  test and the planner's ask test kept their own copies of the words, and both had lost the venue form reasons.ts holds;
  they now ask reasons.ts (isReplyReason, isMissingDetail). The sweep's not-a-client test reads the stored code, with the
  one wording (NOT_CLIENT) for rows older than codes. The retry's "could not read" and the sweep's own claim match
  words written from one constant in the same file, so they cannot drift apart. resume.ts TRANSIENT reads the bot's error
  words, not a decision's. cardNote.ts words the card from the reason, which is display, not behaviour.
- **F53. The minute reads grow with history (Process, low now).** The re-plan and the TV read every decision since
  9 Oct, every minute. **Fix:** open cards and recent days only.
  **Measured 28 Oct (R20, read only):** the re-plan reads 324 write and hand-off rows, about 400 KB of JSON a minute, half
  of it readings only the 20 re-planned cards need; it grows about 17 rows a day. The TV's inbound() reads four small
  columns of 7,712 messages, about 460 KB a refresh. Neither is a cost yet, and narrowing the re-plan's read means
  splitting a query fixed two days ago (S-0252). **Trigger:** do it when write and hand-off rows since 9 Oct pass 3,000,
  or the sync's re-plan step stops at its 90-second budget (its note says "stopped at the time budget").
- **F54. The n8n path cannot see our unsent drafts (Display, low).** n8n sends no label ids, so a draft of ours can
  count as a reply in the reply lanes. Pinned as a known hole by test/draftIsNotAMessage.ts [5].

**F46. In-Reply-To and References are stored but read nowhere on the v2 path (Matching, low). MEASURED 28 Oct, not built.**
- They have been stored since 23 Oct.
- They are the cheapest thread-to-order signal there is (5.7).
- **Measured** (gold copy, $0): 395 messages carry them. The parent of 380 is in the same Gmail thread, which the identity
  ladder already reads; 13 parents were never stored; 2 sit in another thread, both client replies. Reading the headers
  would add a signal for 2 of 395 (0.5%). threadMessagesDb.ts threadIdForMessageIds is kept for it should that grow.

**F47. Planner faults on current mail (Wrong write, measured in replay). Held n2-planner-ops shipped S-0239.**

Of 20 writes replayed on the current reader's mail (dev-2):
- at HEAD: 7 completed, 2 partial, 11 wrong;
- with the held stack: 10 / 2 / 8.

What is still wrong:
- **shift shapes, 3:** three 1 h shifts for staff's two 2 h; an end of 01:00 for 03:00; "15th" read as this month;
- **crew mix or venue, 3**;
- **the crew-chief rule, 1:** "add 3" to a shift of 1. A §6 question;
- **a cancel staff did not make, 1.**

Held n2-planner-ops hands 4 dev writes to a person instead of writing them wrong:
- re-timing one named role moves only that role;
- a crew change with its own hours hands off;
- two changes to one shift hand off.

Creates go to To Confirm, where staff complete them.

---

## 4. What the change log says about accuracy, and the limits of the scoring

| Measure | Result | Source |
|---|---|---|
| Harness, 500 generated emails, production model | 494/500, 0 wrong writes | harness/STATE.md, S-0155 |
| Harness, 1,000 complex generated emails, perfect reader | 500/500 each set | S-0157 |
| Shadow day 1 vs ops | 3/3 writes match, 0 wrong | S-0149 |
| Real emails 9–11 Oct | 14 written, all match ops; 24 Needs Reply; 8 left for a person | S-0163 |
| Re-planned vs ops 9–13 Oct | 36/58 raw, then 45/50 and 47/53 after labelling truth-noise | S-0172, S-0175 |
| Live week 9–14 Oct (week-review) | 75 of 80 not done by the system | S-0177 |
| After switching the reader to GPT-6.1 Sol | 9/22 vs ops (9/15 allowed), up from 2/22 | S-0189 |
| Dead or wrong order numbers on the TV | 184 → 0 of 201 | S-0205 |
| **Added 26 Oct.** Harness with the world fixed, perfect reader | simple 304/500, create 171, update 154 (expected answers predate four rulings; floors in the gate) | S-0216 |
| **Strict scorer, live week 14–21 Oct** | wrong writes 2; coverage 7/108; missed changes 32; lost emails 0. Largest handoff codes: reading_unproven 34, none_already_booked 17 | S-0217 |
| Real mail, labelled blind by two readers (799 emails) | dev recall: production 65.2%, HEAD 71.2% | S-0224, S-0225 |
| Prospective set, mail after 22 Oct, locked before any step read it (79 emails) | 20 of 24 inquiries produce an item, in every column; all 4 misses are the reader's "nothing asked for" | S-0226 |
| Current reader's dev window, 16-25 Oct (107 inquiries) | 90/107 = 84.1% produce an item (CI 75.8-90.5) | eval/dev-windows.md |
| item_correctness (items shown with the right order and change) | 8/152 at HEAD: cards carry no change, and writes are off | eval/item-correctness.md |
| Replayed writes on current mail (dev-2, 20) | HEAD 7 completed / 2 partial / 11 wrong; with the held stack 10 / 2 / 8 | eval/phase-c.md |

**Why the numbers to 23 Oct were hard to compare** (Nico; status per point):
- **score-vs-ops credited the shape of a plan, not its values.** DONE S-0217: app/lib/v2/score.ts judges by value.
- **Replays read a retired link table** (conversation_state), and saw today's state of older orders. DONE S-0217 for
  the links. The time-correct world is DONE in harness/real (25 Oct), which rolls OnSinch back to each email's arrival.
- **week-review could call a half-finished plan done.** DONE S-0217 (fullyWritten shared with metrics.ts).
- **The recorded harness dropped the reader's context.** DONE S-0216. The 500 recorded readings need re-recording with
  context: a paid run, the owner's call.
- **The same weeks were used to tune and to score.** DONE in method since 25 Oct:
  - dev and test splits;
  - a prospective set locked before use;
  - W2 is next, and E3 (from 29 Oct) is held out.
- **The live model** is openai/gpt-6.1-sol, confirmed by the stored decisions since 16 Oct.

---

## 5. Solutions, in order

These aren't only bug fixes. Together they change how the system decides what an email means and which booking it's
about.

**Today:** the reader extracts values, a separate grounding step re-checks them with its own narrower parsers, and four
components each answer "which booking" with their own rules. Any one refusal vetoes the whole email.

**Target:**
- One request model that can hold what clients actually ask for: duration, combined changes, trade counts (5.4).
- One candidate resolver that every step shares (5.3).
- Every unresolved request tracked until it's done (5.6).
- Near-misses turned into one-click confirms (5.8), and every confirm or correction fed back as a test case.

**What stays:** the write path and its safeguards don't change.

### 5.1 Repair the scoring, then run it weekly on held-out mail (prerequisite)
**Status 26 Oct: DONE** (S-0216, S-0217).
- **Not yet:** the weekly run on last week's untouched mail.
- **Add:** report the real-mail harness's recall beside the four numbers.

What was built:
- Score exact operations, not shapes.
- Read links from linkedOrderId.
- Share metrics.ts's full-execution check with week-review.
- Forward the fifth context argument.
- Report four numbers separately: wrong writes (target 0), coverage, missed changes, lost emails.
- Count policy handoffs and defaults separately.
- Write stable reason codes into each decision.
- Read only inside READ ONLY transactions (scripts/_readonly.mts).

**Proves it:** planted wrong-count, wrong-venue, extra-op and half-executed cases fail the scorer (test/scoreStrict.ts).

### 5.2 Switch on the live trace
**Status 27 Oct: DONE** (S-0249).
- app/lib/v2/traceLive.ts writes each step (filter, extract, ground, plan, run, final) to v2_trace, after the
  decision is made, so a function cannot end before its rows land. Intake traces every email it decides; the minute
  re-plan traces only an answer that changed.
- Any address in an event is a salted SHA-256 (SPARTAN_TRACE_SALT); until the owner sets a salt it is "[address]".
  No email text is handed to a trace. pruneTrace, in the minute sync, deletes rows past 90 days.
- A row that cannot be written is dropped and counted; the decision is unchanged (test/liveTrace.ts).
- **Found by it, first hour live (S-0252):** the re-plan traced 86 different emails in 5 minutes. It compared the
  stored answer with the new one as JSON strings, and Postgres returns JSONB with its keys reordered. So every open
  card counted as changed and was rewritten every minute, from the day the re-plan was built (20 Oct). The answers
  themselves were right; the count and the writes were not. replan.ts sameAnswer compares by content
  (test/replanSameAnswer.ts goes red with the old comparison).
  SPARTAN_TRACE=off stops it. harness/DATA_POLICY.md's live mode says the same.

harness/DATA_POLICY.md already defines a safe live mode: hashed senders, no email text, quotes kept, 90-day retention.
With it on, each weekly miss shows which step chose wrong: extract, ground, plan or run.

### 5.3 One shared, corroborated candidate list (F9, F10, F11, F23; the main coverage lever)
**Status 26 Oct: OPEN.**
- F23's half is DONE: a pick needs its day plus one fact.
- Held C1 (the venue rule) and held item 7 (shared domains) belong inside this resolver, not beside it.

Today the model pick, findOrder evidence, threadOrder links, bookedAt and coveredBy each answer "which order or shift is
this" with different rules. The reader also sees at most 20 nearby bookings, and none at all when the company is
unmatched.

The fix:
- Before the model call, pull reference, day and venue evidence from the email.
- Always include explicitly referenced and validly linked orders in the candidate list, then fill the rest up to the
  cap.
- Resolve written venue names to place ids before scoring.
- Use the same typed result for validating the model's pick and for planner targeting.
- Include location in bookedAt, targetShift and create read-back whenever an order has more than one location.
- If two candidates fit, hand off and list both on the card. If none fits exactly but one is near, hand off as
  "possible duplicate" instead of creating.
- Keep "staff already did this" separate from "the exact request is complete".

**Risk:** a wider pool can create false links, so generic venues like "No Location" must never count as evidence.

**Proves it:**
- competing same-day jobs;
- the same crew at different venues;
- a referenced order beyond the 20 cap;
- a known venue with no start or count;
- moved or deleted links.

Then fewer identity handoffs on the held-out week, with no new wrong targets.

### 5.4 Represent requests faithfully (F22, F24, F25)
**Status 27 Oct: DONE** (S-0239).
- F22 S-0215; F24, F25, F8 and the schema check S-0239: a malformed reading is one recorded "could not read" card, so
  retryUnread reads it again.
- Held item 5 (the parser: "Duration: N", "28-Nov", ranges and lists of days; 1,336 stored quotes, +13 grounded, 0
  lost) shipped S-0239.
- Found while building it: a reading's pick of an order the client wrote as "R11100" was refused, because the check
  wanted a word boundary between R and the digits. It now reads R numbers as findOrder does.
- **Measured** (harness/real/writes-run.ts on dev-2, $0, offline): HEAD 20 writes, 10 completed, 2 partial, 8 wrong; with
  R5 22 writes, 11 completed, 2 partial, 9 wrong. The new completed is a PO. The new wrong is a create that "28-Nov"
  made possible: its shifts are staff's exactly (days, times, venue, 5 crew and a chief), but on one order where staff
  made two. Creates go to To Confirm. The held-out week (E3, from 29 Oct) is not read until a fix is frozen.

The fix:
- Keep duration as its own fact.
- Split combined changes.
- Allow trade totals and reductions on a uniquely matched trade position.
- Add narrow date formats such as 20-Nov.
- Validate the extraction schema before grounding.

**Proves it:**
- "six hours ending 18:00" gives 12:00–18:00 (passes);
- "move to 10:00 and make it 8 crew";
- "make it 3 forkies";
- 20-Nov.

### 5.5 Recover interrupted work safely (F1, F26)
**Status 26 Oct:**
- The ingestion half is DONE (F1).
- The bounded re-read is built and held (retryUnread → R1).
- Reconcile-and-resume is OPEN.

The rest of the fix: after an interruption, reconcile planned ops against the ledger, and resume only definitely-unsent
ops after re-reading the target, staff edits and policy. An unknown is reconciled, never replayed.

### 5.6 Keep every unresolved request visible (F2)
**Status 26 Oct:**
- Every need is kept per card (S-0214).
- An outbound email clears only Needs Reply (S-0214).
- The pause covers sync and test cleanup (S-0214).
- **OPEN:** the Needs Reply lane (F41) and aging (F42), both TV changes for the owner and Paz.
- Per-obligation storage with supersession is not built. The card-level rowsOnCard does the job for now.

### 5.7 Let Spartan's own emails carry the order number (test first)
**Status 27 Oct: COUNTED;** the change waits on the owner's yes.
- **Measured** (.tmp-v2/r57.mts on the gold copy, read only): 6 of 958 decisions end "order not identified" or
  "not found". 5 of the 6 replied in a thread where Spartan had written, 1 began a thread, and none answered only
  the client's own mail. In none of the 5 did a Spartan subject carry an R number. So an R number in our subjects
  would reach 5 of the 6, which is 0.5% of decisions: small, and it touches mail clients read.
- Headers are stored since 23 Oct (F46).
- A change to outbound mail needs the owner's yes.
- **Test first:** from the "order not identified" cases, count how many were replies to a Spartan email versus fresh
  threads.

### 5.8 Assisted mode and the learning loop, if the corrected tally supports it
**Status 27 Oct: DESIGNED** (S-0251, docs/ASSISTED-MODE-DESIGN-2026-10-27.md); the build needs the owner's and Paz's yes.
- **Measured** (dev replay at bc3944b, $0): 155 handoffs. 58 are a complete plan held only by policy (lead days 54,
  a confirmed proposal 4), and at most 32 more have one fact unproven with a candidate in hand. So at most 90 (58%)
  are near-misses, which meets Prompt 7's condition at its upper bound. Class A goes first: its card carries exactly
  the ops the bot would have run.
- audit/workflow-proposal.md has related groundwork: a tick today only adds a mark.

If most handoffs turn out to be "a likely candidate, not proven", a card with the change pre-filled and a Confirm button
turns them into completed work through the same runOp path. The ledger, read-back and To Confirm stay unchanged. Each
Confirm, Edit or Reject is a labelled example. Before any prompt or model change ships, it must pass every past case.

### 5.9 Explicit acceptance of a proposal (policy, F27)
**Status 26 Oct:** policy. The owner ruled on 20 Oct that acceptances hand off; held item 6 is the card form.

If Spartan wants it automated:
1. Link the acceptance to one stored, unfulfilled proposal.
2. Check it wasn't superseded or already booked.
3. Apply current policy.
4. Agree it with Spartan first.

### 5.10 Smaller code improvements
**Status 26 Oct:**

| item | status |
|---|---|
| comments and docs: run.ts:5, README, harness STATE | DONE (S-0236, S-0239) |
| paused.ts header | updated S-0214, S-0232 |
| allCompanies().catch(() => []) should block (F13) | DONE S-0239 |
| skip dead decision-derived order ids (F14) | DONE S-0239 |
| gate test-data cleanup (F15) | DONE |
| tests on their own database (F7) | DONE |
| preview on its own database (F44) | OPEN: the steps are in §11 Prompt 11; the schema module is DONE S-0240 |
| NOT_CLIENT by whole domain (F18) | DONE S-0239 |
| measure lease duration (F17) | DONE S-0238: 0 of 159 over 180 s |
| canonicalise the op key recursively | DONE S-0239: keys sorted at every depth; a flat op's key is unchanged, and runOp also asks for legacyOpKey, so no ledger row is orphaned |
| business rules as data | after §6 |

---

## 6. Rules to settle with Spartan (one short session)

**Status 28 Oct:** 1 to 4 ruled by the owner (DECISIONS O7, O8, O9, O12; §12.7 says when each reaches the code):
the two-week rule covers changes, counted from the email's date, as a setting; a new client's first order is allowed;
a moved start keeps the end; "yes, book that" drafts the order and hands off. 5 is answered by O9: rules decide what
is automatic, every hand-off carries a plan and a Confirm. 7: in the one case measured, staff added no chief (§12.1,
question 8, 1a158a5e6bd47095); still open. 6, 8 and 9 are open. Open since: is a PO a change under the two-week rule (§12.8)?

**Status 26 Oct:** all OPEN; none is in DECISIONS.md yet.
1. **The two-week rule:** new orders only, or changes too? Counted from the email's date or from today? (F5)
2. **New clients:** can the system ever create a brand-new client's first order, or does a new client always go to a
   person? (F6)
3. **Start-only moves:** when a change moves only the start, the code keeps the shift's length (S-0186). Confirm that's
   what Spartan wants.
4. **"Yes, book that":** should an explicit acceptance of a Spartan proposal be automated (5.9)? Ruled 20 Oct to hand
   off; still open for Spartan.
5. **Always a person:** what goes to a person regardless of confidence? For example: same-day changes, crew-chief
   changes, cancellations.
6. **CCs and old threads:** what should happen when a client CCs another company, or replies on an old thread about a
   new job?
7. **Added 26 Oct, the crew chief:** does a client's "add 3" to a shift of 1 get a crew chief? It is the only wrong
   write that reached production (20 Oct).
8. **Added 26 Oct, direct booking:** may the system book directly when confident, and what should a tick on the TV do
   in OnSinch?
9. **Added 26 Oct, crew notices:** do edits or new positions notify crew? An admin can read OnSinch's notification
   settings at $0.

Write the answers into DECISIONS.md so the planner and harness can cite them.

---

## 7. What would help

**Before 31 Oct: renew the n8n key.** The overview flags it. It is still open, and still needed while intake runs on n8n.

**Status 26 Oct:**
- Read-only database access is solved by scripts/_readonly.mts: READ ONLY transactions, proven by a refused UPDATE.
- Vercel access for this agent is refused (403 on the project's team).
- What is still needed: CRON_SECRET, the Gmail grant and a Preview branch (§0).

**What Prompt 0 counts. Measured 27 Oct (S-0238),** over the 30 days to 27 Oct 02:49Z, by `scripts/size-findings.mts`
(READ ONLY on the database, GETs only on OnSinch; F8/F9 also reads `scripts/ops-truth.mts`'s output, passed as
`--truth`). Re-run both to refresh. No address, name or body is printed.

| Count | Sizes | Measured 27 Oct (how) |
|---|---|---|
| Client thread_messages with no v2_decisions row | F1 | 10 of 958 since 9 Oct, all non-client mail from before the 11 Oct fix; 0 in the strict week (26 Oct audit) |
| Threads with two or more handoffs, and of those, threads no order was ever linked to | F2 | **46 threads; 18 with no order linked** (job_links). A proxy for "the first was never booked" |
| "Already booked" / "already as asked" decisions that staff then acted on | F8, F9 | **41 such decisions (34 / 7); staff created (3) or updated (15) an order of that client within 36 h after 18 of them** (ops-truth). An upper bound: the action need not be on the same shift |
| Bot edits that landed on a different venue's shift than the email named | F10 | **0.** 116 verified bot edits; 20 tie to a client email's plan (the rest are bench and test runs); none was on an order with more than one venue |
| Companies sharing a name | F13 | **3 name groups, 6 companies, of 814.** OnSinch's company record carries no creator, so the bot's share cannot be read from it |
| Orders with more than one Job | F16 | **3 of 338 staff-built orders created in the period (0.9%);** 0 of the 2 bot-built |
| Ledger runs longer than 180 s from claim to last update | F17 | **0 of 159.** Longest 51 s, median 17 s: the 240 s lease has not lapsed |
| "Not a client" decisions the substring rule set aside that a whole-domain rule would not | F18 | **1 of 64** (51 of the 64 were noreply or OnSinch mail) |
| Readings that picked an R number, and picks the email's own words do not hold | F23 | **95 decisions with a pick; in 75 the number is not in the email; 19 of those were writes** (before S-0215's rule). Days with two bookings not counted |
| Decisions with no reading; the system's own read failures | F26 | **148 with no reading** (filtered or carded before a read); **0 "could not read"** in the period. 3 of 61 bot runs stopped part-way (26 Oct audit) |
| Every decision by its code (derived from the reason before codes were stamped) | 5.3, 5.4 | **994 decisions: 680 none, 227 handoff, 87 write.** Handoffs: reading_unproven 76, reply_detail_missing 33, other 23, policy_lead_days 19, reply_quote 15, reply_unclear 13, client_unknown 13, request_unsupported 12, venue_not_identified 7, booking_not_identified 6, booking_link_unreadable 4, request_inconsistent 3, system_failed 2, partly_booked 1 |
| The real-email scoreboard (scripts/real-email-scoreboard.mts, every stored email since 9 Oct re-planned by HEAD) | 5.1 | **837 emails; 194 needing action; 27 written; 37 reply needed; 130 orders left for a person (83% of order work).** Its tally: reading_unproven 57, write 27, policy_lead_days 23, reply_detail_missing 22, policy_confirmed_proposal 13, reply_unclear 12, booking_link_unreadable 8, booking_not_identified 7, request_unsupported 6, request_inconsistent 5, client_unknown 5, booking_not_found 3, reply_quote 3, policy_past_day 2, venue_not_identified 1 |
| SPARTAN_INTERPRET_MODEL in production | | **Not readable here** (Vercel 403). Every stored reading since 16 Oct names openai/gpt-6.1-sol with prompt extract@f3e1a862322b (388 of 388), which is also the code's default, so set-or-unset cannot be told from the data |

---

## 8. What Nico was confident about, and what not

**How it was checked:**
- Claude Opus did the first pass.
- Claude Fable tried to disprove it, corrected F10, and added F4, F6, F8 and F11 to F15.
- GPT-6 Astra audited the code separately.
- Fable checked Astra's 14 claims: 12 confirmed, 2 partly, none refuted.

**Confident:** the mechanisms in F1 to F15 and F22 to F28 exist at 0f2dcef, and the scoring tools over-credit as listed
in section 4.

**Status 26 Oct:**
- Every mechanism was confirmed. Those fixed since each had a test that failed at 0f2dcef first.
- Of the "not yet known" list:
  - **whether the live system runs this commit:** answered. Production ran 305bf84's app code until S-0232.
  - **frequency:** partly answered (§7).
  - **how much 5.3 and 5.4 recover:** still unknown. The email-to-board harness (R10) will measure it.

**Plainly (Nico):**
- The leak fixes (F1 to F3), the process fixes (F7, F15) and the two wrong-write paths (F22, F23) were clear and worth
  making now. **All are done, except F3's auth half.**
- 5.3 and 5.4 are the most likely route to the system doing more of the work, and the corrected scorer is what proves
  it.
- This is not a redesign, and nothing here argues for loosening the write safeguards.

---

## 9. Prompts for your agent

Give your agent this whole file, then one prompt at a time, in the order of §11. Each prompt ends when its "Done when"
list is true and the owner has reviewed the result. Don't run several at once: they touch the same files.

**Prompt status 26 Oct:**

| prompt | status |
|---|---|
| 0 | DONE (S-0238); §7 |
| 1 | DONE (S-0214) |
| 2 | DONE (S-0215) |
| 3 | DONE (S-0216, S-0217) |
| 4 | OPEN |
| 5 | DONE (S-0239) |
| 6 | half held (re-read), half OPEN (resume) |
| 7 | OPEN (design) |
| 8 | DONE (S-0236) |
| 9 | DONE (S-0235) |
| 10 | code DONE (S-0237); switch-over waits on CRON_SECRET |
| 11 | DONE (S-0240); Preview's branch waits on access |
| 12-13 | new, §11 |

**Rules for every task:**
- Read ADDENDUM.md first. Re-find each line reference at HEAD before editing, and say what moved.
- Treat every finding as a claim to verify. If the code disagrees with the addendum, stop and report the difference
  instead of fixing.
- Write the failing test or harness case first, show it failing, then fix, then show it passing.
- Keep every safeguard in section 2 of the addendum. Never loosen a refusal to raise coverage.
- Never run tests or scripts against the production DATABASE_URL. Use a Neon branch, PGlite or scripts/_readonly.mts.
  Never call OnSinch write paths, /api/bot/*, or the canary.
- Never print email bodies, addresses or client names. Report counts, ids and code locations only.
- Ship only through scripts/session.py. Then update this file: the item's status line, §0's table, and any measurement.
- Finish with: what changed, the tests added, the commands you ran and their output, and anything left undone.

### Prompt 0: size the findings (read-only, run first): **DONE**, S-0238 (§7)
**Goal:** measure how often each finding actually happens, without changing anything.
1. Connect read-only (scripts/_readonly.mts proves it with a refused UPDATE).
2. For the last 30 days, compute each count in §7's table that is still "not counted". SELECT only.
3. Run scripts/real-email-scoreboard.mts, which reads only (S-0217), and include the handoff-code tally.
4. Report whether SPARTAN_INTERPRET_MODEL is set in production: set or unset, never a value.

**Done when:** §7's table is complete, with the query and period for each count. No email text, addresses or names
appear anywhere.

### Prompt 1: stop losing work (F1, F2, F3, F15): **DONE**, S-0214

### Prompt 2: close the two wrong-booking paths (F22, F23, F28): **DONE**, S-0215

### Prompt 3: make the scoreboard strict (5.1): **DONE**, S-0216, S-0217

### Prompt 4: one shared booking finder (5.3, F9, F10, F11, F12): **a to d DONE**, S-0244 to S-0246; e held
**The map (step 1)** went to the owner before any change: claude.ai/artifact/6VWRB2Ymd3pst5QTbdL4zG. 18 places
answered "which order"; the build order there is a to e.
**As run, a and b (S-0244):**
- app/lib/v2/identity/index.ts: refsIn (every R and J number by where it stands: the email's words or subject, an
  earlier client email, our reply, quoted text), identify (one ladder; answers one, several or none) and covered.
- The planner asks it for every order it finds (findOrder, settle, the history check, the company fallback), and the
  thread state's findOrder and coveredBy are it. evidence.ts's evidenceMatch is deleted; one matcher is left.
- F11: a number in quoted text decides only when a day is asked and its order holds it. The first cut said quoted
  never decides; the dev replay showed it lost a correct write: Harbour Scenic's R11508 stood only in the quote of
  our confirmation (1a1308b99b2eaf9b), and ops added the email's shifts to it.
- F9's loose half: "covered" identifies each request among everything the client has that day, so two same-day
  jobs with the same crew do not both cover a third; several count only when all were made after the email (a
  quote's options). A generic place ("No Location", "TBC") is never the venue fact.
- F12 and held item 7: To and Cc widen the search only when no sender names a company and they name exactly one; a
  domain 2 or 3 companies share is settled by the company the email names.
- An R number in the email's words is still checked against OnSinch first: not held, or another client's, is said.
- Two orders named in the email itself still go to a person, whatever days they hold ("For R1 and R2, could the shift
  on Friday be 8-4?"; the harness gate's simple set fell 304 to 299 when the days decided). The answer then carries
  a lead, the one holding a day asked, which a card may name and nothing writes to: without it, Harbour Scenic's
  email naming four orders (1a1309f7f0000dee) became Needs Created for an order that exists.
- **Measured** (harness/real/run.ts --mode replay, dev, 561 emails, $0, against HEAD's planner on the same data):
  one email changed, client_unknown 6 to 5 (its client found; still a staff create inside 14 days). Writes 24 and 24,
  every write the same. The dev-2 write replay is unchanged: 22 writes, 11 completed, 2 partial, 9 wrong.
**As run, c (S-0245):**
- F10: identity atVenue. On an order standing at several places, bookedAt and targetShift count only the shifts at
  the venue the email names (its picked place, else its words through placesFor). "Make the ExCeL call 6 crew" on
  an order with the same window at Olympia and ExCeL changed whichever came first; a new ExCeL shift read as already
  booked by Olympia's.
- F9's strict half: identity nearStart. No shift at the asked start, but one that day starting within 60 minutes
  (NEAR_MINUTES): "possibly the same booking", a person's (code booking_near_miss). On a named order its own venue
  counts; on the unnamed path the shift must stand at the venue the email names. The first cut took any venue, and
  the dev replay showed it naming another job of a client who runs several a day (1a13b915f3a326a3, a new booking
  staff made R11588 for).
- Held C1: placesFor finds the client's own place written in more or fewer words, else the one OnSinch place that
  fits them; a create so placed says so.
- **Measured:** test/v2Shifts.ts fails 4 of 6 on S-0244's planner and passes now. The dev replay (561 emails) is the
  same as S-0244's, email for email; the dev-2 write replay is unchanged (22: 11 completed, 2 partial, 9 wrong); the
  harness gate's sets hold their floors. None of the replayed mail meets these cases, so the gain is in the tests.
**As run, d (S-0246):**
- feed/verify.ts finds the order for a need nothing bound by the planner's rule: the orders whose job span covers
  the days are read in full, and identify picks the one the day and one more fact single out. The span only chooses
  what is read: a stale window can miss an order, never pick a wrong one. Its reference find, and the sender's name
  for a client with no company, stay as they were.
- Gone: the old engine's matchExistingOrder, run here first, which found a client's only order that day with nothing
  else in common (test/feedVerify.ts [6] expected that; it now expects Ben's rule, and a venue to find it). Nothing
  live calls it; the other old matchers in onsinch/resolve.ts are called by nothing live either and stay until a
  reason to remove them.
- **Measured** (production feed_marks, read-only): of the verifier's 47 matched finds since 5 Oct, 20 came from the
  old matcher ("date and venue", the last on 20 Oct), 18 by reference, 5 by the day alone (stopped 12 Oct), 4 by
  venue or shift times. A find the new rule does not make leaves the card open for a person: the safe direction,
  since a wrong find turns a real job green. Since 21 Oct a find closes a card and names nothing on the screen.
- **Held, e:** the reader's list (referenced and linked orders always shown, then the nearest 20) changes what the
  model reads; it is built only with the owner's yes to a paid measurement (about $1-3, as F40).

**Goal:** every step answers "which order and shift is this?" with the same rule, so fewer emails are handed off and
none are matched loosely.
1. Map every place that resolves an order or shift today:
   - model-pick validation (interpret.ts);
   - findOrder evidence (evidence.ts, threadState.ts);
   - threadOrder links;
   - bookedAt (plan.ts:379);
   - coveredBy;
   - the unnamed path;
   - the paused old engine's matchers, which are never to be copied.

   **Show the owner the map before changing anything.**
2. Build one resolver, in its own module (app/lib/v2/identity/), that returns a typed result: exactly one candidate,
   several (with the list), near-miss, or none. Use it everywhere in the map.
3. Before the model call, pull reference, day and venue evidence from the email. Always include explicitly referenced
   and validly linked orders in the candidate list, then fill to the cap.
4. Resolve written venue names to place ids before matching. Include location whenever an order has more than one.
   - Never count generic venues such as "No Location" as evidence.
   - Bring in held C1's venue rule here.
5. Weigh R and J numbers by where they appear. The client's newest words, or Spartan's reply on this thread, count;
   quoted text about another job doesn't.
6. Sender first. A recipient-only company never overrides the sender's domain (F12). Bring in held item 7 here.
7. Keep "staff already did this" separate from "the exact request is complete".

**Done when:**
- tests cover:
  - competing same-day jobs;
  - the same crew at two venues;
  - a referenced order beyond the 20-booking cap;
  - 07:30 booked against an asked 08:00 (a near-miss handoff, not a duplicate create);
  - a passing R number in quoted text;
- on held-out mail, identity handoffs fall and wrong targets stay at zero (the strict scorer and the email-to-board
  harness).

### Prompt 5: understand everyday requests (5.4, F8, F24, F25): **DONE**, S-0239
**Goal:** the system can represent the common requests it refuses today, without guessing.
1. Handle a time change plus a new absolute crew total against one target state.
2. Allow trade totals and reductions on a uniquely matched trade position, using set_position_size and cancel_position.
   Keep the attendance protection.
3. Add narrow date formats such as 20-Nov. Bring in held item 5's parser cases.
4. Validate the model's extraction against a schema before grounding, so malformed output becomes a recorded handoff
   instead of a throw.
5. **F8:** read "instead of / rather than / make it / was X" direction before the membership check, and keep reply
   subjects from supplying new values.

**Done when:**
- each of these plans correctly in tests: "move to 10:00 and make it 8 crew", "make it 3 forkies", "drop one forklift",
  "20-Nov" and "was 08:00, make it 09:00";
- a malformed extraction becomes one recorded handoff;
- wrong writes on held-out mail stay at zero.

### Prompt 6: recover interrupted work (5.5, F26, F38, F39): **DONE**, S-0247
**As run (S-0247):** app/lib/v2/resume.ts resumeStopped replaces process.ts retryStopped in the minute sync.
- Three ways a write stops short: before the submit ("busy", or "blocked" by a passing fault: nothing sent); between
  two operations (every result verified, fewer results than operations, no ledger row for the next, nothing moved for
  10 minutes); inside one (a ledger row for the next operation and no result).
- Inside one: never sent again; recorded "unknown", a person's, and the owner is told (F39).
- The other two: the email is planned again from its stored reading against OnSinch now, with staff's edits and
  today's settings (decideMessage with run: null, again: true). The rest runs only when that plan asks for exactly
  the operations still to do; otherwise one "cancelled" result says why, and the owner is told. A day already over
  closes it too.
- F38: no build filter. A write stopped under an older build is planned again under the new one, never dropped.
- Each decision ends in one final result; a second sweep does nothing (test/resumeStopped.ts, six fault-injected
  cases on PGlite with the bot, ledger and planner injected). A model timeout is the re-read's (test/retryUnread.ts);
  a capture that fails part-way keeps what it stored (test/noDataLoss.ts).
- Writes are off (owner, 25 Oct), so this runs on nothing live until they are on.
**Goal:** a model outage or an interrupted plan never leaves a permanent manual card when the work could safely finish.
1. The bounded re-read ships in Prompt 9 (retryUnread).
2. After an interruption, reconcile planned ops against the ledger. Resume only ops that definitely never started, and
   only after re-reading the target, staff edits and current policy. Never replay an op whose outcome is unknown.
3. A deploy does not cancel a stopped write's retry silently (F38): it is retried under the new build after the same
   re-reads, or recorded as cancelled.

**Done when:** fault-injected runs at partial capture, a model timeout, and after each verified op each end in exactly
one final result with no duplicated effect.

### Prompt 7: design the one-click confirm and learning loop (5.8, design only): **DONE**, S-0251
**As written:** docs/ASSISTED-MODE-DESIGN-2026-10-27.md. A handoff carries its `proposal` (the ops). Confirm re-reads the
decision, refuses a stale card by its opKeys, and runs each op through runOp under both write keys. Each answer is a
row in `v2_assist` (no email text, actor hashed) and a case in the regression set that test/harnessGate.ts floors.
test/assistConfirm.ts would prove a Confirm writes exactly what the card showed. Four questions for the owner and Paz
are in its §8.

**Goal:** a written design, not code, for assisted cards and the learning loop. Build it only after the weekly numbers
show most remaining handoffs are near-misses.

**Cover:**
- what a card shows: the proposed change and why;
- how Confirm, Edit and Reject call the existing runOp path, with the ledger, read-back and To Confirm unchanged;
- how each decision is stored as an anonymised harness case under harness/DATA_POLICY.md;
- how the week's disagreements join the regression set that every prompt or model change must pass.

**Done when:** the design names the files it would touch, the data it stores, and the test that proves a confirmed card
writes exactly what was shown.

### Prompt 8: re-map the repo for the agent (docs only): **DONE**, S-0236
**Goal:** the files an agent reads first describe the live v2 system accurately. Change no runtime code.
1. Read CLAUDE.md, README.md, DECISIONS.md, harness/STATE.md, docs/ and section 10.
2. Draft a new CLAUDE.md of at most about 80 lines. It covers:
   - the v2 pipeline, with the folder for each stage;
   - the safety rules in section 2;
   - tests never run against production;
   - **ADDENDUM.md as the one plan;**
   - where rulings, numbers and state live.

   Keep the gate rules and the invariants that still hold, including **no heartbeat in n8n**. Move the legacy-engine
   invariants, unchanged, into app/lib/engine/README.md, and state there which engine files v2 imports.
3. Add docs/README.md listing every file in docs/ as current or superseded, with one line each. Move nothing. Mark
   OPERATING.md, RUNBOOK.md and audit/STATE.md as history, superseded by ADDENDUM.md.
4. Copy each ruling found in v2 code comments (search for "approved", "ruling", "Ben") into DECISIONS.md with an id, and
   add that id beside the comment. Add the rulings listed in §0.
5. Update README.md and harness/STATE.md so neither contradicts the code (live model, engine).

**Done when:**
- the diff touches only .md files and comment lines;
- every statement in the new CLAUDE.md points to a file that exists;
- an agent asked "where is the booking matched?" is pointed to v2, not app/lib/engine.

### Prompts 9-13: see §11

---

## 10. Organising the repo for the AI that builds it

**Status 26 Oct: DONE** (S-0236, Prompt 8):
- CLAUDE.md is a 65-line map of the live v2 pipeline, the §2 safety rules, where truth lives, the gate and the
  invariants that still hold (no heartbeat in n8n among them);
- the old engine's invariants moved unchanged to app/lib/engine/README.md, with the engine files v2 still imports;
- docs/README.md marks each file in docs/ current, reference or superseded;
- DECISIONS.md carries O1-O5 (§0's rulings) and V1-V35 (every ruling found in a v2 code comment), and each of the 68
  comment lines names its id.
Still to come from §10: the identity owner (R8), and the move of what the old engine left to app/lib/onsinch/ (R7 stage 1).

**Nico's findings (code-verified at 0f2dcef, all still true):**
- **CLAUDE.md describes the legacy engine.** It never mentions v2, the harness, the two write keys or the refusal rules.
- **The session gate runs the suite.** Since S-0213 it runs on PGlite, so that point is DONE.
- **Current truth is spread across many places:**
  - README.md (legacy);
  - harness/STATE.md (an outdated model);
  - DECISIONS.md (September's D1 to D6);
  - public/data/feed.json;
  - fleet/resume/;
  - 28 dated plans in docs/ with no index.
  - Since 24 Oct also OPERATING.md, RUNBOOK.md and audit/. **From 26 Oct, ADDENDUM.md is the one plan.**
- **v2 rulings live in code comments,** not in DECISIONS.md.
- **Old and new code share one folder.** app/lib/engine/ has 47 files, 16,095 lines. v2 imports a handful (F45).
- **No single owner for "which booking is this"** (5.3).

**The fix** (documentation and labelling first, no risky moves):
- Rewrite CLAUDE.md as a short map of the live system.
- Move the legacy invariants into app/lib/engine/README.md and mark the legacy engine.
- Give every kind of truth one home:
  - rulings in DECISIONS.md;
  - measured numbers in feed.json;
  - **the plan and its status in ADDENDUM.md;**
  - the system's map in CLAUDE.md;
  - plans in docs/ with an index.
- Copy the v2 rulings out of code comments.
- Name the owner of identity: app/lib/v2/identity/ when 5.3 lands.
- Retire the old engine once SPARTAN_ENGINE can no longer select it (Prompt 12).

---

## 11. The rebuild, in order (from 26 Oct)

**The owner, 26 Oct:** "pivot to rebuilding the entire system using the addendum alone."

**Read as:** the whole system is rebuilt to the target in §5, one prompt at a time, in the order below.
- That target is one request model, one shared resolver, every request tracked to completion, near-misses as one-click
  confirms, and **no heartbeat in n8n**.
- The §2 write path and its safeguards are kept and built around, as Nico asks. Everything else moves to the target.
- Each step ships through the gate and updates this file.

| step | prompt | what | ships |
|---|---|---|---|
| R1 | **9** (new) | **Stop losing work, part 2:** F29 (in-call retry), F26 re-read (retryUnread), F30 owner alerts, F35 replay guard, F36 UTC times, F31 pause stores mail. Held items-1-3-runtime, plus C3 and C2 / item-4 / n1 scoring | **DONE S-0235** |
| R2 | 8 | Re-map the repo: CLAUDE.md, engine README, docs index, rulings into DECISIONS.md | **DONE S-0236** |
| R3 | **10** (new) | **No heartbeat in n8n** (F32): cron entry points, the heartbeat, honest sync status (F37), sync and labels on their own secret (F3), labels by webhook, the switch-over | **Code DONE S-0237.** Switch-over waits on CRON_SECRET |
| R4 | 0 | Size the findings, read-only | **DONE S-0238** (§7) |
| R5 | 5 + 5.10 | Everyday requests (F8, F24, F25, dates, schema validation) and the small fixes (F13, F14, F18, op key, run.ts:5, README). Re-cut held item 5 and n2-planner-ops | **DONE S-0239** |
| R6 | **11** (new) | Govern the switches (F34). One migrations module (F44). A Preview branch when access exists | **DONE S-0240**; the branch waits on access |
| R7 | **12** (new) | Retire the old engine in stages (F45, §10): move the shared OnSinch client and helpers to app/lib/onsinch/, delete what nothing live reaches, then pipeline/compiler/deps and the shut routes, then the 145 old tests | **DONE** S-0241 to S-0243 |
| R8 | 4 | **One shared booking finder** (5.3), built once the old engine is gone, so there is one place for it. Brings in held C1 and item 7. **a to d DONE** S-0244 to S-0246; e held for the owner's yes to a paid measurement | yes |
| R9 | 6 | Resume interrupted plans (F26, F38, F39). **DONE** S-0247 | yes |
| R10 | **13** (new) | **The email-to-board harness** (the owner's design, below), then its case study. **DONE** S-0248 | report + test |
| R11 | 5.2, 5.7 | Live trace; R number in our subjects (test first). **DONE** S-0249; 5.7's change held for the owner | yes; 5.7 needs the owner's yes for outbound mail |
| R12 | TV | F41 Needs Reply lane, F42 aging, held items 6 and 8. **HELD 27 Oct:** nothing built; every piece changes what the TV shows, which needs the owner's and Paz's yes (§0 blocked item 4) | **owner and Paz** |
| R13 | 7 | Assisted mode design, from R10's numbers. **DONE** S-0251 (docs/ASSISTED-MODE-DESIGN-2026-10-27.md) | design |
| R14 | | Mail intake through v2 (F43), live with the Gmail grant; then intake, labels and alarms leave n8n entirely. **DONE, dormant** S-0250; labels and alarms after the grant | dormant until the grant |
| R15 | | **The V1 review:** a thorough review of the whole system (code cleanliness, what works and what doesn't, what to do next), by me and by an independent agent. Published and opened in the owner's browser. **DONE** S-0253: https://claude.ai/artifact/A3WyEdpcXRcehHoJVb6BQe | report |
| R16 | | F49, F50: the review's two write-path gaps. **DONE** S-0254 | test |
| R17 | | The 9 wrong dev-2 writes, one by one: each a planner fix or a refusal (harness/real/writes-run.ts). **Planner part DONE** S-0255: 7 wrong of 21; the rest are the owner's rules or judging limits | before writes go back on; writes on is the owner's |
| R18 | | F51: a link takes new shifts only when its order holds an asked day or the venue | **owner decision** |
| R19 | | F52: the reason code stored as a column; retries, the sweep, resume and the TV read the code. **DONE** S-0256 (the stored code; no column needed) | yes |
| R20 | | F53: the minute reads limited to open cards and recent days. **MEASURED, deferred** 28 Oct: 324 rows, ~400 KB a minute; trigger in F53 | yes |
| R21 | | scripts/ sorted (live, read-only, archive; write-capable ones marked); dead helpers, the Jobs screen's dead button, stale route comments. **DONE** S-0257 (the button is the owner's and Paz's) | yes |
| R22 | | plan.ts `decide()` split along its sections, the replay as the check. **DONE** S-0258: 499 lines to 187, every decision of 799 replayed emails byte-identical | yes |

### Prompt 9: stop losing work, part 2 (F26, F29, F30, F31, F35, F36): **DONE**, S-0235
**Goal:** a failed read heals itself, the owner hears of the system's own failures, and a pause loses no mail.
1. **F29.** In extract.ts extractWithMeta:
   - 3 attempts; backoff 400 ms then 1,200 ms, plus up to 50% jitter;
   - retry on 429, 5xx except 501, and timeout or network errors;
   - never retry 400, 401 or 402;
   - no attempt starts after 120 s;
   - keep the thrown message as `extract: OpenRouter <status>`;
   - do not touch SYSTEM or userPrompt.
2. Apply eval/patches/items-1-3-runtime.diff (it applies cleanly at HEAD). That brings F30, F35 and F36 with their
   tests.
3. **F26.** Port retryUnread from eval/patches/c-current-mail.diff: the process.ts hunk, the sync route hook and
   test/retryUnread.ts. Not the planner hunks.
4. **F31.** Under v2, a pause keeps intake and dedupe open:
   - handleInbound captures, then marks the new ids in v2_store_only and decides nothing;
   - sweepUndecided skips marked rows.
5. Ship item-4-scoring, n1-write-judging and c-current-mail's C2. They are harness only, with no runtime effect.

**Done when:** each of these passes, red first:
- test/extractRetry.ts: 429 then 200 makes 2 calls; three 5xx throw after 3; 402 makes 1 call; a dropped connection
  then 200 makes 2 calls;
- systemFailureToOwner, replayKeepsWriteRecord and zonelessIsUtc;
- retryUnread;
- test/pauseStoresOnly.ts.

### Prompt 10: no heartbeat in n8n (F32, F37, F3's auth half): **code DONE**, S-0237; switch-over OPEN
**As built:** the secret is CRON_SECRET for the sync, the labels and the heartbeat alike. Until it is set the intake
secret still opens them, so the n8n minute schedule keeps running; once it is set the intake secret is refused. The
cron's GET of /api/bot/sync calls the n8n webhook `spartan-labels` after the sync (SPARTAN_LABELS_WEBHOOK overrides
the URL). **The switch-over, in one sitting:** the owner sets CRON_SECRET in Vercel (Production) and in .env.local;
redeploy; three cron firings seen; deactivate n8n baVlgOkVMCpvj1N7; run `node scripts/install-sync-workflow.mjs`
(it replaces rfYGsZULF4PehLPm with the webhook form and retires it); labels seen to apply; /api/health/heartbeat
answers ok.
**Goal:** every timer for this automation lives in the app. n8n keeps no schedule.
1. Add GET handlers on /api/bot/sync and a new /api/health/heartbeat, authorised by authorizeCronCall.
   - Both paths are on the middleware SKIP list, so each checks its own secret; test/machineRouteAuth.ts must pass.
   - Move sync and labels off the intake secret.
2. The heartbeat checks:
   - last capture (working hours);
   - capture-to-decision lag (the oldest undecided client message past 15 minutes);
   - the last sync finish (the sync records it);
   - the last label run.

   Anything stale raises reportError, route "heartbeat".
3. The sync answers ok only when every step succeeded.
4. vercel.json crons: /api/bot/sync every minute, /api/health/heartbeat every 5. Not /api/reconcile.
5. The n8n Sync workflow becomes webhook-triggered:
   - Webhook node in, the sync HTTP node out;
   - _labelNodes.mjs steps unchanged: 5 at a time, a second apart;
   - the cron calls it after the sync.
6. **Switch-over, in one sitting:**
   1. CRON_SECRET is set.
   2. Deploy.
   3. Three firings are seen in Vercel's logs.
   4. Deactivate n8n baVlgOkVMCpvj1N7.
   5. Convert rfYGsZULF4PehLPm.
   6. Labels are seen to apply.

**Done when:**
- tests prove the GET entry points refuse without the secret and run with it;
- the heartbeat raises on each stale signal;
- the sync reports a failed step as not ok;
- after the switch-over, n8n lists no active Spartan schedule except the intake Gmail trigger, which waits for R14.

### Prompt 11: govern the switches and the schema (F34, F44): **DONE**, S-0240
**As built:** the admins are the break-glass session, the owner's two addresses and SPARTAN_ADMIN_EMAILS (a default,
DECISIONS A1). The schema is 84 statements in app/lib/migrations.ts (83 moved from 27 files, plus settings_history),
run by migrate() and recorded in schema_migrations; each store calls ensureSchema() before its first query.

**Incident, 27 Oct 12:37Z (my error).** A bare `npx tsx test/sweepIsolation.ts` skips the PGlite preload, read
.env.local's DATABASE_URL and ran the new migrate() against production before this shipped. Effect, checked by diffing
production's schema before and after (read-only): three new empty tables (schema_migrations with the 84 ids,
settings_history, mail_seen); no existing column or index removed or changed; the test's own rows deleted (0 left). It
is what this ship's deploy does anyway, but it broke the rule that nothing runs against production. Fixed: the 7 test
files that load .env.local now import ./fixtures/pg first. Run a single test as
`npx tsx --require ./test/fixtures/pg.ts test/<file>.ts`.

**Preview's own database: the steps** (whoever holds Neon and Vercel access; Vercel is refused to this agent):
1. In Neon, branch `preview` off production's main branch. Prefer a schema-only branch if the plan offers one, so no
   client mail lands in Preview.
2. In Vercel, Project, Settings, Environment Variables: set DATABASE_URL, POSTGRES_URL and every other STORAGE_ and
   POSTGRES_ name .env.example lists, **for Preview only**, to the branch's connection string.
3. Redeploy one preview and check its /api/health/intake answers a different last inbound from production's.
   migrate() makes any table the branch lacks on its first query.
4. Neon's Vercel integration can make a branch per preview deployment; that is the same with less upkeep.

1. bot_writes_enabled, replies_enabled and reply_delivery may be changed by an admin only. Find how isAdmin is set, or
   define the admin list.
2. Every change is stored with actor and time, and raises reportError "settings-changed" to the owner.
3. Move the 33 CREATE TABLE and 18 ALTER statements into one ordered, idempotent migrations module with a
   schema_migrations table, run from one function. Test on PGlite from empty and from the current shape.
4. Preview's own Neon branch: write the steps. Do it when access exists.

**Done when:**
- a non-admin is refused;
- history rows are written;
- the alert fires;
- both migration tests pass.

### Prompt 12: retire the old engine (F45): **DONE**, S-0241 to S-0243
**As run, stage 1 (S-0243):** one rename, app/lib/engine to app/lib/onsinch, as the re-sequencing said. 117 relative
imports in 87 files rewritten by resolving each one, and the docs that are instructions (CLAUDE.md, README, the folder's
README) follow; dated plans keep the old path as history. Only import paths and path mentions changed. tsc clean; the import walk leaves
only app/manifest.ts; the dev-2 replay is unchanged (22 writes: 11 completed, 2 partial, 9 wrong). Production after
S-0242: the deploy went live at 21:55:51Z, and the minute sync and labels after it recorded ok (21:56:57Z).
**Done when** is met: app/lib/engine is gone, and the harness and the suite agree that nothing live changed.

**As run, stages 3 and 4 together (S-0242).** A test of a deleted file cannot stay, so the two went as one.
- **The old engine's routes and switch:** /api/confirm-order, /api/reconcile, /api/sweep-ingest and /api/mail-inbound,
  with routes/confirmOrder.ts and routes/reconcile.ts. SPARTAN_ENGINE is read by nothing: paused.ts keeps
  SHUT_ROUTES (/api/mail-poll alone, F43), v2Writes and automationPausedFlag. n8nInbound.ts is capture, the SP-12
  shape report, the pause's store-only path, then decideDelivery. /api/mail-poll stores and decides nothing until R14.
- **The TV's old-state branch:** feed/project.ts takes FeedSource[] only; serve.ts takes `sources` in place of
  `states`. The feed tests build their cards through test/fixtures/stateSource.ts, the same projection moved
  into the tests.
- **What then reached nothing:** 47 app files (pipeline, compiler, deps, the reasoner, sweeps, venue matching,
  amend and replace, stateDb and seven other old stores, mail/gmailWrite, providers, threading). The import walk
  from every route, page and middleware now leaves only app/manifest.ts, a Next.js entry it does not count.
- **Tests and scripts:** 122 of the 226 test files went (the 145 the plan counted, less those already gone or
  rewritten). threadMessages and opsScriptsReadMessages read through messagesFromPayload instead of the old
  coerceThread. Also gone: 28 scripts, and sim/ and study/ (39 files, the old engine's study rigs, last changed 4 Oct).
  verify-gmail-sa reads the four labels from threadLabels.ts. .env.example lists 44 names, down from 70.
- **Measured:** 243 files deleted; 48,288 lines out, 349 in. tsc clean. The real-mail replay (harness/real/writes-run.ts
  --set dev-2, $0, offline) is unchanged: 22 writes, 11 completed, 2 partial, 9 wrong.
- **Found on the way:** F48, a failed test file passed the gate.
- **Production:** SPARTAN_ENGINE and the old engine's variables (REASONER_*, SPARTAN_MODEL, the venue and link
  settings) are still set in Vercel and read by nothing. Removing them is the owner's call; nothing depends on it.

**As run:** stage 2 first. Deleted (an import-graph walk from every route, page and middleware reaches none of them):
engine/fold, jobMigration, orderLink, score, verifyWrite; match/facts, match, ngram, score; sweepLabelsDb; v2/bot/parity;
v2/draft (V6's code; the ruling stands). With them went the 8 tests and 9 scripts that existed only for them
(scripts/gold's features, rules, truth and weights among them: the 10-22 matcher audit, kept in git history).
- **Re-sequenced:** the TV's old-state branch (feed/project.ts stateSource) is exercised by the feed tests through
  ConversationState, so it goes with stage 3, where the old engine's types go. The move to app/lib/onsinch/ (stage 1)
  goes last: once stage 3 has deleted the rest, what remains in app/lib/engine is what v2 uses, and the move is one
  rename.
- **Kept, against the stage 3 list:** /api/mail-poll is R14's Gmail intake (F43). Stage 3 rewires it from the old
  pipeline to decideDelivery instead of deleting it.
Stages, each gated, each followed by a check that the real-mail harness reproduces (the dev replay is unchanged):
1. Move what v2 imports from app/lib/engine into app/lib/onsinch/ (or shared modules): the OnSinch client, the resolver
   helpers, staffChangeSince and matchExistingOrder.
2. Delete the 12 files reachable from nothing (app/lib/match/, engine/score.ts and the others in
   audit/system-audit-2026-10-26.md §2), and the dead old-state branch of feed/project.ts.
3. Delete pipeline, compiler, deps and the shut routes' handlers. Remove SPARTAN_ENGINE's old branch.
4. Move or delete the 145 old-engine tests.

Zero references is permission to delete, never a reason to.

**Done when:** app/lib/engine is gone or holds only what v2 uses, and nothing live changed (the harness and the suite
agree).

### R22: the planner's decide() in steps: **DONE**, S-0258
- decide() was one function of about 500 lines. It is now 187: the stand-downs and intents, the client, the past and
  over days, the thread's history, then one call per step. planChange (one change on one shift), addToNamed (new
  shifts on the booking the email names), bookNew (already booked, added beside a booked part, or a new order) and
  setPo share one Draft: what each reads, and the ops, why, assumed, asked and retimed every step adds to.
- **The move was mechanical:** each body was cut out by a script and wrapped, word for word, with the names it uses
  taken from the Draft. **Checked:** every decision of the dev and dev-2 replays (799 emails), full JSON with sorted
  keys, before and after: byte-identical. The dump was run twice before the change and matched itself.

### R21: scripts/ and dead code: **DONE**, S-0257
- **scripts/README.md** is made by scripts/scripts-index.mjs from each script's own code: 135 scripts, 43 can write
  (database, OnSinch, n8n, Gmail or the bot routes), 66 read production, 26 are offline. test/scriptsIndexed.ts fails
  when a script is missing or its class has changed, so a script that starts writing cannot do it unmarked. Nothing
  was moved: the index carries the warning, and moving 135 files would break every path written down for them.
- **Deleted:** authorizeMailWebhook (its route went in R7), and scripts/verify-mail-inbound.mjs and
  verify-mail-inbound-engine.ts with their npm scripts and MAIL_INBOUND_SECRET.
- **Kept, against the review:** threadState() (the sim harness and test/threadState.ts use it), threadIdForMessageIds
  (the reply-chain lookup F46 needs) and rebuildThread.
- **Comments:** middleware.ts and apiAuth.ts no longer name /api/sweep-ingest, /api/reconcile or /api/mail-inbound;
  middleware names /api/mail-poll. onsinch.ts gives its timeout and retry budget their reason now, not n8n's 60 s.

### R17: the wrong dev-2 writes: planner part **DONE**, S-0255
Each of the 9 was diagnosed from values only (dates, times, counts, trades, place ids; no email text). Before:
22 writes, 11 completed, 2 partial, 9 wrong. **After: 21 writes, 12 completed, 2 partial, 7 wrong** (harness/real/
writes-run.ts --set dev-2, $0). The dev replay of 561 emails changed in one email, from one hand-off reason to another.

| write | cause | now |
|---|---|---|
| 1a14063b8d8dd75c | Three planner faults: "2x Crew, 1x Crew Chief" folded the chief into the 2; "Set Builders" booked as Crew; the venue, written as the initials of the client's own place (booked 30 times), made a new place because venueKey drops "London" before taking initials | **completed** |
| 1a153e512dae2620 | Three 1-hour calls. Staff never book under 2 hours (1 of 11,915 positions) and booked 2-hour calls, joining two that touched | a person's (policy_short_call) |
| 1a144942ca8851d1 | Shifts right; staff split the booking into one order per weekend | **owner:** when does one email make several orders? |
| 1a1541de84b036b8 | A quote with shifts, booked To Confirm by the 13 Oct rule; staff made no order | **owner:** does a quote become an order? |
| 1a144f983605bc19 | No end written; the client's usual length (V15) gave 2 hours, staff booked 4 | **owner:** V15 fits 90%; this is its miss |
| 1a15984719fbd60e | Totals right; staff made some seats Carpool and Minivan Drivers, which the email's counts do not say | **owner:** driver seats are staff's knowledge |
| 1a163dd1e345c607 | "Only require two crew not four": staff never changed the order (no audit row after the email) | judging: nothing to compare with |
| 1a15984f57ab3251 | The plan used place 7083, whose name the words equal; staff used 205. 7083 has never had a booking and is among the 91 newest ids, and places carry no date | judging: the time-correct world cannot hide a later place |
| 1a158a5e6bd47095 | "An additional three crew": the plan adds a chief by V13; staff's own add was removed after the next email | judging, and V13 |

**Fixed (S-0255):** interpret.ts counts a chief written as its own number on top of the crew (V13 then takes the chief out
of the total, as staff did); professions.ts books "set builder" as Carpenter; plan.ts placesFor matches initials on the
whole name as well and, when several places share them, takes the one the client booked; plan.ts MIN_CALL_MINUTES hands a
call under 2 hours to a person. test/v2WrongWrites.ts goes red on the old code in all four, and showed one more: on the
old code "RHLT" picked a place the client had never booked because only that name's shortened initials matched.

### R15: the V1 review: **DONE**, S-0253
- **Published:** https://claude.ai/artifact/A3WyEdpcXRcehHoJVb6BQe (a doc: the owner can edit and comment).
- **How:** my read, and one independent reviewer (another model, read only, kept from ADDENDUM, OPERATING, audit/ and
  fleet/ so its read was its own). Every claim it made was checked against the code before it went in.
- **Result:** what is live works; writes stay off. Ten gaps, ranked. The reviewer found six I had missed (F49 to F54),
  all on code I wrote or kept. Four of its claims did not survive the check, or only in part: the replay-guard
  comment is accurate, the onboarding route is session-gated, every stored date is UTC, and the lease was not
  checkable.
- **Next, from it:** F49, F50 and the 9 wrong dev-2 writes before writes go back on; F51 is the owner's; then F52,
  F53, scripts/ and splitting plan.ts.

### Prompt 13: the email-to-board harness (the owner's design, 26 Oct): **DONE**, S-0248
**As run (S-0248):**
- **Cases:** harness/board/cases.ts picks 20 of D-cur by kind, in hash order of their ids (eval/board/cases.json): new
  booking 4, acceptance 3, change 4, cancel 2, reply for crew 3, non-work 4. Never E3, never the pause window.
- **The prompt:** harness/real/replay.ts takes `onExtract`, which hands over exactly what decideMessage would send the
  reader, and `readings`, a reading per email in place of production's (the `--reader subagent` of step 4).
  `harness/board/run.ts --requests` writes the 20 prompts (extract@f3e1a862322b) to .tmp-data/board/ (gitignored).
- **Subagents** (claude-haiku-5-5, Read and Write in that folder only, about 610k tokens in all): the reader in two
  batches of 10, and two blind labellers. A third labelled the 4 emails where they split. The card kind comes from
  the two-reader labels; the target and the change come from the labellers. The change settles on its kinds; dates
  are checked at grounding.
- **`run.ts --compare`**: both readers through ground, plan, card (feed/v2.ts via system.ts) and label
  (mail/threadLabels.ts), stopped at the first stage that parts from gold. Report eval/board/2026-10-27.md, ids and
  codes only.
- **Result:** 20 of 20 have gold; production's board matches on 16. The 4 misses:
  - **reader (both), 2:** both readings find nothing asked (see F40).
  - **reader, 1:** a cancellation production's reading turned into a reply card (reply_detail_missing); the
    subagent's reading gets it to the gold board.
  - **display, 1:** an acceptance shown as Needs Updated on R11798. The labels read a new booking, while the
    labellers name R11798 as the target. That makes the gold the weaker side; it is for a person to settle.
  The subagent's own reading misses once where production's does not: an ops miss, a shift where gold asks a PO.
- **In the gate:** test/boardCases.ts, 12 synthetic emails (no client data) with checked-in readings, through
  decideMessage, the card and the label.
- **Rules held:** gold copy only (HARNESS_GOLD), no network, no model call in the harness itself, no email text
  committed or printed.
**Goal:** for each email, show:
- what came in;
- what it asks for;
- what the board showed;
- what it should have shown;
- the first stage where they part.

The AI step is a Claude subagent on our own credits, using a cheap model (Haiku, or Sonnet if Haiku reads poorly). All
other code is deterministic and costs $0. OpenRouter is never called.

1. **The case set:** 20 emails from the current reader's labelled window (eval/dev-windows.md). Cover a new booking, a
   change, a cancel, an acceptance, a reply asking for crew, and plain non-work mail. Add W2 once it is labelled.
   **Never E3.**
2. **Board gold:** what the board should show per email:
   - card kind (none, needs-created, needs-updated, reply-with-work);
   - target (an order, NEW or NONE);
   - the change (op kinds and values);
   - the Gmail label.

   Derive it from the two-reader labels. Where they do not carry it, two blind label subagents fill it and a third
   settles splits. Commit ids and codes only.
3. **The AI step:**
   - For each email the harness writes `.tmp-data/board/requests/<id>.json`: SYSTEM, PROMPT_ID and
     `userPrompt(sent, from, subject, newest, contextText(read))`, with `read` from readContext against the
     time-correct world, exactly as production would.
   - A subagent (tools: Read and Write in that folder only) answers each with the JSON object alone, into `responses/`.
   - Batches of about 10. Record the model and the brief hash.
   - The folder is gitignored.
4. **The deterministic run:** a `--reader stored|subagent` option on harness/real/replay.ts. Each reading goes through
   the unchanged code:
   1. ground;
   2. plan;
   3. harness/real/system.ts for the TV outcome;
   4. feed/v2.ts rowsOnCard for the card;
   5. mail/threadLabels.ts for the label.
5. **Compare and attribute.** Stop at the first stage that differs from board gold:
   1. client;
   2. asks;
   3. grounding;
   4. target;
   5. ops;
   6. card kind;
   7. card text;
   8. label.

   Then read the pattern:
   - both readers fail at the same code stage: code;
   - the subagent succeeds where production's reading failed: reader;
   - both succeed but the card is wrong: display.

   Report to `eval/board/<date>.md`, one row per email (ids and codes), with totals per stage.
6. **In the gate, free:** test/boardCases.ts. About a dozen synthetic emails (no client data), each with a checked-in
   reading, go end to end through ground, plan, card and label, asserting the board output.
7. **Rules:**
   - no production database; the fresh copy only, via HARNESS_GOLD;
   - no email text in any committed file or in the session output;
   - a subagent reading is not production's reader, so report them side by side.

**Done when:**
- the 20-email case study has run with both readers;
- the report names, for every miss, the stage and whether the cause is the reader, the code or the display;
- test/boardCases.ts is in the gate.

### Hazards for whoever runs this
- **Worktrees with junctions.** spartan-v2-p1, -i14 and -n1 link into this checkout's node_modules and .tmp-data.
  - `git worktree remove --force` deletes through a junction: on 26 Oct it emptied .tmp-data.
  - Unlink each junction, verify, then remove.
  - Never let a subagent remove a worktree.
- **The undecided sweep decides fresh mail.** Anything stored inside 24 h and sent within 7 days costs a model call.
- **Privacy slips** have come through log tails. Filter every log first.
- **A push is a deploy.**

---

## 12. The measurement loop (the owner, 28 Oct)

**The purpose, in the owner's words:** "Every urgent decision for Spartan on the TV, by reading their email and syncing
with OnSinch. Create and update eventually fully automatic. Nothing automatic goes to OnSinch until live data proves
it's accurate. A person's Confirm always books."
- **The bar:** 1 failed order in 100.
- **The judge:** what staff do in OnSinch, read from its timeline. No model labels, and no judging by the agent.
- **Part 2's limits:** additive only (new tables or columns), never a change to a decision, never a write to OnSinch.
  Writes stay off; a person's Confirm is the only write.
- **Rulings:** decisions/2026-10-28-measurement-loop-and-rulings.md (DECISIONS O6-O12).

### 12.1 Part 1: the audit (28 Oct, read-only)
Run on a fresh copy, `.tmp-data/gold-1028`: production read in a read-only transaction, plus OnSinch GETs; 7-27 Oct,
11,770 timeline rows and the newest 1,500 orders. The scripts are `.tmp-v2/audit23.ts`, `audit4.ts`, `a2b.ts`,
`a3.mts`, `a5.mts`, `a7.ts` and `d1.ts` to `d4.ts`, all gitignored.

| question | answer |
|---|---|
| 1 ground truth | OnSinch `GET /timelineAudits`: who, when, field-level old and new values. Production stored none of it |
| 2 coverage, 21-27 Oct | 62 of 209 staff actions had a card naming the day staff worked on; 149 of 209 had a card for that client. The rest: 15 had a client email with no card, 10 can't tell (sender on the client's domain but not a contact), 35 had no email from that client in 7 days. **Corrected by P2.5:** the 62 counted the reader's raw days, including days grounding refused, which no card showed; by the days the card shows, 21 of 215 (§12.6) |
| 3 shadow writes since 22 Oct | 32: 10 matched, 9 partial, 10 wrong, 2 staff did nothing, 1 can't tell yet |
| 4 hand-offs, dev replay | No reason has staff always doing the plan. Re-scored by day: two-week plans 13 match, 15 differ (the venue), 11 no staff order on those days, 1 split |
| 5 the TV as a log | 178 of 275 needs have a recorded exit; nothing is written when a card's day passes; the verifier's marks carry no person |
| 6 circularity | Matched with no resolver: the sender is a contact of exactly one OnSinch company (433 of 691 client emails; 253 none, 5 several) |
| 7 rulings against the code | two-week: creates only; moved start: keeps the length; "yes, book that": hands off with no plan; six rules hand off with no plan |
| 8 the 7 wrong dev-2 writes | All 7 wrong by the staff-action standard; dev-2: 12 of 21 matched |

**Corrections made since the audit report:**
- The split rule explains 1 of 40 two-week plans, not 7. The extra orders were other jobs in the same window.
- The "nothing asked" flag at the client level is mostly base rate: 59% against 51% in a control window. At the day
  level it is about half signal (33 against 17 of 100).
- So the loop matches staff's orders by day and venue, and the reader-miss flag is the day-level one.

**Data behind the rulings:**
- **Moved start.** Staff kept the length on 11 of 12 start-only requests (1 mixed). Of all staff start moves since
  29 Jul, 840 kept the length, 154 kept the end and 396 moved both by different amounts.
- **Changes by lead time.** 31 of 32 planned changes since 9 Oct were within 14 days.
- **Orders per venue.** 656 of 688 staff orders hold one venue.
  - Same-venue pairs that staff split: 66. Of these, 40 have different POs, 45 different order names and 5 a
    different contact.
  - Multi-venue orders: 32. Of these, 26 are at unrelated venues, 27 run over several days, 3 include a depot and 3
    share a word in the venue name.

### 12.2 What the loop records

All of it lands in new tables, filled by the minute sync with OnSinch GETs only.

**The truth: `onsinch_timeline`.**
- **What it holds:** every OnSinch timeline row of the eight booking actions from 29 Jul (id 867675) onward, kept
  whole and never deleted. Each row carries the order it belongs to where that can be known.
- **How the order is known:** from a create's path, from an order's number, or from a part of an order read since.
  1,732 of 1,753 staff edits on 21-27 Oct can be tied to their order from the create paths alone.
- **Supporting tables:** `onsinch_contacts`, each OnSinch contact's address and company, refreshed daily (9 pages).
  No order is cached: an email is scored with its client's newest orders read from OnSinch then (up to 5 pages),
  which also ties rows on orders older than the store. With the create paths, that ties 7,386 of 7,552 staff rows
  on 7-27 Oct.

**Per email (`v2_outcomes`, one row per decision and plan variant).** Each row carries:
1. **The client:**
   - the company whose contact list holds the sender exactly;
   - otherwise "can't tell: no company" or "can't tell: several companies".
2. **The window:** 1 hour before the email to the first of 96 hours after it, or the thread's next client email that
   got a card. The row records which one ended it.
3. **The days and venues:**
   - the plan's own days and venues;
   - with no plan, the days the deterministic date parser finds in the email's newest text. Never the model's
     reading.
4. **The plan:**
   - the decision's operations (production);
   - for a rule-based hand-off, the plan without that rule (§12.3);
   - any variant plan that differs from production.
5. **What staff did:**
   - every staff booking change in the window on the client's orders that hold one of those days;
   - matched by day, then by venue;
   - each order read as it stood when the window closed: OnSinch's order now, with later timeline rows undone.
6. **The bucket, one per plan:**
   - **matched:** staff left exactly what the plan says;
   - **partial:** the plan is right, and staff did more;
   - **wrong:** the plan holds something staff did not do, with why: the venue, the days, the times, the crew, or
     another order;
   - **staff did nothing:** nothing on those days in the window;
   - **staff acted, no plan:** a hand-off or nothing-to-do with staff work on its days;
   - **can't tell:** with why, for example no single company, the window still open, an order deleted, or the
     timeline behind.
7. **The plan's keys and staff's keys,** in words (day, times, venue, crew per trade, R number), for the daily list.
8. **For an email read as nothing to do:**
   - the day flag: staff acted on an order holding a day the email names, within 48 hours;
   - the same test over the 48 hours before the email, as its noise floor.
9. **A person's Confirm,** when Confirm exists: when, by whom and what it booked. Until then, a person's tick on the
   card.

**Per hand-off,** on top of the above:
- its reason code;
- the without-the-rule plan, when a rule held one back;
- what staff did on its days.

The running count per code is: scored, matched, and matched every time. **The 50-case alert:** when a code reaches 50
scored cases with staff doing the without-the-rule plan every time, the owner is told once, and the report shows it.

**Per staff action (`v2_staff_actions`).** An action is one person's consecutive booking changes to one order, at most
30 minutes apart. It is recorded once 30 minutes have passed since its last row. Each carries:
- who, the order, the days touched and what changed;
- its coverage bucket:
  - a card before it, for that client, naming that day;
  - a card for the client but not that day;
  - a client email with no card;
  - can't tell (sender not a contact);
  - no client email in the 7 days before;
- **for a start moved:** whether staff kept the length or the end. This is the count ruling O7 asked for.
- **for an order staff created:** the exceptions check (§12.5).

**Per card (`v2_card_exits`).** Every need the TV showed, and how it left:
- a person's tick;
- the verifier, which records the OnSinch user from the timeline;
- the order found;
- superseded;
- its day passed;
- the job ended.

A need open for 7 days with no exit is listed.

### 12.3 Variants: both versions of a rule on the same emails
At decision time, after the decision is recorded, the planner runs again with a rule switched or off. This costs no
model call. Each variant is stored in `v2_variants`, and only when it differs from production. A failed variant is
stored as a failure and never touches the decision.

| variant (`v2_variants.variant`) | when | why |
|---|---|---|
| `no_lead` | a policy_lead_days hand-off | the plan the rule held back (O9) |
| `start_keeps_end` | a new start alone | O7 against today's keep-the-length; once O7 ships, `start_keeps_length` is the variant |
| `short_call_2h` | a policy_short_call hand-off | the 2-hour plan, noted CHECK (the R17 rule as a default) |
| `acceptance_draft` | a policy_confirmed_proposal hand-off | the order or change O12 drafts |
| none: the two-week rule over changes | a change planned within the window | the plan is the decision's own; only automatic or not differs, so P2.4 counts each planned change within the window instead |

Each is a planner option (`PlanOpts` leadOver, movedStart, shortCall, acceptance) whose default is today's rule.

**Settings:**
- `create_lead_applies_to` (creates, changes or both) is added beside the lead days, defaulting to creates, which is
  what the code does today.
- The three lead fields become admin-only and logged, like the write switches.
- They live in Settings → Lead days (`app/components/SettingsScreen.tsx` LeadDaysPanel; `app/lib/settingsDb.ts`).
  Today the fields control new orders only, any staff member can change them, and no change is recorded.

### 12.4 The daily numbers, and where they are seen
**A screen, `/report`,** admin-only. It shows one day at a time, opens on yesterday, and has a date picker. The same
data is at `/api/report?date=`.

**The day's numbers,** each with its can't-tell count and noise floor:
1. Coverage: X of Y staff actions had a card naming the day, by bucket.
2. Plans scored that day:
   - by kind (create, PO, times, crew) and by reason code;
   - matched, partial, wrong (with why), staff did nothing, can't tell.
   - **The bar:** failed orders out of orders planned since the baseline began. An order fails when any part of the
     plan for it differs from what staff left.
3. Hand-offs by code: staff acted or did nothing, the without-the-rule plan's buckets, and the running count toward 50.
4. Read as nothing to do: how many, the day-flag hits, and the control.
5. Moved starts: staff kept the length or the end.
6. Exceptions: multi-venue orders and same-venue splits, by category.
7. Card exits by kind, and needs open over 7 days with no exit.
8. The loop's own health:
   - how far behind the timeline is;
   - windows closed but not scored;
   - variant failures;
   - the minute steps that failed.

**Every miss is listed below the numbers.** A miss is a wrong plan, a staff action with no card, or a hand-off staff
did differently. Each shows the time, the client and subject, the plan in words, what staff did in words with R
numbers, and the bucket.

**How a day is fixed:**
- Each night the day's numbers are written to `v2_daily`, append-only, as they stood. An outcome counts on the day it
  was scored, so a day's row never needs rewriting.
- A loop step that fails turns the minute sync red, and the 5-minute heartbeat raises a stalled sync to the owner.
  Nothing in the loop fails silently.
- An emailed daily summary would be outbound mail, so it is not built without the owner's yes.

### 12.5 The exceptions protocol (O10: one order per venue; same venue, one order across days and weeks)
**Flagged daily, from staff's own creates:**
- **Multi-venue:** an order staff made that holds 2 or more venues.
- **Same-venue split:** a new order at a venue where the client already has an order within 14 days of its days.

**Categorised by fields OnSinch holds, never by a model:**
- PO differs;
- order name differs;
- contact differs;
- a week or more between the days;
- a depot or warehouse among the venues;
- the venues share a site word;
- none of these.

**Measured on the copy (§12.1):** splits mostly differ in PO (40 of 66) and name (45 of 66); multi-venue orders are
mostly unrelated venues over several days (26 of 32).

**How a pattern becomes a rule:**
1. A category reaches 20 cases in which 90% or more of the client's comparable orders follow it. For example: "a
   different PO at the same venue is always its own order".
2. The report then shows it as a proposed rule with its count.
3. The owner decides.
4. The rule runs as a shadow variant for 5 days.
5. It goes live on its own day, so its effect can be read.

### 12.6 Build steps, each through the gate

| step | what | status |
|---|---|---|
| P2.1 | `onsinch_timeline`, `onsinch_parts`, `onsinch_contacts`, `v2_loop_meta` (`app/lib/v2/loop/truth.ts`); the minute step "truth" reads new timeline pages (20 a minute; the 29 Jul backfill takes about 90 minutes) and the contacts once a day | **DONE** S-0260 (test/loopTruth.ts) |
| P2.2 | the judge, `app/lib/v2/loop/judge.ts`: pure, matched by day and venue, orders rewound to the window's close | **DONE** S-0261 (test/loopJudge.ts); checked offline below |
| P2.3 | variants: planner options (start keeps the end, lead over changes, short call and acceptance plans) with defaults unchanged; `v2_variants` (`app/lib/v2/loop/variants.ts`), written at intake; Settings' `create_lead_applies_to`, and the three lead fields admin-only and logged. **Replay: all 799 dev and dev-2 decisions byte-identical before and after** | **DONE** S-0262 (test/planRuleVersions.ts, test/settingsSwitchesGoverned.ts) |
| P2.4 | `v2_outcomes` (`app/lib/v2/loop/outcomes.ts`) and the minute step "outcomes" that scores closed windows, 25 emails a minute, back to 9 Oct; each decision coded by reasons.ts, so pre-24 Oct decisions get their codes. **Run offline on production's data first** (`.tmp-v2/p24dump.mts`, `p24run.ts`; numbers below) | **DONE** S-0263 (test/loopOutcomes.ts) |
| P2.5 | `v2_staff_actions` (`app/lib/v2/loop/actions.ts`: coverage, moved starts, exceptions; `onsinch_orders`, `onsinch_places` read daily, the company name on each contact) and `v2_card_exits` (`app/lib/v2/loop/cards.ts`, from the TV as it is built, no verifier, nothing written back); minute steps "actions" and "cards". **Run offline on production's data first** (`.tmp-v2/p25run.ts`; numbers below) | **DONE** S-0264 (test/loopActions.ts, test/loopCards.ts, test/loopTruth.ts) |
| P2.6 | `v2_daily`, `/report`, `/api/report`, the 50-case alert | |

**P2.2 checked offline** (`.tmp-v2/p22check.ts`, `p22check2.ts`, gitignored):
- **The 32 shadow writes since 22 Oct** (28 Oct copy):
  - 15 matched, 2 partial, 3 wrong (2 the venue, 1 a PO), 3 staff did nothing, 9 can't tell (7 windows still open
    at the copy's end, 1 no company, 1 several).
  - The audit's client-wide judging had said 10 matched and 10 wrong.
- **The 53 two-week hand-offs of the dev replay,** each plan the rule held back (10-26 copy):
  - 14 matched, 24 wrong, 4 staff did nothing, 11 can't tell (client).
  - Of the 24 wrong: 13 the venue, 6 staff changed an existing order instead of making one, 5 times or crew.
  - **The venue is the planner's main error on creates.**
- **A plan staff did nothing about counts against the bar.** Written, it would have changed what staff left alone.

**P2.4 on production's data** (decisions 9-28 Oct, timeline to 11:30Z 28 Oct; 797 emails judged, 100 windows still
open; 231 OnSinch GETs, 90 seconds):
- **Planned writes:** 26 matched, 2 partial, 23 wrong, 11 staff did nothing, 19 can't tell. Of the 23 wrong: 9 the
  venue, 5 a time, 3 a size, 4 a create's times or crew, 1 an existing order changed instead, 1 a PO.
- **Can't tell:** 245, all but 3 because the sender is on no company's contact list. This is the biggest gap in what
  the loop can judge.
- **Read as nothing to do:** 193 name no day. Of the 97 that do, staff worked on a named day within 48 hours after 32
  of them, and within the 48 hours before 30. At the day level too, the flag is at its noise floor on this data, so
  the report shows both counts.
- **Hand-offs:** staff acted on the email's days after 59 and did nothing after 84; 50 can't tell.

**P2.5 on production's data** (staff actions 9-28 Oct: 660, 452 OnSinch GETs, 136 seconds):

| coverage of a staff action | 21-27 Oct (215) | since 9 Oct (660) |
|---|---|---|
| a card before it, for that client, naming the day | 21 | 62 |
| a card for the client naming no day (its reading kept none, so the TV showed none) | 67 | 222 |
| a card for the client naming other days | 18 | 40 |
| a card for the client, and the action touched no day (a PO, a whole-order cancel) | 45 | 131 |
| a client email with no card | 17 | 49 |
| no client email in the 7 days before | 36 | 88 |
| can't tell: a sender on the client's domain is no contact | 6 | 29 |
| can't tell: the order is gone from OnSinch | 5 | 39 |

- **The biggest coverage gap is the reader, not the finder.** A card for the client showing no day at all came before
  67 of 215 staff actions: the email was seen and carded, but its reading kept no day.
- **Moved starts since 9 Oct:** staff kept the length 157 times, kept the end 29, moved both 60. Against O7 (keep the
  end), the loop's start_keeps_end variant scores both versions on each email from S-0262 on.
- **Exceptions on 197 staff creates:**
  - 58 same-venue splits. PO differs in 44, name in 38, contact in 21, a week or more apart in 18.
  - 7 multi-venue orders (6 in none of the categories).
  - No category yet meets the protocol's 20 cases at 90%; PO differs is nearest (44 of 58, 76%).

**The baseline starts when P2.6 is live and runs 5-7 days.** Variants exist only from P2.3's deploy. Older emails are
scored on their production plans only, since the world they were decided in cannot be rebuilt in production.

### 12.7 After the baseline: the rulings into code, one a day
1. O7: a moved start keeps the end. A new start at or after the old end becomes a hand-off with a plan.
2. O8: the setting flips to both (a logged settings change, no code).
3. O9: every rule hand-off carries its plan and a Confirm. This is the TV change, so it needs Paz (§0 blocked item 4).
4. O10: one order per venue. Venue accuracy on creates is first on the builder's list.
5. The short-call rule becomes a 2-hour default with a plan.

### 12.8 Open for the owner
- **Is a PO a "change" under the two-week rule?** It moves no crew and no time. Proposed: no, a PO stays automatic.
  Until the owner rules, "changes" means times, crew, positions, shifts and cancellations.

---

## 13. The TV shows only what still needs doing (meta plan, 30 Oct, for the owner's review)

**Rulings:** DECISIONS O13-O16 (decisions/2026-10-30-tv-shows-only-what-needs-doing.md).

**Found on 29-30 Oct (read-only):**
- All 6 open needs had been handled by staff. All 13 done cards were right.
- 186 old Jobs Board cards, 181 of them for past days. Only 40 match their order.
- 17 of 238 cards were named by the subject line. 11 of 44 "needs created" cards carried an R/J.
- 18 of 109 dated needs: after the email, staff worked 2+ of the client's orders on the need's day. 17 of the 18 at
  different venues; 8 included the thread's own order.
- 28 of 29 undated needs had a linked order or a PO in the thread.

### 13.1 Critique of the plan so far
1. **"Staff acted on the client's orders that day" is too loose.** It would clear a need on another job in up to 18 of
   109 cases. Replaced by the evidence ladder (13.2, change 1).
2. **"An undated need clears on any new order for the client" is unsafe.** 11 of 29 undated needs saw staff touch
   several orders. They are matched by their linked order or PO instead.
3. **Four parts answer "is this need done?"** (classify, the checker's two steps, the re-plan). They disagree, and
   timing decides which wins. One evaluator replaces them.
4. **The checker reads OnSinch's history through a 600-row window, and only while the TV is open.** The stored history
   (§12, complete every minute) replaces it.
5. **"Client @ Venue" built by me** gives way to the owner's order: the order title first.
6. **A need with no day was half a need.** It could not be matched or expire properly. Its job is now found by what
   names it, and a day is one clue among several.

### 13.2 Changes, and what each should give
1. **One "is this need done?" evaluator,** run on every TV build from the stored OnSinch history. It counts staff's
   work after the email only on the need's own job, found by the first rung that applies:
   1. the thread's linked order, or an R, J or PO the thread names;
   2. else the need's venue and day;
   3. else its day, when the client has only one order that day.

   The work must fit the ask: a create for a booking, a size or time change for a change, a cancel for a
   cancellation. Two or more candidate jobs with nothing to tell them apart is never green: the card says "Possibly
   done in R1, R2: check".

   **Gives:** open needs staff already handled go from 6 of 6 to 0; wrong clears 0 on the 18 same-day cases.
2. **A need's state comes from now, not from when the email came.** A linked order made after the email answers
   "needs created". An order staff cancelled shows "Cancelled in OnSinch" and is done.

   **Gives:** "Order Needs Created" beside an R/J goes from 11 to 0. Gmail labels follow the cards.
3. **Passed jobs leave the list:** live and carried-over cards whose every day has passed.

   **Gives:** 180 cards off today. Undated needs leave when done, or after the existing 14 quiet days.
4. **Names by the owner's order:** order title, else client and venue, else the original sender's address, never a
   Spartan address or subject.

   **Gives:** subject-line names go from 17 to 0. Carried-over cards take their name from the order, not the old
   ticket.
5. **Three-line tile:**
   - Line 1: the name, label, R, J and day.
   - Line 2: the full ask, every shift with times and crew.
   - Line 3: the check, PO, sender and age, or what staff did.

   Fixed phrases from structured fields only. A layout pass keeps spacing, columns and type tight.

   **Gives:** a card says what to do without opening the email.
6. **The TV says when its OnSinch history is behind,** so a stale screen is never mistaken for a clean one.

### 13.3 How it ships and is checked
- **Order:**
  - 1 and 2 together (the evaluator);
  - then 3 and 4;
  - then 5 and 6.
  - Each goes through the gate.
- **Before 1 and 2 go live,** the new evaluator runs on every need since 9 Oct beside staff's real actions. Any wrong
  clear blocks it.
- **After each deploy,** every card on the live TV is checked again, as on 29 Oct, and the result is reported.
- **Parked:** the loop's daily report screen (P2.6, `.tmp-v2/p26-draft/`).

### 13.4 Added 30 Oct, and the handoff
- **Plain descriptions** (the owner): "clear and descriptive about what the order is and what needs done on it ... not
  intentionally technical or vague ... plain and explain things outright". Change 5 is written as plain sentences from
  fixed templates, every shift listed.
- **Only absolute data** (the owner: "It has to be absolute"). Measured 30-31 Oct:
  - **Absolute:** OnSinch's stored history (since 9 Oct: 11,397 rows, 13% not yet tied to an order), contacts,
    places, orders as read; an R, J or PO the client wrote that OnSinch holds (142 of 465 threads); the bot's own
    orders; a person's tick (15 ever).
  - **Not absolute:** the planner's and finder's links (finder: 2 of 34 point at another client's order), the old
    Jobs Board links, our own decisions and marks.
  - **So** change 1 anchors a need's job on absolute evidence first. An inferred link counts only when the day and
    venue agree.
- **Unexplained exits:** 45 of 68 card exits so far are "left the TV". None was a deletion the owner asked for:
  - every decision and email is still stored, none archived or dismissed;
  - 37 still had a day to come.

  Step 1 finds why.
- **OnSinch's history, checked 30 Oct for the 3 days to the last sync:**
  - all 1,692 booking rows OnSinch holds are stored with the same data, author and time;
  - deleting an order removes its create row from OnSinch's history and logs nothing (orders 16957 and 16990);
  - step 0 records deleted orders and checks the whole range since 29 Jul.
- **Clean, efficient code** (the owner): one function per rule, each step deletes what it replaces, pure deciding
  modules, and the TV's read path reads only the database.
- **Links (O17, O18):**
  - A link is the same whichever side found it. An absolute link overrules inferred ones, and links are matched
    again whenever either side changes: 80 of 148 absolute links name an order made after the email.
  - One email may name several orders: 8 of the 13 threads naming 2+ orders really do.
  - A PO counts only as a whole token of 6+ characters. All 8 false hits were short POs inside links, or an R
    quoted from another thread.
- **The build, step by step:** `fleet/resume/Spartan-TV-Handoff-2026-10-30.md`, the final handoff.
