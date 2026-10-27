# Assisted cards and the learning loop: design (ADDENDUM Prompt 7, R13)

**Status:** a design; nothing here is built. Building it changes what the TV shows, so it needs the owner's and Paz's
yes (ADDENDUM §0).

**The build condition** (Prompt 7) is that most remaining handoffs are near-misses.
- **Measured** on the dev replay at bc3944b ($0, offline, 561 emails, `eval/harness/runs/all-replay-dev.json`):
  155 handoffs, of which at most 90 (58%) are near-misses (§1).
- The 58 in class A are exact: the planner already holds the whole change.
- The held-out week (E3, from 29 Oct) is not read until a fix is frozen, so this is the dev number only.

## 1. Which handoffs are near-misses

| class | reason codes (`app/lib/v2/reasons.ts`) | dev replay | what is missing |
|---|---|---|---|
| **A. a complete plan held by policy** | policy_lead_days 54, policy_confirmed_proposal 4 | **58** | a person's yes; the ops exist |
| **B. one fact unproven, a candidate in hand** | reading_unproven 17, booking_not_identified 15 (only those with a lead order) | **at most 32** | which order or which value |
| not a near-miss | reply_detail_missing 16, reply_unclear 11, reply_quote 2, request_unsupported 9, client_unknown 5, booking_not_found 3, request_inconsistent 2, policy_past_day 2, booking_link_unreadable 1 | 51 | the client, or work the system does not do |
| a replay limit, not a handoff | system_failed 14: client emails with no stored reading | 14 | |

**Class A is built first:**
- Its card would carry exactly the ops the bot would have run.
- A Confirm is the owner's own rule with a person in the loop. A new order inside the lead days stays staff's to make
  (DECISIONS V14), and staff make it by pressing Confirm.
- Class B needs the candidate list on the card. It follows once A has run for a week.

## 2. What the card shows
- **The proposed change**, in the words a write card uses today (`Decision.why`):
  - the order, or "a new order";
  - each day, its times, crew and trade;
  - the venue.
- **Why it was not done**: the one blocking reason, as the card already shows it (`reasons[0]`).
- **Class B only:** the lead order and the others that fit, each with the fact that is missing.
- **Three buttons:** Confirm, Edit, Reject.

**The data:**
- The planner returns the change with the handoff: `{ kind: "handoff", reasons, proposal?: { ops, why } }`.
  `Decision` (`interpret/plan.ts:42`) gains the optional field.
- For lead days, `plan.ts:903-904` returns the handoff before the create's ops are built. The check moves to after
  they are built, and the ops become the proposal.
- The proposal is stored inside `v2_decisions.decision` (JSONB), so there is no migration for it.
- The re-plan (`replan.ts`) keeps it current like any other answer.

## 3. Confirm, Edit, Reject

**Confirm** (`POST /api/feed/confirm { message_id, shown }`, where `shown` is the opKeys the card displayed):
1. Read the decision row again. Recompute the opKeys of the proposal now stored (the re-plan's answer, if there is
   one).
2. Refuse if they differ from `shown`: the card was stale, nothing runs, and the card redraws.
3. Run each op through `runOp(source, op)`, the bot's only path (`app/lib/v2/bot/run.ts:253`). Its source is the
   decision's own (`message_id#n`), so the op ledger runs a seen key once, a double click included.
   - The ledger, the read-back diff and the To Confirm filing for a create are unchanged.
   - Both write keys still apply: SPARTAN_WRITES=live and bot_writes_enabled. With writes off, Confirm answers "writes
     are off" and runs nothing. Whether a person's Confirm should need the Settings switch is question 1 below.
4. Append the results to `v2_decisions.executed`. The card becomes the check card a bot write makes today
   (created-check, updated-check).

**Edit:**
- Opens the proposal's fields, prefilled: order, day, start, end, crew, venue.
- The edited change is built by the same op builders (`bot/ops.ts`) and passes the planner's refusals that are not
  about the email's words: a past day, an ambiguous shift, staff's own edits.
