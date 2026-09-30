# Job identity, conversation consolidation and canonical job state — design

2026-09-29. Discovery, architecture, tests and plan. **Nothing here is built.** Implementation waits
for Ben's go-ahead.

Evidence tags: **[measured]** = counted this session against Neon or the live OnSinch tenant
(read-only unless stated). **[repo]** = read in code. **[carried]** = older note, not re-checked.
**[assumption]** = believed but unverified. The OnSinch API facts are in
`~/.claude/projects/C--Users-thera/memory/reference_onsinch_nested_reads.md` and `public/data/feed.json`.

---

## 1. Current system discovery

### 1.1 The path an email takes today [repo]

| Stage | Where | What it does |
|---|---|---|
| Intake A (historical) | n8n `CPIRu7CpezvKjU8d` → `app/api/n8n-inbound` | n8n POSTs the full hydrated thread. `captureInboundRaw` stores the payload first (`inbound_raw.dedup_key` UNIQUE), then `handleThread`. |
| Intake B (new, not yet live) | `app/api/mail-poll` (Gmail history cursor) | Stores each RFC message (`storeMessage`), then rebuilds the thread from `thread_messages` and calls `handleThread`. |
| Intake C | `app/api/mail-inbound` (webhook) | Parses raw MIME (`rfc822.ts`), finds the thread through `In-Reply-To`/`References` (`threadIdForMessageIds`), stores the message and calls `handleThread`. |
| Idempotency | `pipeline.handleThread:379` | If the newest client message id equals `conversation_state.last_message_id`, it is a no-op. |
| Read and extract | `compiler.compile` → `reason.classifyAndExtractIncremental` | One model call per new message. It returns the COMPLETE thread facts, not a diff. |
| Merge | `mergeFacts.ts:75` | `requests` is replaced wholesale by the new answer whenever that answer has any blocks. |
| Party | `resolveCompany` (domain → company, aliases); `resolveContact` returns 2257 deliberately | The company decides which orders are candidates. |
| Order binding | `compiler.ts:1327-1446` | Keeps a bound order that still exists (with an R-number rebind rule). If the order is gone (two witnesses), it unbinds and runs `matchExistingOrder` (`resolve.ts:673`): same company and same Order.happening day, venue tiebreak, R number as a check. Ambiguous means blocked. No match means **create**. |
| Cross-thread twin | `crossThread.findCrossThreadMatches` over the 500 newest states | Same company and day and venue means hold, plus an internal email to bookings@. It never writes an order. |
| Compose | `compose.composeOrder` | One Job; one SlotTeam per window+place+profession; the chief as its own block (old schema, kept). |
| Write | `pipeline.executeOrder` | Create, else amend in place, else delete-and-repost, else PATCH /orders plus an "apply by hand" note. |
| Records | `conversation_state` (UNIQUE thread_id), `order_records` (UNIQUE thread_id+order_id), `order_action_log` inside the state JSON | |
| Follow-up | `app/lib/followup/clock.ts` | Derives who is waiting for whom from the thread's message list. |

### 1.2 Mechanisms inventory

| Mechanism | Operates on | Trusts | Kind | Works | Fails | Verdict |
|---|---|---|---|---|---|---|
| `inbound_raw.dedup_key` | raw delivery | route-specific key | det. | retries of the same delivery | nothing across routes | **retain** |
| `message_ledger` UNIQUE message_id | n8n claim | Gmail API message id | det. | n8n replays | not used by mail-poll | retain; fold into canonical message key |
| `thread_messages` PK message_id | message | whatever id the route supplies | det. | within one route: 0 message ids appear under 2 threads [measured] | **4,236 rows keyed by Gmail id vs mail-poll's RFC id; thread id bare vs `gmail:`-prefixed** (§3.1) | **modify**: one canonical key |
| Newest-message fast path | thread | latest client message id | det. | cheap replay | correctness depends on the thread staying one thread id | retain as an optimisation only |
| `mergeFacts` | thread facts | the model's complete re-statement | AI + det. | fills blanks, keeps scalars | **drops any block the model omits** (reproduced: 12 → 8 crew, `plan-characterisation.ts` A1) | **replace** with a change-set fold (§14) |
| `matchExistingOrder` | company's orders | Order.happening day, venue verdict, R number | det. | same-day single order | **multi-day orders: a change to day 2 finds nothing and leads to create** (M1) | **replace** with block-level candidates (§9) |
| Bound-order refresh + unbind | thread↔order | order id, two-witness absence | det. | a live bound order | an unbound thread falls to create; **a thread whose order ops re-typed can create again** | **modify**: never-recreate rule (§9.5) |
| Cross-thread twin | thread shapes | company+day+venue | det. | holds obvious twins | 500-row window; holds instead of linking; knows nothing of order links | **absorb** into job resolution (§9) |
| `orderLink.decideLink` | order→thread backfill | "Company @ Venue" names, dates, addresses | det. score | the 30-order backfill | never on the live path; the team's names are house vocabulary | retain as a script only |
| `identity.counterpartyIdentity` | thread | organisational domain (consumer providers excluded) | det. | per-organisation grouping | person-level identity; shared agency domains [assumption] | **retain** as the party key |
| `conversation_state` row | thread | Gmail thread id | — | per-thread working memory | **is the only memory, and it is per thread**: one job across 3 threads has 3 disconnected memories | **modify**: per-thread cache; job memory moves to `jobs` |
| `order_records` | (thread, order) | order id | — | durable link | order id is not identity (re-key, copy, move); no history of *why* | **migrate** to `job_links` |
| Follow-up clock | thread messages | message direction and time | det., derived | replay-safe | a split thread identity splits the clock | retain; its input needs canonical ids |
| `renderThread` | one thread | chronological order, newest marked | det. | one thread | cannot show a job spanning threads | **modify**: job-level projection (§18) |

### 1.3 "Lenny"

There is no Leni code in the Spartan repo [repo]. Leni is HoH's (`C:\Users\thera\hoh-onelist`). Its
intake (`app/lib/intake/decide.ts`) has the closest prior art, and three ideas carry over:

