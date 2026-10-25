# Glossary check: OPERATING.md §3 against code and data, and §17 Q1

- Agent: glossary-verifier
- Brief hash: bb818e87
- UTC: 2026-10-25T00:31:46Z (box clock, `date -u`)
- Inputs: branch v2 at 6a98170; snapshot `.tmp-data/gold/` (meta.json `taken_at` 2026-10-23T01:45:22Z; timeline from 2026-07-29). Read only. No network, no model calls. Scratch scripts were deleted afterwards.

## Summary (one page)

**Terms.** Three of the ten §3 terms match the code: Client, Sender and Change, each with a caveat. Display matches, but the Gmail labels act as a second display. Six terms differ from §3:

- **Opportunity** has no entity in the code. The set an email can refer to is the client's OnSinch orders, cancelled ones excluded.
- **Order** is not a draft stage. An OnSinch order is the booking at every stage: 2,815 of 3,500 snapshot orders have status -2.
- **Job** is not "a booked opp". It is a child record that every order gets when it is created: 3,435 of 3,500 orders have exactly one Job, and 3,477 of 3,486 got their first Job within 60 s of the order.
  - The draft-to-booked step that §3 describes does exist in OnSinch. It is a flag on the same order (`provisional`, cleared by the `order_confirm_provisional` action), and the order id does not change.
- **Inquiry** has no explicit class in v2. It is implied by the decision kind: 571 of 847 decisions are `none`.
- **Item** covers more than proposals waiting for a confirm. The TV also lists orders the bot already wrote ("check to verify") and "Needs reply" items.
- **Confirm** on the TV is a tick that only records who and when (check.ts:1-6). New orders are approved inside OnSinch, in Orders To Confirm. Edits have no confirm step at all.

**Q1. Must a person confirm?**

- **New orders: yes, as the code stands.** Every bot create sends `request_approval: true` and lands in OnSinch's Orders To Confirm (apiCreate.ts:2-8, :92). v2 has no other create path. `request_approval` cannot be changed after the order is created (docs/RESTART-PLAN-2026-09-29.md:20-23).
  - Two owner rulings are recorded in the repo: 2026-08-18, "To Confirm is already a human gate" (engine/pipeline.ts:435-441), and 2026-09-29, "no orders awaiting a confirm click, and none sent through" (RESTART-PLAN:61-63).
  - Nothing I read records whether the owner would allow booking directly when the system is confident. That part of Q1 stays open.
- **Edits to existing orders: no confirmation.** The bot writes them live through the staff screens whenever both the Settings switch and `SPARTAN_WRITES=live` are on (process.ts:33-36, run.ts:206-218). The TV then shows "Order was updated, check to verify" (feed/v2.ts:88).
  - The snapshot has 20 verified edit operations, on 10 distinct staff-made orders.
- **To Confirm in practice: staff almost never confirm the bot's orders.**
  - Of the 1,864 API-created orders (creator 2257) in the window, 4 ever got `order_confirm_provisional`. Users 413 (three) and 110 (one) confirmed them, after 0.6, 4.5, 93.9 and 259.0 hours.
  - v2's own real-client creates: 1 of 21 was confirmed (#16607/R11552, by user 413, 4.5 h after it was made). 11 of 21 were deleted by users 102 (six), 573 (three) and 110 (two), at a median of 2.0 h. The other 9 are absent from the snapshot with no delete row.
- **Staff confirm their own orders far more often.** 483 of 819 staff-made orders (59.0%) got `order_confirm_provisional`.
  - Delay from creation: median 6.6 h (p25 1.3 h, p75 47.1 h, p90 141.8 h).
  - By user id: 413 (221), 102 (108), null (47), 573 (26), 414 (25), 110 (24), others (32).
  - 481 of 483 confirmed orders now read `provisional=false`. 157 of 335 never-confirmed orders still read `provisional=true`.
  - The code says staff wizard orders never sit in To Confirm (apiCreate.ts:5-7; engine/format.ts:13-15). So OnSinch's "confirm" mostly firms up staff's own provisional bookings; it is not an approval of automation. Whether "To Confirm" and "provisional" are the same OnSinch list is contradicted inside the repo (see Q1 detail).
- **Join trap.** `order_confirm_provisional` names the order by its NUMBER, and OnSinch reuses numbers: 292 of 1,159 numbers in create rows went to more than one order in the window. A plain number join reports 614 confirmed API orders where the true figure is 4.

