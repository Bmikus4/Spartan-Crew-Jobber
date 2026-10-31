# Spartan TV build: handoff (30 Oct 2026)

**For the next session. This is the final handoff.** Work it down, top to bottom. It turns the owner's §13 meta plan
(ADDENDUM.md §13) into build steps, with the data each step rests on. It also covers the owner's last two checks and
how the code is to be written.

**Read first:**
- CLAUDE.md, the repo map;
- ADDENDUM.md §13, the plan and the rulings, and §12, the measurement loop this build reads from;
- DECISIONS.md O13-O16;
- decisions/2026-10-30-tv-shows-only-what-needs-doing.md.

**State at handoff:**
- HEAD is this handoff's ticket (S-0267), pushed; the tree is clean.
- Writes to OnSinch are off.
- The loop's P2.1-P2.5 are live: OnSinch history stored every minute, outcomes, staff actions, card exits.
- P2.6, the daily report screen, is parked in `.tmp-v2/p26-draft/`. Its test crashed PGlite; it is not part of this
  build.

**After this build** the owner collects test data and tweaks. Build for that: every change is measurable and reported.

---

## The owner's requirements (verbatim where quoted)
1. **Passed jobs never appear** (O13): "jobs that have already passed should not appear there."
2. **Handled needs leave the needs list, and a need never clears on another job's work** (O14).
3. **The name** (O15): the linked OnSinch order's title; else client and venue; else the original sender's email
   address. "It should never be an internal Spartan Crew email. It should absolutely only be the original sender."
   Never a subject line.
4. **A three-line tile** (O16), accepted by the owner and Paz: "make sure that the UI of the system in general is
   nice and orderly and tight and looks really good."
5. **A need does not depend on having a day** (O16).
6. **Plain descriptions** (30 Oct): "clear and descriptive about what the order is and what needs done on it. And
   they should not be intentionally technical or vague. They should just be plain and explain things outright."
7. **Only absolute data** (30 Oct): decisions rest on what OnSinch or a person recorded, never on the system's own
   guesses. "It has to be absolute for us to use it in this case."

## What is absolute, measured 30-31 Oct (read-only; `.tmp-v2/absolute.ts`)

| data | absolute? | how complete |
|---|---|---|
| `onsinch_timeline`: who changed what in OnSinch, when | **yes** (OnSinch's own record) | Every booking action since 29 Jul, complete to the minute. Since 9 Oct: 11,397 rows, 10,952 by staff. 1,461 (13%) not yet tied to an order (orders older than the store, or never read) |
| `onsinch_contacts`: each contact's address and company | **yes** | 1,375 contacts, refreshed daily |
| `onsinch_orders`: an order as read | **yes, as of `read_at`** | 327 orders (those staff touched since 9 Oct) |
| `onsinch_places`: place names | **yes** | 2,628, refreshed daily |
| R or J the client wrote; a PO that equals an OnSinch order's PO | **yes** (exact text against OnSinch) | 142 of 465 threads since 9 Oct (R 36, J 22, PO 110) |
| A link from a thread to an order the bot wrote | **yes** (we made the order) | 26 links |
| A link the planner or the finder inferred | **no** (our guess) | 108 links. Finder: 2 of 34 point at another client's order |
| A link from the old Jobs Board | **no** | 177 live, 171 of them on orders never read |
| A person's Confirm tick on the TV | **yes** (a person) | Only 15 ever |
| Our decisions, readings, marks, outcomes | **no** (our output) | Use only as what the TV said, never as truth |

**Consequences for the build:**
- A need's job is anchored only by absolute evidence: an R, J or PO the thread names that OnSinch holds, or the bot's
  own order.
- An inferred link counts only when the day and the venue agree with it.
- An order OnSinch no longer holds was deleted, and is never work done (below, check 2).

## The owner's two checks (30 Oct, read-only)

### Check 1. Were the cards that vanished ones the owner asked to delete?
The owner: "the reason that some of those may have been disappeared is because I asked for them to be deleted. So
make sure that that's not the case." **None of the 45 "left the TV" exits was a deletion** (`.tmp-v2/exitsdeleted.ts`,
`.tmp-v2/exits2.ts`):
- each one's decision and email are still stored; none was archived; no person dismissed its thread;
- 37 still had a day to come, 7 had no day, and only 1 had every day passed;
- they left one to four an hour across 28-30 Oct, not in one clear-out;
- 9 are on threads that have another need open now, 10 left along with their thread's other needs, and 26 have no
  explanation. Step 1 still finds out why.

**Where deletions do show:** staff created two orders and then deleted them in OnSinch: 16957 on 29 Oct and 16990 on
30 Oct. These may be the deletions the owner meant. Neither was linked to a thread, so no card rested on them.