- **Person, then job.** An identity match says WHO. A date veto decides WHICH job: the same client with
  a confidently different date is a second booking.
- **`asOf` = the arrival's own time.** Lookups are evaluated as of the message, so a replayed or
  late message never finds itself.
- **Normalised identity, stored normalised.** Equality lookups, never fuzzy scans.

One thing is not taken: *"no event date in the message → their most recently active job"*. That is a
guess, and it is exactly the silent attachment this design forbids (§12). HoH's human-answered "Same
enquiry?" panel (`app/api/intake/dedup`) is the right shape for the abstention queue (§12).

## 2. What the data says [measured]

772 threads and 4,239 messages (median 3 per thread, max 42); 749 conversation states. Of those, 182
threads carry a company and dated blocks, across 102 companies.

| Finding | Number | Consequence |
|---|---|---|
| Companies with 2+ threads | 37 | `same client ≠ same job` is the common case, not the edge |
| Same-company thread pairs | 202 | — |
| … sharing a work day | 30 | same job **or** a parallel job; venue must decide |
| … on different days within 7 days | **45** | temporal proximity must never merge on its own |
| … more than 60 days apart | 17 | recurring clients |
| OnSinch orders linked from 2+ threads | 23 (52 threads) | one job really does span threads |
| … extra threads that name no date | 17 of 23 orders | the continuation email is often undated (a PO, a thanks, a question) |
| Threads linked to 2+ orders | 19 | 9 re-bound to a re-typed successor, 4 re-created by the engine, 6 matched to different orders |
| Threads whose requested days span 14+ days | 13 | a thread can carry more than one job |
| Messages ingested after a newer message of the same thread | 1 (1 thread) | out-of-order ingestion is real but rare |
| Last message vs last work day | 119 before, 52 within 0-3 days after, 6 within 4-14, 1 within 15-60, 4 after 60+ | a 14-day tail covers 178/182 |
| Client messages carrying an R-number-shaped token | 233 / 2,098 | hard ids exist in about 11% |
| Client messages matching "PO / purchase order" | 1,374 / 2,098 | **noise**: Spartan's own footer is quoted back |
| Normalised subjects reused across different threads | 46 | the subject is weak evidence |
| OnSinch company+date keys carrying 2+ orders | 13.9% [carried, crossThread.ts] | parallel jobs are routine |

OnSinch lifecycle [measured]:

- Confirm keeps the order id (8/8).
- A copy mints new ids, linked in the audit (`order_create_by_copy.originalId`); 0 of 186 engine
  orders were copied.
- All 86 engine creates (09-03..09-18) are gone. 47 were re-typed by a person at about +1 id. None of
  our 86 job ids survive, 0/47 successors mention our id, R number or job id, and 47/47 have
  brand-new jobs.
- UI edits write `common_create` / `common_change` audit rows **with old and new values, creator and
  time**.

## 3. Existing gaps and failure risks

### 3.1 RESTART BLOCKER — two identities for one conversation [measured]

Every historical row uses **bare Gmail ids**:

| Table | Bare Gmail thread ids |
|---|---|
| `conversation_state` | 749/749 |
| `thread_messages` | 4,236/4,239, with Gmail API message ids |
| `order_records` | 346/347 |
| `message_ledger` | 3,546/3,546 |

`mail-poll` (`route.ts:136-140`) stores `thread_id = "gmail:" + threadId` and `message_id = RFC
Message-ID`. So the first reply after restart in any existing conversation becomes a **new thread with
no state and no order link**. The engine reads it as a fresh enquiry, which breaks the bridge and the
follow-up clock and opens duplicate orders. A message seen by both routes is also stored twice.

**Fix before restart**: for Gmail mail, the canonical thread id is the bare Gmail thread id and the
canonical message id is the Gmail id. The RFC Message-ID, `In-Reply-To` and `References` go in their
own columns. This is the other session's route; it has been told. It confirmed the code half and
found a **third** convention: `mail-inbound` mints its own thread id through
`resolveThreadId`/`threadIdForMessageIds` [peer]. One canonicalisation rule must cover all three routes.

### 3.2 Other gaps

- **G1** — Job memory is per thread. Three threads about one booking hold three unrelated fact sets. An
  amendment in thread B cannot see thread A's blocks.
- **G2** — Omission equals deletion (`mergeFacts`). There is no way to say "explicitly cleared" or
  "not mentioned".
- **G3** — Order identity is the order id, which does not survive re-typing (47/47) and changes on a
  copy.
- **G4** — Resolution defaults to create: an unbound thread creates, including after ops deleted and
  re-typed its order.
- **G5** — Matching reads `Order.happening` (the earliest block) rather than block days. Venue comes
  from order-name text.
- **G6** — No reply-chain evidence is stored: `thread_messages` has no `In-Reply-To`/`References`
  columns, although `rfc822.ts` parses them.
- **G7** — No lock around `handleThread`. Intake, sweep and reconcile can race on one thread, and two
  threads for one new job can each create.
- **G8** — Uncertainty is not a state. It is a note, a `needs_human` flag, or a hold on the whole thread.
- **G9** — Every statement is treated as the same kind of truth. A default (08:00-18:00), a model
  inference and a client's quoted request look identical in `desired_order`.

## 4. Domain model

| Concept | Definition | Identity | Exists today? |
|---|---|---|---|
| **Message** | one email | canonical message key (Gmail id; RFC Message-ID as alias) | `thread_messages` |
| **Thread** | a Gmail conversation | bare Gmail thread id | yes (keys to fix, §3.1) |
| **Party** | the client organisation (OnSinch company) plus the people writing | `company_id`; contacts by normalised address; organisational domain | resolved per thread, not stored |
| **Job** | **the real-world engagement a client books**: crew for one event or piece of work, at one or more venues, over one or more days | **engine-minted `job_id`** (ULID) | **new** |
| **Block** | one unit of work inside a job (Install, Derig, Warehouse), one OnSinch SlotTeam. Ben called this a "job" during the grouping work; here it is a block to avoid the clash | `(job_id, block_ref)`, e.g. `b2` | implicit in `desired_order.slot_teams` |
| **Association** | "message M concerns job J", with status, evidence and who decided | row per (message, job, version) | **new** |
| **Fact** | one field-level statement a message makes about a job, e.g. "Derig b2 size = 6", with a quote and authority | row per (message, extractor version) | **new** (replaces thread-level `facts`) |
| **Link** | job J corresponds to OnSinch order O / job J' / SlotTeam T since time t, and why | row with valid_from/valid_to | replaces `order_records` |
| **Order** | the OnSinch record: a *projection target* of the job's state, not the job | OnSinch ids (links) | external |
| **Amendment** | a fact that changes a job after a link exists (or before, as a pre-order change) | the facts themselves | implicit |

