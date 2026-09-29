# Restart plan — 2026-09-29

Everything between today's state and intake coming back on. Written after a critique
pass, so it argues from measured findings rather than from the last handoff.

**Not a task list yet.** Ben has further instructions inbound; this fixes the
workstreams, their dependencies and their order so those instructions land somewhere.
Each stream expands into a stepped plan when it is chosen.

---

## Do not touch: OnSinch order #16317

Created 2026-09-29 on TEST company 515 at Ben's explicit request by session `thera-f7`,
as the reference for the house block schema. **R11284, company 515.** Ben is reshaping
it by hand into crew + Lead Worker in one block.

**#16315 was the first attempt and is deleted.** It was created with
`request_approval: false` and so never reached To Confirm, which is where Ben wanted it.
**`request_approval` cannot be changed after create**: `PATCH /orders`
`[{id, request_approval: true}]` returns **204 with nothing changed** — the value still
read `"0"` and `modified` did not move — and the numeric form 400s with "Incorrect type
(should be boolean)". So it joins `order.specification` (#15805) on the list of fields
this API accepts and silently ignores. A 204 from this API is not evidence of a write.

Note also that id **16316 was created by somebody else** in between. Our ids are not
contiguous and nothing may assume they are.

**#16318 (R11285) is test traffic, also on TEST 515**, created 2026-09-29 at Ben's
request and named "TEST - interim shape built from R11284 - safe to delete". Its body was
derived programmatically from #16317's read-back: each block became **one** entry with the
Lead Worker **folded into the crew count** — Install crew x4, Derig crew x3 — plus an
`admin_note` telling ops to set one position to Lead Worker. It read back as 2 blocks,
each with a single `role=0` p1 position, `request_approval "1"`. It is the concrete form
of the candidate fix below, and it is **not in `order_records`**, so no survival
measurement should count it.

The `admin_note` is worth keeping as a technique in its own right: when the API cannot
express the shape, the body can still carry the instruction for the person who can.

It is linked to no thread and has no `conversation_state` row. Verified that nothing
here can reach it: the only delete on the app path is `replaceOrder.ts:236`, driven by
an order id taken from a thread's own state, and every other `deleteOrders` call site is
a one-off verify script deleting an id it created itself. Recorded here rather than in
one session's head because a note only one session knows is worth nothing.

**Related hazard:** `verify-shrink-staffed`, `verify-amend-live`, `probe-onsinch-clock`,
`verify-readback-live` and `verify-mail-inbound-engine` all create REAL orders on the
live tenant. A run during the pause lands in `order_records` as `id_source='api_response'`
— the exact cohort the survival measurements are drawn from. That is how the withdrawn
2% figure got its contaminated denominator. Record any run, or the next person measuring
survival measures our own test traffic.

## Global constraints

These bind every task below. Copied verbatim where they are somebody's words.

- **`python scripts/session.py` is the only sanctioned commit and push.** It runs
  `npx tsc --noEmit`, then `npm run test:all` (NOT `npm test`, which runs one file),
  appends a ticket to `public/data/feed.json`, then commits by pathspec and pushes.
