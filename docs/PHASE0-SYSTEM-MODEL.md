# Phase 0 — verified system model and dependency map

**2026-09-02.** Read-only. No code changed, no database written, no OnSinch call made.
Every figure below is marked **measured** (a direct read of the authoritative field),
**counted** (a query over the records that are the authority), or **read** (established
from the source, not from a claim about it).

The findings document (`Spartan-Jobber-Outstanding-2026-09-02.md`) is the input. Four of
its nine outstanding items do not survive this pass in the form they are stated. Those
corrections are §5.

---

## 1. The flow, step by step

Each step names the field it writes, whether that field is mutable, who reads it
downstream, and what happens when it fails.

### 1.1 Ingestion

n8n watches the bookings mailbox and POSTs a hydrated thread to
`POST /api/n8n-inbound` (`app/api/n8n-inbound/route.ts`).

| | |
|---|---|
| Writes | `inbound_raw` (append-only, deduped on a payload key) — 1,776 rows, 2026-07-29 → today (**counted**) |
| Auth | `authorizeMachineCall` — `x-webhook-secret`, fails closed in production. Route is in the middleware SKIP list, so this check is the only gate |
| Failure | Capture happens **first**, before parsing, so no inbound is lost. An unrecognised payload shape returns **200** and is kept verbatim — deliberate, and it means a shape drift is silent |
| Note | n8n strips the Gmail label **before** the engine is reached. An engine timeout therefore loses the email outright; this is why `ONSINCH_TIMEOUT_MS` is 12s and the transport retries at 400/1200ms only |

`coerceThread` (`app/lib/engine/intake.ts`) tolerates Gmail, normalized and Outlook
field spellings. Returns `null` rather than throwing; the route answers 200.

### 1.2 Idempotency

`handleThread` keys on `selectLatest(messages).message_id` vs the stored
`last_message_id`. A re-POST at the same latest client message is a no-op — no model
call, no write. This is what lets the sweeps re-POST everything cheaply.

### 1.3 Compile (pure, re-runnable)

`compile()` in `app/lib/engine/compiler.ts` (1,541 lines). Order of decision:

1. **Triage filter** (`triage.ts`) — own-mail, machine senders, bulk bodies. Binding
   tiers dismiss before the model runs. Writes `notes[0] = "filtered before the model
   [<tier>]: <reason>"`, `status: "ignored"`, `classification: "not-a-job"`.
2. **Machine mail** — same shape, `notes[0] = "machine mail from <addr>"`.
3. **Classify + extract** (one combined model call). A `not-a-job` verdict is
   **overruled** where the extractor finds a dated request with a crew size.
4. **Resolve** — company, place, contact, profession, rate card.
5. **Order dedup** — see §2.
6. **Compose** (`compose.ts`) — the `DesiredOrder`, timestamps stamped in the venue's
   IANA zone (fixed 2026-09-02, `fb32ffa`).

`compile` writes nothing external. All persistence is the pipeline's.

### 1.4 Execute

`app/lib/engine/pipeline.ts` (1,164 lines). `executeOrder` picks one of four paths:

| path | when | destroys | writes to `order_action_log` |
|---|---|---|---|
| `create` | no linked order | — | `{kind:"create", order_id, ok}` |
| `tryAmendInPlace` | teams changed, `last_ordered_teams` present | nothing | `amend` / `amend-refused` |
| `tryReplace` | amend declines (chiefly a dropped block) | the order | `replace` / `replace-refused` |
| `patchOrder` | fallback | nothing | `patch` |

Guards that hold before any write: cross-thread twin, cancellation, `assessAmendment`
returning `hold`. An assumed rate card no longer holds — it flags (`review_only`).

### 1.5 Persist

Three stores, written in this order:

| store | shape | mutable? | written by |
|---|---|---|---|
| `conversation_state` | one row per thread, whole state as JSONB | **overwritten every message** | `pipeline` via `NeonStateStore.put` |
| `metric_events` | append-only event per transition | append-only | `pipeline` via `NeonMetrics.emit` |
| `tickets` + `ticket_events` | board projection + audit row | ticket mutable, events append-only | **the route**, not the pipeline |

`upsertTicketFromState` is called by `/api/n8n-inbound` and `/api/confirm-order` only.
Both production paths project; scripts that call `handleThread` without it leave the
board behind (`resync-tickets.ts` exists for that).

### 1.6 Tagging (Gmail, via n8n)

`flagManualIfNeeded` / `flagBuiltIfNeeded` / `flagUpdatedIfNeeded` run **after**
`store.put`, post to one shared n8n workflow, and write their marker
(`manual_flagged` / `built_flagged` / `updated_flagged`) only on success, so a failed
post retries on the next email. A 200 with `ok !== true` is treated as failure
(`postTag` in `deps.ts`) — the n8n trap is already handled on this path.

---

## 2. The order identity trace (objective 3)

