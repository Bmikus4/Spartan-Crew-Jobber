# Amending an order in place — design

2026-08-23. Written before the build. The point of this document is the two hazards in
§4 and §5: the obvious implementation double-books crew.

## 1. The blocker is gone

The 2026-08-19 handoff closed finding 6 with one gap: `PATCH /slotTeams` works and
accepts every field the engine sets, but the teams created *nested* inside `POST /orders`
never hand back their ids, and there is no `GET /slotTeams`, so there was nothing to aim
a PATCH at. Its recommendation was to email OnSinch. Not needed:

    GET /timelineAudits?data[like]=%Order:13784%      ->  6 rows, count 6

    order_create   | Order    {"id":"13784","created":{"Order":1,"Job":1,"SlotTeam":2,…},
                               "data":{"number":10654,"path":"Order:13784"}}
    common_create  | Job      {"id":"14064","data":{"path":"Order:13784/Job:14064"}}
    common_create  | SlotTeam {"id":"35499","name":"General",
                               "data":{"path":"Order:13784/Job:14064/SlotTeam:35499"}}
    common_create  | SlotTeam {"id":"35500","name":"General", …}

Verified live 2026-08-23 against orders from 2026-08-22, 08-20 and 07-30, raised both by
this engine (`creator: null`) and by hand in the UI (`creator: <user id>`). The job id and
the R number fall out of the same rows.

Three properties of the query, each of which cost a probe:

- `data[cont]` is a **400**. `data[like]` with `%…%` is the operator that works.
- The path is stored with **escaped slashes** (`Order:13784\/Job:…`), so a LIKE pattern
  containing `/` matches nothing — and returns `200` with an empty list, which reads
  exactly like "this order has no teams". Filter on the order id alone; parse here.
- `%Order:138%` also matches orders 1380 and 13800. Every row is re-checked against the
  order id after it returns. The filter narrows; it does not decide.

Unchanged from finding 6: `POST /slotTeams [{job_id,…}]` → 201 with the id;
`PATCH /slotTeams [{id,…}]` → 204; a team **cannot be removed** — DELETE is 405, `size:0`
is refused, the floor is 1.

### The audit trail depends on WHICH KEY WROTE THE ORDER

Found the hard way, by running the live verification with the wrong key and getting an
empty read:

| key | audit rows on a create |
|---|---|
| the engine's **service** key (`creator: null`) | `order_create` **plus** a child row per Job, SlotTeam and Slot, each carrying the path — **the ids are readable** |
| a **person's** API key (ben@… is user 2257) | ONE row, `order_created_via_api`, no children, no ids |

Not a change and not a fault: `order_created_via_api` has 4,119 rows going back to
2026-02-22 and every one is user 2257. The engine writes with the service key, which is
the column that matters — verified by reading five real engine-raised orders (13784,
13786, 13788, 13809, 13630) back through the shipped client, ids, job and R number
recovered on all five.

The consequence to hold on to: **`slotTeamsForOrder` returns nothing for an order a
person created through the API**, and the amendment then declines and the rebuild path
takes it. Correct, but it means a local `--write` test cannot exercise the read half.

### A size change cannot be read back. Anywhere.

The `Job` read model is `id, order_id, supervisor_id, name, created, modified, creator,
modifier, pricelist_category_id, min_beginning, max_end`. No headcount — and there is no
`GET /slotTeams`. So the **204 is the only evidence a resize landed**, and any claim this
engine makes about crew numbers in OnSinch rests on the write having been accepted, never
on having seen the result.

`min_beginning` and `max_end` ARE observable, so the windows carry the proof in the live
script: if `beginning` and `end` reach the record, so does `size` — same body, same
endpoint, same 204.

## 2. Where it goes

`executeOrder` in `pipeline.ts` is an if/else chain over what an update needs. One more
arm, ahead of the destructive one:

    if      (kind === "create")                    -> createOrder
    else if (await tryAmendInPlace(...))           -> NEW: PATCH the teams that moved
    else if (await tryReplace(...))                -> delete-and-repost, as today
    else                                              patch top-level, tell a human

A separate executor method rather than a branch inside `replaceProvisionalOrder`, for one
reason that matters: `replaceOrder` is **absent** when `SPARTAN_BLOCK_ORDER_REPLACE=1`.
In-place amendment destroys nothing, so it must keep working when the delete kill switch
is on — with the switch thrown, crew changes still reach OnSinch instead of reaching a
note.

The guard that protects a confirmed booking is extracted to `orderPreflight.ts` and
called by both paths. Two copies of "a confirmed order is never touched" is one copy too
many; that rule now has a single implementation and one set of refusal strings.

## 3. The correspondence problem

The audit read returns `{id, name}` per team in creation order. It does **not** return
their current size, window or place — nothing does. So the engine cannot diff live against
desired. It can only overwrite. Which live team does a desired team overwrite?

