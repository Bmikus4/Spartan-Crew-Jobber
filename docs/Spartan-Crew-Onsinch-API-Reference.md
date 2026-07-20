# Spartan Crew — OnSinch API Reference (v2, verified live 2026-07-20)

Every claim below was verified against the live tenant with the production API
key (key user: Ben Mikus, id 2257) on 2026-07-20, cross-checked against the
official OpenAPI spec (`https://spartancrew.onsinch.com/publicapi.json`, 29
paths). Probes used the validation oracle (invalid IDs so nothing persists)
plus two create→patch→delete cycles on the built-in TEST company (id 515),
fully cleaned up afterwards.

Base URL: `https://spartancrew.onsinch.com/api/v1`
Auth: `Authorization: apikey <KEY>` — literally `apikey`, **not** Bearer.

Tenant scale: 755 companies · 6,825 places · 6,629 orders · 43 professions ·
44k order items · 44k attendances.

---

## 1. The system, email → booked job (recap)

**Old (live) n8n system — 3 workflows, 155 nodes:**
1. **Bookings v3.4** (45) — orchestrator. Gmail poll → normalize thread → two
   branches: (a) *reply*: LLM reply draft + HIGH/MED/LOW label, Gmail draft
   with Message-ID threading; (b) *job*: classify "is this an order?", log to
   Airtable, hand to v1.2.
2. **Bookings v1.2 Job Automation** (70) — the order engine. Extract facts →
   resolve `company_id` / `place_id` / `user_id` → compose order →
   `POST/PATCH /orders` → log to Airtable + Sheets.
3. **Mini Operations** (40) — reply-only mirror for the ops inbox.

**New system (this repo)** — one idempotent compile loop over a Save State
Table (Neon). One Gmail thread = one state row. n8n only triggers
`/api/n8n-inbound`; compile → execute → store runs on Vercel
(spartan-crew-jobber.vercel.app). Launch mode is **draft-only**: order staged
as `pending_order`, one-click confirm in the dashboard writes it to OnSinch.

---

## 2. API conventions (all verified)

- **List-only reads.** `GET /orders/119` → 404. Everything is
  `GET /<collection>?filters`. Single lookup = `?id=119` or `?id[in]=1,2`.
- **Endpoint names are camelCase** (`/slotTeams`, `/orderItems`,
  `/calendarEvents`) — snake_case 404s. This hid several endpoints from
  earlier probing.
- **Every write body is a JSON array**, even for one item. DELETE takes an
  array of plain integer ids: `[13559,13560]`.
- **Filters:** `?field[op]=value` — ops: `eq/neq/gt/gte/lt/lte/in/like`
  (`%` wildcards). Nested filter requires the join:
  `?with=Job&Job__name[like]=%x%`. Filtering by a non-embedded model errors
  helpfully.
- **Embeds:** `?with=A,B`, whitelist per model (an invalid value returns the
  whitelist — useful trick):
  - Order → `Job, Attachment` · Company → `Client` · User → `Role` ·
    Invoice → `Attendance, Company, InvoiceItem, InvoicePdfRow, Order`
- **Pagination:** `limit` + `page`; response carries
  `pagination.{count,pageCount,nextPage}`. `sort=-id` = newest first (not
  honored on every endpoint, e.g. timelineAudits).
- **Status codes:** create `201 {"data":[{"id":N}]}` · patch/delete `204 no
  body` · validation `400 {"validationErrors":…}`.
- **Unknown-property oracle:** any unrecognized key in a write returns
  `"Unknown property \"x\""` — writes are strictly schema-checked, so probing
  with invalid IDs safely enumerates the accepted field set.

## 3. Endpoint matrix (from spec, methods verified where marked ✓)

