# Baseline on the live week's real mail, and its reproduction

- Agent: harness-engineer. Brief hash: bd19ffb1.
- Written: 2026-10-25T22:39Z (UTC, the machine's clock).
- Code: 569ed2757ace+dirty (branch v2). The uncommitted changes were in audit/, decisions/, eval/live-week-reads.md, eval/reads/scripts/b42.mts and the harness files themselves.
- Dataset 9b809529e0917927. Labels 16622f2f47f6267b. Test-set hash 8aaf7ecd8b29ba86. Harness real-1.
- Reproduce: `npx tsx harness/real/run.ts --labels live-week --mode score-production --set all --checkpoint`, then the same with `--mode replay`. Both cost $0 and run in about 12 s together. (Without `--labels live-week` the harness scores all 799; see baseline-all.md.) The gate test is `npx tsx test/harnessReal.ts` (18 checks, about 6 s).

## Summary

**The baseline is reproduced.**
- score-production recomputes every figure of eval/live-week-reads.md from the label file and decisions.json. **48 of 48 figures match exactly** (table below).
- One sentence of the document does not match its own labels.
  - Line 21 says reader-V's two differences are "a PO-only versus a change, and a quote versus a booking".
  - For 1a13a408e18d3802 the pair read a new booking, not a change: A read `new_booking`, B read `new_booking+po_only`, V read `po_only`.
  - The count (2) is right. The harness shows this mismatch and does not gate on it.
- The outcome code is production's own TV code (`v2Source`). It agrees with the reads scorer's copy on 400 of 400 emails.

**Production's baseline (stored decisions):**

| set | silent_miss_count (B42) | inquiry_recall (B42) |
|---|---|---|
| all 400 | **18** of 105 | 87/105 = 82.9% (CI 74.3-89.5) |
| dev 280 | **16** of 79 | 63/79 = 79.7% (CI 69.2-88.0) |

**HEAD's baseline (replay):** the stored readings through the current planner, on the time-correct world.

| set | silent_miss_count (B42) | inquiry_recall (B42) |
|---|---|---|
| all 400 | **20** of 105 | 85/105 = 81.0% (CI 72.1-88.0) |
| dev 280 | **16** of 79 | 63/79 = 79.7% (CI 69.2-88.0) |

- Replay made 0 model calls and 0 network requests.
- Its TV outcome matches production's on 362 of 400 emails.
- The difference from production is inside the interval (about ±8 points), so it is not evidence either way.
- 8 inquiries changed between silent and shown: 5 became silent and 3 became items (table below).
- 3 of replay's 20 silent misses are "already booked" answers that the time-correct world bears out: 1a13a97ff7a30369, 1a13ad05c65d0447 and 1a158ba2b8c735d6. The labels count them as misses because the 20 exclusions were frozen from production's own claims. A reader must settle them.

**The test set is locked.**
- dev 280, test 118. 2 provisional rows on test threads are kept out of both sets.
- Threads stay whole, and every test thread starts after every dev thread starts.
- Test hash 8aaf7ecd8b29ba86.
- Test figures are not reported here. They are for checkpoints only.

**Not measurable from these labels:** item_correctness, action_accuracy, client_resolution_accuracy, recall@5 and selection_given_correct_candidate. No reader recorded the order or the client an email is about. That is the label gap to close before item_correctness, the second primary target, can be scored.

**Found on the way:**
- HEAD gives 6 decisions a reason that reasons.ts does not code: "nothing new asked for: the requests are the thread's earlier ones". They are tallied as "other".
- 14 of the 15 emails where replay names a different client than production are matched only by the sender rules added on 10-21 and 10-22 (exact address; bare invoice domain). The domain rule production ran names none of them, even on today's contacts.

**Every limit of the time-correct world, with counts (all 400; detail below):**

| limit | emails affected | total |
|---|---|---|
| Parts deleted after the email (content gone) | 119 | 297 audit rows |
| Order cancelled after the email (status inferred) | 40 | 67 orders |
| Part changed after the audit copy ends | 4 | 4 orders |
| Modified after the email with no audit row (upper bound on unlogged changes) | 224 | 740 orders |
| Bot orders rebuilt from the bot's own op | 38 | 168 order-reads |
| Client history may predate the snapshot window | 187 | - |
| Thread link whose state then is unknown | 3 | 3 |
| Stored reading names an order the rebuilt context lacks | 9 | 16 picks |
| Reading made over 1 h after the email | 3 | 3 |
| Client differs from production | 15 | 15 |
| Write names a place newer than any in use then | 3 | 6 shifts |
| Thread message stored after production decided | 0 | 0 |
| Client email with no stored reading | 0 | 0 |

Not rolled back at all:
- Orders that existed at an email's time but are not in the copy cannot be rebuilt: 9-31 staff-made orders per email, and 1,711-1,842 orders made through the API with no delete row.
- Companies and contacts (811), places (2,614) and professions (45) carry no timestamps.
- Settings' lead days are not in the copy.

---

## Detail

### What the diagnosed limits turned out to be

- **Reading names an order the context lacks (9 emails).**
  - 5 name an order whose shifts were deleted after the email and replaced by new ones: 1a13a02e4c08a985, 1a14401e46254083, 1a1440b785a91a97, 1a14438a498394f0 and 1a144c450d555487. At the email's time, the rebuilt order has no shift left.
  - 4 name an R number that no snapshot and no audit row knows: 1a13a15d0ca3317b, 1a1537f6f674abca, 1a15424965812f5e and 1a154281bdb98ca3.
- **Client differs from production (15 emails).**
  - In 14, production named no client and today's sender rules name one. All 14 match only the rules added on 10-21 and 10-22. Contacts carry no date, so the copy cannot show whether each contact existed then.
  - In 1 (1a13f22ec18faae5), production named a client that today's contacts do not give.
- **Write names a newer place (3 emails):** 1a1541de84b036b8, 1a158632aed55e9a and 1a15984f57ab3251. In each, production wrote the same place id within a minute of the email, so the place existed then. This is not a leak.
- **Retried writes:** 1 decision in the copy was retried. It was blocked and names no order, so no thread link comes from a retry made after an email.

### B42 inquiries whose silent status differs between production and replay

| message_id | production | replay | world limits on this email |
|---|---|---|---|
| 1a139f824146018a | needs-reply / reply_detail_missing | listed / policy_lead_days | parts_deleted_after 4, status_inferred 2, modified_without_audit_row 2 |
| 1a13a97ff7a30369 | listed / reading_unproven | none / none_already_booked (the R named has a live shift on an asked day then) | modified_without_audit_row 1 |
| 1a13aa2b6fca0312 | listed / reading_unproven | none / other ("nothing new asked for") | parts_deleted_after 2, modified_without_audit_row 4 |
| 1a13ad05c65d0447 | listed / client_unknown | none / none_already_booked (the R named has a live shift on an asked day then) | none |
| 1a13f8312ae75c73 | needs-reply / reply_detail_missing | listed / reading_unproven | parts_deleted_after 3, modified_without_audit_row 3 |
| 1a140632ce4d5e99 | needs-reply / reply_detail_missing | listed / policy_lead_days | modified_without_audit_row 1 |
| 1a158ba2b8c735d6 | check / write | none / none_already_booked (the R named has a live shift on an asked day then) | parts_deleted_after 2 |
| 1a159fa99594e4e4 | check / write | needs-reply / reply_detail_missing | parts_deleted_after 1, status_inferred 1, modified_without_audit_row 3, absent_rebuilt 3 |

### Dev-set headlines (the set tuning reads)

- **score-production, dev:**
  - silent 16 of 79; inquiry_recall 63/79 = 79.7% (CI 69.2-88.0).
  - Booking work only: 56/70 = 80.0%.
  - review_rate 62/77 = 80.5%.
  - display_precision (any request) 70/77 = 90.9%.
- **replay, dev:**
  - silent 16 of 79; inquiry_recall 63/79 = 79.7% (CI 69.2-88.0).
  - Booking work only: 55/70 = 78.6%.
  - review_rate 60/77 = 77.9%.
  - display_precision (any request) 72/77 = 93.5%.
  - Same outcome as production on 244 of 280.

### Reproduction, then both modes' reports on all 400 (generated by run.ts, verbatim)

**Reproduction: 48 of 48 figures match eval/live-week-reads.md exactly.** Descriptions checked against the labels: 0 of 1 agree.

| doc line | figure | document | harness | match |
|---|---|---|---|---|
| 5 | client emails joined to messages.json, and they are the labelled 400 | 400 of 400 | 400 of 400 | yes |
| 12 | never read before (week-review: nothing to do + handed off) | 291 of 400 | 291 of 400 | yes |
| 14 | already read | 109 | 109 | yes |
| 17 | readers agree on booking work | 394 of 400 (98.5%, CI 96.8-99.4; kappa 0.97) | 394 of 400 (98.5%, CI 96.8-99.4; kappa 0.97) | yes |
| 18 | same days asked (booking work, portal notices out) | 109 of 110 | 109 of 110 | yes |
| 19 | same crew count where both stated one | 62 of 64 | 62 of 64 | yes |
| 20 | labels marked unsure | 170 of 800 | 170 of 800 | yes |
| 20 | adjudicate.csv: disagreements, V differences, other rows | 6, 2, 28 | 6, 2, 28 | yes |
| 21 | reader-V matches the pair where they agreed | 38 of 40 (95%, CI 83-99%) | 38 of 40 (95%, CI 83-99%) | yes |
| 21 | reader-V day sets matching | 10 of 10 | 10 of 10 | yes |
| 21 | reader-V's 2 differences: what V read vs what the pair read | po_only vs change; quote_or_availability vs booking | po_only vs booking; quote_or_availability vs booking | **no** (description) |
| 21 | on the pair's splits, reader-V sides with A / with B | 4 / 2 | 4 / 2 | yes |
| 25 | booking work, both readers | 136 | 136 | yes |
| 26 | portal notices among them; distinct senders | 26; 1 | 26; 1 | yes |
| 27 | already done when decided | 20 | 20 | yes |
| 27 | of these: confirmed in the snapshot / R in neither snapshot / not checked | 14 / 4 / 2 | 14 / 4 / 2 | yes |
| 28 | outstanding requests for booking work | 90 | 90 | yes |
| 29 | quote or availability only, both readers | 23 | 23 | yes |
| 31 | silent misses over all client mail; inquiry_recall | 16 of 90; 74/90 = 82.2% (CI 72.7-89.5) | 16 of 90; 74/90 = 82.2% (CI 72.7-89.5) | yes |
| 32 | silent misses decided none; of them, none_nothing_to_do | 8; 8 | 8; 8 | yes |
| 33 | of the 8 none, staff acted on the named day | 4: 1a13fd80597e6e43, 1a13fd94ac637812, 1a14105b82e3493e, 1a159376628160f2 | 4: 1a13fd80597e6e43, 1a13fd94ac637812, 1a14105b82e3493e, 1a159376628160f2 | yes |
| 34 | 1a13fd94ac637812: taxonomy bucket; both readers; staff acts on its day | label_wrong; booking work; yes | label_wrong; booking work; yes | yes |
| 35 | the other 4 of the 8: no staff act on a named day | 4 | 4 | yes |
| 36 | needs-reply silent misses; staff acted on the named day | 8; 4 | 8; 4 | yes |
| 36 | our first reply within 2 h; the one that waited | 7; 1a14638ee5140233 61 h | 7; 1a14638ee5140233 61 h | yes |
| 37 | staff-acted count 4/84 (cited from failure-taxonomy.md:10) | present | present | yes |
| 37 | every quote counted as an inquiry | 24 of 113 (78.8%, CI 70.1-85.9) | 24 of 113 (78.8%, CI 70.1-85.9) | yes |
| 38 | B42 adds inquiries / silent misses | 15 / 2 | 15 / 2 | yes |
| 38 | B42 working figure | 18 of 105, inquiry_recall 82.9% (CI 74.3-89.5) | 18 of 105, inquiry_recall 82.9% (CI 74.3-89.5) | yes |
| 41 | of the taxonomist's 4 strict silent misses: quote-only for both readers | 3 | 3 | yes |
| 42 | create_order writes; on quote requests | 19; 7 | 19; 7 | yes |
| 46 | items shown: listed + writes that ran | 104: 81 + 23 | 104: 81 + 23 | yes |
| 47 | items both readers call a request; booking work | 96 (92.3%, CI 85.4-96.6); 74 (71.2%) | 96 (92.3%, CI 85.4-96.6); 74 (71.2%) | yes |
| 48 | items both readers call nothing; all listed | 5 (4.8%); 5 | 5 (4.8%); 5 | yes |
| 48 | display_precision | ≈ 92% | ≈ 92% | yes |
| 50 | create_order writes on a new booking (both) / on quotes / on nothing | 12 (63%) / 7 / 0 | 12 (63%) / 7 / 0 | yes |
| 56 | system outcome over the 400 | none 278, listed 81, check 23, needs-reply 18 | none 278, listed 81, check 23, needs-reply 18 | yes |
| 57 | booking work (136) by outcome | listed 59, none 54, check 15, needs-reply 8 | listed 59, none 54, check 15, needs-reply 8 | yes |
| 58 | the 54 none by code | none_not_client 26, none_already_booked 16, none_already_as_asked 2, other 2, none_nothing_to_do 8 | none_not_client 26, none_already_booked 16, none_already_as_asked 2, other 2, none_nothing_to_do 8 | yes |
| 58 | the 2 'other' are both 'already as asked' | 2 | 2 | yes |
| 59 | readers disagree, by outcome | 6: none 2, listed 4 | 6: none 2, listed 4 | yes |
| 60 | quote-only (23) by outcome | listed 9, check 6, needs-reply 6, none 2 | listed 9, check 6, needs-reply 6, none 2 | yes |
| 61 | both readers nothing, by outcome | none 176, listed 5 | none 176, listed 5 | yes |
| 62 | taxonomy rows; TV outcome derived the same way | 117; 117 | 117; 117 | yes |
| 62 | label_wrong rows not booking work for either reader | 26 of 37 | 26 of 37 | yes |
| 62 | system misses that are booking work for both | 57 of 77 | 57 of 77 | yes |
| 62 | the other 20: quote requests / nothing for both / disputed | 15 / 2 / 3 | 15 / 2 / 3 | yes |
| 73 | n and interval half-width on the headline | n = 90; about ±8 points | n = 90; about ±8 points | yes |
| - | TV outcome (v2Source) equals the reads scorer's outcome (score.mts:22-30) on every email | 400 of 400 | 400 of 400 | yes |

Reproduction inputs outside the gold copy: weekReview c52ebe335769b6eb, acts ab2ef2af3b6fc824, orders d3298159e96c5371, taxonomy f9657a8c2a7ad9f1, doc b54fa4069875b5a5

### score-production, all set

git 569ed2757ace+dirty · dataset 9b809529e0917927 · labels 16622f2f47f6267b · test-set hash 8aaf7ecd8b29ba86
Latency is email sent -> decision recorded (decisions.json created_at - sent_at).

Emails 400 (provisional 6). Outcomes: none 278, needs-reply 18, listed 81, check 23. Items shown 104.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **18** |
| inquiry_recall (B42) | 87/105 = 82.9% (CI 74.3-89.5) |
| inquiry_recall, booking work only | 74/90 = 82.2% (CI 72.7-89.5); silent 16 |
| inquiry_recall, every quote counted | 89/113 = 78.8% (CI 70.1-85.9); silent 24 |
| inquiry_recall, splits resolved by reader-V | 77/93 = 82.8% (CI 73.6-89.8); silent 16 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 81/104 = 77.9% (CI 68.7-85.4) |
| display_precision (any request, both readers) | 96/104 = 92.3% (CI 85.4-96.6) |
| display_precision (B42 inquiry) | 87/104 = 83.7% (CI 75.1-90.2) |
| client_resolution_accuracy | not measurable from these labels: no reader recorded the client |
| recall@5 | not measurable from these labels: the system stores no candidate list (plan.ts:41-50), and no label names the true order |
| selection_given_correct_candidate | not measurable from these labels: as recall@5 |
| none_precision (items proposing a new order, NONE label) | 48/56 = 85.7% (CI 73.8-93.6) |
| none_recall (NONE labels whose item proposes a new order) | 48/70 = 68.6% (CI 56.4-79.1) |
| action_accuracy | not measurable from these labels: needs the correct order first |
| suppression_count by rule | sender rule (process.ts:161) 38 |
| none by reading or planner (not a rule) | none_nothing_to_do 219; none_already_booked 17; other 2; none_already_as_asked 2 |
| cost per email | not measurable: the gold copy stores no model cost (readings carry no meta) |
| latency p50 / p95 (n 400) | 1.0 min / 1.8 min |

Silent misses (B42): 1a1399db710f7409, 1a139f0f10a9d1c9, 1a139f824146018a, 1a13a5149fcd9455, 1a13aaf92b3b564e, 1a13f8312ae75c73, 1a13fc34f09bf745, 1a13fd80597e6e43, 1a13fd94ac637812, 1a140632ce4d5e99, 1a14105b82e3493e, 1a1456a614874008, 1a14638ee5140233, 1a1493bc7c314c28, 1a153bcb54f7f266, 1a1540528d5a2d27, 1a158c5ac15f6fdc, 1a159376628160f2

**reason_code by outcome**

- listed: reading_unproven 34, write 17, policy_lead_days 9, request_unsupported 6, client_unknown 6, booking_link_unreadable 3, request_inconsistent 2, system_failed 2, venue_not_identified 1, other 1
- none: none_nothing_to_do 219, none_not_client 38, none_already_booked 17, other 2, none_already_as_asked 2
- check: write 23
- needs-reply: reply_detail_missing 12, reply_unclear 4, reply_quote 2

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 182 | 176 | 1 | 5 | 0 | 177 |
| booking work: new booking | 55 | 7 | 5 | 30 | 13 | 12 |
| other request (PO, question) or readers split on it | 53 | 44 | 3 | 4 | 2 | 47 |
| booking work: change or cancel | 35 | 1 | 3 | 29 | 2 | 4 |
| booking work: OnSinch portal notice (excluded) | 26 | 26 | 0 | 0 | 0 | 26 |
| booking work: already done when decided (excluded) | 20 | 20 | 0 | 0 | 0 | 20 |
| quote with day and crew (B42 inquiry) | 15 | 1 | 1 | 7 | 6 | 2 |
| quote without shifts | 8 | 1 | 5 | 2 | 0 | 6 |
| readers split on booking work | 6 | 2 | 0 | 4 | 0 | 2 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| label_wrong | 37 | 31 | 0 | 3 | 3 | 31 |
| parse_failure | 23 | 0 | 0 | 23 | 0 | 0 |
| pipeline_break | 21 | 0 | 1 | 8 | 12 | 1 |
| wrong_action | 13 | 0 | 2 | 9 | 2 | 2 |
| rule_required | 10 | 0 | 0 | 10 | 0 | 0 |
| wrong_client | 7 | 0 | 0 | 7 | 0 | 0 |
| genuinely_ambiguous | 3 | 1 | 0 | 1 | 1 | 1 |
| not_recognized_as_inquiry | 1 | 1 | 0 | 0 | 0 | 1 |
| wrong_ranking | 1 | 0 | 0 | 0 | 1 | 0 |
| candidate_not_retrieved | 1 | 0 | 0 | 1 | 0 | 0 |


---

### replay, all set

git 569ed2757ace+dirty · dataset 9b809529e0917927 · labels 16622f2f47f6267b · test-set hash 8aaf7ecd8b29ba86
Runs 496 (96 earlier thread emails replayed unscored first, for the thread's prior requests) in 11.4 s. Network requests attempted: 0. Model calls: 0.
Preflight: ok no production credentials loaded: none of 13 present; ok network closed except the model provider: no host allowed (replay); ok the world is the time-correct fake: TimeWorld.
Same TV outcome as production on 362 of 400. Latency is in-process time per email.

Emails 400 (provisional 6). Outcomes: none 283, needs-reply 15, listed 79, check 23. Items shown 102.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **20** |
| inquiry_recall (B42) | 85/105 = 81.0% (CI 72.1-88.0) |
| inquiry_recall, booking work only | 71/90 = 78.9% (CI 69.0-86.8); silent 19 |
| inquiry_recall, every quote counted | 87/113 = 77.0% (CI 68.1-84.4); silent 26 |
| inquiry_recall, splits resolved by reader-V | 74/93 = 79.6% (CI 69.9-87.2); silent 19 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 79/102 = 77.5% (CI 68.1-85.1) |
| display_precision (any request, both readers) | 96/102 = 94.1% (CI 87.6-97.8) |
| display_precision (B42 inquiry) | 85/102 = 83.3% (CI 74.7-90.0) |
| client_resolution_accuracy | not measurable from these labels: no reader recorded the client |
| recall@5 | not measurable from these labels: the system stores no candidate list (plan.ts:41-50), and no label names the true order |
| selection_given_correct_candidate | not measurable from these labels: as recall@5 |
| none_precision (items proposing a new order, NONE label) | 49/58 = 84.5% (CI 72.6-92.7) |
| none_recall (NONE labels whose item proposes a new order) | 49/70 = 70.0% (CI 57.9-80.4) |
| action_accuracy | not measurable from these labels: needs the correct order first |
| suppression_count by rule | sender rule (process.ts:161) 38 |
| none by reading or planner (not a rule) | none_nothing_to_do 220; none_already_booked 17; other 8 |
| cost per email | $0: 0 model calls; every reading is the stored one |
| latency p50 / p95 (n 400) | 12 ms / 54 ms |

Silent misses (B42): 1a1399db710f7409, 1a139f0f10a9d1c9, 1a13a5149fcd9455, 1a13a97ff7a30369, 1a13aa2b6fca0312, 1a13aaf92b3b564e, 1a13ad05c65d0447, 1a13fc34f09bf745, 1a13fd80597e6e43, 1a13fd94ac637812, 1a14105b82e3493e, 1a1456a614874008, 1a14638ee5140233, 1a1493bc7c314c28, 1a153bcb54f7f266, 1a1540528d5a2d27, 1a158ba2b8c735d6, 1a158c5ac15f6fdc, 1a159376628160f2, 1a159fa99594e4e4

**reason_code by outcome**

- listed: policy_lead_days 29, reading_unproven 26, booking_not_identified 9, client_unknown 4, policy_confirmed_proposal 4, request_unsupported 3, booking_link_unreadable 1, request_inconsistent 1, policy_past_day 1, reply_detail_missing 1
- none: none_nothing_to_do 220, none_not_client 38, none_already_booked 17, other 8
- needs-reply: reply_detail_missing 9, reply_unclear 4, reply_quote 2
- check: write 23

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 182 | 179 | 0 | 3 | 0 | 179 |
| booking work: new booking | 55 | 10 | 4 | 35 | 6 | 14 |
| other request (PO, question) or readers split on it | 53 | 45 | 3 | 3 | 2 | 48 |
| booking work: change or cancel | 35 | 2 | 3 | 21 | 9 | 5 |
| booking work: OnSinch portal notice (excluded) | 26 | 26 | 0 | 0 | 0 | 26 |
| booking work: already done when decided (excluded) | 20 | 17 | 0 | 3 | 0 | 17 |
| quote with day and crew (B42 inquiry) | 15 | 1 | 0 | 9 | 5 | 1 |
| quote without shifts | 8 | 1 | 5 | 1 | 1 | 6 |
| readers split on booking work | 6 | 2 | 0 | 4 | 0 | 2 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| label_wrong | 37 | 32 | 0 | 2 | 3 | 32 |
| parse_failure | 23 | 2 | 0 | 18 | 3 | 2 |
| pipeline_break | 21 | 0 | 1 | 12 | 8 | 1 |
| wrong_action | 13 | 1 | 0 | 6 | 6 | 1 |
| rule_required | 10 | 0 | 0 | 10 | 0 | 0 |
| wrong_client | 7 | 1 | 0 | 6 | 0 | 1 |
| genuinely_ambiguous | 3 | 1 | 0 | 2 | 0 | 1 |
| not_recognized_as_inquiry | 1 | 1 | 0 | 0 | 0 | 1 |
| wrong_ranking | 1 | 0 | 0 | 1 | 0 | 0 |
| candidate_not_retrieved | 1 | 0 | 0 | 1 | 0 | 0 |


**Limits of the time-correct world on this set**

| limit | emails affected | total | what it means |
|---|---|---|---|
| parts deleted after the email | 119 of 400 | 297 | audit delete rows on an order the email's world read; the part existed then and its content is gone |
| order cancelled after the email | 40 of 400 | 67 | status set back from -1 to 0; the audit row has no old status |
| changed after the audit copy ends | 4 of 400 | 4 | a part modified after 22:51Z 10-22, which no audit row covers |
| modified after the email, no audit row | 224 of 400 | 740 | an upper bound on unlogged changes: 8 audit actions were fetched, and a venue change is none of them |
| bot orders rebuilt from the bot's own op | 38 of 400 | 168 | orders the bot created, absent from the snapshot, rebuilt as the bot sent them; staff edits to them are lost |
| client history may predate the snapshot | 187 of 400 | 187 | the client has an order in the snapshot's first 30 days (it holds the newest 3,500 orders, from 2025-07-14) |
| thread link with unknown state then | 3 of 400 | 3 | a job_links row seen before the email and now gone or held |
| thread message stored after production decided | 0 of 400 | 0 | sent before the email, so in replay's thread, but not stored when production read it |
| reading picks an order the world does not offer | 9 of 400 | 16 | the stored reading named an R number absent from the rebuilt context |
| reading made over 1 h after the email | 3 of 400 | 3 | the stored reading may have seen a later OnSinch |
| client email with no stored reading | 0 of 400 | 0 | replay cannot read it; a card for a person |
| client differs from production's | 15 of 400 | 15 | contacts are as of the snapshot: a contact added after the email would resolve a client production could not |
| write names a place newer than any in use then | 3 of 400 | 6 | places carry no date; a place id above every one in use when the email arrived may postdate it |

Orders absent from the snapshot that existed at an email's time and cannot be rebuilt (any client): staff-made 9-31 per email; made through the API with no delete row (the bot or test runs; when each vanished is unknown) 1711-1842 per email.
Not rolled back at all (no timestamps in the copy): companies and their contacts (811), places (2,614), professions (45). Settings' create_lead_days is not in the copy: the planner's default applies.
