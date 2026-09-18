# Venue sweep, verified merge, and the single not-found exit

Design, 2026-09-18. Approved by Ben and a Spartan staff member. Supersedes nothing;
extends the August protocol in `scripts/place-dedupe-{analyse,run}.ts`.

This writes to the live tenant. Read §7 before running anything with `--commit`.

---

## 1. Why this is not the August sweep again

`4f0f795` (2026-08-25) deleted 1,293 venues under a three-pass protocol. That protocol
was right and is reused here. It deliberately **held back 5,251 rows** because no human
was in the loop to make the judgements it refused to make:

| held class | rows | the refusal |
|---|---|---|
| `locatable_never_deleted` | 2,146 | "merging two real records is a judgement about the world" |
| `would_point_at_another_shell` | 2,130 | "deleting it tidies the list and moves the problem" |
| `names_a_part_of_the_venue` | 438 | a hall is not a duplicate of the building |
| `engine_sentinel` | 384 | "the engine looks this row up BY NAME" |

A human is now in the loop, which is what unlocks the first two. The fourth was **wrong**,
and finding out is the highest-value thing this survey did: the sentinel guard is a regex
matching `placeholder|unknown|test`, but `PLACEHOLDER_PLACE_NAME` is `"No Location"` and
that is the only name `holdAtPlaceholder` ever looks up. The rule protected **210 rows
named "Placeholder" and 171 named "Unknown"**, every one bare, active, and a live match
target. It was protecting the sentinel's clones, not the sentinel.

### Measured state of the pool, 2026-09-18

```
total                    5,649        (August post-delete snapshot: 5,567)
active                   5,630
shells                   3,613  64.0%
with postcode            2,214
new since 2026-08-25        82        of which 18 shells
exact-name dup groups      182        covering 3,377 rows
  ...2+ members locatable   69        <- the class August refused
generic name AND bare      392        <- the delete rule below
```

Re-accumulation is slow — 82 rows in 24 days — so a one-time cleanup holds, provided §6
closes the source.

---

## 2. What we are actually fixing

Three different problems currently wear one label, and only the second and third move
venue accuracy:

1. **True duplicates.** `9 / 6835 / 6837 Fairmont Windsor Park`, all `TW20 0YL`. One venue,
   three rows. Costs a wrong-row match, not a wrong location.
2. **Junk match targets.** 210 "Placeholder", 171 "Unknown", 8 bare "London". Any vague
   text can land on one. This is a share of the measured 8.6% of resolutions that land on
   a place naming no venue at all.
3. **The engine still manufactures them.** `unresolvedVenue` provisions a new venue from
   the client's own words whenever the text looks like it names a building. Measured in
   `compiler.ts`: of 19 provisions, 7 had a strong existing match, 8 were rows the tenant
   already held, 2 were not venues, **1 was genuinely new**. 18 of 19 grew the tenant for
   nothing.

Cleaning without (3) is mopping with the tap running.

---

## 3. Classification — every row lands in exactly one bucket

No transitive clustering. The August survey's header records why: its first version joined
rows by "neither contradicts the other" and put the Royal Albert Hall, the British Museum,
Oxford Circus and 3,405 others into one cluster of 3,409. Run as a deletion it would have
destroyed 3,408 real venues. **Similarity is not the test.**

The test, unchanged from August, is operational:

> A row is a duplicate only if, with that row REMOVED from the list, the live resolver
> takes the row's own name and returns a different row that can actually locate a job.

| bucket | rule | action |
|---|---|---|
| **A. identical** | same normalised name AND same postcode | merge, survivor = max data |
| **B. same name, different postcode** | Battersea `SW11 8DD` vs `SW11 8BZ` | human judgement, no default |
| **C. shell into locatable** | August's proven class | merge, re-run for the 82 new rows |
| **D. generic and bare** | generic name AND no locating data | **delete** |
| **E. generic with data** | `Private Residence` ×9, `Location` ×2 | **keep**; made non-matchable in §6 |
| **F. sentinel** | `6922 "No Location"` | exempt from everything, exactly one row |

"Bare" means: no `zip`, no `lat`/`lng`, no `city`, no `alias`, no `note`, and `address`
either empty or identical to `name`. Bucket D is **392 rows less the one sentinel = 391**.

