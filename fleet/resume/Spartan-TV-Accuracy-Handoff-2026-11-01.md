# Spartan TV accuracy: handoff, 1 Nov 2026

Three workstreams. A discovery phase measures each one first, then the owner critiques the findings, then the build
starts. **Nothing in the build phase begins before the owner has critiqued the discovery report.** ADDENDUM.md stays
the plan and status document: when this work starts, add it to ADDENDUM as §15 and keep the status line current
there. This file is the brief.

## Where things stand

- Live: main 9d9bdc2, ticket S-0286. done.ts decides whether a need is done or settled in the thread:
  - agreed;
  - withdrawn;
  - quote sent (read again every minute; any client reply brings the card back);
  - a provisional order is never agreed.
- The quality test from 1 Nov is the measuring kit for everything below. Each script is $0 and read-only:
  - `.tmp-v2/settle-backtest.ts`: replays every need since 9 Oct moment by moment, with data cut to each moment, and
    stops at the first verdict (agreed marks are permanent). Each clear is labelled by what staff did afterwards.
    Writes `.tmp-data/backtest/fires.json` and `open.json`. Run with `ALL=1`. Order bodies are today's; provisional
    is rebuilt from `order_confirm_provisional` rows.
  - `.tmp-v2/bt-snips.ts`, `bt-score.mjs`, `bt-rescore.ts`: the blind wording test. Messages are sampled half from
    the rule's matches and half from near misses, masked and shuffled, with the answers kept in `key.json`. Labels
    are in `labels1-4.txt`, written before scoring.
  - `.tmp-v2/marksim.ts`: production's markNeeds with writes logged, not made.
  - `.tmp-v2/ro-neon.ts`: makes every query a READ ONLY transaction. Run scripts with
    `npx tsx --env-file=.env.local --require ./.tmp-v2/ro-neon.ts <script>`.
- Measured 1 Nov, 316 needs since 9 Oct:

  | How the need ended | Needs |
  |---|---|
  | Done by staff work | 243 |
  | Settled in the thread (agreed, quote sent, withdrawn) | about 10 |
  | Never cleared | 65 |

  - **The 65 never-cleared needs** sat on the TV for a median of 58 h (p75 105 h, about 7,200 card-hours).
  - **25 of the 65:** one of the client's orders holds every day asked, and staff edited it after the email. In 19 of
    them the edit came within 2 h. Their edits:
    - status changes on shifts (25);
    - shifts created (12);
    - provisional orders confirmed (9);
    - start or end times changed (8);
    - crew size changed (6);
    - TransportsTrip rows (3).
  - 7 of the 25 have two candidate orders.
- **Blind wording scores:**

  | Rule | Precision | Recall | n |
  |---|---|---|---|
  | Spartan sent a quote | 60/60 | 0.98 | 120 |
  | Spartan thanks the client | 30/30 | 0.85 | 60 |
  | Client withdraws a request | 5/5 | 0.71 | 36 |
  | Client says yes (words alone) | 0.78 | 0.81 | 120 |

  Spartan's TERMS wording ("minimum", "unfortunately", "subject to", ...) has not been blind-tested.
- **Delivery, first look.** Of 2,962 client emails since 1 Sep, 218 use delivery words (van, delivery, collection,
  courier, driver, drop-off, pick-up), and 64 of those name no crew. Only 28 of the 64 have a v2 decision, and 18 of
  those were read as `info_only` (nothing on the TV). OnSinch has professions Driver (9), Minivan Driver (46) and Van
  Service (61), and 70 orders carry TransportsTrip rows since 1 Sep. Nothing in the engine knows about deliveries:
  the only matches in code are the "We now provide Van services" footer filters (done.ts spartanOwn,
  followup/compose.ts).

## The three workstreams

**W1. Staff work done.ts does not recognise.** This is the largest pool of wrong cards, and the problem is work not
being recognised, not words being misread.

**W2. Settlement without the client's words.** Replace the client-yes regex with a check that never reads the
client's words:
- Spartan's offer stands in OnSinch unchanged and the client has not written since: waiting on the client, off the TV.
- The client's later email carries no request, as the reader already classifies it:
  - order provisional: back on the TV for staff to confirm;
  - order confirmed: settled.