`onsinch_order_id` has **two** sources, and they have completely different
trustworthiness. This distinction is absent from the findings document and it is the
key to §3.2.

### Source A — we created it

`createOrderWithPlace` → `client.createOrder` → `POST /orders` returns `{id}` only.
Then `readOrderIdentifiers` does `GET /orders?id=` for the job id and R number.

- The create is one call carrying the crew nested (changed 2026-08-28). It used to POST
  `SlotTeam: []` and append after, which filed orders into a queue nobody looks at.
- Consequence: `team_ids` is returned as **`[]` always**. `last_ordered_team_ids` is
  empty for every order created since 08-28 — **counted: 25 of the 47 threads holding a
  composed shape have zero team ids** — so in-place amendment declines and the rebuild
  path takes it.
- **Hole:** if `readOrderIdentifiers` cannot read the job id it **throws** — after the
  order exists. The thread lands in `error` and `onsinch_order_id` is never persisted.
  The order is real and the engine has no record of it.
- No read-back verification of the order's *content*. `verifyCreate` exists
  (`app/lib/engine/verifyWrite.ts`), is tested, and is **wired to nothing** — its own
  docstring says so and names the blocker: `Executor.createOrder` takes a `DesiredOrder`
  carrying no thread id.

### Source B — we matched it out of OnSinch history

`compiler.ts:1123`:

```ts
if (company_id && !linkedOrderId) {
  const existing = matchExistingOrder(firstDate(facts), await onsinch.companyOrdersWithJob(company_id), facts.location_text);
  if (existing && "order_id" in existing) linkedOrderId = existing.order_id;
}
```

Once written, the guard `!linkedOrderId` means **the link is never re-checked, ever**.
An order matched in July and deleted in August leaves a stale id on the thread forever,
and nothing in the system re-reads it.

### What the recorded ids actually are (**counted**)

| | threads | distinct ids |
|---|---|---|
| `conversation_state` rows carrying an order id | **168** | **148** |
| …with a successful `create`/`replace` for that id in their own action log | 58 | 60 |
| …with an **empty** action log — matched from OnSinch history | **74** | — |
| …action log exists but holds no create for the recorded id | 36 | — |
| recorded ids with no successful create/replace by us | — | **90 of 148** |
| ids we created that are recorded on no thread | — | 2 |

**61% of recorded order ids were never created by this engine.** They are readings of
OnSinch's state at one moment, never refreshed.

### `order_records` — the canonical record the charter asks for already exists, unwired

`app/lib/orderRecordsDb.ts` (added 2026-08-28) defines one durable row per order
written, holding `shape_sent`, `job_id`, `order_number`, sender identity, block and crew
counts. `recordOrder` is called from `createOrderWithPlace` **only when a `context`
argument is passed** — and `deps.ts:375` calls it with three arguments, omitting
`context`. So `recordOrder` never runs.

**Measured:** the `order_records` table does not exist in the database. The store is
dead code, exactly like `verifyCreate`.

---

## 3. Writers and readers of the contested fields (objective 4)

| field | written by | read by | mutable |
|---|---|---|---|
| `needs_human` | `compiler` (many branches), `pipeline` (5 failure branches, and `= teamsChanged` in the patch fallback) | `cannotBeBooked`, `ticketStateCounts`, `JobsScreen`, `DashboardScreen`, `queue-audit`, `funnel*` | yes, never cleared on `ordered` |
| `review_only` | `compiler` (stand-ins), cleared to `false` by `pipeline` on real failure | `cannotBeBooked` only | yes |
| `gate_reason` | **only** `ticketsDb.project()`, as `classification === "not-a-job" ? notes[0] : null` | `JobsScreen`, `funnel*`, `backfill-gate-reason.mjs` | yes |
| `tickets.extracted` | `ticketsDb.project()` — `{facts, desired_order}` | nothing in the app reads it back | **overwritten every message** |
| `order_action_log` | `pipeline` (every write path) | `tryReplace` custody check, `flagUpdatedIfNeeded`, `verify-times` | append-only within a mutable row |
| `last_ordered_teams` | `pipeline` on create/amend/replace | `amendOrder`, `verify-times` | overwritten per write |
| `order_archive` | `pipeline.archiveOrder` before a delete | `jobsDb` | append-only — **2 rows** |

`order_archive` holding 2 rows is not a defect. **Counted:** `replace` succeeded
exactly **2** times in the whole history (`order_action_log`: `replace true` = 2). The
archive is complete. The findings document reads its emptiness as evidence that orders
vanished untracked; it is evidence that the destructive path almost never ran.

---

## 4. Event-log coverage — the constraint that reshapes Phase 3

**Counted**, `metric_events`:

```
email_received  354   2026-08-24 -> 2026-09-02
thread_processed 348
job_detected     265
needs_human      154
filtered_out      83
order_created     48   (48 distinct order ids, none null)
order_updated     44
order_error       20
order_proposed     9
cross_thread_suspected 2
```

