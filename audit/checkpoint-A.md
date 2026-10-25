# Checkpoint A: proposals (OPERATING.md §7 items 4-7) and the red team's hits

This file holds the proposals the owner needs to rule on. The one-page message is `audit/alignment.md`. Every figure here was revised after red team A (`audit/red-team-A.md`), and again on 10-25 after the spec review (`audit/spec-compliance.md`). The hits and my responses are in the last section.

## Summary

**§4 Stabilization: no revert, because there is no known-good version.**
- Production stays in shadow: writes off, intake on, the TV up. The owner ruled this on 10-24 and 10-25.
- Health means four checks: no writes; a Gmail-side count of incoming mail against the store; the intake alarm live; no need dropping silently.

**§5 Highest-leverage move: the real-mail eval set.**
- Its method was tested on the live week. Two blind readers read all 400 client emails and agree on 394; a third matches them on 38 of 40.
- The first figures: inquiry_recall 74/90 = 82.2%, writes right 18/23, review_rate 81.1%, display_precision 96/104.
- What is left: adjudicate 37 rows, get the owner's ruling on quote requests, then read the earlier weeks.
- After that come the fixes, largest group of misses first.

**§6 Risk tiers and metrics.**
- Four tiers: T1 internal (a PO), T2 waits for a person (a create), T3 a live edit crew may be told about, T4 drops workers (refused as built).
- §4 / A.3 metrics replace the harness's 227/114. There is one meaning of "item", and the reason_code backlog is reported with them.

**§7 §17 questions.**
- Answered: Q2, Q5 and Q6.
- Q1: the owner's own 10-13 and 10-16 words settle it for creates; one question about the tick remains.
- Q3 needs the owner or Paz: does OnSinch notify crew?
- Q4 is the owner's: the display_precision floor.

**§10 (`audit/display-proposals.md`): two proposals, nothing built.**
- Every way a card leaves writes a mark, and an open need whose day passes is counted as a miss.
- A chip on each card separates "your decision", "ready, writes paused" and "system problem".
- A card about an existing order shows how its order was found, and up to 3 candidates.

## 4. Stabilization: should production revert?

**No revert.**

- **There is no known-good version to revert to** (`audit/history-and-assumptions.md` §4).
  - The only tags are v0.01-v0.03, the July prototype.
  - None of the six candidates was measured near 99% on real mail.
  - The one version the owner called good, the old engine's matching, scored 78-81% on real mail. Staff retyped every order it created.
- **Production runs in shadow** (read-only, 2026-10-24, `audit/live-state-2026-10-24.md`):
  - Intake and decisions are live.
  - `bot_writes_enabled=false`.
  - 0 of 22 write decisions since 10-21 were executed.
  - Every planned write shows on the TV as a needs-created or needs-updated card (`app/lib/feed/v2.ts:89`).
  - Staff do every booking.

  A revert would put back writes with weaker defences (F1-F3 and F22/F23 were fixed at 6a98170), and it would buy nothing while writes stay off. The owner, 10-24: "nothing is supposed to be stopped right now, the dashboard is staying up".
- **One thing was unhealthy, and it is fixed** (owner, 10-25: "the only thing that should be paused are job and order update and creates").
  - Settings `intake_paused=true` had been left on from the 10-21 pause, although intake was live again from 10-22 00:25 UTC.
  - The TV read "Intake Paused" (`LiveFeedScreen.tsx:259`), the Help assistant told staff "new emails are not being read" (`app/lib/help/liveState.ts:19`), and the TV's intake alarm was suppressed (`serve.ts:140`).
  - On 10-25 it was set to false. Only that key changed, and `bot_writes_enabled` stays false.
  - The n8n Intake Watchdog, off since 10-21, was activated.