- **Ben, 2026-09-29: no orders awaiting a confirm click, and none sent through.**
  Both directions refused. 39 threads currently sit in `proposed`.
  **The lever is `request_approval`, not `provisional`.** `format.ts` deliberately omits
  `provisional` and `quote` because OnSinch's defaults are what Spartan wants — settled
  by measurement, not inference: 14869 and 14870 were posted to TEST 515 with neither
  field and both appeared in To Confirm, carrying `request_approval: true`. A peer
  reading `provisional: false` back from an order it posted with
  `request_approval: false` concluded omission does not give To Confirm; that conflates
  the two fields. Whatever satisfies this constraint, it is a change to
  `request_approval` and `order_mode`, and a one-off sweep of the 39 would be undone by
  the next run.
  **MEASURED 2026-09-29, and it makes the existing 39 a purely local matter.** Of the 39
  `proposed` threads, **15 carry no OnSinch order id at all** and 24 carry one, covering
  21 distinct ids. Of those, 20 still exist and 1 is gone — and **none of the 20 is an
  engine creation**: `creator` is 413, 2620 or 2633 (ops staff, never 2257), `user_id` is
  a real client contact (never the placeholder), and `status` is -2 or -1, finished or
  cancelled. The engine merely LINKED to human-raised orders that are already closed.
  Read with "0 of 86 engine creations alive": **nothing in OnSinch is awaiting a confirm
  click because of us.** The 39 are a queue on our own dashboard. Clearing them needs no
  OnSinch write — but the posture change is what stops them accruing again.
  Caveat on the instrument: `request_approval` is returned on some order rows and absent
  on others rather than reading `"0"`, so absence of that field proves nothing. The
  conclusion above rests on `creator` and `status`, which are present on every row.
- **`replies_enabled` stays `false`** until Ben has read 12 drafts in a browser.
- **Automation is off** and due back ~2026-10-02. Nothing here assumes a restart date.
- **Never write `min_beginning`/`max_end`** — but the reason has changed and the old one
  was wrong. "The window is derived" is **unproven as of 2026-09-29**: on reference order
  #16317 the window still read 2026-12-07 08:00..20:00 after positions were added on
  2026-10-01, so it is not recomputed on at least some events. Treat it as possibly
  stale. A null window still means no information, never drift.
  **MEASURED, and the answer is narrower than the worry.** Over 388 saved jobs with
  positions, **337 have a window exactly equal to the envelope of their positions and 0
  mismatch**; 51 (13%) have a **null** window despite having positions. So when the
  window is computed it genuinely IS the envelope — it simply is not always recomputed.
  And on the eight amendment refusals specifically: of the 10 refused orders still alive,
  **9 have a window matching their positions exactly and 1 is stale** — order 16070, job
  16127, `max_end` reading 2026-09-18T12:00 against an envelope running to 23:00, eleven
  hours out.
  **So staleness does not explain the refusals.** The original diagnosis stands: real
  drift, no lever, nothing sent, and OnSinch blamed for refusing what it was never asked.
  Limit on that: the comparison is against TODAY's positions, not against what the engine
  desired at refusal time, so it narrows rather than closes — and one of eight being
  spurious is entirely consistent with what was found.
  **The rule that survives:** never detect drift from `Job.min_beginning`/`max_end`.
  Nine of ten matching is not good enough when the tenth is silent and eleven hours wide.
  Compare positions directly through `with=Job__SlotTeam__Slot`.
- **An empty body is not a no-op on the OnSinch API.** Any probe is a write until
  proven otherwise.
- **`unreconciled` and `unactionable` are different claims** and must not be merged.
- **A draft is not a message.** An unsent draft must never count as Spartan replying.

---

## What is settled, with evidence

Tickets `S-0001`…`S-0012` in `public/data/feed.json`. Highlights that change what to do
next:

- The **2% survival claim is withdrawn** (retracted 2026-09-03, resurrected by a stale
  memory line, ticketed as `S-0001`). It decides nothing.
- **105 of 133 engine orders were deleted** by 2026-09-15, 67 with a same-company
  same-date survivor. Candidate replacements, not proof.
- **Blocks ARE readable**: `GET /orders?id[eq]=N&with=Job__SlotTeam__Slot` returns
  200 with `Job[].SlotTeam[].Slot[]`. The dot form `with=Job.SlotTeam` 400s with a
  message naming only top-level relations, which is why this repo believed otherwise.
  Verified here independently with a positive control. Found by session `thera-f7`.
- **Crew chief shape**: 281 of 388 human-raised blocks carry a `role=1` Lead Worker
  position *inside* the same SlotTeam as the `role=0` crew; only 1 in 388 is a
  standalone chief team — which is the shape this engine produces.
