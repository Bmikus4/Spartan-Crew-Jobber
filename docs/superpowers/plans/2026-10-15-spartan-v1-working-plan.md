# Spartan V1 working plan

Spec: the "Spartan V1 Master Plan" doc (https://claude.ai/artifact/HFfojdoGiw67o84WwAtUet),
section "Settled on 15 Oct". Every rule below traces to a line there or to a measurement
named beside it. Where this file and the doc disagree, the doc's settled table wins.

**The offer:** an enquiry becomes a created or updated OnSinch order, written by the
browser bot, in 5 minutes, with no more than 1 failed email in 100. **The effect we measure:**
the share of bookings staff never have to touch.

## Global constraints

- Vercel only. Bot logs in as user 2257, automation only.
- OpenRouter spend cap $20 for testing. Never validate through paid record runs.
- Benches only on TEST company 515. Only TEST orders are deleted, plus the seven Ben
  approved on 15 Oct (R11597, R11600, R11611, R11612, R11615, R11514, R11521) after checks.
- Never press PUBLISH AND ANNOUNCE. Card changes only through the builder Job form.
- `scripts/session.py` is the only commit and push. No source edits while it runs.
- No emojis. Never present a rule I made as Ben's.

## What the data says (10-15, read-only mining of 2,000 orders, 3,145 staff shifts)

| Process | Finding | What it changes |
|---|---|---|
| Crew chief | Ben's rule matches ops on 96.0% when every seat counts (drivers, trades) | Shipped S-0184 |
| Staffed positions | `/attendance` status 2 is an OFFER (slot 59917: 94 rows, 2 people). 0 assigned, 3 confirmed, 1 unknown | Shipped S-0184: only 0/1/3 count |
| Size cuts | OnSinch does not block a cut below workers; staff cut first, remove workers after (22 of 39 within a minute) | Worker drop = cut, then remove |
| Shift length | Most specific history wins: company+venue+start 90.4% right when 7 of 10 agree; company+venue 85.3%; company 70.1% | Assumption engine order (W1.3) |
| Carpool | Out-of-London is a precondition (73% of carpool shifts) but only 31% of such shifts get one; 1 seat whatever the size | No automatic carpool. Data only |
| Professions | 39% of clients book only crew + chiefs; a few always one trade (279: MCR on 111/120) | Ben: unmatched = Crew, no matter what. No inference |
| Approval | `request_approval` never clears (#16607 worked and still "1") | Adoption cannot be read from it (W4) |
| Approval proxy | `order_confirm_provisional` (data.id = order NUMBER) plus a staff `attendance_create` | Truth store event (W4) |
| Adoption | Since 10-12: 1 of 8 real bot orders adopted; 7 re-keyed by staff 10-30 min later, 2 of them IDENTICAL | The order being right is not enough: staff do not see it. Labels + TV (W5) are the fix |

The last row is the most important line in this file. Two identical re-keys mean the hand-off
channel failed, not the order. Staff work from Gmail. A thread that says "Order Created R11xxx"
in the inbox is what stops a re-key.

## Core contracts (the surface every workstream builds against)

- `Op` (`app/lib/v2/bot/ops.ts`): grows by `set_profession`, `set_role`, `cancel_order`,
  `drop_worker`. A new kind ships with its contract fill, preflight, read-back and a TEST probe.
- `Decision` (`plan.ts`): `write | handoff | none`. Every handoff reason is a sentence a person
  can act on. A default the bot assumed is a `why` line beginning `assumed:`.
- `RunResult` (`run.ts`): `verified | mismatch | refused | blocked | unknown | busy | seen`.
  `unknown` is final for the bot.
- `ThreadState` (W5): one of `created | updated | needs_created | needs_updated | none`, plus
  `follow_up: boolean`. Derived from decisions + truth events, never stored by hand.
- `TruthEvent` (W4): a row per OnSinch timeline action that matters (create, change, confirm,
  attendance, cancel, delete), with order id, slot id, who, when. Ingested every minute.

## Workstreams (they run side by side; each item ships alone through the gate)

### W1 Rules in code
1. DONE S-0184: chief rule at every size; staffed time changes; lead days setting; year fix.
2. No venue -> place 6922 "No Location", flagged `assumed: no venue written`. Today: `ask("no venue in the email")` in plan.ts.
3. Missing times. No start -> 08:00 flagged. No end -> the assumption engine: the client's last
   10 shifts at (venue, start), else (venue), else (client); 7 of 10 agreeing gives that
   length, flagged with the key and the count; else 4 hours, flagged. Lives in a new
   `app/lib/v2/interpret/assume.ts`, pure, fed `clientOrders`. Test on the 10-15 fixture
   numbers. The interpret.ts problem "no end time or duration the client wrote" becomes an
   assumption for a create, stays a question for a change.
4. Ambiguous venues ("N OnSinch venues are named"): the client's most recent of them; else
   hand-off as now.
5. Staff got there first: before a create, look for a staff order for the client on the
   same day whose window or venue or headcount matches (date plus one more fact, never date
   alone). Found: link the thread, apply only what that order is missing, go quiet.
6. Quote requests that list shifts become orders (the code path exists; check it fires).

### W2 Writer completeness
1. Worker drops (`drop_worker`): cut the size, then remove workers. Order: assigned-not-
   confirmed (status 0) before confirmed (3), then most recently assigned. Never the same
   worker twice in 30 days if another can go (`bot_drops` table). Log by name. TEST probe
   first, with a worker on a TEST position that is NOT a real person's phone.
2. Busy retry: `retryStopped` retries only `blocked`; `busy` must retry too.
3. Professions and roles as ops; whole-shift time moves; order cancel.
4. Hourly canary on TEST; alarm on two failures in a row.

### W3 Reading and deciding
1. Code extractor (dates, times, counts, R/J numbers, venue strings) -> GPT-6.1 Sol
   (`openai/gpt-6.1-sol` via AI Gateway, OpenRouter fallback) -> deterministic gate.
2. Validate Sol on 100 labelled emails (about $1) before it decides live.
3. Attachments into the n8n intake, shadow first.

### W4 Truth store and adoption
1. `onsinch_events` table filled each minute from `/timelineAudits` (oldest first, `id[gte]`).
2. Adoption per bot order: adopted (staff assign workers or confirm), re-keyed (staff order
   same client and day within 2 hours), deleted, untouched. Into the gate's measurements.

### W5 Thread state, TV, Gmail
1. One projection: thread -> `ThreadState`. The TV and the labels both read it.
2. TV: "Needs action" (failures only) and "Everything" (successes until the last shift ends).
3. n8n workflow, every minute: GET the app's thread states, set the four exclusive labels
   + Needs Follow Up, strip HIGH/MEDIUM/LOW/SamurAI/TEST on bookings threads. Rename old
   "Order Built"/"Order Needs Built". Dry run to Ben first. Back up and delete
   hPzXzzislJccCAJV.

### W6 Clean-up and ops
1. Delete the seven approved orders after checks (creator 2257, To Confirm, no attendance).
2. AI Gateway billing; balance alarm below 3 days.

## How I work this plan

1. Pick the next item by what it unblocks for the offer, not by its number.
2. Measure before the change (a number from live data), test first, then build.
3. Ship each item alone through the gate, with the number in the ticket.
4. Verify live by looking at OnSinch or the TV, not at our logs.
5. When two problems share a cause, fix the cause and say so in the commit.
6. After all W1-W6: the end-to-end harness that proves the BROWSER BOT wrote each order
   (OnSinch's own timeline rows by user 2257 and builder saves), then the 2-page report,
   then pause.