**Decision set.** The code makes the five §3 decisions, with these differences:

- The order differs: the client is resolved before the email is read, because the reader's context is the client's bookings.
- Step 1 has no explicit inquiry/not-inquiry output. A filter and the intent `info_only` both end in `none`.
- Step 3 picks exactly one existing order per change. Several matching orders go to a person; they are never acted on as a set.
- Step 5 has three outcomes, `write | handoff(reply?) | none`, but `write` runs at once when writes are on. No state means "ready, waiting for a confirm".

---

## 1. Terms: code, data, discrepancies

Counts are over the snapshot unless stated. `orders.json` holds the newest 3,500 OnSinch orders (scripts/gold/snapshot.mts:48-49). `timeline.json` holds 39,467 audit rows of 8 actions from 2026-07-29 (snapshot.mts:57).

| §3 term | In code | In data | Discrepancy with §3 |
|---|---|---|---|
| **Client** | OnSinch company. `World.companies()` (plan.ts:25-26). Resolved by `matchCompanyBySender` (engine/resolve.ts:113-127), then the thread's linked order's company (process.ts:418-426; plan.ts:481-482), then the evidence finder's order (plan.ts:483-485). Stored as `v2_decisions.company_id/company` (process.ts:67). The bot may create a client from a name (plan.ts:489-499; apiCreate.ts:106-112). | companies.json: 811 companies. orders.json `company_id` covers 407 companies. 653 of 794 client-email decisions carry a `company_id`. | Matches §3. **Naming clash:** OnSinch's own `Client` relation is a contact PERSON on a company (`company.Client[]` with keys id, email, name, surname, phone...; read as "contacts" at apiCreate.ts:49). An order's `user_id` is one of those contacts on 3,484 of 3,500 orders. |
| **Sender** | `thread_messages.from_address` (threadMessagesDb.ts:37-48). Normalised by `addr()` (process.ts:163). Stored as `v2_decisions.from_address` (process.ts:53-65). Our own mail is excluded by `is_from_spartan` or the `NOT_CLIENT` regex (process.ts:161, :361). | 187 distinct senders over 794 client-email decisions. 152 resolve to one company against the snapshot, 35 to none. Of 90 companies with a resolved sender, 31 have two or more (max 12). Contacts per company: median 1, p90 3, max 16. | Many senders per client: matches. **Multi-client senders:** the code does not serve them. The resolver works by DOMAIN first (resolve.ts:114-115, 79-93) and abstains when a domain or exact address sits on more than one company (resolve.ts:92, :122). That ends in handoff "no single client company" (plan.ts:500) unless the thread link or the finder names the company. Data: 19 of 1,349 contact emails and 25 of 749 business domains sit on more than one company; 8 of 187 senders have such a domain, and 5 of those resolve by exact address. |
| **Opportunity** | No entity of that name (no `opportunit` in app/lib). The candidate set is the client's newest ≤1,000 orders, read 100 a page up to 10 pages (process.ts:91-101), plus an evidence pool over up to 4 companies (plan.ts:219-225). Cancelled orders (status -1) are excluded (plan.ts:235, :454, :728; threadState.ts:58). | Threads link to opps through job_links (links.json: 435 rows, states linked 249 / gone 178 / relinked 6 / held 2). | §3 "any order or job": in OnSinch a job sits inside an order, so the universe is orders only. Jobs are never searched on their own, and cancelled orders are outside the universe. |
| **Order** | OnSinch Order → Job → SlotTeam (code: "shift") → Slot (code: "position") (plan.ts:82-85; run.ts:43-45; ops.ts:11, :28). R number = `order.number` (links.ts:49-53). Created by `create_order` (ops.ts:31; plan.ts:834) through the API with `request_approval: true` (apiCreate.ts:92). | 3,500 orders: status -2 2,815, -1 557, 0 128. `provisional` true on 500, `quote` true on 88. In the window, staff made 819 orders (`order_create`, creator ≠ 2257) and v2 made 21 for real clients (decisions.json, verified/mismatch creates with an order id). | §3: "draft-stage, not yet booked, created from an inquiry". In code and data an order is the booking at EVERY stage. Draft-ness is a flag on the same record (`provisional`, `quote`, `request_approval`). The repo calls `provisional` "a draft, not a live booking" (components/JobsScreen.tsx:415). Most orders are made by staff by hand, not by the system from an inquiry. |
| **Job** | OnSinch Job, a child of Order (`Job.order_id`), made together with the order (apiCreate.ts:95; create rows record `"Job":1`). J number = Job id (links.ts:49-53; feed/v2.ts:148; feed/verify.ts:212). | 3,435 of 3,500 orders have exactly one Job (0: 14; 2 or more: 51). First Job created within 60 s of its order: 3,477 of 3,486. Create rows with Job:1: 2,692 of 2,693. Every `job_links.job_id` is a Job of its order (255 of 255). | **Strong discrepancy.** §3 makes a job a later stage ("an order becomes a job when confirmed"). In OnSinch it is a structural child that exists from creation. The draft→booked transition §3 means is `order_confirm_provisional`, which clears `provisional` on the same order id (docs/AMENDMENT-PLAN-2026-09-13.md:110-119; data in Q1 below). |
| **Inquiry** | No inquiry type in v2. Every inbound message gets a decision (process.ts:4-6). Non-client mail → none "not a client's email" (process.ts:192-202, :361-367). Reader intents `booking, change, cancellation, quote_request, info_only, unclear` (extract.ts:35). `info_only` without a PO → none "no change asked for" (plan.ts:476). | 847 decisions: none 571, handoff 207, write 69. Of the `none`: no change asked for 427, not a client 53, read together 49, already booked 24, already as asked 5, other 13. Reader intents over 724 readings: info_only 445, booking 107, change 77, quote_request 63, cancellation 18, unclear 14. The legacy tickets used a different definition: `is_client_inquiry` true on 550 of 917, including 290 `confirmation-only`. | Matches in spirit ("not every inbound email is an inquiry"). But no step outputs inquiry/not-inquiry; it is inferred from `kind`. A quote or question is handled (Needs reply) without being an order request (plan.ts:470-475). §3 has no word for it. |
| **Change / adjustment** | Request actions `change_times, change_crew, cancel_shift` (extract.ts:12; interpret.ts:34-35). New shifts on a named order become `add_shift` (plan.ts:655-704). A PO becomes `set_po` (plan.ts:837-849). Ops: `set_position_size, set_position_times, set_po, cancel_position, add_shift, add_position` (ops.ts:32-37). | Request actions over 724 readings: new_shift 308, change_times 58, change_crew 35, cancel_shift 29, other 7. Write ops over 69 write decisions: create_order 27, set_position_times 23, cancel_position 20, set_po 10, add_shift 10, set_position_size 7, add_position 2. | Matches. The code's change set is wider than §3 suggests: cancellations, POs, and new shifts added to an existing order all count as changes to that opp. |
| **Item** | `FeedItem` inside a per-thread `FeedCard` (feed/project.ts:87-115). Kinds `needs-created, needs-updated, created-check, updated-check, needs-reply` (project.ts:23, :51-57). Lanes reply/need/done (project.ts:25). Built from v2 decisions (feed/v2.ts:68-91, :102-112). A `none` decision gives no item (v2.ts:109). | Decision kinds that yield items: handoff 207 (34 flagged `reply`), write 69. Feed marks are not in the snapshot. | §3: "a proposed new order or change, awaiting confirm". In code an item is also an order the bot ALREADY wrote ("Order was created/updated, check to verify", project.ts:26-33, v2.ts:88), or a reply a person must write (v2.ts:90). Several items share one card per thread. Done items stay 24 h (project.ts:63). |
| **Confirm** | The TV tick: mark `checked` that "records who and when, and does NOTHING else — no OnSinch write" (feed/check.ts:1-6). Only order items can be ticked; `needs-reply` cannot (check.ts:15). Items also turn green without a tick, on `staff-edit`, `order-found` or `resolved` (project.ts:47-48). The legacy one-click confirm (app/api/confirm-order/route.ts:5-7) belongs to the paused engine; `app/lib/v2` and `app/lib/feed` never call it (grep `pending_order\|confirm-order\|confirmOrder`: 0 hits). | Ticks cannot be counted from the snapshot (`feed_marks` was not copied). OnSinch's own `order_confirm_provisional`: 519 events in the window, by user ids 413 (236), 102 (118), null (54), 414 (27), 110 (26), 573 (26), 2826 (15), others (17). | **Discrepancy.** Confirm is not "the team's only action" and does not approve anything. New orders are approved in OnSinch To Confirm; edits are never approved; the team also builds and edits orders by hand and writes replies. |
| **Display** | The TV, `app/lib/feed/` (v2.ts header: "OPS ARE TOLD ON THE TV", :4-11). Starts 2026-10-10 (project.ts:75). Gmail labels are derived from the TV's cards every minute (repo CLAUDE.md, "FOUR, AND ONLY FOUR order labels"). | — | Matches. The Gmail labels are a second staff-facing surface fed from the same cards. |

