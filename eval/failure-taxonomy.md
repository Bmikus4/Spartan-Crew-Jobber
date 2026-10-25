# Failure taxonomy on real mail (OPERATING.md §6.7)

- Agent: taxonomist
- Brief hash: fb98f168
- Written: 2026-10-25T01:12:05Z (UTC, the box's `date -u`)
- Code read at 6a98170 (branch v2). Data: `.tmp-data/week-review-1014.json` with `week-truth.json`, `-acts.json`, `-orders.json`; `.tmp-data/gold/` (taken 2026-10-23T01:45Z); `data/gold/adjudications.jsonl`. Read only, no network, no model call. Scratch scripts lived in `.tmp-v2/taxonomist/` and are deleted.

## Summary

**1. Silent misses on the live week: 4 real inquiries got no item, plus 1 genuinely ambiguous case.** The denominator is 84 real inquiries with staff work. "No item" means one of two things:
- a `none` decision, which makes no card (app/lib/feed/v2.ts:109; app/lib/feed/live.ts:80). That covers 1 email, 1a1399db710f7409.
- a needs-reply card, which the TV never lists (v2.ts:90; serve.ts:109, :115). That covers 3 emails: 1a13f8312ae75c73, 1a140632ce4d5e99 and 1a144c619a140ea6.

A verified bot write is also a card the TV does not list (v2.ts:88; serve.ts:116). Under that wider reading the count is 19 (+2 ambiguous). week-review's own labels give 35 under the strict reading (its 32 "missed changes" plus 3 needs-reply) and 51 under the wide one. The difference is label error.

**2. The live week's "missed changes" are mostly label errors.**
- **31 of week-review's 32 "missed changes" are label_wrong.**
  - Every one is an email that asks for nothing new: 13 acknowledgements, 3 auto-replies or newsletters, 7 information-only emails, and 8 POs or confirmations of a booking that already stood.
  - In each case `scripts/ops-truth.mts` gave a staff action to the email because it was the client's latest email within 36 h (ops-truth.mts:75-76). The action itself was on another day, order or field.
  - The system said `none` on all 31, which was right.
  - An independent check agrees: the gold labels' day-matched staff signal backs only 2 of the 32, and both of those are correct "already booked" answers (command in §6).
- **"completed 7" is also overstated.** Staff undid or rebuilt 3 of the 7.

**3. Every miss of the live week, bucketed at the first stage that failed.** There are 117 rows: week-review's 101 bookable non-completed emails, plus 16 it could not see.

| bucket | n | no card | needs-reply | check card | listed | examples |
|---|---|---|---|---|---|---|
| not_recognized_as_inquiry | 1 | 1 | | | | 1a1399db710f7409 |
| wrong_client | 7 | | | | 7 | 1a139ada42ba1d76, 1a13a443201c1d31, 1a15a6583c83e5ba |
| candidate_not_retrieved | 1 | | | | 1 | 1a153fd7592e2239 |
| wrong_ranking | 1 | | | 1 | | 1a13a5fb091090aa |
| parse_failure | 23 | | | | 23 | 1a139c08af1111d6, 1a13f49e6e01c4ab, 1a1596b0abbb0a66 |
| wrong_action | 13 | | 2 | 2 | 9 | 1a13e9ff8d34c9e2, 1a15951e9259b5a7, 1a13f8312ae75c73 |
| pipeline_break | 21 | | 1 | 12 | 8 | 1a13ad1788e8c98c, 1a1391790a610f8f, 1a154d69fc48ba38 |
| label_wrong | 37 | 31 | | 3 | 3 | 1a139d741dc922a9, 1a13eab03b13727a, 1a13fd94ac637812 |
| genuinely_ambiguous | 3 | 1 | | 1 | 1 | 1a1399a92f4c792d, 1a13f516bb4f171f, 1a13eb94f0ccb389 |
| (not a miss: a rule in force requires the handoff) | 10 | | | | 10 | 1a144326333c82b1, 1a15337c695a772b |

That leaves 67 system misses. Of the 21 pipeline breaks, 18 had a correct decision by value that then failed: 4 writes refused on staffed positions, 2 bot creates stopped at the crew-chief position, and 12 verified creates that staff deleted or ignored while building their own.

**4. Slices where nearly everything fails, which §6.7 calls pipeline breaks:**
- **Verified bot creates.** Staff built their own order for 14 of 16 within about an hour. 15 of the 16 are absent from the 10-23 snapshot, and 10 have a staff delete row.
- **Edit writes on 10-14 and 10-15.** 11 of 12 were refused ("signed-on crew"), against 6 of 9 verified from 10-16 to 10-20.
- **Emails with no company.**
  - 7 of 7 with staff work were handed off with no client.
  - week-review can score none of the 89 company-null rows, because ops-truth reads only decisions that have a company (ops-truth.mts:21).
- **Start-only time changes.** 5 of 5 were planned with the wrong end.
- **By type.** New bookings had 1 durable completion out of 59 rows; cancellations had 1 out of 10.
- **By company.** 8 companies had no completion at all: 457 (14 rows), 137 (10), 324 (10), 111 (7), 238 (5), 48 (4), 347 (4), and null (7).
- **Measurement slice.** Companies 61 and 128 are a failure of the measurement, not of the system: 4 of their 4 rows and 3 of their 5 rows are label errors.

**5. NONE and not-an-inquiry.**
- **NONE.** 43 live-week emails had a new order as the right answer.
  - The system said so for 38: 17 `create_order` writes and 21 handoffs drawn as "needs created".
  - It did not for 5.
  - No decision kind carries NONE. It exists only as an op kind or a card kind (plan.ts:41-50, :834, :775; v2.ts:86-91).
- **Not an inquiry.** 31 emails were read and confirmed as not inquiries, and the system said `none` on all 31.
  - It has no "not an inquiry" output. The only deterministic suppression is the sender regex (process.ts:161).
  - 21 auto-reply or newsletter-like emails were all suppressed because the model read them as `info_only` ("no change asked for", plan.ts:476). None was suppressed by a rule.

**6. Gold set, kept apart.** This is the gold set outside the live week: 100 emails labelled as real work, meaning a staff day-match signal or an adjudication.
- Buckets: parse_failure 20, wrong_action 26, pipeline_break 16, wrong_client 9, not_recognized 1, candidate/ranking 1, rule 4.
- 8 are `none: already booked/as asked`, and 15 are writes the labels cannot judge by value.
- The metric-definer's first cut counted 79 `none_nothing_to_do` silent misses. None of the 79 has a day-matched staff action; 72 have no staff signal at all.

---

## 1. Silent misses (reported first)

### 1.1 What "no item" means in this code

An email's decision reaches the TV like this, at 6a98170:

| outcome | code | listed on the TV? |
|---|---|---|
| decision `none` | `v2Source` gives `item = null` (app/lib/feed/v2.ts:109). The TV query reads only `kind IN ('write','handoff')` (app/lib/feed/live.ts:80). | no card at all |
| handoff with `reply`, or every reason a reply reason | kind `needs-reply` (v2.ts:90, REPLY_REASON at v2.ts:45) | **never listed**: the list is cards holding a needs-created or needs-updated item (serve.ts:109, :115) |
| verified write | kind `created-check` / `updated-check` (v2.ts:88) | **never listed**: counted as `done_by_system` (serve.ts:116) |
| write not executed or not verified | needs-created / needs-updated (v2.ts:89) | listed |
| any other handoff | needs-created if it asks for a new booking and names no order, else needs-updated (v2.ts:86, :91) | listed |

A listed item still leaves the TV at these points:
- the job's last day passes (project.ts:417);
- it is older than FEED_FROM (project.ts:75, :435);
- our email answers a needs-reply (project.ts:439);
- it has been green for more than 24 h (project.ts:441);
- it is undated and stale for 14 days (project.ts:442);
- the thread is dismissed (project.ts:409).

Rows with `code_version = 'local'`, or created before V2_FROM, never enter (live.ts:70, :80). In the live week, 0 rows were local and 0 client emails had no decision. Of 400 inbound emails, 362 pass the client rule (command in §6).

The table applies today's decision-only rules (v2.ts:87-91) to each stored decision. The `replan` column and `interpretation.grounded` are not in the snapshot. The TV code that ran during the week was older: carrying older needs (v2.ts:176-184) dates from 10-23. None of the 4 strict silent misses shared a thread with an earlier listed need.

### 1.2 The count

The denominator is **84 real inquiries with staff work** in the live week. That is the 117 bucketed rows, minus the 37 label_wrong, plus the 4 "completed" whose result lasted.

| reading | real | plus genuinely ambiguous | as week-review's labels stand |
|---|---|---|---|
| no card, or a needs-reply card (§4's "no item") | **4** | 5 | 35 (32 missed changes + 3 needs-reply with staff booked) |
| also counting a verified write whose check card is not listed | 19 | 21 | 51 (+14 partial, +2 wrong write) |

The 4 strict silent misses:
- **1a1399db710f7409**, not_recognized_as_inquiry. A quote naming the day, times and crew was read as `info_only`, which gives `none` (plan.ts:476). Staff created the order 0.3 h later.
- **1a13f8312ae75c73**, wrong_action. A new shift on a named order had no end. The planner asked the client rather than assuming one, which made a needs-reply.
- **1a140632ce4d5e99**, wrong_action. New calls had no venue. Problems turn into a reply before the lead-days and No Location rules run (plan.ts:471, then :775 and :813). Result: needs-reply.
- **1a144c619a140ea6**, pipeline_break. The request is in an attachment, and attachment names are carried on 0 of 7,289 messages (audit/data-map.md §1.1). Result: needs-reply.

The 15 extra under the wider reading are verified writes:
- 12 creates that staff rebuilt;
- 1 shift added to an existing order when a new order was right (1a13a5fb091090aa);
- 1 shape mismatch (1a153e512dae2620);
- 1 duplicate shift that staff deleted (1a158ba2b8c735d6).

The ambiguous ones are 1a13eb94f0ccb389 (`none`) and 1a1399a92f4c792d (a check card).

---

## 2. The live week: every miss bucketed

### 2.1 Population

- week-review-1014.json has 400 client emails from 2026-10-14T00:00Z to 10-21T02:00Z, all decided live. Its verdicts:
  - nothing to do 246;
  - handed off 45;
  - handed off, staff booked 37;
  - missed change 32;
  - write failed 17;
  - partial: staff did more 14;
  - completed 7;
  - wrong write 2.
- 108 rows are bookable, which matches week-review.mts:55, :65.
- The rows carry no `message_id`. I joined them to `.tmp-data/gold/messages.json` on (date_iso, subject), and all 400 joined uniquely (§6).
- Bucketed: the 101 bookable rows that are not "completed", plus 16 rows week-review could not see:
  - **7 company-null handoffs** that the gold labels show had day-matched staff work. week-review never scores a row without a company (ops-truth.mts:21).
  - **5 handoffs and 1 `none`** whose staff work week-review gave to another email. They were found by re-attributing each staff act by day and R number (§6).
  - **3 "completed"** whose result staff undid or duplicated:
    - 1a13fb4d5be6a768 and 1a1541de84b036b8: the bot's verified order is gone, and staff built the same job within 21 min.
    - 1a158ba2b8c735d6: a duplicate shift, deleted by staff 92 min later (audit/pipeline-trace.md §3).
- The 4 remaining "completed" rows are 2 set_po, 1 cancel_position and 1 create. The create (1a13b2a104b579ab) is uncertain: its order is absent from the snapshot and has no delete row.

### 2.2 Bucketing rules

Each row goes to the first stage that failed. The stage order follows audit/pipeline-trace.md §2 (S0-S17).

**Evidence for every row:**
- the stored decision, its reasons and code (`coded`, reasons.ts:59);
- `executed` statuses;
- week-truth staff acts with old and new values;
- the order's final state in orders.json;
- the gold truth signals.

**Reading:** I read the newest text (`latestText`, ground.ts:14) of about 72 emails where the stage could not be settled otherwise. None is quoted here.

| bucket | rule used |
|---|---|
| pipeline_break (before the decision) | `system_failed` (an OnSinch read answered 404), or the request exists only in an attachment |
| not_recognized_as_inquiry | a `none` from `info_only` (plan.ts:476) on an email whose newest words ask for the booking work staff then did |
| wrong_client | `company_id` null (or another company) at decision, and the gold label shows staff booking work on the order the email names |
| candidate_not_retrieved | the planner could not reach the right order (`booking_link_unreadable`: the thread's link names an unreadable order) |
| wrong_ranking | the system named or wrote to an order other than the one staff worked on, including an existing order where staff made a new one |
| parse_failure | the read or grounding stage lost or rejected a value the client wrote: `reading_unproven`, or a cancellation that uses none of the CANCELS phrases (interpret.ts:90, enforced at :313) |
| wrong_action | client, order and values right, but the planner chose the wrong operation, shape or disposition |
| pipeline_break (after the decision) | the plan equals the email, or staff's final state, by value, but the write did not land or the verified create was not adopted |
| label_wrong | the staff act week-review attributes is not asked for by this email, or the system's output equals the email and staff changed it later or by a net of zero |
| genuinely_ambiguous | the words support more than one booking, and staff's final state matches none of them |
| not a miss (rule) | `policy_lead_days` (plan.ts:775), or a cut below booked workers (`staffedRefusal`, app/lib/v2/bot/run.ts:77-80) |

**Value comparisons:**
- Bot creates against staff's order: day, start-end and total crew per shift. Venue and the trade split are ignored.
- Failed edits against the slot's final state.

The final state can include later changes, so every "DIFF" was read before it was bucketed.

### 2.3 Counts per bucket, with sub-reasons

**label_wrong: 37.** In each, this email did not ask for the staff act that week-review gives it. 31 are `none` decisions that were right; 3 are correct writes; 3 are handoffs or a refused write.
- **31 "missed changes", all decided `none`, which was right:**
  - 13 acknowledgements, e.g. 1a139d741dc922a9, 1a158f6e68c65504;
  - 3 auto-replies or newsletters: 1a13eab03b13727a, 1a14531a92b261d0, 1a1440fd8f796b8c;
  - 7 information only (contacts, meeting point, briefing, map, address), e.g. 1a13ea9ff621fe7c, 1a143dfb3d892fe0;
  - 8 POs or confirmations of a booking that already stood, e.g. 1a13a095eedb8695, 1a159e6d33e42e58.
  - Example: on 1a13a095eedb8695 the times in the email equal the booking *before* the staff edit that week-review gives to it.
- **1a13aa2b6fca0312.** It asks nothing new. Its time change belongs to the earlier email 1a13a9f85847ce8b, whose write was refused.
- **1a1598e6aaaba9d0 and 1a158a5e6bd47095 (wrong write).** Staff's size edits net to zero: 3 to 4 to 3.
- **1a13a07828a2d598 (wrong write).** The bot's order equals the email. Staff extended the end afterwards.
- **1a145583d37f41bc.** The PO was written right; the staff edit was on another order.
- **1a13a979194ef05f.** The cancel was reversed by the client's next email, and the staff acts belong to that email.

**parse_failure: 23.**
- **21 `reading_unproven`.** The reader's value was not borne out by code's parser, or was not quoted from the newest words. Examples by kind of failure:
  - crew phrased in words that read as null (1a139c08af1111d6, 1a159118872d9ab5);
  - "Duration: N" read as null (1a13a8bf26108f7b, 1a153f99b61947c3);
  - a day plus a 24-hour time parsed as the year (1a13f49e6e01c4ab, 1a13f86e46191246);
  - a bare ordinal day given the wrong month (1a154281bdb98ca3);
  - a two-day range read as one day (1a159c377a25725b);
  - a year misread by the model and correctly refused by code (1a13b45143681d8d).
- **2 cancellations** with none of the CANCELS phrases (interpret.ts:90): 1a1596b0abbb0a66 and 1a159f0b5b42bf65. Staff then cancelled the positions.

**pipeline_break: 21.**
- 12 verified creates were not adopted:
  - 9 equal to staff's own order by day, times and crew, e.g. 1a13ad1788e8c98c, 1a144f983605bc19, 1a15984719fbd60e;
  - 1 equal to the email (1a13f5382ff22bed);
  - 2 "completed" (1a13fb4d5be6a768, 1a1541de84b036b8).
- 4 writes refused on staffed positions ("signed-on crew ... ops must make this change"), where the plan equals what staff did: 1a1391790a610f8f, 1a13a02e4c08a985, 1a13a8890d485caa, 1a13a9f85847ce8b. Commit 061d388 (10-15) removed that refusal for time changes.
- 2 creates where the bot stopped part-way at the crew-chief position (mismatch) and the plan equals the email: 1a139a068a0023e7, 1a13fb70176c781c.
- 2 `system_failed`, an OnSinch read that answered 404: 1a154d69fc48ba38, 1a158fb5c03d300b. Both are company 324, which had other emails decided normally on the same days, so this is not a company slice.
- 1 request held only in an attachment: 1a144c619a140ea6.

**wrong_action: 13.**
- 5 start-only time changes where the plan kept the end and staff kept the length, one of them planned as 17:00-17:00: 1a13e9ff8d34c9e2, 1a13b4ff18f0a1da, 1a13e9ba4edde86b, 1a1405bd65b444b6, 1a1405f822867a84.
- 2 replies where a default or rule applied: 1a13f8312ae75c73, 1a140632ce4d5e99.
- 2 operations that do not exist, a venue correction and a named crew chief: 1a140f173cd04965, 1a153c3baf30122a.
- 1 shift split read as a crew-count conflict (plan.ts:577): 1a15951e9259b5a7.
- 1 crew chief asked for on 3 or fewer crew and handed off. That was an older planner rule, and the text no longer exists in app/lib/v2: 1a14063b8d8dd75c.
- 1 set of one-hour windows booked exactly as written, where staff booked two two-hour shifts: 1a153e512dae2620.
- 1 duplicate add_shift on an order staff had already built: 1a158ba2b8c735d6.

**wrong_client: 7.**
- All 7 have `company_id` null at decision: 4 `client_unknown` and 3 `reading_unproven`.
- They are 1a139ada42ba1d76, 1a13a443201c1d31, 1a13ad05c65d0447, 1a13ae4bb1dab34e, 1a13f9bc1c910e5c, 1a153c8290d0aad3 and 1a15a6583c83e5ba.
- With no client, the reader sees no bookings (process.ts:109-115).

**genuinely_ambiguous: 3.**
- 1a1399a92f4c792d: an end time readable as midnight or noon.
- 1a13f516bb4f171f: the "instead of" time does not match the booked start.
- 1a13eb94f0ccb389: a complaint about missing crew, after which staff cut that shift's crew.

**Single-row buckets.**
- candidate_not_retrieved: 1a153fd7592e2239.
- wrong_ranking: 1a13a5fb091090aa.
- not_recognized_as_inquiry: 1a1399db710f7409.

**Not a miss: 10.**
- 7 `policy_lead_days`, e.g. 1a144326333c82b1 and 1a159db7529bdff0.
- 3 cuts below booked workers: 1a15337c695a772b, 1a1588e0e23ce5ef, 1a158d668f0d1334.

**Left out as not misses, after checking:**
- 12 `none` emails that the gold labels flag as work. 11 are `none_already_booked` and 1 is `already_as_asked`.
  - In every case the order existed before the decision; staff made it minutes or hours earlier.
  - Later staff acts went to other emails. Example: 1a14401e46254083, whose later acts went to 1a15e5fdfbbca74c.
- 5 handoffs (1a13a97ff7a30369, 1a14539d35697ee9, 1a1493bc7c314c28, 1a15473eb1c90e8a, 1a158c5ac15f6fdc).
  - For 4 of them, week-truth-acts holds no booking-field act on the named order after the email. Their gold signal comes from a confirm or a modifier stamp: ops-truth does not count confirmations (ops-truth.mts:47, :58-66), and the gold labels do (truth.mts:114).
  - For the 5th, 1a158c5ac15f6fdc, the later booking acts (3 days after) are attributed to the later email 1a168607d1875747.
- 1a140970345e684d (company null). It restates the three booked calls exactly, and staff only confirmed and edited descriptions.

---

## 3. The gold set, kept apart from the live week

**Population.**
- truth.jsonl rows with a production decision: 741. Of these, 362 fall in the live week and are excluded.
- "Real work" means one of two things:
  - kind existing / new-job / several, with confidence strong or medium, **and** a day-matched staff signal on the top candidate ("staff created / acted on / last changed it (day match)", truth.mts:209-211);
  - or an adjudicated label.
- That gives 100 emails: 17 sent before 10-09, 62 decided 10-09..10-13, 21 decided 10-21..10-22.
- The buckets come from the code and the label only. These labels cannot show label_wrong, and they cannot show whether the email asked for the act. Every count here is an upper bound for the system and unaudited.

| bucket (mechanical) | n | codes | examples |
|---|---|---|---|
| parse_failure | 20 | reading_unproven 20 | 1a11fde9b93f8ab4, 1a120277e3d5b44d, 1a1203227af049b2 |
| wrong_action | 26 | reply_quote 10, reply_detail_missing 6, venue_not_identified 5, request_unsupported 3, partly_booked 1, other 1 | 1a115adffd07a3b6, 1a11fbf5032c1be4, 1a1205122d560ceb |
| pipeline_break | 16 | 12 "arrived with a later client message ... read them together" handoffs of the first build; 4 writes blocked or stopped | 1a08fd73131505f4, 1a0d325911b22fbd, 1a1302af563ff312 |
| wrong_client | 9 | company null 7, another company 2 | 1a1206a46fbabd4b, 1a129ce2f3e401a2, 1a12b5734c7b8276 |
| not_recognized_as_inquiry | 1 | none_nothing_to_do; the adjudication links it to an order but does not say a change was asked | 1a121140d7ef2e2e |
| candidate_not_retrieved / wrong_ranking | 1 | booking_not_identified | 1a12fc76a35c018d |
| none: already booked / as asked / history (the label cannot tell) | 8 | none_already_booked 4, already_as_asked 2, other 2 | 1a11bda7834b4090, 1a11c9e903a4efc5, 1a12fae6327d39de |
| write, not judged by value | 15 | 12 not executed (writes off), 3 verified | 1a0ecfb2ac57a27e, 1a12f46fb51031b3 |
| not a miss (rule) | 4 | policy_lead_days | 1a162b51d1fe1d5e, 1a163781e670632f |

**Checks on the 100:**
- Client: 89 match the label's order company, 2 differ (1a12c1a240bbee4a, 1a131a77a85ae6c0), 7 are null, and 2 have no order.
- Writes: 0 of 19 name an order outside the label's orders, or create where the label is existing (or the reverse).
- TV outcome: listed needs 56, write 19, needs-reply 16, none 9. Mechanically that is 25 silent-miss candidates; 11 of the 16 needs-reply are `reply_quote`, from before the 10-13 quote rule (plan.ts:472-474).
- Genuinely ambiguous on gold: the 4 adjudicated `unsure` emails that have a production decision outside the week (1a125bc994d79806, 1a1269476986d834, 1a0e89b1fb120c7b, 1a12100d6b517c3e).
- The only adjudicated not-a-job with a decision (1a134d78ed64a212) got `none`.

**Contrast with eval/metrics.md §6.**
- That first cut found 104 silent misses of 298, 79 of them `none_nothing_to_do`.
- Of those 79, 72 carry no staff signal at all: "PO/ref in thread" 36, "number in thread" 27, other thread-reference mixes 9. 6 carry a staff signal without a day; 1 is adjudicated; 0 have a day match.
- So the first cut counts "the thread names an order" as an inquiry.
- Across all dates, 192 prod-decided gold emails have day-matched staff work or an adjudication. 23 of those got `none`, and 1 of the 23 is `none_nothing_to_do`.
- The 14 in the live week were each checked in §2.3 and are correct "already booked" or "as asked" answers.

**Label error rate on gold.** 39 of the 147 adjudication notes begin "label wrong", against 68 "label right". The sample is not random.

---

## 4. Slices

### 4.1 By date

The rows are the bookable or hidden rows of the live week. "Real" means not label_wrong.

| day | rows | real | done | misses | rule | ambiguous | leading buckets among misses |
|---|---|---|---|---|---|---|---|
| 10-14 | 30 | 23 | 1 | 21 | 0 | 1 | pipeline 8, parse 6, client 4 |
| 10-15 | 30 | 22 | 0 | 20 | 0 | 2 | wrong_action 8, parse 6, pipeline 5 |
| 10-16 | 12 | 8 | 1 | 4 | 3 | 0 | pipeline 2, parse 2 |
| 10-17 | 2 | 1 | 0 | 1 | 0 | 0 | parse 1 |
| 10-19 | 20 | 11 | 0 | 10 | 1 | 0 | parse 4, pipeline 2, wrong_action 2 |
| 10-20 | 27 | 19 | 2 | 11 | 6 | 0 | parse 4, pipeline 4, wrong_action 2 |

**The 10-14..10-15 write slice is a pipeline break:**
- 11 of 12 edit writes were not verified, all of them "signed-on crew" refusals;
- 3 of 3 failed creates stopped at the crew-chief position;
- from 10-16 to 10-20, 6 of 9 edit writes were verified.

The staffed rule was lifted in 061d388 (10-15). On those days, 5 of the refused edits also had the start-only planning error.

### 4.2 By inquiry type

The type comes from the staff acts on the email: an order created means a new booking; only cancels means a cancel; anything else is a change. For label_wrong rows the acts belong to another email, so their type says nothing.

| type | rows | real | done | misses | rule | leading buckets |
|---|---|---|---|---|---|---|
| new booking | 59 | 44 | 1 | 34 | 8 | pipeline 16, parse 11, wrong_action 3 |
| change | 52 | 35 | 2 | 30 | 1 | parse 10, wrong_action 10, client 5, pipeline 4 |
| cancel | 10 | 5 | 1 | 3 | 1 | parse 2, pipeline 1 |

**Question.** No miss is a question. The 45 handoffs with no staff work include 15 needs-reply cards (questions, quotes and missing details), and none was ever listed.

**Near-total slices:**
- **New bookings by bot create.** 16 verified creates:
  - 14 were followed within 1.1 h by staff's own order for the same job;
  - 15 are absent from the snapshot;
  - 10 have a staff `common_delete` row (users 573, 110 and 102);
  - only R11552 survived (confirmed).
- **Cancellations.** 1 completed of 5 real or rule cases.

### 4.3 By company (numeric id; companies with 4 or more rows)

| company | rows | done | misses | label_wrong | rule | misses by bucket |
|---|---|---|---|---|---|---|
| 457 | 14 | 0 | 9 | 3 | 2 | pipeline 5, parse 2, wrong_action 2 |
| 137 | 10 | 0 | 6 | 4 | 0 | pipeline 2, parse 2, wrong_action 2 |
| 324 | 10 | 0 | 7 | 3 | 0 | wrong_action 3, parse 2, pipeline 2 |
| 111 | 7 | 0 | 5 | 2 | 0 | parse 2, pipeline 1, wrong_action 1, ranking 1 |
| 218 | 7 | 1 | 3 | 2 | 1 | parse 2, pipeline 1 |
| null | 7 | 0 | 7 | 0 | 0 | wrong_client 7 |
| 128 | 5 | 1 | 0 | 3 | 1 | none |
| 238 | 5 | 0 | 3 | 2 | 0 | parse 2, wrong_action 1 |
| 48 | 4 | 0 | 3 | 0 | 0 | parse 2, pipeline 1 (+1 ambiguous) |
| 61 | 4 | 0 | 0 | 4 | 0 | none |
| 347 | 4 | 0 | 2 | 2 | 0 | parse 2 |

**Slices named as near-total:**
- **Company null.** 7 of 7 real rows failed at the client stage. On the measuring side, 89 of 400 week rows have no company, and week-review cannot call any of them bookable (ops-truth.mts:21).
- **Companies 61 and 128.** These fail in the *measurement*: 4 of 4 and 3 of 5 rows are label_wrong, because these clients send POs and acknowledgements after staff act.
- **No completion at all** for 457, 137, 324, 111, 238, 48 and 347, but their misses spread across 3-4 buckets, so no single stage explains a company.

### 4.4 Other near-total slices

- **Start-only time changes:** 5 of 5 planned keeping the end rather than the length.
- **"missed change" as a verdict:** 31 of 32 are label_wrong. The 36 h latest-email attribution (ops-truth.mts:72-79) is the break.

---

## 5. Emails whose right answer was NONE, or not an inquiry

**NONE (no existing order, so a new order).**
- In the live week, 43 emails had staff create a new order for them. That excludes label_wrong, and 1a158d668f0d1334, whose creates belong to other emails.
- How the system answered:

| system output | n | said NONE? |
|---|---|---|
| `create_order` write (plan.ts:834): 15 verified, 2 stopped | 17 | yes |
| handoff drawn as needs-created (v2.ts:86, :91): lead days 7, reading_unproven 10, client_unknown 2, system_failed 1, old chief rule 1 | 21 | yes, on the card |
| handoff needs-reply (reply_detail_missing) | 2 | no, and not listed |
| handoff drawn as needs-updated (reading_unproven; the model picked an order) | 1 | no |
| write to an existing order (1a13a5fb091090aa) | 1 | no |
| `none` (info_only, 1a1399db710f7409) | 1 | no |

- The needs-created column is computed from the stored model reading, because `grounded` is not in the snapshot (v2.ts:86 reads `grounded`). It is an approximation.
- There is no decision kind for NONE (plan.ts:41-50). The answer exists only as a `create_order` op or as the card kind (audit/pipeline-trace.md §8).
- Gold outside the week: of 49 new-job labels, 7 were writes, 13 needs-reply, 28 listed handoffs and 1 none.

**Not an inquiry.**
- The 31 label_wrong "missed changes" were read and confirmed as not inquiries, and the system said `none` on all 31.
- The 246 "nothing to do" emails are all `none` with no staff work: none_nothing_to_do 190, none_not_client 38, none_already_booked 14, none_already_as_asked 2, other 2. They were not read one by one.
- 21 emails whose subject or first 600 characters match an auto-reply or newsletter pattern were all decided `none_nothing_to_do` by the model. None was decided by a rule.
- The 45 handoffs with no staff work became items (30 listed, 15 needs-reply). Whether they are non-inquiries or work staff declined is not settled.

**Can the system say "not an inquiry"? Only as `none`.**
- No decision kind or code means "not an inquiry" (plan.ts:41-50; reasons.ts:40-43). "Not an inquiry" and "an inquiry already done" are the same `none`, and neither appears on the TV (v2.ts:109).
- Deterministic suppression is only the sender regex (process.ts:161, applied at :361). A stranger's cancellation or information is the only other code rule (plan.ts:488).
- Auto-reply and list headers are not stored (threadMessagesDb.ts:36-64; audit/pipeline-trace.md S1), so an auto-reply is suppressed only when the model reads it as `info_only` (plan.ts:476).

---

## 6. Method, reproduction, limits

**Reproduction.**

The join and the TV outcome. This prints the verdict × TV × company × gold-signal table that §1, §2 and the 30-of-32 check rest on. Save it as `.tmp-v2/repro.mts` and run `npx tsx .tmp-v2/repro.mts`. It reads local files only and prints counts only.

```ts
import fs from "node:fs";
import { coded } from "../app/lib/v2/reasons.ts";
const J = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")), P = (v: any) => (typeof v === "string" ? JSON.parse(v) : v);
const wr: any[] = J(".tmp-data/week-review-1014.json"), msgs: any[] = J(".tmp-data/gold/messages.json");
const dec = new Map(J(".tmp-data/gold/decisions.json").map((d: any) => [d.message_id, d]));
const gold = new Map(fs.readFileSync(".tmp-data/gold/truth.jsonl", "utf8").trim().split("\n").map((l) => { const x = JSON.parse(l); return [x.message_id, x]; }));
const key = (at: string, s: string) => `${new Date(at).toISOString()}|${s ?? ""}`;
const byKey = new Map<string, string[]>();
for (const m of msgs) if (!m.is_from_spartan && dec.has(m.message_id)) byKey.set(key(m.date_iso, m.subject), [...(byKey.get(key(m.date_iso, m.subject)) ?? []), m.message_id]);
const REPLY = /asked for a quote|the request is unclear|: no (day|start time|end time or duration|crew count|new time or length) the client wrote$|^no venue in the email$/; // feed/v2.ts:45
const SD = /^staff (created|acted on|last changed) it \(day match\)$/;
const tab: Record<string, number> = {};
for (const r of wr) {
  const ids = byKey.get(key(r.at, r.subject)) ?? []; if (ids.length !== 1) { tab["UNJOINED"] = (tab["UNJOINED"] ?? 0) + 1; continue; }
  const d: any = dec.get(ids[0]), dd: any = coded(P(d.decision)), ex = P(d.executed) ?? [], ops = dd.kind === "write" ? dd.ops : [];
  const tv = dd.kind === "none" ? "no card" : dd.kind === "write" ? (ex.length === ops.length && ex.every((e: any) => e.status === "verified") ? "check card, not listed" : "listed")
    : (dd.reply ?? dd.reasons.every((s: string) => REPLY.test(s))) ? "needs-reply, not listed" : "listed";
  const g: any = gold.get(ids[0]); const gsd = !!g?.truth?.candidates?.[0]?.sig?.some((s: string) => SD.test(s));
  const k = `${r.verdict} | ${tv} | company ${d.company_id == null ? "null" : "set"} | gold staff day-match ${gsd}`; tab[k] = (tab[k] ?? 0) + 1;
}
console.log(Object.entries(tab).sort());
```

It reproduces:
- missed change | no card: gold day-match false 30, true 2;
- handed off | listed | company null | gold day-match true: 7, which are the wrong_client rows;
- nothing to do | no card | company null: 76;
- handed off, staff booked: 34 listed and 3 needs-reply;
- 0 UNJOINED.

**Other counts and how they were made:**
- **Lost and local emails.** Inbound emails in the window with no decision: 0 of 362 that pass the client rule. Local rows: 0. Filtered senders: 38. Method: filter messages.json to `date_iso` in the window, `!is_from_spartan`, and the process.ts:161 regex, then look each up in decisions.json.
- **Fate of the bot's creates.** For each verified create, `executed[].detail.order_id` was looked up in orders.json. timeline.json was searched for `common_delete` rows with `data.model === "Order"` on that id. Result: 15 of 16 absent, 10 deleted.
- **Staff duplicates.** Staff orders were found through week-truth `create order` acts. They were compared with the bot's `create_order` op by date, London start-end and total crew, with cancelled slots included because some were cancelled later. Result: 9 equal, 1 equal to the email, 2 different and read.
- **Failed edits.** Each `set_position_times` / `set_position_size` / `cancel_position` op was compared with that slot's final state in orders.json or week-truth-orders.json. Result: 5 equal; 6 start-only differences, all read; 1 reversed; 1 ambiguous.
- **Re-attribution, my own rule.** Each staff act in week-truth-acts goes to the latest email of the act's company within 96 h that names a day the order holds. The email's days are `factsOf` (app/lib/match/facts.ts:109) over the subject and newest words, together with the reading's request days. Failing that, it goes to the latest email whose thread names the order's R number; failing that, to the latest email within 36 h. Under it, 23 of the 32 missed changes keep no act backed by a day or an R number: 17 keep only acts from the 36 h fallback, and 6 keep none. It also found 5 handoffs and 1 `none` with staff work that week-review had given to other emails.
- **Auto-reply pattern.** `/out of (the )?office|automatic reply|auto(matic)?[- ]?reply|\bOOO\b|delayed replies|away from (the )?office|annual leave|unsubscribe|view (this email )?in (your )?browser/i` over the subject and the first 600 body characters gives 21 matches, all `none_nothing_to_do`.

**Limits:**
- The TV outcome is derived from the decision as made, not from the `replan` column, which is not in the snapshot.
- The week-truth staff truth does not cover venue changes, confirmations or deletes (ops-truth.mts:47, :58-66). A venue request like 1a140f173cd04965 therefore has its real staff act unmeasured.
- Company-null emails were examined only through the gold signals.
- 4 "completed" rows were not re-examined beyond the fate check.
- The gold buckets in §3 are mechanical and unaudited.
- No fix or design is proposed here.

---

## Appendix A: every bucketed row of the live week (117)

"staff act type" is the type of the staff acts week-review or the gold label attributes to the email. For label_wrong rows those acts belong to another email. "check card" means a verified bot write, which the TV never lists.

| message_id | day | company | week-review verdict | code | TV outcome | staff act type | bucket | reason |
|---|---|---|---|---|---|---|---|---|
| 1a1399db710f7409 | 10-14 | 705 | missed change | none_nothing_to_do | no card | new booking | not_recognized_as_inquiry | quote naming day, times and crew read as info_only; staff created the order 0.3 h later |
| 1a139ada42ba1d76 | 10-14 | null | hidden (handed off) | reading_unproven | listed | change | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a13a443201c1d31 | 10-14 | null | hidden (handed off) | client_unknown | listed | new booking | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a13ad05c65d0447 | 10-14 | null | hidden (handed off) | client_unknown | listed | change | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a13ae4bb1dab34e | 10-14 | null | hidden (handed off) | reading_unproven | listed | change | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a13f9bc1c910e5c | 10-15 | null | hidden (handed off) | reading_unproven | listed | change | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a153c8290d0aad3 | 10-19 | null | hidden (handed off) | client_unknown | listed | change | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a15a6583c83e5ba | 10-20 | null | hidden (handed off) | client_unknown | listed | new booking | wrong_client | company_id null at decision; gold shows staff booking work on the order the email names |
| 1a153fd7592e2239 | 10-19 | 214 | handed off, staff booked | booking_link_unreadable | listed | change | candidate_not_retrieved | thread link points at an order the system could not read; staff booked on another order |
| 1a13a5fb091090aa | 10-14 | 111 | partial: staff did more | write | check card (not listed) | new booking | wrong_ranking | new shift added to an existing order; staff made a new order (NONE was right) |
| 1a139c08af1111d6 | 10-14 | 218 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13a8bf26108f7b | 10-14 | 129 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13af10fc5250eb | 10-14 | 267 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13b3fa256bdee2 | 10-14 | 324 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13b45143681d8d | 10-14 | 137 | hidden (handed off) | reading_unproven | listed | change | parse_failure | reading_unproven; staff work found by day/R re-attribution |
| 1a13b915f3a326a3 | 10-14 | 111 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13ea2e0ba9a5e1 | 10-15 | 137 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13ebde5287c063 | 10-15 | 126 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13f49e6e01c4ab | 10-15 | 238 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13f86e46191246 | 10-15 | 238 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a13fea576aeda13 | 10-15 | 457 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a140651f540d14f | 10-15 | 347 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a143eb3508a25f7 | 10-16 | 347 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a144942ca8851d1 | 10-16 | 293 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a1497d7b3445d5f | 10-17 | 324 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a1533b5bd8afd4a | 10-19 | 457 | hidden (handed off) | reading_unproven | listed | change | parse_failure | reading_unproven; staff work found by day/R re-attribution |
| 1a153f99b61947c3 | 10-19 | 111 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a154281bdb98ca3 | 10-19 | 333 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a1547e5ac397a7b | 10-19 | 411 | handed off, staff booked | reading_unproven | listed | change | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a159118872d9ab5 | 10-20 | 218 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a1596b0abbb0a66 | 10-20 | 48 | handed off, staff booked | request_unsupported | listed | cancel | parse_failure | cancellation worded without the code's cancel words (interpret.ts:313) |
| 1a159c377a25725b | 10-20 | 863 | handed off, staff booked | reading_unproven | listed | new booking | parse_failure | reading_unproven: a value the reader gave was not borne out by the code's parser or not quoted from the newest words |
| 1a159f0b5b42bf65 | 10-20 | 48 | handed off, staff booked | request_unsupported | listed | cancel | parse_failure | cancellation worded without the code's cancel words (interpret.ts:313) |
| 1a13b4ff18f0a1da | 10-14 | 842 | write failed | write | listed | change | wrong_action | start-only time change: the plan kept the end (one case 17:00-17:00), staff kept the length |
| 1a13e9ba4edde86b | 10-15 | 126 | write failed | write | listed | change | wrong_action | start-only time change: the plan kept the end (one case 17:00-17:00), staff kept the length |
| 1a13e9ff8d34c9e2 | 10-15 | 324 | write failed | write | listed | change | wrong_action | start-only time change: the plan kept the end (one case 17:00-17:00), staff kept the length |
| 1a13f8312ae75c73 | 10-15 | 324 | handed off, staff booked | reply_detail_missing | needs-reply (not listed) | change | wrong_action | new shift on a named order with no end: asked the client instead of assuming an end (needs-reply) |
| 1a1405bd65b444b6 | 10-15 | 324 | write failed | write | listed | change | wrong_action | start-only time change: the plan kept the end (one case 17:00-17:00), staff kept the length |
| 1a1405f822867a84 | 10-15 | 457 | write failed | write | listed | change | wrong_action | start-only time change: the plan kept the end (one case 17:00-17:00), staff kept the length |
| 1a140632ce4d5e99 | 10-15 | 248 | handed off, staff booked | reply_detail_missing | needs-reply (not listed) | new booking | wrong_action | new calls with no venue: asked the client (needs-reply) before the lead-days and No Location rules ran (plan.ts:471) |
| 1a14063b8d8dd75c | 10-15 | 238 | hidden (handed off) | other | listed | new booking | wrong_action | a crew chief asked on 3 or fewer crew was handed off (old rule); staff created the order |
| 1a140f173cd04965 | 10-15 | 137 | handed off, staff booked | request_unsupported | listed | change | wrong_action | venue correction: no operation for it (request_unsupported) |
| 1a153c3baf30122a | 10-19 | 111 | hidden (handed off) | request_unsupported | listed | change | wrong_action | a named crew chief and skills: no operation for it (request_unsupported) |
| 1a153e512dae2620 | 10-19 | 457 | partial: staff did more | write | check card (not listed) | new booking | wrong_action | three 1-hour windows booked as written; staff booked two 2-hour shifts |
| 1a158ba2b8c735d6 | 10-20 | 582 | hidden (completed) | write | check card (not listed) | change | wrong_action | week-review completed: the bot added a shift staff had already booked; staff deleted it 92 min later (pipeline-trace section 3) |
| 1a15951e9259b5a7 | 10-20 | 137 | handed off, staff booked | request_inconsistent | listed | change | wrong_action | a shift split read as a crew-count conflict (request_inconsistent, plan.ts:577) |
| 1a1391790a610f8f | 10-14 | 585 | write failed | write | listed | cancel | pipeline_break | write refused on staffed positions (rule removed 10-15 in 061d388); the plan equals what staff then did |
| 1a139a068a0023e7 | 10-14 | 48 | write failed | write | listed | new booking | pipeline_break | bot create stopped part-way at the crew-chief position (mismatch); the plan equals the email |
| 1a139bd196d4eff6 | 10-14 | 457 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a13a02e4c08a985 | 10-14 | 457 | write failed | write | listed | change | pipeline_break | write refused on staffed positions (rule removed 10-15 in 061d388); the plan equals what staff then did |
| 1a13a8890d485caa | 10-14 | 137 | write failed | write | listed | change | pipeline_break | write refused on staffed positions (rule removed 10-15 in 061d388); the plan equals what staff then did |
| 1a13a9f85847ce8b | 10-14 | 111 | write failed | write | listed | change | pipeline_break | write refused on staffed positions (rule removed 10-15 in 061d388); the plan equals what staff then did |
| 1a13abf5104b15b4 | 10-14 | 135 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a13ad1788e8c98c | 10-14 | 137 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a13f449f8efd6b3 | 10-15 | 774 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a13f5382ff22bed | 10-15 | 157 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to the email; staff built their own with other days and crew |
| 1a13fb4d5be6a768 | 10-15 | 457 | hidden (completed) | write | check card (not listed) | new booking | pipeline_break | week-review completed: the verified bot create is gone from OnSinch and staff built the same job themselves within 21 min |
| 1a13fb70176c781c | 10-15 | 457 | write failed | write | listed | new booking | pipeline_break | bot create stopped part-way at the crew-chief position (mismatch); the plan equals the email |
| 1a13fe91532a3fb7 | 10-15 | 723 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a144c619a140ea6 | 10-16 | 794 | handed off, staff booked | reply_detail_missing | needs-reply (not listed) | new booking | pipeline_break | the request is in an attachment the pipeline does not carry (needs-reply) |
| 1a144f983605bc19 | 10-16 | 457 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a1541de84b036b8 | 10-19 | 333 | hidden (completed) | write | check card (not listed) | new booking | pipeline_break | week-review completed: the verified bot create is gone from OnSinch and staff built the same job themselves within 21 min |
| 1a154d69fc48ba38 | 10-19 | 324 | handed off, staff booked | system_failed | listed | change | pipeline_break | OnSinch read answered 404: could not plan (system_failed) |
| 1a158632aed55e9a | 10-20 | 263 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a158fb5c03d300b | 10-20 | 324 | handed off, staff booked | system_failed | listed | new booking | pipeline_break | OnSinch read answered 404: could not plan (system_failed) |
| 1a15984719fbd60e | 10-20 | 157 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a15984f57ab3251 | 10-20 | 218 | partial: staff did more | write | check card (not listed) | new booking | pipeline_break | verified bot create equal to staff's order by day, times and crew; staff deleted or ignored it and built their own |
| 1a139d741dc922a9 | 10-14 | 128 | missed change | none_nothing_to_do | no card | cancel | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a13a07828a2d598 | 10-14 | 353 | wrong write | write | check card (not listed) | change | label_wrong | bot order equals the email; staff extended the end afterwards |
| 1a13a095eedb8695 | 10-14 | 61 | missed change | none_nothing_to_do | no card | change | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a13a979194ef05f | 10-14 | 842 | write failed | write | listed | cancel | label_wrong | cancel request reversed by the client's next email; the staff acts belong to that email |
| 1a13aa2b6fca0312 | 10-14 | 111 | handed off, staff booked | reading_unproven | listed | change | label_wrong | asks nothing new; the time change belongs to the earlier email 1a13a9f85847ce8b |
| 1a13acdf4936c4fb | 10-14 | 135 | missed change | none_nothing_to_do | no card | cancel | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a13b714f2381088 | 10-14 | 137 | missed change | none_nothing_to_do | no card | new booking | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a13ea9ff621fe7c | 10-15 | 137 | missed change | none_nothing_to_do | no card | new booking | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a13eab03b13727a | 10-15 | 324 | missed change | none_nothing_to_do | no card | change | label_wrong | auto-reply or newsletter; staff act attributed by the 36 h rule |
| 1a13ef453eb5ced8 | 10-15 | 279 | missed change | none_nothing_to_do | no card | change | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a13f5601780e57f | 10-15 | 61 | missed change | none_nothing_to_do | no card | new booking | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a13f8b9b0187e83 | 10-15 | 395 | missed change | none_nothing_to_do | no card | change | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a13fd94ac637812 | 10-15 | 457 | missed change | none_nothing_to_do | no card | change | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a140518c09dd73e | 10-15 | 61 | missed change | none_nothing_to_do | no card | change | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a140936e8627133 | 10-15 | 238 | missed change | none_nothing_to_do | no card | new booking | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a143dfb3d892fe0 | 10-16 | 238 | missed change | none_nothing_to_do | no card | change | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a1440fd8f796b8c | 10-16 | 350 | missed change | none_nothing_to_do | no card | new booking | label_wrong | auto-reply or newsletter; staff act attributed by the 36 h rule |
| 1a14531a92b261d0 | 10-16 | 324 | missed change | none_nothing_to_do | no card | new booking | label_wrong | auto-reply or newsletter; staff act attributed by the 36 h rule |
| 1a145583d37f41bc | 10-16 | 279 | partial: staff did more | write | check card (not listed) | change | label_wrong | PO written right; the staff edit was on another order |
| 1a149cd8d832fa22 | 10-17 | 94 | missed change | none_nothing_to_do | no card | change | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a153425d8feed3a | 10-19 | 214 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a15344a323ab432 | 10-19 | 457 | missed change | none_already_booked | no card | cancel | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a153c829d7300b1 | 10-19 | 137 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a154311db2eed89 | 10-19 | 128 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a154494f331ef3e | 10-19 | 457 | missed change | none_nothing_to_do | no card | change | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a1547e58fba69f8 | 10-19 | 61 | missed change | none_nothing_to_do | no card | new booking | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a1548e752b0368c | 10-19 | 94 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a154acae85ad3bb | 10-19 | 111 | missed change | none_nothing_to_do | no card | change | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a154da7094c9e11 | 10-19 | 207 | missed change | none_nothing_to_do | no card | change | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a158a5e6bd47095 | 10-20 | 347 | wrong write | write | check card (not listed) | change | label_wrong | staff edits net to zero after the bot's verified change |
| 1a158f6e68c65504 | 10-20 | 128 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a1598e6aaaba9d0 | 10-20 | 347 | handed off, staff booked | reading_unproven | listed | change | label_wrong | staff edits net to zero; the change was already written from 1a158a5e6bd47095 |
| 1a1599ee50247795 | 10-20 | 137 | missed change | none_nothing_to_do | no card | cancel | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a159cd5eefd359d | 10-20 | 870 | missed change | none_nothing_to_do | no card | change | label_wrong | information only (contacts, meeting point, briefing, map, address); the attributed staff act is not asked for |
| 1a159e472ec3754f | 10-20 | 324 | missed change | none_nothing_to_do | no card | new booking | label_wrong | acknowledgement; asks for nothing; staff act attributed by the 36 h latest-email rule |
| 1a159e6d33e42e58 | 10-20 | 218 | missed change | none_already_booked | no card | new booking | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a159f2b548dfdf2 | 10-20 | 218 | missed change | none_already_booked | no card | new booking | label_wrong | PO or confirmation of a booking that already stood; the attributed staff act is on another day, order or field |
| 1a1399a92f4c792d | 10-14 | 48 | partial: staff did more | write | check card (not listed) | new booking | genuinely_ambiguous | an end time readable as midnight or noon; the bot read midnight; staff booked neither |
| 1a13eb94f0ccb389 | 10-15 | 279 | hidden (nothing to do) | none_nothing_to_do | no card | change | genuinely_ambiguous | a complaint about missing crew; staff then cut the crew on that shift |
| 1a13f516bb4f171f | 10-15 | 264 | write failed | write | listed | change | genuinely_ambiguous | the instead-of time does not match the booked start; staff's final time matches neither |
| 1a144326333c82b1 | 10-16 | 741 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a1444323f1ac8c6 | 10-16 | 129 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a144a8d3a03a407 | 10-16 | 457 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a15337c695a772b | 10-19 | 457 | write failed | write | listed | cancel | rule_required | a cut below booked workers waits for ops (run.ts staffed refusal, B38) |
| 1a1587d82ff43dd4 | 10-20 | 317 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a15884b2b340cbe | 10-20 | 582 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a1588e0e23ce5ef | 10-20 | 354 | write failed | write | listed | change | rule_required | a cut below booked workers waits for ops (run.ts staffed refusal, B38) |
| 1a158a1bf953e5fc | 10-20 | 128 | handed off, staff booked | policy_lead_days | listed | new booking | rule_required | policy_lead_days: a new order within 14 days is for staff (plan.ts:775) |
| 1a158d668f0d1334 | 10-20 | 354 | write failed | write | listed | new booking | rule_required | a cut below booked workers waits for ops (run.ts staffed refusal, B38) |
| 1a159db7529bdff0 | 10-20 | 218 | hidden (handed off) | policy_lead_days | listed | new booking | rule_required | policy_lead_days |
