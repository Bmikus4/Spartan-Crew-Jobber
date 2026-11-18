# 2026-11-17 Eight rulings that open the data-home program; what each supersedes

**Decided by:** the owner, 17 Nov, in the prompt "Spartan v2: data home, full audit and rebuild". That prompt
governs the work from here, in order: (1) one data home holding everything pulled from OnSinch and the mailboxes,
(2) a read-only audit of the whole repo and its data use, (3) matching rebuilt so the TV is accurate, (4) creates
and updates back behind settings, (5) last, the move off n8n. Each phase ends at a stop that needs the owner's
written yes. These rulings override older docs, ADDENDUM.md included.

Four words, because earlier documents blur them:
- **Tick:** a person marks a TV card handled. It writes nothing to OnSinch.
- **Confirm:** the button on a TV card. Today it is a tick. Later it books the system's plan in OnSinch.
- **Confirmed (in OnSinch):** an order's status, as opposed to provisional. Not the button.
- **Plan:** the write the system would make in OnSinch for an email.

| id | ruling | supersedes |
|---|---|---|
| O35 | **Confirm.** It is a tick today, so O32 stands for now. Once a write type is enabled in settings, Confirm books the system's plan in OnSinch for that type. | Restores O6's "a person's Confirm always books" per write type, and only once that type is enabled. O32 holds until then. |
| O36 | **Settings: two switches,** Enable creates and Enable updates, each with its own day window. Both off. Built in Phase 5, not before. | Replaces `create_lead_enabled`, `create_lead_days` and `create_lead_applies_to`, and makes O8 unnecessary (O8's flip to "both" is not done). V14 ("only creating orders more than two weeks out, all updates still enabled") is replaced by the two windows. How the switches relate to `SPARTAN_WRITES`, `bot_writes_enabled`, `order_mode` and the O34 ladder is open (decision F). |
| O37 | **Creates stay manual for now.** Not permanent: they must be enableable when the data supports it. | O20 ("we shouldn't be creating or updating jobs ourselves live") stands, but as a state, not a permanent rule. O34's route for creates (only into To Confirm, after B5 and B8) is unchanged. |
| O38 | **O7 is to be retired.** "A moved start keeps the end" goes once Phase 2 has measured from the raw timeline what staff actually do. | O7, and ADDENDUM §12.7 item 1. The code still runs V4 (a moved start keeps the length); nothing changes until the measurement. The figure "kept the length 157, the end 29" (9-28 Oct) was read from docs, not measured, and is not used. |
| O39 | **Email alarms are removed completely.** No alarm email goes out from the app or from n8n. | The owner-email half of `app/lib/errorReport.ts` (off today only because `SPARTAN_ERROR_NOTIFY` is unset), CLAUDE.md step 7's "raises ... to the owner", and O34's "raises the ladder-rollback route to the owner" as an email. The n8n Spartan Alarms and Spartan Intake Watchdog workflows (both deleted late 17 Nov, history in n8n/retired/2026-11-17/). The code that could still send is removed in Phase 3; nothing is deleted before Stop 2. What signals an outage instead is open (decision E). |
| O40 | **Moving off n8n is the last task in the project.** Assume intake and the Gmail credential are solved; Paz is setting up the Gmail grant. Two things are not part of the move and happen early: capturing n8n's execution history before it expires (about 30 days are kept), and the owner renewing the n8n key before 5 Dec. | The 16 Nov fix order that put "the app's own Gmail poll removes n8n from the path" first. ADDENDUM's switch-over items move to the end of the program. |
| O41 | **No automatic confirmations.** The system may infer a confirmation and show it. It does not act on that inference. The display is a UI bubble, designed in a separate session. | Narrows anything that would book or confirm on an inferred agreement. Its exact scope is open (decision B). Working assumption until then: the system never moves an order from provisional to confirmed in OnSinch, and never treats a client's agreement as final by itself; the done lane, where a card closes because staff's work was found in OnSinch, stays until the owner rules. Whether O27's "agreed" exit and O30's yes-signals fall under B is part of B. |
| O42 | **Ease of use.** When two designs are otherwise equal, pick the one with fewer manual steps for staff. | Nothing; a tiebreaker for every later design. |

## Open, with the working assumption that holds until the owner answers

Nothing that depends on one of these is built before its answer.

| | question | working assumption | asked at |
|---|---|---|---|
| A | Which side of the day window is automatic | Jobs starting more than N days away are written automatically; jobs within N days go to staff with a plan and a Confirm | Stop 1 |
| B | What "no automatic confirmations" covers | As in O41 | Stop 1 |
| C | Which mailboxes to pull | bookings@ in full; paz@, jenny@, info@ and accounts@ only with Paz's explicit yes, because they are people's mailboxes | Stop 1 |
| D | Where the data home lives | The builder's proposal, with size and cost; never in production's app tables | Stop 1 |
| E | The outage signal now that email is gone | The TV's red banner is the only signal, and nobody is known to watch it | Stop 1 |
| F | How the two switches relate to the five gates that exist | One model a person can explain in two sentences, proposed at Stop 2 | Stop 2 |
| G | Smaller rules: a PO alone is not a "change"; O10 as the bot's default, not a rule; crew chief on "add 3"; old threads reused for a new job; R17 | Measured in Phase 2 and proposed; none built | Stop 2 |

## Rules for the program

- Live systems are read-only: OnSinch GET only; mailboxes read only (no label changes, no marking read, no drafts,
  no sends); n8n GET only (a PUT strips credentials). No setting is toggled.
- Production's database is read only through `scripts/_readonly.mts`. The data home is the only place data is
  written, and only after Stop 1.
- Before Stop 2 the only ships are this file and the label-alarm fingerprint fix. Nothing is deleted before Stop 2:
  no files, rows, tables, worktrees or local copies.
- Nothing staff see changes without the owner's and Paz's yes (O4).
- The running state of the program: `C:/Users/thera/fleet/resume/Spartan-Program-State.md`.