- `SlotTeam` carries no `size`; size is per `Slot`. Headcount is the sum of
  `Slot.size` within a window, never across a multi-day block.
- Corpus: 772 threads, 4,239 messages. **198 waits owed by Spartan, 124 owed by
  clients.** `is_from_spartan` disagrees with the sender address on 0 rows;
  0 rows have an unparseable `date_iso`.

---

## Stream A — the follow-up feature does not yet label anything

**This is the honest top of the list.** `decide()` exists, is tested and is correct;
**nothing calls it.** The dashboard reads the same state, so the screen looks finished
while Gmail never receives a label. Section 3 of the spec is therefore unimplemented in
its central behaviour.

Needs: a runner that walks threads, calls `decide()`, and applies or clears the label
through a non-exclusive writer (leaving `THE_FOUR` and their mutual exclusion intact);
a schedule to run it on; and the label writer itself.

Blocked on: nothing for the pure parts. The Gmail write needs one of the two
credentials below, so the runner should be built and tested against a fake writer
first, and the credential wired last.

Do not start: until Ben confirms whether labelling may go live before intake resumes.
Applying labels to 322 live threads is visible to the whole team.

## Stream B — the drafts already in the mailbox

14 exist. **7 replies are sound. 5 of 7 chases would not be written today** and should
be deleted; 2 stand. Named in `S-0012` by thread and draft id.

Blocked on: Gmail write access. The draft webhook only creates; the n8n management key
is 401; the service account is unconfigured and needs a `@spartancrew.co.uk`
super-admin that Ben's gmail.com account cannot grant. **This is the first thing the
dead n8n key has actually blocked** — drafting itself works without it.

## Stream C — order shape, and the 105 — **PARTLY ANSWERED, and the limit matters**

Measured read-only by session `thera-f7` on 2026-09-29, with a positive control.

**Of the 86 orders with `id_source='api_response'` (created 09-03 to 09-18, in
`order_records`), 0 are alive.** The `id[in]` control returned 2 of 2 known-live
orders, so the absence is real and not a filter artefact. 47 have a later
same-company same-day human-raised order, mostly at **+1 id** — rebuilt immediately.

**45 of the 86 carried a separate p36 "Crew Chief" SlotTeam. In the successors a
chief-only block appears 0 times.** A `role=1` Lead Worker inside the crew block
appears 22 times; the remaining 25 are small crews with no lead at all.

    #15799  ours    "warehouse crew" p1 x3  +  "Crew Chief" p36 x1
            theirs  #15800 [Warehouse: p36 r1 x1, p1 r0 x2, p1 r0 x1, p1 r0 x1]
    #15826  ours    2 crew blocks + 2 SEPARATE chief blocks
            theirs  #15827 [Derig: p36 r1 x1, p1 r0 x3] [Install: p36 r1 x1, p1 r0 x3]

Two further differences in the same successors: blocks are renamed to house vocabulary
(**Install, Derig, Warehouse**) and orders are named **"Client @ Venue"**.