- It is then confirmed as above. The proposal and the edit are both stored.

**Reject:**
- Does what the tick does today (`feed_marks` checked, `app/lib/feed/check.ts`).
- Asks one reason: wrong order, wrong change, not a request, or staff did it.

## 4. Each answer as an anonymised harness case
- **A new table `v2_assist`** (migration 088), one row per answer: message_id, action (confirm, edit or reject),
  proposal (JSONB), final (JSONB, the ops that ran, or none), reason, actor (SHA-256 with SPARTAN_TRACE_SALT), at.
- **No email text.** The email is already in `thread_messages`, and a case names it by id, as
  `harness/DATA_POLICY.md` sets out for live data. Kept with the decision; the trace's 90 days do not apply.
- **Export:** `scripts/export-assisted.mts` (read only, `scripts/_readonly.mts`) writes
  `.tmp-data/gold/labels/assisted.jsonl`, one line per answer: `{ id, gold: final ops | "none", action, reason }`.
  The gold copy already holds the messages and readings, so `harness/real` can replay each case for $0.

## 5. The regression set
- **Every Edit and Reject is a disagreement,** and so is a Confirm of a class B card whose lead was not the
  confirmed order. Each joins the regression set; Confirms that agree join it too, as passes to keep.
- **`harness/real/run.ts --mode replay --labels assisted`** scores the current planner on the stored readings against
  them.
- **`test/harnessGate.ts`** gains the floor "every assisted case still passes". The session gate runs it, so no
  planner change ships past a case a person settled.
- **A prompt or model change** first re-reads the cases, which is a paid run and needs the owner's yes. The replay
  then scores the new readings. It ships only if every past case passes.

## 6. Files it would touch
| file | change |
|---|---|
| `app/lib/v2/interpret/plan.ts` | `proposal` on the lead-days and confirmed-proposal handoffs (A), on booking_not_identified with a lead (B) |
| `app/lib/feed/v2.ts`, `app/lib/feed/project.ts` | FeedItem carries the proposal, its opKeys and the class |
| `app/components/LiveFeedScreen.tsx` | the three buttons and the Edit form (the owner and Paz) |
| `app/api/feed/confirm/route.ts` (new) | authorizeAction, then `app/lib/feed/assist.ts` |
| `app/lib/feed/assist.ts` (new) | confirm, edit and reject, with runOp and the store injected |
| `app/lib/migrations.ts` | 088 `v2_assist` |
| `scripts/export-assisted.mts` (new), `harness/real/run.ts`, `test/harnessGate.ts` | the regression set |
| `app/lib/v2/bot/run.ts`, `bot/db.ts` | **unchanged**: runOp, the ledger and the read-back are the only write path |

## 7. The test that proves a confirmed card writes exactly what was shown
`test/assistConfirm.ts`, on PGlite, with runOp injected:
1. A lead-days email is planned. Its card's proposal is the create the bot would have sent: the same opKeys as the
   write the planner makes with lead days off.
2. Confirm with the card's opKeys calls runOp once per op with exactly those ops and sources, records the results,
   and turns the card into a check card.
3. A second Confirm runs nothing new (the ledger answers "seen").
4. A stale card is refused with nothing run: the re-plan has changed the proposal since it was shown.
5. With either write key off, Confirm is refused with nothing run.
6. Edit changes only the edited field's op. Reject runs nothing and stores the label.
7. `v2_assist` holds no email text and no plain address.
8. Control: with the opKey check removed, the stale card runs, and the test goes red.

## 8. Questions for the owner (and Paz)
1. Does a person's Confirm need the Settings switch bot_writes_enabled, or only SPARTAN_WRITES=live? Recommended:
   both at first, so no new write path opens while writes are off.
2. Class A first (lead days, confirmed proposals), then B after a week? Recommended: yes.
3. Who may press Confirm: any signed-in member of staff?
4. The TV's layout for the buttons and the Edit form (Paz).
