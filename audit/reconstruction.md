# System reconstruction (OPERATING.md §6.1-§6.7)

- author: the orchestrator. This synthesis is built from six accepted discovery returns, and its conclusions are mine.
- code: branch v2 at 6a98170. Snapshot: `.tmp-data/gold/`, taken 2026-10-23T01:45Z.
- live state: read on 2026-10-24 inside a READ ONLY transaction (`scripts/_readonly.mts`).
- revised after red team A (`audit/red-team-A.md`); the hits and responses are in `audit/checkpoint-A.md`.
- sources, with their spot-checks in `audit/STATE.md`:
  - `audit/pipeline-trace.md` (archaeologist)
  - `audit/history-and-assumptions.md` (historian)
  - `eval/metrics.md` (metric-definer)
  - `eval/label-audit.md` + `.csv` (label-auditor)
  - `audit/data-map.md` (data-cartographer)
  - `audit/glossary.md` (glossary-verifier)
  - `eval/failure-taxonomy.md` (taxonomist)

## Summary (one page)

**What it is for.** Clients email Spartan Crew to book event crew, change a booking or cancel one. The system reads each client email, works out which client sent it and which of that client's bookings it concerns, and then does one of three things:
- makes the change in OnSinch itself;
- puts the work on the office TV for a person;
- records that nothing is needed.

Correct means that every request ends with the right thing in OnSinch, and that the system never writes anything the client did not ask for.

**What production is doing today (2026-10-24, read-only).** It runs as shadow with the TV on.
- Intake is live: 353 messages arrived since 10-21, and the last decision was 10-24 22:18Z.
- Writes are off: Settings `bot_writes_enabled=false`. Of the 22 write decisions since 10-21, 0 were executed.
- Settings `intake_paused=true` does not stop intake. It only tells the TV that silence is expected (`app/lib/feed/serve.ts:44`).
- Staff do every booking by hand, from Gmail and the TV.

**Six facts change how OPERATING.md reads.**
1. **The baseline in §2 is not real mail.** 227/500 and 114/500 are one harness metric on two generated sets. It was measured with a perfect reader on a harness whose fake OnSinch was broken, and 71 of the 227 "passes" were planner crashes (`eval/metrics.md`). 53% of those sets' labels are stale under current rulings (`eval/label-audit.md`). On real mail, the only end-to-end figure so far is the live week 10-14..10-21: 7 of 108 bookable items were completed by the system (S-0217).
2. **§3's model of the display is not the system's.** A TV item is a to-do for staff, not a proposal that a confirm carries out.
   - The TV tick records who and when, and changes nothing in OnSinch (`check.ts:1-6`).
   - New orders the bot makes wait in OnSinch "To Confirm", which staff almost never clear: 1 of 21 was confirmed and 11 were deleted.
   - The bot's edits are written live with no confirm at all.
   - There is no "confirm-ready" state anywhere.
3. **"Not an inquiry" cannot be said, and "already done" looks the same as "nothing asked".** Both end as `none`, which is never shown (`v2.ts:109`, `live.ts:80`). So a silent miss and a correct non-inquiry look the same on the TV.
   - On the live week, 4 of 84 staff-worked inquiries got no TV item: 3 needs-reply cards and 1 model misreading. Staff caught all 4 from the inbox within an hour, and our mailbox answered every question of the week (18 of 18, at a median of 0.2 h).
   - A request that neither the system nor staff acted on cannot be counted yet, because 291 of the week's emails were never read (§6.7).
4. **The deterministic spine exists and is strong where it is used.**
   - The client is resolved before the email is read. Production did so for 85.9% of the live week's client emails (82.2% over the snapshot); today's rule replays at 89.1%.
   - Hand-checked links show 0 disagreements in 92.
   - The live candidate pool is small: median 2, with 83.4% of pools at 5 or fewer.
   - The reply chain (In-Reply-To/References) is read nowhere. It was stored on 0 of the 7,289 snapshot messages; since the 10-23 header node, it is stored on 138-159 of 169 new ones.
