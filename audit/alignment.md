# Alignment statement (Checkpoint A, revised 2026-10-25)

Files: `audit/reconstruction.md` (evidence), `audit/checkpoint-A.md` (proposals, §17, red team), `eval/live-week-reads.md`, `audit/display-proposals.md`, `audit/red-team-A.md`, `audit/spec-compliance.md`, `decisions/`.

## What the system is for

Clients email to book crew, or to change or cancel a booking. The system finds the client and the booking, then makes the change in OnSinch (new orders wait in To Confirm), puts it on the TV for a person, or records that nothing is needed.

## What correct means

Every request ends with the right thing in OnSinch, done by the system or by the person the TV pointed to. Nothing is written that the client did not ask for. Worst first: a request nobody acts on; a wrong item; noise; a flagged decision.

## What is broken

Live week, 10-14 to 10-21: all 400 client emails, two blind readers.

1. **16 of 90 outstanding requests produced nothing on any screen.** inquiry_recall is 82% (CI 73-90), against a target of 99.5%.
   - 8 the model read as "nothing to do", and staff then did 4 of them by hand.
   - 8 were needs-reply items, which no screen shows.
2. **Writes that ran were right 18 times in 23 (78%).** Staff still rebuilt 11 of the 12 correct creates. A TV card proposes no change, so over all 104 items shown only 17% were correct and complete.
3. **99 of 122 items ended with a person.** review_rate is 81%, against a target of 5%. The largest causes: unproven readings (34, of which at most 15 are the parser's), and 11 writes blocked by a rule removed on 10-15.
4. **The TV mostly shows real work: 96 of 104 items.** But 8 of the 81 listed cards are the system's own failures, which staff should never see. Every card looks the same, with no candidates and no evidence.
5. **Client:** right on 115 of 123. 5 got no client and 3 got the wrong one.
6. **Measurement:** 227/500 is a harness score on generated mail, and the readers' labels are not yet adjudicated.

**What holds:** the client-first design, the write safeguards, shadow production with the TV up, and intake (fixed 10-25). There is no known-good version to revert to.

## What I propose

1. **No revert.** Add a Gmail-side count of incoming mail to the health check, and keep writes off.
2. **The highest-leverage move: finish the real-mail eval set.**
   - Settle the 37 rows in `eval/reads/adjudicate.csv`, rule on quotes, then read the earlier weeks the same way.
   - Every later fix is measured on it.
3. **Then the fixes, largest group of misses first:**
   - the reader's "nothing to do" on acceptances (8);
   - needs-reply shown (8; a display change);
   - the parser (at most 15);
   - system failures kept off the TV (8);
   - client resolution (8).
4. **§10, proposed and not built:**
   - Every way a card leaves writes a mark, and an open need whose day passes counts as a miss.
   - A chip on each card says "your decision", "ready, writes paused" or "system problem".
   - Cards show how their order was found, and up to 3 candidates.

## Decisions I need

1. Is a quote that names a day, times and crew a booking? Ruling yes turns 16 of 90 into 24 of 113.
2. Who settles the 37 rows: you or Paz?
3. Q1: your 10-13 and 10-16 words put new orders in To Confirm and updates live. Does that stand? Should the TV tick confirm the To Confirm order?
4. Q3: does OnSinch notify crew on an edit, a new position, or a time change?
5. Q4: the display_precision floor. Today it is about 92%.
6. Does "client" count as the second fact beside the day?
7. Are §2's placeholders the 10-03 Spartan Audit and the harness plan? Do your 10-03 rulings stand: an AI step on every dedup, and several orders per enquiry?
8. Should staff be asked, through Paz, why they rebuild correct bot orders?

Q2, Q5 and Q6 are answered in `checkpoint-A.md` §7.
