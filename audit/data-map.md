agent: data-cartographer
brief hash: 9b5d88d5
written (UTC, box clock `date -u`): 2026-10-25T00:31:57Z
inputs: repo C:\Users\thera\spartan-v2, branch v2, HEAD 6a98170; snapshot .tmp-data/gold/ (meta.json: from 2026-07-29T00:00:00Z, taken_at 2026-10-23T01:45:22.758Z); data/gold/adjudications.jsonl. Nothing live was touched. The scratch scripts in .tmp-v2/dc-* have been deleted.

# Summary (one page)

**The archive.** thread_messages has 7,289 rows across 1,279 Gmail threads. Rows were first seen from 2026-08-23 to 2026-10-22, and 1,355 of them were first seen on 2026-08-23 (the backfill). Message dates go back to 2024-02, because n8n posts whole threads. Every row has its sender, subject, recipients and a full plain-text body: 2 of 7,289 bodies are empty and none are archived. The body includes the quoted history, with a quote marker in 5,892 of 7,289 and in 5,790 of the 5,847 "Re:" subjects. Nothing separates the newest text from the quote.
**The reply chain is missing.** Message-ID, In-Reply-To, References, Cc and attachment names are each filled in 0 of 7,289 rows. The Message-ID and reply-chain columns have existed since 2026-09-29. The Cc and attachment columns arrived about 2 minutes before the snapshot (commit 94b91ce). Threads can therefore be joined only by Gmail threadId, not by RFC headers.
**Our own outbound mail is kept.** 3,775 of 7,289 rows are outbound, and 994 of 1,279 threads have at least one. Only 184 of 3,775 outbound subjects (4.9%) carry an R or J number, and only 96 of the 1,580 in the window (6.1%). Only 59 of the 994 threads with outbound mail ever get an R or J in an outbound subject. Subjects are a weak join key to orders.
**OnSinch orders.** The snapshot has the newest 3,500 orders only, created 2025-07-14 to 2026-10-22. Statuses: -2 closed 2,815, -1 cancelled 557, 0 open 128. provisional is true on 500, quote on 88. I checked the code's status meanings against the data: of 204 order_cancel rows, 199 point at orders now -1, and 0 of the 2,815 closed orders have a shift after the snapshot. **"To Confirm" is not a field.** 45 open orders with a confirm row and 30 without one show the same status, provisional and quote values. Places resolve for 11,971 of 11,971 shifts.
**Staff actions.** timeline.json holds 39,467 audit rows across 8 fetched actions, and 35,651 of them come from 46 people. **Confirming is logged and timestamped:** 519 order_confirm_provisional rows cover 500 orders. Every row has a to-the-second timestamp, 465 name the person and 54 have no creator. The row names the order by its NUMBER and carries nothing else. Confirmations come a median 15.4 h after the order is created (p90 186 h).
**v2_decisions** has 847 rows from 2026-10-09 to 10-22, and company_id is filled on 653. **job_links** has 435 rows (249 linked, 178 gone); where an order is present, its R number, job and company agree 255 of 255 times. 1,858 of the 1,864 orders the bot created through the API are missing from the order snapshot.
**Sender to client, last 30 days.** The window holds 1,319 client emails (the rule in process.ts:161,192) from 257 senders. The production rule, `matchCompanyBySender` (resolve.ts:113), gives exactly one company for **1,175 of 1,319 emails (89.1%)** and 202 of 257 senders (78.6%). Nearly all of that comes from the domain step (1,147). Of the 144 it leaves unresolved, 106 have a domain on no company, 23 a domain on 2 companies, and 15 a free-mail address. 95 of those 144 are labelled no-order-signal. Against the independent hand labels (92 "link" adjudications) the rule agrees 89 times, disagrees 0 times and gives no answer 3 times.
**Orders per client (for item 4).** 112 companies wrote in the window. Their order counts across all statuses in the snapshot have a median of 7, p90 48 and max 288. Weighted by email the median is 27 and p90 163, because the top 10 companies sent 496 of the 1,175 resolved emails. **The live pool at email time is small:** orders not cancelled, created before the email, with a shift on or after its day. That pool has a median of 2, p90 7 and max 15. 581 of 1,175 resolved emails (49.4%) have at most 1 such order and 980 (83.4%) have at most 5. Picking the client is almost deterministic; picking the order needs ranking only in a 2-to-15 pool, not across the full history.
**Blocked offline (§5):** inbound_raw (not in the snapshot), whether any outbound row is an unsent draft, whether OnSinch marks To Confirm in a field the API did not return, audit actions outside the 8 fetched, and all ledger, alias, archive and record tables.

