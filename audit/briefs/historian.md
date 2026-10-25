AGENT: historian   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §6.3: original design intent, what changed and why, every prior ruling's
status, and why earlier plans believed 99% was reachable.

INPUTS: audit/briefs/_common.md; the repo's git log; docs/ (dated plans); DECISIONS.md,
HANDOVER.md, ASSUMPTIONS.md, README.md, CLAUDE.md; harness/STATE.md, harness/README.md;
public/data/feed.json (tickets S-0001 to S-0217); C:\Users\thera\fleet\resume\Spartan-*.md
(session handoffs); C:\Users\thera\fleet\resume\Spartan-Crew-Review-Addendum.md (an outside
review, 2026-10-23); C:\Users\thera\Desktop\Spartan-Crew-Enquiry-Engine-Developer-Handoff.pdf
(systems overview); rulings in code comments (search "Ben", "approved", "ruling", "decided").

OUTPUT: audit/history-and-assumptions.md

SCOPE: You may read the above and run offline commands. Deliver:
1. A dated timeline of design intent and major changes.
2. A table of every ruling you find: date, source, the ruling in brief, status = enforced (cite
   code) / dead / contradicted (cite what contradicts it).
3. Every plan that promised or targeted 99% (including the matcher plan's "99% accessible
   accuracy" and the harness's 10-10 "494/500"), the assumptions each rested on, and which ones
   later data or tickets contradict.
4. Candidates for "the previous known-good version" (a tag, a commit or an engine), with evidence.
5. The origin of the figures 227/500 and 114/500 (tickets, harness runs, handoffs).
You may NOT judge what should be built.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will check 10% of the ruling rows against their cited source.
