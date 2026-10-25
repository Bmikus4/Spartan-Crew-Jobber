AGENT: archaeologist   PHASE: 0   MODE: read-only

GOAL: Trace one real client email end to end through the CURRENT code (OPERATING.md §6.2): every
stage, transform, model call, database write, OnSinch write, display admission and removal.

INPUTS: audit/briefs/_common.md; the code at 6a98170; one message_id from
.tmp-data/gold/decisions.json whose decision kind is "write" and one whose kind is "handoff".

OUTPUT: audit/pipeline-trace.md, with a diagram (mermaid or ASCII) of the stages.

SCOPE: You may read any file in the repo and run offline commands. Answer, each with file:line:
1. Per stage: input, output, failure modes, existing logging or trace.
2. Which choices code makes and which a model makes; every place a model chooses something code
   could have known.
3. Whether In-Reply-To, References and quoted text are read, and where.
4. Whether the client is resolved before opportunities (OnSinch orders) are considered, and
   whether candidates are scoped to that client.
5. Whether the system can output "no existing order, so a new order" and "not an inquiry".
6. How an item reaches the TV, what removes it, per-thread dedupe, and what happens to an item
   nobody confirms.
You may NOT fix anything, or judge whether behaviour is right.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will re-open 10% of your file:line citations and re-trace one
stage. Cite exact lines.