**What I would verify to call it healthy.** These are read-only queries or existing tests, run daily:
1. **No writes.** 0 executed writes while `bot_writes_enabled=false`. Today: 0/22.
2. **No lost email, seen from Gmail's side.** Compare Gmail's own count of client messages per day against `thread_messages`.
   - The store cannot see mail that never reached it. That is the 08-26 failure mode (`app/lib/intakeHealth.ts:1-8`).
   - Checked against Gmail on 10-25 (`audit/live-state-2026-10-24.md`):
    - 40 client emails from the pause window (10-21 01:05Z .. 10-22 00:25Z) were never stored.
    - 27 others were stored later and decided.
    - Our mailbox replied in-thread to 35 of the 40 during the window.
    - The built-in catch-up reaches back 72 h only, so it can no longer recover them.
3. **The alarm is live.** `intake_paused=false` and the Intake Watchdog is active (both true since 10-25). The TV's intake-stale flag fires when no email arrives in working hours.
4. **No dropped need.** Every needs-created or needs-updated decision reaches the TV list (`test/feedKeepsEveryNeed.ts`).

Silent misses are **not** on this list. They cannot be measured yet; see §5.

## 5. Highest-leverage move: an eval set that sees every client email

**Why this is first.** The taxonomy and the red team agree on what the live week shows: everything measured so far comes from a filter that cannot see the §4 worst case.
- The silent-miss count of 4 out of 84 is taken only over emails staff acted on. A request that neither the system nor staff acted on is excluded by construction.
- 246 "nothing to do" emails of the live week were never read. 95 of them also had no reply from our mailbox. So were 45 handoffs with no staff work.
- The live scoreboard credits each staff act to the client's latest email within 36 h (`scripts/ops-truth.mts:75-76`).
  - 31 of its 32 "missed changes" were judged label errors by one reader.
  - 6 of those 31 carry a staff act on a day the email names.
  - Only 14 of the 117 bucketed rows were re-checked, and those without reading the text.
- `ops-truth` skips every decision with no company (`ops-truth.mts:21`), so the whole wrong-client bucket (51 of 362 client emails) is invisible to it.

**The move.** One labelled set of real mail, built in this order:
1. **Unit:** every client email of a real window, starting with the live week's 362. Each gets:
   - is it a request?
   - which client;
   - which order, or none (a new order);
   - what was asked for;
   - what the right outcome is.
2. **Labels come from the email's own words and the order state at the time,** not from staff timing. Staff acts are evidence, never the label.
3. **Two independent readers.** Disagreements go to the owner or Paz, and §6.5's 99.5% bar applies before any target is claimed.
4. **The 291 unread emails first,** since any true silent miss is among them. The 117 + 100 Phase 0 rows are the seed.
5. **The scorer computes the §4 / A.3 metrics from production's stored decisions** against these labels. It is $0 and needs no model call.

**Expected gain on each §4 metric.** None of their values moves. What moves is whether they can be measured:

| metric | today | with the set |
|---|---|---|
| silent_miss_count / inquiry_recall | **16 of 90 outstanding requests over all 400 client emails: 82.2% (CI 72.7-89.5)**, two blind readers, not yet adjudicated (`eval/live-week-reads.md`). It is 24 of 113 if quote requests count. It was 4 of 84 when counted only over emails staff acted on | measured on the adjudicated set |
| item_correctness | live week: right on 18 of 23 writes that ran (78%, CI 56-92%) and 28 of 40 write proposals (70%). Over all 104 items shown it is 18/104 = 17%, because a listed card carries no change a confirm would make (reconstruction.md §6.7) | measured on every item |
| review_rate | live week: 99 of 122 items ended with a person (81.1%): 81 listed cards and 18 needs-reply. The other 23 were writes that ran. "Item" here means every decision other than `none`, and that definition is used everywhere in this package | measured; the target is 5% |
| display_precision | 96 of 104 items shown are a request of some kind (92.3%), 74 are booking work (71.2%), and 5 are nothing (4.8%), per both readers | measured on the adjudicated set; floor is Q4 |
| client_resolution_accuracy | correct client on 115 of 123 gold emails with a strong or adjudicated order label (93.5%, CI 87.6-97.2): 5 left with no client, 3 given the wrong one (179 of 193 with medium labels). Coverage: 85.9% resolved by production on the week, 89.1% in a replay | measured, including wrong-company cases |
| none_precision / none_recall | recall: 38 of 43 new-order emails said so (taxonomist). Precision: 12 of 19 `create_order` writes were on emails both readers call a new booking, and the other 7 on quote requests (W3) | measured |

