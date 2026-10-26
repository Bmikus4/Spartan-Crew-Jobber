### replay (labels prospective, 79 emails), test set

git bdf29fb9bb04+dirty · dataset c1e3618768a1fc8b · labels 6a9d545a23025055 · test-set hash 7f277f8725036c76
Runs 141 (62 earlier thread emails replayed unscored first, for the thread's prior requests) in 2.9 s. Network requests attempted: 0. Model calls: 0.
Preflight: ok no production credentials loaded: none of 13 present; ok network closed except the model provider: no host allowed (replay); ok the world is the time-correct fake: TimeWorld.
Same TV outcome as production on 66 of 79. Latency is in-process time per email.

Emails 79 (provisional 0). Outcomes: none 55, needs-reply 1, listed 10, check 13. Items shown 23.

| metric | value |
|---|---|
| **silent_miss_count** (B42) | **4** |
| inquiry_recall (B42) | 20/24 = 83.3% (CI 62.6-95.3) |
| inquiry_recall, booking work only | 12/16 = 75.0% (CI 47.6-92.7); silent 4 |
| inquiry_recall, every quote counted | 21/27 = 77.8% (CI 57.7-91.4); silent 6 |
| inquiry_recall, splits resolved by reader-V | 12/16 = 75.0% (CI 47.6-92.7); silent 4 |
| item_correctness | not measurable from these labels: no reader recorded which order an email is about |
| review_rate (listed ÷ items) | 10/23 = 43.5% (CI 23.2-65.5) |
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
| cost per email | $0: 0 model calls; every reading is the stored one |
| latency p50 / p95 (n 79) | 8 ms / 33 ms |

Silent misses (B42): 1a168d83b151f870, 1a16a147cedc24dd, 1a16d5c74ba606ad, 1a16d8ca05a1fea7

**reason_code by outcome**

- none: none_nothing_to_do 40, none_not_client 7, none_already_booked 7, none_already_as_asked 1
- check: write 13
- listed: policy_lead_days 7, reading_unproven 2, system_failed 1
- needs-reply: reply_detail_missing 1

**By what the readers say the email asks**

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|
| nothing asked (both readers) | 28 | 28 | 0 | 0 | 0 | 28 |
| other request (PO, question) or readers split on it | 11 | 9 | 0 | 0 | 2 | 9 |
| booking work: new booking | 9 | 1 | 0 | 5 | 3 | 1 |
| quote with day and crew (B42 inquiry) | 8 | 0 | 0 | 3 | 5 | 0 |
| booking work: change or cancel | 7 | 3 | 0 | 1 | 3 | 3 |
| booking work: already done when decided (excluded) | 7 | 7 | 0 | 0 | 0 | 7 |
| booking work: OnSinch portal notice (excluded) | 6 | 6 | 0 | 0 | 0 | 6 |
| quote without shifts | 3 | 1 | 1 | 1 | 0 | 2 |

**By failure-taxonomy bucket** (the live week's 117 bucketed rows; production's own misses)

| bucket | n | none | needs-reply | listed | check | silent (none + needs-reply) |
|---|---|---|---|---|---|---|


**B42 inquiries whose silent status differs from production**

| message_id | production | replay | world limits on this email |
|---|---|---|---|

Of the 4 silent misses, 0 are "already booked" answers that the time-correct world bears out (none): the labels count them as misses because the "already done" exclusions were frozen from production's own claims. They stay in the score; a reader must settle them.

**Limits of the time-correct world on this set**

| limit | emails affected | total | what it means |
|---|---|---|---|
| parts deleted after the email | 2 of 79 | 13 | audit delete rows on an order the email's world read; the part existed then and its content is gone |
| order cancelled after the email | 0 of 79 | 0 | status set back from -1 to 0; the audit row has no old status |
| changed after the audit copy ends | 10 of 79 | 10 | a part modified after 22:51Z 10-22, which no audit row covers |
| modified after the email, no audit row | 32 of 79 | 48 | an upper bound on unlogged changes: 8 audit actions were fetched, and a venue change is none of them |
| bot orders rebuilt from the bot's own op | 4 of 79 | 15 | orders the bot created, absent from the snapshot, rebuilt as the bot sent them; staff edits to them are lost |
| client history may predate the snapshot | 20 of 79 | 20 | the client has an order in the snapshot's first 30 days (it holds the newest 3,500 orders, from 2025-07-14) |
| thread link with unknown state then | 0 of 79 | 0 | a job_links row seen before the email and now gone or held |
| thread message stored after production decided | 0 of 79 | 0 | sent before the email, so in replay's thread, but not stored when production read it |
| reading picks an order the world does not offer | 1 of 79 | 3 | the stored reading named an R number absent from the rebuilt context |
| reading made over 1 h after the email | 0 of 79 | 0 | the stored reading may have seen a later OnSinch |
| client email with no stored reading | 1 of 79 | 1 | replay cannot read it: the failed read becomes a card for a person (process.ts:436-440) |
| client differs from production's | 1 of 79 | 1 | contacts are as of the snapshot: a contact added after the email would resolve a client production could not |
| write names a place newer than any in use then | 0 of 79 | 0 | places carry no date; a place id above every one in use when the email arrived may postdate it |

Orders absent from the snapshot that existed at an email's time and cannot be rebuilt (any client): staff-made 9-9 per email; made through the API with no delete row (the bot or test runs; when each vanished is unknown) 1841-1841 per email.
Not rolled back at all (no timestamps in the copy): companies and their contacts (811), places (2,614), professions (45). Settings' create_lead_days is not in the copy: the planner's default applies.
