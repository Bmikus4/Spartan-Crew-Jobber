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

## Gmail against the store for the 10-21 pause window (read 2026-10-25)

**Method.**
- A temporary n8n workflow on intake's Gmail credential ("Gmail account 14") listed message ids, thread ids, times and senders. It read no bodies. It covered intake's label (Label_5089401050847698788) and all received mail from 2026-10-20 20:00Z to 2026-10-22 06:00Z. It was deleted straight after.
- The ids were compared with `thread_messages` in a READ ONLY transaction.
- The pause window runs from the last intake run, 2026-10-21 01:05:34Z, to the first capture after it, 2026-10-22 00:25:37Z.

| in Gmail during the pause window | stored | not stored |
|---|---|---|
| client messages | 27 (first seen 10-22 00:25 .. 10-23 16:46; all 27 decided) | **40** |
| our own messages | 17 | 47 |
| system senders (no-reply etc.) | 0 | 3 |

**The 40 unstored client messages:**
- All carry intake's label, so intake would have taken them had it been running.
- They sit in 19 threads, from 19 senders. 13 are one sender's burst in one thread (1a15f2d1b680ef15) within about 22 seconds.
- 23 of them resolve to 13 OnSinch companies by the production sender rule: 128 (4); 582, 31, 354, 157, 51, 765 and 267 (2 each); 137, 572, 324, 293 and 214 (1 each).
- 35 of the 40 have a reply from our mailbox later in the same thread, inside the window.
- 9 of their 19 threads are known to the store from other messages.

**Why they were missed.**
- Intake's schedule looks back 10 minutes (node "-10 mins").
- The manual catch-up looks back 72 hours (node "Sweep last 72h"). On 10-25 that reaches only to about 10-22 13:30Z, so it can no longer cover the window.

Message ids: 1a15d51365a3f269, 1a15d9c4128b282c, 1a15db33e5230766, 1a15dc2966237ea2, 1a15dcf39539d6db, 1a15dd738e4dc258, 1a15ddaf73ec4adf, 1a15ddbb50971e23, 1a15de74dc08a271, 1a15de7fc7ea0620, 1a15e03ff9e9d96f, 1a15e0eaaf48a904, 1a15e106e61fbab0, 1a15e1cf2eb9a97c, 1a15e1ff3d47c64d, 1a15e2c7c36aed63, 1a15e362d97bfefc, 1a15e37ca2297d70, 1a15e38408d60d82, 1a15e39b1e22f7b5, 1a15e3d5f5bed7c2, 1a15e4d209cb48ec, 1a15e52571f3c647, 1a15e60f5b220f65, 1a15ed22f3da04a7, 1a15ee0ce222d4cb, 1a15f1f2730d54d6. The 13 burst messages are 1a15f2d1b680ef15 .. 1a15f2d71b99b156.