5. **There is no known-good version to revert to.**
   - The only tags are the July prototype.
   - None of the six candidates was measured near 99% on real mail.
   - The highest real-mail figure on unrelabelled mail is 81% (old engine).
6. **Staff did not use what the bot wrote.**
   - With writes on (10-14..10-20), staff rebuilt 14 of 16 verified bot creates within about an hour. 9 of them were equal to staff's order by day, times and crew, and 7 by trade as well.
   - All 6 creates made after Gmail labels went live (10-16) were rebuilt or deleted.
   - Durable completions: 3 of 84 inquiries; 0 for new bookings.

## 6.1 Purpose

**One paragraph a non-engineer would sign.** Spartan Crew's clients email to book crew, to change a booking, or to cancel one. This system reads every client email as it arrives. It works out which client sent it and which of that client's bookings it is about. Then it either makes the change in OnSinch itself, or puts the job on the office TV so a person can do it. If nothing needs doing, it says so. It is correct when, for every email that asks for something, the right thing ends up in OnSinch, done by the system or by a person the TV pointed at it, and when it never writes something the client did not ask for.

**Who consumes each output, and what "correct" means to them.**

| output | consumer | correct means |
|---|---|---|
| OnSinch writes: a create into To Confirm, or a live edit | ops staff, who staff and invoice; crew, whom OnSinch notifies of edits to their positions (`app/lib/v2/bot/run.ts:11-14`, Ben 10-15) | the right order, the right change, no duplicate, nothing the client did not ask for |
| TV cards ("Order needs created / updated", "check to verify") | ops staff: user ids 413, 102, 573, 110 make most actions (`audit/glossary.md` §2.3) | every outstanding request is listed with its booking, nothing finished stays red, and nothing outstanding leaves silently |
| Gmail labels (4 order labels, derived from the cards) | staff working in the inbox | the same as the TV, because labels are a second view of the same cards |
| replies to clients | none sent today; an auto-reply is authorized but not built (§5) | n/a |

**Decisions per email, as the code makes them** (the §3 hypothesis is corrected in **bold**):
0. **Which message is decided.** Only the newest new client message of a delivery. Earlier new messages get `none: read together` (`process.ts:187-226`). The minute sweep decides anything left undecided (`process.ts:255`).
1. **Is it from a client?** This is a sender regex, not an inquiry test (`process.ts:161`). It gives `none: not a client's email` on 53 of 847.
2. **Which client?** This is decided **before** the email is read: sender to company by domain or contact (`resolve.ts:113`), or else the company of the thread's linked order (`process.ts:418-426`). 141 of 794 client decisions have no company.
3. **What does it ask?** This is the one model call (`extract.ts:114`). It returns the intent, the requests, values with quotes, and a suggested order. Code keeps a value only if its own parser reads the same value from the quote (`interpret.ts:123-142`).
4. **Is it an inquiry?** This is **implicit**. Intent `info_only` gives `none: no change asked for` (427 of 847), and a request found only in quoted history is `history`. **No decision kind or code means "not an inquiry"** (`audit/pipeline-trace.md` §8).
5. **Which existing order, or none?** Code decides this.
   - **Exactly one order per change** (`plan.ts:190-239`). Several matching orders go to a person, never to a set of orders.
   - When no order is found for a new booking, the result is `create_order` (`plan.ts:710-836`) or a lead-days handoff that the TV shows as "Order needs created" (`v2.ts:85-91`).
6. **Policy.** These rules send the email to a person:
   - the two-week rule;
   - never the day alone;
   - the crew-chief count;
   - lead days;
   - staffed cuts.
7. **Disposition.** `write | handoff (reply?) | none`.
   - A write runs at once when writes are on.
   - **There is no "item confirm-ready" state.**
   - `none` is never shown.
   - Every minute the replan, which makes no model call, can move a decision between these outcomes (`replan.ts:71-139`).

**§17 Q1, answered from the code.**
- **New orders: a person must confirm, as built.**
  - Every bot create sends `request_approval: true` and lands in To Confirm (`apiCreate.ts:92`).
  - That flag cannot be changed after the order is created.
  - There is no other create path.
