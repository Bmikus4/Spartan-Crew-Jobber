# 2026-10-25 Only the bot's creates and updates are paused

**Decided by:** the owner, asked why intake read as paused.

**Words:** "the only thing that should be paused are job and order update and creates"

**Done the same day (commit 8f05615):**
- Settings `intake_paused` true -> false, through `saveSettings`; no other key changed.
- n8n Intake Watchdog `baVlgOkVMCpvj1N7` activated.
- `bot_writes_enabled` stays false.

**Why the flag was wrong.**
- `intake_paused` was set at 02:40 UTC on 10-21, so the TV would read "Intake Paused" while n8n intake was off.
- Intake resumed at 00:25 UTC on 10-22, but the flag stayed on.
- The flag is read only by the TV (`serve.ts:44, :131`). It also suppressed the intake-stale alarm (`serve.ts:140`). So for three days staff were told intake was off while it ran, and a real outage would have stayed silent.

**Constraint:** lifting a pause means clearing `intake_paused` in the same change that turns the n8n workflows back on.
