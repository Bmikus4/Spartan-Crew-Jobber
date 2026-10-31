# Spartan TV build: handoff (30 Oct 2026)

**For the next session.** Work this file down, top to bottom. It is the owner's §13 meta plan (ADDENDUM.md §13) turned
into build steps, with the data each step rests on.

**Read first:**
- CLAUDE.md, the repo map;
- ADDENDUM.md §13, the plan and the rulings, and §12, the measurement loop this build reads from;
- DECISIONS.md O13-O16;
- decisions/2026-10-30-tv-shows-only-what-needs-doing.md.

**State at handoff:**
- HEAD e837963 (S-0265), pushed; the tree is clean.
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
- Card exits: 45 of 68 recorded exits are "left the TV" with no known reason. Find out why in step 1, since it likely
  means item keys change under the TV.

## The build, in order (each step through the gate, each with its measurement)

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
  - **Two or more candidate jobs and nothing absolute to choose:** never green. The card says "Possibly done in R1 or
    R2: check" (amber).
  - **A need with no day** is matched by rungs 1-2. 28 of 29 undated needs since 9 Oct have a linked order or a PO.
    Otherwise it stays open.
- **Data:** `onsinch_timeline` and `onsinch_orders` (read the client's orders when a need's client has none stored,
  as `loop/outcomes.ts` does), `onsinch_contacts` and `job_links` (source column says absolute or inferred).
- **Before it goes live:**
  - Run it offline over every need since 9 Oct (pattern: `.tmp-v2/p24run.ts` loads production's tables into PGlite
    read-only).
  - Compare with what staff did:
    - the 6 needs of 29 Oct must all clear (cards 1-6 in `.tmp-data/tv-1029/v2brief.txt`);
    - the 18 same-day multi-job cases (`.tmp-v2/sameday.ts`) must clear none wrongly.
  - **Any wrong clear blocks the ship.**
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
  - `.tmp-v2/ro-neon.ts`, which runs the app's own read paths against production in read-only transactions.
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
- **Watch for after writes return:** "changed via API" history entries (OnSinch support, 30 Oct). The truth store
  keeps 8 action names, so add the new ones when seen.
