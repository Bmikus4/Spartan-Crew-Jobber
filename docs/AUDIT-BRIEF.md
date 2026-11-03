# Audit brief: the Spartan Crew booking engine (v2)

Written 2 Nov 2026 at commit add5491 (ticket S-0290). It is for an AI auditor who has never seen this system. It
says what the software is, how it is put together, what state it is in, what rules it must keep, and how to audit
it: the dimensions, the questions under each, where to look, the evidence standard and the report's form.

**Read this whole brief before opening any other file.** Then read, in order: `CLAUDE.md` (the repo map), `ADDENDUM.md`
§0 and the latest status line at its top (the plan and every item's status), and `DECISIONS.md` (the owner's
rulings). Everything else is looked up as the audit needs it.

---

## 1. Ground rules for the auditor (non-negotiable)

These protect a live business. Breaking one is worse than missing a finding.

1. **Read only.** Change no file, commit nothing, push nothing. A push to `main` deploys production. The only
   sanctioned commit is `python -u scripts/session.py`, and the audit has no reason to use it.
2. **Never run anything against the production database with write access.** Read production only through
   `scripts/_readonly.mts`, which wraps every statement in a read-only transaction and proves it first. Never pass
   `--env-file=.env.local` to a test, the harness, or a script you have not read: some scripts write (see
   `scripts/README.md`, column "can touch").
3. **Never call OnSinch write paths, `/api/bot/*`, or the canary.** OnSinch is the client's live booking system. GETs
   through the read-only scripts are allowed; nothing else.
4. **No paid model calls.** No OpenRouter run, no `harness --mode record`. The account's balance is shared with
   another company's production (the owner's ruling O23, O26).
5. **No personal data in output.** No client names, email bodies, addresses or phone numbers in the report, logs or
   any file. Report counts, ids (thread ids, R/J numbers, ticket ids) and code locations (`file:line`).
6. **Tests run on PGlite only:** `npm test -- test/<file>.ts`, or `npm run test:all` for the whole suite (about 10
   minutes). Both use `test/fixtures/pg.ts`, an in-memory Postgres. Never with a production URL in the environment.
7. **Spawn no fleets of sub-agents** unless the person who commissioned the audit says so. A previous four-agent
   audit cost most of a weekly budget in 20 minutes.

---

## 2. The business and what the software is for

**Spartan Crew** supplies event crew (general crew, crew chiefs, carpenters, drivers with vans, technicians, bar
staff) to event agencies, venues and production companies, mostly in London. Clients email a shared bookings mailbox
to ask for crew, change bookings, cancel, send POs and pay. Spartan's office staff run every booking in **OnSinch**, a
third-party staffing system. Orders there carry an **R** number (the order) and **J** numbers (its jobs). Each job
holds shifts ("SlotTeam" positions with "Slot" seats), each with a day, times, a venue ("place") and a profession.

