# Spartan Console + OnSinch CRM Chatbot — Build Plan

*Authored 2026-07-20 for an end-to-end build tomorrow. Companion docs in this
folder: `BUILD-OVERVIEW.md`, `CLAUDE-BUILD-MANUAL.md` (the email→order engine),
`Spartan-Crew-Onsinch-API-Reference.md` (verified live contract). This plan adds
the human-facing FRONT END + a natural-language CRM chatbot on top of that engine.*

## Decisions (locked with Ben, 2026-07-20)

1. **Verbatim branded copy of the HoH Quote Tool**, stripped to **Dashboard +
   CRM chatbot ("Smart CRM")** only. Quote Tool, Tickets, Settings removed *for
   now*.
2. **Folded into the existing `SpartanCrew-Enquiry-Engine` repo** — one repo,
   one Vercel deploy (`spartan-crew-jobber`). Not a separate project.
3. **CRM chatbot targets OnSinch** (not Current RMS). Reuse the API we mapped +
   the engine's rate logic.
4. **Reuse the HoH CRM architecture verbatim; swap only the backend adapter.**
   The agentic plan→execute loop, table-index protocol, and two-step write
   confirm are proven (5/5 golden evals) — we keep all of it.

**Source of truth for the copy:** `D:\code\HoH-Quote-Tool-GH` (the live tool).
**Target:** `D:\code\SpartanCrew-Enquiry-Engine`.

---

## The synergy that makes this cheap

The email engine (`CLAUDE-BUILD-MANUAL.md`) already needs a hardened OnSinch
client, a rate resolver, and an order-body builder. The CRM chatbot needs the
*same three things*. So the chatbot is not a parallel stack — it is a **second
front door into one shared OnSinch substrate**:

```
                 ┌────────────────────────────────────────┐
  email thread → │  compile() ─┐                           │
  (n8n trigger)  │             ├─→ compose → DesiredOrder ──┼─→ validate ─→ onsinch.ts ─→ OnSinch
  NL command   → │  crm-agent ─┘        (rates.ts,          │      (I1..I3)   (shared client)
  (chatbot)      │                       id custody)        │
                 └────────────────────────────────────────┘
```

Both writers honor the same invariants (I1 explicit rate card, I2 id custody,
I4 LLM never builds ids/rates/bodies, draft-only staging). Both emit
`metric_events`, so the dashboard funnel counts chatbot-created orders too.

**Dependency:** the chatbot depends on engine Phase A (`onsinch.ts` hardened,
`rates.ts`, `format.ts`, `validate`). Build order tomorrow: **engine Phase A
first, then the console + chatbot on top.**

---

## PART 1 — The branded console (strip HoH → Dashboard + Smart CRM)

### 1.1 What we IMPORT from HoH into the engine repo
- `app/components/`: `DashboardScreen.tsx`, `CrmChatScreen.tsx`, `Sidebar.tsx`,
  `QuoteToolShell.tsx` (the screen switcher), `HelpWidget.tsx` (optional).
- `app/lib/crm/**` (whole tree) + `app/api/crm-agent`, `crm-chat`, `crm-intent`,
  `crm-execute`, `crm-format`.
- `app/globals.css` (the "Samurai" dark editorial design system) + `layout.tsx`,
  `manifest.ts`, favicon.

### 1.2 What we STRIP (delete, don't carry)
- Components: `ChatScreen`, `PlanChatScreen`, `LiveQuoteScreen`,
  `QuotePreviewLive`, `QuoteTableLive`, `QuoteHeaderBar`, `TicketsScreen`,
  all pickers (`AlternativePicker`, `ClientNamePicker`, `DeliveryPicker`,
  `VenueAddressPicker`, `ImageCatalogModal`), `IntroScreen`, `LoginScreen`
  (auth handled separately — see 1.5).
- API routes: `generate-quote`, `initial-quote`, `match-items`, `match-test`,
  `plan-chat`, `chat`, `logistics`, `quote-to-order`, `tickets*`, `ticket-venue`,
  `threads`, `send-to-thread`, `catalog*`, `intro-classify`, `transcribe`
  (unless the chatbot keeps voice), `weekly-digest`, `marketing-agent`.