**Then, measured on that set, in this order:**
1. **The parser: at most 15 of the 23 grounding misses.** 13 are "reads as null" plus 2 cancellation phrasings. The other 8 are the model's quote or reading, not the parser.
2. **The needs-reply clearing rule.**
   - Our reply clears a needs-reply item (`app/lib/feed/project.ts:439`). Our mailbox answered all 18 of the week's at a median of 0.2 h, so a booking the client still wants can leave the TV once we answer the question. In the PDF's p6 #6, 12 of 33 Needs Reply threads were later booked by staff (1f3ae9a body).
   - The fix would keep the booking need after our reply. That is a display change, so it needs the owner's and Paz's authorization (§5, §10).
3. **Client resolution: 6 of the 7** (1 already resolves at HEAD). The RFC headers name no company, so the signals still have to be found. This remains open.

**Withdrawn after the red team:** "close the hand-over" by listing bot creates on the TV.
- It counted hidden creates that do not exist while writes are off.
- It reverses the owner's 10-13 rule. The owner's words: "Everything that cant be created by the system which includes both orders and updates should be less than or equal to 1/100. Only those cases should be moved to the display TV" (B30(6), B32).
- Visibility did not stop rebuilds: all 6 creates made after Gmail labels went live (S-0191, 10-16 04:37Z) were rebuilt or deleted.
- The question that remains is for staff, through Paz: why did they rebuild the bot's orders?
  - 9 of the 14 were equal to theirs by day, times and crew, and 7 by trade as well.
  - If the cause is content, the create path needs fixing first, measured on the set.

## 6. Risk tiers (proposed) and metric replacements

There are seven op kinds (`app/lib/v2/bot/ops.ts:30-37`).
- **Measured:** creates wait in To Confirm, where staff confirm or delete them (1 confirmed and 11 deleted of 21). Edits are live.
- **Taken from a code comment and never measured:** OnSinch notifies a position's workers when the position is edited (`run.ts:11-14`, citing the owner, 10-15). This is Q3.
- **Enforced at HEAD:** any `cancel_position` on a position with workers, and any cut below the number of workers, is refused (`run.ts:77-81`, in `preflight` `:216-217`). No op can drop a worker today.

| tier | ops | reversible? | who is affected if wrong |
|---|---|---|---|
| T1: internal | `set_po` | yes | the invoice reference |
| T2: waits for a person | `create_order` (To Confirm) | yes: deleted before confirm (11 of 21 were) | staff, who must find and clear it |
| T3: live edit, crew possibly told (Q3) | `add_shift`, `add_position`, `set_position_times`, `set_position_size` (increase, or a cut that stays at or above the workers) | it can be undone, but any notice already sent cannot | crew on the position, and the client's event |
| T4: drops workers | `cancel_position` on a staffed position, a cut below the workers | no | crew and the event. **Refused as built**; the tier exists so it can never be enabled silently |

Within every tier the rule is recall first: when in doubt, it goes to the TV, flagged, and is never dropped.

**Metric replacements.**
- Retire 227/114 (harness `e2e`) as a baseline. Keep it as a $0 plumbing gate (`test/harnessGate.ts`).
- Replace it with the §4 / A.3 metrics on the §5 eval set, from production's stored decisions.
- `ops-truth` and `week-review` stay as evidence for the labellers, never as labels: they skip company-null emails and attribute by timing.
- Quote exact intervals with every figure. At n = 84 the interval is about ±5 points.

**reason_code distribution (§9.9), the live week's 99 flagged items.** This is the deterministic layer's backlog.
- **64 listed handoffs:**
  - reading_unproven 34
  - policy_lead_days 9
  - request_unsupported 6
  - client_unknown 6
  - booking_link_unreadable 3
  - system_failed 2
  - request_inconsistent 2
  - venue_not_identified 1
  - other 1
