# CLAUDE BUILD MANUAL — Spartan Crew Enquiry Engine (full build)

*Audience: a Claude Code session executing the build. Human context:
`BUILD-OVERVIEW.md`. API ground truth: `Spartan-Crew-Onsinch-API-Reference.md`
(every claim in it was verified live 2026-07-20 — trust it over intuition).
Repo: `D:\code\SpartanCrew-Enquiry-Engine` = github `Bmikus4/Spartan-Crew-Jobber`,
auto-deploys to Vercel project `spartan-crew-jobber` on push to main.*

---

## 0. Non-negotiable invariants (check every diff against these)

- **I1 — RATE:** every `POST /orders` carries an explicitly resolved
  `Job.pricelist_category_id`. Unresolvable → `needs_human=true`, order held.
  Never rely on OnSinch's silent default (verified: it assigns one).
- **I2 — ID CUSTODY:** persist every id learned at write time (order_id, job_id
  via readback `?id=N&with=Job`, slot-team ids from `POST /slotTeams` responses)
  into the state row. Several can never be read back later (no GET /slotTeams).
- **I3 — IDEMPOTENCY:** `compile()` only reads; re-running any thread produces
  zero duplicate writes. Every new write path must preserve the
  `last_ordered_hash` diff-gate. The offline test must keep proving this.
- **I4 — LLM BOUNDARY:** the model only classifies, extracts typed facts, and
  writes reply prose. It never resolves an integer id, never picks a rate,
  never builds an order body. Temperature 0, model `anthropic/claude-opus-4.8`
  via OpenRouter (`SPARTAN_MODEL` env).
- **I5 — DRAFT-ONLY DEFAULT:** `order_mode:"draft-only"` until the auto-flip
  gate (§E3) passes. Auto-flip is a human (Ben) decision, never yours.
- **I6 — VERIFY OR IT DIDN'T HAPPEN:** each phase ends by running its listed
  verification. `npm test` (offline, 20+ assertions) and `npx tsc --noEmit`
  must pass before any commit; never push a red build.

**Claude designation.** Main session (Opus-tier or above): all engine code,
anything touching invariants. Subagents: `Explore` for recon; `general-purpose`
for parallelizable mechanical work (prompt porting, data pulls, corpus scans) —
subagents never edit `compiler.ts`/`compose.ts`/`format.ts` directly; they
return material the main session integrates. Scripts before models: any task a
`.mjs` script can do deterministically (data pulls, aggregation, scoring) gets
a script, not tokens. Windows note: local `next build` hits a known EISDIR
quirk — build verification is Vercel's deploy, local verification is
`tsc --noEmit` + `npm test`.

**OnSinch quick contract** (details in the API reference): base
`https://spartancrew.onsinch.com/api/v1`; header `Authorization: apikey <KEY>`
(not Bearer); list-only reads (`?id=N`, `?id[in]=`); every write body is an
array; PATCH/DELETE → 204 no body; DELETE body = `[id,…]` and cascades
Job+SlotTeams; endpoints are **camelCase** (`/slotTeams`, `/orderItems`);
`PATCH /orders` is top-level-only — slot changes go through `POST/PATCH
/slotTeams` (add/change owned teams) or delete+recreate while provisional;
`PATCH /jobs` can fix `pricelist_category_id` after creation; `/users` is
read-only → unknown sender = needs-human; SlotTeam has **no** money fields;
create requires `name, company_id, user_id` + `Job` with ≥1 `SlotTeam`, each
SlotTeam requires `place_id` (top 400 cause).

---

## PHASE A — Truth alignment (engine ↔ verified API)

*Everything below `app/lib/engine/`. Keep the transport injectable; extend the
offline mock in `test/mocks.ts` to the new contract as you go.*

- **A1 `types.ts`:** extend `DesiredOrder` with `pricelist_category_id:number`,
  `quote:boolean`, `provisional:boolean`, `intern_name?`, `specification?`,
  `order_manager_id?`; SlotTeam gains `description?`. `ConversationState` gains
  `onsinch_job_id?:number` and `owned_slot_team_ids?:number[]` (I2).