Bucket E is excluded from deletion by Ben's own qualifier — those rows carry real
postcodes, so they contain other info. Nine different homes share the name "Private
Residence"; merging them would be a data catastrophe and deleting them would destroy real
addresses. They are a *matching* problem, fixed in §6.

---

## 4. Phases

Order is the safety property: know what points at a row before removing it, repoint the
engine's memory before the tenant's, and prove each write landed rather than trusting the
response.

### Phase 0 — snapshot to a NEW dated file

`.tmp-data/place-dedupe/snapshot.json` is the only way back from the August deletion and
`--snapshot` overwrites it. This run writes `snapshot-2026-09-18.json`. **Never reuse the
August filename.**

### Phase 1 — the reference scan (new; August had no equivalent)

August's protocol states: "a venue row is shared by every order that ever pointed at it,
and there is no way to know from here which of those still matter." There is a way. Page
all ~7,066 orders with their slot teams, collect every referenced `place_id` and
`slotlocation_id`, and attach a live reference count to every place row.

**`with=Job` returns Job as an ARRAY, not an object.** `order.Job.min_beginning` is
undefined on every order in this tenant; the scan must iterate. Getting this wrong yields
a reference count of zero everywhere, which would licence deleting the entire pool — so
the scan asserts a non-zero total before any of its output is used.

This converts "delete where OnSinch allows" from a hope into a rule:

- **reference count 0** -> deletable
- **reference count > 0** -> deactivate only, never delete

OnSinch's own refusal becomes the backstop, not the primary guard. That matters because
`4f0f795`'s subject records that `DELETE /places` lies — it reported success on rows it
did not delete.

### Phase 2 — classify

Per §3. Writes `classification-2026-09-18.json`. Read-only.

### Phase 3 — elect survivors and compute the max-data union

Survivor is the row with the most populated fields; ties break to the **lowest id**, which
is the oldest and most referenced. The union PATCH carries every field a loser holds and
the survivor lacks, and **never overwrites a populated field** — the same rule
`--enrich` used in August.

Applied *before* any loser is removed, so a crash mid-merge loses nothing.

### Phase 4 — verification, in a published web doc

An artifact, one entry per proposed action, showing only what is needed to judge it: the
group's rows side by side with id, name, postcode, populated-field count and live
reference count; the elected survivor; and the exact fields that would move. **Every
bucket that moves data appears — A, B, C and D.** Ben verifies every merge, and C is a
merge however well August proved the class; D especially, because deletion is the
irreversible one.

It records a mark per group (`merge` / `keep-separate` / `delete` / `skip`) and saves it.
The apply step reads those marks back. **Nothing writes to OnSinch without a mark.**

### Phase 5 — apply, in this order

1. Repoint `entity_aliases` off every loser onto its survivor. This is also where the
   poisoned `rg jones sound engineering -> 146 "F1 Sound Co"` row is corrected to company
   457 "RG Jones".
2. PATCH survivors with the union from phase 3.
3. Remove losers: delete where reference count is 0, deactivate where it is not, **with a
   read-back per row** confirming which actually happened.

Batches of 50. Every write appended to an action log *before* it is sent. Stop after five
unexpected failures — and, per the August lesson, "already gone" counts as done, not as a
refusal.

Staged orders in `conversation_state` are **not** rewritten. They recompile on the next
message, and editing stored JSON is the worse risk.

### Phase 6 — one not-found exit, and the index rebuild

**Ben, 2026-09-18: there should be ONE "No Location" which resolves in literally all
not-found exits the engine produces.**

`unresolvedVenue` currently has three exits and only two hold at the placeholder:

| exit | today | after |
|---|---|---|
| `missingVenue` | `holdAtPlaceholder` | unchanged |
| text names no building | `holdAtPlaceholder` | unchanged |
| **text names a building, unmatched** | **provisions a new venue** | **`holdAtPlaceholder` + the wording rides on the job** |

The third exit stops creating rows. The engine stops creating venues entirely;
`6922 "No Location"` becomes the sole terminus of every unresolved path. This is the change
that stops the pool regrowing, and the repo's own measurement says it costs one
genuinely-new venue in nineteen.