---

# Definitions used (so every count can be recomputed)

- **Window (items 3, 4):** `date_iso` in [2026-09-23T01:45:22.758Z, 2026-10-23T01:45:22.758Z], i.e. 30 days back from meta.json `taken_at`.
- **Client email:** a `messages.json` row with `!is_from_spartan && !NOT_CLIENT.test(addr(from_address))`. The regex is `/spartancrew\.co\.uk|no-?reply|mailer-daemon|postmaster|onsinch|sinch\.cz/i` (app/lib/v2/process.ts:161, applied at :192). `addr` strips `Name <...>`. scripts/gold/truth.mts:44 uses the same rule.
- **Sender rule:** `matchCompanyBySender(addr, companies.json)` (app/lib/engine/resolve.ts:113). It tries in turn: a domain with contacts on exactly one company (`matchCompanyByDomain`, :79), then the exact address as a contact or `email_invoice`, then the invoice domain of a company with no contacts. Consumer domains are listed at :46. It was run in-process with tsx and no network.
- **R number:** `rNumbersIn` (resolve.ts:494): `R` followed by 3 to 6 digits, with "repeat of R…" removed. **J number:** `/\bJ[\s#:-]?(1\d{4,5})\b/` (truth.mts:131).
- **Status meaning:** -1 cancelled, -2 closed, 0 open (app/lib/match/match.ts:329). This was checked against the data in §1.4.
- Bot user = OnSinch user 2257 (truth.mts:29). "Person" means a timeline `creator` that is neither null nor 2257.

---

# 1. Sources and their fields

## 1.1 Email archive: `thread_messages` (snapshot: messages.json, 7,289 rows)

Schema: app/lib/threadMessagesDb.ts:37-48 (base table), :54 (`rfc_message_id`), :58-59 (`in_reply_to`, `reference_ids`), :63-64 (`cc_addresses`, `attachment_names`). There is one row per message, keyed on the Gmail message id. A re-delivery is `ON CONFLICT DO NOTHING` (:288, :359), plus `fillHeaders` (:307), which fills empty header columns only.

| field | filled | notes |
|---|---|---|
| message_id | 7,289/7,289 | 7,288 are 16-hex Gmail ids and 1 is RFC-shaped `<…@…>` |
| thread_id | 7,289/7,289 | 7,288 are 16-hex Gmail threadIds and 1 is something else; 1,279 distinct threads |
| from_address | 7,284/7,289 | |
| to_addresses | 7,261/7,289 non-empty | 1 recipient 6,780; 2: 413; 3: 54; 4+: 14; 0: 28 |
| date_iso | 7,289/7,289 | ISO with ms and Z; range 2024-02-07T10:48:09Z..2026-10-22T20:22:40Z; 262 dated before 2026-07-29 |
| subject | 7,283/7,289 | 5,847 start "Re:" |
| body | 7,287/7,289 | plain text; length p10 1,114, p50 5,795, p90 22,150, max 246,477 chars; 154 look like HTML |
| is_from_spartan | 7,289/7,289 | true 3,775 / false 3,514 |
| first_seen_at | 7,289/7,289 | 2026-08-23T18:12:52Z..2026-10-22T20:25:38Z; 1,355 on 2026-08-23 |
| archived_at | **0/7,289** | no body has been archived, so every body is present |
| rfc_message_id | **0/7,289** | column exists since 2026-09-29 (commit 8acf372) |
| in_reply_to | **0/7,289** | since 2026-09-29 (commit 0ee39f6) |
| reference_ids | **0/7,289** | since 2026-09-29 (commit 0ee39f6) |
| cc_addresses | **0/7,289** | since 2026-10-22 21:43 -0400 = 2026-10-23T01:43Z (commit 94b91ce), about 2 min before taken_at |
| attachment_names | **0/7,289** | same commit as cc_addresses |

