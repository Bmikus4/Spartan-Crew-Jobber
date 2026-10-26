# Items 5-8 of the held patch, one component at a time (owner's response, item 4)

Written 2026-10-26 by a worker of the orchestrator. Patch: eval/patches/p1-fixes.diff, applied component by component to
305bf84, the deployed revision, in throwaway worktrees. Everything below is $0, offline replay or frozen files: no model
call, no database, no network.

**Status of the prospective set.**
- The 79 emails locked at 7f277f8725036c76 were scored once at Checkpoint B.
- They were not re-scored here. The current-mail figures come from the frozen case files in eval/harness/checkpoint-b/
  (prod, head, nodisp, patch): each card that differs between columns is attributed to the component that drew it.
- Its cards have now been inspected case by case (below, and in audit/paz-acceptance-examples.md). From here on the set is
  dev and regression evidence for any fix designed from it. It is no longer a held-out test.

**Dev provenance.**
- The 561 dev emails were read by production's reader at decision time. 480 were first decided before 2026-10-16 07:00Z
  (anthropic/claude-opus-4.8), and 81 after (openai/gpt-6.1-sol, the current reader). Of the 184 B42 inquiries, 166 fall
  before the switch and 18 after.
- The split uses v2_decisions.created_at in the gold copy, which is the first decision. An email decided again later keeps
  its first time, so a few may sit in the wrong era. The orchestrator can confirm each id read-only from
  interpretation->meta->model.
- Dev is tuned on, in both eras.

## Summary

| dev, B42 (184) | HEAD 305bf84 | + parser (5) | + acceptance (6) | + domain (7) | + display (8)\* | whole patch |
|---|---|---|---|---|---|---|
| inquiry_recall | 133 = 72.3% | 133 | **151 = 82.1%** | 133 | **147 = 79.9%** | 165 = 89.7% |
| opus era (166) / sol era (18) | 118 / 11 | 118 / 11 | 134 / 13 | 118 / 11 | 129 / 13 | 145 / 15 |
| items shown | 152 | 152 | 191 (+39) | 152 | 177 (+25) | 216 (+64) |
| display_precision B42 | 84.9% | 84.9% | 77.0% | 84.9% | 80.2% | 74.1% |
| writes | 27 | 27, same ids | 27 | 27 | 27 | 27 |

\* Display alone does not compile; it was measured with item 1's `systemFailureOf` (see display, testability).

The era row counts each inquiry's own card only. The headline also counts inquiries reached through another email's card:
4 at HEAD, with the parser, with acceptance and with domain; 5 with display and with the whole patch.

- The gains add up: 18 + 14 = 32 = whole − HEAD.
- The parser and domain matching move no B42 inquiry on dev. Each changes one card's reason, and each card stays
  "Order Needs Created".
- **Current mail (prospective, 24 B42, all read by the current reader).** No component moves recall: 20/24 in every
  column. The patch adds 7 cards:
  - 6 from acceptance;
  - 1 from the display rule;
  - 0 from the parser, which gives counts identical to HEAD on all 514 prospective texts (eval/iterations.md, iteration 5);
  - 0 from domain matching: no client differs between the HEAD and patch columns.

## Item 5: the date, duration and crew parser

**What it changes.** app/lib/v2/interpret/ground.ts, all 4 hunks:
- "Duration: N";
- "28-Nov" with a hyphen;
- "reduce this crew to 5", counted only when the words between name the crew and not a time or place;
- day lists and ranges under one month.

Tests: test/v2Ground.ts, +10 cases.

**Current-mail benefit: none measured.** It gives identical counts on all 514 prospective texts, so 0 cards change.

**Dev benefit.**
- 0 B42 recall.
- 1 card changes reason: 1a13a8bf26108f7b (opus era) goes from reading_unproven to policy_lead_days. It stays Needs
  Created, and its order verdict is right both ways (eval/item-correctness.md).