- **Edits: no confirm.** They are written live whenever both write switches are on (`process.ts:33-36`, `run.ts:206-218`).
- **The rulings conflict:**
  - 08-18: "To Confirm is already a human gate".
  - 09-13: "agentic and standalone. No step may require a human".
  - 09-29: "no orders awaiting a confirm click".
- **No ruling says whether the system may book directly when confident.** That is the owner's decision, and it decides whether the autonomy metric is `review_rate` or `auto_book_rate`.
- **In practice:**
  - staff confirmed 1 of 21 v2 creates and deleted 11, at a median of 2.0 h;
  - staff confirm 59% of their own orders, at a median of 6.6 h.

## 6.2 Anatomy

The full trace, the diagram, and the input / output / failure modes / logging for each stage are in `audit/pipeline-trace.md` §1-§2. The compressed form:

```
Gmail -> n8n (poll, dedupe claim) -> /api/n8n-inbound
  -> capture: thread_messages + inbound_raw          (failure: 500 + reportError; the minute sweep decides it later)
  -> choose newest new client msg                    (older ones: none "read together")
  -> sender filter (regex)                           -> none "not a client's email"         [invisible]
  -> client = sender's company | linked order's co.  (null on 141/794; swallowed errors)
  -> context = that client's bookings <=20, venues <=12; thread last 6 msgs, quotes cut
  -> MODEL READ (the only model call)                (throw -> handoff "could not read")
  -> ground (code): value kept only if code parses the same from the quote
  -> plan (code): evidence finder -> one order | create | handoff | none; policies
  -> v2_decisions row (+ reason code since 10-24)    -> job_links
  -> write?  bot: ledger, lease, preflight, API create / browser edit, read-back, audit
every minute: link sweeps, write retries, undecided sweep, replan (no model)
every 20 s:  TV = cards whose items are needs-created / needs-updated; one card per thread
every minute: Gmail labels derived from the same cards
```

- **Deterministic vs model.** One model call reads the email, and everything after it is code. The model still chooses things code already holds (`audit/pipeline-trace.md` §5):
  - the order pick (212 of 724 readings);
  - the venue_id (65 of 724);
  - the cancel and confirm intent, which code has its own regexes for;
  - the company name.
- **Thread headers and quoted text.**
  - In-Reply-To and References are stored by the code but empty on 0 of 7,289 rows, and read by no file on the decision path.
  - Quoted history is cut from 3,334 of 3,514 client messages.
  - Earlier messages reach the model as separate rows: the last 6, at most 1,500 characters each.
  - Only the order finder reads full bodies, and then only for R, J and PO tokens.
- **Client first, candidates scoped to that client: yes.**
  - The model sees only that company's bookings, and none when there is no client (`process.ts:109-115`).
  - The planner accepts only an order of the resolved company (`plan.ts:197, 202`).
- **"No existing order, so a new order": yes,** as `create_order` or a lead-days handoff. The snapshot holds 27 such ops and 13 such handoffs.
- **"Not an inquiry": impossible as an output.** Those cases fall into `none`, together with "already booked" and "nothing to cancel". That is correct for a non-inquiry, but it is the same invisible outcome as a missed request.
- **Display lifecycle** (`audit/pipeline-trace.md` §9):
  - **Listed:** a card is listed only if it holds a needs-created or needs-updated item.
  - **Dedupe:** one card per Gmail thread, with no dedupe across threads.
  - **Leaves through:** a replan to `none`, a tick, a verifier mark or a dismiss. A green card stays 24 h.
  - **Leaves silently:** when its last job day passes, or after 14 quiet days if it has no date.
  - **Unconfirmed need:** stays red, and is flagged follow-up after 24 h.
- **Action types** (the input to §4 risk tiers). There are seven op kinds (`app/lib/v2/bot/ops.ts:30-37`):

  | op kind | what it does |
  |---|---|
  | `create_order` | goes to To Confirm |
  | `add_shift` | live edit |
  | `add_position` | live edit |
  | `set_position_size` | live edit |
  | `set_position_times` | live edit |
  | `cancel_position` | live edit |
  | `set_po` | live edit |

  - Edits to a staffed position are made, and OnSinch notifies its workers.
  - A cut below the number of workers is refused (`run.ts:72-84`).
  - Every write is idempotent by message and content (`ops.ts:40`) and is read back.

