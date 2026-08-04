# Cost per thread, and getting the job right

Two builds, planned against measurements rather than intuition. Every number below comes
from `scripts/cost-model.ts` (character counts over the 5,834-thread corpus, priced at
list rates) or `scripts/rnd-disproofs.mjs`. **No figure here was produced by calling a
model.** The previous way of answering "what does this cost?" was to run the pipeline over
the corpus, and that is what spent $150.

---

## Project 1 — cost

### What is actually happening

| claim | truth |
|---|---|
| "we look at every thread four times" | Worse. **6.26x**: 77,523 message-reads for 12,380 real messages, because a thread is re-sent in full every time a new message lands. |
| "the pipeline sends the thread 4 times per event" | Not any more — `classifyAndExtract` merged classify+extract, and history is capped at 12k chars. |
| ...but | **The merge never took effect in production.** `deps.ts` builds the reasoner wrapper by hand and does not forward `classifyAndExtract`, so `compiler.ts` sees `undefined` and falls back to two calls, plus a reply call. |
| "n8n reviews the email too" | No. The `AI Agent` (gpt-5 + opus-4.6) in `CPIRu7CpezvKjU8d` is **orphaned** — nothing connects into it, and `Parse Job Determinism Output` is still the n8n stub (`myNewField = 1`). It costs nothing and does nothing. |
| the $57 spent today | `scripts/classify-corpus.ts` over the corpus: classify + extractFacts + isCancellation per thread, three uncapped sends. A batch script, not the live path. |

### Where the money is, measured

One full pass over the corpus (12,564 arrival events), Opus 4.6 at $5/$25 per Mtok:

| variant | corpus cost | per event |
|---|---|---|
| V0 today (12k cap, full history) | $289.03 | $0.0230 |
| V1 + deterministic gate | $285.75 | $0.0227 |
| V2 + read each message once | $237.19 | $0.0189 |
| V3 + system prompt cached | $84.37 | $0.0067 |
| V4 + Flash first, 20% escalated | $32.76 | $0.0026 |

The **system prompt is the largest single line item**: 2,744 tokens charged on every call,
34M tokens over the corpus, ~$170 of the $289. Output is small — **134 tokens, MEASURED**
from the 532 real label rows in `sweep_labels`, not the 800 I first assumed. That
correction is what moved caching above model choice in the ranking.

### Build, in order of measured value

1. **Forward `classifyAndExtract` in `deps.ts`.** Five lines. Turns the live path from
   2–3 calls into 1. Nothing else on this list matters while production ignores the
   combined call.
2. **Cache the system prompt** (`cache_control` on the system block). −$153 over a batch,
   zero quality change because the prompt is byte-identical. **Caveat that must be stated:
   live traffic is ~34 events/day, so the 5-minute cache is cold on almost every live
   call.** This pays for backfills and bursts, not for the trickle.
3. **Read each message once** (incremental compile): send the prior extracted facts —
   ~520 characters of JSON — plus the one new message, instead of re-sending the thread.
   −$52, and it is the only item that removes the 6.26x re-read Ben is describing.
4. **Model tiering**: cheap model answers, escalate to Opus only when deterministic
   validation of its output fails or it reports low confidence. Quality is protected by
   the escalation rule, not by hoping the cheap model is good enough.
5. **Spend guard**: no script may call a model in bulk without an explicit flag and a
   call ceiling, and the four hard-coded `anthropic/claude-opus-4.6` defaults become a
   cheap model. A default of Opus means every future batch is expensive by accident.

### Rejected, with the number that rejected it

**The deterministic pre-gate** (skip threads naming no date and no crew). Saves $3.28 of
$289 — 1.1% — and silences **155 threads entirely**, each an enquiry no model would ever
see. A missed booking costs more than a thousand model calls. Dropped.

### Self-critique of this plan

