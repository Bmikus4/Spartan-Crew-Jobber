# The 500-booking corpus study — pre-registration

**Written before the run, and committed before the run.** That is the whole point of this
section: a study whose hypotheses are written afterwards is a description of whatever
happened, and it will always conclude that what happened was fine.

Ben, 2026-08-24: *"run a 500 job corpus study, real jobs booked into onsinch, half of them
amended jobs of various degrees. Clear data collection protocols in place to catch all edge
cases, potential hiccups, errors. everything. THEN WE GO LIVE."*

---

## 1. What is being measured, and what is not

**Under test:** the deterministic engine and the OnSinch API together — composition, the
chief bands, venue and profession resolution, the hold conditions, the create path, and the
amend / replace / patch ladder, against the live tenant.

**NOT under test: the language model.** The reasoner is scripted, exactly as `sim/run.ts`
scripts it. That is deliberate and it is not a shortcut:

- A live model call adds a second variable to every failure. "Wrong crew size" would mean
  either the model misread the email or the engine mis-composed it, and one blended accuracy
  number cannot be acted on.
- It costs money. A corpus run in this account once cost $57 in a night. This run costs **£0
  in model spend**, and that is a property worth keeping rather than a corner cut.

Extraction accuracy is a separate question with a separate instrument and a separate bill.
When it is measured, it will be on a small priced subset with the figure agreed first.

## 2. The population

500 cases. **250 are amended** — a second email that changes the booking — and 250 are not.

Every case is a real order on **OnSinch company 515, "TEST - Eventz"**, created through
`handleThread` exactly as an arriving email would, and deleted afterwards.

### Known limits of the population, stated up front

- **One client.** Everything runs on the test company, so company resolution, rate-card
  derivation from history, and the new-client path are NOT exercised. `sim/run.ts` covers
  those offline against three synthetic clients; this study does not.
- **Perfect extraction.** The scripted reasoner returns exactly what each case declares, so
  every misread-email failure mode is out of scope by construction.
- **R numbers are consumed.** 500 orders take 500 numbers from the tenant's shared sequence.
  OnSinch reissues `max(live)+1` after a delete, so the numbers return when the study cleans
  up, but Spartan's real bookings raised during the run will sit above the block.

## 3. Hypotheses, with the number that would falsify each

Stated as thresholds, before the data exists. **A metric below its threshold means NOT
READY, and the recommendation at the end must say so.**

| # | Hypothesis | Metric | Ready | Not ready |
|---|---|---|---|---|
| H1 | An order the engine composes is accepted by OnSinch | creates accepted / creates attempted | ≥ 99% | < 97% |
| H2 | The crew that reaches OnSinch is the crew the client asked for | orders where written headcount = requested | 100% | any miss |
| H3 | A crew change reaches the order it belongs to, in place | amendments applied in place / amendable amendments | ≥ 95% | < 90% |
| H4 | An amendment does not cost the R number | R survived / amendments that are not a dropped block | 100% | any loss |
| H5 | A dropped block falls back to rebuild and says so | dropped-block cases taking the replace path | 100% | any silent no-op |
| H6 | Nothing is reported as done that did not happen | cases where the engine claimed success and the job window disagrees | 0 | any |
| H7 | A TBC booking is held, never written | TBC cases reaching OnSinch | 0 | any |
| H8 | The engine leaves no orphan | orders created and not accounted for in the ledger | 0 | any |

H6 is the one that matters most and the hardest to satisfy: **a 204 is not proof**. See §5.

## 4. The factors, crossed on purpose

Not drawn at random. A boundary is not something a sample finds; it is something a design
puts a case on either side of.

- **crew size** 1, 2, 3, 4, 5, 9, 10, 11, 19, 20, 21, 30, 40 — the chief bands are 4/10/20
  and every edge is tested from both sides
- **blocks per order** 1, 2, 3 — single, build+derig, and a three-part day
- **shift shape** under 4h, exactly 8h, over 12h, crossing midnight
- **times stated** fully / start only / not at all (TBC — expected to HOLD)
- **venue** a rich row, the ExCeL shell text (601 duplicate rows against one real), the "RAH"
  short alias, a venue that does not exist yet, per-block venues
- **profession wording** general crew, carpenter, rigger, forklift, "porter" (not a role),
  IPAF
- **task text** short, exactly 80 characters, 81 characters (the live 400), punctuation

### The nine amendment shapes, evenly spread across the 250

| shape | what it exercises | expected |
|---|---|---|
| grow a block | the common case | amend in place, R survives |
| shrink an unstaffed block | the refusal that should NOT fire | amend in place |
| move the start | window moves | amend in place |
| move the end | **provable by the job window** | amend in place, PROVEN |
| change venue | a field nothing can read back | amend, ACCEPTED only |
| change profession | same | amend, ACCEPTED only |
| reword the task | the case that used to double the crew under name-pairing | amend in place |
| add a block | the appended id must join the record | amend + append |
| drop a block | OnSinch cannot remove a slot team | replace, R number CHANGES |

## 5. PROVEN versus ACCEPTED, and why every result carries one

OnSinch will show a block's **window** (`Job.min_beginning` / `max_end`) and the order's
top-level fields. It will show **nothing** of a block's size, venue, profession or name —
`GET /slotTeams` is 405 in every spelling.

So for those fields a `204` is the strongest evidence that exists, and the **job window is
the only oracle that cannot lie**, because it is derived from the blocks. Every row of the
results carries `PROVEN` or `ACCEPTED`, and the report totals them separately. Anyone who
reads "accepted" as "seen to land" is building on sand.

## 6. Data collection — what is recorded for every single case

Written to `.tmp-data/corpus/results.jsonl`, one line per case, **as it completes** rather
than at the end, so a crash keeps everything up to the crash.

- the case: id, every factor, the declared blocks, the amendment shape
- the expectation, computed independently of the engine
- what the engine did: status, notes, the action log, which path took it
- what OnSinch holds: order id, R number, job id, and the job window before and after
- the wire: every non-GET call and its status code
- errors: the exact API response body, not a summary of it
- timing per case

Every created order id is written to a ledger **before the call that creates it**, so an
order that exists is always an order the cleanup knows about (H8).

## 7. Execution and safety

- Company 515 only, hardcoded, asserted at start.
- A pilot of 10 runs first, with its cleanup verified, before the 500.
- Concurrency capped so the tenant is not hammered.
- `--cleanup` deletes every ledgered order and re-reads each to confirm it is gone.
- The engine's kill switch `SPARTAN_BLOCK_ORDER_REPLACE` is left alone; the drop-block cases
  need the replace path.

## 8. What the report must contain

`docs/CORPUS-STUDY-2026-08.md` is completed after the run with: results per hypothesis
against its threshold, per-cell counts (**observations, not rates — most cells hold 1–3
cases and a percentage over n=2 is a lie**), an error taxonomy ranked by what each class
costs in money or trust, the PROVEN/ACCEPTED split, the limits from §2 restated against what
was found, and a recommendation on going live **including the reasons against**.

---

# Results

*(filled in after the run)*
