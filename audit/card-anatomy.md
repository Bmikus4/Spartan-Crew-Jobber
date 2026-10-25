# Card anatomy: what a TV card shows staff, and what happens to it over time

- agent: card-anatomy
- brief hash: a4ae517a
- generated (UTC): 2026-10-25T21:44:28Z
- code: working copy at f084d53. `git diff --stat 6a98170 HEAD -- app` is empty, so the app code is the brief's 6a98170.
- data: `.tmp-data/gold/` (taken 2026-10-23T01:45:22Z). The snapshot has no `replan` column, no `feed_marks`, and no `interpretation` on decisions. Counts that need any of these are marked "not measurable".
- builds on: pipeline-trace.md §8 (new order, not an inquiry) and §9 (admission, the removal table). Those are cited, not redone. This file adds to them and corrects them where it says so.

## Summary

1. **What a listed card shows.** One row per thread (project.ts:476). Left to right:
   - the client's OnSinch company name;
   - one status badge, plus "Needs Reply" and "Needs Follow Up" badges when they apply;
   - one detail line: note · crew · venue · age;
   - the R number, the J number, the next job day, and a Confirm button (LiveFeedScreen.tsx:282-331).

   The tile draws only the card's **lead** item. Further needs on the same thread are not drawn (§1.3).
2. **Top-3 candidates: no.** No decision type carries a candidate list (plan.ts:41-50). The only stored list is `none.found`, and a `none` decision makes no card (v2.ts:109). Ambiguity reaches the tile only as a count, such as "2 orders that day, pick one" (cardNote.ts:45-46).
3. **Evidence for the pick: no.** R and J come only from the thread's link (v2.ts:143-148). The link is read without its `source` or `note` (live.ts:83-85). The planner keeps a hand-off's order id and drops how it found it (plan.ts:276-279). The green line on a closed card is evidence for the closure, not for the pick (LiveFeedScreen.tsx:82-95).
4. **The proposed change: partly.** It is one line of at most 80 characters (cardNote.ts:22, 151-155). It names the first request with "+N more", or the write's ops in words. Days appear only for "Move X to Y", "Cancel X" and "Shift added X". The tile adds the busiest crew count, the first venue and the next day.
5. **Why it needs a person: one phrase, no code.** A 39-entry regex table turns the first reason into fixed wording, plus "(+N more)" (cardNote.ts:31-76, 146-147). The reason code is read nowhere in the feed or the screen (grep `\.code\b`: 0 hits). A reason the table does not know becomes "Read the email". In the snapshot, 63 of the 152 non-reply hand-offs lead with it, and that includes all 13 lead-days hand-offs.
6. **Kind.** The badge reads "Order Needs Created" or "Order Needs Updated", in amber with a warning sign. Once green it reads "Order Created" or "Order Updated", in green with a tick, whatever closed it. That includes "Cleared by the system", where no order was made (LiveFeedScreen.tsx:153-159). Needs-reply appears only as a second badge beside a need. Bot writes (the checks) are never listed (serve.ts:109-116).
7. **Flagged vs confirm-ready: no visual difference.** Every tile wears the same red edge (LiveFeedScreen.tsx:51-52, 299). `card.colour` is computed (project.ts:480) but only hides R and J on neutral cards (LiveFeedScreen.tsx:287). Three kinds of card look the same: a hand-off, a write OnSinch refused, and a write that was planned but never run. They share the amber badge and the Confirm button; only the note text differs. With bot writes off (live-state-2026-10-24.md: `bot_writes_enabled: false`), every planned write is listed as a need: "Not written, do it by hand". Confirm never runs that write (check.ts:4).
8. **Aging today.**
   - 24 h with no activity: a "Needs Follow Up" badge (order.ts:26; project.ts:474).
   - 7 days with no activity: the card sinks under "Nothing New For 7+ Days" (order.ts:18; LiveFeedScreen.tsx:615).
   - Within 48 h of its start: the date turns amber (LiveFeedScreen.tsx:40, 176-180).

   A card leaves 24 h after going green (project.ts:63, 441). Otherwise it leaves silently once its last day has passed (project.ts:417). An undated card goes to a footer count 14 days after its own email (project.ts:69, 442).