**Per-stage failure modes and logging for the stages pipeline-trace left open** (S3, S5, S9, S10, S12-S17) are in `audit/pipeline-trace-addendum.md` (stage-gaps d279ecf8; 35 of 353 citations re-opened, all hold). Those that bear on §4 and §15:
- **No stage from the sender filter onward reports a failure to a person.** `app/lib/v2` and `app/api/bot` make no `reportError` call. The trace sink in production is `noTrace` (process.ts:519). The minute sync answers `ok: true` whatever its parts did (sync/route.ts:29-42).
- **New silent ends:**
  - client mail first stored more than 24 h before the undecided sweep reaches it is never decided (process.ts:235, 262);
  - a passed job day strips the card and its Gmail labels (project.ts:417; threadLabels.ts:67-70);
  - a `create_order` that made an order but did not verify stays red with nothing to close it (3 of 27 in the snapshot).
- **Re-deciding a message through `POST /api/bot/process` erases its write record.** That is the route the intake alarm names. `executed` is upserted as jsonb `null`, which `coalesce` keeps (process.ts:514-517). Recorded for Phase 1, not fixed.
- **Marks are insert-once.** A wrong `order-found` or `resolved` keeps a need green even if it returns (marksDb.ts:62-76).

## 6.3 History

From `audit/history-and-assumptions.md`:
- **Original intent (07-20).** The model does three language jobs and code does everything with an integer in it. Orders were staged as drafts, and a person confirmed with one click, "and eventually zero". The launch was draft-only, and automation was to be earned through measured gates.
- **Four turns:**
  - 09-13, "no step may require a human", dropped the one click.
  - The 10-06 rebuild (v2) wrote to real clients from 10-10.
  - From 10-10 to 10-20: the TV became the only channel to staff; creates moved to the API into To Confirm; data-driven defaults arrived; one minute replanner replaced the side passes.
  - The system was paused on 10-21, and the outside review's first three phases shipped on 10-23 and 10-24.
- **113 rulings:** 76 enforced, 12 dead and 25 contradicted. These matter for Phase 1:
  - "money stays human" vs. the rate card on every create;
  - "an R number is never the mechanism" vs. a finder that tries the R number first;
  - "crew is never identity" vs. crew count accepted as evidence;
  - "no step may require a human" vs. To Confirm and the TV;
  - two identity rules live at once: the planner's `evidence.ts`, and the old `matchExistingOrder` still called by the TV verifier (`feed/verify.ts:240`).
- **Why 99% looked reachable.** Every figure at or above 97% came from built or pre-selected inputs:
  - a scripted or perfect reader;
  - generated mail;
  - threads already bound to staff orders;
  - labels derived offline.

  The assumptions that real mail contradicts are that the model is the only node that can miss, and that generated cases stand in for real ones. On unrelabelled real mail, end-to-end figures run from 2/22 to 81%. Single-mechanism figures run higher: the link check reached 84% on hand labels (S-0120).

**The three documents the history could not read offline were read on 10-25** (`audit/plans-read.md`, plans-reader 65fcb127; 7 quotes re-opened at their source, all exact).
- **"The owner's audit" is best fitted by the 10-03 "Spartan Audit".** That audit found 3 live incidents and 9 defects, intake down about 53 h with no alarm, and every engine order since 09-30 deleted by staff.
- **"The previous 99% plan" is best fitted by the harness plan** (`harness/reports/01-discovery.md` §2.5). It is the only candidate whose 99% was reported met and whose own set later read 227/500, about 45%.
- **The 10-15 V1 plan says itself "1 in 100 not met (this plan)".** It also found staff rebuilding bot orders identical to their own ("Staff simply did not use the bot's order"), and it named the value checker as the main cause of misses.
- **The matcher plan counts "Unsure" as a miss.** By that rule, about 70% of its answers are right today.
- **Two owner rulings of 10-03 are missing from the history's list:**
  - "every single deduplication should get an AI step, with reinforced deterministic steps";
  - "split it, (multiple orders CAN be attatched to a single enquiry)".

  Their status in v2 is not yet assessed: v2 plans exactly one order per change (`plan.ts:190-239`).