### Check 2. Is OnSinch's change history synced and right?
The owner: "OnSinch has changed history. We need to verify that that is actually synced and right." For the 3 days up
to the last sync (`.tmp-v2/truthsync.ts`):
- **Synced:** OnSinch holds 7,104 history rows, and 1,692 of them are the 8 booking actions the store keeps. All 1,692
  are stored with the same data, author and time. None is missing and none differs.
- **OnSinch changes its history when an order is deleted.** The store holds 3 rows OnSinch no longer returns. They
  are the create rows of the two deleted orders:
  - OnSinch removes a deleted order's create row;
  - it logs no delete action;
  - it keeps the order's shift rows.

  Our store keeps what it read, so it still shows both orders as created. Step 0 fixes that.
- **Not kept:** 45 other action names, such as applicants, attendance, clock-ins, calendar and invoice items. Step 0
  checks the few that could touch a booking.
- **Not yet seen:** the "changed via API" entries OnSinch support described. Writes are off, so none has appeared.
- **Not yet checked:** the whole range since 29 Jul. Step 0 checks it.

## How the code is written (the owner, 30 Oct: "focus on clean, efficient code in your build")
- **One rule, one function, one place.**
  - `done.ts` alone answers "is this need done".
  - One function gives the name.
  - `cardNote.ts`'s templates alone write the description.
  - Nothing else decides these again.
- **Replace, never layer.** Each step deletes what it supersedes in the same ship:
  - `verify.ts`'s cursor, stamps and steps (a), (c) and (d);
  - `classify()`'s frozen kind;
  - every fallback to the subject.

  Before deleting, grep every caller and run the suite.
- **Pure where it decides.**
  - The evaluator, the name and the note take plain rows and return plain values.
  - No database, no network, no clock: pass `now`.
  - Their tests feed rows directly; PGlite is only for store code.
- **Read once.**
  - One query per table for each TV build, keyed by the threads and orders on the board, never a query per card.
  - OnSinch is read only in the minute sync. The TV's read path reads only the database, so `verify.ts`'s OnSinch
    reads on each TV request go away.
  - A test pins the number of queries one TV build makes, whatever the card count.
- **Small and plain.**
  - Match the code around it.
  - Comments only for constraints the code cannot show.
  - No options or flags kept "in case".
- **Measured:** each ticket states the lines added and removed under `app/lib/feed` and `app/lib/v2/loop`.

## The build, in order (each step through the gate, each with its measurement)

### Step 0. The stored history stays right, deletions included (check 2)
- **Where:** `app/lib/v2/loop/truth.ts`. Read orders with the daily contacts and places refresh, not every minute.
- **Rule:** an order OnSinch no longer holds is deleted.
  - Page through recent orders with `/orders?id[gt]=N`, the lowest order id with a create row in the last 30 days.
    About 10 reads a day. First check that the filter works on orders as it does on history.
  - A stored order missing from those pages gets `onsinch_orders.deleted_at`: a new migration, append only.
  - Stored history rows are never deleted. What happened stays.
- **Readers:** step 1's evaluator, `loop/judge.ts` and `loop/outcomes.ts` all treat a deleted order as not booked.
  Re-score any outcome that rested on one.
- **Before it ships:**
  - Run `.tmp-v2/truthsync.ts` once over the whole range since 29 Jul: about 1,950 pages, read-only, with a hard
    timeout.
  - Expect 0 rows missing and 0 different. Every stored row OnSinch no longer returns must belong to a deleted order.
  - Sample the skipped actions that could touch a booking: `order_item_*`, `slot_team_close`, `order_copied`,
    `order_finish_without_invoice`. Keep any that changes a shift's day, time, size or place.
- **Gives:** deleted orders known. Two so far: 16957 and 16990.

### Step 1. One evaluator: is this need done? (§13 change 1, O14)
- **Where:**
  - a new `app/lib/feed/done.ts`, pure;
  - called where the TV is built (`app/lib/feed/serve.ts`, through the projection's marks);
  - its marks written by the minute sync's "cards" step (`app/lib/v2/loop/cards.ts`), which already builds the TV
    with no verifier.
- **Replaces:** the four answers to one question:
  - `v2.ts` `classify()`'s frozen kind;
  - `verify.ts` step (d), which skips cards with an order (line 306);
  - `verify.ts` steps (a) and (c), which skip "needs created";
  - the replan's settle. Keep the replan for re-planning; it stops deciding whether a need is done.
- **Rule:** staff's OnSinch work after the email counts only on the need's own job, found by the first rung that holds
  (absolute rungs first):
  1. **An absolute anchor:** an R or J the thread names, a PO the thread names that equals an order's PO, or the bot's
     own order.
  2. **An inferred link (planner or finder)** only if that order holds a day the need names, at the need's venue when
     it names one.
  3. **The need's venue and day** (the place from the plan, or the client's venue words matched to an OnSinch place
     name exactly).
  4. **The day alone,** only when the client has exactly one order that day.

  Then:
  - **The work must fit the ask:** a create (or shifts added) for a booking; a size, time or position change on that
    shift for a change; a cancel or delete for a cancellation; any of these for an undated ask.
  - **A deleted order (step 0) never counts.** A create followed by a delete is no booking.
  - **Two or more candidate jobs and nothing absolute to choose:** never green. The card says "Possibly done in R1 or
    R2: check" (amber).
  - **A need with no day** is matched by rungs 1-2. 28 of 29 undated needs since 9 Oct have a linked order or a PO.
    Otherwise it stays open.