- Earlier measure (audit/STATE.md P5a): of 1,336 stored quotes, +13 are grounded and 0 lost.

**Regressions.**
- None on dev or prospective.
- The one it had, "change the start time to 8:00" read as 8 crew (red-team-B2 B2-7), is fixed and tested.

**Unresolved.**
- 17 reading_unproven cards stay listed on dev with the whole patch.
- At most 15 of the original reading_unproven causes were parser-side (STATE P5a).

**Where its risk sits.** Grounding gates writes. Today it changes only a card's reason. With writes on, a reading that now
grounds could become a write. It must be re-measured as a write gate before any writes-on tier.

**Independent testability: yes.**
- Applies alone to 305bf84.
- tsc is clean and test/v2Ground.ts passes.
- Full suite: see "Full suites" below.

## Item 6: quote acceptance

**What it changes.**
- app/lib/v2/acceptance.ts (new): the rule.
- app/lib/v2/process.ts: a `none` on an accepting email becomes a hand-off naming `found[0]` when there is exactly one.
- app/lib/v2/reasons.ts: the code `quote_accepted`.
- app/lib/v2/interpret/plan.ts: "already as asked" now carries `found`, the orders it checked.
- app/lib/feed/v2.ts: drawn as an update, never Needs Created.
- Tests: test/v2QuoteAccepted.ts and test/feedQuoteAcceptedIsUpdate.ts.

**Current-mail benefit (prospective).**
- +6 cards, all Order Needs Updated. B42 recall is unchanged, because none of the 6 is a B42 inquiry: 4 are on emails the
  labels exclude as already done, and 2 are on non-inquiry emails.

  | email | order named | what staff did after | verdict |
  |---|---|---|---|
  | 1a1685bf51fb7ef6 | R11806 | +0.9 h: confirm provisional, PO, team descriptions, contact lists, admin note | real acceptance, right order |
  | 1a1685cd856e3d9a | R11807 | +0.6 h: the same | real acceptance, right order |
  | 1a16915c98972d9e | R11827 | +0.2 h: confirm provisional, PO, descriptions, contact lists | real acceptance, right order |
  | 1a1695fbc4797b55 | R11838 | +0.0/+0.1 h: PO, confirm provisional | real acceptance, right order |
  | 1a168607d1875747 | none | PO naming R11029, a job whose last day was 10-22. Staff worked on another order (R11349), not R11029 | not an acceptance; update label with no target |
  | 1a16902a3939cb51 | none | a question 0.7 h after staff built R11836. R11836 is still provisional; no completion work | not an acceptance; update label with no target |

- So the rule fired 6 times on current mail, and 4 of the 6 were acceptances. It was tuned on the dev emails it reports 88
  fires / 1 false positive on.
- **Correction to eval/iterations.md (checkpoint run) and audit/final-state.md.** "Staff then worked on 3 of those 4 quote
  orders", "R11838: 0 rows" and "all four orders stay status 0 with no confirm row" are wrong.
  - That count read Job, SlotTeam and Slot rows only.
  - The Order-level rows are keyed by order NUMBER, the trap test/orderAuditByNumber.ts pins. They show an
    `order_confirm_provisional` and an `Order.intern_name` (PO) edit by staff after each of the 4 acceptances.
  - So it is 4 of 4.

**Dev benefit.**
- +39 cards. B42 recall 133 → 151 (+18: 16 opus era, 2 sol era).
- Of the 39:
  - 18 are B42 inquiries;
  - 20 are non-inquiry emails after which staff worked on the client's orders within 96 h;
  - 1 is unnecessary.
- Order (eval/item-correctness.md): 11 name an order, and all 11 are right. 21 name none where staff then worked an order
  that existed. 7 are unscored.

**Regressions.**
- **An update label with no target.** 21 dev cards and 2 prospective cards draw "Order Needs Updated" and name no order.
  The owner has ruled this out (decisions/2026-10-26-checkpoint-b-response.md).