9. **Six ways a card or need leaves without anyone seeing it go** (§3.6). Four are not in pipeline-trace §9:
   - a replan that turns a need into a needs-reply, which takes it off the list;
   - a need dropped from a thread that holds more than one need, which gets no `resolved` mark;
   - a need that resolves while no screen is polling, which never had an `open` mark;
   - a need overtaken by a newer verified write (dormant while writes are off).
10. **Status mapping.**
    - `confirm_ready` has no rendering. Verified writes are hidden, and unexecuted writes are drawn as flagged.
    - `flagged` is the listed needs.
    - `confirmed` is the `checked` mark, plus three automatic greens no person made.
    - `suppressed` is a `none` decision.
    - A reject or held state would be a new `feed_marks` mark kind. The table already keys on (item_key, mark) and carries `by` and `evidence` (marksDb.ts:27-35).

---

## 1. Fields: what a card shows, and where each comes from

### 1.1 Field by field (v2 cards; the paused engine's state draws nothing, live.ts:113)

| on screen | what it is | source |
|---|---|---|
| Name (30px, left) | `card.company`; else the subject in quotes, dimmer; else "Unknown client" | LiveFeedScreen.tsx:307-309. `company` = `v2_decisions.company` (v2.ts:150), the client resolved at decision time (process.ts:421-423, 514) |
| Status badge | "Order Needs Created / Updated" (amber, warning sign) or "Order Created / Updated" (green, tick) | `labelOf` LiveFeedScreen.tsx:153-159; `Badge` :161-173, :310. Kind from `classify` v2.ts:87-91 |
| "Needs Reply" badge | the card also holds a needs-reply item | LiveFeedScreen.tsx:311. Item from the follow-up board (project.ts:513-524) or a v2 reply hand-off kept beside a need (project.ts:446-447, 482) |
| "Needs Follow Up" badge | `card.follow_up` | LiveFeedScreen.tsx:312; project.ts:474, 498 |
| Detail line | `note · contact · "N crew" · venue · <age>`, one line, cut with an ellipsis | LiveFeedScreen.tsx:288-289, 314-317 |
| — note | the system's one line (§1.2); hidden once the card is green | cardNote.ts:133-156; v2.ts:107; LiveFeedScreen.tsx:288 |
| — contact | always null on v2 cards | v2.ts:151 |
| — crew | the largest crew of any request | v2.ts:118, 126, 154 |
| — venue | the first request's venue text | v2.ts:118, 152 |
| — age | "Xm / Xh / Xd ago" from the lead item's `at`, i.e. its email's `sent_at` | LiveFeedScreen.tsx:68-75, 317; v2.ts:108, 111 |
| Green evidence line (replaces the detail line) | "Confirmed by <first name> HH:MM" / "Changed in OnSinch by staff: … HH:MM" / "Already in OnSinch: every shift asked for" / "Order found in OnSinch, HH:MM" / "<resolved text>, HH:MM" | LiveFeedScreen.tsx:82-95, 315-316 |
| R column | `R` + the link's r_number | v2.ts:147; link read only when the thread links to exactly one live order (live.ts:83-86); blank on neutral cards (LiveFeedScreen.tsx:287, 292) |
| J column | `J` + the link's job_id | v2.ts:148; same read |
| Date column | the next day not yet past (else the first day): "Today", "Tomorrow" or the weekday over "d Mon"; "+N Days"; amber within 48 h; "Date / TBC" when undated | `When` LiveFeedScreen.tsx:199-217. Days are the requests' dates, the write ops' dates, and any day a reason calls "already over" (v2.ts:116-122) |
| Confirm button | "Confirm" (accent), "Confirmed" (green, undoable) or "Done" (green outline, inert) | `Tick` LiveFeedScreen.tsx:224-247 |

