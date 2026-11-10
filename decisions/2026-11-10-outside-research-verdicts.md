# 2026-11-10 Outside-research verdicts: two adoptions, seven library rejections, no stuck-op sweeper

**Decided by:** the 10 Nov research mission (spartan-research/08-outside/, four findings files), under the
owner's standing constraints: Vercel serverless + Neon + TypeScript + a minute cron, no new heavy infra,
and a library earns its place by deleting our code. Recorded here with the fold-v2 ship so each class is
not re-evaluated the next time someone reads a vendor blog.

**No stuck-op sweeper.** 08-outside/02 queued a sweeper for bot_ledger rows stranded in a non-terminal
state. Measured in production first (spartan-research r24, 10 Nov): zero exist — every row is verified
(134), blocked (22) or mismatch (3). The ledger's probe-before-repost + content-hash design is already
the outbox pattern; nothing to build. If a non-terminal status is ever added to the ledger, that row
count is the first thing to re-check.

**Adopted, pending the owner (HANDOFF §5):**
1. OpenRouter `response_format: json_schema` with `strict: true` + `provider.require_parameters: true`
   in extract.ts, replacing `json_object` + the brace-slice recovery. Deletes the "no JSON object in the
   answer" failure class, zero dependencies. Waits on B9 (a few cents of live verification; cap rule).
2. chrono-node **offline only**, in the research tree, as a miner that buckets the ~146 grounding
   refusals into named-gap / correct-refusal / not-a-date. Never in production: it guesses where
   ground.ts refuses, and the refusal semantics (sent-year rule, weekday contradiction → null, DST
   throws) are the product.

**Rejected, with the constraint that killed each:**

| class | candidate | killing constraint |
|---|---|---|
| structured extraction | instructor-js / outlines / BAML | re-asks are paid calls we refuse by design; constrained decoding needs model control OpenRouter does not give; a DSL adds a layer, deletes nothing |
| email parsing | mailparser | stream pipeline, not serverless; its author points new work at postal-mime |
| email parsing | postal-mime | credible rfc822.ts replacement, but rfc822.ts has no attributed defect; named fallback — port on its first real mis-parse, never patch |
| record linkage | splink / dedupe | built for 10⁷–10⁸ rows; we match dozens of senders against hundreds of companies — an alias table and the order-code join are the fix |
| Postgres queueing | graphile-worker / pgmq | needs a persistent worker / unconfirmed Neon extension; our one queue-shaped thing is already one atomic INSERT … ON CONFLICT |
| durability | Temporal / Inngest | server cluster is heavy infra; Inngest routes event payloads through a third party across the PII boundary just audited shut |
| LLM eval harness | promptfoo | judge-verdict assertions are what the 9 Nov no-labels ruling outlaws; runs beside harness/, deletes nothing |
| data quality | great-expectations / soda | a second language runtime to detect what our gate checks prevent |
| constraint scheduling | Timefold / OR-Tools | JVM/C++; crew allocation is OnSinch's and the staff's job, not the mission — deferred entirely |
