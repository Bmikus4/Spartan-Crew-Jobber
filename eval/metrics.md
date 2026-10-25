# Metrics A and B, defined from the scoring code

- Agent: metric-definer
- Brief hash: 844d70d1
- Written: 2026-10-25T00:32:08Z (UTC, the machine's clock)
- Code read at: 6a98170 (branch v2). Pre-fix figures reproduced on a scratch copy of fb01342 (see section 8).

## Summary

**[METRIC A] 227/500 and [METRIC B] 114/500 are one metric run on two different generated case sets.**
The metric is the harness's `e2e` observation (harness/adapters/spartan/score.ts:36). It was run in
**oracle mode**: the model was replaced by each case's own ground-truth reading
(harness/adapters/spartan/adapter.ts:20). It ran on code where the planner's world copy had dropped
the fake OnSinch's methods (fb01342, `once()` at app/lib/v2/interpret/plan.ts:423-431, `...w` spread).
- A = `e2e` on the **simple set**: `generate(500, 20261010)`, 30 templates, case ids S0000-S0499.
  It holds 245 cases where a write is expected, 140 where a handoff is expected and 115 where nothing is expected.
- B = `e2e` on the **update set**: `generateUpdate(500, 20261012)`, 15 templates, case ids U0000-U0499.
  It holds 490 cases where a write is expected and 10 where a handoff is expected.
- One case passes `e2e` when the decision's kind equals the expected kind. When the expected kind is
  `write`, the operations sent must also equal the expected operations, compared field by field on
  their essential fields (app/lib/v2/score.ts:18-31). The denominator is all 500 generated cases.
- I reproduced both numbers exactly, in-process, at $0: fb01342 gives A 227, B 114 (create 0).
  83e4972 (= 6a98170^) and HEAD give A 304, B 154 (create 171). These match ticket S-0216.

**The lead is confirmed, and it goes further.** Four points:
1. Nothing here is real mail. Every case is `source: "synthetic-by-construction"`
   (harness/adapters/spartan/generate.ts:512). OPERATING.md §2 says "500 real inquiries ... true baseline",
   and that is false on three counts: the cases are generated, they are not one set, and A's set includes
   115 non-inquiries.
2. The harness's own rule says oracle mode validates the harness and never scores the system
   (harness/README.md:48-49).
3. A 227 is inflated. **71 of its 227 passes were the planner crashing.** "The system could not
   plan this email" becomes a handoff (app/lib/v2/process.ts:458). `e2e` checks only the kind of a
   handoff, so a crash scores as a correct handoff when a handoff is expected. A's real passes before
   the fix were 3 correct writes, 58 correct handoffs and 95 correct nones. In all, the planner crashed
   on 236 of 500 simple cases, 40 of 500 update cases and 500 of 500 create cases.
4. Part of B's remaining failures is not error. 339 of B's 346 failures at HEAD carry code
   `booking_not_identified` ("no order is named"). Commit 83e4972 calls them stale expected answers
   (the expectations predate the "never the day alone" ruling). The metric cannot tell a stale
   expectation from a regression.

**Is B downstream of A? No.** The two sets are disjoint and independently generated, so no B outcome
depends on an A outcome. They shared a **common cause**, the `once()` bug, which broke both sets at
once. The dependency the §6.4 question is after sits *inside* `e2e`: a wrong order forces the
operations to be wrong. `e2e` folds that chain into one bit, so it cannot show which stage failed.

**Do A and B suit §4? No, not as the baseline. They do suit a $0 plumbing gate.**
- They do not measure the model.
- They do not use real mail.
- One bit per case merges §4's loss classes. At HEAD, A's 196 failures are 10 silent misses, 19 wrong
  writes and 167 flags. B's 346 failures are 1 silent miss, 6 wrong writes and 339 flags. A flag (an
  acceptable outcome under §4) costs exactly as much as a wrong write.
- The expected crew split is computed by the code under test (`positionsFor`, generate.ts:16 and
  generate-complex.ts:13), so a crew-split regression cannot fail.