The table was added 2026-07-14 and holds **nine days**. Everything before 2026-08-24 is
gone (`scripts/db-reclaim.mjs` exists). Phase 3 of the plan says the event log becomes
available in Phase 2 and will supply the forensic trail for §3.2 — it is already
available, and it does not reach back far enough to cover the population.

What *does* reach back:

| store | rows | from |
|---|---|---|
| `thread_messages` | 2,167 | 2024-05-30 |
| `sweep_threads` | 5,835 | (full 12-month sweep) |
| `inbound_raw` | 1,776 | 2026-07-29 |
| `ticket_events` | 1,690 | 2026-07-29 — but **1,689 of 1,690 are `kind='processed'`**; one is `order-link-conflict` |
| `order_action_log` (inside state) | 190 entries | the real per-thread write history |

`order_action_log` is the only durable record of what the engine sent, and it lives
inside a mutable JSONB blob. It is the authority Phase 3 has to work from.

The vocabulary is a **funnel** log, not a decision log: `MetricType` has no gate,
dismissal, classification-reason or external-write-result event. That, not the absence
of a log, is the gap Phase 2a should close.

---

## 5. Where the findings document does not survive

### 5.1 §3.3 "every brand-new client fails to book" — **already fixed, and verified**

Fixed by `4e73213`, 2026-08-28T00:39:24Z, which fills all six required fields with
`TBC` placeholders.

**Counted** — every `createCompany` failure in the entire action-log history:

```
2026-08-27T21:53:16Z  Missing required properties: address, city, zip, country, ...
2026-08-27T21:53:31Z  (same)
2026-08-27T23:12:05Z  {"address":["Fill in address"], ...}      <- blanks rejected
...11 more...
2026-08-28T00:19:15Z  {"address":["Fill in address"], ...}      <- the last one
```

The last failure is **20 minutes before the fix**. Zero since.

**Measured** that the fix works rather than merely that nothing tried it: company ids
**822** ("Innovate Events Ltd.", 2026-08-28T23:02:15Z) and **823** ("Eventful UK",
2026-08-29T00:36:41Z) were created after it — new high ids, recorded in
`entity_aliases` by the `remember` write that only runs after a successful create.

**But the fix violates a charter rule.** The charter forbids "fabricated business data
(placeholder addresses, fake emails) to satisfy API validation — route to human review
instead". The shipped code sends `address/city/zip = "TBC"` and falls
`email_invoice` back to `bookings@spartancrew.co.uk`. The reasoning is recorded in the
docstring: OnSinch rejects blanks, Ben's rule is that creating a client is never gated
on information beyond a name, and a searchable marker beats an invented street. This is
a live conflict between the charter and a shipped, working decision. → `DECISIONS.md`.

### 5.2 §3.6 "gate_reason is null on most dismissals" — **wrong, and the real defect is worse**

**Counted:** of 181 dismissed tickets, **181 carry a non-null `gate_reason`**. Zero
nulls.

The actual defect is that `gate_reason` is positional, not semantic:

```ts
gate_reason: s.classification === "not-a-job" ? (s.notes?.[0] ?? null) : null
```

`notes[0]` is whichever note was pushed first, and for a thread the *model* dismissed
that is a merge note, not a reason. **Counted**, the top values:

```
 23  filtered before the model [own-mail]: sent by Spartan (bookings@…)     <- a real reason
 20  this message filled company_name, contact_name, contact_email, …       <- NOT a reason
 17  filtered before the model [machine-sender]: unrepliable address        <- a real reason
  6  triage WOULD have skipped this [bulk-body] … shadow mode, read anyway  <- the OPPOSITE
  5  this message filled company_name, contact_name, contact_email
  5  this message filled company_name, contact_email, customer_reference
  4  this message filled company_name, contact_name, contact_email, …
  3  Marketing/reintroduction email offering services … no crew requested   <- a real reason
```

At least **37** dismissals report the mergeFacts note as the dismissal reason, and 6
report a note saying the thread was *not* skipped. A null would have been honest. A
plausible wrong reason is what makes the board untrustworthy, and the backfill script
cannot fix it because the reason it needs was never distinct from the note stream.

The structural fix stands, but it is "carry the reason as its own field from the branch
that decided", not "stop writing null".

### 5.3 §3.9 build failure — **cause proven, and it is NOT a code defect. No fix yet.**

`EISDIR … readlink app/api/auth/google/callback/route.ts` on a file untouched since
2026-08-03, while `tsc --noEmit` passes and Vercel builds fine.

**Measured, and the general form is stronger than the report:**

```
fsutil fsinfo volumeinfo D:   ->  File System Name : exFAT
fs.readlinkSync('app/api/auth/google/callback/route.ts')  ->  EISDIR
fs.readlinkSync('app/api/jobs/route.ts')                  ->  EISDIR
fs.readlinkSync('next.config.ts')                         ->  EISDIR
stat app/api/auth/google/callback/route.ts  ->  regular file, 1470 bytes, 1 link
```

