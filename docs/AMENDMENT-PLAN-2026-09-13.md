# Amendments — the build

2026-09-13. Supersedes `SUCCESSOR-AND-AMENDMENT-PLAN-2026-09-07.md`, which drew three
conclusions from broken queries. Every figure here names the command that produced it, and
the ones that came from an experiment say so.

**Standing constraint, Ben 2026-09-13: this automation is agentic and standalone. No step in
it may require a person.** A Gmail label is a terminal signal when an order genuinely cannot
be reached — never a checkpoint, never a verification step, never a queue for someone to work.

**THE FOUR LABELS, Ben 2026-09-14. These are the only labels this system may ever produce.**

| label | when |
|---|---|
| `Order Built` | an order was created |
| `Order Updated` | an existing order was changed |
| `Order Needs Built` | it is a job, no order exists, and one could not be created |
| `Order Needs Updated` | it is a job, an order exists, and the change could not be applied |

Which of the two failure labels applies is decided by whether the thread holds an order id;
`cannotBeBooked()` already decides that a failure happened at all.

`Order Built` and `Order Updated` exist already (`Label_2`, `Label_3`). The two failure labels
are made by RENAMING the staff labels that already carry those meanings — `Add job on onsinch`
-> `Order Needs Built`, `Update on Onsinch` -> `Order Needs Updated` — so every thread already
wearing one keeps it and ops and the engine end up on one vocabulary.

**`Manual` is deleted.** It is the old undifferentiated failure tag and it is what the two
`Needs` labels replace. Deleting a Gmail label strips it from every thread irreversibly, so the
threads carrying it are written to disk first.

**Scope:** an amendment arrives on a thread, possibly months after the order was written, and
lands on the right booking without destroying it.

---

## 1. The shape of it, in one picture

```
enquiry -> engine writes an order -> it lands in Orders to Confirm
                                          |
                    staff CONFIRM it in place (same id, provisional flips)
                            or
                    staff raise their own job and bin ours
                                          |
amendment arrives (per-thread)  OR  24h sweep
                                          |
                          ALWAYS run a fresh check
                                          |
            +-----------------------------+-----------------------------+
            |                                                           |
   our order still exists                                    it is gone
            |                                                           |
   is there also a staff job                          search Confirmed / price
   for this client and day?                           quotes for the converted job
            |                                                           |
       no -> amend ours                                   exact match -> mark our old
       yes -> amend the staff job                         shape in history, pull the job
              (it is the one they work from)              onto the thread, amend it
                                                          no match -> keep sweeping
```

Two different amendment mechanics hang off that, and the split is forced by what the API
will show us:

| the order we end up amending | how we change it | why |
|---|---|---|
| **ours**, still in To Confirm | delete and repost | its block ids are unrecoverable, and it is an unconfirmed draft nobody has worked from |
| **a staff-raised job** | amend in place | its block ids ARE recoverable, and it is a live booking that must not be destroyed |

**That is the whole reason the id problem stops mattering.** We only need in-place amendment
for orders we must not destroy, and those are exactly the orders whose ids we can read.

---

## 2. What is established

### 2.1 The engine cannot amend in place today

`amendOrder.ts` is written and correct. `app/lib/deps.ts:257` hard-codes `team_ids: []`, so
the ids it aims at are never kept. Block ids exist only for orders written **2026-08-25 to
08-28** — 22 of 83 threads, nothing since (`node scripts/amendment-horizon.mjs`).