- **17 writes that did not run:**
  - blocked on signed-on crew 11 (that rule was removed 10-15)
  - crew-chief stop 3
  - cut or cancel below the workers 3
- **18 needs-reply:**
  - reply_detail_missing 12
  - reply_unclear 4
  - reply_quote 2

Snapshot-wide over 847 decisions: `audit/glossary.md:148-163`. Script: `eval/reads/scripts/codes.mts`, which applies `coded()` (reasons.ts:59).

## 7. §17 questions, with evidence

- **Q1, in OnSinch's terms: may the bot's new orders skip To Confirm, and should the TV tick do anything in OnSinch?** §3 asks whether an order must be confirmed before it becomes a job. In OnSinch, a Job exists from the moment its order is created (3,435 of 3,500 orders have exactly one). "Booked" is the provisional flag clearing on the same order (`order_confirm_provisional`). So the real question is whether To Confirm stays a human gate for the bot's creates.
  - As built, yes for creates (`request_approval: true`, `apiCreate.ts:92`). Edits have no confirm.
  - The earlier rulings conflict: 08-18 "To Confirm is a human gate", 09-13 "no step may require a human", 09-29 "no orders awaiting a confirm click".
  - **The owner's latest words settle creates.** 10-13: "every new order in To Confirm" (B30(1)). 10-16: "A orders to confirm, if its a new order. if it is an update, it gets added to its later stage" (`C-items-1016.md:51-52`). So new orders wait in To Confirm and updates are written live, which is what the code does.
  - In practice 1 of 21 bot creates was confirmed and 11 were deleted.
  - Left for the owner: is 10-16 still the rule, now that 1 of 21 bot creates was confirmed? And should the TV tick confirm the To Confirm order, given that today it writes nothing (`feed/check.ts:1-6`)?
- **Q2: what are metrics A and B?** One harness metric (`e2e`) on two generated sets, on a broken fake world. They are 304/154 at HEAD. They are not real mail and not a baseline (`eval/metrics.md`).
- **Q3: which actions are reversible?** See §6.
  - Open: does an edit notify crew? Does a new open position go out to crew at once? Does a time change re-notify confirmed workers?
  - Only the code comment `run.ts:11-14` says "OnSinch tells them". The owner's 10-15 words ask for every change to be made and for dropped crew to be logged (`C-items-1016.md:57-60`), but say nothing about notices.
  - The snapshot's 8 audit actions include no notification rows, so this cannot be measured offline. The owner or Paz knows it from OnSinch.
- **Q4: what display_precision floor?** The owner's call. It is not yet measured; see §5.
- **Q5: are outbound mail and headers retained?**
  - Outbound is kept: 3,775 rows in 994 of 1,279 threads. Whether any row is an unsent draft is blocked offline.
  - RFC headers are stored since 10-23: Message-ID 159 of 169, so 10 were not captured; In-Reply-To 138; References 141.
  - No decision code reads them, and they name no company.
  - 4.9% of our subjects carry an R or J number.
- **Q6: which usage limit was hit?**
  - OpenRouter ran out of credit (HTTP 402) on 10-11 (`process.ts:431`). It was the account balance, not a rate.
  - Current volume: 3 to 103 decisions a day carry a model call (`interpretation.meta`).
  - Cost: $0.031-0.033 each on Opus 4.8 (10-14, 10-15) and $0.005-0.010 on gpt-6.1-sol since 10-16. That is $0.02-3.42 a day.
- **New: what do OPERATING §2's unfilled placeholders refer to?** All candidates have now been read (`audit/plans-read.md`), including the three Claude Docs.
  - "The owner's audit" is best fitted by the 10-03 Spartan Audit.
  - "The previous 99% plan" is best fitted by the harness plan: its 99% was reported met, and its own set later read 227/500.
  - No document names a known-good version.
  - Two 10-03 owner rulings need a yes or no: an AI step on every dedup, and several orders per enquiry. v2 plans one order per change.