The exFAT driver answers `readlink` with EISDIR on **every** regular file in the repo,
where NTFS answers EINVAL — the answer a resolver reads as "not a symlink". So the file
named in the error is ordinary and is simply the first one the failing resolver touches.
It is the filesystem, not the file, and not Next.

**The caller is webpack's resolver, not its build cache.** Traced by wrapping
`fs.readlink` and printing the stack:

```
fs.readlink
  CacheBackend.provide            (enhanced-resolve's CachedInputFileSystem)
  ...
  Resolver.doResolve
```

**Two things I asserted here and then disproved, recorded because the first one nearly
shipped as a fix:**

1. *"One line: `config.resolve.symlinks = false`, already proven in the House of Hud
   repo."* It does not fix this repo. It appeared to on the first run only because a
   pre-existing webpack cache in `.next` served the resolve and no readlink happened;
   deleting `.next` brought the failure straight back. `config.cache = false` and
   `config.cache = {type:"memory"}` were tried in the same way and neither fixes it —
   the readlink is in the resolver's file-system layer, which those settings do not
   govern. The route file is resolved by `next-app-loader`, which does its own
   resolution and does not obviously inherit `config.resolve`.
2. *"§3.9's build failure is one failure."* It is two, and conflating them wasted a
   pass. The EISDIR above is one. The other is `EPERM … open '.next\trace'`, which has
   nothing to do with the filesystem: a `next dev -p 3111` for this repo is running
   (PIDs 23060 and 27632) and owns `.next`. `next build` and `next dev` cannot share a
   build directory. Any future attempt at this needs the dev server stopped or a
   separate `distDir`.

**Nothing was changed.** `next.config.ts` is untouched, deliberately: a config block
that does not fix the failure but reads as though it does is worse than the failure,
which is at least honest and is confined to local builds. Vercel is unaffected (Linux,
ext4) and `tsc --noEmit` plus the 93-file suite still verify the code.

**The cheap decisive test, not yet run:** copy the repo to `C:` (NTFS) and build there.
`pnpm install` was measured at 7m32s on `D:` against 13s on `C:` for another project, so
this is minutes, and it would settle whether anything beyond the filesystem is involved.
That is the right next step and it is a workstation task, not engine work — it changes no
production behaviour, so it should not sit ahead of the refactor.

### 5.4 §3.2 "39 of 47 orders don't resolve" — **the denominator is a subset**

`scripts/verify-times.mjs:135` selects
`onsinch_order_id IS NOT NULL AND last_ordered_teams IS NOT NULL` — 47 threads, the ones
holding a composed shape. The recorded-id population is **168 threads / 148 ids**. The
other **101 ids were never checked**.

And the 39 are not one phenomenon. Split by provenance (**counted**): 74 of the 168
threads carry an id the engine **never created**, matched out of OnSinch history and
never re-verified. For those, "no order at the recorded id" does not mean an engine
order was deleted — it means the match was wrong, or an order *ops* raised was removed.
Those are different failures with different fixes and they have been counted as one.

`order_archive` holding 2 rows is consistent, not alarming: `replace` succeeded twice
in the entire history (§3).

Live and still firing through 2026-09-02, from `metric_events`:

```
patchOrder 400: Records with specified IDs not found: 13803   (thread 1a02432abeaa442d, x2)
patchOrder 400: Records with specified IDs not found: 15695
patchOrder 400: Records with specified IDs not found: 15722   (x2)
patchOrder 400: Records with specified IDs not found: 15700
patchSlotTeams 400: Records with specified IDs not found: 39958,39959
```

### 5.4a §3.1's seven orders split in two, and only four are correctable by code

The findings document proposes correcting all seven with an in-place `PATCH /slotTeams`
"using the ids in `last_ordered_team_ids`". Those ids exist for only four of them
(**counted**, against `conversation_state`):

| order | R | blocks | `team_ids` | created | route |
|---|---|---|---|---|---|
| #14855 | R10702 | 4 | **4** | 08-25 11:10 | `PATCH /slotTeams` |
| #15574 | R10726 | 2 | **2** | 08-27 17:09 | `PATCH /slotTeams` |
| #15593 | R10742 | 4 | **4** | 08-28 13:25 | `PATCH /slotTeams` |
| #15594 | R10743 | 4 | **4** | 08-28 13:27 | `PATCH /slotTeams` |
| #15761 | R10807 | 1 | **0** | 09-02 16:59 | **hands, in the OnSinch UI** |
| #15762 | R10808 | 6 | **0** | 09-02 17:50 | **hands, in the OnSinch UI** |
| #15763 | R10809 | 4 | **0** | 09-02 19:17 | **hands, in the OnSinch UI** |

The cut is 2026-08-28, when the create changed from two-phase (`POST /orders` with an
empty team array, then `POST /slotTeams` one at a time, each returning its id) to one
call carrying the crew nested. The old route bought the ids; the new one does not.