Code-comment conflicts that bear on these terms:

- run.ts:5 says "The API is used only to read". `create_order` is made through the API (run.ts:265-269, apiCreate.ts:127).
- engine/format.ts:33-34 says the owner's hand-raised UI order body carries `request_approval`. apiCreate.ts:5-7 says the staff wizard's input rejects `requestApproval`.

## 2. Q1: is human confirmation required?

### 2.1 New orders the bot creates

- **Code.** `createBody` hard-codes `request_approval: true` and never sets `provisional` or `quote` (apiCreate.ts:84-98, :92). The header says this is the only route to Orders To Confirm (apiCreate.ts:2-8). The writer runs every `create_order` through `apiCreateOrder` (run.ts:265-269).
  - The legacy engine hard-coded the same "business rule" (engine/types.ts:77; engine/format.ts:132; engine/compose.ts:430).
  - `request_approval` cannot be changed after the order is created (RESTART-PLAN:20-23). So no code path books a bot order straight into the live lists.
- **Gates before a create:**
  - the master switch: Settings `bot_writes_enabled` AND `SPARTAN_WRITES=live` (process.ts:28-36; paused.ts:26-33; SettingsScreen.tsx:182);
  - TEST 515 only while benched (run.ts:208);
  - the lead-time rule: a create is refused when the first day is ≤ `create_lead_days` (default 14) after the email (plan.ts:53-54, :770-775).