Nothing else is introduced. The job conversation is a *query* (messages with a confirmed association
to J, ordered), not a table.

## 5. Canonical definition of job identity

**A job is identified by the `job_id` the engine minted when it first decided that a message began a
new engagement.** Nothing external is its identity:

- **Gmail thread id**: evidence. A thread can carry two jobs, and a job spans threads.
- **OnSinch order id**: a link. It changes on re-type, copy or delete-and-repost.
- **OnSinch job id**: a link that survives a move between orders, but not a re-type.
- **R number**: a link that is reused after deletion (max+1) [carried].

External ids point *at* a job through `job_links` (with history) and never *are* it. A job's identity
is permanent. What can change is which messages are associated with it and which OnSinch records it
links to, and both changes are recorded.

## 6. Minimum safe association granularity

**Message → job is the association unit. Fact → block is the attribution unit.** No segment-level
text splitting.

- **Why not thread → job:** 19 threads link to 2+ orders, 13 threads request work spread over 14+
  days, and clients reply into old threads months later (4 threads run 60+ days past their work).
- **Why not segments:** the one real multi-job message shape is *one email asking for crew on two
  engagements*. The extractor already splits requests into blocks, each with its own day and venue.
  The resolver assigns each extracted *block fact* to a job. So one message may hold **several
  associations** (many-to-many), and each fact names its job. Splitting prose is never needed.
- **Thread → job stays as a derived convenience:** a thread has a *thread job* only when every
  confirmed association in it points to the same job.

## 7. Message idempotency

- **Canonical message key**: for Gmail, the Gmail message id (continuity with the 4,236 historical
  rows). `rfc_message_id` is stored as a second UNIQUE (partial, non-null) key. Either key finding an
  existing row means *already held*.
- **Drafts**: never messages (already enforced; a draft keeps its id when sent).
- **Processing idempotency**:
  - extraction is idempotent per `(message_key, extractor_version)`;
  - association per `(message_key, resolver_version)`;
  - OnSinch writes per `write_intent(job_id, state_version, op_hash)` (§20).
- The `last_message_id` fast path stays as a cost optimisation. Correctness never depends on it.
  **Its key must come from the same message selection `compile()` uses.** The other session found that
  `handleThread` keys on `selectLatest` over RAW messages, while `compile` selects over NORMALISED ones
  (empties dropped, forward recovery appended). Where they diverge the key can never match, and the
  thread re-runs the model on every sweep: a cost leak, still being measured [peer].

## 8. Thread identity

The bare Gmail thread id is the thread key, one namespace per provider (`mail:` stays for the webhook
provider, which has no Gmail thread). Store `rfc_message_id`, `in_reply_to[]` and `references[]` on
every message. They are evidence (§9), not identity: Gmail itself groups by subject plus references, and
a reply months later lands in the old thread.

## 9. Job identity resolution

### 9.1 Evidence classes

| Class | Evidence (Spartan) |
|---|---|
| **Hard** | an R number / order id / OnSinch job id in the message's *own* text (not the quoted tail) that resolves through `job_links` (current or historical) to exactly one job **of the same company** |
| **Strong** | same thread whose thread job is J, with no contradiction · same company + a requested work day ∈ J's block days + same venue (Ben's Q4 floor) · a reply-chain parent (`In-Reply-To`) whose confirmed association is J · stated change language naming one of J's existing values ("move the 9th to the 11th", "make the derig 6 instead of 4") |
| **Weak** | same company only · same contact · same venue only · subject similarity · a work day within 7 days of J's · PO *value* equal to J's recorded PO |
| **Contradictory** | requested days ∩ J's days = ∅ with no change language · a different venue on the same day with no move language · new-engagement language ("another event", "next year", "new booking") · J closed (source time > last work day + 14d) and the message requests crew · company mismatch (**veto**) |

AI **extracts** (dates, venue text, blocks, R-number tokens, change language, new-engagement language),
each with a verbatim quote. **Identity is decided deterministically** from the extracted features. No
similarity score, and no model call decides a merge.

### 9.2 Decision procedure

Every lookup is evaluated **as of the message's source time** (`asOf`, from HoH).

0. **Party.** Resolve the company (domain → company, aliases). Unknown company plus a crew request
   means **NEW job, new client** (existing provisioning rules). Unknown company otherwise means not a
   job, or UNCERTAIN.
1. **Hard reference.** Tokens → jobs of this company. Exactly one gives **CONTINUE J**, unless there is
   new-engagement language *and* the requested days are disjoint from J's: that means an old job cited
   for pricing, so **NEW job**. Tokens resolving to another company's job, or to 2+ jobs, give
   **UNCERTAIN**.
2. **Thread continuity.** The thread has a thread job J. **CONTINUE J** unless contradicted:
   - disjoint days and no change language, *and* the days are outside J's active window: **NEW job
     (same client)**;
   - disjoint days within 7 days of J's: **UNCERTAIN** (the 45-pair danger zone);
   - J closed and crew requested: **NEW job**;
   - new-engagement language: **NEW job**.
