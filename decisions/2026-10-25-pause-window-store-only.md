# 2026-10-25 The 40 unstored pause-window emails are stored, not decided

**Decided by:** the owner, choosing between two options: store only, or send them through intake to be decided in shadow.

**Words:** "store them without deciding"

**The emails.**
- 40 client emails, sent between 10-21 01:05Z and 10-22 00:25Z.
- They carry intake's Gmail label but are not in `thread_messages`.
- Ids are in audit/live-state-2026-10-24.md.
- Intake's catch-up looks back only 72 hours, so nothing else will ever store them.

**How.**
- `scripts/backfill-pause-window.mts` has three steps:
  - `pull`: a temporary n8n workflow copies intake's own nodes and returns each thread's payload, then is deleted.
  - `plan`: reads only.
  - `store`: calls `captureInboundRaw` with source `backfill`.
- `/api/n8n-inbound` is not used, because its `decideDelivery` decides whatever a delivery stores first.

**Why the store waits until 2026-10-28 16:06Z.**
- The minute sync's `sweepUndecided` (app/lib/v2/process.ts) decides any client email first stored within 24 h and sent within 7 days.
- Stored any earlier, the 40 would get a model call each and appear on the TV, which is the outcome the owner declined.
- The safe time is the newest of the 40 (10-21 15:56:15Z), plus `UNDECIDED_SENT_WITHIN_DAYS`, plus 10 minutes. The script reads that constant from the source and refuses to store before the time.
- After that time the follow-up board also treats the waits as dormant (`DORMANT_AFTER_DAYS = 7`).

**Scope (from the `plan` step, read-only, 10-25).**
- The store writes 82 messages: the 40, plus 42 of our own messages in the same threads, so each thread reads as it happened.
- 82 messages in those threads are already stored.
- One more unstored client email, 1a0fd08e33c98bd9 (10-02, the first message of one of these threads), is left out. It is outside the ruling.
- Payloads are in `.tmp-v2/backfill-payloads.json` (gitignored). The store step needs no n8n key.

**Verification after `store`:**
- 40 of 40 are in `thread_messages`.
- 0 of 40 have a `v2_decisions` row, re-read a few minutes later.
