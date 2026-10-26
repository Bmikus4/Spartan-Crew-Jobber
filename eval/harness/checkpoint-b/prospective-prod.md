### score-production (labels prospective, 79 emails), test set

git bdf29fb9bb04+dirty · dataset c1e3618768a1fc8b · labels 6a9d545a23025055 · test-set hash 7f277f8725036c76
Latency is email sent -> decision recorded (decisions.json created_at - sent_at).

Emails 79 (provisional 0). Outcomes: none 55, needs-reply 1, listed 23, check 0. Items shown 23.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **4** |
| inquiry_recall (B42) | 20/24 = 83.3% (CI 62.6-95.3) |
| inquiry_recall, booking work only | 12/16 = 75.0% (CI 47.6-92.7); silent 4 |
| inquiry_recall, every quote counted | 21/27 = 77.8% (CI 57.7-91.4); silent 6 |
| inquiry_recall, splits resolved by reader-V | 12/16 = 75.0% (CI 47.6-92.7); silent 4 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 23/23 = 100.0% (CI 85.2-100.0) |
| display_precision (any request, both readers) | 23/23 = 100.0% (CI 85.2-100.0) |
| display_precision (B42 inquiry) | 20/23 = 87.0% (CI 66.4-97.2) |
| client_resolution_accuracy | not measurable from these labels: no reader recorded the client |
| recall@5 | not measurable from these labels: the system stores no candidate list (plan.ts:41-50), and no label names the true order |
| selection_given_correct_candidate | not measurable from these labels: as recall@5 |
| none_precision (items proposing a new order, NONE label) | 13/15 = 86.7% (CI 59.5-98.3) |
| none_recall (NONE labels whose item proposes a new order) | 13/17 = 76.5% (CI 50.1-93.2) |
| action_accuracy | not measurable from these labels: needs the correct order first |
| suppression_count by rule | sender rule (process.ts:161) 7 |
| read with a later email whose card is an item (reached, not silent) | 0 |
| a repeat of the thread's earlier request, whose card is an item (reached, not silent) | 0 |
| none by reading or planner (not a rule) | none_nothing_to_do 40; none_already_booked 7; none_already_as_asked 1 |
| cost per email | not measurable: the gold copy stores no model cost (readings carry no meta) |
| latency p50 / p95 (n 79) | 0.9 min / 1.7 min |

Silent misses (B42): 1a168d83b151f870, 1a16a147cedc24dd, 1a16d5c74ba606ad, 1a16d8ca05a1fea7

**reason_code by outcome**

- none: none_nothing_to_do 40, none_not_client 7, none_already_booked 7, none_already_as_asked 1
- listed: write 13, policy_lead_days 6, reading_unproven 2, client_unknown 1, system_failed 1
- needs-reply: reply_detail_missing 1

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 28 | 28 | 0 | 0 | 0 | 28 |
| other request (PO, question) or readers split on it | 11 | 9 | 0 | 2 | 0 | 9 |
| booking work: new booking | 9 | 1 | 0 | 8 | 0 | 1 |
| quote with day and crew (B42 inquiry) | 8 | 0 | 0 | 8 | 0 | 0 |
| booking work: change or cancel | 7 | 3 | 0 | 4 | 0 | 3 |
| booking work: already done when decided (excluded) | 7 | 7 | 0 | 0 | 0 | 7 |
| booking work: OnSinch portal notice (excluded) | 6 | 6 | 0 | 0 | 0 | 6 |
| quote without shifts | 3 | 1 | 1 | 1 | 0 | 2 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|