3. **Cross-thread.** Candidates K = the company's *active* jobs as of the message.
   - **Dated message:**
     - K′ = jobs sharing a requested day (or the "from" day of a stated move);
     - K″ = K′ ∩ same venue;
     - one job in K″: **CONTINUE**;
     - two or more in K″: **UNCERTAIN**;
     - K″ empty but K′ not: a known different venue means **NEW (parallel job)**, an unknown venue
       means **UNCERTAIN**;
     - K′ empty: **NEW**.
   - **Undated message:**
     - a crew request while K is non-empty: **UNCERTAIN**;
     - no crew request and exactly one job in K: **UNCERTAIN(probable = J)** (§12);
     - otherwise: not a job, or **UNCERTAIN**.
4. **Never** CONTINUE on company alone, on subject alone, or on temporal proximity alone.

### 9.3 Outcomes

`CONTINUE(J)` · `NEW(existing client)` · `NEW(new client)` · `UNCERTAIN(candidates, probable?, reason)`
· `NOT_A_JOB`. Each is stored with its evidence list and resolver version.

### 9.4 Conflicting evidence

A **veto beats any positive** (a company mismatch voids an R number). **Hard beats strong. Strong
beats weak.** Two strong items pointing at different jobs give **UNCERTAIN**, never "pick the more
recent one".

### 9.5 The order bridge (Ben's flow, with the case the data adds)

For a job with links, on every update:

1. The current order link exists (`GET /orders?id[eq]=`): **target it**. This covers Confirm, which
   keeps the id.
2. Else the current OnSinch-job link exists (`/orders?with=Job&Job__id[eq]=`), meaning it was moved
   under another order: **update the link (source `moved`) and target it**.
3. Else an audit copy link (`order_create_by_copy.originalId` = our order): **link and target**.
4. Else **successor search**, block level: same company, a block on every one of J's days, created
   after our order, not linked to another job. Exactly one, and every block of J pairs one-to-one by
   (day, venue, overlapping window): **link (source `successor`, evidence stored) and target**.
   Otherwise **UNCERTAIN: ORDER_REMOVED_NO_SUCCESSOR / AMBIGUOUS_SUCCESSOR**.
5. **A job that has ever had a link never falls back to create.**

Case 4 is every case so far (47/47 re-typed). No process change is asked of ops (Ben, 2026-09-29), so
the bridge must work from case 4 alone.

## 10. Temporal identity rules

Job status is **derived**, never stored as truth:

| Status | Meaning |
|---|---|
| `enquiry` | no link yet |
| `booked` | a link exists |
| `working` | between the first and last work day |
| `worked` | the last work day has passed |
| `closed` | last work day + **14 days** (covers 178/182 threads [measured]) |
| `cancel-requested` / `cancelled` | the client asked to cancel / ops cancelled |

Rules:

- Active window = [first associated message, last work day + 14d].
- A crew request arriving after `closed` is a **new job** unless a hard reference exists *and* there is
  no new-engagement language. A hard reference to a closed job with new dates is a recurring job citing
  the old one.
- Same company + same venue with days 60+ days apart (17 pairs) means different jobs, unless there is
  a hard reference.
- Days within 7 of an active job's days, with no change language, means **UNCERTAIN**, not a merge.
- All time comparisons use **source time** (the message `Date`), never ingestion time.

## 11. New-job protection

| Case | Decision |
|---|---|
| "Please change the derig to 6 crew" (same thread) | CONTINUE: change language plus thread job |
| "We loved working with you — planning another event next May" | NEW (same client): new-engagement language, disjoint days |
| Same venue, different day, no change language | NEW if outside the active window; UNCERTAIN within 7 days |
| Same client, no date | UNCERTAIN; never attached (the HoH rule is rejected) |
| Recurring annual event | NEW: closed job; a hard ref only cites it |
| Two simultaneous active jobs, message names the day and venue | CONTINUE the one matching both; ambiguous if the venue is unknown |
| Assistant / colleague / new contact at the same company | the party is the company, so the same rules apply; the contact is only weak evidence |
| Reused subject line | weak only; decided on days and venue |
| Old email forwarded into a new enquiry | a forward is a new message; its quoted tail is excluded from facts; the hard ids in the quote do not count |
| Old quote referenced for pricing | hard ref plus new-engagement language plus disjoint days: NEW |
| One message about two events | per-fact attribution (§6): two associations |

## 12. Ambiguity and abstention

`UNCERTAIN` is a first-class association status. When it applies:

- **Kept:** the message, its extracted facts (stored against the *message*), the candidate list,
  evidence, reason code and an optional `probable` job.
- **Not done:** the message is not attached to any job's authoritative history, no state changes and
  nothing is written to OnSinch.
- **Surfaced:** the thread gets a Gmail tag, and that is all (Ben, 2026-09-29: ops rarely open the
  dashboard unless it is urgent). Candidates and evidence go in the thread's notes for whoever opens it.

**Automatic resolution.** The resolver re-runs for the thread when:
- a new message arrives in it;
- a link changes (e.g. a successor is found);
- an ops decision is recorded.

A later hard or strong resolution **backfills** earlier uncertain messages in the same thread that
carry no contradiction. Their facts then fold in, in source-time order.

**Expected load [measured, estimate]:** undated continuation threads showed up on 17 of 23 multi-thread
orders over about 6 weeks, roughly 2-3 a week. Near-date same-client pairs add a few more.

## 13. Canonical job history

History(J) = messages whose *current* association to J is `confirmed`. **Total order**:
`(source_time, ingest_time, message_key)`; source time comes from the RFC `Date` (0 unparseable
[measured, peer]).

Each entry carries:

- message key, thread id, thread label (T1, T2 … by first appearance in J);
- direction (in, out, internal);
- from, to and cc;
- source, ingest and processed times;
- attachments (names and ids);
- association provenance (outcome, evidence, resolver version, who).

Storage order is fixed. Presentation order is chosen per task (§18). With A 10:00, B 12:00, A 14:00,
the sequence is `#1 T1 10:00 · #2 T2 12:00 · #3 T1 14:00` whichever way it is rendered.

## 14. Canonical job state

State(J) = a **pure fold** over the facts of J's confirmed messages in total order, plus OnSinch-read
facts. It is cached with `state_version` = hash of the fact ids folded.

