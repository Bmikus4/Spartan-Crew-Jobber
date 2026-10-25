# Label audit of "the 500" (OPERATING.md §6.5)

- Agent: `label-auditor` (Phase 0, read-only)
- Brief hash: `37c65576`
- Written: 2026-10-25T00:32:57Z (UTC, from `date -u` on the audit box)
- Repo state: branch `v2`, commit `6a98170`. No code or label was changed.
- Rows: `eval/label-audit.csv`, 98 hand-verified cases.

## Summary

**The labels are not clean enough to measure against.** Under the rulings now in force, 532 of
the 1,000 labels in the two sets are wrong: simple 196/500, update 336/500. One more is
genuinely ambiguous. That leaves 467/1000 (46.7%) clean, against the 99.5% §6.5 requires. So
fixing the eval set is the first Phase 1 task.

| | sample (hand-verified) | both sets (projected, see Method) |
|---|---|---|
| label correct | 40 / 98 | 467 / 1000 |
| label wrong | **57 / 98 (58.2%)** | **532 / 1000 (53.2%)**: simple 196/500, update 336/500 |
| genuinely ambiguous | 1 / 98 | 1 / 1000 |
| multi-opp | 0 | 0 |
| correct answer is NONE / not an inquiry, label says otherwise | 0 | 0 |

The sample has 59 misses and 39 hits, taken from all 45 templates and all 69
(set x template x hit/miss x reason) buckets. Misses are over-weighted on purpose, so the sample
rate is not the rate for the sets. The set rate is the projection in the right-hand column.