This also **closes A7** in `ASSUMPTIONS.md`, and it closes it against
`slotTeamsForOrder`'s docstring. `fleet/resume/Spartan-Jobber.md` §2 has it measured
2026-08-24 (`16e20ed`, API reference §12):

| how the order was raised | audit log | consequence |
|---|---|---|
| the OnSinch UI — `order_create`, 6,786 rows | a child row per Job, SlotTeam **and Slot**, each with its id | blocks **are** addressable |
| `POST /orders` — `order_created_via_api`, 4,131 rows | **one childless row** | blocks are **never** addressable, under any key |

And there is no service key to change that: `creator` is never null across 2,400 sampled
audit rows and the 800 most recent orders. So for an engine-raised order after 08-28,
the block ids exist nowhere and cannot be recovered — the only record was the response
the two-phase create used to read, and that call is no longer made.

**Consequence for the plan:** the three September orders are a `HANDOVER.md` item, not a
Phase 5a code item, and no amount of Phase 3 diagnosis will make them addressable.

### 5.4b R numbers — a claim I made here and then falsified. **Not a defect.**

**This section previously asserted that at least four recorded R numbers were wrong.
That was an inference from our own database, never a measurement, and it is false.**
It is left in, corrected, because the reasoning error is worth more than the deletion:
I read a pattern in internal records and reported it as a finding about OnSinch without
ever reading OnSinch.

What is true — **counted** over `tickets` — is that three R numbers each stand against
more than one order id:

```
R10726 -> #15572, #15573, #15574
R10741 -> #15591, #15592
R10749 -> #15600, #15601
```

These are not reposts of one job. Pulling the threads (**counted**, with their action
logs):

```
R10726  thread 1a03e2acc8e81c3f  #15572  "Re: Crew currently"
          08-27 15:22 create:true #15572 | 3x amend-refused
        thread 1a0441ad250f8712  #15573  "new booking request in london"
          08-27 16:44 create:true #15573
        thread 19fc73c87a9f16ba  #15574  "Re: SPARTAN CREW - CHOPOVA LOWENA - 19 S"
          08-27 17:09 create:true #15574

R10741  thread 1a0488980be0125f  #15592  "RE: Abracadabra Crew"
          08-28 13:23 create:true #15592
        thread 1a043daff1110f26  #15591  "Re: 29/08"
          08-28 11:09 create:true #15587 | 12:27 replace:true #15591 | 12:35 patch:true

R10749  thread 1a048e8ee37b0eeb  #15600  "Re: IMPACT /// Creamfields Crew Enquiery"
        thread 1a0498b86a91d5e1  #15601  "Re: 2 x crew, Friday 4th Sep"
```

From that I concluded that the post-create read-back was resolving to the wrong row.
**Measured 2026-09-02** — one read-only call, `GET /orders?id[in]=15572,15573,15574,
15587,15591,15592,15600,15601&with=Job`:

```
15572  ABSENT
15573  ABSENT
15574  R10726   company 150   <- the only one that still exists
15587  ABSENT
15591  ABSENT
15592  ABSENT
15600  ABSENT
15601  ABSENT
```

Our record for #15574 says `R10726`. **OnSinch says `R10726`.** It is correct. Seven of
the eight ids simply no longer exist, and a dead id keeps whatever R number it was read
with at the time. One R number standing against several ids in our own table is
therefore the *footprint of §3.2*, not a second defect — and the same probe removed my
other speculation, that `?id=` might not be an honoured filter: `id[in]` returned exactly
the one matching row out of 6,686 orders.

**Nothing is misreporting an R number, and nothing needs building for this.** Gaps and
oddities in the R sequence are expected anyway — the Spartan team raises orders in the
OnSinch UI by hand, which consumes numbers the engine never sees.

The `job_id` worry that followed from it collapses with it: it rested on the read
resolving to the wrong row, and the read resolves correctly.

**The lesson worth keeping**, since it is the one that nearly cost a fabricated
work-stream: a pattern in our own database is evidence about our own database. It becomes
evidence about OnSinch only after OnSinch has been asked, and asking cost one call.

### 5.5 §3.4 and §3.5 — **confirmed exactly**

**Counted** against `tickets` with the board's own predicate: `live` 242,
`needs_human` 90, of which `62` already carry an order id, `failed` 17, `dismissed` 181.
Every number in the findings document reproduces.

---

## 6. What already exists of Phases 1 and 2

The plan assumes these have to be built. They are built, and in two cases they are built
and unreachable.

