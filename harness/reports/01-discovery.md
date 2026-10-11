# 01 Discovery: Spartan Crew

Phase 1 of the verification harness. No money was spent: every figure below comes from the
code, the test suite, or read-only queries against production data.

- **Repo revision:** b950a8d (live in production since 2026-10-10 ~22:30Z with `SPARTAN_WRITES=live`)
- **Operator notes in the prompt were blank.** So the Phase 3 budget is $0 until you set it,
  and the project name is taken as Spartan Crew.
- **Edit this file directly.** Correct any branch, answer, target or allocation, then reply
  `approved`.

---

## 0. What the prompt's words mean for Spartan

The prompt was written for a lead-booking product (GoHighLevel, SMS, spam). Spartan's
business is different, so each term needs a meaning here. These meanings live in the
Spartan adapter; the core stays generic for the later merge.

| Prompt term | Spartan meaning |
|---|---|
| Lead | A client email to bookings@ or info@ (one Gmail message id) |
| Book within 5 minutes | The change the email asks for is made in OnSinch and read back verified within 5 minutes of the email being sent. When it needs a person, it is on the office TV within 5 minutes. |
| Final state | One of: written and verified; on the TV for a person (with the reason); nothing needed (with the reason); filtered as not a client's email |
| Spam | Mail that is not a client's: our own replies, no-reply senders, bounces, OnSinch's system mail |
| Real lead filed as spam | A client email filtered or read as "nothing needed" when it asked for a change |
| Tenant isolation | Client isolation: a change must land only on the sender's own company's orders. Spartan is one OnSinch agency today; real tenants arrive with the merge. |
| CRM / GoHighLevel bridge | OnSinch: REST API for reads, the staff UI (browser bot) for every write |
| Team notification | The office TV (Ben, 10-10: "nothing should ever be sent only to ops. Ops should just be notified in the dashboard tv display") |

**Ben's rule for this harness: every observation is 1 or 0.** One mechanism, one case, one
observation: it is either correct (1) or not (0). There are no partial credits or graded
scores. Every accuracy figure in the report is a count of 1s over n, with its confidence
interval.

---

## 2.1 System map

```
Gmail (bookings@, info@ Google Group)
  -> n8n intake CPIRu7CpezvKjU8d (polls each minute, 10-min lookback, Dedupe Claim + "First seen?")
  -> POST /api/n8n-inbound (app/lib/n8nInbound.ts)
       -> capture: inbound_raw + thread_messages, returns new_message_ids
       -> decideDelivery (app/lib/v2/process.ts)
            -> filter: ours / not a client
            -> processMessage
                 -> latestText: the newest message, quoted history dropped
                 -> extract: ONE model call (OpenRouter), JSON with quotes
                 -> ground: every value's quote must be in the email and parse to it
                 -> plan: grounded requests + OnSinch reads -> write | person | none
                 -> record: v2_decisions (with company)
                 -> runOp per operation (if SPARTAN_WRITES=live): lease, ledger, preflight,
                    browser write in the staff UI, read back via API, audit-log check
                 -> record the outcome
  -> office TV: /api/feed (app/lib/feed/*) reads v2_decisions + marks; the verifier reads
     OnSinch for staff edits once a minute
```

