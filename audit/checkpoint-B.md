# Checkpoint B (OPERATING §14, RUNBOOK §6)

Orchestrator, 2026-10-26. **This is a hard stop:** nothing ships, and no further phase starts, until the owner answers.

**Delivered:**
- `audit/final-state.md`: the gap report;
- `audit/red-team-B.md` and `audit/red-team-B2.md`: two red-team passes, every hit answered in final-state;
- `eval/iterations.md`: iterations 1-5 and the checkpoint run;
- `eval/item-correctness.md`;
- `eval/patches/p1-fixes.diff`: 25 files, not deployed;
- `harness/real/`: the $0 real-mail harness;
- `eval/harness/`: three label sets (dev, dev-2, prospective), the locked prospective split, and the checkpoint runs.

Production is unchanged and writes stay off.

**Alignment** (`audit/alignment.md`): a client email that asks for crew, or for a change to a booking, must end as the right OnSinch order or change. The system makes it, or a person the TV points to makes it. Worst first: a request nobody acts on; a wrong item; noise; a flagged decision.

**Result: blocked (§14.4).**
- **Mail no step had read** (10-23..10-25, 24 B42 inquiries, locked before scoring). Production, HEAD and the patch all reach 20/24 (83.3%, CI 62.6-95.3). All 4 misses are the current model reading "no change asked for", and the patch does not touch that.
- **Dev** is tuned on, and its misses were made by the reader production replaced on 10-15. There the patch lifts recall from 72.3% (HEAD replay; production 65.8%) to 89.7%. 7.6 points of that come from the display rule. Writes are the same 27.
- **item_correctness** is 5.3% at HEAD and 3.7% with the patch, against 99%. A card carries no change, and writes complete their change 8 of 23 times.
- **review_rate** is 82-88% against 5%, because writes are off.

**Decisions needed:**
1. **Ship items 1-4?** They are invisible to staff: the owner alert on the system's own failures (9 of 847 stored decisions), the replay guard, the UTC clock fix and a scorer fix. They are cut and tested as their own patch first.
2. **Ship items 5-8 with Paz?** These are the parser, acceptance cards, client resolution and the display rule. They change the TV and Gmail labels. The display rule can go separately; on current mail it has not yet been shown to matter (0 silent reply cards in 24).
3. **After a client accepts a quote,** staff complete the quote order: 3 of 4 on clean mail. Is that work the TV should show? If yes, clean recall is production 20/31 against patch 24/31.
4. **A ~$0.10 re-read** of the 11 old reader misses plus controls with the current reader, to learn whether the 10-15 switch fixed them? A prompt change waits for a labelled current-reader dev window.

**§17 questions still open:**
- **Q1:** may the system book directly when confident, and what should the TV tick do in OnSinch? Evidence: creates go to To Confirm; 1 of 21 bot creates was confirmed and 11 deleted. It gates review_rate and item_correctness.
- **Q3:** does an edit or a new position notify crew? Evidence: only a 10-15 code comment; unmeasured.
- **Q4:** what display_precision floor? With the patch: any request 95.8% dev / 100% clean; B42 74.1% / 66.7%.

**On your answers:**
- ship what you approve beside production, compared on the prospective set as it grows (§14 shadow);
- label a current-reader dev window;
- measure the reader.

The 40 pause-window emails are stored on or after 10-28 16:06Z, as ruled.
