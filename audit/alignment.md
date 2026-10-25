# Alignment statement (Checkpoint A)

The orchestrator wrote this on 2026-10-25, after Phase 0 and red team A. It rests on `audit/reconstruction.md`. The proposals and the red-team responses are in `audit/checkpoint-A.md`.

## What the system is for

Clients email Spartan Crew to book crew, change a booking or cancel one. The system reads every client email, works out which client sent it and which of that client's bookings it concerns, and then does one of three things:
- makes the change in OnSinch;
- puts it on the TV for a person;
- records that nothing is needed.

## What correct means

Every email that asks for something ends with the right thing in OnSinch, done by the system or by a person the TV pointed at it, and the system never writes anything the client did not ask for. In §4's order, worst first:
1. a real request that nobody acts on;
2. an item or write that is wrong;
3. noise;
4. a flagged decision.

## What is actually broken, and why

1. **Nothing measured so far can show the worst case, or progress toward 99%.**
   - 227/500 and 114/500 are one harness bit on two generated sets, taken with a perfect reader on a broken fake OnSinch. 71 of the 227 were crashes.
   - The live scoreboard credits each staff act to the client's latest email within 36 h. 31 of its 32 "missed changes" were emails a reader judges to ask for nothing, though 6 of those 31 have a staff act on a day the email names.
   - The silent-miss count is measured only on emails staff acted on. A request that neither the system nor staff acted on cannot appear in it: 246 "nothing to do" emails and 45 no-work handoffs of the live week were never read.
2. **What the system wrote was right too rarely to be used, and staff did not use it.**
   - On the live week (writes on), 84 inquiries had staff work, and 3 ended completed by the system and stayed completed.
   - New bookings: 0 lasting completions. Staff rebuilt 14 of the 16 bot creates within about an hour. Only 9 of them were equal to staff's order by day, times and crew, and only 7 by trade as well.
   - Gmail labels did not change that: all 6 creates made after labels went live (10-16) were rebuilt or deleted.
3. **The reader and parser hand to staff work the client wrote clearly enough.** 23 of the 67 system misses failed at grounding, and at most 15 of those are parser-side: crew in words, "Duration: N", a day plus a time read as the year, ordinal months, ranges. Another 7 had no client: production resolved 85.9% of the week's senders (82.2% over the snapshot), against 89.1% in a replay of today's rule.
4. **"Confirm" means three things, and none of them is §3's.**
   - The TV tick only records who and when.
   - Creates wait in To Confirm, where staff confirmed 1 of 21 and deleted 11.
   - Edits go live with no confirm.
   - The owner's rulings conflict on whether a person must confirm.
5. **Production misreported its own intake until 10-25.** `intake_paused=true` had been left on from the 10-21 pause, so the TV showed "Intake Paused" and its intake alarm was off. On the owner's word ("the only thing that should be paused are job and order update and creates"), the flag was cleared and the Intake Watchdog switched back on. Creates and updates stay paused.

**What holds and should be kept:**
- the deterministic spine: client first, candidate pools with a median of 2, 0 of 92 hand links in disagreement;
- the write safeguards;
- shadow production, with writes off and the TV up. Every planned write shows there as a needs-created or needs-updated card, and staff work the inbox: our mailbox answered all 18 of the week's questions, at a median of 0.2 h.

There is no known-good version to revert to.

## What I propose

1. **No revert.** Add a Gmail-side count to the health check, so that mail which never reached the store is seen. 10-21, the pause day, holds 19 client emails against 54-103 on other weekdays.
2. **Highest-leverage move: a real-mail eval set that sees every client email, not only those staff acted on.**
   - For each email: what it asked for, and the right outcome. The labelling is independent of staff timing, done by two readers, with disagreements settled by the owner or Paz.
   - The 117 + 100 rows bucketed in Phase 0 are the seed. The 291 unread emails of the live week come first, because that is where real silent misses would hide.
   - It changes no metric's value. What it changes is that inquiry_recall and item_correctness become measurable at all, which every later move needs. §6.5 makes it the first Phase 1 task.
3. **Then, measured on that set: the parser (at most 15), client resolution (7), and a needs-reply fix.** At present our reply clears a booking the client still wants (`project.ts:439`; 12 of 33 Needs Reply threads in the PDF's p6 #6 were later booked by staff).
   - Listing bot creates on the TV is **not** proposed. It would reverse the owner's 10-13 rule ("only those cases", the ones the system cannot do, reach the TV).
   - The labels experiment says visibility was not why staff rebuilt.

**Decisions I need from the owner:**
- Who labels, and who settles disagreements?
- Q1: may the system book directly, and what should "confirm" do?
- Q3: are crew notified on each edit?
- Does "client" count as the second fact beside the day?
- Ask staff, through Paz, why they rebuilt the bot's orders.
- Q4: the display_precision floor.