| Group | Fields |
|---|---|
| Party | company_id; contacts (normalised); organisational domain |
| Engagement | venue(s) (place_id + text); PO (`intern_name`); customer reference; summary |
| Blocks | per `block_ref`: day, start, end, place, task/name, crew size, profession(s), TBC flag, removed flag |
| Order | links (order, OnSinch job, block ids per block_ref); last write version; confirm state |
| Lifecycle | derived status (§10); cancellation requested |
| Open items | outstanding asks; conflicts; uncertain associations pointing at J |
| Rate card | engine-derived at create; ops-owned after (§15) |

Every value is `{value, authority, source (message_key \| onsinch:<audit row> \| rule:<name>), quote,
at, supersedes}`.

**Facts are change-sets, not restatements.** The extractor receives the current blocks *with refs* and
returns operations against them (below). A block the message does not mention **is unchanged**. This
closes G2; the test is A1 flipping to MEETS.

| op | meaning |
|---|---|
| `set` | change a field value |
| `clear` | explicitly clear a field (quote required) |
| `add_block` | a new block |
| `remove_block` | remove a block (quote required) |
| `cancel` | the client is cancelling |
| `confirm` | the client confirms a value |

Deterministic validation rejects:
- an unknown ref;
- a quote not found in the message's own (unquoted) text;
- an impossible value (size < 1, times out of range).

## 15. Authority and provenance

| Authority | Source | Can drive an OnSinch write? |
|---|---|---|
| `client_requested` | client email + verbatim quote | yes |
| `client_confirmed` | client confirms a stated value | yes |
| `spartan_stated` | our outbound email states a value | no (it is a record of what we said) |
| `ops_live` | OnSinch holds a value different from our last write; provenance = `common_change` row (who, when, old → new) | n/a: it *is* the live value |
| `engine_default` | a rule filled it (08:00 start, 18:00 finish, chief carve, rate card) | only at create, marked as a default |
| `inferred` | a model value without a quote | **never** |

Precedence per field class:

- **Client-owned** (days, times, sizes, professions, venue, add or remove block): the latest in source
  time among `client_requested` and `ops_live`. A default applies only when nothing else exists.
- **Ops-owned** (rate card, contact, order and block names, chief positions, manager): `ops_live` wins;
  the engine only sets them at create.
- **PO / reference:** the latest of client and ops.

Every current value can answer: what is it, which message or audit row set it, who, what it superseded,
and whether it is confirmed, requested or a default.

## 16. State transitions and supersession

History is the ordered fact list, so any sequence is preserved. For example, 100 → 150 → 100 is three
facts, and the current value is the last. Each transition kind maps to a fact:

| Transition | Fact |
|---|---|
| mutation | `set` |
| proposal | `spartan_stated` |
| confirmation | `confirm` |
| amendment | `set` after a link exists |
| correction | a later `set` citing an earlier one |
| reversal | a `set` to a prior value |
| cancellation | `cancel` (never auto-applied) |
| supersession | the `supersedes` pointer |

This is **event sourcing at the fact level, with a cached snapshot**: facts are immutable, and the
snapshot is disposable and recomputable. Nothing is ever mutated in place.

## 17. Order and amendment integration

- **Projection:** `DesiredOrder = compose(State(J))`, with `compose.ts` unchanged (old schema).
- **Diff:** a three-way comparison per block:
  - `base` = what we last wrote, or the successor's values at bind;
  - `live` = a nested read (`with=Job__SlotTeam__Slot`; **never** the job window);
  - `desired` = the projection.
- **Write only** fields whose latest authority is client-owned and that changed since `base`. If `live`
  ≠ `base` for a field, ops changed it: record `ops_live` and write nothing to it.
- **Routing:**

| Change | Target | Action |
|---|---|---|
| size, time, profession, place or name | single-position block | PATCH /slotTeams |
| size, time, profession, place or name | multi-position block | OPS `NON_ATOMIC_BLOCK` (exact instruction) |
| new block | — | POST /slotTeams into the linked OnSinch job |
| PO | — | PATCH /orders `intern_name` (`specification` does not stick, #15805) |
| remove block / cancel / shrink a staffed block | — | OPS |
| a block to drop on an untouched engine order | — | delete-and-repost (the only destructive path, never on an ops-shaped order) |

- **Verify:** re-read after every write. A match records `base`; a mismatch means OPS `UNVERIFIED_WRITE`.
- **OPS** above means a Gmail tag on the thread carrying the reason code, and nothing else (Ben,
  2026-09-29).
- **A lost `POST /slotTeams` response cannot be recovered from the audit log.** Probed 2026-09-30 on
  company 515: an appended block leaves no audit row at all (UI edits leave `common_create`), so before a
  retry appends, it must re-read the job's blocks through the nested read, or it books the block twice.
  Also probed: `PATCH /slotTeams` treats an omitted field as unchanged and refuses an explicit null;
  `POST /jobs` into an existing order and `PATCH /jobs {order_id}` both work, and the moved job keeps its
  id; `PATCH /jobs` refuses `private_note`.

## 18. Task-specific AI context

One source of truth, several deterministic projections:

| Task | Context |
|---|---|
| **Extract** (every new message) | current State(J) *with refs and authority*; the new message's own text (quoted tail removed); the last 6 messages of History(J), chronological with sequence numbers and thread labels; the messages that set any field the new message mentions (provenance pins) |
| **Resolve** | none (deterministic); candidates plus evidence go in the thread notes, the thread gets a Gmail tag |
| **Create order** | State(J) → compose; no model |
| **Amend** | none after extraction (diff + routing) |
| **Reply** | State(J) summary + order_state + ask_for + the new message + the last 4 messages |
| **Follow-up** | the clock (per thread, since replies go into a thread) + the outstanding ask |

**Presentation order.** Chronological, with global sequence numbers and the newest pinned and marked.
This is what `renderThread` already does per thread, for a measured reason (newest-first invited
"classify only the newest email"). The progression of values is carried by the **state and its
`supersedes` chains**, not by transcript order, so newest-first is not needed.

## 19. Merge, split and reassignment

- **Associations are versioned rows** (`valid_from`, `valid_to`, `decided_by`, `reason`). A correction
  closes one row and opens another; nothing is deleted.
- **Merge A into B:** reassign A's associations to B, set `A.merged_into = B` (a tombstone; every
  lookup of A redirects), move A's links to B with history, and recompute State(B).