- `test/harnessGate.ts` gates floors (304/171/154) set on unverified expectations. It does not gate
  oracle-set wrong writes (19 + 6 at HEAD) or the client-isolation invariant (2 violations at HEAD,
  S0333 and S0334, both artefacts of how the case was built; see 5.4).

I propose the §4 metrics as replacements, computed on the real gold set from production's stored
decisions. The data for most of them already exists in .tmp-data/gold/truth.jsonl, which carries
both the staff-action label and production's decision. A first cut, on labels that have not been
audited:
- inquiry_recall: 194/298 = 65.1%.
- silent misses: 104 of 298. Of these, 79 are `none_nothing_to_do`.
- review_rate: 207/275 = 75.3%.
- client agreement: 186/189.

No existing tool computes inquiry_recall, item_correctness, display_precision, client_resolution_accuracy,
recall@5 or none_precision as A.3 defines them. The nearest are:
- `week-review` missed changes (live), for silent_miss_count;
- `weights.mts` link/new accuracy (offline matcher), for selection and none_recall;
- `score.ts judge()` (by value), for action_accuracy.

No scoring code was changed.

---

## 1. Exact definitions

### 1.1 The observation

`score()` (harness/adapters/spartan/score.ts:26-45) returns eight 1-or-0 observations per case. A and B
count only the `e2e` node (harness/run.ts:93; harness/core/report.ts:33):

```
kind     = out.recorded?.kind ?? null                         score.ts:29  (Recorded.kind = decision.kind, process.ts:321, :460)
opsRight = exp.kind !== "write" || sameOps(out.written, exp.ops)   score.ts:30
e2e      = kind === exp.kind && opsRight                       score.ts:36
```

- **What is compared.**
  - `out.recorded` is the last record `decideMessage` wrote (adapter.ts:60).
  - `out.written` holds every operation passed to the fake runner. The runner returns `verified` for each
    (adapter.ts:59), so `written` equals the decision's ops in full (process.ts:397-405).
  - `exp` is the case's `expected`, built by the generator: `{kind: write|handoff|none, intents, ops}`.
- **How a match is decided** (app/lib/v2/score.ts:18-31; the harness re-exports it, score.ts:12).
  - Each op is reduced to `essentials(op)`, turned into a JSON string, and the list of strings is sorted.
    Two plans match when the sorted lists are equal, duplicates included.
  - Fields kept per kind: `create_order` keeps company_id, client_email, po and its shifts sorted by date
    and start. Each shift keeps date, start, end, place_id and positions **verbatim**. `set_position_times`
    keeps order, slot, date, start and end. `set_position_size` keeps order, slot and size. `set_po` keeps
    order and po. `cancel_position` keeps order and slot. `add_shift` keeps order, location, date, start,
    end and positions. `add_position` keeps order, shift, date, start, end and position.
  - Fields ignored: company_name, job_name, place_label and shift name.
  - Because `positions` is compared as raw JSON, the crew split and the key order inside each position
    both count. This is stricter than the weekly scorer's `bookingKeys`, which ignores the split
    (score.ts:59-69).
- **When nothing is written.** For an expected `handoff` or `none`, only the decision kind is
  compared. Reasons, codes, `order_id` and `found` are not checked.
- **Denominator.** Every generated case: N = 500 (harness/run.ts:26). The preflight checks that exactly
  500 were generated (run.ts:60).
- **Reader.** In oracle mode the extractor returns `structuredClone(c.input.oracle)`, the reading a
  perfect model would give (adapter.ts:20-23). `ai.intent` is then trivially 500/500.
- **Clock.** The harness passes no `now`, so `today` is null in the planner (plan.ts:520). Lead days
  count from the email's own date (plan.ts:774-775). The figures do not drift with the calendar. Three
  runs gave the same numbers, and they match the gitignored results on disk from 2026-10-24T02:55Z.

### 1.2 The two sets