- **Since when.** Monthly counts by date_iso: 2026-07: 323, 2026-08: 1,551, 2026-09: 2,833, 2026-10 (to the 22nd): 2,492. Before July there are 90 rows in total, all quoted history delivered with whole threads. By first_seen_at: Aug 1,861, Sep 2,716, Oct 2,712. Capture started on 2026-08-23, and the 1,355 rows first seen that day match the "1,354 actual messages" noted at threadMessagesDb.ts:6-7.
- **Capture latency.** For the 5,857 rows dated on or after 2026-08-24, the gap from date_iso to first_seen_at is p50 1 min, p90 4,339 min and p99 21,283 min, with 8 negative. Older messages in a thread are first seen when n8n re-posts the whole thread.
- **Thread opener.** The message whose Gmail id equals the thread id is stored for 1,086 of 1,279 threads.
- **Headers are not kept.** The reply-chain columns have existed for 24 days and are filled in 0 rows. `messagesFromPayload` reads those headers only when the payload carries them (threadMessagesDb.ts:239), and none of the stored deliveries did. No other place holds them: only 20 bodies contain a literal "Message-ID:" line.
- **Cc.** You cannot tell Cc from To in the stored rows. `rowFromGmail` (the poller path) merges Cc into `to_addresses` (threadMessagesDb.ts:124), `messagesFromPayload` (the n8n path) does not (:253), and no row records which path stored it.
- **Quoted text.** Bodies are full text including the quoted history. Counts of each marker among the 7,289 bodies:
  - any marker: 5,892 (outbound 3,460/3,775, inbound 2,432/3,514)
  - lines starting with `>`: 4,224
  - `On … wrote:`: 5,791
  - an underscore separator line of 20 or more: 880
  - `-----Original Message-----`: 19
  - an Outlook `From:` / `Sent:` block: 10

  Of the 5,847 "Re:" subjects, 5,790 carry a marker. No column holds the newest text on its own.
- **Attachments.** There are no attachment names (0/7,289). Two weaker proxies sit in the body text: an inline `[image: …]` placeholder in 4,365 bodies, and a .pdf, .xls(x), .doc(x) or .csv filename in 891. These are mentions in the text, not attachments.

## 1.2 Outbound mail (our own messages)

- **Kept: yes.** 3,775 of 7,289 rows (51.8%) have is_from_spartan = true, all from the spartancrew.co.uk domain and 12 distinct addresses. 3,617 come from the shared bookings mailbox, 49 from accounts, 29 from info, 3 from crew and 77 from personal staff mailboxes. 994 of 1,279 threads have at least one outbound row. 1,580 outbound rows fall in the window. Subjects: 3,436 of 3,775 start "Re:" and 81 start "Fw:".
- **R or J in the subject:**
  - all outbound: R 182/3,775, and 181 of those R values are real order numbers in orders.json; J 3/3,775 (3 real job ids); R or J 184/3,775 (4.9%)
  - outbound in the window: R or J 96/1,580 (6.1%)
  - by month, outbound subjects with an R: Aug 35, Sep 69, Oct 78
  - per thread: 59 of the 994 threads with outbound mail have at least one outbound subject with an R or J. Counting any message's subject, 65 of 1,279 threads carry an R-like token.
  - inbound subjects for comparison: R 157/3,514, all real order numbers; J 3
  - R in the first 4,000 body characters: outbound 120, inbound 127
- **Drafts.** No column marks a draft. The n8n sweep path stores messages without label information, so it cannot drop a draft (threadMessagesDb.ts:185-188). How many of the 3,775 are unsent drafts cannot be measured from the snapshot (§5).

## 1.3 `inbound_raw`: not in the snapshot

Schema (app/lib/inboundRawDb.ts:35-50): id BIGSERIAL, dedup_key UNIQUE, source, thread_id, message_id, payload JSONB (now emptied, :46-48), received_at, message_ids TEXT[], envelope JSONB (the payload without `messages`). It records each delivery, and the mail itself goes to thread_messages (:1-13). scripts/gold/snapshot.mts reads only thread_messages, v2_decisions, tickets and job_links from Postgres (:29-42), so **no count, date range or envelope fill rate can be given offline** (§5).

## 1.4 OnSinch orders (snapshot: orders.json, 3,500 rows)