**Not by name.** Team names are composed from the client's own words for the work, so an
amendment that rewords the task changes the name. Matching on it would find nothing,
POST a new team, and leave the old one standing — **an order carrying both blocks, double
the crew, and nothing in the response to say so**. Names are not unique either: order
13784 carries two teams called "General".

**By position, against the set this engine last wrote.** The state row holds
`desired_order.slot_teams` — the exact array that was nested in the create, in order — and
the audit returns the ids in that same creation order. So `live[i]` **is** `previous[i]`,
established by our own write rather than inferred from content.

    plan(previous, next, live):
      live.length !== previous.length  -> decline: somebody else changed the team set
      next.length  <  previous.length  -> decline: a block was dropped; OnSinch cannot
                                          remove a team, so this still needs replace
      patch  live[i] with the fields where next[i] differs from previous[i], i < |previous|
      create next[i] for i >= |previous|

Positional overwrite plus append is **total and exact**: the resulting team set equals
`next` field for field, whatever order the blocks arrived in. A block inserted in the
middle shifts what each id holds and changes nothing about the outcome. Ids are not
identity here; the set is.

Declining on a length mismatch is the load-bearing refusal. It fires when ops added a
team by hand, when the thread inherited an order the engine did not raise, and when a
previous amendment half-landed — all cases where positional pairing would write one
block's times onto another block.

## 4. Crash safety: the create half is not idempotent

PATCHes are idempotent and order-independent, so they all go first. `POST /slotTeams` is
not: a retry that re-posts an appended team leaves the order with two of it.

The window is small — one GET, N PATCH, K POST, seconds — and the failure is double-booked
crew, so it is closed rather than argued about. Creates go one at a time, each followed by
an `onCreated(team_id)` hook the pipeline persists into `order_amend.created_ids` before
the next one is sent. A resumed run reads that marker and skips what already exists.

Interruptions, in full:

    crash mid-PATCH            -> retry re-derives the same plan and re-patches. No-op.
    crash after a create       -> the id is in order_amend; the retry skips it
    crash before state is put  -> live.length is now |next|, not |previous|, so the
                                  length check declines and hands a human an order that
                                  is already correct. Wrong, and the marker is what
                                  stops it: order_amend names the target count.

## 5. Staffed orders: the one write nobody has tested

Today any order with crew signed on refuses outright — 45% of drafts, and the reason
finding 4 exists. In-place amendment is exactly what should fix that, with one exception.

`PATCH /slotTeams [{id, size: <smaller>}]` on a team that **already has crew assigned**
is untested, and it may unbook people as quietly as a delete does. Proving it costs a real
signup on a real order and may SMS a worker.

So Phase 1 reads attendance **per team** — `GET /attendance?with=SlotTeam,Order&Order__id=`
returns rows carrying `SlotTeam.id`, which is a count per team, not just per order — and:

- size **unchanged or up**, window moved, place, name, description, on a staffed team:
  **applied**. This is the common amendment and it is what the client asked for.
- size **down** on a team with ≥1 attendance: **refused**, naming the team and the count,
  as today. Nothing else in the amendment is applied either — half an amendment is worse
  than none.
- size down on a team with **zero** attendance: applied. Shrink 5 → 2 is verified live.

Phase 2, after Ben rules and one live test on company 515: allow size down to no lower
than the number actually signed on.

## 6. What this settles beyond the amendment

- **Finding 10** — OnSinch reissues `max(live)+1` after a delete, so today's replacement
  inherits the R number of the order it destroyed. In place, the number never moves.
- **`carryForward`, the attachment refusal, the archive-before-delete** — all exist because
  the order is destroyed. On this path nothing is destroyed, so nothing needs carrying,
  an attachment stops nothing, and there is no snapshot to keep.
- The order-level fields (`specification`, PO) still go through the existing
  `executor.patchOrder`, called from the same branch, so one email produces one complete
  update rather than a team change and a separate note.

## 7. Verification

Offline, no network, in `test/`:

- `planAmendment` — no change → no calls; size up; window move; block appended; block
  dropped → declines; live/previous length mismatch → declines.
- the audit parse — real captured payloads, including the escaped-slash form, `Slot` rows
  whose path also names their team, and a foreign `Order:1378` row that the LIKE filter
  returns and the parser must reject.
- staffed — size down on a team with crew refuses and sends **nothing**; size up applies.
- resume — a marker with one created id makes the retry skip that create.
- `test/amendmentReachesOnsinch.ts` — the second email must now reach OnSinch as PATCHes
  with **no DELETE**, and a dropped block must still fall through to replace.

Live: `npx tsx scripts/verify-amend-live.ts --write`. Part A reads the ids back off five
real engine-raised orders; part B creates one order on TEST company 515, appends a block,
PATCHes both ends of its window, checks `size: 0` is refused before it is sent, and
deletes the order. **Ran green 2026-08-23**, and the tenant was checked afterwards for
orphans — none.

Still not proved, and deliberately not: **shrinking a block people are signed on to.** It
needs a real signup on a real order, which may SMS a worker. The engine refuses it today
and names the count, so the gap is closed by refusal rather than left open. Ben's call.