| Endpoint | Methods | Notes |
|---|---|---|
| /orders | GET✓ POST✓ PATCH✓ DELETE✓ | the core resource; DELETE cascades Job+SlotTeams✓ |
| /jobs | POST, PATCH✓ | no GET — read via `/orders?with=Job`. PATCH: `name, admin_note, supervisor_id, pricelist_category_id`✓ |
| /slotTeams | POST✓ PATCH✓ | no GET. POST with `job_id` returns the new team id✓ |
| /orders/{id}/attachments, /jobs/{id}/attachments | POST, DELETE | file attach |
| /orderItems | GET✓ | priced line items + `RateBreakdown` — the rate audit hook (§11) |
| /companies | GET✓ POST✓ PATCH DELETE | `with=Client`✓ |
| /users | GET✓ | read-only✓ — cannot create client contacts |
| /workers | GET, POST, PATCH | crew-side people (separate from client users) |
| /places | GET✓ POST✓ PATCH DELETE | create requires `country` (ISO-2)✓ |
| /professions | GET✓ | read-only list |
| /attendance | GET✓ POST | worker↔slot records (hours, wage, presence) |
| /invoices | GET✓ | rich embeds, read-only |
| /payments (+ /groupByWorker) | GET✓ | worker payouts |
| /contracts, /contractTypes, /reimbursements(+Categories), /wallets(+extended/detail), /staffClockIns, /calendarEvents, /timelineAudits, /roles, /media/view/{id} | per spec | not needed for booking flow |
| /users/profile | GET✓ | token health check |

There is **no pricelist endpoint anywhere in the spec**. Rate-card names and
amounts are only visible in the admin UI. `pricelist_category_id` is the only
API-visible rate handle.

## 4. The write contract (verified against oracle + spec)

### POST /orders

Required: `name, company_id, user_id`, plus **`Job` with ≥1 `SlotTeam`**
(enforced with "Please fill the SlotTeam for this Order"✓).

```jsonc
[{
  "name": "Client @ Venue",             // required
  "company_id": 123,                    // required, must exist
  "user_id": 456,                       // required — a Client user of that company
  "specification": "free text",         // optional
  "intern_name": "PO123456",            // optional — used in practice as PO/customer ref
  "order_manager_id": 102,              // optional, Spartan-side manager (Jenny=102)
  "agency_invoice_address_id": 10,      // optional, defaults to 10
  "request_approval": true,             // business rule: always true
  "quote": true,                        // quote flag
  "provisional": true,                  // THE draft-booking flag (in live use today)
  "Job": {
    "name": "Client @ Venue",
    "pricelist_category_id": 197,       // THE RATE CARD — see §5. ALWAYS SET IT.
    "supervisor_id": 102                // optional
  },
  "SlotTeam": [{
    "name": "Crew",
    "profession_id": 1,                 // §7
    "beginning": "2026-09-01T08:00:00+01:00",
    "end":       "2026-09-01T17:00:00+01:00",
    "size": 4,
    "place_id": 1,                      // REQUIRED per slot team — top cause of 400s
    "description": "task detail",       // optional; also accepted:
    "client_note": "", "admin_note": "", "crewboss_description": "",
    "backup_size": 0, "applicant_size": 0, "applicant_requirements": false,
    "featured": false, "locked": false, "hidden": false, "tag_ids": []
  }]
}]
```

**Rejected on Order** (Unknown property): `number, status, happening,
reverse_charge, customer_reference, note, currency`. **Rejected on SlotTeam:**
`rate, price, wage, note, meeting_point, dress_code, crewboss_id, slot_id,
transport, break` — money fields don't exist on slot teams.

Server-derived on create: `number` (auto sequence), `happening` (earliest
SlotTeam beginning), `status: 0`, `creator/modifier` = key's user. Response:
`201 {"data":[{"id":N}]}` — **order id only; nested Job/SlotTeam ids are NOT
returned** (read the job id back via `?id=N&with=Job`; nested slot-team ids
are unrecoverable — see §9 id-custody note).

### PATCH /orders — top-level only
`[{"id":N, …}]` → 204✓. Accepted: `name, company_id, user_id, specification,
intern_name, order_manager_id, agency_invoice_address_id, request_approval,
quote, provisional`. Nested `Job`/`SlotTeam` rejected.

### PATCH /jobs
`[{"id":jobId, "pricelist_category_id":311}]` → 204✓ (verified switch
197→311 with readback). Also: `name, admin_note, supervisor_id`. **The rate
card can be corrected after creation.**

### POST /slotTeams and PATCH /slotTeams
`POST [{"job_id":J, name, profession_id, beginning, end, size, place_id, …}]`
→ `201 {"data":[{"id":T}]}`✓ — adds a team to an existing job AND returns its
id. `PATCH [{"id":T, "size":3}]` → 204✓. Editable: everything in the create
set plus `request_approval`.

