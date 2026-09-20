# Venue sweep v2 — provenance-first, 2026-09-20

Supersedes `VENUE-SWEEP-PLAN-2026-09-18.md` as the operating design. That plan's
facts and invariants all hold; its *method* is replaced, for the reasons in §1.

---

## 1. Critique of the 2026-09-18 sweep

It works. It is also the wrong shape for the question, in four ways.

**It groups by exact name equality, so it cannot see the duplicates that matter.**
`classify()` buckets on `norm(name)`. The five ExCeL strings the generator actually
emitted —

```
ExCeL London, One Western Gateway, Royal Victoria Dock, London E16 1XL
ExCeL London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL
ExCeL London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL, United Kingdom
ExCeL London, One Western Gateway, Royal Victoria Dock, London E16 1XL, UK
The Excel Centre, Royal Victoria Dock, 1 Western Gateway, London E16 1XL
```

— are one venue and five groups. Exact-name equality is a safe key and a blind one.

**It has no notion of provenance.** It can say a row is bare and generic; it cannot
say a row is *fabricated*. That is why 329 rows across two families landed in the
handoff as "Ben's calls, unprovable". They were not unprovable. Nobody had read the
generator's own output.

**Its 180 decisions carry a bucket name and no evidence.** A person asked to approve
`shell-group survivor=2033 members=[180 ids]` is being asked to trust the classifier,
which is the one thing a review is supposed to test.

**It measures nothing about its own error rate.** It produces decisions and stops.
There is no answer to "how wrong is this list", which is the only question that
decides whether it may be applied to a live tenant.

Keeping: `SENTINEL_NAME`, `GENERIC`, `isBare`, `richness`, the reference-scan guard,
and every invariant in §4 of the handoff. Replacing: the grouping key, and everything
downstream of it.

---

## 2. What the n8n log actually proves

`ePmN0J3jma6WFLwj` "Email SamurAI Stress Test ⚠️" is the **only** workflow of 113 that
generates and sends mail to `spartancrew.co.uk`. Its `Bookings New Job` node is an LLM
told to emit a booking enquiry including a "Full Venue Address". `Complex1` posts it to
`bookings@spartancrew.co.uk`.

Measured 2026-09-20:

| | |
|---|---|
| executions retained | 39 (2026-08-27 → 2026-09-04) |
| generated emails | 38 |
| `thread_messages` rows, subject `new booking request in london` | **38** |
| distinct venue strings | 12 |

n8n and the engine's own mail store agree exactly, so the execution log is **complete
for this generator** — nothing has been pruned out from under it.

Those 38 threads resolved to five place ids: `49` ExCeL London, `13` The Shard, `1241`
Novotel London Excel (a mis-match on postcode `E16 1AA`) — all three real and correctly
kept — and `6039`, `6100`, both bare address-as-name rows the test itself created.

**So the n8n log is a precision instrument with small recall, and its value is not the
5 rows it points at directly. It is the name shape it proves.** Three of the strings it
emitted are, verbatim, `The Grand Hall, <number> <street>, London <postcode>`. In the
tenant:

```
"The Grand Hall*"   193 rows,  13 distinct names,  193 of 193 bare,  ids 2033–6278
  180  The Grand Hall, 50 Crown Street, London, WC1A 2AB
    2  The Grand Hall, 123 Park Lane, London, W1X 4YZ
    1  The Grand Hall, 10 Downing Street, Westminster, London, SW1A 2AA
    1  The Grand Hall, 123 Conference Street, London, SW1A 1AA
    … 9 more, each ×1
```

Not one carries an address, city, postcode or coordinate. The family contains Downing
Street, a documentation postcode (`SW1A 1AA`), and a street called "Conference Street".
The handoff's largest open judgement call — `The Grand Hall, 50 Crown Street` ×180 —
is settled: it is the generator's output, from executions that have since been pruned.

---

## 3. The algorithm

Five stages. Every stage is a pure function over the snapshot; nothing writes.

### A. Provenance

For each of the 12 n8n venue strings `v`:

- `lead(v)` = normalised text before the first comma. Skipped if fewer than two tokens
  or if it matches `GENERIC` — otherwise "London" would claim the tenant.
- **n8n-exact**: `norm(name) === norm(v)`.
- **n8n-family**: `norm(name)` starts with `lead(v) + " "` **and** the name is
  address-shaped (contains a comma and a UK postcode or a leading street number).

Each matched row carries its evidence: the execution id, the email date, the exact
string that proved it.

Ben's rule, applied at group level:

> an exact match whose duplicate holds nothing but a name → delete both.
> a duplicate that holds information → keep it, and send it through stage B.