**Computed but never drawn:**
- `item.status` (STATUS_TEXT, project.ts:51-57). The only `status` on the screen is the ARIA role (LiveFeedScreen.tsx:262, 642).
- `order_id`, which is "for the verifier, never shown" (project.ts:104).
- The decision's own order (`c.order_id`, v2.ts:80).
- `want` (project.ts:153).
- `numbersOf`, which is defined and never called (LiveFeedScreen.tsx:186-189).

### 1.2 The brief's six questions

1. **The order it thinks the email is about.** It shows the link's order, not the decision's.
   - R and J come from `job_links` only (v2.ts:143-148). When a thread links to several orders, neither is shown (live.ts:81-84).
   - A hand-off's `order_id` (plan.ts:279) and a write's target (v2.ts:77-80) feed `card.order_id` for the verifier. They reach the screen only once the replan or the finder turns them into a link (replan.ts:123-133).
   - Snapshot: 111 threads have a need row since V2_FROM. 58 have exactly one live link, so R and J show. 53 have none, so both columns are blank. Command: `node -e` over decisions.json and links.json, with need = non-reply hand-off, or a write that is not fully verified, and link state `linked`/`relinked`.
2. **Alternative candidates (top-3).** None.
   - Decision shapes: write `{ops, why, defaults?}`, handoff `{reasons, reply?, order_id?}`, none `{reason, found?}` (plan.ts:41-50). The snapshot's 847 rows carry exactly these keys (none.found on 17).
   - The verifier ranks same-day orders by venue and shift times, but only to pick one or refuse (verify.ts:246-269). The planner's evidence finder returns one `ref` (plan.ts:198-202, 275-279).
   - Ambiguity is drawn as a count: "N orders that day, pick one", "N shifts that day, pick one", "N OnSinch venues called …", "The email names N orders" (cardNote.ts:44-46, 51).
3. **The evidence for the pick.** None.
   - `job_links.source` and `.note` exist (snapshot sources: jobs board 355, bot write 28, planner find 22, finder 20, staff copy 6, backfill 2, planner 2). The feed selects only `order_id, r_number, job_id` (live.ts:83-84).
   - `ref.by` (link, R/J number, PO, "the day and …") is used to accept or refuse a pick and is not stored (plan.ts:201, 276-279).
4. **The change the system proposes.**
   - Hand-off: `asked()` gives the first request only, plus "+N more" (cardNote.ts:92-111).
     - New booking: "New booking HH:MM-HH:MM, N <trade>". The trade appears only when it is not plain crew (:89, :100).
     - Times: "Move <day> to <day>", "Times to …", "Start to …" or "Finish to …" (:101-103).
     - Crew: "Add N", "Stand down N" or "Change to N crew" (:104-107).
     - "Cancel <day>" (:108).
   - Write: `wrote()` (cardNote.ts:114-129) gives:
     - "Booked HH:MM-HH:MM, <trades>, +N more shifts, PO …";
     - "Times now …" (no day);
     - "Shift added <day> …";
     - "Shift cancelled" or "Crew chief removed";
     - "N <trade> added";
     - "Now N crew";
     - "PO … added".
   - Days come from the date column. Crew is the busiest request's count; for a write it is the request's crew, not the op's size (v2.ts:118-119, 126). The venue is the request's text, not the resolved OnSinch place.
   - When the line passes 80 characters the description is cut first (cardNote.ts:152-155). The detail line is then cut again by the tile's width (LiveFeedScreen.tsx:314).