| plan item | state |
|---|---|
| 1a deny-by-default auth middleware | **built** — `middleware.ts` gates `/api/*` on an iron-session, `AUTH_REQUIRED` is the master switch, and previews are enforced from `VERCEL_ENV` regardless of the switch. Nothing to implement; the whole item is a human sequence → `HANDOVER.md` |
| 1a shared-secret machine routes | **built** — `decideMachineCall` fails closed in production |
| 1b envelope check (`{ok:true}`, never HTTP status) | **built on the n8n edge** (`postTag`). Not present on the OnSinch edge, which is status-checked instead — appropriate, OnSinch is honest about its status codes |
| 1b read-back after create | `verifyCreate` is still unwired, but **its stated blocker is gone**: `Executor.createOrder` now carries an `OrderContext`. Deliberately not wired further — see §11 |
| 1b idempotency key | none exists in the API (checked: nothing documented, and the unknown-property oracle rejects unknown keys). **Handled without one** — §7 |
| 1c build fix | one line, diagnosed (§5.3) |
| 2a append-only event log | **built** (`metric_events`), 9 days of retention, funnel vocabulary only, no reason codes |
| 2a `ticket_events` | built, one event kind in use |
| 2b canonical order record | **LIVE 2026-09-02.** `order_records` is written on every create; table verified to exist with 14 columns |
| 2b `id_source` / `last_verified_at` | **LIVE 2026-09-02** as `id_source` + `verified_at`, both required on the input type so no call site can omit provenance. Only the create path writes them; matched ids still carry none — §11 |
| 2c lifecycle state machine | absent. `status` + `needs_human` + `review_only` + `manual_flagged` are the current encoding |
| 2d generic review queue | absent. The confirm queue (`listProposed`) is the nearest thing and holds only staged orders |

---

## 7. One live risk found in Phase 0 that is on no list — **FIXED 2026-09-02**

`httpTransport` retries `POST /orders` on 5xx. Its own docstring justifies this by
saying a duplicate would be a harmless empty order, "because `POST /orders` now carries
an EMPTY SlotTeam array (id custody)".

That stopped being true on 2026-08-28, when the create was changed to carry the crew
nested — for a measured reason (an order created blockless is filed nowhere). The retry
comment was not revisited. **A 500 that the server actually applied now produces a second
complete booking, with real crew, on a real job.**

Not observed in the data — OnSinch 500s were measured at 17% under concurrency 4 and 0%
at concurrency 1, and production runs one thread at a time — but the guard was gone and
the comment said it was present. `POST /companies` and `POST /places` were in the same
position and would have duplicated a client or a venue, which is the tenant pollution the
whole alias/dedup layer exists to prevent.

**Fixed.** The rule is now stated by what is safe to repeat rather than by a list of
exceptions, because the list is what went stale:

```ts
status >= 500 && status !== 501 && method !== "POST"
```

GET is a read; PATCH and DELETE address a record by id and land in the same state whether
sent once or twice. No POST is repeated.

**The booking-loss recovery was not surrendered to get that.** It moved into
`OnsinchClient.createOrder`, which knows the body and can therefore *ask* OnSinch whether
the order exists rather than guess — a read repeated safely in place of a write repeated
dangerously. On a 5xx or a transport throw it looks the order up by
`?name[eq]=<name>&company_id[eq]=<id>`, restricted to rows whose `created` post-dates the
call, and adopts it if found. Only after OnSinch has twice said the order is absent is the
create sent again, once.

Every property of that lookup was probed live before it was written, and two of the
probes changed the design:

| probed | answer |
|---|---|
| `?name[eq]=<name>&company_id[eq]=150` | returns exactly 1 row of the tenant's 6,686 |
| a name no order carries | returns 0 rows — so the filter is applied, not ignored |
| the percent-encoded key form `qs()` emits | works identically |
| `?sort=-id` on `/orders` | **NOT honoured** — returned `478, 1111, 1547, …` ascending |
| an idempotency key in the API | none documented, and the unknown-property oracle rejects unknown keys |

The `sort=-id` result is why nothing here reads "the newest page": that design would have
been reading the tenant's oldest orders and reporting every lost create as absent.

**A failed lookup is not an absent order.** `this.t` hands back `{status: 500, data: null}`
rather than throwing, so reading `data?.data ?? []` off it would turn every server error
into the confident answer "no such order" and authorise the second write — reintroducing
the bug. It throws, and the create refuses to re-post on an unanswered question. A booking
lost that way is loud: the thread goes to `error`, the booking-lost reporter fires, the
Manual tag lands, ops see it on the board. A duplicate booking produces no signal at all.

**Residual risk, stated rather than hidden:** a duplicate is still possible if OnSinch
applies the write, answers 5xx, *and* hides the row from two reads 1.2s apart. Nothing
available through this API narrows that further.

**Tests:** `test/createNeverDuplicates.ts`, 12 cases, every one counting POSTs because
"did it write twice" is not visible in a return value. Four mutants were introduced to
prove the tests can fail, and each was caught by its intended case:

| mutant | caught by |
|---|---|
| M1 — restore the old `retriable` rule | [1] — 3 attempts per create on `/orders`, `/companies`, `/places` |
| M2 — probe once instead of twice | [4] [5] — **2 POSTs**, an actual duplicate on the race |
| M3 — a failed lookup reads as absent | [8] — **2 POSTs** on an unanswered question |
| M4 — drop the `created` window | [6] — adopted a 90-day-old order with a repeated name |