- **What the snapshot covers.** These are the newest 3,500 orders the API returned (snapshot.mts:20, :49), created 2025-07-14T10:15:40Z..2026-10-22T17:01:26Z. Order ids run 5,467..16,904 and numbers (the R number, 4 or 5 digits) 4,422..11,824. **Any count per company covers that window, not all time.** Deleted orders do not come back: 0 of the 199 ids in "Order delete" audit rows are in orders.json.
- **Order fields (filled/3,500).** Always filled: id, company_id, user_id, agency_invoice_address_id, name, number, status, quote, provisional, reverse_charge, happening, created, modified, creator, modifier. Sometimes filled:
  - intern_name (PO or client reference): 2,394
  - order_manager_id: 687
  - begin_date: 257
  - specification: 139
  - request_approval: 21, of which 20 were created by the bot user 2257
  - editors: 1
  - Job: 3,486. 3,435 orders have 1 job, 14 have none, 51 have 2 or more.
  - name containing " @ " (the `<Company> @ <Venue>` convention, resolve.ts:530): 3,377
  - creator = bot 2257: 20
- **Nested records.** Job 3,554 (min_beginning/max_end filled on 2,995; the repo CLAUDE.md says they can be stale). SlotTeam 7,313: admin_closed_time 5,798, client_modified 845, client_note 144. Slot 11,971: beginning and end 11,971/11,971, cancelled flag, size, profession_id, approved 1,941. SlotLocation 11,971, exactly one per slot, holding place_id.
- **Status × provisional × quote.** "Shift after the snapshot" means the order's last shift ends after taken_at.

| status/provisional/quote | orders | last shift ends after taken_at | has a confirm row |
|---|---|---|---|
| -2 / no / no | 2,815 | 0 (2,812 past, 3 with no shifts) | 440 |
| -1 / provisional / no | 405 | 12 | 1 |
| -1 / no / no | 81 | 1 | 12 |
| -1 / provisional / quote | 50 | 3 | 0 |
| -1 / no / quote | 21 | 2 | 0 |
| 0 / no / no | 75 | 64 | 45 |
| 0 / provisional / no | 36 | 36 | 2 |
| 0 / provisional / quote | 9 | 9 | 0 |
| 0 / no / quote | 8 | 8 | 0 |

- **Checking the code's status meanings against the data:**
  - -1 means cancelled. 199 of the 204 order_cancel rows point at orders now at -1.
  - -2 means closed. 0 of 2,815 have a shift after the snapshot, and 2,770 of 2,815 have every SlotTeam admin-closed.
  - 0 means open. 117 of 128 have a shift after the snapshot.
- **To Confirm.** No order field carries it. Take the 75 open orders that are neither provisional nor a quote: 45 have an order_confirm_provisional row and 30 do not, and their status, provisional and quote values are the same. That matches app/lib/engine/format.ts:11-24: orders seen sitting in To Confirm read back `provisional: false, quote: false`. Most provisional orders end up cancelled (455 of 500 are now -1).
- **Timestamps.** Order `created` and `modified` are present on 3,500/3,500. `happening` equals the first shift's beginning for 3,483 of the 3,483 orders that have shifts. Shift beginning and end are present on every slot. Slot `approved` is filled on 1,941 of 11,971.
- **Places.** All 11,971 slot place_ids resolve in places.json (2,614 places, 2,480 active, 2,299 with lat/lng). Distinct places per order: 1 for 3,364, 2 for 103, 3 or more for 16, 0 for 17. "No Location" is place 6922, the only place with that name, and 0 of 11,971 slots use it.

## 1.5 Staff actions: OnSinch audit (snapshot: timeline.json, 39,467 rows)

- Range 2026-07-29T08:07:06Z..2026-10-22T22:51:01Z. Only 8 actions were fetched (snapshot.mts:57). Counts:
  - common_change: 24,853
  - common_create: 8,443
  - common_delete: 2,707
  - order_created_via_api: 1,864
  - order_create: 829
  - order_confirm_provisional: 519
  - order_cancel: 204
  - order_create_by_copy: 48
- **Who.** 35,651 of 39,467 rows come from a person (46 distinct users). 2,238 come from the bot (all 1,864 order_created_via_api, plus 244 common_create, 120 common_change and 10 order_create). 1,578 have a null creator. Every row has a `created` timestamp with seconds and an offset.
- **Payload** (`data`, a JSON string that parses on 39,467/39,467):
  - `{id, model, diffChanges, name?}` for common_change. Models: Slot 16,158, SlotTeam 5,094, Job 1,352, Order 1,151, Attendance 898, TransportsTrip 193, Contract 7.
  - `{id, model, name, created, data:{quote, number, path:"Order:<id>"}}` for order_create.
  - `{id, name, model}` for confirm and cancel.
