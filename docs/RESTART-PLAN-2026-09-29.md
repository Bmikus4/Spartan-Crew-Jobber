# Restart plan — 2026-09-29

Everything between today's state and intake coming back on. Written after a critique
pass, so it argues from measured findings rather than from the last handoff.

**Not a task list yet.** Ben has further instructions inbound; this fixes the
workstreams, their dependencies and their order so those instructions land somewhere.
Each stream expands into a stepped plan when it is chosen.

---

## Global constraints

These bind every task below. Copied verbatim where they are somebody's words.

- **`python scripts/session.py` is the only sanctioned commit and push.** It runs
  `npx tsc --noEmit`, then `npm run test:all` (NOT `npm test`, which runs one file),
  appends a ticket to `public/data/feed.json`, then commits by pathspec and pushes.
- **Ben, 2026-09-29: no orders awaiting a confirm click, and none sent through.**
  Both directions refused. 39 threads currently sit in `proposed`.
- **`replies_enabled` stays `false`** until Ben has read 12 drafts in a browser.
- **Automation is off** and due back ~2026-10-02. Nothing here assumes a restart date.
- **The job window is derived** — `min_beginning`/`max_end` are the envelope of the
  blocks. Never written directly. A null window means no information, never drift.
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

**And the arithmetic does not close.** All 86 died, but only 22 of the 47 successors
carry a lead position — the other 25 are small crews with no chief at all. Those 25 had
no chief-shape problem and were retyped anyway. **So the separate Crew Chief team
cannot be the sole cause; it explains at most half.** Something more general is causing
engine-created orders to be rebuilt regardless of shape, and it is not yet identified.

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

## Stream D — verify writes instead of trusting them

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

## Order, and why

1. **Stream A's pure parts** — the runner and label writer against a fake. No
   credential, no live effect, and it finishes the feature that currently only looks
   finished.
2. **Stream C read-only** — it is free, it answers the oldest question in the project,
   and its answer determines what Stream D verifies against.
3. **Stream F** — the carried item, before any restart.
4. **Stream E** — small, self-contained, and finishes work already applied to the live
   tenant.
5. **Streams B, D, G** — each blocked on a person: a Gmail credential, an authorised
   probe, a conversation with the team.

Stream A's Gmail write, Stream B, and anything touching the 39 `proposed` orders wait
for Ben.