5. **The reason it needs a person.**
   - The text is the first check phrase plus "(+N more)" (cardNote.ts:146-147). On a write it is one of "Not written, do it by hand", "System couldn't write it, do it by hand" or "System stopped partway, check OnSinch" (cardNote.ts:140-143).
   - `Decision.code` (plan.ts:50; reasons.ts) is never read by app/lib/feed, the screen or threadLabels.ts (grep `\.code\b`: 0).
6. **The kind.**
   - The badge distinguishes Needs Created from Needs Updated by text only, not by colour (LiveFeedScreen.tsx:156-158).
   - needs-reply shows only as the second badge, because a reply-only card is not listed (serve.ts:109).
   - created-check and updated-check are never listed (serve.ts:109, 116).
   - A held link draws as "Order Needs Updated". Its kind is `needs-updated` (serve.ts:123), and its status text "Order not found in OnSinch" is never drawn.

### 1.3 Only the lead item is drawn

- A card holds every open need on its thread (v2.ts:164-189; project.ts:410-416, 482).
- The tile draws `orderItem(card)` = the first non-reply item (LiveFeedScreen.tsx:143, 283). The badge, Confirm and evidence line belong to that item; the note is the lead source's (project.ts:499).
- A second need on the same thread is invisible until the first goes green. It then becomes the lead (project.ts:446-447).

### 1.4 What the note says, measured (snapshot, decisions as recorded, today's phrase table)

| | count |
|---|---|
| hand-offs | 207 |
| — needs-reply (`reply` flag 34, or every reason a reply reason, v2.ts:45, 90): not listed | 55 |
| — need (listed) | 152 |
| need hand-offs whose first check is "Read the email" (no phrase matched) | 63 of 152 |
| need hand-offs whose checks include "Read the email" | 67 of 152 |
| need hand-offs with more than one check (tile shows "(+N more)") | 58 of 152 |
| next most common first checks | "Check the date: …" 22, "Check the crew count: …" 19, "New client, not in OnSinch: …" 12, "Check the start time: …" 9, "Which order? None named" 7, "Venue not in OnSinch: …" 5 |
| writes | 69: verified 29 (not listed), "System couldn't write it" 23, "Not written, do it by hand" 17 |

Reasons with no phrase, by source:
- "read them together", 21: older code, process.ts:207;
- "<start | end | duration | crew>: "…" is not in the email", 36: interpret.ts:126;
- "trade "…" is not …", 5: no current source found by grep, so older code;
- "a new booking from <day>, within N days", 13, all lead-days: plan.ts:775;
- "duration: … reads as", 13: cardNote.ts:39 knows only target start, start and end;
- "no words cancelling the whole shift", 13: interpret.ts:313;
- "not an operation the system performs", 7: interpret.ts:316;
- "the system could not plan this email", 2: process.ts:458.

How the table was run: the CHECKS entries (cardNote.ts:32-69) were evaluated in `node -e` over `.tmp-data/gold/decisions.json`. Reasons were split on "; ", as cardNote.ts:146 does. Caveat: these are the reasons recorded at the time. Replans may say otherwise, and the snapshot has no `replan` column.

---

## 2. Flagged vs confirm-ready

### 2.1 Every colour, lane and label on the screen

