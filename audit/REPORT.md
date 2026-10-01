# Engine audit — how well does it actually work?

Measured 2026-09-29 against the engine at commit **`5ee98e2`** — `app/lib/engine`,
`app/lib/mail`, `app/lib/followup`, `deps.ts` and `stateDb.ts` — run from a dedicated
`git worktree` at that commit so a second session editing the main checkout could not
move the thing being measured. Nothing was written to OnSinch, Gmail, Neon or
OpenRouter: proved, not promised, in `audit/selftest.mts` step 2 by swapping
`globalThis.fetch` for a throw and running a full enquiry through it — zero calls.

> **This report was corrected after its first issue.** The first pass reported 70%. It was
> wrong, in the engine's favour, and the correction is in ENGINE HEALTH below. The audit's
> scripted model returned the `cancellation` flag; the production OpenRouter adapter at
> that commit dropped it. So two cancellation scenarios were scored as passes of a path
> production could not take. Found by the concurrent session, verified here, re-measured
> with the flag stripped at the same seam. The lesson is worth more than the number: a
> stub that is *more faithful than production* is as dangerous as one that is less, and
> the harness self-test could not catch it because the divergence lived between the real
> adapter and the stub rather than inside the harness.

---

## ENGINE HEALTH

**End-to-end success: 64%** — 87 of 135 fully correct runs (45 scenarios × 3 repetitions)
at commit `5ee98e2`, with the model leg behaving as the production adapter actually did.

A run passes only when the final state is right, the intended writes happened, the data
survived, no forbidden side effect occurred and no invariant broke. A run that books the
job correctly and leaves a stale label is not a pass.

| Version and posture | End-to-end |
|---|---:|
| `5ee98e2`, scripted model returns `cancellation` (the first, wrong reading) | 69% |
| **`5ee98e2`, `cancellation` dropped as the real adapter did — the honest figure** | **64%** |
| Working tree after the concurrent session's `admit.ts` + `reason.ts` fix | **71%** |

The third row is not this audit's result; it is the effect of a change made while the
audit ran, measured the same way. It closes three scenarios (A4, A6, X4) and breaks
nothing. Every other finding below is unchanged by it.

| | |
|---|---:|
| Missing information | 100% |
| Normal workflows | 83% |
| Failure recovery | 71% |
| **Ambiguous input** | **67%** |
| Duplicate / replayed event | 50% |
| **Cross-record separation** | **50%** |
| Existing state + new message | 44% |
| Repeatability (deterministic legs) | 100% |
| Invariants held | 99% (1071/1080) |

Ambiguity and cross-record separation were 100% and 67% in the first reading. Both fall
once the model leg behaves as production did: ambiguity because two cancellation
scenarios were passing on the dropped flag, cross-record because the model-echoed-id
scenario (X4) did not exist yet.

Measured separately, because it is a different question with a different method:

| | |
|---|---:|
| Reading real client mail (5 bought runs, 100 real threads) | **78–82%** |
| — the same, with no adjudication allowed | 70–71% |
| — run-to-run consistency of the model leg | classification 96–100%, composed blocks 93–95% |

The two legs are independent failure sources and **must not be multiplied or averaged**.
The 70% measures what the machinery does once it has an interpretation; the 78–82%
measures whether the interpretation was right. A real thread has to survive both.

---

## What happens in each situation

