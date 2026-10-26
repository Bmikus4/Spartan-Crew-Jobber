# Workflow and safety before automation (owner's item 6; item 7's clarification-draft question)

Orchestrator fork, 2026-10-26. Scope: decisions/2026-10-26-checkpoint-b-response.md items 6 and 7.
- Sources: code at 305bf84, which is the deployed revision; local snapshots .tmp-data/gold-1026 (timeline to 10-25 19:10Z;
  3,500 orders) and week-truth-orders.json; OnSinch's public help pages, cited inline.
- No production credentials and no OnSinch call were used. No crew, staff or client was contacted.
- Display-precision counts are in another fork's file.
- Execution failure modes are in eval/write-breakdown.md.

**Verified** means read in code or in the snapshot. **Inferred** means reasoned from documents or code comments and not
observed.

## 1. What exists today (verified in code)

**What a card is**
- One email thread's current planner answer becomes one card (v2.ts:102-160).
- Its kind (v2.ts:84-91):
  - a write that ran: `created-check` / `updated-check`;
  - a write not run: `needs-created` / `needs-updated`;
  - a handoff whose reasons are all reply reasons: `needs-reply`;
  - any other handoff: `needs-created` when the reading asks for new work and aims at no order, else `needs-updated`.
- **Gap.** `needs-updated` is used whenever the reading *aims at* an order (v2.ts:85), whether or not an order was found.
  A handoff naming no order still says "Order needs updated".
- Older needs on the thread that no later email answered ride on the same card (v2.ts:164-213, `rowsOnCard`).

**What the TV lists**
- Only cards holding a `needs-created`/`needs-updated` item (serve.ts:113-114, Ben 10-13).
- The system's own writes are counted, not listed (`done_by_system`, serve.ts:115).
- Reply needs are not listed.
- A "held" card, "Order not found in OnSinch", appears when a linked order is gone. It is drawn as `needs-updated`
  (serve.ts:119-125).

**What ticking does**

The tick is the "Confirm" button (LiveFeedScreen.tsx:220-232, 499-511). It does this:
- POST /api/feed/check → applyCheck (check.ts:44-53) → `feed_marks` row `mark='checked'`, recording who, when and the
  signer's name (marksDb.ts:62-69). Undo deletes it (marksDb.ts:72-76).
- check.ts:24-28 states the contract: **"It records who and when, and does NOTHING else — no OnSinch write, no email,
  no label."**
- Effects downstream:
  - the item turns green (project.ts:47-48, 355-360);
  - a green card wears no Gmail label (threadLabels.ts:48-50), so the next minute's sync strips Order Needs … and Needs
    Follow Up;
  - the card leaves the TV 24 h later (`DONE_DWELL_MS`, project.ts:63, 441).
- Only order items are tickable (check.ts:37). A reply cannot be ticked (check.ts:27).

**Acknowledge / approve / complete**
- **There is no "acknowledged" state** and no "approved" state on the v2 TV.
- The one tick means "a person has looked, and it is right" (check.ts:24). It stands in for seen, approved and done at once.
- "Done" is also reached with no person:
  - the verifier sees a staff edit (`staff-edit`);
  - an unbound need's order is found (`order-found`);
  - the thread stops yielding the need (`resolved`).

  All three are green marks (project.ts:47-48).
- The only approve that writes is the paused engine's Jobs Board `/api/confirm-order` (confirmOrder.ts:13-33), not the
  v2 TV.
- OnSinch's own approval is a person confirming a To Confirm order (`order_confirm_provisional`: 532 staff rows in the
  10-26 timeline). The tick does not do it.

**Gmail labels**
- Derived every minute from the same cards: n8n calls POST /api/bot/labels (labels/route.ts:24-68).
- Exactly one of the four order labels, by rank (threadLabels.ts:40-53).
- **Needs Follow Up** means an open card with no activity for 24 h (project.ts:472-475, order.ts:20-26).
  - Activity: any email either way, a system write, a tick or a staff edit.
  - It can only exist on a card that is shown, so **a silent miss can never get it**.

