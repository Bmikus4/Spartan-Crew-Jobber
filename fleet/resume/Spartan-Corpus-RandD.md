# Spartan Crew — R&D handoff: dates, roles, venues. 2026-08-24

Repo `D:\Code\SpartanCrew-Enquiry-Engine`, HEAD **`0ac416b`** plus uncommitted study harness
(see §1.3), pushed to `main`. `npx tsc --noEmit` clean, `npx tsx test/all.ts` 63/63 files,
`npx tsx sim/run.ts` 100/100.

**Read `docs/CORPUS-STUDY-2026-08.md` first** (the pre-registration), then the published
study document: https://claude.ai/code/artifact/5b0214aa-80f0-432c-8d96-99bac110cc72

---

# 0. BEN'S INSTRUCTION, VERBATIM

> fix the date year bug and the role resolution, then rerun the study. Before you even
> think about rerunning, I want a handoff for the next session to do it, which will begin
> by running a full r&D protocol on the date year bug, and the role resolution. In addition
> venue resolution should function in two ways, primarily, it should pull a full list of
> RMS venues, and use the full list + a fully planned code node project with AI escelation
> steps, structured for accuracy above COST and TIME. We should also run multiple keyword
> searches which will be given to the AI escelation step. Doing this involves extracting
> the venue address, breaking it up into more searchable terms, and running each one as its
> own searchy. The escelation step should also have a clearly vetted and carefully designed
> logic harness for accuracy. Think, plan, and build as if you were a systems engineer with
> great data analytics background. ASK yourself for EACH of these steps, how would we
> create this system in production for maximum accuracy? DO research for each integration,
> validate and critique your work in honesty, and report back to me when you are done.
> remember this is just for the handoff, I want everything above there virbatim

**So the order of work is: R&D protocol → fix → venue rebuild → rerun the study → report.**
Nothing is fixed yet. Do not start by editing prompts.

---

# 1. WHERE THINGS STAND

## 1.1 What the 100-case model-in-the-loop study measured

`sim/corpus-real.ts`, 100 generated client-shaped enquiries, real Opus 4.6, real OnSinch
tenant, TEST company 515, **$1.11**, 300 model calls, 13 minutes, all 101 orders deleted.