- **A thread label that stays "Order Needs Created".**
  - labelsFor (app/lib/mail/threadLabels.ts:48-53) labels a thread by its worst open item.
  - An acceptance on a thread whose inquiry item is still open as Needs Created leaves the thread "Order Needs Created"
    after staff have built the order.
  - Prospective threads where this applies: 1a16915c98972d9e on 1a16867fcd072728's thread, 1a1695fbc4797b55 on
    1a1693f954a8bffa's, and 1a16902a3939cb51 on 1a168bebd33a2c6e's. Whether staff had ticked the inquiry items is not in
    the copy.
- **Precision.** B42 display precision falls (dev 84.9 → 77.0%; prospective 87.0 → 69.0%), because acceptances are not
  B42 inquiries. Under the quote-work definition the 4 real prospective acceptances are correct items. See Display
  precision.

**Unresolved.**
- 28 of 39 dev cards name no order.
- The rule's precision on current mail is 4/6, from n = 6.
- Cases 2 and 3 (find the order; no quote order exists) have no card of their own: audit/paz-acceptance-examples.md.

**Independent testability: yes, with 2 import lines trimmed.**
- process.ts and feed/v2.ts import item 1's `systemFailureOf` and `reportError` on the same lines as acceptance's own
  imports.
- Trimmed: tsc is clean, and test/v2QuoteAccepted.ts and test/feedQuoteAcceptedIsUpdate.ts pass.
- It names an order only through the plan.ts `found` hunks (plan.ts hunks 4, 6 and 7 of the diff). Without them it is
  still testable, but it names fewer orders.

## Item 7: client resolution by email domain

**What it changes.** app/lib/v2/interpret/plan.ts:
- a domain that 2-3 companies share is settled by the company the email names;
- personal mail hosts are never evidence;
- a known business domain is never a new client.

Tests: test/v2SharedDomain.ts.

**Current-mail benefit: none.** 0 prospective cards differ, and no client differs between the HEAD and patch columns.

**Dev benefit.**
- 0 B42 recall.
- 1 card: 1a13a443201c1d31 (opus era) goes from client_unknown to policy_lead_days, still Needs Created.
  - The sender's domain sits on 2 companies (501, 635). The rule picks 635, the company staff booked R11554 for, so it
    is right.
  - Its truth is NONE (R11554), and the card's verdict stays right.
- Writes are the same 27, so the "known domain is never a new client" guard blocked no create on dev.

**Regressions.**
- None seen.
- The personal-domain harm (red-team-B H2) is fixed and tested.

**Unresolved.** The company is settled inside the planner only.
- The email's recorded client (v2_decisions.company_id) is resolved before planning (process.ts), and the replay row
  still holds null.
- So the TV card would still read "Unknown client" while its plan used 635.
- Recording the planner's company is a separate change.

**Independent testability: yes.** Applies alone; tsc is clean; test/v2SharedDomain.ts passes.

## Item 8: the display rule

**What it changes.**
- app/lib/feed/v2.ts:
  - `work`: a reply card that asks for crew, or that the reader found unclear, is listed and survives our reply;
  - `cls` chips: System Problem / Ready, Writes Paused;
  - `found_by` and `candidates`.
- app/lib/feed/project.ts, serve.ts, check.ts (a reply card becomes tickable), live.ts and app/components/LiveFeedScreen.tsx.
- app/lib/v2/interpret/plan.ts: a several-orders hand-off carries up to 3 candidates. This is a planner decision-shape
  change, not display only.
- Tests: test/feedNeedKind.ts and test/feedReplyWithWork.ts.

**Current-mail benefit: none measured.**
- +1 listed card: 1a1698db8139299b.
  - It is a quote with no day and crew (not B42), reply_detail_missing.
  - Staff made no change to the client's orders within 96 h, so it is unnecessary.
- Production left 0 of the 24 B42 inquiries as a silent reply card (all 4 misses are none_nothing_to_do).
- The chips change no count. 1a1696c2511347f0 (system_failed) would carry System Problem, and the 13 writes would carry
  Ready, Writes Paused.