- **New: does "client" count as the second fact beside the day (`evidence.ts:2-3`)?** It decides 426 of the generated labels, and how strict "never the day alone" is on real mail.
- **Glossary (§3) against code and data** (`audit/glossary.md` §1). These four would change how a §3 sentence is read:
  - **Order** is the booking at every stage, not a draft stage. Draft is a flag on the same record (`provisional`, `quote`, `request_approval`).
  - **Job** is a child of the order, created with it, not a later stage (above).
  - **Opportunity** means orders only. Cancelled orders are outside the candidate set (`plan.ts:235, :454, :728`), but §9.4 asks for all statuses.
  - **Senders who act for several clients are not served.** The resolver works by domain and abstains when a domain or address belongs to more than one company (`resolve.ts:92, :122`), and the result is a handoff with no client. That covers 25 of 749 business domains; §9.3 asks for resolution by content.

  Client, Sender (one client with many senders), Change and Display match. Inquiry and Item match in spirit, but no step outputs "not an inquiry", and no item waits in a confirm-ready state.
- **Settled 10-25: `intake_paused` is false, and the Intake Watchdog is on.** See §4.
- **New: who labels the eval set, and who settles disagreements?** See §5.

## Red team A: hits and responses

I re-ran 6 of its hits (H1, H2, H3, H4, H6, N1) from code and data. All 6 hold.

| hit | severity | response |
|---|---|---|
| H1: the move's gain needs writes on, but writes stay off | decision | **accepted.** The move is withdrawn (§5) |
| H2: listing creates and questions reverses the owner's 10-13 rule | decision | **accepted.** My "not an owner ruling" was wrong for creates. For questions, the owner's words cover orders and updates the system cannot make, and the code applies them by hiding needs-reply cards. The clearing rule in §5 item 2 is proposed as an owner decision, not a leak fix |
| H3: the 4 strict silent misses reached staff; our mailbox answered all 18 questions (median 0.2 h) | decision | **accepted.** "Reached nobody" is withdrawn. They had no TV item, but staff caught all 4 from the inbox within an hour |
| H4: labels went live 10-16, and all 6 later creates were rebuilt | decision | **accepted.** Visibility is not shown to be the cause of rebuilds |
| H5: the silent-miss count cannot see a request nobody acted on | decision | **accepted.** This is now the reason for the highest-leverage move (§5) |
| H6: `intake_paused=true` blinds the alarm and misinforms staff | decision | **accepted.** Flipped on the owner's word on 10-25, the watchdog was restored, and §4 adds a Gmail-side count |
| N1: durable completions 3/84; new bookings 0 | number | **accepted** (R11562 is absent from the snapshot) |
| N2: 9 equal by day, times and crew, 7 with trades | number | **accepted** |
| N3: 6 of 31 label_wrong rows have a staff act on a day the email names | number | **accepted.** The strict count rests on one reader, and the eval set settles it |
| N4: live-week figures are one agent's relabelling | number | **accepted.** They are evidence for the eval set, not measurements |
| N5: client resolution 85.9% / 82.2% in production, 89.1% is a replay; 2 wrong companies | number | **accepted** |
| N6: at most 15 of 23 are parser-side | number | **accepted** |
| N7: 1 of 7 company-null resolves at HEAD; headers name no company | number | **accepted** |
| N8: the wide residual was inconsistent | number | moot, because the move is withdrawn |
| N9: ops-truth skips company-null emails | number | **accepted.** ops-truth is evidence only (§6) |
| N10: an ambiguous `none` is counted as recalled | number | **accepted.** 79/84 = 94.0% is shown beside 95.2% |
| N11: "correct none on all 31" is true by construction | wording | **accepted.** Removed from what to keep |
| N12: tiers stated notification as fact; T4 is refused as built | wording | **accepted.** §6 rewritten |
| N13: Q6 figures did not match the live-state file | wording | **accepted.** They are corrected |
| N14: 53% is a projection; 10 of 169 headers not captured; "never clear" ignores deletes | wording | **accepted.** Wording is corrected |