### DELETE /orders
`[id,…]` → 204✓. **Cascades**: job + slot teams die with the order (verified —
patching the dead team then 400s "Records with specified IDs not found").

## 5. RATES — how the correct client rate is applied (Tracy's requirement)

**Mechanism:** money never appears on the order or slot team. The rate comes
entirely from **`Job.pricelist_category_id`** — a pointer to a rate card
(pricelist category) maintained in the OnSinch admin UI. Invoicing prices each
attendance from that card; the API can see the *result* later
(`orderItems.unit_price` + `RateBreakdown`) but never the card itself.

**Live experiment (TEST company 515; orders created then deleted):**
- Create **without** `pricelist_category_id` → server silently assigned
  category **245** (a default — NOT an error). This is exactly the failure
  mode Tracy is worried about: a naive create silently books a client on a
  default card.
- Create **with** `pricelist_category_id: 197` → readback shows 197. Explicit
  set works; PATCH /jobs can fix it later.

**Distribution (1,000 orders happening ≥ 2026-01-01):** ~20 categories in
active use. Most companies have one dominant card; big accounts legitimately
use several (e.g. company 137: 51× cat 197 + 26× cat 311 + 7 more). Cards are
shared across companies (197 looks like the standard 2026 card) and card ids
roll over time (2024/25 orders sit on 74/102; 2026 on 197/311/215/245…) —
new cards are minted per period and per tier/negotiation.

**Resolution strategy for the engine:**
1. **Always send `pricelist_category_id` explicitly. Never rely on the
   default.**
2. Resolve per client from history:
   `GET /orders?company_id=X&sort=-id&limit=20&with=Job` → majority category
   of the client's recent orders, most-recent period wins.
3. History empty or genuinely mixed → **needs-human gate**: stage as
   provisional draft and surface the category choice in the dashboard confirm
   step. Wrong-rate risk beats speed here.
4. Seed a lookup table from Tracy: admin-UI export of *client → default
   pricelist + category names* (API cannot read names or company defaults).
5. Post-hoc audit (§11): once orders are invoiced, compare
   `orderItems.unit_price` per company over time to catch mis-carded orders.

**Open question for Tracy/UI:** is the observed default (245) the company's
configured default or a global fallback? Irrelevant under rule 1, but worth
knowing. Also request the category-id → name map for 2026 cards
(197/311/215/245/305/268/282…).

## 6. Entity resolution (email → integer ids)

| id | source | method |
|---|---|---|
| `company_id` | sender domain / company name | `GET /companies?name[like]=%X%` + local scoring; 755 rows — pulling all and matching locally is fine. New client → `POST /companies` (required: `name, address, city, zip, country, email_invoice, status`) |
| `user_id` | sender email | `GET /companies?id=N&with=Client` → match Client email. **/users is read-only (POST/PATCH 405✓)** — unknown sender = needs-human (create the contact in the UI first) |
| `place_id` | venue/address text | `GET /places?…` + local scoring (no fuzzy search server-side); miss → `POST /places` (only `country` required; send name/address/city/zip too) |
| `pricelist_category_id` | company history | §5 |
| `profession_id` | task wording | static map §7 |
| `order_manager_id` | fixed config | Jenny = 102 |

## 7. Professions (live list, non-deleted highlights)

`1` Crew · `3` Carpenter · `9` Driver · `16` Crew AV tech · `32` CSCS
Labourer · `36` Crew Chief · `52` Steward · `55` Crew Boss · `56` Freelancer ·
`62` Event Staff · `63/64` MCR Crew/Chief · machine tickets: `4/7/23/24`
Telehandler · `5` IPAF 3a/3b · `53` IPAF 1b · `6` PASMA · `11/22`
Counterbalance · `17/25` Rough Terrain. Full list: `GET /professions?limit=100`
(43 rows incl. deleted).

## 8. Fields to extract from an enquiry email (the complete checklist)

Order-critical (block create if unresolved):
- **client company** (sender domain/signature) → `company_id`
- **contact person** (sender) → `user_id` (must already exist as a Client)
- **venue / address** → `place_id` (required per slot team)
- **date(s) + call time + end time** → ISO-8601 with offset
- **headcount** per block → `size`
- **skill/task** → `profession_id` (default 1 Crew; CSCS/driver/AV/chief cues)
- **rate card** → `pricelist_category_id` (company history, §5)