| element | values | meaning | file:line |
|---|---|---|---|
| Tile left edge | red, always | none: "no colour coding and no key" (code comment, 10-10). The comment at :55 still says "red/blue edge" | LiveFeedScreen.tsx:51-56, 299 |
| Tile background | surface; green tint | card.green | :297 |
| Status badge | amber with a warning triangle; green with a tick | open need / closed, or a system write | :153-173 |
| Confirm | accent fill "Confirm"; green fill "Confirmed"; green outline "Done" | open / a person ticked it (can undo) / closed by evidence (inert) | :63-64, 224-247 |
| Date | amber | starts within 48 h | :40, 176-180, 211-214 |
| Detail line | green text | evidence for the closure | :315-316 |
| Section header | "Nothing New For 7+ Days" (muted) | quiet cards, sunk | :615 |
| Section header | "Done N" (green) | the done lane | :619 |
| Footer | "N older undated enquiries … not shown" | the `older` count | :622-626 |
| Fold pill | "N more waiting below" | open tiles under the fold (the TV cannot scroll) | :534-545, 630-635 |
| Empty banner | green "Everything is checked." / "Nothing else waiting."; amber "Nothing listed, but the sync is not healthy." | | :607-611 |
| KPIs | Needs Reply (only if follow-ups are enabled), Needs Follow Up (amber), Within 48 Hours (amber, heavy) | counts | :562-567 |
| Sync icon | green / red / grey | synced / error / offline or intake paused | :250-270 |
| `card.colour` | red (needs-created, created-check), blue (needs-updated, updated-check, held), neutral (needs-reply) | computed; drawn only as "hide R/J when neutral" | project.ts:480; serve.ts:122; LiveFeedScreen.tsx:287 |
| `card.lane` | need / reply / done | the screen splits only done vs not done | project.ts:25, 481, 521; LiveFeedScreen.tsx:145, 522, 526 |
| Gmail labels (second surface) | Needs Created red, Needs Updated orange, Created green, Updated blue, Needs Follow Up purple | from the same cards, every minute; a green card wears none | threadLabels.ts:15-26, 48-53; labels/route.ts:43-46 |

### 2.2 What each listed source looks like

| what happened | card kind | badge | note | what Confirm does | listed? |
|---|---|---|---|---|---|
| hand-off, not a reply (system could not decide) | needs-created / needs-updated (v2.ts:91) | amber | first check phrase (cardNote.ts:146-147) | writes `checked`, nothing else (check.ts:4, 28) | yes |
| write planned, never run (writes off; or any replanned write, v2.ts:75) | needs-* (v2.ts:89) | amber | "<ops> · Not written, do it by hand" (cardNote.ts:142) | writes `checked`; **does not run the planned write** | yes |
| write refused or mismatched by OnSinch | needs-* | amber | "System couldn't write it, do it by hand" / "System stopped partway, check OnSinch" | `checked` | yes |
| write verified (nearest thing to confirm-ready) | created-check / updated-check (v2.ts:88) | (green) | — | — | **no**: counted as `done_by_system`; wears Gmail "Order Created / Updated" until green (serve.ts:52-58, 116) |
| hand-off asking for a reply | needs-reply (v2.ts:90) | — | — | cannot be ticked (check.ts:15) | no, except as the second badge |
| link held 30+ min (order gone) | needs-updated, key `held:` (serve.ts:121-127) | amber "Order Needs Updated" | "R… is no longer in OnSinch · Find it or rebuild it" (serve.ts:126) | **400**: `held:` is not tickable (check.ts:15, 26-27). The screen ignores the answer and the tile reverts on reload (LiveFeedScreen.tsx:510-514) | yes |

**Answer: no.** A card the system could not do and a card it fully planned are drawn identically: same edge, badge and button. They differ only in the wording of the note. The cards the system did do are not on the list at all. Two smaller points:
- serve.ts:118 says a held link's R is "shown nowhere", but its note prints it (serve.ts:126).
- Once green, a needs-created card reads "Order Created" even when its evidence is "Cleared by the system" (v2.ts:159; LiveFeedScreen.tsx:94, 156-157).

---

## 3. Lifecycle and aging

### 3.1 When a card appears

All of these must hold:
- a `v2_decisions` row of kind write or handoff, created at or after V2_FROM and not `local` (live.ts:70, 76-80);
- its email sent on or after FEED_FROM 2026-10-10 (project.ts:75, 435);
- its last day not yet past (project.ts:417);
- at least one item is a need (serve.ts:109).