- **A2 `format.ts`:** emit the verified body — `Job:{name, pricelist_category_id,
  supervisor_id?}`, top-level `quote/provisional/request_approval/intern_name/
  specification/order_manager_id`. `validateOrder` adds: missing
  `pricelist_category_id` is an error (I1).
- **A3 `onsinch.ts`:** add `createSlotTeams(job_id, teams[])` → returns ids,
  `patchSlotTeams([{id,…}])`, `patchJob([{id, pricelist_category_id,…}])`,
  `deleteOrders([ids])`, `getOrderWithJob(id)`. Company client lookup:
  `GET /companies?id=N&with=Client`.
- **A4 `rates.ts` (new):** `resolveRateCard(company_id, deps) →
  {card:number|null, confidence:'seeded'|'history'|'ambiguous'|'none'}`.
  Algorithm: (1) seeded lookup table (Phase B) wins; (2) else last N=20 orders
  `?company_id=X&sort=-id&with=Job`, count categories weighted w=0.5^rank —
  accept iff top card share ≥0.7, else 'ambiguous'; (3) 'ambiguous'/'none' →
  needs-human. Cache result on the state row.
- **A5 `compose.ts`:** rate card into the order (I1); `user_id` resolution via
  the company's Client list, matched on sender email — no global user search;
  unknown contact → needs-human (users are read-only).
- **A6 update semantics in `compiler.ts`/`pipeline.ts`:** order-level diffs →
  `PATCH /orders`; wrong rate → `PATCH /jobs`; ADD crew block →
  `POST /slotTeams` (persist returned ids, I2); change to a block whose id we
  hold → `PATCH /slotTeams`; change to the nested-unknown first block → while
  `provisional && unstaffed`: DELETE + re-POST (cascade verified), else
  needs-human.
- **A7 tests:** extend `test/run.ts` — target ≥30 assertions. New: order body
  carries rate card; missing card blocks create; slotTeam-add persists ids;
  delete+recreate path; ambiguous-rate → needs-human; everything still
  idempotent on re-run.

**Verify A:** `npm test` green (≥30), `tsc --noEmit` clean, and one live
smoke against TEST company 515 / user 1591 (create provisional+quote with
explicit card 197 → readback shows it → patch job to 311 → verify → DELETE →
verify gone). Clean up everything you create.

## PHASE B — Rate ground truth (parallel with A)

- **B1 `scripts/rate-study.mjs`:** pull ALL orders `with=Job` (paginate 100/pg,
  ~6.6k orders), aggregate per company: cards, counts, recency; emit
  `data/rate-map.json` = `{company_id: {card, share, lastUsed, n}}` using the
  A4 weighting. Also emit the ambiguous list.
- **B2 seed Neon:** table `rate_cards(company_id pk, card int, source
  'history'|'ops', share float, updated_at)`; loader script upserts B1 output.
  `rates.ts` reads this first.
