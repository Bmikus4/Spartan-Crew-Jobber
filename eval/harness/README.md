# The real-mail harness

It scores the production decision code on real client mail against two blind readers' labels.
It costs $0: it makes no model call, sends no network request, reads no database and writes
nothing outside `eval/harness/`.

There are two label sets:
- **all** (the default): 799 emails. These are the live week's 400 plus a second batch of 399:
  every other decided client email in the snapshot, sent from 10-01 and decided on the TV-era
  build.
- **live-week**: the 400 emails sent 10-14..10-21. The baseline was measured on this set, and it
  is kept exactly as it was.

Code: `harness/real/`. Labels: `eval/harness/labels/`. Gate test: `test/harnessReal.ts`.
Baselines: `baseline-live-week.md` (live-week, with the reproduction proof) and
`baseline-all.md` (the 799, dev).

## Commands

Run from the repo root. Never with `--env-file`: the preflight refuses a process that holds any
production credential.

| Command | What it does |
|---|---|
| `npx tsx harness/real/run.ts --mode score-production` | Production's stored decisions (`decisions.json`), scored on dev of the 799. |
| `npx tsx harness/real/run.ts --mode replay` | The stored model readings through the current planner (`decideMessage`), on the time-correct world, scored on dev of the 799. |
| `... --labels live-week` | The same, on the live week's 400 and its own split. |
| `... --labels live-week --set all --checkpoint` | All 400. In score-production this first reproduces `eval/live-week-reads.md` figure by figure and exits 1 if any figure differs. |
| `... --set test --checkpoint` | The locked test set. Checkpoints only (OPERATING §8.8). |
| `npx tsx harness/real/labels.ts` | Rebuilds `labels/live-week.jsonl` and `labels/all.jsonl` from `eval/reads/*.csv`. Run it after the reads change. The gate test fails until you do. |
| `npx tsx harness/real/split.ts` | Writes `labels/split.json` and `labels/split-all.json`, each once. It never rewrites an existing split. |
| `npx tsx test/harnessReal.ts` | The gate test, about 6 s. |

`--set test` and `--set all` refuse to run without `--checkpoint`, because `all` contains the
test set. Tune on dev only.

Each run writes `runs/<labels>-<mode>-<set>.md` and `.json` (gitignored). They hold ids, codes and counts,
never email text.

## Inputs

- `.tmp-data/gold/`: the 2026-10-23 production copy (gitignored). It has messages, orders,
  timeline (the OnSinch audit), decisions, readings, links, companies, places and professions.
  The **dataset hash** covers all nine files.
- `eval/harness/labels/all.jsonl` or `live-week.jsonl`: the **labels hash** is the file hash of the one used.
- all.jsonl is built from `eval/reads/{A,B}-{1,2,3,4}.csv`, the third reader's `V-v.csv` and
  `V-v2.csv`, and `settled.csv`. live-week.jsonl is built from `{A,B}-{1,2}.csv`, `V-v.csv` and
  `adjudicate.csv`.
- Reproduction only: `.tmp-data/week-review-1014.json`, `week-truth-acts.json`,
  `week-truth-orders.json` and `eval/failure-taxonomy.md`, read exactly as `eval/reads/scripts/` read them.

Every report's header carries the git sha (`+dirty` when the tree differs from HEAD), the dataset
hash, the labels hash, the test-set hash and the harness version (`real-1`).

## The label file

One JSON row per email, in time order:

| field | meaning |
|---|---|
| `A`, `B` | each blind reader's `asks`, `target_ref`, `days`, `crew` and `sure`, as written. Notes are left out because they paraphrase the email. |
| `V` | the third blind reader, on its 46-row sample, else null |
| `consensus.strict` | booking work (new booking, change or cancel): `inquiry` (both readers), `not` (neither) or `disputed` |
| `consensus.wide` | any request at all, which adds quotes, PO-only emails and questions |
| `consensus.quote_only` | both readers read a quote or availability request, and neither read booking work |
| `consensus.b42_shifts` | a quote-only email where either reader recorded a day and a crew count (owner's B42) |
| `consensus.new_booking`, `nothing` | both readers read a new booking; both read nothing at all |
| `resolved` | booking work after reader-V's majority on a split |
| `settled` | all.jsonl only: a split settled by majority with the third reader (`eval/reads/settled.csv`). The consensus fields are then the winning reader's, so no row of all.jsonl is disputed. |
| `provisional` | live-week.jsonl only: the 6 A/B split rows, left as the live-week figures counted them. They rest on a 2-1 vote and are kept out of that set's test split. all.jsonl has none. |
| `adjudicate` | why the row is in `eval/reads/adjudicate.csv`, if it is |
| `excluded` | booking work this system was right to leave alone: `portal_notice` (OnSinch's own notices, sender rule) or `already_done` (production said already booked; `excluded_basis` says whether the snapshot confirms it) |

The consensus rules are the regexes of `eval/reads/scripts/score.mts` and `b42.mts`, character
for character.

## The split

Threads are ordered by their first email. Whole threads go to dev until dev holds 70% of the
emails, and every later thread goes to test. No thread is in both sets.

| labels | dev | test | test hash `sha256(sorted ids)[:16]` |
|---|---|---|---|
| all (`split-all.json`) | 561 | 238 | d2790450e2c9ae4f |
| live-week (`split.json`) | 280 | 118 (the 2 provisional rows on test threads go to neither set) | 8aaf7ecd8b29ba86 |

`loadSplit` refuses a file whose ids no longer hash to its recorded value. The gate test also pins
both hashes, so a regenerated split fails too. The two splits are independent: a live-week test
email can sit in the 799's dev set. Tuning reads the 799's dev.

## What each number means

An **item** is what the office TV shows for a person to act on or check. The outcome comes from
production's own TV code (`v2Source`, app/lib/feed/v2.ts:102):

| outcome | TV | counts as |
|---|---|---|
| none | no card | silent |
| needs-reply | a card the TV never lists (serve.ts:109) | silent |
| listed | Needs Created / Needs Updated | item |
| check | a verified bot write, done | item |

| metric | definition here |
|---|---|
| **silent_miss_count** | real inquiries with no item. Under **B42 (the headline)**, a real inquiry is booking work for both readers, not excluded, plus a quote that names a day and crew. An email intake read with a later one (process.ts:204-224) has no card of its own. It counts as reached when the later email's card is an item. |
| inquiry_recall | items for real inquiries ÷ real inquiries, with three other views: booking work only (the pre-B42 figure), every quote counted, and splits resolved by reader-V |
| review_rate | listed ÷ items. Today a listed item is the only "needs a person" state, and a check is the only "done" state. |
| display_precision | items whose email both readers call any request ÷ items (the live-week definition), and the B42 variant |
| none_precision | items proposing a new order (a create_order op, or a Needs Created card) whose email carries the NONE label (an outstanding new booking, or a B42 quote) ÷ such items |
| none_recall | NONE-labelled emails whose item proposes a new order ÷ NONE-labelled emails |
| suppression_count | `none` by a deterministic rule (sender rule, read-together), by rule. A `none` from the reading or the planner is listed apart, by code, because §4 does not allow it as a suppression. |
| reason_code | `coded()` (app/lib/v2/reasons.ts), by outcome |
| cost | production: not measurable, because the copy stores no model cost. Replay: $0 by construction. |
| latency | production: email sent to decision recorded, p50/p95. Replay: in-process ms. |
| item_correctness, action_accuracy, client_resolution_accuracy, recall@5, selection_given_correct_candidate | **not measurable from these labels**: no reader recorded the order or the client |

Every rate prints k/n with a 95% exact (Clopper-Pearson) interval, the same one
`eval/reads/scripts/cp.mjs` used. At n of about 100 the interval is about ±8 points, so a
smaller move is not evidence. Results are broken down by what the readers say each email asks,
and by failure-taxonomy bucket for the 117 rows Phase 0 bucketed.

## The time-correct world (replay)

For each email, `TimeWorld` rebuilds OnSinch as it stood at the email's arrival:
- It shows only orders, jobs, teams and shifts created before the email.
- It undoes every logged field change made after the email, newest first, using the audit's
  `old` value.
- An order cancelled after the email is set back to open.
- The bot's own orders, absent from the snapshot, are rebuilt from the create_order op it sent.
- The thread's link is the one seen by then.
- The thread holds the messages sent before the email.
- The client's earlier requests (`prior`) come from replaying the thread's earlier emails first,
  unscored.

Whatever cannot be rebuilt is counted per email, never guessed: parts deleted since, unlogged
changes, changes after the audit copy ends, links whose state then is unknown, and readings that
name an order the rebuilt context does not offer. Companies, contacts, places and professions
carry no timestamps and stay as in the snapshot. The baseline lists every limit with its count.

**Isolation.**
- The preflight (`harness/core/preflight.ts`) runs before the first email, and `fetch` is closed
  to every host.
- `extract` returns the stored reading or throws.
- The writer is a recorder that answers "verified".
- An email production's intake read with a later one is not decided on its own. Its text is
  folded into the later email's body, as processMessage does.
- `link` and `record` stay in memory.
- The labels never reach `decideMessage`. The readers' days are read only after an email is
  decided, to check a replayed "already booked" answer.