**How a card leaves**

| exit | rule | anything verified in OnSinch? |
|---|---|---|
| ticked, then 24 h | project.ts:441 | no |
| staff edit seen, then 24 h | verify.ts:397-410 | yes, an edit to any decision field (§2) |
| order found for an unbound need | verify.ts:296-320 | an order was found, not a change |
| thread no longer yields the need | project.ts:422-433 | no |
| job day passed | project.ts:417 | no: leaves open, every label removed (pipeline-trace-addendum G6) |
| undated and 14 d quiet | project.ts:69, 442 | no; counted as "older" |
| thread dismissed | project.ts:347 | no |

## 2. How a completed OnSinch change is verified today

**The bot's own write** (verified, run.ts):
- Ledger statuses: intent / blocked / submitted / unknown / verified / mismatch / failed (bot/db.ts:107-114).
  `unknown` is never retried (run.ts:7-9).
- After a save, the order is read back, and `mismatches()` checks the op's own fields (run.ts:85-110). For example:
  - a size reads the new value;
  - times equal the asked window;
  - an added shift holds exactly the asked positions.
- The audit log must show a bot row for the save, with no other field changed (`auditExtras`, run.ts:184-200; `finish`,
  run.ts:221-234).
- New positions must read back hidden from workers and not a draft (`stateProblems`, run.ts:111-122).
- **What "verified" proves:** OnSinch now holds what the bot planned. **What it does not prove:** that the plan was what
  the client asked or what staff would book. That is item_correctness. Writes complete the requested change 8 of 23 times
  (eval/item-correctness.md; cases in eval/write-breakdown.md).
- **A verified create is not a booking.** It sits in To Confirm (request_approval, apiCreate.ts:92) until staff confirm
  it. 1 of 21 bot creates was confirmed and 11 were deleted (checkpoint-A.md §6).

**Staff's own change** (verified, feed/verify.ts):
- The verifier runs read-only, once a minute (verify.ts:30-41).
- It marks `staff-edit` when either of these holds:
  - the timeline shows a non-engine edit to a "decision field" on the card's order after the email. The fields are PO,
    order name, date, block, crew, start, end, role and cancelled (verify.ts:55-59, 355-367);
  - the order's stamps show a staff edit or create since the email, or it holds every asked shift on staff-made blocks
    (verify.ts:376-398).
- The offline judge (score.ts `truthKeys` / `judge`; scripts/ops-truth.mts, week-review) compares staff's acts with the
  plan by value. It is measurement only and never touches the TV.

**Gaps (verified unless marked)**

| gap | consequence |
|---|---|
| A tick needs no OnSinch evidence (check.ts:26) | A card ticked with nothing changed in OnSinch reads Done and loses its labels. How often is unmeasured offline: the feed_marks rows are in production only. |
| `staff-edit` fires on an edit to any decision field (verify.ts:55-59) | A PO edit turns a crew-change card green. The edit is not compared with the request. |
| Only the card's bound or matched order is watched | A change staff made on another order, such as a rebuild, is seen only if the verifier's own finder picks it. 11 of its 83 finds named another order than the evidence finder (project.ts:352-353 comment, 10-21). |
| An unbound acceptance or handoff shows `needs-updated` with no target (v2.ts:85-91) | The label implies a resolved target. The owner has ruled this out for acceptances (decisions/2026-10-26). |
| A job-day exit removes the labels with no exit mark (project.ts:417) | A request nobody acted on vanishes. |
| Stale comment: verify.ts:14-15 says the timeline never records the API's edits | The 10-26 snapshot holds 2,238 rows by user 2257, 107 of them Slot edits, because the bot now writes through the staff screens (run.ts:5). Not a bug: changeOf filters the engine (verify.ts:73-74). |

## 3. Do edits, cancellations or new positions notify crew?