The stub is not a bug to revert. Commit `bcc7340` (2026-08-28, *"The create carries its crew,
so the order is filed in Orders to Confirm"*):

> "OnSinch files an order into Orders to Confirm at the moment it is created, from the crew it
> was created with, and never revisits that. Blockless at creation means filed nowhere,
> permanently... R10746 and R10748 are the same JP Morgan crew booking, twenty-six minutes
> apart, one from the engine and one typed in again by a person who could not see it."

`happening` cannot rescue a blockless create: it is rejected on create as an Unknown property
and is absent from the PATCH accept-list (`docs/Spartan-Crew-Onsinch-API-Reference.md:128`,
`:144`). **Nesting stays. We do not get our own ids. We do not need them** — see §1.

### 2.2 Block ids for staff-raised orders are recoverable, 78/78

A UI create logs a full audit tree; an API create logs one childless row. The two are
perfectly disjoint — of 6,907 live orders, 6,888 carry `order_create` and **19** carry
`order_created_via_api`.

`client.slotTeamsForOrder` (`app/lib/engine/onsinch.ts:487`) already reads that tree, parses
the path, re-checks the order id and returns blocks in creation order. Measured over all 78
currently-open staff-raised orders: **78/78 yield their SlotTeam ids**, and against an
independent oracle (`/attendance?with=Slot,Order`) **76/76 are complete**.

Residual risk: a block deleted after creation still appears in the tree, because
`common_delete` carries no `path`. Liveness needs a per-id check.

### 2.3 Staff confirm our orders in place — the id survives

Retracted claim: "0 of 85 engine orders were ever confirmed" was a join error. Order-level
audit rows key on `order.number`; create rows key on `order.id`. Matching our ids against a
set of numbers could only return zero.

Matched properly: five engine orders carry `order_confirm_provisional`, three of them solid
because the order is still alive — **#14866/R10712** (Daniel, 08-25), **#15593/R10742**
(Tracy, 09-01), **#15594/R10743** (Tracy, 09-08). `provisional` flips true→false and **the
order id does not change**. So a confirmed order stays findable by the id we already hold.

### 2.4 Confirmation does not end amendability — attendance does

From the live matrix (`npx tsx scripts/verify-amend-live.ts --write`):

```
[D1] provisional=false — now the posture every order is born in
  PASS  amended, not refused
```

The gate is **crew signed on**, not confirmation status. Shrinking a block people are booked
onto remains refused and untested (`scripts/verify-shrink-staffed.ts`).

### 2.5 An API write leaves no audit row — but the state IS readable

Experiment, TEST 515, 2026-09-13, 16:34:43–16:35:14 UTC. The run appended a block, moved a
window at both ends, resized up and down, changed venue/profession/name/description and
rewrote order-level fields. The writes demonstrably landed — the Job window read back exactly.
The audit log recorded **3 rows for the whole run, all `order_created_via_api`**: zero change
rows, zero delete rows.

So `common_change` (203,379 rows) is a UI-edit signal and the engine will never see one for
its own writes. **It is not a verification channel.**

What IS a verification channel (`npx tsx scripts/verify-readback-live.ts`, order 15970):

| field | readable? | via |
|---|---|---|
| block window, job window | **always** | `Job.min_beginning`/`max_end`, `/orders?with=Job` |
| order `specification`, `intern_name` | **always** | `/orders` directly |
| `Slot.size`, `profession_id`, `slotlocation_id`, `name`; `SlotTeam.name`, `description` | **once a seat is staffed** | `/attendance?with=Slot,SlotTeam&Order__id=<id>` |
| anything on an **unstaffed** block except its window | **no** | no endpoint exposes it |

Proved on 15970/block 40914: patched size 3→7, name, place 49→57, profession 1→3;
`/attendance` returned 0 rows before and after because nobody was signed on; the Job window
moved 18:00→23:00 correctly.

Endpoint surface is exhausted. Only `/orders` (expands `Job`, `Attachment`), `/attendance`
(expands `Slot`, `SlotTeam`, `Job`, `Order`, `Worker`, …), `/timelineAudits`, `/users`,
`/workers`, `/professions`, `/places`, `/companies` answer. `/slots`, `/slotTeams`,
`/applicants`, `/shifts` are 404 or 405 in every spelling.

### 2.6 The horizon is long and the amendment window is not yet observable

```
lead time, order written -> job happens (days, n=28)
   median 7   p75 30   p90 199   max 423        <=7d 15   8-30d 6   31-90d 3   over 90d 4
```

A quarter of what we write is for a job more than a month out. Observed amendment lag maxes
at 14 days with none over 30 — **but the engine's first order is 2026-08-06, so a 90-day-late
amendment could not yet have been observed.** That zero bounds the engine's age, not client
behaviour.

### 2.7 The association is a JSON field, and the matched route writes nothing

```
thread->order links in conversation_state JSON: 207
durable rows in order_records:                   21   (all id_source api_response)
linked threads with NO durable row:             194
```

`order_records` already declares `IdSource = "api_response" | "matched" | "manual"` and its own
header records that **90 of 148 ids came from matching** while only the create path writes.
The link matching does write is guarded on `!linkedOrderId`, so it is never re-confirmed.
Nothing purges `conversation_state` today.

---

## 3. The build

### Phase 0 — the test fixture stops lying `[half a day]`

`test/amendmentReachesOnsinch.ts` passes because it mocks `/timelineAudits` so nested blocks
hand back their ids. The live API does not. Fix the mock and eight assertions fail
(`npx tsx test/_amendmentFaithfulAudit.repro.ts`). Do this first so every later phase has a
test that can fail.

### Phase 1 — one durable association

- **1.1** Write an `order_records` row on every route that links an order to a thread:
  `matched` from `matchExistingOrder`, `manual` from scripts. The vocabulary exists; the
  writers do not.
- **1.2** Backfill the 194 orphaned links from `conversation_state`. Backfilled rows get
  `id_source = 'matched'` and `verified_at = null` — never a guessed verification.
- **1.3** `order_records` becomes the authority the amendment path reads. `conversation_state`
  keeps conversation state and stops being the authority for order ids.
- **1.4** Append-only: one immutable row per (thread, order), with the current one flagged. A
  thread that has been reposted three times has three rows. Required because §1 turns
  to-confirm orders into replacements and converted jobs into successors.

**Test:** a thread that acquires its order by matching writes a `matched` row; a second pass
creates no duplicate and never rewrites `thread_id`; the backfill is idempotent.

### Phase 2 — the matcher `[BUILT 2026-09-14]`

**Built.** `matchExistingOrder` in `app/lib/engine/resolve.ts` is the identity rule; the fresh
check and the rebind are in `compiler.ts`; covered by `test/identityRule.ts` and
`test/rebindOnStatedRNumber.ts`; scored by `scripts/score-identity-rule.ts`, which drives the
shipped function rather than a re-implementation of it.

What it does, against what this section asked for:

- **The shape is the key, the R number is a check.** Both built. The number may only narrow
  what the shape rule already accepted, requires exactly one, and "repeat of" is stripped with
  its number so a thread naming only that reads as having named nothing.
- **Venue by place id, never by string.** Built, and the verdict is three-valued rather than
  boolean — `agree` / `differ-id` / `differ-text` / `unreadable` — because collapsing them is
  what moved "PO - Tottenham Hotspur Stadium" onto "@ The Tower Hotel" in the first draft. Only
  `differ-id`, where both sides resolved and resolved differently, is strong enough to refuse a
  sole candidate. `unreadable` never refuses: the engine's own orders are named
  "Light Motif — install crew at Design Museum, 17 Sep" with no `@` at all, so every order we
  raised lands there, and treating that as a disagreement made our own orders lose every
  tiebreak to staff-raised ones by naming accident.
- **Times and crew never refuse.** Built by omission — they are not read.
- **Match on every date the thread asks for, not the earliest.** Added, and it is not cosmetic:
  a stated date change otherwise finds no same-day order and the engine raises a second booking
  beside the real one.
- **Re-check every pass.** Built, but NOT as "re-derive". `compiler.ts` now confirms the bound
  order still exists and leaves it alone if it does — re-deriving a live binding could only
  move it off a settled decision, and Ben's Q3 ruling says do nothing and make the amendment.
  A binding is released only when a **populated** company list omits it AND a direct read of it
  comes back empty: this API answers a bad filter with an empty list, so unbinding on one empty
  read would hand a live booking back to the create path and duplicate it.
- **The one exception to permanence:** a thread naming exactly one R number that is not the one
  it holds, where that number belongs to an order this client holds on a day this thread asks
  for. Without it thread #13841 amends PROMS 54 forever, because PROMS 54 still exists and the
  fresh check keeps it.

**Measured against all 265 live bindings**, re-deriving from scratch:

|                           | agrees | moves | refuses | finds nothing |
| ------------------------- | ------ | ----- | ------- | ------------- |
| thread names one R number | 93.8%  | 6.3%  | 0%      | 0%            |
| thread names none         | 56.8%  | 5.8%  | 36.0%   | 1.4%          |

On the 100 whose order staff have since deleted — the only rows the shipped code re-derives —
42% find a successor, 29% refuse, 29% find nothing.

**The 36% is not an error rate.** It is the rule declining to guess where a client has several
orders on one day and the thread's venue picks out none of them; the old rule bound those
anyway. What changed is the direction of the failure: from a silent wrong bind, which puts crew
on the wrong job, to a refusal, which leaves the thread unbound and blocked so nothing
duplicates and the next sweep tries again.

**The 1% bar is NOT proven and cannot be from this data.** Agreement with an existing binding is
not proof that binding was right. What is established is the sign of each change: two moves are
defects with documentary proof (#13841, and "crew at Big Feastival" moving off "@ Silverstone
Circuit" onto "@ Alex James Farm", which is where the Big Feastival is), and the one provable
regression an earlier draft introduced was found and removed. A real figure needs ground truth
this tenant does not hold. The honest way to get it is to record every bind with its reason and
let ops correct the wrong ones for a month — which is Phase 3's reconciliation loop anyway.

**Known ceiling, and it is ours.** The thread's own `place_id` is sometimes wrong: R10556's
thread says "Royal Horse Guards Hotel" and resolved to Banqueting House; R10657's resolved to
"London". Until that is fixed the venue comparison measures our place-matching errors as much
as identity, which is exactly why only the strong disagreement refuses.

---

Ben's bar. The old rule (company + happening day + `id > ours`) measures **3.0%** false
positives against a 400-order tenant control — **it fails the bar by threefold** and is not
shippable as-is.

**The rule is Ben's identity ruling, 2026-09-13.** A thread is about the same job as an order
when the **client, the date, the venue and the times** agree, each of which may be superseded
by a change the thread states. **Crew size is never part of identity** — it is the most
frequent change, so it can never be evidence that this is a different job. Silence about a
field means that field is unchanged; only a *stated* difference refuses.

- **2.1 The shape is the key, not the R number.** Ben, 2026-09-14: *"Threads will likely NEVER
  directly name an R number, dont expect to find it in an order, though for consistency in code
  we can look for it."* The measurement agrees — only 40 of 238 bound threads name one, and
  those are mostly staff forwards and quote replies, a population that will shrink as the
  engine handles more of the inbox from first contact. So an R number is a **cheap
  confirmation, never a prerequisite**: read it if it is there, and build the rule to score at
  full accuracy on the ~83% of threads where it is not. A matcher whose numbers were measured
  on R-number threads has been measured on the easy cases.
- **2.2 Match on the shape we sent.** Company + happening day + venue + block windows, all held
  in `order_records.shape_sent`. Compare venues by resolving **both** sides through `matchPlace`
  and comparing place ids — never by string (that refused "@ Rosewood Hotel" against "Rosewood
  London, 252 High Holborn").
- **2.3 Times and crew never refuse.** They are instructions, not identity. Numerals alone are
  a time change: "Make that 4x at 1400-2000" against a block of 2 at 1200-1800 is a crew change
  and a time change, neither announced.
- **2.4 Where an R number IS present, use it as a check, not a branch.** Require exactly one,
  exclude "repeat of" phrasing (`"Re: Repeat of R5531"` names an order the thread is
  deliberately not part of), and ignore threads naming three at once. Handled that way the only
  disagreement it raises is the real defect: `#13841`, a thread whose subject says
  *"R10687 ... PROMS 53 @ RAH"* bound to R10688, PROMS 54 @ Various.
- **2.5 Measure before committing, and measure on the hard set.** Ground truth is the 38 known
  cases; the control is 400 orders nobody deleted. Report precision and no-match rate **for
  R-number threads and non-R-number threads separately** — the second number is the one that
  has to clear 1%. Both go in the code comment; a matcher whose error rate is not written down
  gets tuned by feel.
- **2.6 Only an exact match binds.** Ambiguity does not guess and does not escalate: it leaves
  the thread unbound and the next sweep tries again.
- **2.7 Re-check every pass.** `compiler.ts:1297` reads `if (company_id && !linkedOrderId)`, so
  a binding is made once and never revisited — a wrong bind is permanent. Removing that guard
  is Ben's "never skip a fresh check" ruling and is required.
- **2.8** Direction constraint `id > ours` is measured, not assumed: 0 of 81 human orders for
  the same company and day precede ours.

**Known input ceiling, and it is ours not theirs.** The thread's own `place_id` is sometimes
wrong: `R10556`'s thread says "Royal Horse Guards Hotel" and resolved to **Banqueting House**;
`R10657`'s resolved to **"London"**. So a venue disagreement today measures our place-matching
errors as much as identity. Until that is fixed a venue disagreement means *do not bind, retry
next sweep*, not *different job*.

**Test:** the resolver reproduces the 38 matches, refuses the orphans, and the control error
rate is an assertion in the suite rather than a comment.

### Phase 3 — the reconciliation loop `[BUILT 2026-09-14]`

**Built.** `app/lib/engine/reconcile.ts` reads the live shape and diffs it; `sweep.ts` is the
cadence; `pipeline.ts` re-asserts on the inbound path; `app/api/reconcile/route.ts` is the
endpoint. Covered by `test/reconcileLoop.ts` and `test/sweepReconciles.ts`; exercised against
the live tenant by `scripts/sweep-dry-run.ts`, which cannot write — the transport refuses any
non-GET.

**What is readable**, probed live 2026-09-14 (`scripts/probe-live-shape.mjs`):

| | source | when |
| --- | --- | --- |
| job span | `Job.min_beginning` / `max_end` via `?with=Job` | always |
| specification, intern_name | the order row | always |
| per-block size, profession, venue, times, name | `/attendance?with=Slot,SlotTeam&Order__id=` | **staffed blocks only** |

An unstaffed block returns zero rows — order #16005, attendance count 0, nothing back — so a
To Confirm order nobody is on is invisible per-block and the job span is its only witness.

**The sweep asks three questions per thread, in order, and spends no model call.** Everything
it needs is on the state row, so it is safe to run on a cadence without a budget conversation.

1. **Is the order still there?** If an empty answer comes back, the client's own order list
   must come back POPULATED before that counts as deletion — this API answers a bad filter
   with an empty list, and without the control a bad API day would unbind every thread in the
   system and mark every booking lost.
2. **If it is gone, what did it become?** `matchExistingOrder` against the stored facts. The
   dead order's block ids are dropped with the binding — keeping them would let the next
   amendment PATCH the successor's blocks by position, which is how one block's times get
   written onto another.
3. **If it is there, does it hold what the thread asks for?** Drift re-asserts. The same
   unchanged difference four times over becomes the terminal `Order Needs Updated` label and
   stops: re-asserting is right until the write is one OnSinch will never take, and past that
   it costs two reads and a write every sweep while hiding the failure behind a healthy record.

**Two false-positive classes were found by running it live, and both would have been fatal.**
Each would have re-asserted a non-change against most of the tenant, on every sweep, for ever
— the exact runaway the design is built to avoid, arriving through a door the design did not
watch.

- **Timezone.** The engine sends `+01:00` through British Summer Time; OnSinch echoes
  `+00:00`. Compared as text, sliced to the minute, every order in the tenant looked an hour
  adrift — **12 of the first 13 flagged threads**. Instants are now compared, never strings.
- **Rich text.** `specification` goes through a rich-text field, so the summary we sent reads
  back as `<p>… -&gt; UPDATED: …</p>\n`. Compared raw, **8 of the next 9** looked drifted.
  Entities are decoded, then tags stripped, then whitespace collapsed — in that order, because
  decoding after stripping would turn a `&lt;p&gt;` the client typed into a tag and delete
  their words.

**The job span is one-sided evidence**, and this was the third false positive. `min_beginning`
is the minimum across every block on the order, ours and anybody else's, so only one direction
proves anything: a span that ends BEFORE our block ends proves no block runs that late and
ours is not there. A span WIDER than we asked for just means staff extended the order, which is
normal and none of our business.

**Measured against all 267 live bindings**, writing nothing:

```
holds         13     OnSinch holds exactly what the thread asks for
reasserted     5     real drift — 3 are a specification OnSinch holds as "", 2 are span evidence
rebound       10     the order was deleted and the successor was found
lost           6     deleted, and nothing replaced it
skipped      233
```

Spot-checked against live: #15924's specification really is empty while the thread holds a full
summary; #15574 and #15703 really are gone, and #15805 and #15710 really are live orders for
the same client on the date those threads ask for.

**THE FINDING THAT MATTERS MORE THAN THE LOOP: 171 of 267 bound threads carry no desired
shape.** They know which order they belong to and have never recorded what they want it to be,
so nothing can be reconciled towards anything. They are not stale — the oldest was updated
2026-07-30, the newest today, and 103 of them in the last fourteen days. Their status is
`drafted` (145) or `needs-info` (24), which is the signature of the `matchExistingOrder` path:
a thread binds to an order that already exists and never composes a shape of its own. Until
that is closed the loop covers 96 threads out of 267. **This is Phase 4's first job, not a
footnote.**

---

### Phase 4 — applying the change `[BUILT 2026-09-14]`

**Built.** The custody gate is in `replaceOrder.ts`; the staff-raised amendment and
`pairBlocks` are in `amendOrder.ts`; `reconcileTarget` is in `sweep.ts`; the compiler no
longer discards the desired shape. Covered by `test/amendStaffRaisedOrder.ts` and the updated
`test/replaceOrder.ts`; measured by `scripts/amendability-dry-run.ts` and
`scripts/why-unpairable.ts`, neither of which can write.

**4.1 Our own to-confirm order:** unchanged — delete and repost. It is an unconfirmed draft
and the new R number is the accepted cost.

**4.3 A staff-raised order is never destroyed.** `weCreatedIt` was passed to
`replaceProvisionalOrder` and ignored; now it refuses. This reverses Ben's ruling of
2026-08-18 and the reversal is not a change of mind, it is a change of what the alternative
costs: on that date the only way to change a crew block was to destroy the order and post it
again, so refusing to destroy meant refusing to amend. That is no longer the trade — see 4.2.
Measured 2026-09-14: **28 of 37 live bound orders were raised by staff**, so this was the
common path, and every one of them would have come back under an R number ops had already
quoted from.

**4.2 A staff-raised order is amended in place.** `amendOrderInPlace` needed `previous` — the
block array this engine last wrote — to know which live block is which, and an inherited order
has none, so it declined. It now recovers the ids from the audit tree, the shapes from
attendance, and pairs the thread's blocks to the order's with `pairBlocks`.

**The pairing key is the day and the profession.** Not the venue, and that took a positive
control to establish: `Slot.slotlocation_id` reads exactly like the `place_id` the engine sets
and is not one. Thread place 621 is "Westfield Stratford City" and 236 is "Syon Park", while
the slotlocation ids on those same blocks are 16610 and 16578, and `GET /places?id[eq]=` finds
neither. There is no `/slotLocations` endpoint in any spelling (404). A key including the venue
matched **nothing** — it declined every multi-block staff-raised order in the tenant.

The profession carries the discrimination the venue was expected to, and is the better key
anyway: within one order a block is the work it is for, and the crew-chief rule carves a block
of 4 into 3 crew plus 1 chief which nothing else tells apart. A chief block stays a chief
block, where the size and the times are precisely what an amendment CHANGES. What it gives up
is that a block moving building on the same day in the same role is paired rather than refused
— the patch then sets the venue the thread asked for, so the cost is a venue move applied
without separate verification, not crew sent to the wrong address.

`pairBlocks` declines rather than guessing: two blocks in the same role on one day, a block
whose shape cannot be read when there is more than one, or an append beside a block this thread
cannot account for (which would double the crew on a 201).

**A third instance of the same bug class.** The venue was the third pair of identifiers in two
days that look alike and are not — after timezone offsets (`+01:00` against `+00:00`) and the
rich-text `specification` (`<p>… -&gt; …</p>` against plain text). `sameMoment` is now exported
from `reconcile.ts` because the time comparison had already been got wrong in two separate
files.

**4.4 Shrinking a staffed block stays refused**, unchanged, and the guard now works on both
routes: the block's current size comes from the array we wrote where there is one, and from the
live read otherwise. An unreadable size only happens when nobody is signed on, and an empty
block cannot be un-booking anybody, so that case resizes rather than refusing.

---

**THE DESIRED SHAPE WAS BEING THROWN AWAY, and this was the real cause of the Phase 3 finding.**
`compiler.ts` read `desired_order: desired`, which overwrites with null every time compile
produces no order — and most messages in a booked thread produce no order. A PO arriving, a
"thanks, see you Tuesday", an out-of-office: each one wiped the record of what the thread had
asked for, while `last_ordered_teams` two lines below was explicitly carried forward, so the row
half-remembered its own booking.

Measured: **171 of 267 threads holding an order had `desired_order: null` with a full block set
still sitting in `last_ordered_teams`.** Two things read that field and both were quietly
disabled on 64% of live bookings — `assessAmendment`, which decides whether a change may be
applied at all, and the reconciliation sweep, which has nothing to reconcile towards without it.

Fixed at source (the field is carried forward unless the thread is a cancellation, which must
never re-assert a job the client has called off), and `reconcileTarget` falls back to
`last_ordered_teams` for the rows already written that way.

---

**Measured, writing nothing** (`npx tsx scripts/amendability-dry-run.ts 120`):

```
no recorded shape             32
order gone / unreadable       65
we raised it (rebuild path)    9
STAFF raised it               14
   can be amended in place     9     was 4 before the key changed
   cannot be paired            5
```

All five remaining refusals are one shape, and it is a hard limit of this API rather than a gap
here: a multi-block order nobody is signed on to. Attendance returns no rows for an unstaffed
block, and the audit tree carries only the block's id, name and a created-count — probed
2026-09-14 on order #16004, whose SlotTeam rows hold `{id, name, model, created, data.path}` and
nothing else. There is no day, no venue, no size, so nothing can say which block is which.

The sweep after these changes: 17 hold, 5 re-assert, 19 rebind to a successor, 15 lost,
211 skipped — of 267.

---

### Phase 5 — long-horizon durability `[BUILT 2026-09-14]`

**5.1 A future job never ages out — now a decision, not an omission.** Written into
`alreadyHappened()` in `sweep.ts`, which is where a retention sweep would otherwise be added.
The job's date is the only thing that retires a thread; message age never is. Measured lead
time from order to job: median 7 days, p75 30, **p90 199, max 423** — so a retention rule keyed
on message age would drop a quarter of live bookings, and precisely the ones nobody is emailing
about, which are the only ones the sweep is watching. A thread goes quiet because the booking is
settled, not because it is finished.

**5.2 Re-resolve before amending — verified, already true on all four paths.** `compiler.ts`
confirms the bound order exists every pass (releasing it only when a POPULATED company list
omits it AND a direct read comes back empty); `reconcileThread` opens with `readLiveShape`;
`amendOrderInPlace` and `replaceProvisionalOrder` both call `preflightOrder`. Nothing to build.

**5.3 The amendment horizon is recorded.** `logAction` (`pipeline.ts`) stamps
`days_after_create` on every amendment and rebuild as it happens; `scripts/amendment-arrival.ts`
prints the distribution. Covered by `test/amendmentArrivalRecorded.ts`.

One helper rather than nine call sites, because nine call sites is nine chances for the tenth to
forget — and a horizon measured from a log missing its longest intervals reads LOW, which is the
direction that answers "within 30 days?" with a yes it has not earned.

Four rules, each of which would otherwise bias the answer towards same-day:

- **No origin, no interval — never a zero.** An order matched out of OnSinch history was raised
  before this engine saw the thread, and 28 of 37 live bound orders are exactly that. Zeroes
  there would put the largest population in the sample at same-day.
- **A failed create is not an origin.** It raised no order to measure from.
- **A rebuild keeps measuring from the original booking.** Delete-and-repost logs `replace`, not
  a second `create`, so the clock runs from the order the client thinks they placed. Inverted,
  a thread amended monthly would report every interval as ~30 days and the tail would vanish.
- **A change logged before the create records nothing**, not a negative.

**Current reading: 6 successful amendments and rebuilds across 601 threads, and NONE with an
interval yet** — the stamp shipped today. That is the expected state and the script says so
rather than printing a zero. The number worth noticing is the 6: this engine has changed a
standing order six times in its life.

**The maximum this will ever print is a floor.** It cannot exceed the engine's own age, so it
says what has been observed and not what clients do. Re-run in sixty days; treat it as settled
only once it stops rising.

---

### The four labels — the code half `[BUILT 2026-09-14]`

Ben, 2026-09-13: four labels, and only four. The single `Manual` tag is retired in code;
`flagManualIfNeeded` now posts `Order Needs Built` when the thread holds no order and
`Order Needs Updated` when it holds one that will not take the client's change — the more
dangerous of the two and the easier to miss, because the board shows an order and it all looks
done. No reference to `Manual` remains anywhere in `app/`.

Two things had to be got right and both are pinned by `test/manualTag.ts`:

- **The row remembers which label it wears** (`needs_label`). Deriving it at clear time would
  take `Order Needs Updated` off a thread that wore `Order Needs Built`, leaving the old label
  standing on a booked thread — a label claiming work is outstanding when it is done, which is
  the one thing a label must never say.
- **A thread that changes which KIND of failure it is swaps labels**: the wrong one comes off
  before the right one goes on, or it ends up wearing both and reads as two outstanding jobs.

`state` on the wire is unchanged (`"manual" | "cleared"`), deliberately: the n8n tag workflow
switches on that string and cannot be inspected while the Gmail credential is down, so renaming
it would be a guess at somebody else's contract. Only the label moved.

**The Gmail half is still blocked on Ben** — the two renames and deleting `Manual` need the
credential reconnected.

---

## 4. Open — and they block specific phases, not the whole build

1. **Which set is "Orders to Confirm"?** Blocks Phase 2's search target. The API cannot settle
   it: reading A is `status=0 AND provisional=1` (57 orders, median 14 days, none ever
   confirmed, exit action literally named `order_confirm_provisional`); reading B is what Ben
   measured on 08-25, that provisional orders never appear and the flags-omitted default is the
   To Confirm posture. **Ben: does `#15882`/R10899 (status 0, provisional=1, never confirmed)
   appear in Orders to Confirm, and does `#15874`/R10892 (status 0, confirmed 09-08)?**
2. **Both exist — ours and a staff job.** Recommendation: amend the staff job, mark ours in
   history. It is the one ops work from, and amending both is the R10746/R10748 double-booking.
   Blocks Phase 4 only.
3. **Shrinking a staffed block.** Blocks 4.4 only.

---

## 5. Traps, all paid for once already

**This API answers an unsupported filter with an empty list, not an error.** Prove every filter
with a positive control before believing a count.

- `quote[eq]=true` and `provisional[eq]=true` return the **false** set — the string coerces to 0.
  Only `1`/`0` work. A bogus filter name returns a 400 listing every allowed field: a free oracle.
- `created[gte]=2026-09-01 00:00:00` (space) matches nothing; the API wants `T`.
- **Lifecycle audit rows key on `order.number`; create rows key on `order.id`.** Mixing them
  matches 57% by coincidence of two overlapping integer ranges and produces plausible garbage.
- **Order numbers are reused after a deletion** — #15573's R10726 now belongs to #15574. Never
  join a dead order by number.
- `data[like]=%Order:<id>/%` matches nothing: backslash is LIKE's escape character and paths are
  stored escaped. Use `%Order:<id>%` and filter on the parsed path.
- `%Order:1587%` prefix-collides with 15870–15878. Re-check every row against the id.
- `request_approval` is not a filter field at all (400).
- Status: **0 = open, −1 = cancelled, −2 = finished.**
  `docs/Spartan-Crew-Onsinch-API-Reference.md:324` says −2 is cancelled and is wrong.
- An order may carry more than one SlotTeam — #15769 has four. A rule assuming one drops crew.

## 6. State of the tree

Nothing is built. Head `bc07e56`. Two live writes have been made, both on TEST company 515,
both cleaned up: orders 15967–15969 (amend matrix) and 15970 (read-back protocol).

```
scripts/verify-readback-live.ts        NEW — note it, change it, find it again
scripts/amendment-horizon.mjs          NEW — lead time, capability, association
scripts/audit-vocabulary.mjs           NEW — the tenant's audit vocabulary
scripts/change-and-copy.mjs            NEW — what common_change carries
scripts/successor-by-audit.mjs         NEW — copy links, confirmations
scripts/who-deleted-it.mjs             NEW — the 49 human deletions
scripts/is-it-really-gone.mjs          NEW — the absence, five routes
scripts/delete-anchored-successor.mjs  NEW — delete-anchored rule, measured and rejected
scripts/were-we-second.mjs             NEW — 0 of 81 human orders precede ours
scripts/real-or-corpus.mjs             NEW — 81 of 85 are real client work
test/_amendmentFaithfulAudit.repro.ts  the honest fixture; fails 8
```

All untracked. `scripts/patch-visible.mjs` and `scripts/confirm-shape.mjs` reached conclusions
now withdrawn by §2.3 and §2.5.