- Nav: keep only `dashboard` + `current-rms` (relabel "Smart CRM"). Drop
  `quote-tool`, `tickets`, `settings`.

### 1.3 Reconcile the two dashboards (important)
The engine repo ALREADY has a minimal `DashboardScreen` + `Sidebar` + `AppShell`
wired to `metricsDb` (the email→order funnel). HoH's `DashboardScreen` is the
visually richer one. **Resolution:** adopt HoH's dashboard *component + design*,
but wire it to the engine's existing `/api/metrics` read-model (the Spartan
enquiry→booking funnel + tiles). Do not carry HoH's quote-tool metrics. Net: one
branded dashboard showing Spartan's funnel, plus the confirm-queue list (which
`CLAUDE-BUILD-MANUAL.md` Phase E1 wants anyway — build it here).

### 1.4 Branding (the "verbatim BRANDED copy" part)
Swap, in `globals.css` + assets only (structure untouched = "verbatim"):
- accent token set (`--accent`, hover/press/subtle/border) → Spartan Crew brand
  color. **INPUT NEEDED from Ben:** Spartan's brand hex + logo asset (check
  `D:\business\samurai` / spartancrew.co.uk). **Default if not supplied:** keep
  the SamurAI dark editorial theme, drop in the Spartan wordmark/logo, retitle
  app + manifest + favicon to "Spartan Crew". (The whole thing is theme-token
  driven, so re-skinning later is a one-file change.)

### 1.5 Auth + settings
- Auth: reuse the engine/HoH Google-only gate (memory `project_hoh_google_auth`).
  Keep the `AUTH_REQUIRED` middleware; allowlist Spartan ops emails.
- Settings: **removed for now.** `order_mode` stays `"draft-only"` (hardcoded /
  env default). Settings returns later with the order_mode toggle + confirm
  threshold when Phase E lands.

### 1.6 Verify Part 1
`tsc --noEmit` clean, `next dev` serves a two-item nav (Dashboard + Smart CRM),
dashboard renders the Spartan funnel from `/api/metrics`, nothing references a
stripped route. Deploy preview loads.

---

## PART 2 — The OnSinch CRM chatbot (retarget the proven pattern)

*Reminder of how we built it last time (Current RMS), from `project_crm_pipeline`:
`CrmChatScreen` → agentic `/api/crm-agent` (SSE plan→execute loop) → table-index
protocol (every read = addressable table T1,T2…; model runs DETERMINISTIC ops:
count/filter/sort/dedupe/…) → `compile`/`validate` → executor. Two-step writes
(reads auto-run; writes need explicit CONFIRM). Model is a cost dial, not a
correctness gate — the whitelist + deterministic ops carry it. Eval harness
`scripts/agent-eval.ts`, golden 5/5.*

### 2.1 KEEP verbatim (zero logic change)
- `CrmChatScreen.tsx` (UI: connected banner, tables, pagination, CSV, voice,
  draft-resume, two-step confirm, the live plan/step trace `RunView`, the single
  working-indicator row).
- `/api/crm-agent` SSE loop; `app/lib/crm/agent/{loop,tables,tools,executor,
  openrouter}.ts`; the table-index protocol + deterministic table ops
  (count/extract_columns/filter/dedupe/sum/sort/head/unique_values).
- Conversation-context protocol (continuation, "the second one" → record id,
  slot-filling, one-clarification discipline). Two-step write gate.

### 2.2 SWAP — the backend adapter (RMS → OnSinch)
Where HoH's executor compiled a Ransack query and POSTed a **signed n8n webhook**
(n8n held RMS creds), Spartan's executor calls the engine's **shared
`onsinch.ts`** client directly (server-side, `ONSINCH_API_KEY` in env — the app
is authed, key never reaches the client). This matches how the engine already
talks to OnSinch. *(Optional later: route through a signed n8n webhook if
Spartan wants cred isolation like RMS — but default is direct, consistent with
the engine.)*

Files to replace/add under `app/lib/crm/`:
- `capabilities.json` → regenerate for OnSinch. New script
  `scripts/build-onsinch-capabilities.mjs` reads
  `Spartan-Crew-Onsinch-API-Reference.md` (or `publicapi.json`) → resources:
  companies (R/W), places (R/W), users (**read-only**), orders (R/W/D),
  slotTeams (create/patch), jobs (patch), orderItems (R), invoices (R),
  professions (R), payments (R) — with the verified field sets + filters.