- **The fields changed most often:** Slot.hidden 5,521, SlotTeam.description 3,027, Slot.status 2,465, Slot.end 1,829, Slot.beginning 1,418, Slot.size 1,315, Slot.cancelled 679, Order.intern_name 598, Order.name 445, Order.provisional 223 (157 from 0 to 1, 66 from 1 to 0), Order.user_id 26.
- **Is confirming a To Confirm order logged and timestamped? Yes.**
  - 519 order_confirm_provisional rows cover 500 distinct orders. All 519 carry `created`. The creator is a person on 465 and null on 54, never the bot.
  - `data.id` is the order **number**: 519 of 519 match orders.number, and 25 of them also happen to equal some order's id. The row carries no before or after values.
  - Only 18 of 519 fall within 2 minutes of an Order.provisional change on the same order. A confirmation is its own audit row, not a flag change.
  - Time from order creation to confirmation (519 rows): p10 0.4 h, p50 15.4 h, p90 186.4 h, none negative.
  - 824 orders were created on or after 2026-07-29, and 487 of them have a confirm row.
- **Orders made through the API.** There are 1,864 order_created_via_api rows. Only 6 of those order ids are in orders.json, and the fetched actions log only 199 Order deletes, so 1,858 orders the bot created are missing from the order snapshot. 28 of the 1,864 are named "SIM …". Whether they were deleted through an action outside the 8 fetched cannot be seen.

## 1.6 `v2_decisions` (snapshot: decisions.json 847 rows; readings.json 724 rows)

Schema: app/lib/v2/process.ts:54-67. `company_id` and `company` were added in 1c64485 (2026-10-10).

- Range: created_at 2026-10-09T10:07:34Z..2026-10-22T20:06:51Z. sent_at runs back to 2024-02-07.
- kind: none 571, handoff 207, write 69. `decision.reason` / `reasons` is free prose: "no change asked for…" 427, "not a client's email" 53, "read together with the…" 49, "already booked: R#…" 24. The codes are derived by regex (reasons.ts:38).
- Fill: company_id 653/847 (all 653 resolve in companies.json), executed 52/847, code_version 707/847 (140 null).
- readings: 724 rows, each with `extraction` {po, note, intent, requests; order 465; company 457}. 724 of 724 are in decisions.
- Of the 705 client emails dated since the first decision, 704 have a decision row.

## 1.7 `job_links` (snapshot: links.json, 435 rows)

Schema: app/lib/v2/links.ts:37-41. The key is (thread_id, order_id).

- 435 rows, 434 threads, 414 orders. first_seen 2026-10-13T13:45Z..2026-10-22T17:02Z.
- state: linked 249, gone 178, relinked 6, held 2.
- source: jobs board 355, bot write 28, planner find 22, finder 20, staff copy 6, backfill 2, planner 2.
- r_number, job_id, company_id and shifts are filled on 257 of 435. All 178 rows with a null r_number are "gone" (note "its job is…").
- Only 1 thread has more than one link that is not gone.

## 1.8 The other sources

- **companies.json, 811 companies** (status 1: 810).
  - Contacts: 1,372, of which 1,369 have an email. 5 companies have no contact.
  - Contact domains other than free mail and Spartan: 749. 724 of them map to exactly 1 company and 25 to 2 or more.
  - 54 contacts use free mail and 7 a Spartan address. Of 1,349 distinct contact addresses, 19 sit on 2 or more companies.
  - email_invoice is filled on 582 of 811, www on 283 of 811.
- **places.json:** 2,614 rows (§1.4).
- **professions.json:** 45 rows.
- **tickets.json (the legacy engine):** 917 rows created 2026-07-29..2026-10-07 (ticketsDb.ts:30). onsinch_order_id is filled on 448.
- **truth.jsonl:** 3,145 labels made by scripts/gold/truth.mts from staff actions. Kinds: existing 1,726, no-order-signal 819, new-job 446, several 127, unsure 14, not-a-job 13.
- **data/gold/adjudications.jsonl:** 147 hand adjudications (link 92, new 28, unsure 14, none 13).
- **Tables in code with no snapshot:** order_records (orderRecordsDb.ts:117), order_archive (orderArchiveDb.ts:43), message_ledger (messageLedgerDb.ts:44), sender_ledger and sender_ledger_threads (senderLedgerDb.ts:48, :113), entity_aliases (aliasesDb.ts:47), ticket_events (ticketsDb.ts:80).