So n8n-ness deletes a *bare* row and never deletes a row carrying data. A fabricated
name that somebody later filled in is a real venue record now.

### B. Collapse

The key is `lead(name)` — the normalised text before the first comma. This is an
**equality on a derived key, not a similarity**, so it cannot chain: `the grand hall`
groups only with `the grand hall`. Handoff §4's transitive-clustering disaster (Royal
Albert Hall + British Museum + 3,406 others in one cluster) is structurally impossible
here.

Within a key, partition by full normalised postcode:

- one locatable partition + the unlocatable rows → shells fold into the locatable row.
- two or more locatable partitions → **hold**. Same name, different postcode. No data
  settles it; Battersea `SW11 8DD` vs `SW11 8BZ` is two real buildings or one typo and
  the snapshot cannot say which.

### C. Election, and the outlier rule

`richness(p)` = populated count of `[address, city, zip, alias, lat, lng, note, region]`.

- All members bare → survivor is the **lowest id**: the oldest row, the one the most
  orders already stand on.
- Otherwise → richest wins, ties to lowest id — **except** that an outlier may not win.

> if there's 30 duplicates of a venue and only one has more information, but it also
> has *different* information than the other ones, you will not select that one.

An **outlier** is a member whose postcode or city contradicts a group consensus that
has at least two supporters. It is excluded from the election and it is never deleted;
the group is flagged `hold` so a person looks at it. A row that is merely richer than
its peers and agrees with them is not an outlier — it is the answer.

### D. Usage keep-guard

The 09-18 handoff concluded a venue's usage cannot be read back, because OnSinch carries
no `place_id` on an order. True of OnSinch. **Not true of this repo**: `order_records`
and `tickets` both carry `thread_id` *and* `place_id`.

```
order_records  347 rows, 311 with place_id, 173 distinct
tickets        747 rows, 393 with place_id, 199 distinct
```

That is a partial usage map — engine-created orders only — so it is a **keep-guard, not
a delete-licence**, exactly as handoff §4 requires ("zero references is permission to
delete, never a reason to"). A referenced row that loses an election is **deactivated**,
never deleted. Deletion is reserved for rows that are bare, unreferenced, and either
n8n-proven or a duplicate of a row that survives.

`6922 "No Location"` is exempt from every stage.

### E. Actions

Exactly one of `keep` / `delete` / `deactivate` / `hold` per row, exactly one `keep`
per group. `DELETE /places` is known to report success on rows it did not delete
(`4f0f795`), so the apply step re-reads every id it deleted and reports the difference.

---

## 4. The sample, and the 0.3% bound

The population is rows carrying a destructive action. Strata:

| | |
|---|---|
| `proven` | n8n-backed, every member bare |
| `shell` | no n8n evidence, every member bare |
| `absorb` | shells folding into one locatable row |
| `merge` | two or more members carry data |
| `hold` | outliers, same-name-different-postcode |

Sampling is per stratum, without replacement, and the bound is computed over **rows**,
because the rate Ben asked about is per-venue in the final set.

With `k` defects found in `n` audits of a stratum of `N` rows, the 95% upper bound on
the defect count `D` is the largest `D` for which `P(X ≤ k | N, D, n) > 0.05` under the
hypergeometric. Summed across strata and divided by total rows, that is the number the
UI shows. The review stops when it reaches 0.3%.

**A homogeneous group counts in full.** If every non-survivor in a group is identical to
every other in all fields but `id`, auditing one member is not a sample of the group —
there is no variance in it to sample. The 180 identical `The Grand Hall, 50 Crown Street`
rows are one audit that discharges 180 rows. This is what makes 0.3% reachable in one
sitting instead of ~1,000 individual approvals.

---

## 5. Build order

| file | holds |
|---|---|
| `scripts/venue-sweep2.ts` | every pure function above, and the phases |
| `test/venueSweep2.ts` | the rules, against fixtures — outlier, non-chaining, sentinel |
| `scripts/venue-review.mjs` | local server: cards, marks, live bound, apply |
| `app/lib/engine/onsinch.ts` | `patchPlaces` — deactivation has no route today |

Phases:

```
--provenance   n8n executions -> venue strings + evidence     (live read, n8n)
--snapshot     places + the order_records/tickets usage map   (live read, OnSinch+Neon)
--plan         provenance + snapshot -> decisions.json        (offline)
--review       serve the UI                                   (local)
--apply        only what was approved; read-back every delete (live WRITE, gated)
```

`--apply` is the only phase that writes, it refuses to run on an unapproved decision,
and it is not run by this session without Ben saying so.