- `compile.ts` → emit OnSinch reads (`?field[op]=`, `?with=`, `?id[in]=`,
  pagination) and, for writes, a **`DesiredOrder`** (the engine's own type) so
  writes flow through the engine's `validate` + `format` + `rates`.
- `executor.ts` (agent) → dispatch to `onsinch.ts` methods.
- `n8nClient.ts` → drop (or keep dormant behind a flag for the optional route).

### 2.3 Agent tool set (OnSinch)
Reads (auto-execute): `search_companies`, `get_company_clients`
(`?with=Client`), `search_places`, `list_orders` (`?company_id=&with=Job`),
`get_order`, `list_professions`, `resolve_rate_card` (calls `rates.ts`),
`get_order_items`. Writes (CONFIRM-gated): `create_order`, `patch_order`,
`add_slot_team`, `patch_slot_team`, `delete_order`. Plus all the deterministic
table ops reused unchanged.

### 2.4 Invariants the chatbot inherits (non-negotiable)
- **I1 rate:** `create_order` refuses to run without a resolved
  `pricelist_category_id`; ambiguous → the agent asks the human to pick, or
  stages needs-human. The model never picks a rate — `resolve_rate_card` (code)
  does.
- **I2 id custody:** after any create/add, read back + persist order_id/job_id/
  slot-team ids into the run/state so follow-up edits in the same conversation
  can target them.
- **I4 LLM boundary:** the model plans in language and calls tools; it never
  builds an order body or resolves an integer id/rate. `compile`/`format` do.
- **Draft-only staging:** a chatbot-created order is `provisional:true,
  quote:true, request_approval:true` (a booked draft), same as the engine.
- **Two-step confirm:** every write shows a preview (client, place, dates, crew,
  **rate-card name**, validation state) and requires an explicit CONFIRM click;
  `/api/crm-execute` enforces `confirmed:true`.
- **Metrics:** chatbot writes emit `metric_events` (order_proposed /
  order_created) so the dashboard funnel includes them.

### 2.5 Model
Reuse `CRM_AGENT_MODEL` env via OpenRouter. Default to the cheap dial
(`anthropic/claude-sonnet-5` or haiku) — the whitelist + deterministic ops carry
correctness. Align to the engine's `anthropic/claude-opus-4.8` only if evals
show a gap.

### 2.6 Eval + verify
- Mock OnSinch transport (mirror HoH's `tests/support/mockRms.ts`) + retargeted
  `scripts/agent-eval.ts` — golden set: "list this month's orders for X",
  "who's the contact at Y", "book 4 crew for Z at <venue> next Friday 8-5"
  (→ correct company/place/user/rate/slot, CONFIRM-gated), "the second one →
  its id", "change that booking to 6 crew".
- Live smoke on **TEST company 515 / user 1591**: a full NL create → CONFIRM →
  readback → NL edit → delete, all cleaned up. Gate: no wrong-rate, no orphan
  ids, idempotent tool calls.

---

## Tomorrow's build order (end to end)

```
0. brand inputs (Spartan hex + logo) — else default SamurAI theme + Spartan wordmark
1. engine Phase A  (onsinch.ts hardened, rates.ts, format/validate) ← shared substrate
2. Part 1: fold HoH shell in, strip to Dashboard + Smart CRM, rebrand, build green
3. Part 2.2–2.3: OnSinch capability table + adapter + agent tools
4. Part 2.4: invariants + two-step confirm + draft-only staging + metrics
5. Part 2.6: mock + evals + live TEST-company smoke
6. deploy preview; verify dashboard funnel + a real NL booking on TEST company
```

## Open inputs / flags
- **Spartan brand hex + logo** (Ben) — blocks final skin, not the build.
- Voice in the chatbot: keep HoH's `transcribe` route or drop for v1? (default: keep.)
- Optional n8n cred-isolation route for OnSinch (default: direct, like the engine).
- `order_mode` toggle + full Settings return with Phase E (not this pass).