**Why the labels are wrong.** Every label was written by the generator on 2026-10-10 (commits
3699642 and 92f7256). On that day the oracle scored 494/500 on the simple set (3699642's message),
so the labels matched the business rules of that date. The rules have moved since and the labels
were never updated. Each error traces to a dated ruling (the table under "Rulings"). Two rulings
cover 496 of the 532:
- **Never the day alone (Ben 10-03 and 10-15; plan.ts:185, evidence.ts:2-3): 426 cases.** A
  change that names its booking only by the day goes to a person. 97 of these are in the simple
  set and 329 in the update set; 329 is 66% of the update set.
- **The two-week rule (Ben 10-15; plan.ts:54, plan.ts:770-775): 70 cases.** A new order whose
  first shift is 14 days or fewer after the email is for staff to create.

**The biggest sensitivity is a question for Ben.** Ben's 10-15 words, quoted at evidence.ts:2-3,
are: "Date plus other evidence (client, venue, times, crew) may link". If "client" alone counts as
the extra evidence, the 426 day-alone labels are right and the system is too strict. Even then,
106/1000 labels are wrong (893/1000, 89.3%, clean), which is still below 99.5%. The finding does not
depend on how this question is answered.

**The cases are generated, not real email.** generate.ts:1-11 says the people, companies and
venues are made up. Every case carries `source: "synthetic-by-construction"` (generate.ts:512),
uses the message id `sim-NNNN` (generate.ts:116), and comes from a seeded RNG (generate.ts:26-29).
The company ids are 9001-9012 (world.ts:10-24). None of those ids is among the 811 companies in
`.tmp-data/gold/companies.json`, none of the 11 domains appears in the gold companies or
messages, and none of the 7,289 gold messages has a `sim-` id. OPERATING.md:83-84 calls the 500
"real inquiries", which is false. It is also two separate sets, not one.

**NONE and not-an-inquiry cases exist only in the simple set.**
- Simple: 170 cases are new orders with no existing opp (NONE). Of those, 95 are labelled write
  and 75 handoff. 95 cases are not inquiries (thanks, a booking only in the quoted history,
  contacts or a meeting point), and 20 more are inquiries already booked. All 115 are labelled
  `none`, and all 115 labels are correct.
- Update: no NONE case and no not-an-inquiry case. Its 500 labels are 490 write and 10 handoff,
  and every case has an existing or a linked order.

**Current scores.** At 6a98170 the oracle scores simple 304/500 and update 154/500. The figures
227/500 and 114/500 were measured before 83e4972 fixed `plan.ts once()`, which had dropped the
fake world's methods. 83e4972's message gives 227 -> 304 and 114 -> 154.

## Method

1. A scratch script (since deleted) ran `generate(500, 20261010)` and
   `generateUpdate(500, 20261012)` through `runCase(c, oracleExtract(c))`, in-process with
   `closeNetwork([])`. That is $0, no `.env`, and the tracked reports were not touched. Each
   case's label is `c.expected`, and its answer is the recorded decision plus the ops written.
   Reproduce:
   ```ts
   // npx tsx x.mts   (x.mts at the repo root or under .tmp-v2/, imports adjusted)
   import { generate } from "./harness/adapters/spartan/generate";
   import { generateUpdate } from "./harness/adapters/spartan/generate-complex";
   import { runCase, oracleExtract } from "./harness/adapters/spartan/adapter";
   for (const c of [...generate(500, 20261010), ...generateUpdate(500, 20261012)]) {
     const { result, out } = await runCase(c, oracleExtract(c));
     console.log(c.id, c.template, JSON.stringify(c.expected), result.summary, JSON.stringify(out.written));
   }
   ```
2. Every case was put in a bucket by set, template, hit or miss, and either the miss reason or,
   for a hit with a new shift, whether the first shift is more than 14 days out. That made 69
   buckets. The sample takes the first and last case id of each miss bucket and the first of
   each hit bucket. U0238 and U0269 were added for a subgroup the full-set check found (item 4).
3. Each sampled case was read by hand: the newest message, the fake OnSinch orders, the label and
   the system's answer. Each was then judged against the rulings, and every ruling was checked
   for its source and date (git log -S on plan.ts).
4. Projection. In every bucket, the class turned out to be fixed by a mechanical criterion:
   - the first shift is 14 days or fewer after the email;
   - the email names its order by day only, with no R number, no thread link and no start, crew
     count or venue matching the booked shift that day;
   - a missing op is a time already on the shift.

   A script applied the same rules to all 1,000 cases and checked each criterion. One subgroup
   broke the template-level rule: in 10 "move a shift to another day, new times" cases the new
   start equals the booked start. That subgroup was split out, after which every miss satisfies
   its bucket's criterion. The projection is these rules applied to all 1,000 cases, and it is
   only as good as the 98 hand checks behind them.

## How the 500 were labelled (§6.5, first question)

- **Who.** The generator code: commit author Bmikus4, co-authored by Claude Opus 5, on 10-10
  (3699642 for the simple set, 92f7256 for the update set). No person labelled a case.
  83e4972 (10-23) only added the separate 40-case context set.
- **How.** Each template builds an email and its `expected` result together. generate.ts:6-8
  calls this "the BUSINESS answer, not what the code happens to do". The `rules` on each
  template are reader prompt rules (P1.R1-R18, harness/reports/01-discovery.md:232-249). They say
  which rules the email exercises, not why the outcome is what it is.
- **Circularity.** 160 labels take their positions from `plan.positionsFor`, the planner under
  test: 105 create_order or add_shift labels in simple and 55 add_shift labels in update
  (generate.ts:16, 141; generate-complex.ts:13). A crew-chief bug in plan.ts would move the label
  and the answer together.

## Rulings that make labels wrong

| ruling | source | whose | date | wrong, all 1000 | in sample |
|---|---|---|---|---|---|
| never the day alone: a change needs an R/J number, the link, or the day plus a start, crew count or venue | plan.ts:185; evidence.ts:2-3; threadState.ts:15; ticket S-0165 | Ben (quoted at evidence.ts:2-3) | 10-03, 10-15 (code 2e95eb6, 10-20) | 426 | 34 |
| two-week rule: new orders only if the first shift is more than 14 days out | plan.ts:54, plan.ts:770-775 | Ben (quoted at plan.ts:770-771) | 10-15 (061d388) | 70 | 6 |
| a PO with no order named is left off, not a card | plan.ts:838-842 | Ben ("1 in 50") | 10-11 (1bf6cde) | 10 | 2 |
| a quote naming its shifts is booked in To Confirm | plan.ts:472-474 | ops behaviour measured 9-13 Oct (S-0168) | 10-13 (689ea7e) | 8 | 2 |
| a time already on the shift is not a change | plan.ts:587-590 | engine rule; the generator has no guard for it (generate-complex.ts:171, 241, 250, vs generate.ts:181) | n/a | 7 | 4 |
| no request refused for its size (13 crew = 2 chiefs + 11) | plan.ts:61-67 | Ben | 10-15 (061d388) | 3 | 2 |
| a missing end is assumed and written on the order | assume.ts:2-4, plan.ts:550 | Ben ("better it exists than not") | 10-15 | 2 | 2 |
| an unknown venue is added as written | plan.ts:778-781, 797-798 | ops behaviour (S-0168) | 10-13 (689ea7e) | 2 | 1 |
| the sender's exact address names one client even on a shared domain | resolve.ts:113-122 | engine rule | 10-21 (abcd875) | 2 | 2 |
| two venues with one name: one is booked and the choice flagged | plan.ts:788-795 | Ben | 10-15 (115681a) | 1 | 1 |
| no venue written: booked at "No Location" (place 6922) | plan.ts:813-819 | Ben | 10-15 | 1 (a hit) | 1 |
| total | | | | **532** | **57** |

Three of these rest on engineering or measured ops behaviour, not on Ben's words: the quote
rule, the unknown-venue rule and the exact-address rule (12 cases). The no-op rule (7 cases) is
plain correctness, since the label asks for a write that changes nothing.

## Per template (all 1000)

hit = the oracle's answer equals the label. The class columns are the projection.

| set | template | branch | label | n | hit | miss | sampled | correct | wrong | ambiguous |
|---|---|---|---|---|---|---|---|---|---|---|
| simple | new booking | P26 | write | 65 | 20 | 45 | 3 | 20 | 45 | 0 |
| simple | new booking with a PO | P26 | write | 15 | 2 | 13 | 3 | 2 | 13 | 0 |
| simple | two shifts in one email | X10 | write | 15 | 3 | 12 | 3 | 3 | 12 | 0 |
| simple | time change by R number | P10 | write | 25 | 25 | 0 | 1 | 25 | 0 | 0 |
| simple | time change by day | P6 | write | 20 | 2 | 18 | 3 | 2 | 18 | 0 |
| simple | time change by weekday alone | G5 | write | 10 | 1 | 9 | 3 | 1 | 9 | 0 |
| simple | longer shift by hours | P11 | write | 15 | 0 | 15 | 2 | 0 | 15 | 0 |
| simple | crew total | P13 | write | 15 | 0 | 15 | 2 | 0 | 15 | 0 |
| simple | crew increase | P14 | write | 15 | 0 | 15 | 2 | 0 | 15 | 0 |
| simple | cancel a shift | P19 | write | 15 | 0 | 15 | 2 | 0 | 15 | 0 |
| simple | PO for a named order | P28 | write | 15 | 15 | 0 | 1 | 15 | 0 | 0 |
| simple | add a shift to a named order | P20 | write | 10 | 10 | 0 | 2 | 10 | 0 | 0 |
| simple | quote request | X3 | handoff | 25 | 17 | 8 | 3 | 17 | 8 | 0 |
| simple | vague crew change | G4 | handoff | 15 | 15 | 0 | 1 | 15 | 0 | 0 |
| simple | new booking, no venue | P24 | handoff | 10 | 10 | 0 | 2 | 9 | 1 | 0 |
| simple | new booking, unknown venue | P25 | handoff | 10 | 7 | 3 | 3 | 7 | 3 | 0 |
| simple | new booking, no end time | G11 | handoff | 10 | 8 | 2 | 3 | 8 | 2 | 0 |
| simple | new booking, 13 crew | P17 | handoff | 5 | 2 | 3 | 3 | 2 | 3 | 0 |
| simple | crew change crossing the crew-chief line | P16 | write | 10 | 0 | 10 | 2 | 0 | 10 | 0 |
| simple | booking from a personal address | P1 | handoff | 10 | 10 | 0 | 2 | 10 | 0 | 0 |
| simple | booking from a shared domain | P1 | handoff | 5 | 3 | 2 | 3 | 3 | 2 | 0 |
| simple | another client's R number | P3 | handoff | 15 | 15 | 0 | 1 | 15 | 0 | 0 |
| simple | two R numbers | P2 | handoff | 5 | 5 | 0 | 1 | 5 | 0 | 0 |
| simple | two orders that day, no venue | P8 | handoff | 10 | 9 | 1 | 2 | 9 | 0 | 1 |
| simple | change on a day with no booking | P9 | handoff | 10 | 10 | 0 | 1 | 10 | 0 | 0 |
| simple | PO with no order named | P29 | handoff | 10 | 0 | 10 | 2 | 0 | 10 | 0 |
| simple | thanks | X1 | none | 50 | 50 | 0 | 1 | 50 | 0 | 0 |
| simple | booking only in the quoted history | X11 | none | 20 | 20 | 0 | 1 | 20 | 0 | 0 |
| simple | contacts and meeting point | X1 | none | 25 | 25 | 0 | 1 | 25 | 0 | 0 |
| simple | already booked | P22 | none | 20 | 20 | 0 | 2 | 20 | 0 | 0 |
| update | change the derig by name | P9 | write | 40 | 0 | 40 | 2 | 0 | 40 | 0 |
| update | change one of two shifts by its start | P9 | write | 40 | 40 | 0 | 1 | 40 | 0 | 0 |
| update | two changes on two days | X10 | write | 40 | 7 | 33 | 4 | 7 | 33 | 0 |
| update | crew up across the chief line | P16 | write | 40 | 0 | 40 | 2 | 0 | 40 | 0 |
| update | crew down across the chief line | P16 | write | 30 | 0 | 30 | 2 | 0 | 30 | 0 |
| update | move a shift to another day, same times | P10 | write | 45 | 0 | 45 | 2 | 0 | 45 | 0 |
| update | move a shift to another day, new times | P10 | write | 40 | 0 | 40 | 4 | 10 | 30 | 0 |
| update | add a shift at one venue of two | P21 | write | 40 | 40 | 0 | 2 | 40 | 0 | 0 |
| update | cancel one shift of several | P19 | write | 35 | 0 | 35 | 2 | 0 | 35 | 0 |
| update | stand crew down | P13 | write | 40 | 0 | 40 | 2 | 0 | 40 | 0 |
| update | times on a shift with a second trade | P10 | write | 30 | 8 | 22 | 4 | 8 | 22 | 0 |
| update | every shift of an order at once | X10 | write | 40 | 19 | 21 | 5 | 19 | 21 | 0 |
| update | change on a linked thread, two orders that day | P4 | write | 15 | 15 | 0 | 1 | 15 | 0 | 0 |
| update | new shift on a linked thread | P4 | write | 15 | 15 | 0 | 2 | 15 | 0 | 0 |
| update | new shift on a linked thread whose order cannot be read | P4 | handoff | 10 | 10 | 0 | 2 | 10 | 0 | 0 |

## Judgment calls the re-check should look at

- **Day alone, and what counts as the "one more fact".** In the hits, the asked start equals the
  booked start, for example S0120, S0141, U0081, U0390 and U0420. Those were counted as the
  day-and-start fact, so the label is correct. Three day-alone groups carry something that a
  looser reading might count as the extra fact, though none of it is in the ruling's list
  (plan.ts:185; app/lib/help/knowledge.ts:42):
  - change the derig by name (40): the shift's name;
  - longer shift by hours (15): "currently 4 hours";
  - second trade (21): "crew and carpenters".

  They are classed as label wrong. If the re-check disagrees, they are the first 76 to move.
- **S0356, the one ambiguous case.** The client has two orders that day. The asked new start,
  06:30, equals one order's booked start, and the system wrote to that order. That is a guess at
  which of two jobs is meant, which is the risk the day-alone ruling names. So the label's
  handoff is defensible and the system's write is defensible, and neither is clearly right.
- **Hits counted correct for a different reason.** 46 hits are handoffs whose kind is right only
  because of the two-week rule: 17 quote requests, 9 with no venue, 7 with an unknown venue, 8
  with no end time, 2 with 13 crew and 3 from the shared domain. The reason each label was
  written for no longer holds. If the rule is switched off (`create_lead_enabled`, process.ts:505) or the lead days
  change, these become wrong too.
- **S0277 is wrong although it is a hit.** No venue written, 20 days out: the answer is a write at
  "No Location". The harness matches the label only because `world.ts:30-36` has no such place.

## Findings that are not label errors (for failure-taxonomy and harness owners)

1. **A move to a new day loses its order.** In 10 update cases (U0238 to U0269) the label is
   correct and the system is wrong. The evidence finder searches the new day, because plan.ts:229
   takes `r.date` before `r.target.date`, so the old day's booked start is never matched.
2. **The fake world cannot test the No Location rule.** world.ts:30-36 has no "No Location"
   place, while the real data has exactly one (id 6922 in `.tmp-data/gold/places.json`).
3. **A correct shared-domain write fails the isolation gate.** Those cases set `company_id: null`
   (generate.ts:341, 349), so score.ts:33 marks any write as `inv.client_isolation = 0`. That
   includes S0333 and S0334, which write for the sender's own company. A hard gate fails on a
   correct answer.
4. **The update generator has no same-times guard.** It can ask for times a shift already has
   (generate-complex.ts:171, 241, 250); generate.ts:181 guards against this in the simple set.
   The result is the 7 no-op labels.
5. **The update set cannot measure NONE or not-an-inquiry** (see Summary). §6.5 requires both;
   only the simple set has them.

## CSV columns

`case_id, set, expected, system_answer, class, reason`.
- `expected` is the label: its kind and its ops by slot, shift and order id.
- `system_answer` is the recorded decision kind, its reasons.ts code, the planner's stated
  reason and the ops written. Sender addresses are redacted.
- `reason` starts with `[template; hit|miss]`, then names the ruling or rule with its file:line.
- No email body, address, person's name or company name is written. Companies appear only as
  numeric ids, places as ids, and orders as fake ids or R numbers.