- **Split / reassign:** a new job, the named messages reassigned, both states recomputed.
- **Partial thread reassignment** is just message-level reassignment.
- **Downstream repair:** `write_intents` lists every OnSinch write made from the wrong state, with
  `base` snapshots. The recovery report proposes reverting PATCHes; ops approve. Nothing destructive
  happened in the first place, because OnSinch only ever received PATCHes and appends (§17).

## 20. Concurrency and idempotency

| Hazard | Primitive |
|---|---|
| Two messages for one new job in different threads at once | resolution under a **company-scoped lease** (a lease row with expiry; Neon HTTP cannot hold advisory locks across API calls). Volume is small (tens a day), so serialising per company costs nothing |
| Concurrent state update / amendment racing ingestion | **job lease**; the snapshot written with `WHERE state_version = expected` (optimistic check) |
| Duplicate webhook / poll overlap | canonical message key UNIQUE (§7) |
| Worker retry of an OnSinch write | `write_intents` UNIQUE `(job_id, state_version, op_hash)`: status `sent` without `verified` means **read back, never resend**; creates are never retried blind (existing rule) |
| Late older message | facts insert, then refold in source order. An older fact can never override a newer one, and the diff decides writes |
| Classifier or model change | facts are versioned by extractor version; a replay re-extracts only on request (cost-gated, §27) |

## 21. Persistence and schema changes

| Structure | Verdict | Change |
|---|---|---|
| `thread_messages` | **modify** | + `gmail_id`, `rfc_message_id` (UNIQUE when non-null), `in_reply_to TEXT[]`, `references TEXT[]`, `direction`; canonical ids per §3.1 |
| `message_ledger`, `inbound_raw`, `order_archive` | retain | — |
| `conversation_state` | **modify** | stays the per-thread cache (classification, reply hash, follow-up, fast path); job-level fields move to `jobs` and are read through it during migration |
| `order_records` | **migrate → `job_links`** | 347 rows carried with `source` = `created` / `matched` |
| `jobs` | new | `job_id` PK, `company_id`, `created_from_message`, `merged_into`, `state` JSONB snapshot, `state_version`, `lease_holder`, `lease_until` |
| `message_jobs` | new | `message_key`, `job_id` (NULL when uncertain), `status` confirmed/uncertain/rejected, `candidates`, `probable_job`, `evidence` JSONB, `reason`, `resolver_version`, `decided_by`, `valid_from`, `valid_to` |
| `message_facts` | new | `message_key`, `extractor_version`, `facts` JSONB (ops with block refs, quotes, authority), `created_at`; PK (message_key, extractor_version) |
| `job_links` | new (from `order_records`) | `job_id`, `kind` order/job/block, `onsinch_id`, `block_ref`, `source` created/matched/successor/copy/moved/ops, `evidence`, `valid_from`, `valid_to` |
| `write_intents` | new | `job_id`, `state_version`, `op`, `payload`, `op_hash`, `base_snapshot`, `status`, `response`, `verified_at` |
| `company_leases` | new (tiny) | `company_id`, `holder`, `until` |

Each question has an answer:

- *Why does message M belong to J?* the `message_jobs.evidence` row.
- *Why is this field this value?* the snapshot provenance → the fact → the message quote or audit row.
- *What changed it?* the `supersedes` chain.
- *Can it be reversed?* a versioned association plus a refold.

## 22. Failure modes and safeguards

| Failure | Cause | Detect | Prevent | Recover |
|---|---|---|---|---|
| **False merge** | continuity inferred from overlap | gold false-merge metric; ops "not this job"; vetoes logged | no merge on company, subject or proximity alone; contradictions → UNCERTAIN; hard refs company-checked | split (§19), refold, write-intent revert report |
| False split | undated continuation, new contact | shadow "probable" hits later confirmed; duplicate-link check (two jobs, one order) | thread continuity, hard refs, successor links | merge (§19) |
| Duplicate ingestion | two routes, two ids | UNIQUE on both keys | §3.1 + §7 | none needed |
| Stale state | a fact missed or out of order | `state_version` ≠ fold hash | pure fold, recompute on insert | refold |
| Amendment to wrong order | a wrong link or block pairing | verify-after-write; ops audit | link rules §9.5; block pairing by stored ids | intent revert |
| Ambiguous message mutates state | forced decision | invariant test | UNCERTAIN holds facts off the job | resolve, then fold |
| Out-of-order ingestion | late discovery | source ≠ ingest order | fold in source order | automatic |
| Missing emails | intake outage (91 lost 26-27 Aug [carried]) | cursor gaps; intake watchdog | history cursor with overlap (mail-poll) | re-poll window |
| Partial thread | only some messages stored | reply-chain parent unknown | a reply to an unknown parent is weak, not a basis for NEW | backfill fetch |
| Forwarded conversation | quoted history | the forward flag | facts only from the unquoted part | — |
| Reused subject | Gmail groups it | disjoint days in one thread | thread continuity contradiction rule | split |
| Multiple contacts | the party is the company | — | contact is weak only | — |
| Parallel jobs | same company and day | 2+ candidates | venue required; else UNCERTAIN | — |
| Recurring event | same venue, next year | closed status | 14-day tail, new-engagement language | split |
| Races | concurrent workers | lease timeouts logged | company and job leases, optimistic version | refold |
| Retries | a write re-sent | intent status | intent ledger | — |
| Model change | a different extraction | gold replay diff | versioned facts; gate on gold | pin the version |
| AI hallucinates continuity | the model says "same job" | — | **the model never decides identity** | — |
| Inferred value becomes fact | no quote | authority audit | `inferred` never writes | refold without it |
| Bad historical merge or split | a wrong correction | association versions | corrections are rows, not deletes | revert the correction |

## 23. Test suite

Offline, deterministic, **no model calls**: tests feed facts directly, as the current `sim/` does.

