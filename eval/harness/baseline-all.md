# Baseline on all 799 read emails, dev set

- Agent: harness-engineer (follow-up under brief bd19ffb1).
- Written: 2026-10-25T22:55Z (UTC, the machine's clock).
- Code: 569ed2757ace+dirty (branch v2).
- Dataset 9b809529e0917927. Labels `labels/all.jsonl` 55e6f3e99cfd95d5. Split `labels/split-all.json`, test hash d2790450e2c9ae4f. Harness real-1.
- Reproduce (each $0, about 12 s):
  - `npx tsx harness/real/run.ts --mode score-production`
  - `npx tsx harness/real/run.ts --mode replay`
  - `--labels all` and `--set dev` are the defaults.

## Summary

**The set.**
- 799 emails:
  - the live week's 400;
  - the second batch's 399: every other decided client email in the snapshot, sent from 10-01 and decided on the TV-era build (eval/reads/scripts/build2.mts).
- Two blind readers read each email.
- The 14 emails the readers split on are settled by majority with the third reader (eval/reads/settled.csv). For each, the winning reader's labels stand. No row is disputed, and none is provisional.
- **Split.** Dev 561, test 238.
  - Threads are kept whole: 0 threads straddle the sets.
  - Dev's first email is from 10-01. Test threads start from 10-15.
  - The test hash is pinned in test/harnessReal.ts and in the split file.
  - Test figures are not reported here.

**The live-week baseline is untouched.**
- `--labels live-week` still reads labels/live-week.jsonl (16622f2f47f6267b) and split.json (8aaf7ecd8b29ba86).
- It reproduces 48 of 48 figures of eval/live-week-reads.md.
- Its replay still gives 20 of 105.

**Dev headline (561 emails, 184 B42 inquiries):**

| | silent_miss_count | inquiry_recall | display_precision (any request) | review_rate |
|---|---|---|---|---|
| production (stored decisions) | **64** | 120/184 = 65.2% (CI 57.9-72.1) | 133/142 = 93.7% (CI 88.3-97.1) | 126/142 = 88.7% |
| replay (HEAD on the stored readings) | **53** | 131/184 = 71.2% (CI 64.1-77.6) | 146/152 = 96.1% (CI 91.6-98.5) | 125/152 = 82.2% |

- Booking work only (152 inquiries): production 104/152 = 68.4%, replay 105/152 = 69.1%.
- Replay made 0 model calls and 0 network requests. Its outcome matches production's on 476 of 561 emails.

**Why HEAD is ahead on dev.**
- 36 B42 inquiries changed between silent and shown: 24 became items and 12 became silent.
- 16 of the 24 were a reply under production (reply_quote 8, reply_detail_missing 8). Where production asked the client, HEAD lists a policy_lead_days card.
- The 11-point gap is about the width of the interval, so it is suggestive, not proven.
- 4 of replay's 53 silent misses are "already booked" answers that the time-correct world bears out: 1a120963d312ee58, 1a125bc994d79806, 1a13a97ff7a30369 and 1a13ad05c65d0447. They stay in the score. A reader must settle them.

**New rule: an email intake read with a later email.**
- 25 of the 799 emails (15 in dev) were never decided on their own. Intake read each one with a later email on its thread (process.ts:204-224).
- Replay does not decide these alone either. It folds their text into the later email, as processMessage does.
- Such an email counts as reached when the later email's card is an item: 3 in production and 2 in replay, on dev.
- The live week has no such email, so its figures do not move.

**Limits of the time-correct world on dev.** 546 emails were replayed (the 15 read-together emails were not).

| limit | emails affected | total |
|---|---|---|
| Parts deleted after the email (content gone) | 209 | 717 |
| Order cancelled after the email (status inferred) | 50 | 72 |
| Changed after the audit copy ends | 7 | 7 |
| Modified after the email with no audit row (upper bound) | 385 | 1,277 |
| Bot orders rebuilt from the bot's op | 28 | 114 |
| Client history may predate the snapshot | 278 | - |
| Thread link whose state then is unknown | 1 | 1 |
| Reading names an order the rebuilt context lacks | 5 | 11 picks |
| Reading made over 1 h after the email | 39 | 39 |
| Client email with no stored reading | 14 | 14 |
| Client differs from production | 23 | 23 |
| Write names a place newer than any in use then | 0 | 0 |
| Thread message stored after production decided | 0 | 0 |

- **Client email with no stored reading (14).**
  - Production handed all 14 off under the pre-10-11 intake rule, "arrived with a later client message", so no reading was ever made.
  - Replay cannot read them. HEAD's failed read becomes a listed card, as production's handoff was, so both modes score these 14 alike.
- **Readings made over 1 h late (39).** Most are second-batch emails sent between 10-01 and 10-09 and decided once the TV-era build started. Their stored readings saw the OnSinch of decision time.
- **Not rebuilt at all:**
  - orders that existed at an email's time but are not in the copy: 9-65 staff-made orders per email, and 1,693-1,842 made through the API with no delete row;
  - companies and contacts, places and professions, which carry no timestamps;
  - Settings' lead days.

**Not measurable from these labels:** item_correctness, action_accuracy, client_resolution_accuracy, recall@5 and selection_given_correct_candidate. No reader recorded the order or the client.

**Unchanged finding:** HEAD gives 6 decisions an uncoded reason ("nothing new asked for: the requests are the thread's earlier ones"), so they are tallied as "other".

---

## Both modes on dev (generated by run.ts, verbatim)

### score-production (labels all, 799 emails), dev set

git 569ed2757ace+dirty · dataset 9b809529e0917927 · labels 55e6f3e99cfd95d5 · test-set hash d2790450e2c9ae4f
Latency is email sent -> decision recorded (decisions.json created_at - sent_at).

Emails 561 (provisional 0). Outcomes: none 372, needs-reply 47, listed 126, check 16. Items shown 142.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **64** |
| inquiry_recall (B42) | 120/184 = 65.2% (CI 57.9-72.1) |
| inquiry_recall, booking work only | 104/152 = 68.4% (CI 60.4-75.7); silent 48 |
| inquiry_recall, every quote counted | 124/191 = 64.9% (CI 57.7-71.7); silent 67 |
| inquiry_recall, splits resolved by reader-V | 104/152 = 68.4% (CI 60.4-75.7); silent 48 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 126/142 = 88.7% (CI 82.3-93.4) |
| display_precision (any request, both readers) | 133/142 = 93.7% (CI 88.3-97.1) |
| display_precision (B42 inquiry) | 117/142 = 82.4% (CI 75.1-88.3) |
| client_resolution_accuracy | not measurable from these labels: no reader recorded the client |
| recall@5 | not measurable from these labels: the system stores no candidate list (plan.ts:41-50), and no label names the true order |
| selection_given_correct_candidate | not measurable from these labels: as recall@5 |
| none_precision (items proposing a new order, NONE label) | 53/69 = 76.8% (CI 65.1-86.1) |
| none_recall (NONE labels whose item proposes a new order) | 53/112 = 47.3% (CI 37.8-57.0) |
| action_accuracy | not measurable from these labels: needs the correct order first |
| suppression_count by rule | read with a later email (process.ts:216) 15; sender rule (process.ts:161) 14 |
| read with a later email whose card is an item (reached, not silent) | 3 |
| none by reading or planner (not a rule) | none_nothing_to_do 320; none_already_booked 11; other 9; none_already_as_asked 3 |
| cost per email | not measurable: the gold copy stores no model cost (readings carry no meta) |
| latency p50 / p95 (n 561) | 1.1 min / 1743.7 min |

Silent misses (B42): 1a11b53c08a601e4, 1a11bd05142050d8, 1a11bdb9afb11330, 1a11c0d97069083c, 1a11c1dba37edfea, 1a1203afd588ac01, 1a1205122d560ceb, 1a1206a46fbabd4b, 1a12076a1cca653d, 1a12082de9302ad6, 1a1208931db0f772, 1a120963d312ee58, 1a120c3891f966d3, 1a120ded2d38f196, 1a120e1aaf77f8fb, 1a120fe72b5982ac, 1a1211fbe4a3dc72, 1a1212954c0b4e15, 1a1212b34df3542d, 1a1213583238c22f, 1a121423eac99289, 1a1215576c68f3e2, 1a1215769dd333fd, 1a1217605fa76233, 1a1217a58683c4a6, 1a1218126b1d210b, 1a1230b2ceeda6bb, 1a125bc994d79806, 1a12c17f9c71e222, 1a12f13c7c4602d5, 1a12f50cc50cbb33, 1a12f6887ed713a4, 1a12f73cd20dfb4e, 1a12fba6cf817941, 1a12fd770bf6ce9a, 1a12fd92dc5f880e, 1a1303be1b2344bb, 1a13066d1a39485c, 1a1307f87ab752b3, 1a1308567c26e478, 1a130b076cfc037b, 1a130c9740330432, 1a13438a3dd67400, 1a1344a080edb10d, 1a134a4324d240f6, 1a1353d267620c42, 1a13560df44be6f6, 1a1357bc83414e00, 1a1399db710f7409, 1a139f0f10a9d1c9, 1a139f824146018a, 1a13a5149fcd9455, 1a13aaf92b3b564e, 1a13f8312ae75c73, 1a13fc34f09bf745, 1a13fd80597e6e43, 1a13fd94ac637812, 1a140632ce4d5e99, 1a1493bc7c314c28, 1a153bcb54f7f266, 1a1540528d5a2d27, 1a158c5ac15f6fdc, 1a163b198663b88e, 1a16405018e55dc8

**reason_code by outcome**

- none: none_nothing_to_do 320, none_read_together 15, none_not_client 14, none_already_booked 11, other 9, none_already_as_asked 3
- listed: reading_unproven 46, write 25, other 15, client_unknown 11, request_unsupported 10, venue_not_identified 6, booking_not_identified 5, booking_link_unreadable 4, partly_booked 1, reply_detail_missing 1, request_inconsistent 1, system_failed 1
- needs-reply: reply_detail_missing 21, reply_quote 14, reply_unclear 12
- check: write 16

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 219 | 209 | 1 | 9 | 0 | 210 |
| other request (PO, question) or readers split on it | 127 | 105 | 10 | 10 | 2 | 115 |
| booking work: new booking | 80 | 22 | 10 | 37 | 11 | 32 |
| booking work: change or cancel | 72 | 8 | 11 | 53 | 0 | 19 |
| quote with day and crew (B42 inquiry) | 32 | 4 | 12 | 13 | 3 | 16 |
| booking work: already done when decided (excluded) | 19 | 19 | 0 | 0 | 0 | 19 |
| quote without shifts | 7 | 0 | 3 | 4 | 0 | 3 |
| booking work: OnSinch portal notice (excluded) | 5 | 5 | 0 | 0 | 0 | 5 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| label_wrong | 19 | 16 | 0 | 2 | 1 | 16 |
| parse_failure | 15 | 0 | 0 | 15 | 0 | 0 |
| pipeline_break | 14 | 0 | 0 | 7 | 7 | 0 |
| wrong_action | 8 | 0 | 2 | 6 | 0 | 2 |
| wrong_client | 6 | 0 | 0 | 6 | 0 | 0 |
| genuinely_ambiguous | 3 | 1 | 0 | 1 | 1 | 1 |
| not_recognized_as_inquiry | 1 | 1 | 0 | 0 | 0 | 1 |
| wrong_ranking | 1 | 0 | 0 | 0 | 1 | 0 |
| candidate_not_retrieved | 1 | 0 | 0 | 1 | 0 | 0 |


---

### replay (labels all, 799 emails), dev set

git 569ed2757ace+dirty · dataset 9b809529e0917927 · labels 55e6f3e99cfd95d5 · test-set hash d2790450e2c9ae4f
Runs 568 (7 earlier thread emails replayed unscored first, for the thread's prior requests) in 11.1 s. Network requests attempted: 0. Model calls: 0.
Preflight: ok no production credentials loaded: none of 13 present; ok network closed except the model provider: no host allowed (replay); ok the world is the time-correct fake: TimeWorld.
Same TV outcome as production on 476 of 561. Latency is in-process time per email.

Emails 561 (provisional 0). Outcomes: none 380, needs-reply 29, listed 125, check 27. Items shown 152.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **53** |
| inquiry_recall (B42) | 131/184 = 71.2% (CI 64.1-77.6) |
| inquiry_recall, booking work only | 105/152 = 69.1% (CI 61.1-76.3); silent 47 |
| inquiry_recall, every quote counted | 134/191 = 70.2% (CI 63.1-76.5); silent 57 |
| inquiry_recall, splits resolved by reader-V | 105/152 = 69.1% (CI 61.1-76.3); silent 47 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 125/152 = 82.2% (CI 75.2-88.0) |
| display_precision (any request, both readers) | 146/152 = 96.1% (CI 91.6-98.5) |
| display_precision (B42 inquiry) | 129/152 = 84.9% (CI 78.2-90.2) |
| client_resolution_accuracy | not measurable from these labels: no reader recorded the client |
| recall@5 | not measurable from these labels: the system stores no candidate list (plan.ts:41-50), and no label names the true order |
| selection_given_correct_candidate | not measurable from these labels: as recall@5 |
| none_precision (items proposing a new order, NONE label) | 70/88 = 79.5% (CI 69.6-87.4) |
| none_recall (NONE labels whose item proposes a new order) | 70/112 = 62.5% (CI 52.9-71.5) |
| action_accuracy | not measurable from these labels: needs the correct order first |
| suppression_count by rule | read with a later email (process.ts:216) 15; sender rule (process.ts:161) 14 |
| read with a later email whose card is an item (reached, not silent) | 2 |
| none by reading or planner (not a rule) | none_nothing_to_do 319; other 15; none_already_booked 12; none_already_as_asked 3; booking_not_identified 2 |
| cost per email | $0: 0 model calls; every reading is the stored one |
| latency p50 / p95 (n 561) | 11 ms / 46 ms |

Silent misses (B42): 1a0fc5e980577c5b, 1a11b53c08a601e4, 1a11bd05142050d8, 1a11bdb9afb11330, 1a11c0d97069083c, 1a11c1dba37edfea, 1a11fde9b93f8ab4, 1a1203afd588ac01, 1a1208931db0f772, 1a1208e4dea660a8, 1a12093913c81661, 1a120963d312ee58, 1a120aa0fa68ea64, 1a120e1aaf77f8fb, 1a120fe72b5982ac, 1a1211fbe4a3dc72, 1a1212b34df3542d, 1a1215576c68f3e2, 1a1217605fa76233, 1a1230b2ceeda6bb, 1a125bc994d79806, 1a129ce2f3e401a2, 1a12b778ce6be39a, 1a12f13c7c4602d5, 1a12f50cc50cbb33, 1a12f6887ed713a4, 1a12fba6cf817941, 1a1303be1b2344bb, 1a1307f87ab752b3, 1a1308567c26e478, 1a130b076cfc037b, 1a130c9740330432, 1a134d4601dc07f2, 1a134d846cab863b, 1a1350a4379bc802, 1a1353d267620c42, 1a1357bc83414e00, 1a1399db710f7409, 1a139f0f10a9d1c9, 1a13a5149fcd9455, 1a13a97ff7a30369, 1a13aa2b6fca0312, 1a13aaf92b3b564e, 1a13ad05c65d0447, 1a13fc34f09bf745, 1a13fd80597e6e43, 1a13fd94ac637812, 1a1493bc7c314c28, 1a153bcb54f7f266, 1a1540528d5a2d27, 1a158c5ac15f6fdc, 1a163b198663b88e, 1a16405018e55dc8

**reason_code by outcome**

- none: none_nothing_to_do 319, none_read_together 15, other 15, none_not_client 14, none_already_booked 12, none_already_as_asked 3, booking_not_identified 2
- listed: policy_lead_days 52, booking_not_identified 18, reading_unproven 18, system_failed 14, client_unknown 6, policy_confirmed_proposal 4, booking_not_found 3, reply_detail_missing 3, request_unsupported 3, policy_past_day 2, booking_link_unreadable 1, request_inconsistent 1
- check: write 27
- needs-reply: reply_detail_missing 13, reply_unclear 11, request_unsupported 3, reply_quote 2

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 219 | 212 | 1 | 6 | 0 | 213 |
| other request (PO, question) or readers split on it | 127 | 108 | 10 | 7 | 2 | 118 |
| booking work: new booking | 80 | 25 | 3 | 49 | 3 | 28 |
| booking work: change or cancel | 72 | 12 | 9 | 34 | 17 | 21 |
| quote with day and crew (B42 inquiry) | 32 | 4 | 2 | 22 | 4 | 6 |
| booking work: already done when decided (excluded) | 19 | 14 | 0 | 5 | 0 | 14 |
| quote without shifts | 7 | 0 | 4 | 2 | 1 | 4 |
| booking work: OnSinch portal notice (excluded) | 5 | 5 | 0 | 0 | 0 | 5 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| label_wrong | 19 | 17 | 0 | 1 | 1 | 17 |
| parse_failure | 15 | 1 | 0 | 11 | 3 | 1 |
| pipeline_break | 14 | 0 | 0 | 11 | 3 | 0 |
| wrong_action | 8 | 0 | 0 | 4 | 4 | 0 |
| wrong_client | 6 | 1 | 0 | 5 | 0 | 1 |
| genuinely_ambiguous | 3 | 1 | 0 | 2 | 0 | 1 |
| not_recognized_as_inquiry | 1 | 1 | 0 | 0 | 0 | 1 |
| wrong_ranking | 1 | 0 | 0 | 1 | 0 | 0 |
| candidate_not_retrieved | 1 | 0 | 0 | 1 | 0 | 0 |


**B42 inquiries whose silent status differs from production**

| message_id | production | replay | world limits on this email |
|---|---|---|---|
| 1a11fde9b93f8ab4 | listed / reading_unproven | needs-reply / reply_detail_missing | parts_deleted_after 1, reading_made_late true |
| 1a1205122d560ceb | needs-reply / reply_quote | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a1206a46fbabd4b | needs-reply / reply_quote | listed / policy_lead_days | none |
| 1a12076a1cca653d | needs-reply / reply_quote | listed / policy_lead_days | modified_without_audit_row 2 |
| 1a12082de9302ad6 | needs-reply / reply_quote | listed / booking_not_identified | parts_deleted_after 4, modified_without_audit_row 1 |
| 1a1208e4dea660a8 | listed / reading_unproven | needs-reply / request_unsupported | parts_deleted_after 4 |
| 1a12093913c81661 | listed / write | none / none_already_as_asked | parts_deleted_after 3, modified_without_audit_row 9 |
| 1a120aa0fa68ea64 | listed / request_unsupported | needs-reply / request_unsupported | modified_without_audit_row 5 |
| 1a120c3891f966d3 | needs-reply / reply_detail_missing | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a120ded2d38f196 | needs-reply / reply_detail_missing | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a1212954c0b4e15 | needs-reply / reply_quote | listed / client_unknown | none |
| 1a1213583238c22f | needs-reply / reply_quote | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a121423eac99289 | needs-reply / reply_quote | check / write | parts_deleted_after 4, modified_without_audit_row 3 |
| 1a1215769dd333fd | needs-reply / reply_quote | listed / policy_lead_days | modified_without_audit_row 4 |
| 1a1217a58683c4a6 | none / none_nothing_to_do | check / write | modified_without_audit_row 6 |
| 1a1218126b1d210b | needs-reply / reply_detail_missing | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a129ce2f3e401a2 | listed / request_unsupported | needs-reply / reply_detail_missing | none |
| 1a12b778ce6be39a | listed / client_unknown | none / other | status_inferred 1 |
| 1a12c17f9c71e222 | needs-reply / reply_detail_missing | check / write | modified_without_audit_row 2 |
| 1a12f73cd20dfb4e | needs-reply / reply_quote | listed / policy_lead_days | modified_without_audit_row 5 |
| 1a12fd770bf6ce9a | needs-reply / reply_quote | listed / policy_lead_days | none |
| 1a12fd92dc5f880e | needs-reply / reply_quote | listed / policy_lead_days | parts_deleted_after 4, status_inferred 1, modified_without_audit_row 2 |
| 1a13066d1a39485c | needs-reply / reply_detail_missing | listed / policy_lead_days | none |
| 1a13438a3dd67400 | needs-reply / reply_quote | check / write | none |
| 1a1344a080edb10d | needs-reply / reply_detail_missing | listed / policy_lead_days | none |
| 1a134a4324d240f6 | needs-reply / reply_detail_missing | listed / policy_lead_days | parts_deleted_after 1, modified_without_audit_row 8 |
| 1a134d4601dc07f2 | listed / reading_unproven | needs-reply / reply_detail_missing | modified_without_audit_row 1 |
| 1a134d846cab863b | listed / client_unknown | none / none_already_as_asked | parts_deleted_after 8, modified_without_audit_row 2 |
| 1a1350a4379bc802 | check / write | none / booking_not_identified | modified_without_audit_row 1 |
| 1a13560df44be6f6 | needs-reply / reply_detail_missing | listed / reply_detail_missing | parts_deleted_after 2, modified_without_audit_row 4 |
| 1a139f824146018a | needs-reply / reply_detail_missing | listed / policy_lead_days | parts_deleted_after 4, status_inferred 2, modified_without_audit_row 2 |
| 1a13a97ff7a30369 | listed / reading_unproven | none / none_already_booked (the R named has a live shift on an asked day then) | modified_without_audit_row 1 |
| 1a13aa2b6fca0312 | listed / reading_unproven | none / other | parts_deleted_after 2, modified_without_audit_row 4 |
| 1a13ad05c65d0447 | listed / client_unknown | none / none_already_booked (the R named has a live shift on an asked day then) | none |
| 1a13f8312ae75c73 | needs-reply / reply_detail_missing | listed / reading_unproven | parts_deleted_after 3, modified_without_audit_row 3 |
| 1a140632ce4d5e99 | needs-reply / reply_detail_missing | listed / policy_lead_days | modified_without_audit_row 1 |

Of the 53 silent misses, 4 are "already booked" answers that the time-correct world bears out (1a120963d312ee58, 1a125bc994d79806, 1a13a97ff7a30369, 1a13ad05c65d0447): the labels count them as misses because the "already done" exclusions were frozen from production's own claims. They stay in the score; a reader must settle them.

HEAD gives 6 decisions a reason reasons.ts does not code ("nothing new asked for: the requests are the thread's earlier ones"), so they are tallied as "other".

**Limits of the time-correct world on this set**

| limit | emails affected | total | what it means |
|---|---|---|---|
| parts deleted after the email | 209 of 546 | 717 | audit delete rows on an order the email's world read; the part existed then and its content is gone |
| order cancelled after the email | 50 of 546 | 72 | status set back from -1 to 0; the audit row has no old status |
| changed after the audit copy ends | 7 of 546 | 7 | a part modified after 22:51Z 10-22, which no audit row covers |
| modified after the email, no audit row | 385 of 546 | 1277 | an upper bound on unlogged changes: 8 audit actions were fetched, and a venue change is none of them |
| bot orders rebuilt from the bot's own op | 28 of 546 | 114 | orders the bot created, absent from the snapshot, rebuilt as the bot sent them; staff edits to them are lost |
| client history may predate the snapshot | 278 of 546 | 278 | the client has an order in the snapshot's first 30 days (it holds the newest 3,500 orders, from 2025-07-14) |
| thread link with unknown state then | 1 of 546 | 1 | a job_links row seen before the email and now gone or held |
| thread message stored after production decided | 0 of 546 | 0 | sent before the email, so in replay's thread, but not stored when production read it |
| reading picks an order the world does not offer | 5 of 546 | 11 | the stored reading named an R number absent from the rebuilt context |
| reading made over 1 h after the email | 39 of 546 | 39 | the stored reading may have seen a later OnSinch |
| client email with no stored reading | 14 of 546 | 14 | replay cannot read it: the failed read becomes a card for a person (process.ts:436-440) |
| client differs from production's | 23 of 546 | 23 | contacts are as of the snapshot: a contact added after the email would resolve a client production could not |
| write names a place newer than any in use then | 0 of 546 | 0 | places carry no date; a place id above every one in use when the email arrived may postdate it |

Orders absent from the snapshot that existed at an email's time and cannot be rebuilt (any client): staff-made 9-65 per email; made through the API with no delete row (the bot or test runs; when each vanished is unknown) 1693-1842 per email.
Not rolled back at all (no timestamps in the copy): companies and their contacts (811), places (2,614), professions (45). Settings' create_lead_days is not in the copy: the planner's default applies.