| | A | B |
|---|---|---|
| Generator | `generate(500, 20261010)`, TEMPLATES generate.ts:152-462 | `generateUpdate(500, 20261012)`, UPDATE generate-complex.ts:146-257 |
| Templates | 30 | 15 |
| Expected kinds | write 245, handoff 140, none 115 | write 490, handoff 10 |
| Fake OnSinch | 12 made-up companies, 10 places (world.ts) | same world, one order per client in most templates |
| Case ids | S0000-S0499 | U0000-U0499 |
| Sent dates | from 2026-10-12, 40 per day (generate.ts:504-506) | same |

### 1.3 Where the numbers came from

The S-0216 headline (public/data/feed.json) records them as before-values:
"simple 227->304, create 0->171, update 114->154 of 500". Commit 83e4972 says "Perfect reader".
The bug ran from 10-20 to 10-24 (plan.ts:427 at fb01342, explained in the comment at HEAD plan.ts:425-428
and in test/harnessGate.ts:4-6). Any oracle run in that window gives these numbers.

## 2. Reproduction (for the orchestrator)

$0, no network: the script closes `fetch` and refuses to start if any production secret is present.
It never runs harness/run.ts, so no tracked report is rewritten.

```
mkdir -p .tmp-v2/repro/pre && git archive fb01342 app harness | tar -x -C .tmp-v2/repro/pre
# .tmp-v2/repro/e2e.mts
import { pathToFileURL } from "node:url"; import { resolve } from "node:path";
const root = resolve(process.argv[2]); const imp = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const pf = await imp("harness/core/preflight.ts");
if (pf.PRODUCTION_SECRETS.some((k: string) => (process.env[k] ?? "").trim())) process.exit(2);
pf.closeNetwork([]);
const g = await imp("harness/adapters/spartan/generate.ts"), gc = await imp("harness/adapters/spartan/generate-complex.ts");
const ad = await imp("harness/adapters/spartan/adapter.ts");
for (const [name, cases] of [["A simple", g.generate(500, 20261010)], ["B update", gc.generateUpdate(500, 20261012)], ["create", gc.generateCreate(500, 20261011)]] as const) {
  let k = 0; for (const c of cases) { const { result } = await ad.runCase(c, ad.oracleExtract(c)); k += result.observations.find((o: any) => o.node === "e2e").ok; }
  console.log(name, `${k}/${cases.length}`);
}
npx tsx .tmp-v2/repro/e2e.mts .tmp-v2/repro/pre    # A 227/500, B 114/500, create 0/500
npx tsx .tmp-v2/repro/e2e.mts .                    # A 304/500, B 154/500, create 171/500
```

Measured:

| Code | A simple | B update | create | simple, mutant | A: wrong-write flags | B: wrong-write flags | A: isolation flags |
|---|---|---|---|---|---|---|---|
| fb01342 (pre-fix) | **227** | **114** | 0 | 225 | 1 | 6 | 0 |
| 83e4972 = 6a98170^ | 304 | 154 | 171 | 240 | 19 | 6 | 2 |
| 6a98170 (HEAD) | 304 | 154 | 171 | 240 | 19 | 6 | 2 |

## 3. What 227 and 114 are made of

**A at fb01342** (227 passes, 273 failures):

| | count |
|---|---|
| Passes: correct write | 3 of 245 expected writes |
| Passes: correct handoff, planner ran | 58 |
| Passes: correct handoff **because the planner crashed** (`placesNamed`/`orderByNumber is not a function`) | **71** |
| Passes: correct none | 95 |
| Fail: write expected, crashed into a handoff | 145 |
| Fail: write expected, "no order is named" | 97 |
| Fail: none expected, crashed into a handoff | 20 |
| Fail: handoff expected, got none ("PO ... left off: no order is named") | 10 |
| Fail: handoff expected, wrote | 1 |

The 71 crash-passes were spread across templates: quote request 25, another client's R number 15,
unknown venue 10, no end time 10, 13 crew 5, shared domain 5, no venue 1.

Commit 83e4972 counts "115 of 500 simple cases and 50 more" ending "could not plan". That is the
165 crashes that failed. The 71 that passed were not counted.

