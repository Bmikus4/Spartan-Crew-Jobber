# A to B — what it would take to reach 99%, ranked by measurement

This is §5 of the 2026-09-15 handoff, and it is late: §4's number existed only as
instruments until 2026-09-16. Everything below comes from `npx tsx study/scoreE2E.ts`,
which scores the 638-thread live test set against what OnSinch holds, and from the
adversarial harness in `study/adversarial.ts`. No figure here is an estimate unless it
says so.

## The rule that decides every number in this file

**Score only where the engine did not write the thing being scored.** Of the 178 threads
bound to a live OnSinch order, 141 are bound to an order **staff raised** — the engine
found it, had no hand in its company, dates or venue, and comparing against it is
independent evidence. The other 37 are the engine's own creates or have no provenance
record; there the order's company *is* the company the engine chose. Scored together they
give one flattering number. They are never summed.

Every metric also runs a second time against **deranged pairs** — each decision scored
against a random other thread's order. The gap between the two is the evidence. A metric
within 15 points of its own shuffle is reading agreement the data creates, and the scorer
refuses to quote it.

## Where the system actually is, measured 2026-09-16

| mechanism | measured | control | reading |
| --- | --- | --- | --- |
| company binding | **141/141, 100%** | 3.5% | solved; do not touch |
| date containment | **122/122 not falsified** | 9.8% | nothing disproved |
| venue *text* (raw) | 113/124, 91.1% | 1.6% | the metric is wrong, not the engine |
| venue *text* (adjudicated by hand) | **122/124, 98.4%** | — | 2 real misses |
| linking — one order, two different jobs | **0 of 178** | — | bar met on this population |
| binds pointing at a deleted order | **109 of 287, 38%** | — | **the largest number in the system** |
| classification | **unmeasured** | — | 256 of 638 called `not-a-job` on no evidence |
| crew / block shape | **unmeasurable** | — | hard API gate |
| the four labels | **unmeasured, no instrument** | — | |

## The ranking

Ranked by *points of end-to-end accuracy per unit of work*, which is not the same as by
how interesting the problem is. Venue was expected to top this list. On the half that can
be measured, it does not.

### 1. Binds that point at a deleted order — 109 of 287, 38%

The biggest number by an order of magnitude, and it splits in two:

- **70 are `matched`** — orders *staff* raised, which the engine linked to and which were
  later deleted. The engine did nothing wrong at the time.
- **30 are `api_response`** — orders the engine itself created, since deleted. This is the
  same wound measured separately on 09-15: 105 of 133 engine-created orders gone, and **67
  of those have another order for the same company on the same work date living today** —
  somebody redid the work by hand.
- 9 have no provenance record.

**Why it is first:** a thread holding a dead order id is not a cosmetic problem. The
identity rule reads that id to decide whether a change amends an existing order or opens a
new one, so every one of these threads will get the next amendment wrong. It is also the
only measured number that represents *work a human had to redo*.

**What the work is, and it is not one job:**
- The reconciliation sweep (`/api/reconcile`, now scheduled daily at 06:00) already detects
  a dead bind and re-matches. It has never been scored on this population. **First step is
  to run it against these 109 and count how many it recovers** — the answer may be most of
  them, and the ranking below it changes if so.
- For the 30 the engine created: find out *why* they are deleted. It is not yet established
  whether staff delete them because they are wrong, because they are duplicates, or as a
  routine step. That is a question for Ben, not for the code, and it is the cheapest
  possible next move.

**Estimated ceiling:** unknown until the sweep is scored. **Cost:** one scoring run, free.

### 2. Classification — 256 of 638 threads called `not-a-job`, on no evidence at all

**Nothing measures this.** OnSinch holds no opinion about whether a thread was a job, and
labels produced by a model and scored by a model are a mirror. `data/testset/truth.jsonl`
holds 11 classification rows read by hand — a sample, not a measurement.

It sits second because of its size: 40% of every thread the engine sees ends here, and a
`not-a-job` is silent. A wrong `new-job` gets noticed when an order appears; a wrong
`not-a-job` is a booking that never happened and nobody knows.

**The falsifier that would work, and does not need labels:** a thread called `not-a-job`
whose client has an order in OnSinch on a date the thread names. That is objective, needs
only a full order pull, and would put a floor under the error rate. **This is the single
highest-value instrument still unbuilt.**

**Cost:** one order pull plus a date/company join. No model calls.

### 3. The four labels — the one mechanism in §4's table covered by nothing

`Order Built`, `Order Updated`, `Order Needs Built`, `Order Needs Updated` are the system's
only output to a human. A label claiming work is outstanding on a thread that is done, or
absent on one that needs attention, is invisible to every instrument that exists.

**Cost:** a Gmail read of the four label ids against `conversation_state.status`. Cheap.
**Why third and not first:** it is a reporting surface, not a booking. It misleads a human;
it does not lose a job.

### 4. Venue `place_id` resolution — invisible, and the identity rule depends on it

Venue *text* is 98.4% on the measurable population. That is the half that can be seen.
The half that cannot: `Slot.slotlocation_id` is not `place_id`, no endpoint joins them, so
**the venue the engine resolved to cannot be compared to the venue the order carries.**

This is not a small caveat. `matchExistingOrder` can only refuse a sole candidate on a
STRONG venue disagreement — both sides resolved, resolved differently — precisely because
our own place resolution is not trusted. Every loosening in that gate traces back here.

The two real text misses are informative and are not the same fault:
- `1a0145debd40cf38` — read "Emirates Stadium", resolved `place_id` 150, order says
  **Wentworth Golf Club**. Confident and wrong.
- `19f604174efcf58f` — read "Fairmont Windsor", order says **Masion Estelle**. No
  `place_id` resolved at all.

**The work:** score resolution against a hand-built gold set of (text → correct place_id),
which is the only ground truth that exists for it. `study/venuegold.ts` and
`study/venuebench.ts` were built for this in September and are the place to start.
**Cost:** real — a gold set has to be made by hand.

### 5. Company matching — 100%, leave it alone

141 of 141 against a 3.5% control. There is no work here and any change risks the one
mechanism that is measurably finished.

### 6. Dates — nothing falsified, leave it alone

122 of 122 request dates fall inside the order's job span, against a 9.8% control. Note
what this does **not** say: the span is the aggregate across every block, so a date inside
it is consistent with a wrong answer. It is a floor, not a score. The year-roll rules have
their own adversarial cases in `study/adversarial.ts` and they pass with controls.

## What is a hard gate and does not count against 99%

- **Crew and block shape.** Block sizes are readable only where a seat is staffed; an
  unstaffed block returns no attendance rows at all, and the audit tree carries no day, no
  venue and no size. 5 of 14 staff-raised orders are that shape. This is the API.
- **Venue as carried by the order.** No join exists between `place_id` and anything an
  order exposes.
- **An OnSinch write leaves no audit row**, which is why reconciliation re-asserts rather
  than verifies.

## The honest summary

On everything currently measurable, the engine is at or near the bar: company 100%, dates
not falsified, venue text 98.4%, linking 0 wrong binds out of 178. **The 99% claim cannot
be made, and not because the engine misses — because three of the eight mechanisms in §4's
table have no instrument at all**, and one of them (classification) decides the fate of 40%
of all traffic.

So the next work is not accuracy work. It is **two cheap instruments** — the `not-a-job`
falsifier and the label check — and **one scoring run** against the 109 dead binds. Only
after those does it make sense to spend a day on the resolver.

**Nothing in this file is a reason to change engine behaviour yet.** Measure first.