`test/transportRetry.ts` [1] previously asserted the *old* behaviour and now asserts the
new one; `test/replaceOrder.ts` gained the trailing lookup in its delete-then-failed-create
sequence, which is the branch where it matters most — the old order is already gone, so
"did the replacement land?" separates an unowned booking from no booking. Full suite: 93
files, all pass, `tsc --noEmit` clean.

---

## 8. Dependency map

Revised from the plan's, on Phase 0 evidence. `[done]` items are shipped and verified;
`[wire]` items exist as unreachable code.

```
§3.9 auth          ─ code done ──> human sequence only            [HANDOVER]
§3.9 build         ─ one line, diagnosed                          [ready]
§3.3 createCompany ─ done 08-28, verified                         [DECISIONS: TBC vs charter]
§3.6 gate_reason   ─ reason is positional, not null               [independent, small]

retry-duplicates-a-booking ──> must precede any create-path work  [NEW, §7]
        │
        v
create-path thread id ──> verifyCreate [wire] ──> order_records [wire] ──> id provenance
        │                                                                      │
        │                                                                      v
        └──────────────────────────────> §3.2 diagnosis, split by provenance ──┤
                                            74 matched / 58 created / 36 other │
                                                                               v
                                    §3.1 wrong-hour   §3.4 stale flags   §3.5 tile counts
                                    4 code + 3 hands  (62 of 90)         (13 test sends)
                                            │
                                            v
                                    §3.8 unexplained times (3), §3.7 outbound ruling [DECISIONS]
```

Two real re-orderings against the plan:

1. **§3.2 cannot be diagnosed as a single population.** It has to be split by id
   provenance first, and the split needs no new infrastructure — it is a query over
   `order_action_log`, already run in §2 of this document.
2. **The retry guard (§7) was a live production risk with a stale justification.**
   **CLOSED 2026-09-02** — see §7.

A third re-ordering was proposed here and withdrawn: see §5.4b. The R numbers are fine.

---

## 9. What remains uncertain

- Whether the 74 matched-and-never-created ids were ever correct. Establishing that
  needs OnSinch reads by id, which is Phase 3.
- **Why the post-create read-back returns another order's R number** (§5.4b). Four wrong
  numbers are measured; the mechanism is not. `GET /orders?id=` may not be an honoured
  filter — the API reference documents filters as `?<field>[<op>]=<value>` — in which
  case `orderById` is matching against an unfiltered page whose contents depend on
  paging, and the findings document already records that `/orders` pages are
  non-contiguous. Unproven.
- Whether any order carries a **wrong `job_id`** from the same read. Not looked for. It
  is the version of this bug that would attach crew to another client's job.
- Why `metric_events` starts 2026-08-24. `db-reclaim.mjs` is the likely cause; it is not
  proven and the retention policy is not written down anywhere.
- Whether commit `4e73213` reached production before the 08-28 successes. The company
  creations after it are strong evidence that it did; the deploy has not been confirmed
  against Vercel.

---

## 12. §3.2, measured against OnSinch for the whole population — 2026-09-02

Phase 0 said the matched ids were the mechanism behind §3.2 and proposed starting there.
**That was wrong, and the measurement is the opposite way round.**

All 149 recorded ids were read back from OnSinch by id (batched `?id[in]=`, a sample
re-checked individually with `?id=` so the batch form could not be the artifact):

| where the id came from | threads | point at an order that does not exist |
|---|---|---|
| matched from OnSinch history (empty action log) | 74 | **1** |
| action log exists, no create for this id | 36 | 2 |
| **this engine created it** | **59** | **50** |

The matched ids are healthy. **It is the orders the engine creates that do not survive**,
and it is happening now: of 13 orders created on 2026-09-02, 9 were already gone the same
day.

### It is not deletion by ops, or not only that

Cross-checked against OnSinch's own `order_created_via_api` audit — 5,698 rows, coverage
2026-02-22 → today, order ids 7500–15767, so every id in question is inside its range:

| of the 61 ids our `order_action_log` says we created | |
|---|---|
| OnSinch confirms an API create, and the order still exists | 9 |
| OnSinch confirms an API create, and the order is now gone | 8 |
| **OnSinch has no record of the create at all** | **44** |

Deletion does **not** remove the audit row — 8 orders are gone and still carry theirs. So
for 44 order ids the engine recorded `create ok:true` with an id, and OnSinch has neither
the order nor any memory of creating it.

Two other explanations were tested and eliminated:

- *"Converted to quote, so it drops out of `/orders`."* No. Order 15764 (R10810) has an
  `order_convert_to_quote` audit row and is still returned by `GET /orders?id=`, with
  `quote=true`. Note those audit payloads carry the **R number**, not the order id — a
  trap that makes them look absent if read as ids.