Rows come from intake, or from the minute sweep that records an undecided email as a card first (process.ts:243-255; sync/route.ts:34). The screen polls every 20 s (LiveFeedScreen.tsx:35, 417-422). A new item key chimes (at most one chime per 10 s, after a click has unlocked audio) and scrolls the list to the top (:390-400). A replan never creates a card from a `none`: it reads only write and handoff rows (replan.ts:76-80).

### 3.2 Every way an item turns green

All green marks are insert-once (marksDb.ts:61-69). The earliest one dates the green (project.ts:349, 359).

| mark | who or what | condition | file:line |
|---|---|---|---|
| `checked` | a person, by Confirm | item key starts needs-created, needs-updated, created-check or updated-check. Undo: the button at any time, or the 10 s toast. Undo deletes only the tick | check.ts:15-30; marksDb.ts:72-76; LiveFeedScreen.tsx:224-247, 641-645 |
| `staff-edit` | verifier | the card is bound to an order and not needs-created. One of: a timeline row by a non-bot user after the item's time; order stamps after it; or every shift asked for sitting on person-made blocks | verify.ts:328-412 |
| `order-found` | verifier | **unbound** needs-created only. Found by reference, or by date plus venue or shift times; never by date alone; 6 candidates or fewer | verify.ts:220-270, 297-316 |
| `resolved` | projection | the thread's **newest** `open` mark is no longer yielded (replan says `none`), or only an older check is | project.ts:381-387, 425-434; v2.ts:109; replan.ts:127-128 |

