AGENT: red-team-A   PHASE: 0   MODE: read-only

GOAL: Find what is wrong with the Checkpoint A conclusions: every claim that is false, unsupported,
overstated, or contradicted by the code or data, and every conclusion that does not follow.

INPUTS: audit/briefs/_common.md; audit/alignment.md, audit/reconstruction.md and
audit/checkpoint-A.md (the conclusions under attack); audit/live-state-2026-10-24.md (production
counts read by the orchestrator, which you cannot re-read: judge whether the conclusions drawn
from them follow). To test them you may open anything they cite: the code at HEAD, the snapshot in
.tmp-data/gold/, .tmp-data/week-review-1014.json, .tmp-data/week-truth*.json, data/gold/, and the
cited audit/ and eval/ artifacts (treat those as claims to test, not as truth).

OUTPUT: audit/red-team-A.md: a one-page summary at top ranking the hits by how much they would
change the owner's decision, then one row per hit: the claim (quoted, with its file and line),
what is wrong, the evidence (file:line, a count you recomputed, or a script under .tmp-v2/ that
reproduces it), and severity: changes-the-decision / changes-a-number / wording.

SCOPE: You may read the inputs and code and run offline scripts under .tmp-v2/ (delete them when
done). Recompute at least the headline numbers of alignment.md yourself. Attack in particular:
1. The silent-miss count and the highest-leverage move: is the move backed by the taxonomy, is
   the expected gain arithmetic sound, could a different bucket be bigger?
2. The stabilization recommendation: is there a version that would be healthier than current
   production, and is the health check sufficient?
3. Any figure from generated mail or relabelled data presented as real-mail evidence.
4. The §17 answers: anything stated as settled that the evidence leaves open.
You may NOT propose fixes or a design of your own, edit any file except OUTPUT, or touch
production, credentials, the network, or git.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will re-run 10% of your hits from your evidence.