| Situation | Success | What actually happens |
|---|---:|---|
| Normal enquiry, known client and venue | 83% | Books correctly: right crew, right rate card, right building, R and J numbers read back, tagged once. The one failure is cosmetic — the order's name loses its date to an 80-character truncation. |
| Missing information | 100% | Holds rather than guesses, states exactly which field is missing, asks the client for it, labels the thread. The strongest area of the engine. |
| Ambiguous input | 67% | Two same-day orders and no way to choose: refuses, cleanly. A cut from 6 to 2: applies it and says so loudly. An R number naming a different order: rebinds to it. Both failures are cancellations (#0b). |
| Duplicate / replayed event | 50% | No duplicate order was ever created, under any of seven attacks including a 500 after the write landed and a dropped connection. What fails is quieter: a second thread for the same job **binds to the first thread's order** instead of staying unbound. |
| Existing state + new message | 44% | The weakest area by a wide margin, and the failures are all state that does not survive from one email to the next. |
| Retry after failure | 71% | Recovers correctly from a refused create, a lost create response, a failed identifier read, and a rebuild that deleted before it could re-post. Two gaps: a lost `POST /slotTeams` response, and an unguarded venue read that throws the email away. |
| Cross-record separation | 50% | Similar client names, and two live threads for one client, are kept apart cleanly. The failures are a model-echoed venue id overriding the client's own words (#0a) and a re-keyed thread losing its history (#5). |

---

## Biggest weaknesses

Ordered by what they cost, not by how many tests they broke. **#0a and #0b were fixed by
the concurrent session while this audit ran**; they are reported because they were live
at the audited commit and because what they show about the system outlasts the fix.

### 0a. An id the model invented outranks the venue the client named

**Problem** → Nothing validated model output against the extraction schema. The live
model emits `requests[].place_id` and `requests[].profession_id`, which the schema never
asks for (80 and 21 occurrences in stored facts, measured by the concurrent session), and
`compile()` uses a per-block id wherever it has one of its own.

**Effect** → Measured at `5ee98e2`: an enquiry that names ExCeL in its own words, with
the model echoing Olympia's id, **books the crew at Olympia**. The same run turned all six
crew into Crew Chiefs on an echoed `profession_id: 36`. Order status `ordered`, no note,
no flag, nobody told.

**Impact** → The worst silent wrong result in the audit: crew dispatched to the wrong
address on a booking that reports success. **Closed** by `app/lib/engine/admit.ts`.

### 0b. A cancellation was read as an ordinary update

**Problem** → `reason.ts`'s combined adapters hand-picked the fields they returned and
`cancellation` was not among them, so the flag reached `compile()` only through the
two-call fallback production never takes. Evidence: 0 of 749 stored conversation states
carry `cancellation: true`.

**Effect** → Worse than the hold merely failing to fire. Measured at `5ee98e2`: "we need
to cancel the 12th" produced a **`PATCH` to the live order, an "Order Updated" tag in the
mailbox, `needs_human: false`, and no note** — the thread reads as a successful update of
a job the client has just called off. The booking survived only because that message
happened to restate the same blocks; nothing in the code protected it. A message that
cancels outright is instead absorbed silently, because `mergeFacts` refuses to blank the
blocks already established.

**Impact** → High. **Closed** in the same change.

**What both have in common, and it is the finding that outlasts them**: the model's answer
was trusted as if the engine had derived it. Everything downstream — resolvers, compose,
validate, the write path — is careful, and all of that care sat behind an unguarded door.

### 1. A follow-up that changes nothing destroys the booking and re-posts it

**Problem** → An order whose venue was created on write stores `place_id: 0` in
`last_ordered_teams`, because the real id is only minted later inside
`createOrderWithPlace`. The next message recomposes with the now-resolved id, the
slot-team fingerprint differs, `teamsChanged` is true, and the engine concludes the crew
changed.

**Effect** → `tryReplace` deletes the live order and posts a new one. The R number the
client has been quoted moves, the old order is archived, and the thread records
"crew/time change applied" for a change nobody made.

**Frequency** → Fires when the venue was provisioned **and** the later message is
classified `update`. Measured directly: with a known venue it never fires; with a
created venue or the "No Location" placeholder, a PO-only update rebuilds every time.
Venue provisioning happens on **9–10 of every 39–40 composed orders (~24%)** across all
five bought runs, and **70% of real threads carry more than one message** (447/638).

**Impact** → High. Ops lose the R number mid-conversation, and the engine reports a
successful amendment for a no-op. This is the most expensive single defect found.

**Root cause** → The fingerprint is taken from the composed order, before the write path
back-fills the provisioned place id, so the stored record can never match the next
composition. `executeOrder`, create branch.

### 2. `compile()` drops six state fields, and the Gmail labels lie because of it

**Problem** → The `state` object `compile()` returns lists its fields explicitly and does
not carry `built_flagged`, `manual_flagged`, `needs_label`, `updated_flagged`,
`reconcile` or `pending_order` from `prior`. `NeonStateStore.put` writes
`state = EXCLUDED.state`, so they are gone on every inbound email. This is the same
shape as the `last_ordered_teams` bug already recorded as handoff finding 1, five fields
further on.

**Effect**, all three observed in the harness:
- "Order Built" is re-posted on **every** message in a booked thread.
- The **cleared** transition can never fire, because `already` is never true. A thread
  whose order is deleted in OnSinch keeps the tag for ever — which `types.ts` names as
  the one thing that tag must never say.
- The reconciliation give-up counter resets. Measured: three sweeps counted 3 attempts;
  one ordinary email put it back to 1.

**Frequency** → Every bound thread that receives another message. In the 638-thread test
set that is **173 threads, 27% of all traffic**.

**Impact** → High and cumulative. The mailbox is where ops work, and a label that cannot
be taken off decays into noise. The reset counter means the "stop after three attempts"
ceiling is indefinitely deferred on any active conversation.

**Root cause** → An explicit field list that has to be edited by hand to stay complete.

### 3. Nothing can see a crew change that did not land on an order the engine did not raise

**Problem** → Per-block reconciliation needs `last_ordered_team_ids`, and there are two
ways to have none. For a **staff-raised** order the engine never had them. For an
**engine-raised** order `createOrderWithPlace` returns `team_ids: []` unconditionally —
the documented price of nesting the crew in the create.

**Effect** → `driftAgainst` reports no per-block drift at all, so the sweep answers
`holds` on an order whose crew is demonstrably wrong. Measured: a thread asking for 9
crew, an order holding 6, every write silently discarded — the sweep said `holds`. The
inbound path *did* tell a person at the time, so the booking is not silently lost; but
the sweep's own health tally counts that order as correct.

**Frequency** → Every order without stored block ids. Per the repo's own 2026-09-14
measurement, **28 of 37 live bound orders are staff-raised**, and every engine-raised
order joins them.

**Impact** → Medium, and it is a measurement-integrity failure rather than a booking
failure: `holds` is not evidence the order is right, and the sweep tally should not be
read as if it were.

**Root cause** → `createOrderWithPlace` returns an empty `team_ids`, and the audit log
holds nothing for an API-created order.

### 4. A crew block can be booked twice when a `POST /slotTeams` response is lost

**Problem** → `onCreated` — the callback that persists an appended block's id before the
next one is sent — only runs after `createSlotTeam` returns. A POST that lands and whose
response is lost records nothing, so `order_amend.created_ids` stays empty and the retry
appends the block again.

**Effect** → Measured: an order asked to hold 8 crew ended with **9**, in three blocks
instead of two, and the thread reported `ordered` with the note "crew/time change applied
in place — 1 block(s) corrected, 1 added". Real crew, real cost, no signal.

**Frequency** → Requires a dropped response on exactly that call, on an amendment that
appends. Rare. **Conditional on one unprobed fact**: if a standalone `POST /slotTeams`
leaves a `common_create` audit row, the retry finds the block and does not duplicate it —
re-run with `auditsAppendedBlocks: true` and the duplicate disappears. Nobody has probed
this. The measured fact in the repo (`§12`) is about the *order* create, not this call.

**Impact** → High per occurrence — this is the only path found that silently books crew
nobody asked for. **One live read settles it**: append a block to a test order through
`POST /slotTeams` and look for a `common_create` row naming it.

### 5. Two threads can point at the same order

**Problem** → `matchExistingOrder` binds a second thread to an existing order on client +
date + venue. The cross-thread twin check then holds the *write* — but the binding has
already been made, and `handleThread` returns before `ensureOrderRecord` is reached.

**Effect** → Both `conversation_state` rows claim the order. `order_records` correctly
refuses to move the durable row, so the two stores then disagree about who owns the
booking. Either thread's next amendment acts on it; the sweep processes it twice.

**Frequency** → Every cross-thread twin, and every conversation that acquires a second
thread id. Observed in three separate scenarios from one cause.

**Impact** → Medium. It prevents the worse failure (there is still exactly one order),
but ownership becomes unanswerable.

### 6. An unreadable venue list throws the email away

**Problem** → `resolvePlace` calls `onsinch.allPlaces()` with no `try`. Every other
optional read in `compile()` is guarded, and `sweep.ts` guards this exact call.

**Effect** → `handleThread` throws, nothing is persisted, and the thread has no row at
all. Not "held", not "errored" — absent.

**Frequency** → Whenever the places pull fails. It is a 68-page paginated read with a
12-second per-request timeout.

**Impact** → High when it happens, because the n8n intake strips the Gmail label before
the engine is reached: the email is gone.

### 7. A booked thread reads as `drafted` after an acknowledgement

`compile()` derives `status` from the local `desired`, which is null on any message that
composes no order. A "thanks, see you Tuesday" on a live booking writes
`status: "drafted"` over `status: "ordered"`. The order is untouched; the board is wrong.
Same exposure as #2 — 27% of threads.

### 8. `needs_human` is true on 100% of orders, so it carries no information

One of the four conditions setting `review_flag` is `user_id === PLACEHOLDER_CONTACT_ID`,
and `resolveContact` has been a constant returning exactly that since 2026-08-26.
Confirmed on real data: `needs_human` is true on **40/40, 40/40, 40/40, 39/39 and 40/40**
composed orders across the five bought runs. `review_only` keeps the Gmail label honest,
so nothing breaks — but as a board signal the flag is saturated.

### 9. The follow-up labeller has no caller

`decide()` in `app/lib/followup/clock.ts:248` is invoked only from
`test/followupClock.ts`. No production code calls it and no follow-up label is ever
applied. The dashboard card is live; the labeller is written, tested and inert.

### 10. Two small ones

- **The order name loses its date.** `orderTitle` slices the finished string at 80
  characters, so a London address pushes the date off the end —
  `"RedBeast Energy — 6 crew at ExCeL London, Royal Victoria Dock, 1 Western Gateway"`.
  `jobNameFrom` solves exactly this by capping the *venue* instead; the sibling function
  never got the fix.
- **The idempotency key disagrees with the message `compile` acts on.** `handleThread`
  keys on `selectLatest(raw)`; `compile` writes `last_message_id` from the normalized
  list. Where they differ the fast path can never hit and the thread pays for the model
  on every sweep for ever. Measured on 638 real threads: **3 of them, 0.5%**, all the
  forward-recovery case. Real, cheap, and much rarer than it looks.

---

## What did NOT fail, and is worth knowing

These were attacked and held, so they should not be re-litigated:

- **No duplicate order was created under any attack.** Seven scenarios, including a 500
  returned after the write had already landed, a dropped connection after the same, an
  identical thread replayed, a thread re-keyed mid-conversation, and a confirm clicked
  twice. `findLostCreate` adopts rather than re-posts, every time.
- **Missing information is handled perfectly** — 25/25 runs. It holds, names the missing
  field, asks the client for it, and never guesses.
- **Choosing between candidate orders is handled perfectly.** Two same-day orders and no
  way to tell which: it refuses, changes nothing, and says why. An R number naming a
  different order rebinds to it. A cut from 6 to 2 is applied and remarked on. (The
  ambiguity class scores 67% only because of the two cancellation scenarios above.)
- **The reconciliation ceiling works.** A `PATCH` that answers 204 and applies nothing is
  detected, re-asserted three times, then given up on with the thread marked for a person
  — provided no email arrives to reset the counter (#2).
- **A rebuild that deletes and then fails to post recovers.** The snapshot is kept, the
  thread says `URGENT`, and the retry re-posts without deleting again.
- **Blocks at two venues stay at two venues**, and a client with a near-identical name
  never received another's order.

---

## Highest-impact improvements

Ranked by failure removed per unit of change. **None of these were made; this pass
measured only.**

0. **Keep the admission boundary** (#0a, #0b). Already done. What to preserve is the
   shape: one place where a model answer stops being trusted, rather than a check at each
   use. Both defects it closed were invisible to a green suite for months.
1. **Fingerprint the order as written, not as composed** (#1). Take
   `last_ordered_teams_hash` / `last_ordered_teams` from the shape after
   `createOrderWithPlace` has back-filled the provisioned ids, or exclude `place_id` from
   the team fingerprint. Removes the single most expensive defect, and roughly one in six
   bookings stops losing its R number to a harmless follow-up.
2. **Make `compile()` carry prior state by construction** (#2, #7). Spread `prior` and
   override, as the triage and machine-mail early returns already do, instead of listing
   fields. Fixes three observed failures and closes the class — this is the second time
   the same bug has been found in the same object.
3. **Probe whether `POST /slotTeams` writes an audit row** (#4). One read. It either
   closes a silent double-booking path or promotes it to a real one needing a fix.
4. **Guard `allPlaces()` in `resolvePlace`** (#6). Three lines, and it stops an outage
   deleting an enquiry.
5. **Decide what `needs_human` is for** (#8). Either drop the placeholder-contact
   condition or retire the flag as a board signal. Today it is a constant.

---

## Coverage

Concrete, not a percentage of the codebase.

- **Critical workflows: 11 of 12 exercised.** Create; update-in-place; delete-and-repost
  rebuild; reconciliation sweep; dashboard confirm; cross-thread hold; cancellation hold;
  venue and company provisioning; reply drafting; the four Gmail labels; triage and
  machine-mail filtering. Not exercised: the follow-up labeller — because it has no
  caller (#9).
- **Integration boundaries: 5 of 6.** OnSinch was exercised in full through a fake tenant
  at the `Transport` seam, so `OnsinchClient`, `createOrderWithPlace`, `amendOrderInPlace`
  and `replaceProvisionalOrder` all ran as production code. The Gmail draft webhook, the
  n8n tag webhook and Neon were exercised at their contracts through recorders. OpenRouter
  was **not** exercised — that leg is measured on the bought runs instead.
- **Invariants: 8 defined, 8 exercised, and each one proved capable of firing** in
  `audit/selftest.mts` step 5. A green invariant that cannot go red is not evidence.
- **Scenario classes: 7.** Scenarios: 45. Executions: 135 per posture, 405 in all across
  the three postures in ENGINE HEALTH. Repetitions: 3 each.
- **Nondeterministic runs re-analysed: 5** bought runs of 100 real threads (`before` and
  `seeded-2026-09-16` are byte-identical — a resume artefact, counted once).

## Exclusions

- **The language model.** The scenario suite scripts it deliberately, so nothing here is
  a statement about classification or extraction accuracy on real prose. That is the
  78–82% figure, measured elsewhere and re-derived here from the stored rows.
- **Production data.** No live OnSinch, Gmail, Neon or OpenRouter call was made. The fake
  tenant is faithful to the probes recorded in `onsinch.ts` and `reconcile.ts`, but a body
  it accepts is not proof the real tenant would.
- **The Order → Job bridge and amendments** were treated as a concurrent-work zone: read
  in full to understand contracts, never modified. `amendOrder.ts` and `replaceOrder.ts`
  were executed as production code inside the harness; nothing was changed in them.
- **`mail-poll` / `mail-inbound` / `threadMessagesDb`** changed under another session
  during this audit (`fad7c0f`, `8acf372`). They are outside the engine source hash, so
  no number here depends on them. The thread-id findings (#5, D8) were measured against
  the pre-change behaviour and may already be addressed.
- **The follow-up board and suppression store** were not scenario-tested; they are read
  surfaces covered by the repo's own suite.
- **One fact is unknown and changes a severity**: whether `POST /slotTeams` leaves an
  audit row (#4).

## Confidence

**High** for the deterministic findings. Every one was reproduced 5 times identically,
the harness was attacked before the numbers were believed (a tenant that books half the
crew, one that files the order under the wrong client, one that drops the rate card — all
three turned the suite red), and each finding was traced to a named line rather than
inferred from a symptom. Two expectations of my own were wrong and were corrected before
reporting: `matchExistingOrder` binding a re-keyed thread, and a mismatch between the
thread and OnSinch being a defect only when it is *silent*.

**Medium** for the 70% headline as a predictor of live behaviour. The denominator is 44
scenarios I chose, not a sample of real traffic, and it is deliberately weighted toward
hard cases. It is the right number for comparing this build against the next one; it is
not a claim that 30% of real bookings go wrong.

**Medium** for #4, which hinges on one unprobed API behaviour, and for D8, whose exact
outcome depends on what the real model calls a bare "can you make it 8" — though the
change fails to reach the order either way.

**Lower than it was** for the method's ability to catch a *stub that is kinder than
production*. That is how the first 70% was wrong, and the self-test could not see it: the
self-test checks the harness against itself, and this divergence lived between the harness
and a real adapter. The general guard is to diff the stub's returned fields against the
production adapter's — now a known gap rather than an unknown one. Any scenario class that
leans on a model-supplied field should be read with that in mind.

Frequencies quoted from the corpus (24% provisioned venues, 27% bound multi-message
threads, 0.5% key divergence, 100% `needs_human`) are counts over real stored data, not
estimates.

---

## Artifacts

| File | What it is |
|---|---|
| `audit/tenant.mts` | The fake OnSinch tenant: mutable rows, fault injection, a call log. |
| `audit/harness.mts` | Production wiring over that tenant, a scripted model, and recorders for every side effect. |
| `audit/scenarios.mts` | 44 scenarios and the 8 global invariants. |
| `audit/run.mts` | The runner. `--reps`, `--only`, `--verbose`. Pins the engine source hash. |
| `audit/selftest.mts` | Attacks the harness. Run this before believing the runner. |
| `audit/keydrift.mts` | Measures the idempotency-key divergence on 638 real threads. |
| `audit/out/results.json` | Every run, every failed check, enough to recompute the metrics. |
| `C:\Users\thera\spartan-audit-baseline` | A `git worktree --detach 5ee98e2` with `node_modules` junctioned from the main checkout. This is how the audited version was held still while another session edited the repo. Remove with `git worktree remove`. |

```
npx tsx audit/selftest.mts                            # free, seconds, run first
npx tsx audit/run.mts --reps=3                        # the model leg as it behaves now
npx tsx audit/run.mts --reps=3 --strip-cancellation   # as the 5ee98e2 adapter behaved
npx tsx audit/keydrift.mts
```