- A request in a later email is its own card.

Spartan's own quote/terms wording stays, and TERMS gets its blind test.

**W3. Email types, delivery-only first.** Find what kinds of email reach the bookings mailbox and how each fares
through reader, planner, done.ts and TV. Deliveries (van, driver, courier, collection) are booked and recorded
differently from crew. Today they can be read as nothing and leave no card, or leave a card done.ts can never clear.

## Phase 1: discovery and data analysis

Everything in this phase is read-only and $0. Print counts and ids only, never client words; masked reading is for
the owner's review only. Each step ends in a table in the discovery report (one file:
`fleet/resume/Spartan-TV-Accuracy-Discovery-<date>.md`).

### D1. Why the 65 never cleared (W1)
1. Add a trace mode to the evaluation, in the backtest script, not production. For each need record:
   - the rung and candidate groups chosen;
   - every staff row after the email on each candidate order, with workOf's answer and the reason it did or did not
     fit;
   - the final verdict.
2. Give each of the 65 one primary cause, assigned by code with no judgement calls. The starting list (extend it if
   the data shows more):
   - **a.** two or more candidate orders ("possibly");
   - **b.** work on the right order that workOf does not count: confirm on a change need, a description, contact or
     admin-note edit, Slot status, TransportsTrip, a created shift on a change need;
   - **c.** the work came before the email (staff did it first; today only a fresh booking held before the email
     counts);
   - **d.** the order already held what was asked, so there was nothing to do (not the same as c: nobody acted);
   - **e.** the reading's day, venue or ask is wrong, so the right order is never a candidate;
   - **f.** a delivery need (see D3) that done.ts cannot see as work;
   - **g.** truly not done (staff never did it): the card was right;
   - **h.** other, listed by id.
3. Hand-check by masked reading: every need in b, c and d, and 10 picked at random from the rest. Record whether
   the cause code was right. Report agreement as a number.
4. Output: a cause table (count, card-hours, example ids), the hand-check agreement, and for each cause the smallest
   rule change that would clear it plus the needs it would wrongly clear. That second part comes from replaying the
   change, not from guessing.

### D2. Word-free settlement (W2)
1. Implement W2's check as an alternative evaluator inside the backtest (not production) and replay all 316 needs
   with both the current and alternative rules. Report fires, staff work after each fire (the false-clear count),
   and card-hours removed, side by side.
2. Measure the reader's classification against the labelled yes sample: for the labelled client messages that have
   a v2 decision (since 9 Oct), compare `info_only`/no requests and the `changes` flag against the blind labels.
   That tells us whether "asks nothing new" is a reliable signal.
3. Blind-test TERMS the same way as the other rules: 100 Spartan messages, half matches, half near misses.
4. Output: the side-by-side table, the reader's agreement, TERMS precision and recall, and a recommendation (keep,
   replace or combine).

### D3. Email types and delivery (W3)
1. **Taxonomy by sample.** Draw a stratified sample of at least 300 client emails since 1 Sep: by month, by the
   reader's intent, by v2 decision kind, and over-weighting the 218 with delivery words. Label each one blind with
   one type from the starting list:
   - crew booking;
   - crew change;
   - crew cancellation;
   - crew quote request;
   - delivery or van only (booking, change, cancel, quote);
   - crew plus delivery;
   - confirmation, PO or contacts only;
   - accreditation or forms;
   - invoice or payment;
   - post-job (timesheet, overtime, feedback);
   - automated (OnSinch notifications, e-sign links, login codes, out-of-office);
   - supplier or marketing;
   - internal forward.

   Extend the list where the data needs it.
2. Cross-tabulate the labelled type against:
   - the reader's intent;
   - the v2 decision kind;
   - whether a TV card was made;
   - how that card ended (staff work, settled, never cleared).

   This is the main output: for each type, what the system does today and what it should do.
3. **How deliveries live in OnSinch.** For orders with Driver, Minivan Driver or Van Service shifts, or with
   TransportsTrip rows, since 1 Sep:
   - what their shifts look like (slots, teams, times, places);
   - where pickup and drop-off addresses sit (TransportsTrip data, place, description);
   - how staff book and change them (which timeline actions);
   - what "done" would mean.

   Count delivery-only orders against crew-plus-delivery orders.