- The reader went live on a 22-email check (S-0189). The V1 plan's settled table required 100.

## 6.4 Metrics

From `eval/metrics.md`; I reproduced both numbers from my own pre-fix run.
- **A and B are one metric.** It is the harness's `e2e` bit: the decision kind matches the expected kind and, for writes, the essential fields of each op match (`app/lib/v2/score.ts:18-31`). Its denominator is all 500 cases.
  - A (227) is the generated simple set; B (114) is the generated update set.
  - Both were run in oracle mode, on code where `plan.ts once()` had dropped the fake world's methods.
  - At HEAD they read 304 and 154.
- **B is not downstream of A.** The sets are disjoint, though they shared one cause (the `once()` bug). The dependency §6.4 asks about sits inside `e2e`: a wrong order forces wrong ops, and one bit hides which stage failed.
- **They do not suit §4.**
  - They are not real mail and do not exercise the model.
  - They weigh a flag the same as a wrong write: at HEAD, A's 196 failures are 10 silent misses, 19 wrong writes and 167 flags.
  - Crashes scored as correct handoffs: 71 of A's 227.
  - The expected crew split is computed by the code under test.
- **Proposal:** replace them with the §4 / A.3 metrics, computed on real mail from production's stored decisions against what staff did afterwards. Keep `e2e` only as a $0 plumbing gate (`test/harnessGate.ts`). No scoring code has been changed. The first cut on the gold set, from unaudited labels and to be verified in §6.7:
  - inquiry_recall 194/298;
  - silent misses 104;
  - review_rate 207/275;
  - client agreement 186/189.
- **One meaning of "item" for the whole package.** Applied to today's system, A.3's terms mean the following.
  - An **item** is any decision other than `none`.
  - A write is the system's **confirm-ready** answer.
  - A handoff, or a write that did not run, is **flagged**.
  - **Shown** means listed on the TV or labelled in Gmail. Needs-reply items are neither, which is why they count as silent misses.

  Live week: 122 items. Of these, 23 writes ran; 81 items were listed cards, 17 of them writes that did not run; 18 were needs-reply. So review_rate = 99/122 = 81.1%. The figure 207/275 above is the first cut's on gold, and "100% by construction" counted listed cards only. Both are replaced by this one.

## 6.5 Ground truth

From `eval/label-audit.md` (98 hand-verified, 59 of them misses; I re-ran 10 of those):
- **The 500 were labelled by the generator on 2026-10-10,** under that day's rulings, and never updated. Under today's rulings 532 of 1,000 are wrong: 426 by "never the day alone" and 70 by the two-week rule. That leaves 46.7% clean against the 99.5% required, so **fixing the eval set is the first Phase 1 task.**
- **NONE and not-an-inquiry exist only in the simple set:** 170 NONE and 115 `none`, all 115 correct. The update set has neither.
- **The 500 are synthetic.** No company, domain or message id overlaps the real snapshot.
- **The real-mail ground truth that exists is a different set:**
  - `.tmp-data/gold/truth.jsonl`, with labels derived from staff actions in OnSinch;
  - 147 hand adjudications in `data/gold/adjudications.jsonl`.

  Its labels are unaudited apart from those adjudications. That is the set the §4 metrics should stand on.
- **Open question for Ben, with the largest effect on labels:** does "client" count as the second fact beside the day (`evidence.ts:2-3`)? If yes, the 426 labels are right and the system is too strict. Either way, labels stay below 99.5% (89.3% at best).

## 6.6 Data map

From `audit/data-map.md`. I reproduced 7,289 / 1,279 / 0.
- **Email.**
  - thread_messages: 7,289 messages in 1,279 threads, each with a full plain-text body that includes the quoted history.
  - Message-ID, In-Reply-To, References, Cc and attachment names are filled on 0 rows. The header node went live on 10-23 and no mail had arrived before the snapshot.
  - Threads join only by Gmail threadId.