**Dev benefit.**
- +25 cards. B42 recall 133 → 147 (+14): 13 by the email's own card (11 opus era, 2 sol era) and 1 through a repeat
  reached by an earlier card.
- Of the 25: 13 are B42 inquiries, 9 non-inquiry with staff work, 1 unnecessary, and 2 have no client to check.
- **On current-reader dev mail (sol era, n = 18 B42)** it recovers 2: 1a1493bc7c314c28 and 1a158c5ac15f6fdc. The second
  names no order.
  - Those 18 are tuned-on dev, so this is not held-out evidence.
  - It is the only sign of the display rule's value on the current reader.

**Regressions.**
- 6 listed reply cards name no order.
- 1 reply_unclear card names a wrong order.
- B42 precision falls 84.9 → 80.2% on dev. On prospective, HEAD plus this card gives 20/24 = 83.3%.

**Unresolved.**
- Whether the 33 dev silent reply cards (pre-switch) recur on current mail. On the prospective set they do not (0/24).
- Ticking a reply card (check.ts) is a workflow change. It belongs with the owner's item 6 (what a tick means), not here.

**Independent testability: no, not alone.**
- feed/v2.ts:22 imports `systemFailureOf` from item 1 (TS2305 without it).
- With reasons.ts's `systemFailureOf` hunk added, tsc is clean and both its tests pass.
- The candidates half can be split from the `work` half: they touch different hunks of feed/v2.ts, project.ts and
  plan.ts.

## Dependencies between components

- **Display → item 1.** It needs the `systemFailureOf` chip test. Ship item 1 first, or drop the chip.
- **Acceptance → plan.ts `found`.** It names an order only through the planner's `found`. Its import lines share a line
  with item 1's, which is a textual dependency only.
- **Acceptance and display.** Both edit feed/v2.ts and plan.ts in disjoint hunks, and apply together cleanly (the whole
  patch).
- **Parser and domain** are independent of everything.
- **Thread labels.** The acceptance's thread-label effect depends on how the earlier inquiry item on the same thread is
  closed. That is a display question for Paz.

## Display precision under both task definitions (no floor chosen)

**Classes.** Each card shown (listed or check) gets one class:
- **(a)** a B42 inquiry (labels);
- **(b)** not B42, but staff did work on the client's orders within 1 h before to 96 h after: a booking edit, a confirm,
  a PO, team description or contacts, an admin note;
- **(c)** not B42 and no such work; "c?" means no client was resolved, so no order could be checked.

**Misleading (d)** is flagged on top, from eval/item-correctness.md's order verdicts on dev and by hand on the 30
prospective items:
- d1: Needs Created on an existing order;
- d2: a wrong order named;
- d3: Needs Updated naming no order;
- d4: a listed reply card naming no order.

**Limits.**
- An unscored dev item (none-derivable or conflict) cannot be flagged: 36 at HEAD, 53 with the patch.
- (b) credits any work on the client's orders, so it can over-credit. Two prospective (b) cards are worked only on another
  order; both are flagged d3.

| column | items | a | b | c | c? | d1 | d2 | d3 | d4 | **strict:** a, not d | **broad:** a+b, not d |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dev HEAD | 152 | 129 | 16 | 5 | 2 | 11 | 4 | 7 | 0 | 108 = 71.1% | 123 = 80.9% |
| dev + acceptance | 191 | 147 | 36 | 6 | 2 | 11 | 4 | 28 | 0 | 113 = 59.2% | 140 = 73.3% |
| dev + display | 177 | 142 | 25 | 6 | 4 | 11 | 5 | 7 | 6 | 116 = 65.5% | 138 = 78.0% |
| dev whole patch | 216 | 160 | 45 | 7 | 4 | 11 | 5 | 28 | 6 | 121 = 56.0% | 155 = 71.8% |
| prospective production (as shown) | 23 | 20 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 19 = 82.6% | 21 = 91.3% |
| prospective HEAD | 23 | 20 | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 19 = 82.6% | 21 = 91.3% |
| prospective patch without display | 29 | 20 | 8 | 0 | 1 | 1 | 0 | 2 | 0 | 19 = 65.5% | 25 = 86.2% |
| prospective whole patch | 30 | 20 | 8 | 1 | 1 | 1 | 0 | 2 | 0 | 19 = 63.3% | 25 = 83.3% |