Constraints that decide which path can fire:
- **The verifier and the `open`/`resolved` memory run only inside `/api/feed`, i.e. while a screen polls.** The minute labels call passes `verify: undefined, remember: undefined` (labels/route.ts:43). With no screen open, no `order-found`, `staff-edit` or `open` marks are written. The verifier runs at most once a minute across all screens, with an 8 s budget (verify.ts:31-32; marksDb.ts:84-94).
- A needs-created card that already has an order id (from a link, or a hand-off's `order_id`) gets neither verifier mark:
  - (d) skips bound cards (verify.ts:301);
  - (a) and (c) skip needs-created (verify.ts:328).

  It closes only by a tick, by the replan's "already booked" (plan.ts:268-272), or by leaving.
- A needs-updated card the verifier binds gets `matched`, which is not green. It then waits for a staff edit (verify.ts:317-321).

### 3.3 Every way a card or item leaves

| exit | seen? | file:line |
|---|---|---|
| green for more than 24 h | yes: it sat in Done for a day. On turning green the tile holds its place 3 s, fades 0.6 s, then moves to Done | project.ts:63, 441; LiveFeedScreen.tsx:41-44, 447-461 |
| last job day passed (London date) | **no**: no mark, no Done, no animation; the replan also stops | project.ts:417; replan.ts:65-66 |
| held link: every day passed, or link found again | **no** | serve.ts:121 |
| undated, not green, more than 14 days after **its own email** | as a number only, in the footer | project.ts:69, 442; LiveFeedScreen.tsx:622-626 |
| replan turns the need into a needs-reply | **no** (new; §3.6) | v2.ts:90, 103-111; serve.ts:109; project.ts:426 |
| replan says `none` for a need that does not hold the thread's newest `open` mark | **no** (new; §3.6) | project.ts:381-387, 425 |
| a later email on the thread answers the need (same day or same order) | the card stays; the old item is replaced with no green, and a tick on it is lost (the key includes message_id) | v2.ts:110, 187, 199-210 |
| needs-reply after our sent email | not listed anyway | project.ts:439 |
| email before FEED_FROM | never shown | project.ts:435 |
| thread `dismissed` | read only. **No code writes a `dismissed` mark** (grep "dismissed" over app/, scripts/ finds readers only: project.ts:347, v2/metrics.ts:76) | project.ts:347, 409, 514 |
| ported jobs-board tiles | never leave: green, Done, no dwell | ported.ts:7-9, 41-43; serve.ts:150 |

### 3.4 Every timer and threshold

| name | value | effect | file:line |
|---|---|---|---|
| FOLLOW_UP_MS | 24 h | no activity → `follow_up`: badge, KPI, Gmail "Needs Follow Up" | order.ts:26; project.ts:474 |
| QUIET_MS | 7 days | no activity → `quiet`: sunk under its own header | order.ts:18; project.ts:497; LiveFeedScreen.tsx:615 |
| activity, for both | the newest of: client email, our email, a bot write, a green mark (at the staff edit's own time) on the thread or any thread of the same order. The email time is the fallback | | project.ts:371-376, 400-406, 473 |
| REPLY_RED_MS | 24 h | ordering only: a client waiting 24 h+ goes first, but only on cards with no order/R/J | order.ts:10, 57; project.ts:466, 491 |
| URGENT_MS | 48 h | amber date, "Within 48 Hours" KPI. Deadline = first future start, else the next day at **00:00 UTC** (01:00 in BST) | LiveFeedScreen.tsx:40, 176-180; order.ts:40-44 |
| DONE_DWELL_MS | 24 h | green → gone | project.ts:63, 441 |
| STALE_UNDATED_MS | 14 days | undated → `older`. Measured from `it.at` (the need's email, v2.ts:108-111), not from client activity. The footer says "no word from the client for two weeks" | project.ts:69, 442; LiveFeedScreen.tsx:624 |
| FEED_FROM | 2026-10-10 00:00 BST | older items never shown | project.ts:75 |
| V2_FROM | 2026-10-09T10:20Z | older decisions not read | live.ts:70 |
| HOLD_TV_MINUTES | 30 min | a held link becomes a card | links.ts:25; live.ts:97 |
| replan | at most 20 rows a minute, least-recently-replanned first, 90 s budget, 5 min OnSinch cache | how often a card is re-checked | replan.ts:32, 75, 84-90 |
| verifier | 60 s, 8 s budget, 6 timeline pages, 10 min order cache | | verify.ts:31-36, 162, 178 |
| screen | refresh 20 s; stale data 2 min; hold 3 s + fade 0.6 s; undo 10 s; back to top after 20 s idle; chime gap 10 s | | LiveFeedScreen.tsx:35-44 |
| labels | every minute, 150 threads a run, full resend on the hour | | labels/route.ts:15, 49-51 |

### 3.5 A card nobody touches, day by day

Example: a dated need, email at T0, job day D more than 2 days later, no other email, no staff action.

- **T0 to T0+20 s.** It appears at the top of its group, amber badge, Confirm. The chime plays if audio is unlocked. Gmail gets "Order Needs Created" or "Order Needs Updated" within the minute.
- **Every minute until D passes.** The replan plans it again (in turn, 20 a minute). If it now says `none`, the card turns green ("Already booked in OnSinch: R…" or "Cleared by the system"). If it finds an order, a link is made and R and J appear. While a screen is open, the verifier looks for the order (unbound needs-created) or for staff edits (bound updates).
- **T0+24 h.** `follow_up` is set: the "Needs Follow Up" badge, the KPI count and the Gmail label. Nothing else changes, and nothing is sent to anyone.
- **T0+7 d.** `quiet` is set. The card drops below every fresh card, under "Nothing New For 7+ Days". On the TV it is then likely below the fold and counted in "N more waiting below".
- **D−48 h.** The date column turns amber and the card counts in "Within 48 Hours". Its order within the quiet group moves by deadline. It stays quiet, because a deadline is not activity.
- **D+1 (London).** The card is gone: no mark, no Done entry, no animation. Gmail labels are removed on the next minute (threadLabels.ts:67-70).

An **undated** need follows the same 24 h and 7 d steps. It has no amber date. At T0+14 d it becomes one unit of the footer count.

### 3.6 Paths by which a card or a need leaves without anyone seeing it go

1. **The job day passes** (project.ts:417), for need cards and held cards alike (serve.ts:121).
2. **Undated for 14 days** (project.ts:442). Only a count remains, with no thread, client or R.
3. **A replan reclassifies a need as needs-reply.** The item's kind changes but its key keeps the first kind (v2.ts:105, 110-111). `isFailure` drops the card (serve.ts:109). No `resolved` is written because the source still yields an item (project.ts:426). The reverse also happens: a reply hand-off that the replan turns into a need is listed under a key beginning `needs-reply:`. Confirm on it returns 400 (check.ts:15) and the tile reverts. Not measurable: the snapshot has no `replan` column.
4. **A thread with two or more needs.** `lastOpen` keeps one `open` mark per thread, the newest (project.ts:381-387). A need that stops being yielded while another need holds that mark leaves with no `resolved` and no green (project.ts:425-431). Carried needs drop out of `rowsOnCard` once they are not needs (v2.ts:187, 193-198). Their open marks are written in entry order, source first (project.ts:504-506), so the carried one is usually the newest.
5. **No screen polled while it lived.** `open` marks are written only by `/api/feed` (serve.ts:76-83; labels/route.ts:43). A need that arrives and is replanned to `none` while no screen is open has no `open` mark, so it never turns green.
6. **A newer verified write on the same day or order.** The need gives way to a check, which is not listed (v2.ts:225-242; project.ts:426: a check newer than the need is not "older"). This is dormant while bot writes are off.

Pipeline-trace §9 lists 1, 2 and the dwell. Items 3 to 6 are this file's additions.

---

## 4. Status model: §10's four statuses against current kinds and marks

| §10 status | nearest today | how it renders | gap |
|---|---|---|---|
| `confirm_ready` (gate cleared, validation passed, one tap) | (a) a write verified in OnSinch: created-check / updated-check (v2.ts:88). (b) A write planned but not run: needs-* with "Not written, do it by hand" (v2.ts:89; cardNote.ts:142) | (a) not listed (serve.ts:109-116). (b) Listed exactly like a flagged item (§2.2) | No status of its own. The tap never carries out a plan: Confirm writes only `checked` (check.ts:4) |
| `flagged` (needs a decision; reason_code, top-3, evidence) | a non-reply hand-off; a refused or partial write; a held link (§2.2) | the amber need tile | Has the reason as a phrase, not a code (§1.2.5). No top-3, no evidence (§1.2.2-3). Reply hand-offs (55 of 207) are flagged but not listed |
| `confirmed` | the `checked` mark (a person). Also three automatic greens no person made: `staff-edit`, `order-found` (verifier) and `resolved` (replan says `none`) (project.ts:47-48) | green tile; the evidence line says which | §10 treats confirmed as a staff act. Today three of the four green marks are automatic, and all four look alike apart from the line and the inert "Done" button |
| `suppressed` (deterministic rule, logged) | a `none` decision: 571 of 847 in the snapshot (pipeline-trace §10) | never an item (v2.ts:109; live.ts:80) | Logged in `v2_decisions`. Feed-level drops (day passed, `older`, needs-reply) leave no record |

**Where a future rejected or held state would sit.**
- Per item, it would be a `feed_marks` row. The primary key is (item_key, mark), with `by`, `evidence` JSONB and `at` (marksDb.ts:27-35). The reason would go in `evidence`, as the existing marks do.
- `MarkKind` (project.ts:47) and `GREEN_MARKS` (project.ts:48) decide whether a mark closes an item.
- The only route a person writes through is `applyCheck` / `/api/feed/check`, gated by TICKABLE (check.ts:15-30). `removeCheck` deletes only `checked` (marksDb.ts:72-76).
- The nearest existing per-thread analogue is `dismissed`: it is read (project.ts:347, 409, 514) and nothing writes it.
- **Name clash:** "held" already means a `job_links` state (links.ts:10-12, 193) and the TV card built from it (serve.ts:121-127).