- **Outbound.**
  - Kept: 3,775 rows, present in 994 threads.
  - Only 4.9% of our subjects carry an R or J number, so subjects are a weak join key.
- **Orders.**
  - The snapshot holds the newest 3,500 orders.
  - "To Confirm" is not a field.
  - Status meanings were verified against the data.
  - OnSinch reuses order numbers: 292 of 1,159 numbers appear on more than one order. Joins must use the id.
- **Staff confirmations.**
  - Logged and timestamped: 519 rows.
  - Each row names the order by its number only.
  - Median 15.4 h after creation.
- **Sender to client, last 30 days.**
  - The production rule, replayed over 30 days against the 10-23 company list, resolves 1,175 of 1,319 client emails (89.1%). Production's stored decisions carried a company for 82.2% of the snapshot and 85.9% of the live week.
  - Of the 144 left unresolved: 106 have a domain on no company, 23 a domain on two companies, and 15 a free-mail address.
  - 0 disagreements with 92 hand links.
- **Orders per client.**
  - Across all statuses: median 7, p90 48, max 288.
  - The live pool at email time: median 2, p90 7, max 15.
  - Choosing the order needs ranking only inside a pool of 2 to 15.
- **Blocked offline:**
  - inbound_raw;
  - whether an outbound row is an unsent draft;
  - any To Confirm marker the API did not return;
  - audit actions outside the 8 fetched.

## 6.7 Failure taxonomy

Source: `eval/failure-taxonomy.md` (taxonomist, fb98f168), built on real mail: the live week 10-14..10-21, with the gold set kept apart. I re-bucketed 14 of its 117 rows (12%): every tenth row, plus both kinds of strict silent miss. The rows were taken from the stored decision, the executed statuses, the staff acts and the final order state. I read no email text beyond booleans for whether a value appears in the newest text. **14 of 14 agree.**

One caveat: "equal to staff's order" compares day, times and total crew, and ignores the trade split. On 1a15984719fbd60e, staff used professions 45 and 46 where the bot had used plain crew.

The buckets describe the code that was live when each email arrived, not HEAD. Three causes are already fixed at HEAD:
- start-only time changes keep the shift's length (`plan.ts:578-583`, citing R11029);
- time changes on staffed positions are no longer refused (061d388, 10-15);
- duplicate shifts went from 6 to 0 in replay (S-0197).

Replaying the week at HEAD ($0, `scripts/score-vs-ops.mts` without `--paid`) would say how many of the 67 remain. That is a Phase 1 measurement.

**Silent misses first.** The denominator is 84 real inquiries with staff work. 4 got no item, so inquiry_recall is 80/84 = 95.2% (exact 95% CI 88.3-98.7%), against a target of 99.5%. It is 79/84 = 94.0% if the ambiguous `none` 1a13eb94f0ccb389 counts as a miss.

**This denominator holds only emails staff acted on.** A request that neither side acted on is excluded by construction (red team H5).

**Over all client mail it is 16 of 90 (W3, `eval/live-week-reads.md`).** All 400 emails of the week were read blind by two readers, who agree on 394 of 400 about whether an email asks for booking work.
- 26 of the requests are OnSinch's own portal notices, for orders already in OnSinch, and are rightly suppressed by rule.
- 20 were already done when decided.
- Of the 90 outstanding requests, 16 got no shown item. inquiry_recall is 74/90 = 82.2% (CI 72.7-89.5):
  - 8 were `none` because the model read no change. Staff built or changed the order on the named day for 4 of them.
  - 8 were needs-reply items that nothing shows.