- **Links (O17, O18).** The owner: "absolutes overrule everything else, so any absolute links both ways, should
  override existing ones, be careful with this", and "the system should be built to handle multiple orders".
  - **A link is one thing:** a thread joined to an order, whichever side the search began from. Each link stores its
    proof, absolute or inferred.
  - **One function grades the proof,** in `app/lib/v2/links.ts`. The evaluator and the minute sync both call it.
  - **Match again when either side changes:**
    - a new email against stored orders;
    - a new or changed order (the minute sync already reads them) against stored threads.

    Since 9 Oct, 80 of 148 absolute links name an order made after the email. A search at intake cannot see these.
  - **An absolute link overrules inferred links** from that thread to orders outside its set. This replaces
    `links.ts`'s rule that a live link is never displaced. Today (`.tmp-v2/abslinks.ts`):
    - 63 threads gain a link;
    - 57 already agree;
    - 7 are linked only to another order, and would be overruled.
  - **An overruled link is marked replaced, with the proof,** never deleted.
  - **Two absolutes that disagree overrule nothing.** For example, the order is not the sender's company, or the
    bot's own order differs from the client's PO. The card is amber, "check".
  - **Several orders are normal.** Of the 13 threads naming 2+ orders, checked 30 Oct (`.tmp-v2/multiorder.ts`):
    - 5 name several orders one by one, up to 6 POs in one email. Link every one, one need per order.
    - 3 name one PO that OnSinch holds on two orders. Link both. The need's day picks the order; with no day the card
      says "R1 or R2: check".
    - 4 name one real order, and their other hits are false.
    - 1 has no real hit at all.
  - **What counts as absolute.** All 8 false hits fail one of these rules:
    - **A PO is a whole token of at least 6 characters,** not inside a link, an address or a tracking string. 7
      false hits were POs of 4-5 characters found inside such strings. Every real PO hit was 6 or more characters,
      stood alone, and mostly followed "PO number".
    - **An R counts in the subject, the client's new words, or a Spartan message on the same thread.** An R that
      appears only in history quoted from another thread does not count. That was the 8th false hit.
    - **An R counts only if the order now holding that number existed when the email was sent.** OnSinch reuses
      an R number after a delete (DECISIONS D6).
    - **A deleted order never counts** (step 0).
    - Recount the 9 "another company" conflicts (`.tmp-v2/abslinks.ts`) under these rules. Both such conflicts
      among the 13 were false PO hits.
  - **Not proof: staff working on an order after the email.** One falsely matched order had 64 rows of staff work
    that week, because staff touch many orders every day. The day is the check.
  - **Before it goes live:** list every link that changes, with the cards and Gmail labels that move with it, and
    check each one. One wrong link blocks the ship.
- **Data:** `onsinch_timeline` and `onsinch_orders` (read the client's orders when a need's client has none stored,
  as `loop/outcomes.ts` does), `onsinch_contacts` and `job_links` (source column says absolute or inferred).
- **Before it goes live:**
  - Run it offline over every need since 9 Oct (pattern: `.tmp-v2/p24run.ts` loads production's tables into PGlite
    read-only).
  - Compare with what staff did:
    - the 6 needs of 29 Oct must all clear (cards 1-6 in `.tmp-data/tv-1029/v2brief.txt`);
    - the 18 same-day multi-job cases (`.tmp-v2/sameday.ts`) must clear none wrongly.
  - **Any wrong clear blocks the ship.**
- **Also find why needs leave the TV unexplained** (26 of 45, check 1). The likely cause is an item key that changes
  under the TV. Each exit gets a named reason or is fixed. The evaluator's own reasons replace "left the TV".
- **Gives:** open needs staff already handled go from 6 of 6 to 0, and wrong clears are 0.

### Step 2. A need's state from now, not from arrival (§13 change 2)
- The card's kind and its R/J come from one place.
  - An order made after the email answers "needs created".
  - A linked order cancelled after the email shows "Cancelled in OnSinch" and is done.
  - A link to an order that is gone shows nothing.