---

# 2. How they join (the keys)

| from | key | to | rate in the snapshot |
|---|---|---|---|
| decisions.message_id | = | messages.message_id (Gmail id) | 847/847 |
| decisions.thread_id | = | messages.thread_id | 847/847 |
| readings.message_id | = | decisions.message_id | 724/724 |
| truth / adjudications.message_id | = | messages.message_id | 3,145/3,145 · 147/147 |
| links.thread_id | = | messages.thread_id | 435/435 |
| links.order_id | = | orders.id | 279/435 (linked 249/249, relinked 6/6, gone 24/178, held 0/2) |
| links.r_number | = | orders.number of that order | 255/255 where both are present |
| links.job_id | ∈ | that order's Job[].id | 255/255 |
| links.company_id | = | that order's company_id | 255/255 |
| tickets.thread_id | = | messages.thread_id | 917/917 |
| tickets.onsinch_order_id | = | orders.id | 274/448 |
| orders.company_id | = | companies.id | 3,500/3,500 |
| orders.user_id | = | companies.Client[].id (the contact person) | 3,498/3,500. The contact sits on the order's own company for 3,355 of 3,498. |
| Slot.SlotLocation.place_id | = | places.id | 11,971/11,971 |
| sender address | = | companies.Client[].email or email_invoice (exact) / domain | §3 |
| subject or body R number | = | orders.number | outbound subject R: 181/182 real; inbound 157/157 |
| J number | = | orders.Job[].id | 3 outbound + 3 inbound subjects |
| messages.in_reply_to / reference_ids | → | messages.rfc_message_id | **cannot be used: 0/7,289 filled** |
| timeline order_create / order_create_by_copy `data.id` | = | **orders.id** | 818/829 order_create |
| timeline order_confirm_provisional / order_cancel / common_change(model Order) `data.id` | = | **orders.number** (not the id) | confirm 519/519; cancel 204/204; change 1,145/1,151 |
| timeline common_change Slot / SlotTeam / Job `data.id` | = | that record's own id | 14,287/16,158 · 4,642/5,094 · 1,331/1,352 |
| timeline common_create Job/SlotTeam/Slot `data.data.path` "Order:<id>" | = | orders.id | 6,975/6,975 carry it; 6,354/6,975 resolve |

Two traps in these keys. The audit names an order by its id in some actions and by its number in others, and the two ranges overlap (25 confirm numbers are also order ids; truth.mts:108-109 makes the same point). And the only thread key is Gmail's threadId: with no RFC headers, a reply that lands in a new Gmail thread cannot be tied back to its parent.

---

# 3. Sender to client (OnSinch company), client emails in the last 30 days

The window holds 2,986 messages: 1,580 outbound and 1,406 inbound. 1,319 of the inbound pass the client rule and 87 are filtered out. The 1,319 come from 257 distinct senders in 451 threads.

| step of `matchCompanyBySender` | emails | senders |
|---|---|---|
| domain has contacts on exactly 1 company | 1,147 | 195 |
| exact address, on a domain shared by 2+ companies | 24 | 5 |
| exact address, free-mail domain | 4 | 2 |
| **resolved to one company** | **1,175/1,319 (89.1%)** | **202/257 (78.6%)** |
| unresolved: domain on no company | 106 | 36 |
| unresolved: domain on 2 companies, address not exact | 23 | 9 |
| unresolved: free-mail address on no company | 15 | 10 |