- Counting quote requests as inquiries, it is 24 of 113. Whether a quote that names a day, times and crew is a booking is for the owner to rule.
- **1a1399db710f7409:** a quote naming the day, times and crew was read by the model as `info_only`, which gives `none`. Staff built the order 17 minutes later.
- **1a13f8312ae75c73, 1a140632ce4d5e99, 1a144c619a140ea6:** these are **needs-reply** cards.
  - The TV lists only needs-created and needs-updated cards (`app/lib/feed/serve.ts:109`).
  - Gmail labels have no label for a reply (`app/lib/mail/threadLabels.ts:40-45`).
  - Nothing drafts or sends the reply.
  - In all three, staff did the booking work within an hour, from the inbox.
  - Our mailbox answered every needs-reply email of the week: 18 of 18, at a median of 0.2 h. Our reply clears the item (`project.ts:439`), so a booking still wanted can leave the TV once the question is answered.
- **Under the wider reading the count is 19.** That reading also counts a verified bot write, which the TV does not list (`serve.ts:116`) and which shows only as an "Order Created/Updated" Gmail label.
- **The gold set's first-cut figure was a label artefact.** None of the metric-definer's 79 first-cut silent misses there has a day-matched staff action.

**The live week's own scoreboard was mostly label error.**
- 31 of week-review's 32 "missed changes" are emails that asked for nothing:
  - 13 acknowledgements;
  - 3 auto-replies;
  - 7 information-only emails;
  - 8 POs or confirmations of what already stood.

  `scripts/ops-truth.mts:75-76` gives each staff act to the client's latest email within 36 h.

  That judgement is one reader's. 6 of the 31 carry a staff act on a day the email names (red team N3). The `none` on all 31 is true by construction, since they were drawn from week-review's `none` rows.
- "Completed 7" is also overstated: staff undid or rebuilt 3 of the 7.

**Buckets.** These are the 117 rows: 101 bookable, non-completed rows plus 16 that week-review could not see. They were bucketed at the first stage that failed.