| | measured |
|---|---|
| classified new-job | 100/100 |
| crew total read correctly | 100/100 |
| block count | 97/100 |
| times | 96/100 |
| **date** | **81/100** |
| **venue matched an existing row** | **74/100** |
| **role in the right family** | **55/100** (see §3.1 — this number is partly my scorer's fault) |
| reached OnSinch as an order | 95/100, 5 correctly held (all undated) |
| headcount = the client's number | 95/95 |
| follow-ups applied in place | 29/50 |
| R number survived | 47/50 |

## 1.2 What the companion 500-case run measured

`sim/corpus.ts` — same rig, model scripted out, engine mechanics only. Two hard engine
defects it isolated, neither yet fixed:

- **A shift crossing midnight is refused by OnSinch.** 222 occurrences. `20:00–02:00`
  composes as end-before-start on the same date → `400 {"beginning":["Wrong end time
  (amount of hours)"]}`. **The prompt is not at fault** — `prompts.ts:178` explicitly tells
  the model *"an end earlier than the start is an overnight shift — record it as given, the
  roll to the next day happens downstream"*. The downstream roll does not exist. Every
  overnight booking fails.
- **`Job.name` over 80 characters kills the create.** 147 occurrences. Slot-team names are
  capped and overflow moves to the description; the Job name is not capped at all. This same
  failure lost a real Spartan booking in the last seven days.

Both belong in the same fix pass as dates and roles. They are cheaper than either.

## 1.3 The harness, and what is not committed

Committed: `docs/CORPUS-STUDY-2026-08.md`.
**Uncommitted, in the working tree** — commit these first, they are the study:

    sim/corpusCases.ts        the 500-case factor grid (deterministic)
    sim/corpus.ts             the scripted runner
    sim/corpusRig.ts          the SHARED rig: real OnSinch + the production executor
    sim/randomCases.ts        the 100 client-shaped enquiries (seeded)
    sim/corpus-real.ts        the model-in-the-loop runner, with a $ ceiling
    sim/corpus-real-report.ts scoring
    sim/corpus-price.ts       offline pricing, no calls
    sim/corpus-showcase.ts    one case captured with every byte of wire traffic
    sim/corpus-report.ts      scoring for the scripted run

Run them:

    npx tsx sim/corpus-price.ts                 # what a run would cost, no calls made
    npx tsx sim/corpus-real.ts --n=100          # the study. ~$1.11, ~13 min
    npx tsx sim/corpus-real.ts --cleanup        # delete anything the ledger holds
    npx tsx sim/corpus-real-report.ts           # score it
    npx tsx sim/corpus-showcase.ts --case=1     # one case, full payload capture

Safety already in place, do not weaken it: company 515 asserted at start; every order id
ledgered **from the wire** before it can be lost; results appended per case so a crash keeps
everything up to the crash; a dollar ceiling checked between batches; a per-case call ceiling
in `guardReasoner`.

---

# 2. R&D PROTOCOL — THE DATE YEAR BUG

## 2.1 The observation

19 of 100 dates wrong. **Every single one is the same error**: the year is the year of the
email, where a human reads the next occurrence.

    R007  client wrote "8th March"   → engine read 2026-03-08, truth 2027-03-08
    R027  client wrote "28th March"  → engine read 2026-03-28, truth 2027-03-28
    R052  client wrote "22nd April"  → engine read 2026-04-22, truth 2027-04-22

Day and month are always right. This is not a parsing failure and not a format failure —
`dd/mm/yyyy` and `d.m.yy` cases with an explicit year all passed.

## 2.2 The suspected cause, and why it is only suspected

`prompts.ts:176` says: *"date: the work date, formatted YYYY-MM-DD. Infer the year from
surrounding context (thread dates)"*. The email is dated 2026-08-24, so "surrounding
context" points at 2026 and the instruction is satisfied by the wrong answer. There is no
rule saying a bare day/month means the **next** occurrence, and nothing anywhere states that
a work date in the past is impossible.

**Do not accept that as the diagnosis without the experiment below.** A competing
explanation is that the model never sees the email's own date clearly enough to reason from
it — `renderConversation` puts dates in the transcript, but whether the *current* message's
date is unambiguous to the model is an assumption, not a measurement.

## 2.3 Protocol

**Step 1 — reproduce offline, free.** Build `test/dateYear.ts` as a pure test over
`parseWork`/`compose` with hand-written facts: `date: "2026-03-08"` extracted from an email
dated `2026-08-24`. No model. This pins the *engine's* behaviour independently of the
model's, and it is where the deterministic guard (Step 4) gets its test.

**Step 2 — measure the model in isolation.** A single-purpose probe, ~20 calls, about
$0.10: the same bare-date email at four email dates (Jan, Jun, Aug, Dec) × five date
phrasings ("8th March", "8 Mar", "March 8th", "next March", "8/3"). Record what year comes
back for each cell. This answers three questions the study could not:
- does the error depend on how far ahead the date is?
- does it depend on the phrasing?
- does the model ever roll forward on its own?

**Step 3 — establish the ground rule with Ben, because it is a business rule, not a
technical one.** "Bare date means next occurrence" is right for a crew booking, but there
is an edge: an email arriving 2 January referring to "28th December" almost certainly means
the December *just gone* (an invoice query), not eleven months ahead. Propose: roll forward
when the resulting date is in the past **by more than 14 days**, otherwise keep the past
date and note it. Get the number agreed rather than invented.

**Step 4 — fix in TWO places, and make the deterministic one the authority.**
- *Prompt:* state the rule explicitly, and inject today's date into the user message.
  Cheap, but a prompt cannot be proven — a passing sample is not a guarantee.
- *Engine:* a deterministic normaliser, after extraction and before compose. Given the
  extracted date and the email's own `date_iso`, roll the year forward per Step 3 and
  **write a note saying it did**. This is testable offline, costs nothing, and cannot regress
  silently. It also catches the case where the model's year is wrong for some other reason.

**Step 5 — validation.** `test/dateYear.ts` must cover: bare date before the email date;
bare date after; explicit year in the past (**left alone** — a client can legitimately
reference last year's job); explicit year in the future; a date exactly on the email date;
29 February in a non-leap year; a two-digit year (`2.3.27`) which already works and must
continue to. Then re-run the 20-call probe from Step 2 and require 20/20.

**Acceptance:** date field ≥ 99/100 in the rerun, and every rolled date carries a note.

## 2.4 The honest risk

A deterministic roll-forward will be **wrong** for a genuine past-date reference the client
makes deliberately. The note is the mitigation, not a cure. Watch the first week of live
notes for "rolled the year forward" on threads that turn out to be historical.

---

# 3. R&D PROTOCOL — ROLE RESOLUTION

## 3.1 FIRST, CORRECT THE MEASUREMENT. My 55% is partly wrong.

The study drew roles from `crew, carpenter, rigger, forklift, ipaf`. **The tenant has no
Rigger role.** The 43 bookable professions are Crew, Carpenter, Telehandler (four rate
forms), IPAF 3a/3b, IPAF 1b, PASMA, Driver, Counterbalance, Followspot, Crew Audio/Lighting/AV
Tech, Rough/All Terrain, Office Temp, Bar/Serving Staff, CSCS Labourer, Host/Hostess, Crew
Chief, Duty Manager, Misc., Carpool/Minivan Driver, Dummy Tech, Steward, Crew Boss,
Freelancer, Sunbelt Forks, Standby Crew, Van Service, Event Staff, MCR Crew, MCR Crew Chief,
Climber.

So for every "rigger" case, booking general Crew was **the correct answer** and my scorer
marked it wrong. Roughly one in seven cases drew that role, so a material slice of the 45
"misses" are scoring artefacts.

**Do this before any fix:** re-score the existing `results.jsonl` with a corrected
`ROLE_PATTERNS` — a role that does not exist in the tenant expects `Crew`, and the "right
answer" for each role must be read off the 43-row list rather than asserted. The real
failure rate is what you fix against. Anything else is optimising toward a broken ruler.

## 3.2 The real failures, confirmed by reading the resolver

`app/lib/engine/professions.ts:154` — the cue table has **eight** entries: crew chief, cscs,
chippy/carpenter, driver, av, forklift/counterbalance, rough/all terrain, telehandler.

- **IPAF has no cue at all.** The stored name is `IPAF 3a/3b`. Containment asks whether the
  client's text contains the stored name, so "IPAF cherry picker operator" fails, no cue
  fires, and it falls through to Crew. An IPAF job staffed with general crew cannot legally
  proceed, and the order looks normal.
- **"FLT" is unknown**, and "FLT drivers" hits the `\bdriver\b` cue → Driver (9), a
  different job entirely.
- **"cherry picker", "MEWP", "scissor lift", "genie" are unknown.** PASMA has no cue either.
- The model **paraphrases**: it returned `profession_hint: "IPAF cherry picker operator"`
  for an email saying "IPAF operators". The resolver is being asked to match prose.

## 3.3 The design question, asked properly

Two candidate architectures. They are not equivalent and the choice should be deliberate.

**(a) Widen the cue table.** Deterministic, free, testable, and it degrades predictably. But
it is a synonym list maintained by hand forever, and it cannot cover wording nobody has
thought of.

**(b) Constrain the model to the tenant's own list.** Pass the 43 role names into the
extraction prompt and require `profession_id` (or an exact name) as the output — the model
chooses from a closed set instead of describing. Removes the paraphrase problem at source,
costs ~600 extra input tokens per call (~$0.003/call, ~$0.90 per 100-case study), and moves
the failure mode from "unmatched" to "confidently wrong choice", which is worse when it is
wrong and rarer.

**Recommendation: both, in this order.** (a) first because it is free and immediately
testable, then (b) as the escalation for anything (a) leaves at `Crew` when the client's
words clearly named something specific. Never let (b) overwrite a confident deterministic
match — same precedence as the venue design in §4.

## 3.4 Protocol

1. **Build the gold set.** Every distinct `profession_hint` the corpus has ever produced,
   labelled by hand against the 43 rows — including the honest label `Crew` where the tenant
   has no such role. Mine `data/corpus/sweep-threads.jsonl` and the study's
   `results.jsonl`; do not invent hints.
2. **Measure the resolver against it offline.** `test/professionGold.ts`. Report per-role
   precision and recall, not one accuracy number: booking Crew when IPAF was asked for is a
   different failure from booking Driver when Crew was asked for.
3. **Widen the cues**, re-measure, and require no regression on the existing
   `test/professions.ts`.
4. **Add the abstention path.** When resolution lands on `Crew` by `default` (not by
   `exact`, `keyword` or `cue`) *and* the client's wording contained a role-ish noun, that
   is a **needs-human** flag, not a silent booking. This is the single highest-value change
   in this section: it converts an invisible wrong booking into a visible question.
5. Only then consider (b).

**Acceptance:** role-family accuracy ≥ 95% against the corrected gold set, and zero silent
`default` bookings where a specific role was named.

---

# 4. THE VENUE RESOLUTION REBUILD

Ben's brief: pull the full venue list, decompose the address into multiple search terms, run
each as its own search, feed the candidates to an AI escalation step with a carefully vetted
logic harness, **accuracy above cost and time**.

## 4.1 What exists today, and why it misses

`app/lib/engine/resolve.ts:242` `matchPlace` is already a careful deterministic matcher —
exact name, exact alias, address-with-discriminator, name containment (≥6 chars), alias
containment, short-alias-leading-its-own-address, and reverse containment. It carries real
scar tissue: a four-character floor, a postcode/street-number discriminator that stopped
crew being sent to a Walthamstow library, active-row preference, and a "richest record wins"
rule for the ~3,000 context-free duplicate rows.

It still missed **26 of 100** in the study, and a miss is not a failure — **it creates a new
place**. The tenant grows a duplicate every time a client uses a nickname.

    "the albert hall"   → new place, beside Royal Albert Hall (alias RAH)   9 of 23 missed
    "o2 arena"          → missed The O2, Peninsula Square                  2 of 15 missed
    "excel docklands"   → missed ExCeL London (id 49)                      3 of 15 missed
    "olympia"           → matched every time                              22 of 22 hit

The mechanism is visible in the code: every tier asks for **exact equality or containment in
one direction**. "the albert hall" neither equals nor contains "royal albert hall", and
"royal albert hall" does not start with "the albert hall", so nothing fires. There is no
token-level comparison, no stop-word handling ("the", "arena", "london"), and no notion of
partial agreement.

## 4.2 The production design, stage by stage

Written as a pipeline with a deterministic spine and one model call that can only ever
**choose among candidates the spine produced** — never invent, never search.

### Stage 0 — the venue corpus, pulled and indexed

- `scripts/pull-places.mjs` already pages the full list (~6,853 rows) to
  `.tmp-data/places.json`. Promote it: a nightly pull into a Neon table `places_index` with
  `id, name, alias, address, city, zip, lat, lng, active, context_score, updated_at`.
- **Why a table and not the JSON:** the engine runs on Vercel where `.tmp-data` does not
  exist, and a 2 MB JSON read per invocation is a cold-start tax. A table also lets the
  index carry derived columns.
- **Derived columns, computed once at pull time** — this is where accuracy is bought
  cheaply:
  - `norm_name`, `norm_alias`, `norm_addr` (the engine's own `normAddr`, so the index and
    the matcher cannot disagree)
  - `tokens` — the significant tokens of name+alias+address, stop-words removed
  - `postcode_outward` (`E16`, `SW7`) — a coarse geographic key that survives typos
  - `context_score` — the existing `placeContext`, so "richest record wins" is an index
    lookup rather than a scan
  - `canonical_id` — **the duplicate-collapse column.** 632 rows are ExCeL. Cluster on
    (outward postcode + first significant token) at pull time, elect the richest row as
    canonical, and point the rest at it. Every downstream stage then works on ~20 real
    venues plus the long tail, not 6,853 rows. This single column is worth more than any
    matching improvement.

### Stage 1 — decompose the venue text into search terms

From `"Excel London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL"` derive, each
as its own query:

| term | why it is generated |
|---|---|
| `E16 1XL` | full postcode — the strongest single key there is |
| `E16` | outward code — survives a mistyped inward |
| `1 Western Gateway` | street number + street — the discriminator today's matcher demands |
| `Western Gateway` | street alone |
| `Royal Victoria Dock` | district, which is often what the venue is known by |
| `Excel London` | leading name phrase |
| `Excel` | first significant token |
| `London` | city — **generated but weighted near zero**, see the critique |

Plus normalisation the current matcher lacks: strip leading articles ("the"), fold venue
suffixes ("arena", "centre", "hall", "stadium") into a secondary token set rather than
discarding them, and expand a small hand-kept synonym map (`o2 ↔ the o2`, `rah ↔ royal
albert hall`, `nec ↔ national exhibition centre`).

**Postcode extraction is a solved problem — do not hand-roll it.** UK postcodes have a
published regex; use the official one, and treat a validated postcode as a different class
of evidence from free text.

### Stage 2 — candidate generation: every term its own search

Run each term against the index and **union** the results, keeping *why* each candidate
arrived:

- postcode → exact match on `zip` or `postcode_outward`
- street number + street → `norm_addr LIKE`
- name/alias phrase → exact, then containment both directions
- token set → Postgres trigram similarity (`pg_trgm`, `similarity() > 0.45`) and/or
  `to_tsvector` full-text on `tokens`

**pg_trgm is the right tool and it is already available** in Neon (`CREATE EXTENSION IF NOT
EXISTS pg_trgm`). It is what would have caught "the albert hall" → "Royal Albert Hall":
trigram similarity is indifferent to a leading article. Add a GIN index on the trigram
columns or the whole thing scans 6,853 rows per term.

Cap the union at ~25 candidates by score, collapse to `canonical_id`, and carry a per-candidate
evidence vector: `{postcode_exact, outward_match, street_number_match, name_exact,
alias_exact, name_contained, trigram_score, context_score, active}`.

### Stage 3 — deterministic scoring, and the abstention rule

Score each candidate from the evidence vector with **hand-set weights, not learned ones** —
there is no labelled corpus big enough to learn from, and a hand-set weight can be argued
about in a review. Then apply the rule that matters more than the weights:

    accept    exactly one candidate above the accept threshold, and it beats the
              runner-up by a clear margin
    escalate  several plausible candidates, or one that is plausible but unproven
    abstain   nothing plausible → provision a new place, as today

**Confidence must come from the margin, not the top score.** Two ExCeL shells scoring 0.9
each is not confidence, it is ambiguity — and the current matcher's "richest record wins"
tie-break is exactly a margin rule already. Keep it.

### Stage 4 — the AI escalation step

Only reached when Stage 3 says *escalate*. Its contract:

- **Input:** the client's original venue text, and the ≤8 surviving candidates with their
  full records (name, alias, address, city, postcode, active, context score) and their
  evidence vectors. Nothing else.
- **Output, structured:** `{ decision: "match" | "none", place_id: number | null,
  confidence: 0–1, reason: string }` — `place_id` **must be one of the ids passed in**, and
  the caller rejects anything else. This is the whole safety property: the model is a
  chooser, not a searcher, so it cannot invent a venue.
- **Prompt content:** the tenant's duplicate problem stated plainly ("many rows describe the
  same building; prefer the one carrying an address and postcode"), the geographic rule
  ("two records in different postcode districts are different buildings, however similar
  the names"), and the cost asymmetry ("sending crew to the wrong building is worse than
  creating a duplicate row — answer none if unsure").
- **Model:** the engine's default Opus, not the cheap tier. Ben's brief says accuracy over
  cost, and this call fires on a minority of enquiries.
- **Two-pass on disagreement:** when the deterministic top-1 and the model disagree, ask a
  second time with the two candidates only and the disagreement stated. Agreement on the
  second pass decides; continued disagreement is a **needs-human**, not a coin toss.

### Stage 5 — the logic harness

The part Ben specifically called out, and the part that makes the rest trustworthy.

- **Gold set: 300 venue texts from the real corpus**, each labelled by hand with the correct
  place id — or with "no correct row exists, provision" where that is the truth. Mine them
  from `data/corpus/sweep-threads.jsonl` (2,432 distinct venue texts are already known to
  exist) and stratify: nicknames, full addresses, short forms, districts, brand-new venues,
  bare city names, and the known ExCeL/Olympia/NEC duplicate clusters.
- **Metrics, reported separately and never blended:**
  - *precision on accept* — of the venues it resolved, how many were right. **This is the
    one that costs money when it drops**: a wrong accept sends crew to the wrong building.
  - *recall* — of the venues that had a correct row, how many it found.
  - *duplicate creation rate* — how often it provisioned a row for a venue the tenant
    already had. This is the metric the current system fails.
  - *escalation rate* and *cost per resolution*.
  - *abstention correctness* — when it declined, was declining right?
- **Thresholds to agree with Ben before building:** precision on accept ≥ 99% (a wrong
  venue is a wasted crew call), duplicate creation ≤ 5%, escalation ≤ 25% of enquiries.
- **Adversarial cases the harness must include**, because they are the ones that have
  already bitten this codebase: "V&A East Storehouse" vs the South Kensington museum;
  "Westbridge Manor Hall, High Street" (a street name with no discriminator); a bare city
  name ("O2 London" once resolved to a place whose whole name is "London"); "The NEC" (a
  leading article defeats the short-alias rule today); two venues sharing a first word
  ("Olympia London" / "Olympia West").
- **Regression gate:** the harness runs offline against a frozen index snapshot, so it is
  free, deterministic, and can gate a commit. The model-dependent half runs on a 40-case
  subset when the prompt changes.

### Stage 6 — production concerns that are not optional

- **Cache every resolution** keyed on `normAddr(text)` → `place_id`, in the existing
  `entity_aliases` table. The same client writes the same venue the same way for years; a
  resolved alias must never be paid for twice. This is also how the system gets *better*
  over time rather than merely staying correct.
- **Latency budget:** the n8n → Vercel call has a 60-second ceiling and the whole pipeline
  runs inside it. Stage 2 is SQL (~50 ms with the right indexes); Stage 4 is 2–6 s. Budget
  one escalation per enquiry, not one per block — resolve the order-level venue first and
  reuse it.
- **Observability:** log per resolution — the terms generated, candidate count, the winning
  evidence vector, whether it escalated, the model's confidence and reason. Without this the
  first production disagreement is unexplainable.
- **Failure mode:** every stage falls back to today's `matchPlace`. The new pipeline must be
  behind a flag (`SPARTAN_VENUE_V2`) and must be able to be turned off in one env var.

## 4.3 Honest critique of the design above

- **The escalation step's value is unproven.** Trigram matching plus the duplicate-collapse
  column may well fix all 26 misses on its own, at zero marginal cost. **Measure Stages 0–3
  against the gold set before building Stage 4.** If the deterministic spine reaches the
  precision target, the model call is ceremony. I would put the odds at better than even
  that it does — "the albert hall" is a trigram match, not a reasoning problem.
- **"London" as a search term is a trap.** It appears in thousands of rows and generating it
  invites exactly the bare-city-name bug already on the defect list. It is listed above for
  completeness and should probably be dropped entirely rather than down-weighted.
- **A hand-labelled 300-case gold set is the expensive part** and there is no shortcut. Do
  not generate labels with a model: the venue text and the answer would come from the same
  source, which is the self-match illusion that produced 98.7% on a matcher study here that
  scored 45.9% on real queries.
- **`canonical_id` clustering can merge two genuinely different buildings** that share an
  outward postcode and a first token. Olympia London and Olympia West are the live example.
  Clustering must require agreement on more than those two keys, and every cluster with more
  than ~50 members should be eyeballed once by hand.
- **This design cannot fix a venue the tenant does not hold.** 25 of the study's 100 cases
  were brand-new venues, and provisioning is the right answer there. Do not let the
  duplicate-rate metric push the system toward matching things it should create.
- **Accuracy above cost does not mean cost is free.** At ~25% escalation, 300 enquiries a
  month is ~75 extra Opus calls, about $1/month. That is genuinely negligible, which is
  worth saying plainly rather than implying a trade-off exists where it does not.

---

# 5. THE RERUN

Only after §2, §3 and §4 are done and their offline harnesses pass.

1. `npx tsx sim/corpus-price.ts` — re-price; the role list in the prompt (§3.3b) and the
   venue escalation both add tokens. Expect $2–4 for 100 cases, not $1.11.
2. Get the figure signed off by Ben before spending it. The rule in this account is that a
   bulk model run is priced first.
3. `npx tsx sim/corpus-real.ts --n=100` then `npx tsx sim/corpus-real-report.ts`.
4. **Use the same seed.** `buildRandomCases(100)` is seeded at 20260824 — the same hundred
   emails, so the before/after is a comparison and not two different studies.
5. Then, and only then, a fresh 100 on a **new seed** to check the fixes did not overfit the
   first hundred. This is the step most likely to be skipped and the one that would catch a
   prompt tuned to a specific set of phrasings.

**Acceptance for "ready to go live":** date ≥ 99, role ≥ 95 against the corrected gold set,
venue accept-precision ≥ 99 with duplicate creation ≤ 5%, headcount 100%, zero silent
`default` role bookings, zero TBC leaks, and both §1.2 defects fixed with tests.

---

# 6. WHAT I WOULD FIX FIRST IF TIME WERE SHORT

In value-per-hour order, and none of it is the venue rebuild:

1. **The `Job.name` 80-char cap.** One line of code, already costing real bookings.
2. **The overnight roll.** One function, 222 refusals in the companion run, and the prompt
   already promises the engine does it.
3. **The date year roll.** Deterministic, testable, ~19% of bookings on the wrong day.
4. **The role abstention flag** (§3.4 step 4) — converts an invisible wrong booking into a
   visible question, without needing the cue table finished.
5. Then the cue table, then the venue index, then the escalation step if the index does not
   already carry it.

The venue rebuild is the biggest piece of work in this handoff and the third most valuable
thing in it. Say so to Ben rather than starting with the interesting one.