- `threadLabels.ts` follows the cards unchanged.
- **Gives:** "Order Needs Created" beside an R/J goes from 11 of 44 to 0 (examples: `.tmp-v2/issue2ex.ts`; R11870,
  R10522, R11330, R11507).

### Step 3. Passed jobs leave (§13 change 3, O13)
- In `serve.ts`, drop every card (live, carried over, held) whose every day is before today in London.
- A card with no day leaves when done (step 1) or after the existing 14 quiet days.
- **Gives:** about 180 cards off the TV today; the TV shows only work still to come.

### Step 4. Names (§13 change 4, O15)
- **One function** for the name: the linked order's title, if the link is absolute or agreed (step 1);
- else client and venue: the company whose contact list holds the sender, recomputed each build, not frozen at the
  decision, plus the venue;
- else the original sender's address: the first client message on the thread that is not from spartancrew.co.uk.
- **Never the subject.** Remove the fallback at `LiveFeedScreen.tsx:308`.
- **Also take the subject out of:**
  - held cards (`serve.ts`);
  - the R-number reading in `v2.ts:72/207/238`, where the kind is decided from the subject: use absolute references
    from step 1;
  - the refs the checker searches by.
- **Carried-over cards** take their name, days, crew and venue from the order, not the old ticket (crew is wrong on
  89 of 186).
- **Gives:** subject-line names go from 17 of 238 to 0.

### Step 5. Plain three-line tile (§13 change 5, O16, plain descriptions)
- **The three lines:**
  - Line 1: the name, label, R, J and day.
  - Line 2: what the job is and what needs doing, in full plain sentences, every shift listed.
  - Line 3: the one thing to check, the PO, who wrote and how long ago. On a done card, what staff did.
- **Rewrite `cardNote.ts` as plain sentences from fixed templates** (structured fields only, never email text, no
  "+N more", no "Read the email" catch-all where a field says what is missing). Examples:
  - "Book a new order: Mon 16 Nov, 6pm to midnight, 4 crew; Wed 18 Nov, 5pm to 8pm, 4 crew. The client has
    confirmed."
  - "Add 2 crew to the morning call on Wed 4 Nov (7:45am to 11:45am), making 6."
  - "Cancel both shifts, Fri 6 and Mon 9 Nov. The client's event is off."
  - Check line: "The email does not say how many crew."
- **Show the contact:** live cards set `contact: null` (`v2.ts:151`). Use the sender's name.
- **Layout pass on `LiveFeedScreen.tsx`:** columns, spacing and type sizes on the 3-line tile, checked on the TV at
  its real size before shipping.
- **Gives:** a person knows what to do without opening the email.

### Step 6. The TV says when its OnSinch history is behind (§13 change 6)
- From `v2_loop_meta.timeline_complete_at`: the sync icon goes amber past a few minutes, red past 15.

---

## After each ship
- Re-check every card on the live TV as on 29 Oct, and report what is right and wrong. The scripts:
  - `.tmp-v2/tvcards.ts`, `tvverify.ts` and `tvv2.ts`;
  - `.tmp-v2/ro-neon.ts`, which runs the app's own read paths against production in read-only transactions;
  - `.tmp-v2/truthsync.ts`, the stored history against OnSinch's.
- The ADDENDUM's status line and §13 table are updated with each step's measured numbers.

## Traps (from this session)
- **Shipping:**
  - The gate is the only commit and push: `python -u scripts/session.py -m ... -F body -- <paths>`. About 20 minutes.
  - No source edits while it runs.
  - A push deploys production.
- **Tests and production reads:**
  - Run one test only with `npx tsx --require ./test/fixtures/pg.ts test/x.ts`. A bare run can reach production.
  - Read production only read-only: `scripts/_readonly.mts`, or `--require ./.tmp-v2/ro-neon.ts` for app code.
  - Never print client names or email text in output or committed files.
- **Shell and patch scripts:**
  - Git Bash heredocs eat backslashes. Write Python or JS patch scripts with the Write tool, or use Edit.
  - Python patch scripts: read and write with `newline=''`; check `git diff --stat` for line-ending churn.
  - The pinned Neon driver has no `.query`; use the call form `sql(text, params)`.
  - PGlite runs out of memory on large `jsonb_to_recordset` inserts; batch at 250 rows.
- **OnSinch's history is not append-only.** Deleting an order removes its create row and logs nothing. A gap in
  OnSinch's ids is not a sync fault. A stored row OnSinch no longer returns means a deleted order.
- **Watch for after writes return:** "changed via API" history entries (OnSinch support, 30 Oct). The truth store
  keeps 8 action names, so add the new ones when seen.
