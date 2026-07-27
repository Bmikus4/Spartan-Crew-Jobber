# Tickets + Draft-Order Automation — Production Build Plan (v2, panel-hardened)

*v2 folds in the expert panel: HoH-tickets recon, senior-dev reliability review
(5 blockers), OnSinch-platform review (crew-chief + dedup), and product-owner
(the human surface + recall proof). Awaiting Ben sign-off + the decisions in §12.
Nothing is built until sign-off. Zero corners cut.*

## System architecture — this is TWO systems + one visual surface (corrected per Ben)

This is NOT "a webhook that feels like HoH." It is a **tickets menu structurally
and visually** — a linked Postgres table surfaced as visual ticket/order cards seen
IN the tool — standing on **two distinct systems, each designed and tested in its
own right**:

- **SYSTEM A — Inbox Ingestion & Sorting.** Works **directly against the Spartan
  Crew inbox to pull and sort EVERY single email** — a full historical **backfill**
  of the entire inbox PLUS **continuous** ingestion of every new message —
  classifying/sorting each into the tickets table. This is a whole system with its
  own design + test plan; recall is 100% (no email unaccounted for). Transport
  decision (n8n full-sweep bridge vs the tool holding Gmail OAuth and reading the
  inbox directly) is settled in §12; the acceptance criterion is the same either
  way: **every message in the inbox is pulled, sorted, and visible as a ticket.**
- **SYSTEM B — Request → Order Translation.** Grounded in **complete, rigorous
  OnSinch API documentation** (docs/Spartan-Crew-Onsinch-API-Reference.md, kept
  authoritative), it translates a client crew-request into an OnSinch **draft
  order** — slot teams, crew types, sizes, times, place, rate card,
  provisional/quote. Its own designed + tested system with field-by-field
  validation vs real orders.

The **tickets menu** (Postgres-backed, visible in the tool) is the shared surface
where both systems' output is displayed, reviewed, and corrected. Sections below
detail each system; §13 phases build A and B as separable, independently-tested units.

## 0. Non-negotiables (unchanged, now actually enforced in the design)
- **Recall is sacred** — every genuine client crew-request gets through; **no
  unaudited drop path** (layer-1 pre-filter drops are also written as `filtered`
  with a reason). Recall is proven on a corpus, not asserted.
- **No data loss** — raw inbound persisted BEFORE anything else; append-only events.
- **Exactly-once external effects** — write-intent + idempotency key + reconcile-
  by-readback; cross-instance lock; DB unique constraints as the last line.
- **Draft-first, and observe-only-first** — new whole-automation observe mode is
  the launch posture (persist + classify, zero external writes).
