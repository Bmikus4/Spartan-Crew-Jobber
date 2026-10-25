AGENT: data-cartographer   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §6.6: map every data source, how they join, and the coverage numbers that
decide how deterministic client and order resolution can be.

INPUTS: audit/briefs/_common.md; table definitions in code (CREATE TABLE in app/lib/*Db.ts and
app/lib/v2/*.ts); the 2026-10-23 snapshot in .tmp-data/gold/.

OUTPUT: audit/data-map.md

SCOPE: You may read code and the snapshot files and run offline scripts under .tmp-v2/. Report,
with counts and denominators:
1. Every source and its fields: the email archive (thread_messages: Message-ID, In-Reply-To,
   References, Cc, attachment names, quoted text in the body; fill rates and since when),
   inbound_raw, outbound mail (our own messages: retained? the share whose subject carries an R
   or J number), OnSinch orders (fields, statuses including provisional / To Confirm,
   timestamps, places), staff actions (timeline.json: which actions; is confirming a To Confirm
   order logged and timestamped), v2_decisions, job_links.
2. How they join (the keys).
3. Sender to client (OnSinch company) coverage on client emails in the snapshot's last 30 days.
4. The distribution of orders per client (all statuses) for the clients who wrote in that window.
You may NOT connect to any live system.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will recompute 10% of your counts from the same files.