- **Owner rulings recorded in the repo.** I list these as written and do not reinterpret them.
  - engine/pipeline.ts:435-441 (2026-08-18): an order goes to OnSinch as To Confirm the moment it composes; "To Confirm is already a human gate".
  - RESTART-PLAN:61-63 (2026-09-29): "no orders awaiting a confirm click, and none sent through. Both directions refused." It names `request_approval` as the lever.
  - plan.ts:770-772 (2026-10-15): only orders more than two weeks out are created; "all updates still should be enabled".
- **Not found:** any statement on whether the system may book directly, without To Confirm, when it is confident.

### 2.2 Edits the bot makes to existing orders

- **Code.** There is no approval flag or queue. Every edit is written in the staff screens (run.ts:5, :305-370). The preflight refuses only for these reasons (run.ts:206-218):
  - the order or position is missing;
  - the position is cancelled;
  - bench mode (non-515 while benched);
  - a cut below the workers signed on (run.ts:71-82; per the owner on 2026-10-15, every other change is made, staffed positions included, run.ts:11-14).
- Shifts added to an existing order are exempt from the lead-time rule (plan.ts:770-772).
- After a write the TV shows "Order was updated, check to verify" (feed/v2.ts:88; project.ts:26-33). The tick changes nothing in OnSinch (check.ts:1-6).
- **Data.**
  - 37 edit ops were executed; 20 verified, on 10 distinct orders, all staff-made, none on TEST 515.
  - Of the 20, 2 were on orders confirmed before the edit, 7 on orders confirmed after it, and 11 on orders with no confirm event.
  - 8 of the 20 targets now read `status -1, provisional=true`.
- Execution by day:
  - 2026-10-12..20: writes ran (verified 29 decisions, blocked 20, mismatch 3);
  - 2026-10-09/10 and 2026-10-22: 17 write decisions were not executed.

### 2.3 How often To Confirm orders are confirmed, by whom, how fast

Method: `order_confirm_provisional.data.id` is the order NUMBER. 519 of 519 join to `orders.number`; 25 also collide with an order id. OnSinch reuses numbers, so each confirm is attributed to the latest create row with that number made at or before the confirm.

- 506 of 519 confirm events attribute to an order created in the window. The other 13 are orders made before 2026-07-29.
- A plain number join makes 614 API orders look confirmed. The time-aware join finds 4. It reproduces the 3 engine confirms in docs/AMENDMENT-PLAN-2026-09-13.md:116-118.