| Component | Kind | Why it exists |
|---|---|---|
| n8n intake + dedupe claim | external boundary | The existing intake (Ben's design); passes each Gmail message once, in order |
| /api/n8n-inbound, capture | deterministic | Durable capture first, so no email is lost even if deciding fails |
| decideDelivery filter | deterministic | Only client emails are read; each message id is decided once |
| latestText | deterministic | Quoted history must never count as the client's new words |
| extract | **probabilistic/AI** | Reads the email into requests, each with the exact words it came from |
| ground | deterministic | Throws out any value the email does not literally support |
| plan | deterministic (over OnSinch reads) | Decides the operations, or why a person must act |
| OnSinch REST API | external boundary | Reads only: orders, companies, places, timeline |
| runOp + bot (Playwright on Vercel) | external boundary + deterministic guards | All writes, through the staff UI, idempotent by op key |
| bot ledger, lease | deterministic | A change is never sent twice; one bot at a time |
| canary | deterministic | Detects OnSinch UI changes before the bot writes |
| v2_decisions | deterministic | The recorded decision for every client email |
| TV feed projection + verifier | deterministic | Tells ops what was done and what needs them |

**There is one AI decision point.** Everything after the model call is deterministic, and the
model's values only pass if the email literally contains them.

---

## 2.2 Branch map

The trunk is intake; the tips are the four final states. Frequencies are measured from 123
live decisions on 2026-10-09/10 unless marked "est." (estimated) or "rare".

### Intake (I)
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| I1 | New Gmail message | Captured once, decided once | every email |
| I2 | Re-post of known messages | Nothing new decided | common |
| I3 | Bad JSON from n8n | 400, n8n run shows the error | rare |
| I4 | Capture fails | 500 + error report; no decision | rare |
| I5 | Deciding throws (model down, OnSinch down) | 500 + "engine-threw" report; the email must still reach a final state (**today it does not: see F-1**) | rare |
| I6 | SPARTAN_PAUSED=1 | 503; mail waits in Gmail, nothing claimed (to verify in Phase 2) | operator |
| I7 | Caller without the secret | 401 | rare |
| I8 | Gmail credential expired (10-01..03, 53h) | Watchdog alarm; mail caught up on recovery | rare |
| I9 | Backlog after an outage: several new client emails in one delivery | Each reaches a final state | 21 on 10-09, 0 since |

### Filter (F)
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| F1 | Our own reply | No decision needed | ~50% of captures |
| F2 | No-reply, bounce, OnSinch system mail | Filtered, **with a recorded row** (today: no row) | 10 in 2 days |
| F3 | Client email | Read | 133 in 2 days |
| F4 | Older client email in a backlog delivery | On the TV: "sent with a later email" | 21 (backlog only) |
| F5 | Message already decided | Skipped, no second model call | common |

### Extraction (X), the AI node
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| X1 | Thanks, confirmations, contacts, invoices, no PO | Nothing needed | 54 of 123 |
| X2 | PO-only email | PO path (P28/P29) | est. 3% |
| X3 | Price or quote request | On the TV: "asked for a quote" | 8 |
| X4 | Unclear request | On the TV: "unclear" | 7 |
| X5 | New booking | Create path (P20-P27) | 14 intents |
| X6 | Change of times or crew | Change path (P10-P18) | 10 intents |
| X7 | Cancellation | Cancel path (P19) | 2 intents |
| X8 | Action outside the bot's range ("other") | On the TV | 3 |
| X9 | Model error, no JSON, timeout | Same as I5 | rare |
| X10 | Several requests in one email | All planned, or the whole email to a person | est. 10% |
| X11 | Value with no quote, or quoted from history | Refused by grounding | part of 9 |

### Grounding (G), deterministic
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| G1 | Quote not in the newest text | Field refused, email to a person | part of 9 |
| G2 | Quote parses to a different value | Field refused | part of 9 |
| G3 | Value without a quote | Field refused | rare |
| G4 | Vague count ("a couple", "a few more") | No count, nothing written | rare |
| G5 | Dates: explicit, relative, weekday, bare day, month rollover, year | Exact day or refused | every dated request |
| G6 | Times: "9.30am", "15:30pm", "@ 18:30", "0800 AM", "midday" | Exact time or refused | every timed request |
| G7 | Duration only | End = start + duration | est. 10% of times |
| G8 | Increase without an add-word | Not an increase | rare |
| G9 | Trade the bot has not been benched on | On the TV | 1 |
| G10 | PO without a label | Left off with a note, blocks nothing | est. 5% |
| G11 | New shift missing day, start, end or crew | On the TV | 2 |

### Planning (P), deterministic over OnSinch reads
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| P1 | Sender's domain matches 0 or 2+ companies | On the TV | 1 |
| P2 | Email names 2+ R numbers | On the TV | rare |
| P3 | R number not found, or another client's | On the TV | rare |
| P4 | Thread bound to an order | That order | est. 10% of changes |
| P5 | No order named and no day | On the TV | 1 |
| P6 | One client order on that day | That order | most changes |
| P7 | Several that day; venue names one | That order | rare |
| P8 | Several that day, venue does not decide | On the TV | rare |
| P9 | No shift on the day, or several could be meant | On the TV | rare |
| P10 | Time change with times | set_position_times on each position | 4 writes |
| P11 | Time change by length only | Start kept, end moved | 1 (Wonder London) |
| P12 | Crew written beside a time change differs from the shift | On the TV | rare |
| P13 | Crew total change | set_position_size | est. |
| P14 | Crew increase ("add 2") | set_position_size | est. |
| P15 | Total and increase disagree | On the TV | rare |
| P16 | New total crosses the crew-chief line (3/4) | On the TV | rare |
| P17 | Total above 9 | On the TV | rare |
| P18 | Shift has several crew positions | On the TV | rare |
| P19 | Cancel a shift | cancel_position on each position | est. |
| P20 | New shift on a named order with one location | add_shift | est. |
| P21 | Named order with several locations | On the TV | rare |
| P22 | Every new shift already booked (same window and venue) | Nothing needed | 2 |
| P23 | Some already booked | On the TV | 1 |
| P24 | New booking with no venue | On the TV | 2 |
| P25 | Venue matches 0 or 2+ OnSinch places | On the TV | 2 |
| P26 | New booking, all clear | create_order (crew-chief rule, PO) | 1 |
| P27 | Crew chief asked for on 3 or fewer | On the TV | rare |
| P28 | PO with an order named or bound | set_po | est. |
| P29 | PO with no order | On the TV | 1 |
| P30 | Already as asked | Nothing needed | 4 |

### Bot (B), external boundary with deterministic guards
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| B1 | Op key already in the ledger | Not sent again | every retry |
| B2 | Lease busy | Wait up to 120s, then on the TV | rare |
| B3 | Signed-on crew, any change except an increase | Blocked, on the TV | est. |
| B4 | Shadow mode (writes off) or a non-TEST company in bench mode | Blocked | config |
| B5 | Already true in OnSinch | Verified, nothing sent | est. |
| B6 | OnSinch form no longer matches its contract | Blocked, on the TV | rare |
| B7 | Saved, read back matching, audit row clean | Verified, TV "check to verify" | the happy path |
| B8 | Read back differs | Mismatch, on the TV | bench: 5 of 66 |
| B9 | OnSinch validation refused | Failed, on the TV | rare |
| B10 | Browser died after sending | Unknown, never re-sent, on the TV | bench: 7 of 66 |
| B11 | Shift saved, positions not | Mismatch "stopped part-way" | rare |
| B12 | Audit shows other fields changed | Mismatch | rare |
| B13 | Login fails, reCAPTCHA appears | Blocked | rare |
| B14 | Several ops, one fails | Later ops not sent | rare |

### TV (T), deterministic
| ID | Trigger | Correct final state | Freq |
|---|---|---|---|
| T1 | Verified write | "Order was created/updated, check to verify" | per write |
| T2 | Needs a person | "Order needs created/updated" + reason | per need |
| T3 | Staff edit after the email | Green, by the verifier | most needs |
| T4 | A person ticks | Green | some |
| T5 | Later "nothing needed" email on the thread | Card stays open | common |
| T6 | Job date passed | Leaves the TV | daily |
| T7 | Before 2026-10-10 (FEED_FROM) | Not shown | backlog |
| T8 | Decision made in shadow, not written | "Not written yet (shadow)" | 1 open |

### Business outcomes (O): what a client and ops experience
| ID | Outcome | Correct final state |
|---|---|---|
| O1 | Client books new crew | Order created in OnSinch within 5 min, verified, TV check |
| O2 | Client changes times or crew | Order updated within 5 min, verified, TV check |
| O3 | Client sends a PO | PO on the order |
| O4 | Client says thanks | Nothing written, nothing on the TV |
| O5 | Client asks for a quote | On the TV |
| O6 | Client is vague | On the TV, nothing written |
| O7 | Change touches signed-on crew | On the TV, nothing written |
| O8 | Same email delivered twice | Decided and written once |
| O9 | Ops already booked it by hand | No duplicate order |
| O10 | Unknown sender | On the TV |
| O11 | Email names another client's order | Never written |
| O12 | Email sent at night or the weekend | Same path, same 5 minutes |
| O13 | Intake outage, then recovery | Every email reaches a final state |
| O14 | OnSinch changes its screens | Bot blocks, canary alarms, on the TV |
| O15 | Bounces and system mail | Filtered, recorded |

103 branches in all (9 + 5 + 11 + 11 + 30 + 14 + 8 + 15).

---

## 2.3 Prompt rules

There is one prompt: `SYSTEM` in `app/lib/v2/interpret/extract.ts`. Each rule gets its own
targeted cases.

| ID | Rule |
|---|---|
| P1.R1 | Never invent anything. |
| P1.R2 | Return only a JSON object in the stated shape. |
| P1.R3 | Every quote is copied character for character from the subject or the newest message. |
| P1.R4 | Never quote from quoted history. |
| P1.R5 | A value that cannot be quoted is null. |
| P1.R6 | "a couple", "a few more", "the usual", "same as last time" are not numbers or times: null. |
| P1.R7 | A value is the model's reading of its own quote. |
| P1.R8 | Dates are resolved against the email's sent date. |
| P1.R9 | Times are written in 24-hour form. |
| P1.R10 | A request for prices or a quote is intent quote_request, and its shifts are still listed. |
| P1.R11 | Confirmations, thanks, contacts, meeting points, invoices and PO-only messages are info_only with no requests. |
| P1.R12 | A PO given in such a message is still reported. |
| P1.R13 | One request per shift per day. |
| P1.R14 | A time change names the shift it changes in target. |
| P1.R15 | target.start is the OLD start time. |
| P1.R16 | crew is the TOTAL asked for on that shift. |
| P1.R17 | crew_add only when the client asks for more on top of what is booked. |
| P1.R18 | intent and action take only the listed values. |

---

## 2.4 Inventory of existing tests and harnesses

Full list: `harness/reports/.test-inventory.md` (187 files, one row each).

| Component | What it does | Meets the requirement? | Gaps | Decision |
|---|---|---|---|---|
| `scripts/session.py` gate | tsc + 187 files, then ticket, commit, push | Yes, for deterministic code | Does not run the model or score outcomes | **Reuse**: the harness's free replay suite runs inside it |
| `test/v2Ground.ts`, `v2Interpret.ts`, `v2Plan.ts`, `v2BotPure.ts` | Grounding, planning on a fake OnSinch, bot pure functions | Partly: correct and offline | No case store, no branch IDs, no source tags | **Modify**: their cases move into the case store with IDs |
| `test/feed*.ts` (5 files) | TV projection, verifier, reads-only | Partly | Same as above | **Modify** |
| `test/` old engine (139 files) | The paused engine | No: it no longer handles mail | n/a | **Retire** after your approval (the old engine is frozen as data) |
| Other app tests (~38) | Auth, intake, mail, settings | Yes for what they cover | Not branch-tagged | **Reuse** as-is in the gate |
| `.tmp-v2/score*.mts` | Scores decisions against ops' OnSinch edits | Yes in method | Throwaway scripts, not in the repo | **Rebuild** as the harness's live scorer (the weekly report) |
| `.tmp-v2/replay-all.mts` | Re-plans stored extractions as of the email's time, no model | Yes: this is record/replay for the deterministic half | Model calls not recorded with a hash | **Rebuild** into the runner |
| `.tmp-v2/e2e.mts`, `bench-*.mts` | Real browser writes on TEST 515 | Yes for the bot | Manual | **Modify**: the bot tier of the harness |
| `/api/bot/canary` | Checks the 5 OnSinch screens without saving | Yes | Not scheduled | **Reuse**, scheduled daily |
| `v2_decisions`, `bot_ledger` | Decisions and write outcomes | Partly: the start of a trace | No per-step times, prompt hash, model, tokens, cost | **Modify** into the trace layer |
| Old engine's `metric_events`, `ticket_events` | Old engine metrics | No | Old engine only | **Retire** with the old engine |

End state: exactly one harness, `harness/`, which the gate runs.

---

## 2.5 Targets and case plan

**Targets.**
- **Deterministic nodes:** 100% (G, P, B guards, T, filter, capture). Any 0 is a defect.
- **End to end:** 99% of client emails reach the correct final state.
- **Per node:** there is one AI node, so it carries almost the whole budget:
  - **Extraction:** at least 99% of emails read to the right intent and fields, or refused safely. A refusal costs a person's time, not a wrong write.
  - **Everything else:** 100%.

**Case sources and their authority.**
| Source | Authority | Available |
|---|---|---|
| Real client emails, where ops' own OnSinch edit within 24h is the answer | `ops-action` (proposed new tier, between `operator-approved` and `synthetic-by-construction`: a person acted, but nobody reviewed our output) | 2,841 client emails (Jul 2024 - Oct 2026, 2,656 since Jul 2026); measured 7-30 Sep: 995 emails, at least 129 followed by a staff edit |
| The same emails after you or ops review them in 02-review.md | `human-reviewed` | grows from Phase 4 |
| Constructed parser, planner and TV cases on a fake OnSinch | `synthetic-by-construction` | unlimited, free |
| Old engine labels, v2's own decisions | `system-derived (not ground truth)` | 950 states, 133 decisions |

**Dev and test split.** The emails used to tune the parsers (the 25-email sample of 08-25 to
10-06, and shadow day 10-09) are dev. The test set is held out by date and is never used for
tuning. The prompt has no retrieval index and no examples drawn from data, so the leakage
rule reduces to this split, checked by message id.

**Allocation (3,000 cap).**
| Block | Cases | Source | Model calls |
|---|---|---|---|
| X: real emails, test split, stratified by intent | 1,200 (info-only 300, booking 300, change 300, quote 150, cancellation 75, unclear 75) | ops-action, then human-reviewed | 1,200 |
| Prompt rules P1.R1-R18, about 19 each | 340 | synthetic-by-construction | 340 |
| G: parsers | 400 | synthetic-by-construction | 0 |
| P: planner on a fake OnSinch, 30 branches x 20 | 600 | synthetic-by-construction | 0 |
| B: bot on TEST 515 (real UI) + pure | 150 | synthetic-by-construction | 0 |
| I, F, T, invariants | 310 | synthetic-by-construction | 0 |
| **Total** | **3,000** | | **1,540** |

No branch reaches 300 except the large extraction strata. The report states each branch's
confidence interval openly: for example, 75 cancellation cases with zero failures supports
about 96% at 95% confidence, not 99%.

---

## 2.6 Invariants and error asymmetry

These are hard gates, each reported separately and never averaged into accuracy.

| Invariant | Spartan meaning | Tolerance |
|---|---|---|
| Wrong write | A change in OnSinch the email did not ask for (wrong day, time, crew, order, client) | **0**: the critical error |
| Email lost | A client email with no recorded final state | **0** (today 0 client emails lost; filtered mail has no row, F-1) |
| Client isolation | A write on another client's order | **0** |
| Double write | The same change sent twice | **0** |
| Signed-on crew touched | Any change except an increase on a position with crew signed on | **0** |
| Forbidden fields | Price, wage, rate or pricelist written; anything published, confirmed or approved | **0** |
| No deletion | An order deleted, or mail deleted | **0** |
| Missed write | Writable, but left for a person | Reported as its own rate: lower severity, costs ops' time |
| Five minutes | Email sent to OnSinch verified (or on the TV) | Every case measured. Live today: sent to decided p50 49s, p90 84s, max 109s (n=91). Write time not yet measured. |

---

## 2.7 Generated text

v2 generates no text that reaches a client or ops. The TV note is built deterministically
from the decision. So this is deterministic checks only: the note names the real reason, the
right client, and no invented times. No rubric grader is needed, so it costs $0.

---

## 2.8 Model assignments (Astra Protocol, 2026-09-07) and cost

The protocol's rule: **code establishes fact, Astra exercises judgement, Flash does volume,
and Flash never judges.**

| Harness job | Runs on | Why |
|---|---|---|
| The model under test (extraction) | The production model, unchanged (rule 2: never downgrade) | Results only count against production |
| Every score, invariant and answer-key match | Code | Exact match against ops' OnSinch edits is fact, not judgement |
| Grader / verifier | **Never Flash.** Code first; where judgement is needed, Astra (it caught 4 of 4 planted defects with 0 false corrections; Flash invented 2) | A judging Flash manufactures errors |
| Triage of each failure (likely cause, which rule) | Astra, over a code-built evidence pack, its numbers checked by a numeric gate | Diagnosing mechanism is Astra's measured strength |
| The weekly findings and fix list | Astra, one call per week over the pack; numeric gate; Ben approves | Judgement over facts |
| Challenger run: Flash as the extraction model | Flash, on the same held-out cases, its output validated by grounding | Extraction from text that holds the answer is the Flash job class; grounding already is the deterministic validator. Production switches only if the harness shows it meets the node target. |

**Cost.**
- **Model under test:** 1,540 calls at about $0.02-0.03 each, so about $31-46.
- **Astra triage:** at most 50 failures at about $0.17 each, so about $8.
- **Flash challenger:** 1,540 calls at about $0.004 each, so about $6.
- **Phase 3 total: about $45-60. Suggested budget: $60.**
- **Each week:** about $0.20, for one Astra call.
- **Re-scoring from recordings:** $0. The 133 v2 decisions already stored can be replayed
  through grounding and planning for free today.

---

## 2.9 Weekly delivery (Ben, 10-10)

Every week, at no model cost:
1. **Score.** Every live decision of the week is scored 1 or 0 against what ops did in OnSinch
   within 24h (the method used on shadow day 1, now inside the harness).
2. **Report.** The invariants and the code-shaped accuracy tree, one ticket in the feed.
3. **Review.** A review file: every 0, every write, a stratified sample of the 1s. Reviewed
   cases join the golden set as `human-reviewed`.
4. **Improve.** A ranked list of the misses by business cost, each with a fix proposal for you
   to approve. Approved fixes are rescored against the full golden set before they ship.

---

## 2.10 Build review: where the current build falls short of the best one for our stack

Ranked by business impact.

| # | Finding | Today | Better |
|---|---|---|---|
| F-1 | Filtered mail, and emails whose deciding threw, leave no recorded final state | 10 filtered emails with no row; a throw leaves only an error report | Every captured message gets a row, including "filtered: not a client" and "failed: replay" |
| F-2 | Bot writes run inside the intake request | One request covers deciding, waiting for the lease (up to 120s) and the browser, under a 300s cap | A durable queue or workflow (Vercel Queues/Workflow): intake records the decision and returns; each operation is a step with its own retries and timeout |
| F-3 | No trace layer | No per-step times, model id, prompt hash or token cost stored | The shared trace schema (prompt 3.2), written on every decision point |
| F-4 | Model output is parsed by finding the first `{` | "model returned no JSON" seen in logs | Schema-validated structured output (JSON schema / tool call), with prompt caching |
| F-5 | The bot uses a person's OnSinch login | Its edits look like that person's in the audit log | A dedicated bot user (Q20) |
| F-6 | The old engine is still in the codebase | 139 of 187 test files, most of the suite's ~10 minutes | Retire after approval; keep its tables as data |
| F-7 | The canary is not scheduled | Run by hand | Daily, plus before the first write of the day |
| F-8 | Staff typed wrong addresses (not the system) | Daniel, 10-06, wrote to marcus@luxtechnical.com; Lux's domain is luxtechnical.co.uk (66 emails). Jake reused the address on 10-07. Gmail retried until 10-10, then gave up, so Marcus never got either email. Also 3 to Hackney's VenuesandEventsTeam group (it rejects outside senders), 1 to hannahs@bac.org.uk (550), 1 to sink.hole@beardedkitten.com (policy) | Ops: resend to marcus@luxtechnical.co.uk. Code: show bounce notices on the TV, never only in the inbox |
| F-9 | One Gmail credential feeds every workflow | 53h outage on 10-01 | A second alarm path that does not use that credential |

---

## Questions for the operator

1. **Budget.** Is $60 approved for Phase 3? Section 2.8 has the breakdown.
2. **`ops-action` tier.** Do you accept it as a source authority (ops' own OnSinch edit within
   24h, below `human-reviewed`)?
3. **Old engine.** May its 139 test files be listed for retirement?
4. **Reviewing.** Who reviews 02-review.md: you, or ops?

When this file is right, reply `approved`.