**OnSinch's public help pages:**
- OnSinch sends **automatic** notifications to staff members for, among others:
  - "Shift change: *Warning! Change of shift you attend*";
  - "Removed by admin";
  - "Added by admin";
  - "Invited to shift";
  - the applicant messages.

  Source: [help.onsinch.com/push-notifications](https://help.onsinch.com/push-notifications), the table "Automatic
  notifications and SMS content".
- Whether each is sent is set per agency: Settings → Notification settings, each one **ON / OFF / Optional(ON) /
  Optional(OFF)**. A user can change only the Optional ones ([help.onsinch.com/help/notification-settings](https://help.onsinch.com/help/notification-settings)).
- Automatic push is sent about 10 minutes late, "in case you correct your actions", in bulk within 15 minutes. With
  "smart channel", a worker not subscribed to push gets an SMS instead (push-notifications page).
- Email notifications to workers follow the same settings ([help.onsinch.com/help/communication](https://help.onsinch.com/help/communication)).

**This system's evidence** (verified):
- Ben, 10-15, in a code comment: "OnSinch tells them as it does for staff's edits" (run.ts:11-14). It is unmeasured.
- The paused engine refused staffed shrinks because finding out "costs a real signup on a real order, which may SMS a
  worker" (amendOrder.ts:560-563). That is a statement of risk, not a measurement.
- The bot writes through the staff screens as OnSinch user 2257 (run.ts:5, :204). Creates go through the API to To
  Confirm (apiCreate.ts:92).
- New positions are forced hidden from workers (run.ts:111-122). In the 10-26 snapshot, 5 of 30 positions on bot-made
  shifts read `hidden=false`; when or why is unknown.
- The audit timeline has **no notification, message or SMS rows**. Its models are only Slot, SlotTeam, Order, Job,
  Attendance (Tag changes only), TransportsAttendance, TransportsTrip and Contract (40,075 rows, 07-29..10-25).
  - `Slot.attendance_notified` is `false` on all 11,948 positions.
  - `SlotTeam.client_sent_sms_notify` is 1 on 1 of 7,311 shifts.
  - So notification cannot be measured from data we hold.
- Crew on positions is real for the bot's plans: 16 of the blocked writes in the 847 stored decisions were refused for
  signed-on crew (13) or workers on the position (3) (eval/iterations.md, iteration 5).

**Per action**

| action | expected crew effect | basis |
|---|---|---|
| time or size edit on a position with workers (`set_position_times`, `set_position_size` up or not below the workers) | "Shift change" notice to attending workers, **if** the agency has it ON | inferred: docs plus run.ts:11-14. OnSinch cannot tell the bot's browser edit from staff's. |
| cancel a position or cut below its workers | "Removed by admin", or a shift change, to those workers | inferred. **Refused as built** (run.ts:77-81, :216-217): the bot never does it. |
| new position or shift (`add_position`, `add_shift`) | none at creation: hidden and unassigned, nobody attends. A notice comes when staff later invite or add a worker. | inferred from hidden=true (run.ts:116-121) and the docs' trigger list |
| `set_po` | none to crew | inferred: no crew-facing field |
| `create_order` | none to crew: no positions are visible or assigned. **Unknown** whether OnSinch emails the client contact on an API create. | unverified |

**Settling it without contacting live crew.** In order of cost:
1. **Read only, $0, no write.** An admin (Ben or Paz) opens Settings → Notification settings and records the ON/OFF
   state of every staff-member notification, especially Shift change, Removed by admin and Added by admin, plus the
   client notifications on order create.
   - If Shift change is OFF, the T3 crew risk is gone.
   - If it is ON or Optional, step 2 is needed.
2. **A controlled test.** It writes to OnSinch, so it needs the owner's authorization while writes are off.
   - Setup: on TEST company 515 (bench mode allows only this, run.ts:207-211), make an order for a future date. Its one
     worker is a staff profile Spartan controls, with a test phone and email, assigned to a position.
   - Run `set_position_times`, then `set_position_size` up, then `add_position`, `add_shift` and `set_po`. The bot
     makes each, then a staff login makes the same edit as a control.
   - After each, wait 20 minutes. Record push, SMS and email received, with channel, delay and text.
   - A cancel or a cut of the worker is done only by the staff login, because the bot refuses it.
   - Pass condition: the per-action table above is replaced by observed rows.

## 4. Proposal (nothing here enables a write)

**What a card represents.** One outstanding piece of booking work on one thread. It always states:
- **target status**, one of:
  - `identified` (one order, R/J);
  - `candidates` (up to 3, none chosen);
  - `none found`;
  - `new booking`;
- **the request**, as structured fields from the client's words: day, window, crew per role, venue, PO;
- **what the system did** (nothing / proposed / wrote and verified).

The label comes from the target status. "Order Needs Updated" only when a target is identified. Otherwise the card says
"Find or confirm the order", per the owner's quote-acceptance direction; the wording is for Paz to confirm.

**States.** Each is a feed_marks row with who, when and why, so nothing new is needed in OnSinch:

| state | who | writes | OnSinch effect | leaves the TV? |
|---|---|---|---|---|
| open | system | `open` (exists) | none | no |
| acknowledged | a person: "I'm on it" | `ack` | none | no. Pauses Needs Follow Up for a stated time. |
| approved | a person, only on a system-proposed change | `approved` + the op_keys approved | **none while writes are off**. Later, under an enabled tier, it authorizes exactly those op_keys once. | no |
| completed (verified) | the system | `verified-done`, with evidence | read back: the target order holds the requested values, by a bot write (verified) or a staff edit on the requested fields | after the dwell |
| completed (claimed) | a person ticks "Done", and §2's check finds no matching change within N minutes | `checked` (exists) + `unverified` | none | stays amber, "Ticked, not seen in OnSinch", until the dwell; counted |
| held / rejected | a person, with a reason code: not booking work · wrong target · client to confirm · duplicate · other | `held` + reason | none | held: no, it waits for the client. rejected: yes. |

**What ticking should do.**
- Ticking should mean "I made this change in OnSinch". It starts a check:
  - the requested fields on the target order;
  - the order holds the requested shifts (holdsAll, verify.ts:154).
- Green only when the check passes. The tick is never the evidence itself.
- **"Not booking work" is a separate control with a reason.** Those reasons become a free label source for the eval set,
  as a recorded reject state (STATE.md memory: keep the data model able to hold rejected/held with a reason).

**The verifier change this implies.** `staff-edit` must match the request's fields and the target order, not any decision
field (verify.ts:55-59). A PO edit closes only a PO request.

**Automation tiers.** Candidates only. Each needs all of the following before it could be proposed for enabling:
1. Its failure modes listed from eval/write-breakdown.md.
2. Zero wrong-by-value cases in a labelled current-mail sample for that op kind, with completed rate and an exact
   interval reported.
3. Deterministic preconditions:
   - a target identified by a hard identifier (R/J number or the thread's own link) and exactly one order;
   - every value grounded in the client's words;
   - no workers affected below their count.
4. The Q3 answer for that action (§3).
5. A shadow period: planned ops beside staff's acts, nothing written.

**Model confidence is never a gate** (owner, 10-26).

| candidate tier | ops | known failure evidence | blocked on |
|---|---|---|---|
| T1 | `set_po` | 3 of 8 partial writes lacked a PO edit staff made, one a trailing space (item-correctness.md:156-159) | breakdown; a value check |
| T2 | `create_order` to To Confirm | 3 wrong compositions (item-correctness.md:149); staff rebuilt 14 of 16 bot creates (checkpoint-A.md) | why staff rebuilt (N4, through Paz); the composition fixes |
| T3 | `add_shift`, `add_position`, `set_position_times`, `set_position_size` (no cut below workers) | crew-chief composition 3, time values 2, a cancel where staff re-timed 1 (diagnostic-11-3.md) | Q3 step 1 or 2; the breakdown's per-class fixes |
| T4 | cancel or cut below workers | n/a | never enabled; refused as built |

**Writes stay off.** Nothing in this proposal changes production, the display, intake or outbound mail without the
owner's authorization.

## 5. The unfinished clarification-draft / Needs Follow Up workflow

**What exists** (verified):
- **v2:**
  - `draftContext` (app/lib/v2/draft.ts, 30 lines) turns a handoff's "no X the client wrote" reasons into questions:
    venue, date, start, finish, crew count (draft.ts:18-24). It writes as though the order is already made (Ben 10-11,
    draft.ts:4-8).
  - Its only caller is test/v2CrewDefault.ts. **No v2 path composes, stores or creates a draft.**
- **Paused engine:**
  - `createReplyDraft` makes a Gmail draft in the thread, to the parent's sender (deps.ts:398-445).
  - It is gated by `replies_enabled` (default false, types.ts:579). Sending also needs `reply_delivery="send"` and
    `SPARTAN_SEND_REPLIES=1` (pipeline.ts:715).
- **Follow-up board:**
  - The follow-up board (app/lib/followup/board.ts, clock.ts) is hidden unless `NEXT_PUBLIC_SPARTAN_FOLLOWUPS=1`
    (followup/enabled.ts:1-13).
  - When on, it feeds the TV's reply needs (live.ts:116, project.ts:509-530).
  - Production's value for this switch is not readable offline (Vercel env).
- **Needs Follow Up label:** the 24 h no-activity flag on shown cards only (§1).
- **History:**
  - "Rule 3", an ambiguous change getting a drafted question plus Needs Follow Up, was never built. Drafting was parked
    10-15 (history-and-assumptions.md:205, B25).
  - The OPERATING §9.6 auto-reply asks for a job number or address when no candidate clears the gate, there is no hard
    identifier, and the sender is a known client (OPERATING.md:430-436). It is authorized and stubbed, and **not built**:
    there is no v2 send path (history-and-assumptions.md:261, O01).
  - None of its guardrails exist in v2: no reply to auto-replies or bounces, one per thread, a per-sender rate limit,
    logging.

**Does it address the failures?**

| failure class | where, count | could a clarification draft help? |
|---|---|---|
| current reader reads "no change asked for" (`none_nothing_to_do`) | prospective, **4 of 4 misses** | **No.** The decision is none: no card, no handoff reason, nothing triggers a draft. The client already wrote the request; asking again would read as Spartan not reading its mail. |
| old reader, `none_nothing_to_do` | dev, 8 of the patch's 19 silent | No, as above |
| `none_read_together` (folded into a later email) | dev, 5 of 19 | No |
| `none_already_as_asked` | dev, 4 of 19 | No. The system believes it is done. |
| `request_unsupported` | dev, 1 of 19 | No. The system cannot make the change; staff must. |
| `booking_not_identified` | dev, 1 of 19 silent, and 18 listed cards at HEAD | **Yes.** This is exactly §9.6's job-number/address auto-reply, when the sender is a known client. It would shorten the time to a target, not create recall. |
| `client_unknown` | dev, 6 listed | No under §9.6's guardrail: the sender must be a known client sender |
| `reading_unproven` | dev, 18 listed | Rarely. The client wrote it and the system failed to ground it. draft.ts:10-13 asks only for what the client never wrote. |
| `reply_detail_missing` / `reply_unclear` | HEAD dev silent 9 + 3 | **Partly.** draftContext asks for exactly these details. But a draft does not make the booking need visible; the display rule does that, and it is held. |
| wrong op values (9 wrong writes: crew-chief composition, times, cancel vs re-time, create composition) | dev writes | **No.** The client was clear; the planner composed the wrong values. |

**Verdict.** The clarification-draft / Needs Follow Up workflow does not touch the failures that dominate current mail,
the 4 of 4 prospective misses, nor the execution failures (9 wrong, 6 partial). On dev it could help at most:
- the booking_not_identified listed cards (18), by speeding up target resolution;
- the reply-detail cases (12 at HEAD), as a companion to the display rule.

It should not be the next block on correctness grounds. If it is built later, it belongs after the §9.6 guardrails, and
it stays stubbed.

**Noted, out of scope.** eval/iterations.md:328 says the prompt changed on 10-20 and 10-23. The orchestrator's read-only
query of production rows shows `prompt_id extract@f3e1a862322b` unchanged since 10-13. One of the two needs correcting.