**The lifecycle evidence is the strongest part.** On the two surviving 08-28 engine
orders (#15593, #15594) the team *converted* our API-created position into the `role=1`
chief and added a `role=0` crew position beside it, rather than deleting. Read with the
45→0 result: they reshape in place when the order is reachable and delete-and-rebuild
when it is not. **The retype is a repair, not a rejection** — which is the better
problem, because a repair states exactly what the correct output was.

**Reconciliation, so two numbers never fight in this feed.** The 86 is
`order_records.id_source='api_response'`, which begins 2026-09-03. The older 105/133 is
`conversation_state.order_action_log`, which begins 2026-08-06 and runs to 09-15.
Different cohorts, different instruments, same conclusion — corroboration, not conflict.
Both denominators are stated because a survival claim in this project was once withdrawn
for having a contaminated denominator nobody had written down.

### The limit — do not let this get repeated as "the answer"

Two later read-only results narrow the claim, and both cut against the tidy version:

- **Rates are carried per POSITION.** Of 43 successor blocks holding both a lead and a
  staff position, **40** give the `role=1` position a `pricelist_id` different from
  every `role=0` one in that block; 3 share one. The order body this engine sends has
  **no field for a per-position rate at all**, so emitting the right shape is necessary
  but not sufficient — the chief's rate has nowhere to go.
- **Renaming is universal and therefore proves nothing.** 0 of 47 successors kept our
  order name and 0 of 47 kept our job name. That rules naming out as a discriminator in
  either direction — it does not show naming is required, nor that it is cosmetic.

**And the arithmetic does not close on shape.** All 86 died, but only 22 of the 47
successors carry a lead position — the other 25 are small crews with no chief at all.
Those 25 had no chief-shape problem and were retyped anyway.

### The other half, and it is the bigger one

Measured read-only by `thera-f7`, corroborated locally here against our own
`conversation_state`. The remaining cause is **order-level fields, not the block body**.

- **Every order names the wrong client.** All 86 engine creates carry
  `user_id = 2257` and `order_manager_id = 2257`. 2257 is Ben's own account —
  `PLACEHOLDER_CONTACT_ID` in `compiler.ts:261`, the stand-in used when the sender
  cannot be matched to an OnSinch user. **All 45 readable successors carry a real
  client contact and 0 of 45 match ours**; 41 of 45 have `order_manager_id` null, so
  ops clear the field Ben asked to have filled on 2026-08-25.
  **CORRECTED, and the first version of this line was wrong.** Ticket `S-0013` says
  "contact matching fails on roughly 71% of orders". It does not fail — **it is never
  attempted.** `resolveContact` (`compiler.ts:550-557`) takes four underscore-prefixed
  unused arguments and returns the placeholder unconditionally. The 71% was an era mix,
  not a failure rate: by month, 2026-07 is 0 placeholder / 3 real, 2026-08 is 44 / 114,
  2026-09 is **261 / 9**. The switch lands in late August exactly where the comment
  above that function says it does, and the "real" contacts are pre-change threads.
  Since then it is effectively **100% placeholder, by design.**

  **And the fix is already written.** `matchContact` (`resolve.ts:405`) is an exact,
  case-insensitive match of the sender's email against the company's client users,
  returning null on no match. It is imported into `compiler.ts:25` and **never
  called.** The comment justifying the placeholder objects to "whichever contact the
  company had first" — a guess that put a real named client employee on a booking they
  had never sent. That objection is sound and does not apply to matching the sender's
  own address. So: call the function that is already there, keep the placeholder as the
  fallback when it returns null, and let `compiler.ts:1598` go on staging those for a
  human. No new capability, no guessing, existing safety preserved.
  Found by `thera-f7`; era data measured here.
- **The rate card is stale.** The successor's `Job.pricelist_category_id` matches ours
  in **4 of 45**. The flows are 315→342 (25), 315→354 (6), 315→355 (2), 342→354 (2),
  197→354 (2); human orders moved onto **card 354** after about 09-10.
  Locally: we intended 315 on 142 of the 191 orders carrying a card, and **354 appears
  nowhere in our data at all.** The justification comment on `default_rate_card` in
  `types.ts` argues 315 from a measurement of 498 orders that predates the move.
- **In the chief-less subset, 16 of 25 pairs are identical** in headcount, block count
  and professions. For those the *only* differences are the contact, the rate card and
  the names.

Both fields are `PATCH`able (`PATCH /orders` `user_id`, `PATCH /jobs`
`pricelist_category_id`), so none of this is an API limit.

**So the answer, in one line: an engine order arrives naming Ben as the client on a
rate card the business no longer uses, and a person has to fix that on every single
one.** Shape explains the 22 with a chief; this explains all 86. `thera-f7` does not
claim causation from contact and card alone, and neither do I — but it is the only
content difference present in all 16 clean pairs.

`thera-f7`'s own caveat, kept verbatim in spirit: shape is demonstrably *one*
difference; that it is the *only* reason is not proven.

**What this does change:** a concrete, testable defect in the order body — the block
shape and the missing per-position rate — replaces a vague worry about accuracy. What it
does not do is explain why an order with no chief is still rebuilt. Answering *that* is
the remaining half, and it should be the next read-only question asked.

Drift note: on re-read, 45 of the 47 successors still resolve and 2 have since gone.
Even the successors are not permanent.

Still blocked on: whether `POST/PATCH /slotTeams` can create a `role=1` position at all
— undocumented, and settling it needs an authorised probe on TEST 515. `thera-f7` is
asking Ben. Not ours to run unilaterally, and an empty body is not a no-op on this API.

## Stream D — verify writes instead of trusting them — **CONSTRAINED**

**Read this before planning any amend work.** `PATCH /slotTeams` returns 400
*"Shift is not atomic"* on **every block carrying more than one position** — measured
by `thera-f7` across all six readable team ids in the `order_action_log` atomic errors,
including one with two staff positions and no chief at all.

A correctly-shaped block — a `role=1` chief beside `role=0` crew — has more than one
position **by definition**. So **the shape we should be writing is the shape we then
cannot amend.** Any plan reading "write the right shape, then amend in place" is
unbuildable as written.

This also reinterprets the 09-28 handoff's "Class B is gone, nothing left to build".
Those errors stopped appearing because the engine stopped attempting the amendments,
not because the limit lifted. The constraint was never fixed; it went quiet.

What remains available: reads (`with=Job__SlotTeam__Slot`), single-position edits, and
replace-the-order. An amend strategy has to be built out of those or not at all.

### The original Stream D, still true where it does not touch amends

Now possible because blocks are readable. Today `amendOrderInPlace` is skipped entirely
unless `last_ordered_teams` records which blocks are ours, because block structure was
believed unreadable. Six of eight live amendment refusals were exactly that: drift with
no stored lever, nothing sent, and the thread filed as "OnSinch refused" when we never
asked.

With a nested read the engine can re-derive the blocks rather than depend on what it
happened to store, and can verify a create by reading the real shape back.

Depends on: Stream C's findings, since the shape we verify against is the shape we
should be writing.

## Stream E — venues

Two separate changes, deliberately not bundled (the sweep doc bundles them; that was
the mistake).

- **Retired-only resolution.** A thread whose only match is a retired row is booked
  onto it today. A naive hard filter is *worse* — the compiler mints a duplicate from
  the client's words, regrowing the pool the sweep shrank. Needs a third branch: named
  a venue, matched only retired rows → hold at the placeholder for a human. Distinct
  from "named no venue" and from "matched nothing".
- **Generic names.** `GENERIC` moves out of the sweep script into the resolver so a
  generic description stops selecting a specific property. Its own tests, its own
  before/after number, because its failure mode is silent under-matching rather than
  duplication. Note 3 of the 10 referenced inactive rows are `warehouse` and `London`.

## Stream F — the security surface

- Three read routes carry no auth reference: `/api/jobs`, `/api/metrics`,
  `/api/onboarding`. The nine write routes are guarded and pinned by
  `test/writeRoutesAuthorised.ts`, which discovers routes, so new ones are covered.
- **The injection boundary.** Arbitrary client email drives hands-free order writes
  with no boundary. Carried untouched across five handoffs. Under the directive's
  "what survived a handoff goes first" rule this outranks most of this document, and
  it must land **before** restart, not after.

## Stream G — restart criteria

Nobody has defined "back on". Proposal to put to the team rather than assume:
supervised first week with human approval of every external OnSinch mutation, then a
narrower hands-free mode gated on a clean lever — never automatic promotion on a date.

Depends on: Stream F. Restarting with the injection boundary open is the thing this
plan exists to prevent.

---

## Order, and why — REVISED once Stream C answered

Stream C was research when this was written and is now the largest known defect in the
product, so it goes first. The contact and the rate card affect **100% of orders**,
they are the reason every engine order is retyped, and neither needs a new API
capability — only correct values in a body we already send.

1. **Contact resolution.** Make `matchContact` succeed, or fail loudly instead of
   silently substituting Ben. 71% placeholder is not a fallback, it is the norm. Until
   this lands, every order the engine writes will be corrected by hand no matter what
   else is fixed — so nothing downstream of it is worth optimising.
2. **The rate card.** 315 is stale; the house moved to 354 around 09-10. Re-measure
   against current orders rather than trusting the comment, then change the default and
   rewrite that comment with the new measurement and its date. The existing "money is
   the one thing worth a click" staging rule stays.
3. **Stream A's pure parts** — the runner and label writer against a fake. No
   credential, no live effect, and it finishes the feature that currently only looks
   finished.
4. **Stream F** — the carried item, before any restart.
5. **Stop emitting the Crew Chief team.** NOT "emit the house shape" — that task is
   **not buildable**. Measured 2026-09-29 with three controls: `role` and `Slot` return
   **400 Unknown property** on `POST /orders` (inside SlotTeam), on `POST /slotTeams`
   and on `PATCH /slotTeams`. The same body without them fails only on "Company not
   found", a junk `ZZZ` field is flagged identically, and a size-only PATCH reaches
   "Records with specified IDs not found". Nothing was persisted — every request was
   aimed at company 999999. **A Lead Worker can only come from the UI.**

   So the engine cannot produce the correct shape by any route, and the question is
   what is least wrong given that. Today it emits a **separate** p36 "Crew Chief"
   SlotTeam: successors contain a chief-only block **0** times, p36 at role 0 carries
   **wage_h 0**, and the block cannot be amended once anyone adds a second position. A
   dedicated block, for a chief paid nothing, in a shape nobody can edit — so ops delete
   it.

   On the two orders that survived (#15593, #15594) the team **converted our single
   block into the role-1 chief** and added crew beside it. A separate chief team is a
   block they must delete; one crew block is a block they can edit.

   **PARKED BY BEN, 2026-09-29. Do not re-propose it.** The candidate fix was: emit one
   block per shift carrying the crew and stop emitting the chief team altogether, turning
   a delete-and-rebuild into one human edit. He heard the evidence and chose to keep the
   current body — "lets just go back to the old schema". So the engine keeps emitting the
   chief as its own p36 SlotTeam and `compose.ts` grouping is unchanged.

   The evidence above stays because it is still true and someone will otherwise re-derive
   it from scratch; only the recommendation is struck. `#16318` on TEST 515 is the built
   form of the parked proposal, kept as a reference rather than as a direction.

   **Provenance, stated because it matters:** this decision reached this session via
   `thera-f7` rather than from Ben directly. It was acted on because parking is the
   conservative direction and costs nothing if the relay is accurate. If it is wrong, it
   is one feed entry to correct.

   **A caution recorded against the parked proposal**, so it is not lost if anyone revives
   it: folding the lead into the crew count means a block reading `crew x4` when the intent
   is 3 crew plus 1 lead. If ops read the `admin_note` and set one position to Lead Worker
   it resolves. If they do not, the job runs 4 crew and no lead — and *looks fine*. The
   current separate chief block is visibly wrong and gets deleted; a silently unled crew
   does not announce itself. The failure mode is quiet where today's is loud.
6. **Stream E** — small, self-contained, and finishes work already applied to the live
   tenant.
7. **Streams B, D, G** — each blocked on a person: a Gmail credential, an authorised
   probe, a conversation with the team.

A note for whoever executes this: items 1 and 2 are small, and their smallness is the
point. Months of this project's effort went into intake accuracy, venue matching and
auth while every order it produced was unusable on arrival for two reasons that fit in
a sentence.

Stream A's Gmail write, Stream B, and anything touching the 39 `proposed` orders wait
for Ben.
