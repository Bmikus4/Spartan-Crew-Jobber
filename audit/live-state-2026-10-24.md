# Production state, read 2026-10-24 (orchestrator)

These figures are not in the snapshot. They were read from production's database by the orchestrator. Every statement ran inside a READ ONLY transaction (`scripts/_readonly.mts`), and `proveReadOnly` showed a write being refused first. Only counts were read.

| query | result |
|---|---|
| `SELECT value FROM app_settings WHERE id='singleton'` (keys matching pause, write, send or bot) | `intake_paused: true`, `bot_writes_enabled: false` |
| `v2_decisions` per day and kind since 10-18 | 10-19: 4 write, 11 handoff, 64 none; 10-20: 9, 15, 47; 10-21: no rows; 10-22: 10, 15, 70; 10-23: 12, 9, 58; 10-24: 0, 2, 5 |
| `max(v2_decisions.created_at)` | 2026-10-24T22:18:05Z |
| `thread_messages` first seen since 10-21 | 353 (last 2026-10-24T22:35:37Z) |
| `v2_decisions` with kind=write since 10-21, by `executed` | 22, all `executed IS NULL` (nothing ran) |
| `thread_messages` first seen since 2026-10-23T02:00Z: count, rfc_message_id, in_reply_to, non-empty reference_ids | 169, 159, 138, 141 |
| model calls (decisions with `interpretation.meta`) and `cost_usd` per day, 10-14..10-24 | 3 to 103 a day. $0.031-0.033 each on anthropic/claude-opus-4.8 (10-14, 10-15); $0.005-0.010 each on openai/gpt-6.1-sol from 10-16; $0.02-3.42 a day |

**What the code says the settings mean:**
- `intake_paused` is read only by the TV, so that silence reads as expected (`app/lib/feed/serve.ts:44, :131`).
- Writes need both the Settings switch and `SPARTAN_WRITES=live` (`app/lib/v2/process.ts:33-36`).