The software reads every client email, works out what the client asked for and which booking it is about, and either
plans the OnSinch change (a **write**) or hands it to a person (a **handoff**). The office **TV** shows what a person
still has to do. **Writes are switched off** (the owner's ruling O2/O20): today the system runs in shadow. It plans,
measures itself against what staff actually do in OnSinch, and shows the TV. The audit must judge it as it runs today
(shadow, TV, labels, measurement) and as it would run with writes on (the write path is built and tested, not live).

The people:
- **The owner:** Ben, who rules on everything. "The owner" in the docs is him; the rulings are O1-O31 in DECISIONS.md.
- **Paz:** the office lead, whose yes is needed for display and TV changes (O4).
- **Staff:** the office team, who use OnSinch and the TV.
- **Nico:** the author of the 23 Oct review that became ADDENDUM §1-§9.
- **User 2257:** the system's own OnSinch user (BOT in `done.ts`). Its writes are never counted as staff's work.

---

## 3. The system at a glance

```
Gmail bookings mailbox
   |  n8n workflow (outside this repo's runtime; JSON exports in n8n/) posts each thread
   v
/api/n8n-inbound --> n8nInbound.ts --> store first (inbound_raw, thread_messages)
                                  --> v2/process.ts decideDelivery/decideMessage
                                        1. filter (not a client, Spartan's own, automated)
                                        2. read: ONE model call (interpret/extract.ts, OpenRouter, gpt-6.1-sol)
                                        3. ground: every value must be in the email's words (ground.ts, interpret.ts)
                                        4. plan: which booking, which change (plan.ts, identity/, links.ts, threadOrder.ts)
                                        5. record: one v2_decisions row (kind none|handoff|write, reason codes),
                                           steps in v2_trace
                                        6. write: bot (v2/bot/) ONLY if both write keys are on -- today they are off
   |
Vercel cron, every minute: /api/bot/sync (runSync steps, ok only if every step succeeds)
   - stopped writes resumed or closed (resume.ts); the undecided sweep; failed reads retried
   - re-plan every open card against OnSinch now (replan.ts)
   - pull OnSinch truth: booking timeline, contacts, orders (loop/truth.ts) -- GETs only
   - judge outcomes; record staff actions (loop/outcomes.ts, judge.ts, actions.ts)
   - cards: done.ts over every open need -> feed_marks (done / possibly / agreed); card exits; TV history
   - test-data sweep (gated); Gmail labels (via an n8n webhook)
Vercel cron, every 5 minutes: /api/health/heartbeat (stalled intake, sweep, sync or labels -> owner alert)
   |
/api/feed --> feed/serve.ts, project.ts, v2.ts --> the TV (LiveFeedScreen) and All Opportunities
                                                    (reads the database only, never OnSinch)
```

**External systems:**

| System | Used for | Where | Notes |
|---|---|---|---|
| Gmail | The bookings mailbox | n8n; `app/lib/mail/` (Gmail API poll, dormant) | Labels are applied by n8n with the mailbox's credential. Domain-wide delegation for the app is not granted yet. |
| n8n | Intake (posts threads), label applying | `n8n/*.json`, `scripts/install-*.mjs` | **O1: no heartbeat or schedule may live in n8n.** Four n8n schedules still exist (ADDENDUM R3/F32); the switch-over waits on `CRON_SECRET`. |
| OpenRouter | The reader (`extract.ts`), the help assistant (`/api/help`) | `SPARTAN_INTERPRET_MODEL`, `HELP_MODEL` | One key, shared balance. |
| OnSinch | Read: orders, timeline, contacts, places, professions. Write: the bot | `app/lib/onsinch/`, `app/lib/v2/bot/` | Writes: creates through the API, edits through the staff screens with headless Chromium (playwright-core + @sparticuz/chromium). Every write is read back. |
| Neon Postgres | Everything | `app/lib/migrations.ts` | 131 MB on 2 Nov. Preview deployments share production's database (F44, open). |
| Vercel | Hosting, crons | `vercel.json` | Crons need `CRON_SECRET` (not yet set). |

---

## 4. State on 2 Nov 2026 (verify; do not trust)

Measured read-only on 2 Nov:
- **Settings** (`app_settings`): `bot_writes_enabled=false`, `replies_enabled=false`, `intake_paused=false`,
  `create_lead_days=14`, `create_lead_enabled=true`, `test_data_autoclear=true`.
- **Volumes:**

  | Table | Rows |
  |---|---|
  | inbound_raw | 6,773 |
  | thread_messages | 8,316 (Feb 2024 to Nov 2026) |
  | v2_decisions | 1,340 (none 899, handoff 322, write 119) |
  | v2_trace | 7,015 |
  | job_links | 576 |
  | feed_marks | 1,101 |
  | onsinch_orders | 2,988 |
  | onsinch_timeline | 43,904 |
  | onsinch_contacts | 1,382 |
  | v2_outcomes | 1,183 |
  | v2_staff_actions | 841 |
  | v2_card_exits | 109 |
  | bot_ledger | 159 |
  | error_reports | 9 |

- **Intake** is n8n, posting to `/api/n8n-inbound` (`INTAKE_PATH`, `app/lib/intakePath.ts`). The Gmail poll
  `/api/mail-poll` is built and dormant.
- **The TV** shows open needs. Gmail labels follow the TV every minute: four mutually exclusive order labels plus
  Needs Follow Up.
- **Blocked outside the code** (ADDENDUM §0): `CRON_SECRET` in Vercel; Gmail domain-wide delegation; a Neon branch for
  Preview; `SPARTAN_TRACE_SALT`; several of Paz's answers.

The ADDENDUM's top "Last updated" line is a running log, newest first. Each entry names a ticket (S-0xxx). The
ticket's numbers are in `public/data/feed.json`, and the commit carrying it is found with `git log --grep "S-0xxx"`
or the ticket id.

---

## 5. Code map

Total: 745 tracked files. `app/lib` is about 21,700 lines; the API routes about 1,200.

### 5.1 Intake and storage
| File | Role |
|---|---|
| `app/api/n8n-inbound/route.ts`, `app/lib/n8nInbound.ts` | Machine route n8n calls; stores, then decides |
| `app/lib/inboundRawDb.ts`, `app/lib/threadMessagesDb.ts` (401) | Raw payloads; one row per message |
| `app/lib/messageLedgerDb.ts`, `app/api/dedupe` | Dedupe claims |
| `app/api/mail-poll/route.ts`, `app/lib/mail/*` | Gmail API intake, dormant; RFC822 parsing (`rfc822.ts`, 357) |
| `app/lib/intakePath.ts`, `app/lib/paused.ts` | Which intake decides; the pause and the write keys |
| `app/lib/intakeHealth.ts`, `app/api/health/*`, `app/lib/heartbeat.ts` | Is mail still arriving; the 5-minute heartbeat |

### 5.2 Deciding (v2)
| File | Lines | Role |
|---|---|---|
| `app/lib/v2/process.ts` | 597 | `decideDelivery`/`decideMessage`, store-only, the sweep, `botWrites()` (two keys) |
| `app/lib/v2/interpret/extract.ts` | 182 | The one model call; the prompt (SYSTEM); `PROMPT_ID` is its hash |
| `app/lib/v2/interpret/context.ts` | 73 | What the reader sees besides the email |
| `app/lib/v2/interpret/ground.ts` | 415 | Grounding: every value in the email's words; `latestText`, `datesIn` |
| `app/lib/v2/interpret/interpret.ts` | 437 | Directed values ("instead of"), `confirms()` |
| `app/lib/v2/interpret/plan.ts` | 1,114 | The planner: `findOrder`, `bookedAt`, `targetShift`, `decide()` in steps. **The riskiest file.** |
| `app/lib/v2/identity/index.ts`, `links.ts`, `threadOrder.ts`, `threadState.ts`, `evidence.ts` | | Which booking: identity, absolute links (R/J/PO), thread state |
| `app/lib/v2/reasons.ts` | 99 | Stable reason codes; meaning read only here |
| `app/lib/v2/replan.ts`, `resume.ts` | | The minute re-plan; resuming stopped writes |
| `app/lib/v2/trace.ts`, `traceLive.ts` | | One `v2_trace` row per step; addresses hashed; no email text |
| `app/lib/v2/score.ts`, `metrics.ts` | | Strict scoring used by the harness and metrics |

### 5.3 Writing to OnSinch (off in production)
| File | Role |
|---|---|
| `app/lib/v2/bot/run.ts` (373) | One operation: lease, ledger intent, read before, write, read back, verdict. A seen key never runs again; "unknown" is final. |
| `bot/apiCreate.ts`, `builder.ts`, `wizard.ts`, `session.ts`, `browser.ts` | Create through the API; edits in the staff screens (Chromium) |
| `bot/ops.ts`, `contract.ts`, `contracts.json` (1,352) | Operation shapes, op keys, the write contracts |
| `bot/db.ts`, `canary.ts` | Lease and ledger; the canary (never call it) |
| `app/lib/onsinch/onsinch.ts` (985), `resolve.ts` (810), `types.ts`, `normalize.ts`, `reconcile.ts`, `format.ts` | The OnSinch client and what v2 kept of the old engine (`app/lib/onsinch/README.md`) |
| `app/lib/testData.ts` (304) | The test-data sweep (deletes test orders; gated by the pause, both write keys, a log) |

### 5.4 Measuring against staff (the loop, ADDENDUM §12)
`app/lib/v2/loop/truth.ts` (timeline pull), `judge.ts`, `outcomes.ts`, `actions.ts`, `variants.ts` (both versions of a
rule shadow-scored), `cards.ts` (`markNeeds`, card exits).

### 5.5 The TV
| File | Role |
|---|---|
| `app/lib/feed/done.ts` (372) | **The one answer to "is this need done".** Rungs to find the job, work that fits the ask, agreed, withdrawn, quote waits, and provisional orders (O31). Pure: no I/O. |
| `feed/v2.ts` (293) | Decision rows into TV items and needs (`v2Source`, `rowsOnCard`) |
| `feed/project.ts` (414), `serve.ts`, `live.ts`, `cardNote.ts`, `order.ts`, `ported.ts`, `history.ts`, `marksDb.ts`, `opportunities.ts`, `check.ts` | Projection, serving, card notes, history, All Opportunities |
| `app/lib/mail/threadLabels.ts` | The four order labels and Needs Follow Up, derived from the TV |
| `app/components/*.tsx` | The UI: LiveFeedScreen (TV), OpportunitiesScreen, SettingsScreen, HelpWidget, onboarding |

### 5.6 Other features
- `app/lib/followup/*` and `/api/followups`: follow-up drafts. Behind `NEXT_PUBLIC_SPARTAN_FOLLOWUPS`; replies are off.
- `/api/help`: the help assistant, an OpenRouter call; its guide is `app/lib/help/knowledge.ts`, pinned by
  `test/helpGuide.ts`.
- `app/lib/errorReport.ts` (451): alarms to the owner.
- `app/lib/settingsDb.ts`, `/api/settings`: switches; admin-only for the write and reply switches (A1), with
  `settings_history`.
- Auth: `middleware.ts`, `app/lib/apiAuth.ts`, `session.ts` (iron-session), `googleAuth.ts`, `authAllowlist.ts`.
- `app/lib/onboardingDb.ts`, `metricsDb.ts`, `ticketsDb.ts` (the retired jobs board's store), `jobsDb.ts`.

### 5.7 Outside the app
| Area | Contents |
|---|---|
| `scripts/` | 135 scripts: 43 can write, 66 read production, 26 offline. `scripts/README.md` classes each; `test/scriptsIndexed.ts` keeps it true. |
| `harness/` | Verification harness: the real-mail replay (`real/`), generated business on a fake OnSinch (`sim/`, `gen/`), board cases, hand outcome labels (`outcome/`) |
| `test/` | 125 files; `test/all.ts` runs them |
| `eval/`, `audit/`, `fleet/resume/`, `docs/` | Measurements, past audits, handoffs; mostly history (`docs/README.md` marks each doc) |
| `n8n/` | Workflow exports and the payload builder node (`n8n/nodes/build-engine-payload.js`, tested by `scripts/test-engine-payload.mjs`) |

---

## 6. Data model

All schema is in `app/lib/migrations.ts`: 108 migrations, append-only, applied by `migrate()` once per database. No
CREATE or ALTER may appear elsewhere. Tables by purpose:

| Purpose | Tables |
|---|---|
| Mail | inbound_raw, thread_messages, message_ledger, sender_ledger, sender_ledger_threads, mail_cursor, mail_seen, conversation_state, sweep_threads, sweep_labels, thread_labels |
| Decisions | v2_decisions, v2_store_only, v2_trace, job_links, entity_aliases |
| The bot | bot_session, bot_lease, bot_ledger |
| OnSinch mirror | onsinch_orders (body JSON, deleted_at), onsinch_timeline (booking rows), onsinch_parts, onsinch_contacts, onsinch_places, onsinch_professions, order_records, order_archive, rate_cards |
| The loop | v2_loop_meta, v2_variants, v2_outcomes, v2_staff_actions, v2_card_exits |
| TV | feed_marks (done, possibly, agreed, checked, resolved, dismissed, open), feed_meta, feed_history |
| App | app_settings, settings_history, error_reports, run_marks, metric_events, user_onboarding, org_terms_acceptance, followup_suppressions, test_data_clears, tickets, ticket_events, schema_migrations |

Things the audit must know:
- **feed_marks are sticky.** Once a need is marked `done`, or `agreed` other than a quote wait, `markNeeds` never
  reads it again (`cards.ts`). A rule change applies only to needs not yet marked.
- **Personal data at rest:** full email bodies (thread_messages.body, inbound_raw payloads), sender addresses,
  OnSinch contacts. `scripts/archive-thread-bodies.mjs` moves old bodies out. The trace keeps no text and hashes
  addresses when `SPARTAN_TRACE_SALT` is set (it is not; addresses are blanked). Retention: trace 90 days; feed
  history 30 days.

---

## 7. Entry points and authentication

`middleware.ts` gates `/api/*` behind an iron-session login when `AUTH_REQUIRED=true` or on any preview deployment.
Its `SKIP` list (`/api/auth`, `/api/bot`, `/api/n8n-inbound`, `/api/mail-poll`, `/api/dedupe`, `/api/health`) are
machine routes with their own gates in `apiAuth.ts`:
- `authorizeMachineCall`: `N8N_WEBHOOK_SECRET`.
- `authorizeCronCall`: `CRON_SECRET` as a Bearer token. Until that secret is set, the intake secret still opens it.
- The bot: `BOT_SECRET` in `x-bot-secret`.
- The default: no secret configured means refused in production.
- `test/writeRoutesAuthorised.ts` and `test/machineRouteAuth.ts` pin parts of this.

The auditor should build the full matrix: each route, method, intended caller, gate, what it reads, what it writes,
and whether a test pins it. Known points to check:
- **`INTERNAL_API_SECRET`** is read by `middleware.ts` (an `x-internal-secret` header bypasses the session) but is
  **not listed in `.env.example`**. `scripts/env-names.mjs`, which writes that file and backs `test/envExample.ts`,
  scans `app/` only, and `middleware.ts` sits at the repo root. Nothing in the repo sends the header except
  `test/writeRoutesAuthorised.ts`. Is the variable set in any Vercel environment? If it is, what can a holder of it
  reach? If it is not, the bypass is dead code.
- `/api/bot/*` sits in the SKIP list: confirm every handler under it enforces `BOT_SECRET` and fails closed.
- Cron routes accept the intake secret until `CRON_SECRET` is set (F3, deliberate). Quantify the exposure.
- Preview deployments share production's database (F44). The middleware forces auth on previews; check every
  machine route on a preview too.
- The session cookie (`SESSION_PASSWORD`), the Google sign-in allowlist (`AUTH_ALLOWED_DOMAIN`/`EMAILS`), and the
  break-glass `ADMIN_SECRET`.

---

## 8. The rules the software must keep (audit each against the code)

From `CLAUDE.md`, ADDENDUM §2 and `DECISIONS.md`. A finding is any path where one does not hold.

**Write safety:**
1. **Capture before deciding:** an email is stored before any reading. A throw before Save is blocked; after Save it
   is "unknown" and never retried.
2. **The op ledger runs a seen key once.** Edits are read back and diffed against OnSinch's audit rows.
3. **Two write keys, failing closed:** `SPARTAN_WRITES=live` and the Settings switch (`process.ts` `botWrites`).
4. **The planner refuses:** a partial email; the day alone (V1); a past day (V27); staff's own edits (V22); an
   ambiguous shift.
5. **Failures are visible:** a failed read or plan becomes a card; a failed TV read is a 500, never an empty list.

**Labels and the TV:**
6. Exactly four mutually exclusive order labels (Order Created, Order Updated, Order Needs Created, Order Needs
   Updated), plus Needs Follow Up on another axis. All derived from the TV each minute; nothing sets one by hand.
7. A draft is not a message: an unsent Spartan draft never counts as a reply.
8. A job whose days have all passed never shows (O13).
9. Staff's work counts only on the need's own job (O14).
10. Absolute links (an R, J or PO OnSinch holds) overrule inferred ones (O17).

**Platform:**
11. No heartbeat or schedule in n8n (O1).
12. Never write `Job.min_beginning`/`max_end`.
13. The place `6922 "No Location"` is exempt from every venue phase; exactly one may exist.
14. Zero references is permission to delete a thing, never a reason to.

**The owner's standing rulings:**
- Writes off (O2, O20).
- A quote acceptance hands off (O5, O12).
- One order per venue (O10).
- A missing year is the sent year (O22).
- A booking on a provisional order is not done until staff confirm it (O31).

The full list is O1-O31 and V1-V35 in DECISIONS.md, each with the files that carry it. The audit should sample them,
or for a deep audit verify every one: the rule is in the code, a test pins it, and its tag is in the comment.

---

## 9. Tests, harness and measurement

- **The gate** (`scripts/session.py`): `tsc --noEmit`, then the whole suite, then a ticket appended to
  `public/data/feed.json`, a commit by pathspec and a push. `--self-test` proves it can go red. A failed suite writes
  nothing.
- **Unit and integration tests** (`test/`, 125 files) on PGlite. Check what they cannot see:
  - real OnSinch behaviour (faked);
  - the model (fixtures);
  - concurrency between the minute sync and intake;
  - Vercel time limits;
  - the n8n side.
- **The harness** (`harness/README.md`):
  - oracle and mutant modes at $0; record and replay of model calls;
  - `harness/real/` replays real mail on a time-correct world;
  - `harness/sim/` and `harness/gen/` drive generated jobs through a fake OnSinch, the whole pipeline and the TV;
  - `harness/outcome/labels.tsv`: 1,145 hand-labelled threads, the reference for the reader's three-way decision.
- **Measurement claims.** The ADDENDUM is full of measured numbers, such as "+4.9% card-hours" and "0 wrong writes in
  180". **An auditor should re-derive a sample.** Many were produced by local scripts in `.tmp-v2/`, which is
  git-ignored and not in the clone. Where a number's script is not in the repo, record that the claim cannot be
  reproduced from the repository. That is a finding about evidence custody, not about the number.

---

## 10. Known open items and leads (starting points, not conclusions)

**From ADDENDUM §0** (verify each is still open):
- **Open owner decisions:** F5 (the two-week rule), F6 (an unknown sender creates a client), F19 (dd/mm dates), F51
  (a link takes new shifts on any day its order holds).
- **Open builds:** F41 (the Needs Reply lane); F42; F54 (the n8n path cannot see unsent drafts); F44 (the preview
  database); R3 (the cron switch-over); 5.7; and held items 6 and 8.
- F53: the minute reads grow with history (about 400 KB a minute, measured; deferred).

**From §15** (2 Nov):
- The reader decides 94 of 132 first yeses after a quote as "none". O31 made the TV catch most of them through
  `done.ts`.
- The client's yes in words alone: 0.78 precision, 0.81 recall (n 120). 38 quote waits ended with staff confirming
  while the system still waited on the client.
- 25 threads had no need at all, because the reader read the request as nothing.
- 8 false cards came from supplier mail: Spartan buying crew from other companies.
- 112 threads end on an unanswered client email with no Needs Follow Up tag (Q6).

**Seen while writing this brief** (unverified; each is a lead):
- `INTERNAL_API_SECRET` (section 7).
- **O31 reuses the `possibly` mark** to carry "still provisional: confirm it" (`done.ts` doneVerdict; `cards.ts`).
  Elsewhere `possibly` means "staff worked on two candidate orders". Check every reader of the mark: analytics, the
  card-exit record, All Opportunities, the labels. Does each treat the two meanings correctly?
- **Sticky marks:** a need marked done under an older rule is never re-read. Is there a path where a wrong `done`
  hides work permanently? Measure how many open needs are hidden that way.
- **The reader's decision letters:** none, handoff, write (`v2_decisions.kind`). With writes off, a "write" is a TV
  card reading "Not written: do it by hand". Check that every consumer treats a planned write as work owed.
- **`settings_history` has 0 rows.** Either no switch has changed since the table was made (29 Oct), or the history
  is not written. Check.
- `plan.ts` (1,114 lines), `onsinch.ts` (985) and `resolve.ts` (810) carry most of the risk. Look for branches no test
  reaches.
- **Two data paths for "is the order provisional":** the stored body's `provisional` flag, and the timeline's confirm
  rows and flag edits. 2 orders were confirmed in the timeline while their stored body still said provisional. How
  fast is a stored body refreshed after staff change it?

---

## 11. Audit dimensions, questions and where to look

For each dimension:
- **Read** the files named.
- **Answer** the questions, with evidence.
- **Run** the cheap checks.
- **Record** findings in the format of section 13.

Aim for depth on A-D; they decide whether a client's booking is right.

**A. Decision correctness (reader, grounding, planner)**
- Does every client email reach a decision? Look for the paths where it doesn't: `process.ts`, the sweep,
  `test/everyEmailDecided.ts`.
- Can a value reach a write without being in the email's words? Trace `ground.ts` and `interpret.ts` into `plan.ts`.
- Which booking: the absolute links (`links.ts`), the rungs, V1 "never the day alone". Find inputs where two orders
  qualify and the planner picks one anyway.
- Times, dates, years, time zones: London versus UTC (`utcToLondon`), dd/mm, missing years (O22), night shifts across
  midnight.
- Crew counts, chiefs (V13), professions, durations beside end times (F22).
- Re-plan determinism: does replaying the same rows give the same answer? (`test/replanSameAnswer.ts`)

**B. The TV's truth (`done.ts`, `cards.ts`, `feed/*`)**
- For each verdict path (done, possibly, agreed by quote or terms, cancel agreed, withdrawn, quote sent, provisional),
  find inputs that clear a need wrongly and inputs that keep a done need open.
- The regexes QUOTE, PO_SENT, ACK, TERMS, WITHDRAW and REPLACE (`RULES` export): construct real-looking counter-cases.
  The blind-test numbers are in ADDENDUM S-0286.
- Stickiness and the 24-hour green dwell; passed days (O13); the label derivation (`threadLabels.ts`): four
  exclusive labels.
- Does the TV ever show an empty list on a failed read (it must be a 500)?

**C. Write path safety (even though writes are off)**
- Could anything write to OnSinch today? Trace every caller of the bot and of OnSinch POST/PUT/DELETE: `run.ts`,
  `apiCreate.ts`, `testData.ts`, scripts. Confirm both keys gate each one.
- Ledger idempotency: a crash between Save and the verdict ("unknown" is final), lease expiry, two sync runs at once.
- Read-back and diff (`createMismatches`, the audit rows). Staffed positions (V19): a change leaving fewer seats than
  workers.
- The test-data sweep deletes orders in the live tenant (F15): exactly what selects an order as test data?

**D. Security and access**
- The route matrix (section 7). Secrets compared in constant time (`safeEqual`). Fail-closed defaults in production.
- Preview deployments on production's database. `INTERNAL_API_SECRET`. The admin switches (A1).
- Secrets in the repo history (scan; report only that a secret exists and where, never its value).
- The help assistant: a model fed live state. Prompt injection from email text through `/api/help` or
  `liveState.ts`?
- The bot's OnSinch UI password and session storage (`BOT_SESSION_KEY`, `bot_session`).

**E. Privacy and data protection**
- What personal data is stored, where, for how long, and who can read it (DB, logs, error reports, trace, Vercel
  logs, n8n).
- Do any logs or error reports carry email text? (`errorReport.ts`, console logs in routes)
- Retention jobs: do they run? (`archive-thread-bodies`, `pruneTrace`, feed_history)

**F. Reliability and operations**
- The minute sync: step order, failure isolation (`runSync`), time budget against Vercel's function limit, what
  happens when one step throws.
- The heartbeat: does each alarm fire for its stall? (`test/heartbeat.ts`) Are the alarms delivered (webhook,
  recipients)?
- Dependence on n8n for intake and labels. What happens if n8n stops? (`intakeHealth`, the outside watchdog)
- The OpenRouter key's cap or balance running out: does intake store and retry (`retryUnread`)? Is the owner told?
- Deploy behaviour: a deploy during a write (F38), migrations at request time (F44's schema half, done).

**G. Performance and cost**
- The minute reads (F53), database size growth, the sync's query count, `serveFeed`'s query count (pinned constant
  in `test/feedDone.ts`).
- Model cost per email and the reader's retries.

**H. Code quality and maintainability**
- Large files and long functions (plan.ts `decide()`, onsinch.ts). Dead code against "zero references is permission,
  not a reason". Duplicated logic (for example two `provisional` sources; `bt-load`-style loaders copied in scripts).
- Types: `any` at boundaries, unchecked JSON from OnSinch (`types.ts`, `normalize.ts`).
- Comments: the repo's standard is that a comment states a constraint the code cannot show. Note comments that
  narrate or contradict the code.

**I. Tests and evidence**
- Coverage of the riskiest branches (A-C). Tests that assert implementation, not behaviour. Tests that cannot fail.
- The gate's integrity (F48 was a failed file passing the gate), `--self-test`.
- Reproducibility of the ADDENDUM's measured claims (section 9).

**J. Documentation accuracy**
- Does `CLAUDE.md`'s map match the code? Does the ADDENDUM's status table match the code and tests?
- Does the help guide (`knowledge.ts`) describe what the screens do?
- Are the stale-doc guards (`test/staleDocs.ts`) enough?

**K. The UI**
- What staff see on the TV and in All Opportunities: does each card say what to do and what to check (O16, V8)?
- Accessibility basics. Tooltips (`TipHost`). Mobile (`useIsMobile`). The PWA (`Pwa.tsx`).

**L. Integrations**
- The OnSinch client against `docs/Spartan-Crew-Onsinch-API-Reference.md`: pagination, timeouts
  (`ONSINCH_TIMEOUT_MS`), retries (`test/transportRetry.ts`), rate limits.
- The timeline sync's completeness (ADDENDUM S-0269 claims an exact match to 31 Oct). Deleted orders.
- The n8n payload builder (`n8n/nodes/build-engine-payload.js`) against `routeN8nInbound`. The Gmail label webhook.

**M. Build and dependencies**
- Next 15.5, React 19, playwright-core and @sparticuz/chromium versions and known advisories.
- `npm run build` on Node 25 (`docs/LOCAL-BUILD-NODE25.md`).
- Lockfile integrity.

---

## 12. Method

1. **Orient (about 10% of the effort).**
   - Read CLAUDE.md, ADDENDUM §0 and its latest status line, and DECISIONS.md.
   - Run `npm run test:all` and record the result.
   - Run `npx tsc --noEmit`.
2. **Map.** Build the route matrix (section 7) and a call graph from intake to TV, and from decision to write.
   Confirm or correct section 5's map.
3. **Audit A-M** in that order of priority. For each claim in the docs that matters, find the code that makes it
   true and the test that pins it. A claim with neither is a finding.
4. **Probe.** Write throwaway test cases outside the repo, or in a scratch copy, run on PGlite. Use them to show a
   failure concretely: the input, the expected answer, the actual answer.
5. **Measure** on production read-only only where a question needs real data: counts, never text, through
   `scripts/_readonly.mts`.
6. **Verify every finding before reporting it.** Reproduce it, or show the exact code path with `file:line`. Mark each
   CONFIRMED (reproduced or certain from the code) or PLAUSIBLE (reasoned, not shown).

**Severity:**

| Severity | Meaning |
|---|---|
| **Critical** | A wrong booking could be written to OnSinch, or personal data is exposed to anyone outside the team, or production can be written by an unauthenticated caller |
| **High** | Work owed to a client can be lost or hidden from the TV without an alarm; a safety rule of section 8 can be broken; an alarm that should fire does not |
| **Medium** | A wrong card, a wrong label, a misleading note; a measurement that cannot be reproduced; a fragile invariant held only by convention |
| **Low** | Maintainability, documentation drift, style |

---

## 13. The report

One Markdown report:

1. **Summary:** the five findings that matter most, each in one sentence; overall judgement per dimension A-M (sound,
   concerns, unsound).
2. **Scope and method:** what was read, run and measured; what was not, and why.
3. **Findings**, most severe first, each as:
   ```
   ### <ID> <one-line statement of the defect>
   Severity: Critical|High|Medium|Low   Status: CONFIRMED|PLAUSIBLE   Dimension: A-M
   Where: file:line (and any other locations)
   What happens: the concrete input or state, and the wrong outcome it produces
   Evidence: the test, query (counts only) or code path that shows it
   Rule broken: the invariant or ruling (section 8 / DECISIONS id), if any
   Suggested direction: one or two sentences; no patch
   ```
4. **Verified strengths:** the safety properties that held under probing, with how they were tested, so later work
   does not undo them.
5. **Doc and status corrections:** each ADDENDUM or CLAUDE.md statement found false.
6. **Open questions for the owner:** decisions only the business can make.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| R / J | An OnSinch order number / job number. A card shows its thread's own R and J or none (V29) |
| PO | The client's purchase order number; how many clients confirm |
| Provisional / Price Quotes | OnSinch order states before confirmation; staff make a provisional order to build a quote (O31) |
| Need | Work a client email asks for that the TV tracks until done (`feed/v2.ts` `v2Source`) |
| Card / tile | A need or handoff on the TV |
| Mark | A `feed_marks` row: done, possibly, agreed, checked, resolved, dismissed, open |
| Handoff / write / none | The planner's three decision kinds (`v2_decisions.kind`) |
| Shadow | Deciding and measuring without writing to OnSinch (writes off) |
| Ticket S-0xxx | One gate run: the numbers in `public/data/feed.json`, and one commit |
| F-, R-, O-, V-, A- ids | Findings and rebuild steps (ADDENDUM), the owner's rulings, rulings in code, defaults (DECISIONS) |
| Rung | The order in which `done.ts` looks for a need's job: absolute link, guessed link, venue and day, day |
| Quote wait | A need whose quote waits on the client, off the TV ("Quote sent") |
| 2257 | The system's own OnSinch user; never counted as staff |