| Scenario | Assertion |
|---|---|
| Same job, 3 threads (enquiry, PO undated, change) | one job; the undated thread is UNCERTAIN(probable) until the change message names the day, then backfills |
| Same client, separate jobs (45-pair shape: days 3 apart) | two jobs; never merged |
| Parallel jobs (same day, two venues) | two jobs; a message naming one venue continues that one; a venue-less message is UNCERTAIN |
| Ambiguous | no state change, no write, Gmail tag |
| Amendment in a new thread to a confirmed order | continues via hard R number; the block PATCHed, or a Gmail tag where the block is not atomic |
| Reversion 4 → 6 → 4 | three facts; current 4; supersedes chain intact |
| Duplicate ingestion (Gmail id and RFC id of the same email) | one message row |
| Out-of-order (older message after newer) | the fold equals the in-order fold |
| New contact at the same company | the same job via day+venue |
| Recurring (same venue, +1 year) | a new job even with the old R number quoted |
| Long-running (40 messages, 4 threads) | bounded extraction context; provenance pins present |
| **False-merge traps** | same client, same venue, days within 7, no change language: never CONTINUE |
| **False-split traps** | an undated PO thread from a new contact: UNCERTAIN(probable), not NEW |
| Omitted block | preserved (A1) |
| Explicit removal without a quote | rejected |
| Bridge cases 1-4 and never-recreate | per §9.5, including a re-typed order with no successor giving UNCERTAIN, not a create |
| Races | two concurrent NEW decisions under the company lease give one job |

## 24. Golden / replay dataset

`data/testset/job-identity/`:

- **Frozen facts** per message (`message_facts` at a pinned extractor version), so replay costs
  nothing and is deterministic.
- **Truth** for message → job, job boundaries, current state per job, amendments and superseded values,
  and expected-UNCERTAIN cases.

Seeded from real structure [measured]:

| Seed | Size |
|---|---|
| orders linked from 2+ threads | 23 |
| companies with 2+ threads, including the near-date traps and recurring pairs | 37 (45 traps, 17 recurring) |
| threads linked to 2+ orders | 19 |
| engine → successor pairs | 47 |
| R-number messages | 233 |
| reused subjects | 46 |

Labels are automatic where a hard link exists (order ids, successors). A stratified sample of about
**120 threads** is labelled by Ben or ops. That sample is the gate for any change to intake, the
classifier, prompts, dedupe, order generation or amendment logic.

## 25. Evaluation metrics

Reported separately, never blended:

| Metric | Severity |
|---|---|
| **false-merge rate**, split into (a) any and (b) one that led to an OnSinch write | **S1**: target 0 on gold; any occurrence blocks a release |
| amendment applied to the wrong job or block | S1 |
| false-split rate | S2 |
| abstention rate (with the share later auto-resolved) | S3: a cost, not an error |
| continuation-detection and new-job-detection accuracy | S2 |
| canonical-state field accuracy per field class | S2 |
| provenance accuracy (the value's source message is correct) | S2 |
| amendment content accuracy | S2 |
| duplicate-message rate | S2 |
| replay determinism (two replays give identical state hashes) | S1 |
| recovery correctness (split or merge, then refold equals truth) | S2 |

Each confirmed run goes into `public/data/feed.json` through the session gate.

## 26. Shadow and reconciliation

The resolver runs over all 772 threads in source-time order, as of each message, and writes **only**
to shadow tables or a report. It compares against `conversation_state` / `order_records`. Report:

- agreements;
- disagreements;
- proposed merges (the 23 multi-thread orders are the expected first set);
- proposed splits (the 19 multi-order threads, and the 13 wide threads);
- UNCERTAIN cases with evidence;
- downstream impact: which OnSinch links would move.

**No production association changes until Ben has reviewed the disagreements.**

## 27. Migration

1. **Canonical ids first** (§3.1): this is the restart blocker.
2. Create the tables. Migrate `order_records` → `job_links`.
3. Jobs are backfilled **without new model calls** (the $57 rule). Historical thread `facts` become one
   `migrated` fact set per thread, attributed to its latest client message and marked authority
   `migrated`, so defaults and inferences are not promoted. Only new messages get per-message change-set
   extraction.
4. Jobs = one per linked order; threads sharing an order link merge (hard evidence). Everything else
   is its own job. The shadow's merge proposals go to Ben.
5. **Dual run:** the old path decides; the new resolver and fold run in shadow on live mail; compare
   daily.
6. Switch the read path per stage (§30) behind flags. Rollback = flip the flag. The old tables stay
   untouched until two clean weeks.

## 28. Self-critique

1. **Too many new tables.** The first draft had separate `leases`, `job_aliases` and `fact_events`
   tables. Collapsed: leases → `jobs` columns plus one tiny `company_leases`; aliases →
   `jobs.merged_into`; events → `message_facts`, since the facts are the events.
2. **The first draft treated reply-chain parents as hard evidence.** Wrong: clients reopen old threads
   for new jobs (4 threads run 60+ days past their work). Demoted to strong, and subject to the
   contradiction rules.
3. **PO matching.** The first draft counted "PO" mentions. Measured as footer noise (1,374/2,098). Now
   only an exact PO *value* equal to a recorded one, and only as weak evidence.
4. **Undated continuations.** The first draft auto-attached a message to a client's only active job,
   which is the HoH rule. It breaks the non-negotiable, so now UNCERTAIN(probable) with backfill. Cost:
   about 2-3 cards a week, accepted.
5. **Where AI is trusted.** Extraction only. Its outputs are checked deterministically (quotes are
   substrings of the unquoted text; refs exist). Remaining exposure: a model that misses change language
   produces UNCERTAIN, not a false merge. That is the right direction to fail.
6. **Model change.** Versioned facts plus the gold gate. The historical backfill uses migrated facts, so
   a model change never silently rewrites history.
7. **Brittle signals.** Venue text (mitigated by place ids), relative dates in extraction
   [assumption: the extractor resolves "next Tuesday" against the message date], and the 14-day tail
   (set from 182 threads, to re-measure).
8. **Long histories.** Bounded context by construction (§18). The fold is linear in facts, trivial at
   this volume.
9. **Complexity versus value.** A per-thread-only design was reconsidered and rejected: an amendment
   in thread B needs thread A's blocks. The job layer is required.
10. **Still assumptions:**
    - the successor-search precision on live data;
    - the share of truly multi-job messages;
    - the new-engagement phrase set;
    - whether ops will Confirm instead of re-typing.

## 29. Revised architecture after critique

Sections 4-27 already carry every revision above:

- facts are the event log;
- reply chains count as strong evidence, not hard;
- PO counts only as a weak value match;
- undated messages abstain with a `probable` marker;
- identity is never decided by a model;
- migration makes no model calls.

The architecture in one line: **messages are evidence, associations are decisions with provenance,
facts are immutable change-sets, state is a fold, OnSinch records are links, and uncertainty is a
state.**

## 30. Implementation sequence — everything outstanding on the automation

Each step goes through `scripts/session.py`. Tests come first, then code, then a gold or shadow number
in the feed.

| # | Step | Depends on | Gate / acceptance |
|---|---|---|---|
| 0 | **Canonical message and thread ids in mail-poll** (§3.1) — the other session's route | — | a test: the same email via n8n-shape and poll-shape gives one row and one thread; **blocks restart** |
| 1 | **Injection boundary** (carried 6 handoffs): email content can only become schema-validated facts with verbatim quotes; nothing from an email reaches a write or a tool call except through the fold | — | adversarial fixtures (instructions in the body, fake R numbers, "ignore previous") produce no write; **before restart** |
| 2 | Three unauthed read routes (`/api/jobs`, `/api/metrics`, `/api/onboarding`) | — | `writeRoutesAuthorised`-style discovery test; before restart |
| 3 | Nested OnSinch reader replaces the `/attendance` read; stop using the job window for drift | — | fixtures from real reads; no behaviour change |
| 4 | Store RFC headers; `message_facts` / `message_jobs` / `jobs` / `job_links` tables; migrate `order_records` | 0 | migration dry-run report |
| 5 | Deterministic resolver + gold v0 (auto labels + Ben's 120) + **shadow report** | 3, 4 | false-merge = 0 on gold; Ben reviews the disagreements |
| 6 | Change-set extraction + fold + authority; projection compared against today's `desired_order` in shadow | 5 | A1/A2 MEET; replay determinism |
| 7 | **Bridge** (§9.5) + never-recreate + write routing + `write_intents` + verify-after-write + ops reason codes | 5, 6 | M1/P2 MEET; the 47 successor pairs bind or abstain, **zero creates** |
| 8 | Switch reads to jobs (flagged), dual run for 2 weeks | 7 | shadow parity; S1 metrics 0 |
| 9 | Follow-up label runner (the other session's §3) on canonical thread ids | 0 | fake-writer tests |
| 10 | Venue Task 6: named a venue that matched only retired rows → hold at the placeholder | — | venue gold unchanged |
| 11 | **Restart criteria**: supervised first week, every external write approved, no promotion on a date | 0, 1, 2 (+7 for amendments) | Ben signs off |

No asks of people. The three raised here (a positions API from OnSinch, ops confirming rather than
re-typing, the 315 → 354 rate card) were dropped by Ben on 2026-09-29; the plan does not wait on any.

Rulings of 2026-09-29 that bind the steps above: no sender check on a bind; steps 3-5 run in shadow
only; an update the engine cannot make is a Gmail tag and nothing else; orders ops raised by hand may be
updated; n8n stays the intake.

---

## What happens when a new email enters the engine?

1. **Incoming email.** mail-poll reads it by Gmail history cursor.
2. **Message idempotency.** Its Gmail id or RFC id is looked up. If held, stop. A draft is dropped.
3. **Metadata.** Thread id (bare Gmail), sender, recipients, source time, direction, `In-Reply-To`,
   `References` and attachments are stored before anything else.
4. **Extraction (AI).** The model gets the thread job's current state *with block refs*, the message's
   own text (quoted tail removed) and the pinned provenance messages. It returns change-set facts with
   quotes, date and venue tokens, R-number tokens, change language and new-engagement language. The
   quotes and refs are checked deterministically.
5. **Candidate job discovery.** Under the company lease: hard tokens → `job_links`; the thread job;
   the reply-chain parent's job; the company's active jobs as of the message.
6. **Job identity resolution.** The deterministic procedure (§9.2) gives CONTINUE / NEW / UNCERTAIN /
   NOT_A_JOB, with the evidence stored.
7. **Confidence and abstention.** UNCERTAIN keeps the facts on the message, tags the thread in
   Gmail, and stops. CONTINUE and NEW proceed.
8. **Canonical history.** The association row is written. History(J) now includes the message at its
   source-time position.
9. **Canonical state.** Under the job lease: refold. A new `state_version` is saved with provenance for
   every changed field. Ops changes seen in OnSinch enter as `ops_live` facts from audit rows.
10. **Order and amendment implications.** Projection → compose → bridge (§9.5) → three-way diff →
    routing: PATCH / POST / ops instruction. Each write is recorded in `write_intents`, then read back
    and verified.
11. **Downstream context.** The reply composer, follow-up clock and dashboard read the same job state,
    history and open items through their own projections.

## Non-negotiable invariants

1. A thread id is not a job id, and an OnSinch order id is not a job id.
2. The same client can have many jobs, at the same time and over the years.
3. Duplicate ingestion cannot duplicate canonical history. One email is one message, whatever route
   brought it.
4. An ambiguous association never mutates authoritative state and never writes to OnSinch.
5. Every authoritative value traces to a quoted message or an OnSinch audit row. `inferred` values
   never write.
6. State updates never destroy evidence. Facts and messages are immutable; state is recomputable.
7. Every association is reversible, and a correction is a new row, not an edit.
8. Ordering across threads is deterministic: `(source_time, ingest_time, message_key)`.
9. The model extracts; it never decides identity.
10. A job that has ever had an OnSinch link never falls back to creating a new order.
11. False merges are measured separately, and any false merge that led to a write blocks a release.
