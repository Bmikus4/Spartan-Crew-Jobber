# Spartan Crew Jobber

Enquiry → booking automation for Spartan Crew, rebuilt from the ground up.

Replaces the 3 live n8n workflows (155 nodes total) with **one idempotent
compile loop over a Save State Table**. One Gmail thread = one state row. See
the printed planning doc in `docs/` for the full rationale.

## Shape (v0.02)

A **Next.js app on Vercel** — same architecture as the House of Hud quote tool
(collapsible nav rail, Settings button, dark/amber design system), but the only
client-facing surface is a **Dashboard** + a **Settings** menu. The automation
runs server-side in `app/api`; **n8n only triggers it**.

```
app/
  components/   AppShell · Sidebar (Dashboard-only) · DashboardScreen · SettingsScreen
  lib/
    engine/     the pure engine (compiler, pipeline, onsinch, reason, …) — unit-tested
    metricsDb   Neon metric_events sink + dashboard summary (HoH pattern)
    stateDb     Neon Save State Table (StateStore)
    settingsDb  order_mode (draft-only | auto)
    deps        wires PipelineDeps from env (Anthropic reasoner, http OnSinch)
  api/
    n8n-inbound   POST { thread_id, messages[] }  ← n8n trigger; runs the pipeline
    confirm-order POST { thread_id }              ← dashboard confirm queue
    metrics       GET  → dashboard read-model
    settings      GET/POST
```

**Trigger split:** n8n watches the mailbox and POSTs each hydrated thread to
`/api/n8n-inbound`. Vercel compiles + executes (OnSinch write here). If
`GMAIL_DRAFT_WEBHOOK` is unset, the composed reply is returned so n8n drafts it.

### Env
`DATABASE_URL` (Neon) · `ANTHROPIC_API_KEY` · `ONSINCH_API_KEY` ·
`ONSINCH_BASE_URL` · `N8N_WEBHOOK_SECRET` · `GMAIL_DRAFT_WEBHOOK` (optional) ·
`SPARTAN_MODEL` (default `claude-opus-4-8`).

### Dev
```
npm install
npm run dev      # the dashboard + settings + API
npm test         # engine proof, 20/20, offline
```

## The loop

```
on any Gmail event (poll OR push):
  thread   = gmail.hydrateThread(threadId)     // always the FULL conversation
  prior    = store.get(threadId)               // the Save State row (or none)
  {state, actions} = compile(thread, prior)    // reads only; derives desired state
  execute(actions)                             // reply draft + OnSinch create/patch
  store.put(state)                             // persist (idempotent)
```

Because `compile` only reads and is keyed on `thread_id`, re-running it on any
thread is safe. That is the "never miss a lead" guarantee: a nightly sweep can
re-compile every thread and produce zero duplicate work.

## What's deterministic vs. LLM

- **LLM (3 tasks only):** classify the latest email, extract typed facts,
  write the reply. One model — `claude-opus-4-8`, temperature 0.
- **Deterministic code (everything else):** thread normalization, company/
  place/user id resolution, place scoring (no fuzzy search in OnSinch), order
  composition + business rules, order-body building, dedup, diffing.

The model never resolves an integer id or builds the order body.

## Files

| File | Role |
|------|------|
| `src/types.ts` | `ConversationState` (the state row), `DesiredOrder`, facts |
| `src/normalize.ts` | port of n8n `Normalize Data` (clean bodies, dedupe) |
| `src/score.ts` | port of n8n `Score Findings` (place matching) |
| `src/format.ts` | build + validate the OnSinch `POST /orders` array body |
| `src/compose.ts` | facts + ids → `DesiredOrder` (business rules in code) |
| `src/onsinch.ts` | typed OnSinch client (injectable transport) |
| `src/reason.ts` | the 3-task LLM boundary + Anthropic adapter |
| `src/store.ts` | Save State Table interface (in-memory now, Postgres/KV later) |
| `src/metrics.ts` | append-only `metric_events` + dashboard aggregate (HoH pattern) |
| `src/compiler.ts` | **the foundational `compile()` function** |
| `src/pipeline.ts` | per-event handler: compile → execute → emit metrics |
| `test/run.ts` | offline end-to-end proof (17 assertions) |

## Run

```
npm install
npm test        # runs test/run.ts via tsx — no network needed
npx tsc --noEmit # typecheck
```

The test proves (20 assertions): draft-only new-job → reply drafted + order
*proposed* (not written); one-click `confirmOrder` → order created; re-handle →
no-op (idempotent); follow-up crew-count change → proposed PATCH → confirm;
bare "thanks" → confirmation-only; dashboard aggregate reflects the funnel; and
flipping `order_mode:"auto"` writes hands-free.

## Launch mode: draft-only (default)

`Settings.order_mode` defaults to `"draft-only"` — replies are drafted and the
OnSinch order is **staged** (`status:"proposed"`, `pending_order` set) for a
one-click approve in the dashboard, never auto-written. Flip to `"auto"` for
hands-free once the needs-human/error rate is proven low. `confirmOrder(thread_id)`
executes a staged order.

## Not built yet (next phases)

- Vercel app shell (dashboard + settings + helper chatbot) — client-facing only.
- Real Gmail hydrate/draft client + Gmail push (Pub/Sub) trigger.
- Postgres/KV-backed `StateStore`.
- The two data studies (2000+ sent emails → style guide; OnSinch edge-case map).
- Wire `createAnthropicReasoner` prompts to the full ported n8n prompts.