From A to HEAD: 227 + 95 cases now right − 18 cases now wrong = 304. The 18 were crash-passes that
now write where a handoff is expected: quote request 8, 13 crew 3, unknown venue 3, no end time 2,
shared domain 2.

**B at fb01342** (114 passes):
- Passes: 104 correct writes and 10 correct handoffs.
- Failures:
  - 339 "no order is named";
  - 40 crashes (`orderByNumber`);
  - 6 writes whose ops differ;
  - 1 none.
- From B to HEAD: 114 + 40 = 154. Nothing broke.

**At HEAD**, the failures by code:
- A: `booking_not_identified` 97 (write expected), `policy_lead_days` 70 (write expected),
  wrong writes 19, `booking_not_identified` none 10 (handoff expected).
- B: `booking_not_identified` 339, wrong writes 6, `none_already_as_asked` 1.
- create: `policy_lead_days` 329.

## 4. Is B downstream of A?

No.
- **Different populations.** A and B share no case: different generators, seeds and id prefixes.
  A wrong outcome on an S case cannot cause a wrong outcome on a U case.
- **Same instrument.** Both are `score.ts:36` over `decideMessage` with the oracle reader.
- **Common cause, not a dependency.** The `once()` spread broke both sets, along with every create case.
- **The chain is inside `e2e`.** Client, then order, then the change: a wrong earlier stage makes
  the later ones wrong. `e2e` scores the whole chain as one bit, and nothing in the harness records
  which link broke. The trace has it (adapter.ts:52, the `plan` event), but no score reads it.
  For prioritising, this matters more than the A-versus-B question.

## 5. Do A and B suit the purpose and the §4 loss function?

### 5.1 What §4 asks for

§4 ranks silent miss (worst), then wrong item, then noise, then flag. Its primary metrics are
`inquiry_recall` (over real inquiries) and `item_correctness` (over items shown), both on real mail.

### 5.2 Why A and B do not fit

| Requirement | A and B | Evidence |
|---|---|---|
| Real mail | Generated, templated, made-up companies | generate.ts:512, world.ts:12-27 |
| The model is under test | Replaced by the answer key | adapter.ts:20; README.md:48-49 |
| One population | Two different sets, so 227 and 114 are different rates | section 1.2 |
| Denominator = real inquiries or items shown | All cases, including 115 non-inquiries in A | section 1.2 |
| Loss classes kept apart | One bit; a flag weighs the same as a wrong write | score.ts:36; table 5.3 |
| A handoff is right for the right reason | Kind only; a crash passed 71 times | section 3 |
| Expected answers independent of the code | `positionsFor` from plan.ts builds the expected crew split | generate.ts:16, :141; generate-complex.ts:13, :28 |
| Expected answers current | 4 rulings postdate them (commit 83e4972); not verified case by case | S-0216 |
| Reading of "target 99%" | The report prints "End to end correct (target 99.0%)", which invites reading `e2e` as §4's 99% | run.ts:86, report.ts:33 |

### 5.3 The same HEAD runs, counted by §4's loss classes

The bottom four rows count items, not failures.

| HEAD, oracle | A simple | B update |
|---|---|---|
| e2e | 304/500 | 154/500 |
| Silent miss (an inquiry expected, decision `none`) | 10 | 1 |
| Wrong write (wrote; expected something else, or other ops) | 19 | 6 |
| Flag (write expected, handed off) | 167 | 339 |
| Noise (none expected, item shown) | 0 | 0 |
| inquiry_recall, synthetic | 375/385 = 97.4% | 499/500 = 99.8% |
| Write precision (right writes / writes) | 78/97 | 144/150 |
| review_rate (handoffs / items) | 278/375 = 74.1% | 349/499 = 69.9% |

### 5.4 What A and B are good for, and two gaps in the gate

A and B work as a $0 regression floor for the deterministic path: the crash showed up as create 0/500.
`test/harnessGate.ts` already gates them (floors at :25). Two gaps remain:

- **Oracle wrong writes are not gated.** The gate counts wrong writes only for the mutant
  (harnessGate.ts:47). On the oracle sets, 19 in A and 6 in B pass the gate.