4. **How deliveries move through the pipeline today.** For every email labelled delivery in step 1:
   - what the reader returned (intent, requests, venue);
   - what the planner did;
   - whether a card appeared and how it ended.

   Count the delivery requests read as `info_only` (missed entirely), and the delivery cards done.ts could never
   clear.
5. **Other types the TV mishandles.** Automated mail or post-job mail that made a card, and anything that made a
   card it should not have or failed to make one it should have. List by type with counts.
6. Output: the type distribution, the cross-tabulation, the delivery data map (OnSinch fields to the meaning of
   delivery), and a list of proposed changes per type with the needs each would affect.

### Discovery report: what the owner gets to critique
- One page of headline numbers: per workstream, the size of the problem in cards and card-hours.
- The tables from D1, D2 and D3.
- A ranked build list: each item with its expected effect (cards and card-hours, from replay), its risk (needs it
  would wrongly clear, from replay), and what it touches (done.ts, reader prompt, planner, TV).
- Open questions for the owner, each with what the data says.

**Stop here for the owner's critique.**

## Phase 2: build (after the critique, in the order the owner ranks)

The expected shape, to be revised by the critique:
- **W1:** extend done.ts's work recognition and candidate choice for the causes the owner accepts. Each change is
  replayed first and must keep the false-clear count at 0 on the 1 Nov replay (staff work after a clear,
  `order_confirm_provisional` included).
- **W2:** if D2 recommends it, replace agreedOn's client-yes test with the word-free check, generalise the quote
  wait to an offer wait (re-read every minute; any client email with a request, or a confirmed client yes on a
  provisional order, brings the card back), and keep or tighten TERMS according to its blind score.
- **W3:** carry the email's type through the pipeline. Where the type comes from is a decision for the critique:
  - from the reader (a prompt change, which changes PROMPT_ID; the production reader runs on OpenRouter; measure on
    a contained Claude session as in S-0277, never on OpenRouter in tests);
  - from OnSinch (the linked order's professions or TransportsTrip);
  - or both.

  For delivery: what the TV says, which fields it shows (addresses, vehicle, window), and what counts as done in
  OnSinch. Delivery requests must stop disappearing as `info_only`.
- Each build step goes through the session gate (`python -u scripts/session.py ...`). Each step must keep:
  - the generated business at 180/180 with 0 wrong writes (`harness/gen`, add delivery categories if W3 needs them);
  - the full suite green;
  - marksim on production showing exactly the intended marks.

  Update the ADDENDUM status line and §0 table after each step.

## Measures every step reports
- **Replay (316+ needs):**
  - fires by kind;
  - false clears (staff work after a clear, confirm included): must stay 0;
  - never-cleared count and card-hours;
  - each cause's count from D1.
- **Blind wording scores** for any rule touched (n of at least 100 per rule where the data has it).
- **marksim on production:** exactly which needs change mark.
- **Generated business:** 180/180, 0 wrong writes.

## Standing rules (unchanged)
- Read production only through the read-only wrapper; never run anything against the production DATABASE_URL;
  never call OnSinch write paths, /api/bot/*, or the canary.
- No client names, email bodies or addresses in output, logs or docs; counts and ids only.
- Bot writes stay off. No OpenRouter for tests; Spartan model calls use the Spartan Crew Pipeline key only (the
  account balance is shared with HoH production).
- The session gate is the only commit and push. Make no source edits while it runs.
- Agreed marks are final; only the quote-wait mark (and a future offer-wait mark) may be removed by the sync. A rule
  that clears a card must never fire on a promise or a condition.
- No subagents or workflows unless the owner asks.

## Open questions to settle in the critique (with D1-D3's numbers)
1. When staff edit the right order within hours of the email but workOf says the edit does not fit, should "staff
   worked the right order after the email" ever count as done on its own? (D1, cause b)
2. Should a need whose order already held the ask before the email clear for every ask kind, not only fresh
   bookings? (D1, causes c and d)
3. For W2: is a confirmed order plus a client email that asks nothing new enough to call it settled, without reading
   the client's words? (D2)
4. Where should an email's type come from (reader, OnSinch, both), and what should a delivery card show and count as
   done? (D3)