- **B3 the Tracy ask (draft for Ben to send, don't send yourself):** admin-UI
  export of client → default pricelist **with card names**; plus the open
  question — is the silent default (observed 245) per-company or global?
  When the export arrives: upsert as source='ops' (beats 'history').

**Verify B:** rate-map covers ≥90% of companies with 2026 activity;
spot-check 5 known clients' cards against their latest real orders.

## PHASE C — Live plumbing (needs A)

- **C1 secrets:** `OPENROUTER_API_KEY` + `ONSINCH_API_KEY` on Vercel (Ben holds
  values; `vercel env add`, all envs). `ONSINCH_BASE_URL` already defaults.
- **C2 n8n trigger workflow (NEW workflow — do not modify existing ones):**
  Gmail poll (bookings inbox, 1-min) → fetch full thread (every message,
  headers + text) → POST `https://spartan-crew-jobber.vercel.app/api/n8n-inbound`
  with `x-webhook-secret` (set in Vercel as `N8N_WEBHOOK_SECRET`) and body
  `{thread_id, messages:[{message_id,from,to,date_iso,subject,body}]}`.
  Nightly cron sweep: re-POST the last 48h of threads (idempotency makes this
  free — it's the never-miss-a-lead backstop).
- **C3 reply drafting:** simplest seam first — engine returns the composed
  reply; the n8n workflow creates the Gmail draft with Message-ID threading
  (port the existing raw-HTTP draft node). `GMAIL_DRAFT_WEBHOOK` stays unset.
- **C4 prompts:** port the FULL prompts from the live n8n export
  (`D:\Business\SamurAI Solutions\n8n_export_fresh` — Bookings v3.4 reply
  prompt, v1.2 extract prompt) into `app/lib/engine/prompts/*.md`, loaded by
  `reason.ts`. Keep the output schemas as-is (function-calling). Subagent task:
  extract prompt text from the export JSON; main session reviews the merge.

**Verify C:** send one real test email to the inbox → state row appears, reply
draft appears in Gmail, order is STAGED (not written), dashboard tiles move.
Then re-send the same thread → no second staging (idempotent).

## PHASE D — Replay proof (needs A+B+C; gates launch)

- **D1 corpus:** `scripts/replay-corpus.mjs` — assemble ≥100 real historical
  booking threads (n8n export logs / Gmail API / Airtable log) paired with the
  real OnSinch order that was actually created (match on company + happening
  date ±1d). Store as JSONL fixtures.
- **D2 harness:** `scripts/replay.mjs` — run each thread through the pipeline
  with a RECORDING transport (no real writes), score: classification vs truth,
  company/place/user id vs the real order, rate card vs the real order's job,
  slot teams (date/time/size/profession) field-by-field, and double-run
  idempotency.
- **D3 iterate:** failures → fix prompts (subagent drafts variants, main
  session picks) or composer rules; re-run until the gate passes.

**Gate D (all must hold):** job-detection ≥97% · wrong-client = 0 ·
wrong-rate = 0 among resolvable clients · place resolution ≥95% ·
idempotency = 100%. Record the numbers in `docs/REPLAY-RESULTS.md`.

## PHASE E — Launch & earn auto (needs D)

- **E1 confirm-queue UI:** dashboard gains the QUEUE list (state rows
  `status='proposed'` + needs-human lane): per row — client, dates, crew,
  rate-card name, validation state, [Confirm] → `/api/confirm-order`,
  [Needs human] reasons shown. Match the existing HoH-style design system.
- **E2 launch draft-only:** n8n workflow active on the real inbox. Watch week 1:
  every proposed order human-reviewed; log edit-distance between proposed and
  what ops actually confirms/changes.
- **E3 auto-flip gate:** ≥50 consecutive proposals confirmed WITHOUT edits AND
  needs-human rate <20% sustained. Present the numbers to Ben; only Ben flips
  `order_mode:"auto"`. Auto mode still routes: new client, ambiguous rate, any
  validation warning → needs-human (I1 survives auto).
- **E4 rate audit (nightly, forever):** `scripts/rate-audit.mjs` or cron route —
  for newly invoiced orders compare `orderItems.unit_price` per client vs their
  trailing history; drift >10% → flag order, emit metric, and if in auto mode,
  drop back to draft-only automatically.

**Verify E:** one full week of metrics on the dashboard funnel; zero duplicate
orders; zero wrong-rate incidents.

---

## Execution order & budget

```
A ──┬─→ C ──→ D ──→ E        A+B in parallel (B is scripts-only)
B ──┘         ↑
   Tracy export lands anywhere before E
```
Critical path: A → C → D → E. Phases are sized for one focused session each
(A the largest). Every session: read this manual + the API reference first,
run `npm test` before AND after, commit per phase with the verification
output in the commit message, push (auto-deploys).

## Standing decisions (do not re-litigate)

Draft-only launch (Ben, 07-14) · Postgres state store · n8n stays the Gmail
trigger, Vercel runs the brain · OpenRouter for the runtime model (Ben, 07-14) ·
new n8n workflows only — never modify the 3 live ones · crew-chief rule
(≥4 crew) still OPEN — composer flags needs-human until the edge-case study
settles it; do not guess.