| bucket | n | where it ended | what it is |
|---|---|---|---|
| label_wrong | 37 | 31 no card, 3 check, 3 listed | the email did not ask for the act it was given |
| parse_failure | 23 | all listed | at most 15 are parser-side (13 "reads as null", plus 2 cancellations). 21 are `reading_unproven`: crew in words, "Duration: N", a day plus a time read as the year, an ordinal day given the wrong month, a range read as one day. 2 are cancellations without a known phrase |
| pipeline_break | 21 | 12 check, 8 listed, 1 reply | **12 verified bot creates that staff rebuilt** (9 equal to staff's own order by day, times and crew); 4 staffed refusals (fixed 10-15); 2 crew-chief stops; 2 OnSinch 404s; 1 attachment |
| wrong_action | 13 | 9 listed, 2 check, 2 reply | 5 start-only time changes (fixed at HEAD); 2 replies where a default or rule applied; 2 ops that do not exist; 1 split; 1 old rule; 1 window shape; 1 duplicate shift |
| wrong_client | 7 | all listed | company null at decision, so the reader saw no bookings. 1 of the 7 resolves at HEAD |
| genuinely_ambiguous | 3 | | |
| not_recognized_as_inquiry | 1 | no card | |
| wrong_ranking | 1 | check | |
| candidate_not_retrieved | 1 | listed | |
| not a miss (a rule in force) | 10 | listed | 7 lead days, 3 cuts below booked workers |

That leaves 67 system misses.

**Where the 84 real inquiries ended:**
- 3 were completed by the system and stayed completed. The taxonomist's 4th, R11562, has been gone since 10-15 (red team N1).
- 16 were written by the system and then undone or rebuilt:
  - 13 creates. 9 were equal to staff's order by day, times and crew, and 7 by trade as well.
  - 3 wrong writes.
- 4 were silent;
- about 59 were handed to staff on the TV;
- 2 were ambiguous.

**item_correctness (§4; A.3 "items with correct opp-or-NONE and correct change ÷ items shown"), live week.**

The data are the 40 write decisions of the 400 client emails, each checked against the taxonomist's verified row or against week-review's completion. Correct means the right order (or NONE, a new order) and the same day, times and crew as the email and staff's own order.

| items | correct | wrong | other |
|---|---|---|---|
| 23 writes that ran (verified) | **18** | 3: a shift added to an order when a new order was right; three 1-hour windows; a shift staff had already booked | 1 equal to the email, but staff booked other days and crew; 1 ambiguous (midnight or noon) |
| 17 writes that did not run (refused or stopped, so listed) | 10 by value: 4 staffed refusals (rule removed 10-15), 2 crew-chief stops, 3 cuts below workers that a rule sends to ops, 1 cancel the client reversed later | 5 start-only time changes that kept the end (fixed at HEAD, plan.ts:578-583) | 1 ambiguous; 1 with no staff work, not judged (1a139a998169549f) |

- **When the system acts, it is right on 18 of 23**: 78%, exact 95% CI 56-92%. Of its 40 proposals, executed or not, it is right on 28: 70%, CI 53-83%. The target is 99%.
  - The 18 include one create whose order is now missing from the snapshot, and one where staff used other trades (1a15984719fbd60e). Leave both out and the count is 16 of 23.
- **Literally, A.3 counts every item shown.** That is 104 items: 23 writes and 81 listed cards.
  - A listed card carries no change that a confirm would carry out. The TV tick writes nothing to OnSinch (glossary.md §2), so staff do the work themselves.
  - On that reading item_correctness is 18/104 = 17%. W4 checks what a card actually shows.
- **Correct writes were still rebuilt.** 12 of the 18 correct writes are creates, and staff rebuilt or deleted 11 of them. The second-worst outcome (§4), confirming the wrong thing, happened on 3 of 23 writes. The more common failure was doing the right thing and being redone.

**Operational failures shown to staff (§2: "must never be visible to the team"), live week: 5 of 81 listed cards (6.2%).**
- 2 `system_failed`: "the system could not plan this email (GET /orders answered N)", an OnSinch read error.
- 3 writes that stopped part-way at the crew-chief position.
- Not counted: 3 `booking_link_unreadable` cards. A linked order the system cannot read is a booking gone, not a fault (`reasons.ts:27`). Corrected on 10-25: the first count said 8.
- Held-link cards ("Order not found in OnSinch", `serve.ts:121-127`) come on top of these. The snapshot holds 2 held links.

Each of these reaches the TV as an ordinary needs-created or needs-updated card, with nothing marking it as the system's own failure.

**No precision-vs-coverage curve can be drawn yet (§4).**
- The current gate has no tunable confidence threshold. A grep of `app/lib/v2` for threshold, margin and confidence cut-offs finds none.
- Every route to a person is a binary rule: the policies of §6.1, grounding, and a link that cannot be read.
- The only setting is lead days, which is a policy and not a confidence.
- The curve becomes possible once the selector computes the evidence-based confidence of §9.6.

**Slices** (from the taxonomist; the near-total ones):
- **New bookings:** 0 durable completions out of 59 rows.
  - Staff rebuilt 14 of 16 verified bot creates within about an hour, and 10 carry a staff delete row.
  - Gmail labels have marked bot creates "Order Created" since 10-16 04:37Z (S-0191). All 6 creates made after that were rebuilt or deleted.
- **Edit writes on 10-14 and 10-15:** 11 of 12 refused under the staffed-positions rule of the time.
- **Company null:** 7 of 7 with staff work were handed off without a client. week-review cannot score any of the 89 company-null rows (`ops-truth.mts:21`).
- **Start-only time changes:** 5 of 5 planned with the wrong end.
- **Companies with no completion:** 457, 137, 324, 111, 238, 48 and 347. The rows for companies 61 and 128 are mostly label errors.

**NONE and not-an-inquiry.**
- **NONE:** 43 emails needed a new order. The system said so for 38: 17 creates and 21 "needs created" handoffs. It did not for 5. NONE exists only as an op kind or a card kind, never as a decision kind.
- **Not an inquiry:** 31 emails were judged not to be inquiries, and all 31 had `none`. That is true by construction.
  - Non-inquiries that did get an item, the noise case: both readers call 5 of the 104 items shown "nothing" (4.8%), all of them listed cards (W3).
  - The system cannot say "not an inquiry", and the sender regex is the only rule-based suppression. All 21 auto-reply or newsletter-like emails were suppressed by the model reading them as `info_only`, never by a rule. §4 requires suppression by deterministic rule.