- **`inv.client_isolation` is not gated anywhere.** At HEAD it fails on S0333 and S0334.
  - Both are the template "booking from a shared domain". It expects a handoff with `company_id: null`
    (generate.ts:345-350). The system created an order for company 9011.
  - The sender's address is an exact contact of 9011 in the fake world (world.ts:66). So these are
    artefacts of how the case was built, not cross-client writes.
  - Still, a hard-gate invariant is red and nothing goes red with it.

### 5.5 Proposal

Retire A and B as the baseline. Keep them, renamed `harness_e2e_oracle_{simple,update,create}`, as
harness-health floors. Make the §4 / A.3 metrics primary, computed on real mail from production's stored
decisions ($0 replay). Report the harness sets beside them as a second, synthetic tier, split by the
§4 loss classes.

## 6. Appendix A.3 metrics: what computes them today, and what would

Data paths are under .tmp-data/gold/ unless stated. "Gold" means truth.jsonl: 3,145 client emails,
each with a staff-action label `truth.{kind, confidence, orders}` and production's decision `prod`,
which is set for 741 of them (written by scripts/gold/truth.mts:221-222). "Item" means a v2 decision
of kind `write` or `handoff`. `none` makes no TV card (app/lib/feed/v2.ts:109).

The first-cut figures below use the firm work labels:
- kinds `existing`, `new-job` or `several`;
- confidence `strong`, `medium` or `adjudicated`, the weights.mts rule.