- **Spartan-native tickets menu that FEELS like HoH but is BETTER on the two
  things HoH is weak at: reviewing and correcting.** (This replaces "mirror HoH
  exactly" — see §11.)

## 1. SYSTEM A — Inbox Ingestion & Sorting (Phase 0 + continuous)
The heart of System A: **pull and sort EVERY email in the Spartan Crew inbox.**
- **Full backfill:** page the ENTIRE bookings inbox (all history), normalise each
  message → thread, run the gate, write a ticket for every one (client inquiry or
  `filtered` with reason). This backfill IS both the live ticket population AND the
  recall corpus — no separate "get a corpus" step.
- **Continuous:** every new message ingested the same way (the 1-min poll + 30-min
  sweep, now full-inbox aware, idempotent).
- **Transport [§12]:** either n8n does the full sweep + push (standing "n8n = Gmail
  bridge" decision) or the tool holds Gmail OAuth and reads the inbox directly.
  Acceptance is identical: every message pulled, sorted, ticketed, none missed.
- **Replay harness** `scripts/replay.mjs`: replays the backfilled threads through
  gate + composer with a RECORDING transport (no writes); scores classification
  recall, dedup, and order fields vs the real OnSinch order.
- **Gate A0:** the full inbox is ingested and every message is visible as a ticket;
  ≥100 labelled threads; harness runs offline; measured gate recall on the labelled set.

## 2. Concurrency, idempotency & durability (senior-dev blockers B1–B5, M1/M5/M7)
- **B1 — cross-instance lock:** first action in `handleThread`, take a Postgres
  advisory lock / atomic `locked_until` lease keyed on `thread_id`, held across the
  whole pipeline; if not acquired, return (another instance owns it). Final state
  write is **optimistic** (`WHERE updated_at = $expected`, re-read on 0 rows).
- **B2 — exactly-once:** persist a **write-intent** row (`status=writing`,
  client-generated `idempotency_key`) BEFORE any OnSinch create. On retry, detect
  the in-flight intent and **reconcile by readback** (`companyOrdersWithJob`
  filtered by our `intern_name`/PO marker) instead of blind-creating. Flip to
  `ordered` only after the readback confirms. Same for `createPlace`+order.
- **B3 — cache is not a dedup source:** `listAllCached` may back *display*, never a
  create-decision. Before a create, do a **targeted server-side re-check under the
  lock** and **invalidate the cache key on every create**. (Probe: confirm OnSinch
  exact-match filters exist for this; else full re-pull under lock.)
- **B4 — persist raw before gate:** FIRST statement of `/api/n8n-inbound` appends
  the raw payload to append-only `inbound_raw` (idempotent on `message_id`). Any
  pipeline throw writes a **dead-letter** row (never a bare 500). Replay reads
  `inbound_raw`. The idempotency fast-path must still capture the raw on re-POST.
- **B5 — update path:** `patchOrder` currently sends only the id (silent no-op).
  Until the real patch (with slot-team id custody, §6) is built + tested, **route
  every `update` to `needs_human`** — never fake success by advancing the hash.
- **M1 — fast-path:** the "unchanged latest message → skip" fast-path must EXCLUDE
  `status in (error, needs_human)` so the sweep actually heals them.
- **M5 — durability ordering:** state `put` before best-effort metric emits;
  emits `.catch(()=>{})` and can never abort the state write.
- **M7 — DB invariants:** unique constraint on `onsinch_order_id`; `idempotency_key`,
  `locked_until`, `status` columns. The DB is the last line when app logic races.
- **Auth:** fail-closed — require `N8N_WEBHOOK_SECRET` in production (today it's
  optional → the order-creating endpoint is open if unset). Add tickets-UI access
  control (who can open client PII).

## 3. The inquiry gate (recall-first, fully audited)
1. **Layer-1 deterministic pre-filter:** drop only provably-non-client (internal
   senders, no-reply/bounce, our own outbound). **Every layer-1 drop is written to
   `tickets` as `status='filtered'` + `gate_reason`** — no unaudited path.
2. **Layer-2 AI appraisal** (temp 0): `new-job | update | confirmation-only |
   not-a-job` + `is_client_inquiry` + `confidence`; bias to "job" on ambiguity.
   Low-confidence not-a-job → surfaced for review, never dropped.
- **Launch recall discipline:** review **100% of not-a-job / filtered** for the
  first weeks (sampling is a steady-state luxury, not a launch guard). `gate_reason`
  + `confidence` + match candidates shown in the ticket detail (trust surface).

## 4. Flow (each stage idempotent, event-logged)
```
n8n → /api/n8n-inbound
  → append inbound_raw (durable, first)            [B4]
  → acquire thread lease                            [B1]
  → GATE (layer-1 audited drop → filtered; layer-2 classify)   [§3]
  → DEDUP: thread_id → order_id ONLY for auto-update; company+date+venue = WARN→needs_human   [S2]
  → NEW or UPDATE?  (update → needs_human until §6 patch built) [B5]
  → EXTRACT + PARSE + FORMAT → DesiredOrder
  → DRAFT REPLY (if replies_enabled; draft vs send)  [§7]
  → OnSinch DRAFT ORDER via write-intent+key, draft-only staged / auto  [B2]
  → UPSERT TICKET (COALESCE-merge; link thread↔order) + events + revalidateTag
```

## 5. Tickets table (Spartan-native, HoH patterns) — mirrors HoH mechanics
Adopt HoH's proven mechanics **verbatim**, Spartan-native columns:
- **PK = `thread_id`** (stable Gmail thread id; `last_message_id` is the change
  cursor — this is what makes "update vs new" work). One thread = one ticket = one order.
- **COALESCE-merge upsert** (HoH pattern): a sparse follow-up never blanks stored
  facts; `updated_at=now()`; stage never regresses on upsert.
- **`raw_payload jsonb`** per row (HoH's audit/recovery store) PLUS a **separate
  append-only `ticket_events` table** (HoH keeps the log in a clobbered JSONB array
  — we improve: real inserts, no lost entries under concurrency).
- `unstable_cache(revalidate:30, tags:['tickets'])` + `revalidateTag` on write;
  `iso()` for timestamptz (never `String(Date)`); **additive-only migrations**
  (`add column if not exists`), applied by `scripts/migrate.mjs` from `db/schema.sql`.
- Columns: thread_id PK, subject, participants jsonb, classification, status
  (`open|filtered|needs_human|drafted|proposed|ordered|error`), is_client_inquiry,
  gate_reason, confidence, company_id, user_id, place_id, onsinch_order_id (UNIQUE),
  onsinch_order_number, onsinch_job_id, owned_slot_team_ids jsonb, reply_state
  (`none|drafted|sent`), reply_draft_id, extracted jsonb, needs_human, notes jsonb,
  idempotency_key, locked_until, created_at, updated_at.
- **Backup/prune** (HoH cron): 6-monthly CSV committed to repo; prune spares
  `confirmed`/active (pick ONE policy — HoH's `cleanupTickets` 365d-hard/90d-stale-
  spares-confirmed, not the blunt cron). Self-heals: OnSinch is source of truth.
- Single clean stage vocabulary (HoH has three conflicting ones — we don't copy that).

## 6. Draft-order composition (the calculation, panel-corrected)
- **Slot teams:** one per distinct (date × role × call-time × size); each carries
  `profession_id, beginning, end, size, place_id`. One profession per team (scalar).
- **Crew type map** (concrete ids, no "J-class"): labour→1; CSCS *required*→32
  (preferred→1); driver→9; AV→16; carpenter→3; telehandler→4/7/23/24;
  counterbalance→11/22; rough-terrain→17/25; else→1.
- **Crew-chief rule — [TRACY DECISION, §12]:** default lean **add-on, `ceil(n/4)`**
  (4→4+1chief; 7→7+2; 8→8+2), never under-staffs a live site. Modelled as a
  separate `profession 36` slot team. **Surfaced in the confirm step + flagged**
  until Tracy signs off; NOT hardcoded silently.
- **Times:** default **[DECISION §12]** 08:00–18:00 vs 08:00–17:00; TBC flagged.
- **place_id** mandatory per team (exact-match, else provisioned on write).
- **Job:** `name`, `pricelist_category_id` (Phase B seed; never the silent 245),
  `provisional:true, quote:true, request_approval:true`. **Job summary →
  `specification` ONLY**; `intern_name` = PO/customer-ref ONLY (not free text).
- **Rate integrity (S4):** the chosen card MUST contain a row for every profession
  on the order (chief/driver/AV) or that line prices at 0 — assert at compose/audit.

## 6b. Reply drafting — canonical live subflow (reference)
The original live n8n draft-creation subflow is saved verbatim at
`docs/reference/n8n-reply-draft-subflow.json` (Ben, 2026-07-27). It is the source
of truth for the reply build: fetch the real `Message-ID` header → build raw
RFC-2822 (branded signature, CC-cleaned of self+recipient, `In-Reply-To`/
`References` threading) → base64url → `POST /users/me/drafts`. The
`reply_delivery='send'` path reuses the same raw MIME but `POST /messages/send`.
(We already mirror this in `scripts/build-n8n-workflow.mjs`; the reference locks
the exact node shapes + the Message-ID-first threading order.)

## 7. Settings (three, clearly labelled to kill "draft" ambiguity)
- `replies_enabled` — master reply on/off. **Default OFF.** (When OFF, `reply_delivery` is n/a.)
- `reply_delivery: "draft" | "send"` — Gmail draft vs actually send. **Default DRAFT.**
- `automation_mode: "observe" | "draft-only" | "auto"` — **NEW. Default `observe`**:
  persist + classify + populate tickets, **zero external writes** (no Gmail draft,
  no OnSinch order). `draft-only` = stage the OnSinch draft order for one-click
  confirm. `auto` = write hands-free. (Supersedes the old `order_mode`; the UI
  labels these unmistakably vs the OnSinch "draft order" and the "draft reply".)

## 8. Tickets UI (Spartan-native; its OWN acceptance gate — was hand-waved)
Feels like HoH's menu; **better on review/correct**. Must ship with:
- **List:** client, venue/date, crew summary, status pill, order # (or staged/—),
  green "linked to thread" + "linked to order" indicators, AI-reply green check,
  updated-at; filter tabs (All / Needs human / Awaiting confirm / Booked / Filtered).
- **Detail panel:** pipeline stepper; client block; **the draft order — slot teams,
  crew types, sizes, times, rate card**; the **drafted reply text with Review →
  Edit → Send** (respecting settings); the live email thread; and the **AI decision
  + reason + confidence + match candidates** (trust surface).
- **Correction queue (THE #1 missing thing):** edit mis-parsed size/date/time/
  profession; reclassify a filtered item as a real job; manually link/unlink a
  ticket ↔ OnSinch order; clear a needs-human flag; re-run. Humans fix *before* it
  becomes a real order.
- **Gmail linkage:** apply a Gmail label so humans see the link in Gmail too (HoH's
  Outlook-category equivalent).
- **Notifications:** alert on `needs_human`/`error`; daily digest. A silent table = the missed-lead failure the mandate forbids.
- **Gate:** a human can see a ticket, read decision+reason, edit fields, link/unlink an order, clear a flag, and review/send a draft.

## 9. OnSinch specifics (panel-confirmed)
- Draft posture `provisional+quote+request_approval` correct; `status` is server-set.
  **[VERIFY §12]** their board keys on `provisional` (not filtered out by `quote`),
  and provisional does NOT notify crew before confirm.
- **user_id:** company's **primary Client contact** (most-recent order's user_id or
  first `?with=Client`), NEVER `company_id`. **[PROBE §12]** does `POST /companies`
  auto-provision a Client (readable via `?with=Client`)? — collapses the new-contact
  problem. `user_id` is PATCH-able → create against primary contact now, re-point later.
- **Update while provisional:** order-level→PATCH /orders; rate→PATCH /jobs; add
  block→POST /slotTeams (own the id); owned block→PATCH/DELETE; the one nested
  (unrecoverable-id) block→DELETE+re-POST **only when attendance count = 0**
  (check `/attendance` first) AND the order number hasn't been sent to the client;
  else needs-human. Nest exactly ONE slot team on create; add the rest via /slotTeams.

## 10. Reliability ops
Retries w/ backoff on external writes (bounded, idempotent); dead-letter table +
replay; correlation id threaded n8n→pipeline→logs (structured); the 30-min sweep
re-POSTs 48h (idempotent) but no longer skips error/needs-human (M1).

## 11. Structure (corrected — supersedes any "mirror HoH" wording)
The visible surface is the **existing Jobs Board** (`JobsScreen`), kept by that
name (Ben, 2026-07-27) — there is NO separate "Tickets" menu. The production
tickets Postgres table simply becomes what **backs the Jobs Board** (replacing the
current `conversation_state`→`jobsDb` projection), and the board gains the
review/correction surfaces (§8). It **is a tickets board**, structurally and
visually: a linked Postgres table shown as visual ticket/order cards in the tool. We reuse HoH's proven *mechanics* only
because they're sound (thread-id PK, COALESCE upsert, cache+revalidate, additive
migrations, backup/prune, self-heal) — not to "copy HoH." The point is the two
systems above (A: pull+sort the whole inbox; B: translate requests→orders) feeding
one visible tickets surface. Spartan does crew **orders**, so the ticket/order
cards show slot-teams/crew/rate, not quotes/guest-counts.

## 12. DECISIONS NEEDED FROM BEN / TRACY (blocking, before build)
1. **Crew-chief rule** (Tracy): add-on (4→4+1) vs split (4→3+1), and ceil vs floor.
   Default lean = **add-on + ceil**. This is on every multi-crew order.
2. **Contact fallback** for a new/unknown sender at an existing company: use the
   company's primary contact (order proceeds) vs strict needs-human. Lean = primary contact.
3. **Observe-only-first launch** (1–2 weeks observe → draft-only → maybe auto): OK?
4. **Corpus source** (Phase 0 hard dep): Gmail export of bookings inbox, or the
   **n8n API key** (unlocks execution logs), or a Tracy-labelled sample?
5. **Live OnSinch write-probes** allowed? (create+immediately-delete a TEST company
   to answer the auto-provision question; done on TEST company 515 with cleanup.)
6. **Default shift hours** when unstated: 08:00–18:00 or 08:00–17:00.
7. Confirm **"Spartan-native, better-than-HoH-on-review"** interpretation (§11).

## 13. Phases + gates (re-sequenced per stakeholder)
- **0. Corpus + replay** — Gate: ≥100 labelled threads, harness runs.
- **A. Tickets table + REAL UI (correction/review/draft-reply surfaces) + lock/
  idempotency/inbound_raw substrate.** Gate: schema+restore test AND the UI gate (§8).
- **B. Inquiry gate, proven on the corpus.** Gate: target recall on the labelled set, 0 silent drops (incl. layer-1).
- **C. Order composition, validated field-by-field vs real OnSinch orders; chief
  rule + profession map signed off.** Gate: ≥100 threads, 0 wrong-rate/wrong-client.
- **D. Reply settings + observe/draft/send modes.** Gate: draft verified in Gmail; send only when explicitly set.
- **E. Launch observe-only → draft-only → (maybe) auto**, with notifications + audit.

## 14. Post-A backfill — 30 most-recent jobs, cross-referenced OnSinch↔inbox
*(Scheduled AFTER the tickets menu is built — Ben, 2026-07-27.)* Seed the tickets
table with the **30 most-recent OnSinch orders**, each **linked back to its
originating Gmail inbox thread**. Hard problem: OnSinch orders and inbox emails
share **no join key**, so it's heuristic record-linkage — match on company/client
name + happening-date + venue/place_id + contact email (Fellegi–Sunter scorer,
like HoH `ticketMatch` but in the order→thread direction). Ambiguous matches
**escalate to needs-human**, never auto-mislink. Output: 30 linked ticket/order
cards visible in the tool. Depends on System A (inbox ingestion) + System B
(OnSinch reads) being in place.