- *"The batch read is missing them."* No. 15740, 15738, 15734, 15732 were each re-fetched
  individually with `?id=` and return zero rows, while 15767 returns normally.

### The one thing that looks like a boundary

Every create on 2026-09-02 up to 14:18 UTC has no audit row and is absent; every one from
16:59 UTC on has an audit row and still exists. It is not a clean cutoff earlier in the
week — 08-28 alternates within the same hour — so it is a lead, not a finding.

### What is NOT established

- **Why.** Whether those 44 were created and hard-deleted in a way that removes the audit
  row, or were never created at all. Those are very different defects.
- A `data[like]=%15740%` sweep returns 93 rows, but that is a substring match over the
  whole payload and matches any row containing those digits in any field. It is not
  evidence about order 15740 and is not used as any.

### The experiment that settles it

Create one order on **TEST company 515** through the real code path, then immediately
(a) `GET /orders?id=`, (b) look for its `order_created_via_api` row, (c) re-read both
after a minute, then delete it. If the order and the audit row are both there, these 44
were created and later destroyed, and the question becomes who is destroying them. If the
audit row never appears, the engine is recording successful bookings that OnSinch never
made — which would mean the board, the tags and the client replies have all been
reporting work that does not exist.

It is one write to the tenant's designated test company, the pattern
`scripts/probe-onsinch-clock.ts` already uses, and it cleans up after itself.

**Nothing has been built against this finding.** The matched-id work it displaced is not
worth doing: 1 of 74 is not a defect worth a refactor.

---

## 11. Refactor — first step, done 2026-09-02

One missing argument was holding two finished features dead, so that is where it started.
`Executor.createOrder` took a `DesiredOrder`, which says what to book and nothing about
who asked, so the create path could not name its own thread.

**What changed**

| | |
|---|---|
| `pipeline.ts` | `Executor.createOrder(order, where?)` — a new `OrderContext` carrying `thread_id`, `sender_email`, `sender_domain`, all already on the state |
| `deps.ts` | passes it on. `createOrderWithPlace` has taken a context parameter since 2026-08-28 and this call site supplied three arguments — which is the entire reason `order_records` had never executed |
| `orderRecordsDb.ts` | `id_source` and `verified_at` added, **both required on the input type** so tsc rejects any call site that omits provenance |
| `deps.ts` | `readOrderIdentifiers` no longer throws — §7 of this list |

**`order_records` is live.** DDL executed and verified against the database: 14 columns,
`id_source` NOT NULL, `verified_at` nullable. Zero rows, filling from the next create.
`verified_at` is nullable deliberately — "never verified" and "verified and absent" are
different facts, and a boolean would rebuild in the schema the exact conflation that makes
"39 of 47 do not resolve" read as one finding when it is two.

**A stale invariant removed.** `readOrderIdentifiers` threw when the job id would not read
back, justified by "every block that follows has to be posted against a job_id". Nothing
follows the create any more — since 2026-08-28 the crew is nested in it, and
`createSlotTeam` is reached only from `amendOrder.ts` (verified: no other call site). The
throw therefore discarded a **completed booking**: the order exists in OnSinch, the
exception reaches the pipeline's catch, the thread goes to `error`, and the id is never
persisted. It now returns the order and reports the gap. **Never realised** — no thread in
`conversation_state` carries that message — so this is a hazard removed, not a loss
recovered.

**Tests:** `test/createCarriesItsThread.ts` (19 assertions), `test/orderRecord.ts`
extended. Mutation-tested like §7: M5 (drop the context) fails 6 assertions; M6 (restore
the throw) fails 4. Full suite 94 files, all pass, `tsc --noEmit` clean.

### What was deliberately NOT done, and why

- **`verifyCreate` is still unwired.** Its blocker is gone and it would now be one call,
  but the failure it was written for — "99 orders written with no crew across five days" —
  was caused by the two-phase create posting `SlotTeam: []`, and that was fixed on
  2026-08-28 by nesting the crew. Wiring it costs 3 extra API reads per create inside
  n8n's 60s ceiling, and its own docstring says the audit row can lag, so the likely result
  is every order recording "unverified". That is a queue-filling change to detect a
  fixed failure. It needs a measurement first: how often is the audit row present within
  a second of a create?
- **Matched ids still carry no provenance.** The 74 threads whose id came from
  `matchExistingOrder` are the actual §3.2 mechanism, and giving them `id_source:
  "matched"` means writing records from the compiler's link path — a change to how orders
  are linked, not how they are recorded. It is the next step, and it is a bigger one.
- **Nothing was backfilled.** `order_records` starts empty and fills forward.

---

## 10. Exit gate

Phase 0 asks for a written system model and a dependency map, accepted by a human before
Phase 1 begins. Both are above. The four corrections in §5 and the new risk in §7 change
what Phase 1 should do first, so acceptance is a real decision, not a formality.

Nothing was changed. Zero writes to the database, zero OnSinch calls, no deploy.