That leaves 298 emails that have a production decision. **The labels are unaudited** (that is the
label-auditor's job), so these figures are not a baseline.

| A.3 metric | Existing tool? | Code and data that would compute it | First cut on real mail |
|---|---|---|---|
| `inquiry_recall` | None. Nearest: week-review "missed changes" (live, one week). | Join truth.jsonl firm work labels with `prod.kind ∈ {write, handoff}`. Needs an inquiry label for emails staff did not act on (quotes, declined work): data/gold/adjudications.jsonl covers 147 emails. | 194/298 = 65.1% |
| `item_correctness` | None over items. Harness `e2e` covers expected writes only. `judge()` covers live or replayed writes by value. | Per item: order (ops order_id / `order_id`) ∈ `truth.orders`, or NONE when the label is new-job; and `judge(ops, truthKeys(staff acts))` (app/lib/v2/score.ts:72-124) on timeline.json + orders.json. Handoffs also need a correct order and request, which needs a per-card label. | Order part only: 29/29 items that name an order are in truth.orders, but only 29 of 103 items name one |
| `review_rate` | Partly. real-email-scoreboard prints "order left for a person" over writes plus those (replayed, replies excluded). week-review prints handoffs by code. | `handoff ÷ (write + handoff)` over decisions.json | 207/275 = 75.3% (truth.jsonl prod) |
| `display_precision` | None | Items whose email is a real inquiry ÷ items. Needs a not-inquiry label: gold has only `not-a-job/adjudicated` (13). `no-order-signal` (819) is not the same thing. | Not computable yet: 50 items sit on no-order-signal or not-a-job emails and need adjudication |
| `client_resolution_accuracy` | None. The harness has `inv.client_isolation`, but for writes only. | decisions.json `company_id` against `orders.json[truth.orders[0]].company_id` for firm existing labels. Do not use `truth.company_ids`: truth.mts derives it with the same `companiesOf` production uses, which is circular. | 186/189 same company; 15 decisions had no company |
| `recall@5` | No. features.mts gives recall at ALL candidates: 1,486/1,486, median 3, p90 11, max 36 (S-0212). | Rank features.jsonl candidates by app/lib/match/score.ts weights (`weights.mts --export` writes rank-rows.jsonl), then count how often the true order is in the top 5. This is the offline matcher, which no app code imports. The live planner gives no ranked list, so a production recall@5 needs its finder (threadState.findOrder) to expose candidates. | Not run |
| `selection_given_correct_candidate` | Effectively yes, for the offline matcher: weights.mts link_right/link_of 1,049/1,103 (S-0212), with candidate recall 100%. That candidate-recall denominator also counts inherited labels and leaves out adjudicated ones. | For production: the finder's pick on gold emails whose true order was among its candidates | Not run for production |
| `none_precision` / `none_recall` | Recall only, for the matcher: weights.mts new_right/new_of 386/419. Precision is not reported. | From the same rank rows: top = "none of these" with a link label is a false NONE. For production: `create_order` written or planned against a new-job label. | Production created an order for 23/94 firm new-job emails (67 handed off, 3 none) |
| `action_accuracy` | Partly. `judge()` verdicts in week-review (live) and score-vs-ops (replay), not conditioned on a correct order. | `judge()` restricted to items whose order is correct (above) | Not run |
| `silent_miss_count` | Yes, closest of all: week-review "missed changes" (32) + "lost emails" (0), live 10-14..10-21 (S-0217) | As inquiry_recall: firm inquiry with decision `none` or no decision | 104 of 298: `none_nothing_to_do` 79, `none_already_booked` 18, `none_already_as_asked` 4, other 3 |

The first-cut column comes from this script. Save it as `.tmp-v2/repro/real.mts` and run
`npx tsx .tmp-v2/repro/real.mts` from the repo root. It reads local data only:

```
import { readFileSync } from "node:fs"; import { coded } from "../../app/lib/v2/reasons.ts";
const t = readFileSync(".tmp-data/gold/truth.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const FIRM = new Set(["strong", "medium", "adjudicated"]), WORK = new Set(["existing", "new-job", "several"]);
const firm = t.filter((x) => x.prod && WORK.has(x.truth.kind) && FIRM.has(x.truth.confidence));          // 298
const items = firm.filter((x) => x.prod.kind !== "none");                                                  // 194
const misses = firm.filter((x) => x.prod.kind === "none").map((x) => coded({ kind: "none", reason: x.prod.reason } as any).code);
const all = t.filter((x) => x.prod), w = all.filter((x) => x.prod.kind === "write").length, h = all.filter((x) => x.prod.kind === "handoff").length;
console.log({ firm: firm.length, items: items.length, misses: misses.length, missCodes: misses.reduce((m: any, c) => ((m[c] = (m[c] ?? 0) + 1), m), {}), review: `${h}/${w + h}` });
```

## 7. Every other scoring tool in the repo, one line each

The v2 engine (live):
- **harness/run.ts + adapters/spartan/score.ts + core/report.ts**: A and B's instrument. Per generated
  case: `e2e`, `ai.intent` and six invariants, with Wilson intervals, in oracle, mutant, record or replay
  mode. Gitignored record runs from 10-11 died on OpenRouter 402: simple 352/500, update 494/500,
  create 496/500 (harness/runs/*-record-results.jsonl).
- **test/harnessGate.ts**: the oracle sets in the suite. It checks floors 304/171/154/40, the mutant's
  wrong writes = 0, and that every decision is coded. It does not check isolation or oracle wrong writes.
- **harness/adapters/spartan/review.ts**: renders failures for a person to tick. No number.
- **app/lib/v2/score.ts**: the shared comparators. `essentials`/`sameOps` serve the harness;
  `bookingKeys`/`truthKeys`/`judge` serve the weekly scorers; `fullyWritten`.
- **scripts/week-review.mts**: live v2 decisions in a window against staff's later OnSinch actions, by
  value. Reports wrong writes, coverage, missed changes and lost emails, with policy handoffs, replies,
  defaults and cut-short plans counted apart (S-0217).
- **scripts/score-vs-ops.mts**: every stored decision re-planned by the code on disk against staff
  actions, by value. Prints "done right X of Y" on emails with booking work against a 1% bar.
  `--paid` re-reads with the model.
- **scripts/real-email-scoreboard.mts**: stored readings re-planned. Counts writes, replies and orders
  left for a person, tallied by code. No truth.
- **scripts/ops-truth.mts**: builds the staff-action truth used by the two scripts above. Measures nothing itself.
- **scripts/gold/snapshot.mts**: reads the gold input from production (needs credentials). Measures nothing.
- **scripts/gold/truth.mts**: labels every client email from staff actions and reports the label
  distribution (S-0209, S-0212).
- **scripts/gold/features.mts**: offline-matcher candidate recall and how often each evidence family is available.
- **scripts/gold/weights.mts**: fits the matcher weights. Reports cross-validated top-choice accuracy
  (1,435/1,522), a coverage-accuracy curve with lower 95% bounds, and log loss.
- **scripts/gold/rules.mts**: looks for single and paired evidence conditions that are never wrong on
  300 or more gold cases. It found 0 that can be promoted.
- **scripts/gold/trees.py**: boosted trees against the logit on the same folds: 92.8-93.2% against 94.3%.
- **harness/sim/run.mts + onepass.mts**: a real-snapshot simulator of intake, decision and TV.
  `onepass` scores how often the finder names the wrong order when the thread's link is hidden.
- **app/lib/v2/metrics.ts**: the dashboard's activity figures. Not accuracy.
- **test/scoreStrict.ts, test/matchScore.ts**: unit tests of `judge()` and of the matcher score.

The legacy engine (app/lib/engine, paused; these drive `handleThread`/`compile` or its resolvers). Each
line is taken from the file's header:
- **audit/run.mts** (+ harness.mts, scenarios.mts, tenant.mts): the final-state scorecard of a
  135-scenario conversation audit on a fake tenant.
- **audit/selftest.mts**: attacks that harness to show it can fail.
- **audit/keydrift.mts**: how often the idempotency key disagrees with the message acted on.
- **sim/run.ts + sim/report.ts + sim/oracle.ts**: 100 stratified simulated bookings, offline.
- **sim/corpus*.ts**: a 500-booking corpus on the real TEST company 515 (`corpus-real` puts the model in the loop).
- **sim/live-write.ts, sim/live-amendment.ts**: live create and amend checks.
- **study/score.ts, study/scoreE2E.ts, study/real.ts, study/adversarial.ts, study/harness.ts**:
  conjunctive booking correctness, end-to-end against OnSinch, real mail judged blind, and adversarial cases.
- **study/venuebench.ts, venuecompare.ts, venuegold.ts, gold.ts**: the venue-resolver benchmark and its hand labels.
- **scripts/score-identity-rule.ts**: the legacy `matchExistingOrder` against live bindings.
- **scripts/resolver-shadow.mts**: the resolver against gold v0.
- **scripts/score-successor-recovery.ts**: whether the engine finds the job a deleted order became.
- **scripts/score-header-threading.mjs**: header threading against Gmail's grouping.
- **scripts/grade-brain.mjs**: the n8n is_job gate and the classifier against the real corpus.
- **scripts/triage-falsify.ts**: whether triage drops real jobs.
- **scripts/build-testset.ts, sample-testset.ts**: the legacy test set (638 threads) and its adjudication sample.
- **scripts/rnd-*.mjs**: the R&D study's figures and falsification tests.
- **scripts/health.ts**: subsystem health checks. Not accuracy.
- **test/professionGold.ts, test/venueGold.ts, test/triage.ts**: gold-set tests of the profession
  resolver, the venue resolver and triage.

## 8. Method notes

- The dispatch allowed a scratch copy of 6a98170^. That commit is 83e4972, which already contains the
  fix, so it reproduces 304/154 and not 227/114. The pre-fix code is 83e4972^ = fb01342. I extracted
  both, read-only (`git archive ... | tar -x` into .tmp-v2/), and ran both. The working tree was not touched.
- All runs were in-process with the oracle or mutant reader: no network (fetch closed), no credentials
  present, and harness/run.ts was never invoked. The scratch scripts and copies under
  .tmp-v2/metric-definer/ were deleted afterwards.
- Real-mail figures in section 6 read .tmp-data/gold/truth.jsonl, decisions.json and orders.json
  locally, and nothing else. No body, address or name was copied out.