**But it must not throw the client's address away, and that is not a detail.** This
behaviour has been ruled on three times. `test/venueCreatesOnUnresolved.ts` was
`venueNeverProvisions.ts` under Ben's 2026-08-31 ruling, and his 2026-09-03 reversal is on
the record:

> "Parking a miss on 'No Location' throws the client's address away: the booker opens the
> job and has nothing to work from but a note. Creating a row keeps it, on the job, in the
> field a job sheet prints. A duplicate is a row a person merges; a discarded address is a
> phone call."

That argument is correct and survives this change. The two goals are separable: the reason
to create a row was to keep the address **on the job**, not to own a venue row. So the
third exit resolves `place_id` to the placeholder **and writes the client's venue wording
into the slot-team `description`**, which already carries overflow text onto the team
(`compose.ts:413-416`) and is already in `TEAM_FIELDS`, so it amends and reads back like
any other field.

One venue row, address preserved, no phone call. A ruling that reverses twice is a sign
the two costs were entangled; this separates them so neither has to lose.

Also in this phase, and nothing more — the choice was "rebuild the search index only", so
there is no curated table and no new storage:

- **A generic-name guard.** Bucket E can never be a resolution *target*. A client writing
  "private residence" must not land on someone's house in Croydon.
- **`active` becomes a filter, not a nudge.** Today `venueMatch.ts:383` and
  `resolve.ts:292` only *rank* by `active`; a deactivated row is still a candidate and
  still wins when nothing else matches. Without this change, deactivation does not shrink
  the pool.

### Phase 7 — measure

- `study/` free leg: deterministic, offline, 17s for 500 threads, zero model calls. Run
  **before phase 5** and **after phase 6**. Venue is the only gate genuinely under test in
  it, which is exactly the gate being moved.
- Re-derive the live numbers from the 09-15 query: 290 threads resolved a place, 59 (20.3%)
  on a shell, 25 (8.6%) on a place naming no venue.

---

## 5. Invariants — do not "tidy" these

- **`6922 "No Location"` is exempt from every phase.** Deleting it is churn: the engine
  re-creates it by name on the next enquiry that needs one, with a new id, orphaning
  every order standing on the old row.
- **There must be exactly one of it.** The city-only guard once read "No Location" as a
  city name — it has no identifying words, by construction — refused the placeholder it
  had just found, and provisioned a second one carrying "No Location" as its address.
  `test/venueResolution.ts` pins this branch.
- **Similarity is never the merge test.** See §3.
- **Never overwrite a populated field** in the union PATCH. Merging adds information; it
  does not choose between two facts.
- **Reference count, not OnSinch's refusal, gates deletion.** `DELETE /places` has been
  caught reporting success without deleting.
- **A sub-venue is not a duplicate.** "Hall S3" is the only record of which hall the crew
  were sent to.

---

## 6. What is genuinely irreversible

A deleted row's **id**. Restoring from the snapshot means re-POSTing and receiving a *new*
id, so any order that pointed at the old row is orphaned. Phase 1 exists for this reason
and is the only thing standing between a clean sweep and silent damage to order history.

Everything else is reversible: deactivation via `--reactivate`, the union PATCH from the
snapshot, alias repointing from the action log.

---

## 7. Order of operations for whoever runs this

```
0  snapshot    read-only, new dated file
1  references  read-only, ~7,066 orders, slow, free
2  classify    read-only
3  elect       read-only, writes the plan
7a measure     study/ free leg, BEFORE
4  verify      publish the web doc, Ben marks every group
5  apply       --commit, the only phase that writes to OnSinch
6  index       code change: one not-found exit, generic guard, active filter
7b measure     study/ free leg, AFTER, plus the live venue query
```

There is no flag that runs the whole thing, for the same reason August had none: a script
that can do everything in one command is a script somebody runs in one command.

---

## 8. Open risk, stated rather than assumed

Phase 6's `active` filter changes behaviour for **every** thread, not only swept rows. A
thread whose only candidate is a deactivated venue currently books to it; afterwards it
goes to the placeholder and a human sets the venue. That is correct, and it lands the same
week the write-path failures in `Spartan-Jobber-2026-09-17-sweep.md` are being chased.
Phase 7's before/after is what tells us which way it went.