- **The 144 unresolved emails.** By truth kind: no-order-signal 95, existing 35, several 5, new-job 3, no truth row 6. By v2 decision: none 55, handoff 20, not decided 69. The 55 unresolved senders sent 1 email (27 senders), 2 emails (9) or 3 to 9 emails (19).
- **Widening to the thread does not help.** I applied `companiesOf` (v2/threadState.ts:146) to every From and To that is not Spartan, on the thread up to each email, and added the sender rule. That gave exactly one company for 1,159 emails, 2 or more for 80 and none for 80. It resolves 28 emails the sender rule misses but makes 80 ambiguous, so it does worse as a single answer than the sender rule alone (1,159 against 1,175).
- **Agreement checks:**
  - **Against v2_decisions.company_id.** 772 of the 1,319 have a decision, and company_id is filled on 646 of those. My recompute equals the stored value 643 of 643 times. The decision has a company and the recompute none 3 times. The recompute has a company and the decision none 54 times (44 none, 10 handoff, created 10-09..10-22).
  - **Against truth.jsonl.** 702 emails are labelled "existing" with one order in the snapshot. The rule resolves 667. 659 of those match the order's company and 8 do not (4 through the domain step, 4 through an exact address on a shared domain). 35 are unresolved. *This is not an independent check:* truth.mts:153 draws its candidate companies from the same address and domain evidence. Across all dates the figures are 1,726 labelled, 1,653 resolved and 1,627 matching.
  - **Against the hand adjudications.** All dates, 55 of 147 in the window. Of the 92 "link" adjudications, the rule's company matches the adjudicated order's company 89 times, differs 0 times and gives no answer 3 times.

---

# 4. Orders per client (all statuses), for the clients who wrote in the window

112 distinct companies were resolved by the sender rule. Order counts come from orders.json: all statuses, orders created 2025-07-14..2026-10-22. History is cut off: 26 of the 112 companies have an order in the first 30 days after the snapshot's start, so their real all-time count is higher.

| orders per company | 0 | 1 | 2-5 | 6-10 | 11-25 | 26-50 | 51-100 | 101-250 | 251+ |
|---|---|---|---|---|---|---|---|---|---|
| companies (n=112) | 2 | 14 | 29 | 22 | 19 | 15 | 4 | 6 | 1 |
| resolved emails, weighted by their company's count (n=1,175) | 4 | 68 | 164 | 123 | 183 | 230 | 74 | 260 | 69 |

- **Per company:** median 7, p75 22, p90 48, max 288; 2,511 orders in total. By status: closed 2,068, cancelled 333, open 73, open provisional 37.
- **Per email:** median 27, p90 163.
- **Concentration.** The top 10 companies sent 496 of the 1,175 resolved emails. Listed as company id : emails : orders: 111:84:113, 324:73:40, 457:70:114, 137:69:288, 61:48:157, 218:36:59, 279:35:50, 128:30:196, 207:30:26, 267:21:22.
- **The live pool at email time.** For each email, these are the company's orders that are not cancelled as of the snapshot, were created before the email, and have at least one uncancelled shift on or after the email's day (Europe/London).

| live pool size | 0 | 1 | 2-5 | 6-10 | 11-25 | 26+ |
|---|---|---|---|---|---|---|
| resolved emails (n=1,175) | 243 | 338 | 399 | 169 | 26 | 0 |
| same, but with a shift within 60 days of the email | 247 | 346 | 431 | 125 | 26 | 0 |

The first row has median 2, p75 4, p90 7 and max 15. 581 of 1,175 emails (49.4%) have at most 1 candidate and 980 (83.4%) have at most 5. The 60-day row has median 1 and p90 6.

- **Ambiguous domains.** Each of the 23 emails from a domain shared by two companies has exactly 2 candidate companies. The two companies' orders together number 2 to 5 for 16 of those emails, 6 to 10 for 3 and 26 to 50 for 4.

Taken together: the client is a lookup for 89% of emails, and the order is a ranking over 2 to 15 live orders, not over the email-weighted median of 27 orders in all statuses.

---

# 5. BLOCKED: cannot be answered from the snapshot

1. **inbound_raw.** It is not in the snapshot (snapshot.mts:29-42). Its row count, received_at range, `source` mix, envelope keys and the fill of `message_ids` need a read-only SELECT on production.
2. **Drafts among the 3,775 outbound rows.** No label or draft column exists, and the n8n sweep path cannot see drafts (threadMessagesDb.ts:185-188). Measuring it needs Gmail labels per message id.
3. **A To Confirm field in OnSinch.** The API record in the snapshot does not separate confirmed from unconfirmed open orders (§1.4). Whether some other endpoint or field does needs a live read.
4. **Audit actions outside the 8 fetched.** For example, how the 1,858 missing API-created orders disappeared.
5. **The reply chain.** In-Reply-To, References and Message-ID are 0/7,289 in the snapshot. Coverage after 94b91ce, and the fillHeaders backfill, can only be measured on a later snapshot.
6. **Tables never snapshotted:** order_records, order_archive, message_ledger, sender_ledger(_threads), entity_aliases, ticket_events.