- **Item 3 can lose information.** Prior facts are a lossy summary: if the extractor got
  something wrong on message 2, message 7 can no longer correct it from the original text.
  Mitigation: keep the raw messages in the corpus (they are already there) and re-read the
  full thread when the classification changes or a human flags the ticket — a rare,
  deliberate, expensive path rather than the default one.
- **Item 4's escalation rate is a guess.** 20% is a dial, not a measurement. It cannot be
  measured without paid calls, so it ships configurable with the escalation *triggers*
  deterministic and testable offline, and the rate reported from live counters.
- **Item 2's saving is mostly unavailable live.** Stated above rather than buried; the
  honest live win is items 1, 3 and 4.
- **`OUT_TOKENS` is load-bearing.** Everything reranks if real outputs are much larger.
  It is measured from 532 rows, but those rows are the *stored* fields, not the raw JSON —
  the +25% wrapper allowance is an assumption.
- **What would prove item 1 wrong:** if `classifyAndExtract` produces materially worse
  classifications than the two separate calls, merging is a false economy. It cannot be
  tested without paid calls; `test/combinedCall.ts` proves only that the call count drops.

---

## Project 2 — getting the job right

### What a slot team is

One slot team = **one crew type, a count, a place, a start and an end**. Each change of
any of those is a new slot team. An order is one company and one venue; the slot teams
carry the when/who/how-many. Fields OnSinch requires on every one: `name`,
`profession_id`, `beginning`, `end`, `size`, `place_id`.

### What the studies say is wrong

- **Crew size and slot-team count cannot currently be scored at all** — `GET /slot_teams`
  returns 405, so two of the three accuracy criteria are unmeasurable. This needs a
  permission change in OnSinch and is Ben's, not code's.
- 46.2% of jobs have more than one block, so slot teams are not a minor field.
- The 18:00 default finish was a *prompt instruction*, and prompt instructions drift. It
  survived months because nothing measured it.

### Build

1. **Deterministic date/time/crew parsing** with the model as fallback, not as the parser.
   The shapes are regular: `09:00 - 16:00`, `until 15:30`, `6x3hr at 17:00`, `x4 locals`.
   Rules-first holds permanently; a prompt instruction holds until the next edit.
2. **Company and place resolution against the full OnSinch lists, not search.** Pull all
   756 companies and 6,829 places (free), cache them, match deterministically.
3. **Learned aliases**: when a name in an email resolves to an id, record the alias
   against that id so the next email spelling it the same way resolves without guessing.
4. **Always draft an order, then update it.** Missing fields do not block creation; later
   messages fill gaps against the *same* draft. This is what makes a partial enquiry
   useful, and it puts the whole weight on the thread→order link holding.

### What the venue test already settled

**A blank venue must never be inherited from the client's history.** Consecutive jobs for
the same client share a venue only **16.1%** of the time (14.6–18.0% across three matching
strictnesses; 254 companies, 5,903 consecutive pairs). Even an oracle picking the *best*
prior venue caps at **50.7%**. Exactly **one** client of the 254 books 10+ jobs at a stable
venue. Inheritance would inject a wrong address into roughly five orders in six, so the
sender's history may only ever *suggest* a venue for a human to confirm.

Venue is read from `Job.name` ("Client @ Venue", 95.0% of 6,859 jobs) because no place is
readable any other way: `Order` allows only `with=Job,Attachment`, `Job` carries no
`place_id`, and `GET /jobs` and `GET /slot_teams` both 405.

### Self-critique

- **Alias learning can learn a mistake.** One wrong resolution becomes permanent and
  self-confirming. Aliases must record *how* they were learned (human-confirmed vs
  inferred) and only human-confirmed ones may resolve automatically.
- **Rules-first parsing can be worse than the model** on messy text. The rule is: rules
  win only where they parse *unambiguously*, and the model handles the rest — never
  "rules override the model".
- **The reference join is not available.** Client references reach the mail on a minority
  of threads, so date+company stays the join key. (Measured 23.8% of a 400-reference
  sample; that figure is itself bounded by orders predating the 12-month corpus, so it is
  a floor, not the rate.)
