AGENT: card-anatomy   PHASE: 0   MODE: read-only

GOAL: Say exactly what a TV card shows staff today, and what happens to it over time, so that the
orchestrator can propose OPERATING §10's aging policy and the minimal change that makes flagged items
distinguishable and shows their top-3 candidates and evidence. Describe; do not propose.

INPUTS: app/lib/feed/ (v2.ts, project.ts, serve.ts, cardNote.ts, order.ts, check.ts, live.ts,
verify.ts, marksDb.ts), the TV screen component (find it: grep LiveFeedScreen), app/lib/v2/feed-related
code that builds a card's note, app/lib/mail/threadLabels.ts. audit/pipeline-trace.md §6 and §8 for
what is already established (cite it; do not redo it).

OUTPUT: audit/card-anatomy.md: agent name, brief hash, UTC timestamp, a summary of at most one page, then:
1. Fields: every field a card shows on screen, with where it comes from (file:line). Say whether a card
   shows: the order it thinks the email is about; any alternative candidates (a top-3); the evidence for
   the pick; the change the system proposes (ops, days, times, crew); the reason it needs a person
   (reason text or code); whether the card is a needs-created, needs-updated, needs-reply or other kind.
2. Flagged vs confirm-ready: is there any visual difference between a card for something the system
   could not do and one it could? What colours, lanes and labels exist, and what each means.
3. Lifecycle and aging: when a card appears; every way it turns green or leaves (tick, staff edit,
   order found, replan to none, job day passed, dwell); every timer and threshold (follow-up, quiet,
   dwell) with its value and file:line; what happens to a card nobody touches, day by day, until it leaves.
   Can a card leave without anyone seeing it go? List each such path.
4. Status model: which of §10's statuses {confirm_ready, flagged, confirmed, suppressed} map to which
   current kinds and marks; where a future rejected/held state with a reason would sit.

SCOPE: Read the repo. Run read-only commands (grep, wc). You may NOT read .env.local, call any API or
the network, run the app, the gate or the harness, commit, or write any file but OUTPUT.

BLOCKED: If something can only be known by running the screen, say so and move on.

VERIFICATION: The orchestrator will re-open at least 10% of your file:line citations.