| Cohort (create rows in window) | Confirmed | Delay from create | Confirmed by (user id) |
|---|---|---|---|
| API creates, creator 2257: the only To Confirm route per apiCreate.ts:4-8 | 4 / 1,864 (0.2%). Non-test names: 4 / 1,516 | 0.6, 4.5, 93.9, 259.0 h | 413 ×3, 110 ×1 |
| ↳ v2 real-client creates (decisions.json) | 1 / 21 | 4.5 h (#16607/R11552) | 413 |
| Wizard creates by 2257 (v2 before the API path) | 0 / 10 | — | — |
| Staff `order_create` (creator ≠ 2257) | 483 / 819 (59.0%). Made >14 days before the snapshot end: 412 / 655 (62.9%) | median 6.6 h; p25 1.3; p75 47.1; p90 141.8; max 1,707 | 413: 221, 102: 108, null: 47, 573: 26, 414: 25, 110: 24, 2826: 15, 2850: 5, 1164: 4, 2714: 3, 101: 2, 2633: 2, 440: 1 |
| ↳ staff copies (`order_create_by_copy`) | 21 / 48 | median 20.0 h | 413: 15, 102: 4, 414: 2 |

Supporting facts:

- **What happened to v2's 21 real-client orders** (14 companies):
  - confirmed: 1;
  - `common_delete` row: 11, by user 102 ×6, 573 ×3, 110 ×2, at 0.0, 0.2, 0.2, 0.2, 0.9, 2.0, 5.5, 7.5, 25.4, 26.4 and 95.9 h after the decision;
  - absent from orders.json with no delete row: 9.
  - This matches the plan's "1 of 8 real bot orders adopted; 7 re-keyed by staff" (docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md:33).
- **Staff confirm their own orders.** For 180 of the 483 the confirmer is also the order's creator; 237 were confirmed by a different user; in 66 one side is null.
- **Confirm clears provisional.** 481 of 483 confirmed staff orders read `provisional=false` now. Of the 335 never confirmed and present, 157 read `provisional=true` (116 of them cancelled, status -1).
- **Staff also toggle the flag by hand.** Staff set `provisional` 0→1 by edit 157 times and 1→0 66 times (common_change rows on Order).
- **`request_approval` cannot measure approval.** It is absent from orders.json and "never clears" (scripts/adoption.mts:11; working plan:31). It is "1" on all 33 orders creator 2257 held on 2026-09-03 (engine/onsinch.ts:540).

### 2.4 What is still not settled (for Checkpoint A)

- **Whether "To Confirm" and "provisional" are one OnSinch list or two.** The repo contradicts itself:
  - provisional orders "never appear in To Confirm" (format.ts:13-15);
  - wizard orders go to "Opened orders" (apiCreate.ts:5-7);
  - yet staff orders get the same `order_confirm_provisional` action 59% of the time, and the one approved v2 order (#16607) got it too.
  - The question is open since AMENDMENT-PLAN:584-588 and needs OnSinch's UI to answer.
- **Whether the owner permits direct booking when the system is confident.** No ruling found.

## 3. The §3 decision set against what the code decides

| §3 step | What the code does | Difference |
|---|---|---|
| 1. Inquiry? | A filter on sender and our own mail gives none "not a client's email" (process.ts:161, :192-202, :361-367). Several new emails in one delivery are read as one; the earlier ones are recorded "read together" (process.ts:204-222). The reader's `info_only` without a PO gives none "no change asked for" (plan.ts:476). | No inquiry flag. The answer is the decision kind: 427 of 847 are "no change asked for", 53 not a client, 49 read together. |
| 2. Which client? | Resolved BEFORE the reader runs (process.ts:414 vs :435), because the reader's context is the client's bookings (process.ts:109-115). Then again in the planner (plan.ts:481-500). The planner checks quote/unclear/info intents before the client (plan.ts:470-476). | The order of steps 1-2 is mixed. A failure here is handoff `client_unknown` (12 of 847). A sender on several companies abstains instead of being served (row "Sender" above). |
| 3. Which existing opp? | `findOrder`: one R number in subject or text; else the evidence finder (link, R/J anywhere in the thread, PO/reference, day plus one more fact); else the thread's link (plan.ts:178-209). Never the day alone (plan.ts:185-186). New shifts go onto an order only by explicit reference (plan.ts:655-662). NONE → new order, unless already booked (plan.ts:710-749). | §3 allows "one or more of the client's opps". The code acts on exactly one order per change. Several give handoff: "the email names N orders" (plan.ts:193), "N of the client's orders have a shift on" (plan.ts:734), "new shifts for N existing bookings" (plan.ts:661). Only `none` "already booked" may name several (`found[]`, plan.ts:745-746). |
| 4. What is requested? | Reader requests (actions in extract.ts:12) grounded against the email's words (interpret.ts), planned into ops (ops.ts:30-37). All or nothing per email (plan.ts:5-6). | Matches. Grounding refusals are their own disposition: handoff `reading_unproven`, 69 of 847. |
| 5. Disposition | `Decision = write | handoff{reasons, reply?, order_id?} | none{reason, found?}` (plan.ts:41-50). Coded by family `reply_, policy_, booking_, request_, reading_, system_, none_` (reasons.ts:11-14, :19-44). `write` is executed at once when writes are on (process.ts:392-407). The TV maps write → created/updated-check, or needs-created/updated when not written; handoff → needs-reply or needs-created/updated (feed/v2.ts:88-91). | §3's "item confirm-ready" has no counterpart: a `write` is carried out, not held. "Needs-decision" splits into a reply to write (34 handoffs flagged `reply`) and an order a person must build. Later, outside the email's own decision: a card for a person becomes `none` "already booked" once staff have done it (plan.ts:248-280), and a re-plan becomes none "staff changed R… after the email" (plan.ts:259-262). An email never decided is claimed as a card by the minute sweep (process.ts:242-301). |

Codes the snapshot would carry under reasons.ts:

- The snapshot predates code stamping: 0 of 847 decisions carry a code. I applied `coded()` offline:
  - none_nothing_to_do 427, none_not_client 53, none_read_together 49, none_already_booked 24, none_already_as_asked 5;
  - write 69;
  - reading_unproven 69;
  - reply_detail_missing 29, reply_quote 15, reply_unclear 13;
  - policy_lead_days 13;
  - request_unsupported 12, request_inconsistent 2;
  - client_unknown 12;
  - booking_not_identified 6, booking_link_unreadable 4;
  - venue_not_identified 6;
  - system_failed 2;
  - partly_booked 1;
  - other 36.
- Of the 36 `other`: 21 begin "arrived with a later client message ... in one delivery", 9 begin "already as asked", and 6 are something else.

## 4. Limits of this check

- **The snapshot has no `request_approval` field.** orders.json keys: id, company_id, user_id, agency_invoice_address_id, order_manager_id, name, specification, number, status, quote, provisional, reverse_charge, happening, created, modified, creator, modifier, intern_name, Job. So To Confirm membership is taken from the code's claim (API create = To Confirm), not read per order.
- **The timeline has only 8 actions** (snapshot.mts:57): no `job_publish`, no approval action and no attendance rows. TV ticks (`feed_marks`) were not copied.
- **Create rows are missing for deleted orders.** 0 of the 199 Order-model `common_delete` rows has a create row, and 13 of v2's 21 creates have none. Cohort denominators built from create rows therefore leave out many deleted orders.
- **Old engine orders vs test traffic.** The August API bulk (1,603 rows, 634 on 2026-08-26) is mostly test traffic. Only names were used to separate it ("delete me", "SIM", "canary", "TEST"), which is approximate.

## 5. Reproducing the confirm attribution

```
node -e "const f=require('fs'),T=JSON.parse(f.readFileSync('.tmp-data/gold/timeline.json','utf8')).map(r=>({...r,d:JSON.parse(r.data),t:Date.parse(r.created)}));const C=T.filter(r=>/^order_create(d_via_api)?$/.test(r.action)).map(r=>({a:r.action,by:String(r.creator),n:String(r.d.data.number),id:String(r.d.id),t:r.t})),N=new Map;for(const c of C)(N.get(c.n)||N.set(c.n,[]).get(c.n)).push(c);const K=new Map;for(const r of T.filter(r=>r.action==='order_confirm_provisional')){const c=(N.get(String(r.d.id))||[]).filter(c=>c.t<=r.t).sort((a,b)=>b.t-a.t)[0];if(c&&!K.has(c.id))K.set(c.id,r);}for(const [k,s] of [['staff',c=>c.a==='order_create'&&c.by!=='2257'],['api',c=>c.a==='order_created_via_api']]){const x=C.filter(s),h=x.filter(c=>K.has(c.id));console.log(k,h.length+'/'+x.length);}"
```

Expected output: `staff 483/819`, `api 4/1864`.

Other figures:

- **Term counts:** `matchCompanyBySender` and `coded()` were run offline with tsx over companies.json, decisions.json, messages.json and readings.json.
- **v2 creates:** decisions.json, write decisions whose `executed[i].detail.order_id` is set for a `create_order` op (21 rows, none on company 515).