- **Prospective d1** is 1a1696c2511347f0, a change to existing R11734 drawn Needs Created (system_failed), in every column.
  It is the planner's, not the patch's.
- **Prospective (b), production and HEAD:** 1a168216318457a3 (a PO for R11539) and 1a16981f8e34486e (a PO and a question
  on R11835).
- **The patch adds 6 (b):** the 4 acceptances, 1a168607d1875747 and 1a16902a3939cb51. The last two are the d3 cards.
- **The c? card in every column** is 1a16ffd3ab23404b, with no client.

**Severity, worst first (proposed for the owner to rank; dev HEAD → patch, prospective HEAD → patch):**

| # | kind | consequence | dev | prospective |
|---|---|---|---|---|
| 1 | d1 Needs Created on an existing order | Staff may build a duplicate order and double-book crew. The Gmail label says "Order Needs Created". | 11 → 11 | 1 → 1 |
| 2 | d2 wrong order named | Staff may change the wrong booking. | 4 → 5 | 0 → 0 |
| 3 | d3 Needs Updated, no order | The label claims a resolved target; staff must search. Ruled out by the owner. | 7 → 28 | 0 → 2 |
| 4 | d4 listed reply card, no order | Listed as work with no target. No order label. | 0 → 6 | 0 → 0 |
| 5 | c unnecessary | Noise and staff time. | 5 → 7 | 0 → 1 |
| 6 | b legitimate non-inquiry work | Correct under the quote-work definition; imprecise only under strict B42. | 16 → 45 | 2 → 8 |

The d1 cards are the largest severe class on both sets, and none comes from the patch.

## Full suites (`npm run test:all`, each component alone on 305bf84)

| component on 305bf84 | tsc | own tests | `npm run test:all` |
|---|---|---|---|
| parser (5) | clean | test/v2Ground.ts passes | ALL 219 TEST FILES PASS (447 s) |
| acceptance (6), 2 import lines trimmed | clean | test/v2QuoteAccepted.ts and test/feedQuoteAcceptedIsUpdate.ts pass | ALL 221 TEST FILES PASS (451 s) |
| domain (7) | clean | test/v2SharedDomain.ts passes | ALL 220 TEST FILES PASS (433 s) |
| display (8) alone | **fails**: feed/v2.ts:22 TS2305 `systemFailureOf` | not run | not run |
| display (8) + reasons.ts `systemFailureOf` (item 1) | clean | test/feedNeedKind.ts and test/feedReplyWithWork.ts pass | ALL 221 TEST FILES PASS (436 s) |

The worktrees were throwaway (spartan-v2-c0, -c5..-c8, -cw at 305bf84). They have been removed, after all four suites
had finished; the removal deleted through their junctions (audit/incident-2026-10-26-tmp-data.md). The per-component patch
split is reproducible from eval/patches/p1-fixes.diff by file and hunk:
- **parser:** ground.ts, all hunks;
- **acceptance:** acceptance.ts, process.ts hunks 1-2, reasons.ts hunk 1, plan.ts hunks 4, 6 and 7, feed/v2.ts hunks 1 and
  4;
- **domain:** plan.ts hunks 1 and 3;
- **display:** LiveFeedScreen.tsx, check.ts, live.ts, project.ts, serve.ts, feed/v2.ts hunks 1-3 and 5-6, and plan.ts
  hunks 2 and 5;
- **item 1's check:** reasons.ts hunks 1 and 3.