Order-enriching (optional):
- PO / customer reference → `intern_name`
- job notes → order `specification`; per-team task detail → SlotTeam
  `description` / `client_note`
- multi-day / multi-block → one SlotTeam per distinct
  date × time × size × profession
- standby/backup ask → `backup_size`
- order display name convention: `"<Client> @ <Venue>"`

Reply-side (not sent to OnSinch): urgency (HIGH/MED/LOW), missing-info list
(what to ask the client), thread ids for the Save State row.

## 9. Email → booked draft, end to end (recommended translation)

```
Gmail thread (n8n trigger, full hydrate)
  → normalize (clean bodies, dedupe)                     [deterministic]
  → classify: new-job | update | confirmation-only | not-a-job   [LLM]
  → extract ConversationFacts (§8)                       [LLM, typed]
  → resolve ids (§6) + rate card (§5)                    [deterministic]
  → compose DesiredOrder + validate (§4 invariants)      [deterministic]
  → POST /orders  {quote:true, provisional:true, request_approval:true,
                   Job.pricelist_category_id: <resolved>}
      = a "booked draft" visible in OnSinch, on the right rate,
        flagged provisional/quote until confirmed
  → read back ?id=N&with=Job → store order_id + job_id in the state row
  → reply draft to client (Gmail draft, threaded)        [LLM]
Confirm (dashboard one-click, or a confirmation email classified)
  → PATCH /orders [{id, provisional:false, quote:false}]         (204)
Updates
  → order-level (name/PO/spec/flags)      → PATCH /orders
  → wrong rate card                        → PATCH /jobs [{id, pricelist_category_id}]
  → ADD a crew block                       → POST /slotTeams {job_id,…} (id returned — keep it)
  → CHANGE a block we added via /slotTeams → PATCH /slotTeams [{id,…}]
  → CHANGE a block created nested in POST /orders (id unknown — API never
    returns nested team ids and there is no GET /slotTeams):
      while provisional & unstaffed → DELETE /orders + re-POST (cascade verified, cheap)
      once staffed                  → needs-human (UI edit; crew signups must survive)
```

**Id custody rule:** the engine must persist every id it learns at write time
(order_id, job_id via readback, slot-team ids from POST /slotTeams responses)
in the Save State row — several of them can never be read back later.

Two viable draft postures — Settings toggle:
- **Stage locally** (current engine default): nothing written to OnSinch until
  confirm. Zero risk; ops can't see it in OnSinch.
- **Write provisional+quote immediately** (verified): the draft lives in
  OnSinch where ops already look; confirm is a 1-field PATCH; deletable
  cleanly while unstaffed. Matches how ops already use `provisional` today
  (newest live orders carry it).

## 10. Gaps this analysis found in the current engine code

- `format.ts`/`types.ts` don't carry `Job.pricelist_category_id`, `quote`,
  `provisional`, `intern_name`, `specification`, `order_manager_id`, or the
  extra SlotTeam fields — add.
- No rate-resolution module — new `rates.ts`: company_id →
  pricelist_category_id (history majority + seeded lookup + needs-human gate).
- `onsinch.ts` lacks `/slotTeams` + `/jobs` clients and DELETE /orders; its
  `patchOrder` alone cannot express slot changes.
- `user_id` resolution should use `companies?with=Client`, not a global
  `/users` search.
- State row should store `job_id` and owned slot-team ids (id custody, §9).

## 11. Rate audit hook (read-only, post-hoc)

- **`GET /orderItems?order_id=N`** — priced lines: `model/foreign_id` (source
  row), `amount, unit_price, unit_cost, price, price_tax, tax`, plus
  **`RateBreakdown[]`** (`component_code/name, rate, multiplier, units,
  subtotal`) — the exact applied rate components. Empty until the order
  accrues attendances/invoicing.
- **`GET /invoices?with=InvoiceItem,InvoicePdfRow,Company,Order`** — per-staff
  lines carry `price` (client rate) vs `cost` (worker pay).
- Nightly "rate sanity" job: for invoiced orders, compare unit prices per
  company against their historical norm → flag mis-carded orders.
- Order `status` observed: `0` active/open, `-2` cancelled (not writable).
