COMMON TO EVERY PHASE 0 BRIEF (read first; it is part of the brief)

- Repo: C:\Users\thera\spartan-v2, branch v2, commit 6a98170. Live engine: app/lib/v2/ (process.ts
  decideMessage pipeline; interpret/extract.ts reader; interpret/interpret.ts grounding;
  interpret/plan.ts planner; bot/run.ts writer; links.ts and threadOrder.ts linking; reasons.ts
  decision codes; score.ts scorer). TV / display: app/lib/feed/ (live.ts, v2.ts, project.ts,
  serve.ts). Intake: app/lib/n8nInbound.ts, app/lib/inboundRawDb.ts, app/lib/threadMessagesDb.ts.
  Minute sync: app/api/bot/sync/route.ts. Legacy engine: app/lib/engine/ (v2 imports only onsinch,
  resolve, reason, metrics). Harness: harness/ (run.ts, adapters/spartan/*). Ticket feed:
  public/data/feed.json.
- Data (read-only, local, copied from production on 2026-10-23): .tmp-data/gold/ (messages.json,
  orders.json, timeline.json = OnSinch audit rows, decisions.json = v2_decisions, links.json,
  companies.json, places.json, truth.jsonl). Real-mail labels: data/gold/adjudications.jsonl.
- FORBIDDEN: .env.local or any credential; any network call (Neon, OnSinch, n8n, OpenRouter, Gmail,
  Vercel); any paid model call; git commit or push; editing any file other than your OUTPUT.
  Scratch scripts only under .tmp-v2/ (gitignored); delete them when done. The harness may be run
  only in-process, in oracle or mutant mode ($0), never through harness/run.ts (it rewrites
  tracked reports).
- PRIVACY: OUTPUT files are committed. Never write an email body, an email address, a person's
  name or a client company's name. Refer to emails by message_id, threads by thread_id, orders by
  OnSinch id or R number, companies by numeric id.
- Every claim carries a file:line, a count with its denominator, or a command that reproduces it.
- OUTPUT begins with: agent name, brief hash (given in your dispatch), UTC timestamp, then a
  summary of at most one page, then the detail.
