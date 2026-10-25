AGENT: glossary-verifier   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §3 checked against code and data, and the order-to-job confirmation rule
found (OPERATING.md §17 Q1).

INPUTS: audit/briefs/_common.md; OPERATING.md §3 and §17; the code; the snapshot (orders.json,
timeline.json, companies.json).

OUTPUT: audit/glossary.md

SCOPE: You may read code and snapshot files and run offline scripts under .tmp-v2/.
1. For each §3 term (client, sender, opportunity, order, job, inquiry, change, item, confirm,
   display): what it is in code and data (file:line, table and field), and every discrepancy
   with §3.
2. Settle Q1 with evidence: when the bot creates an order, does a person have to confirm it (To
   Confirm, request_approval, provisional; see app/lib/v2/bot/apiCreate.ts)? Do the bot's edits to
   existing orders need any confirmation? How often are To Confirm orders confirmed, by whom
   (user id only), and how fast (timeline.json, order_confirm_provisional)?
3. Compare the §3 per-email decision set with the decisions the code actually makes.
You may NOT propose changes.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will check 10% of the term mappings at their cited lines.
