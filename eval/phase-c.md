# Phase C: current-mail correctness (10-26)

Orchestrator. The owner, 10-26 evening: "go one by one, and you'll now finish the next phase. And then after that is done,
you'll finish the phase after that. You'll take good notes along the way of each phase."
- **The next phase** is the block in eval/next-block.md (N1-N3), closed 10-26.
- **This is the phase after it**, chosen from the failures that phase found on current-reader mail (dev-2, 233 of 238
  read by gpt-6.1-sol) and from the evening's TV check (audit/verification-2026-10-26.md).

Sandbox only (C:/Users/thera/spartan-v2-n1), $0. **Nothing deployed, writes off.** Held as
`eval/patches/c-current-mail.diff`, stacked on n2-planner-ops.
The five held diffs applied in order on 305bf84 in a clean worktree pass tsc and all 227 test files (10-26).

## What it fixes

| # | failure | evidence | fix | test |
|---|---|---|---|---|
| C1 | **A create books a new or unused place** where staff used an existing OnSinch venue | 4 creates on dev and dev-2: new place 3, unused exact-name duplicate 1 (place 7083, no booking ever) | When no place matches by name, or only places the client never booked, take the one place this client books, else the one OnSinch place with an address, whose name words and the email's share two or more, one set holding the other. Two or more such places: unchanged. The order says it assumed so (default_venue_assumed). | test/planVenueClientHistory.ts: 7 checks, 5 red unfixed |
| C2 | **PO writes judged wrong** that production itself had made | 3 dev-2 POs. Each order still holds the email's PO, set by the bot before the 10-21 pause, with no staff edit since. | Measurement: an email whose production decision ran a write counts the bot's audit rows as done (harness/real/writes.ts). A staff reversal nets them out. | test/harnessWrites.ts (+1) |
| C3 | **An email the reader could not read stays a card forever** | 1a144c619a140ea6, OpenRouter 429, 10-23, red on the TV 3 days. The only read failure ever recorded, of about 950 decisions. | retryUnread (process.ts), called by the minute sync: read again 5, 15 and 45 minutes on, 3 tries at most, within the sweep's 7 days, 2 per minute | test/retryUnread.ts: 8 checks (PGlite, stub reader) |

**Measured** ($0, offline, the fresh copy):

| | before phase C (after N2) | after |
|---|---|---|
| dev writes, 23 (none-derivable included) | 13 completed, 4 partial, 6 wrong | **14 / 4 / 5** |
| dev-2 writes, 20 | 7 / 2 / 11 | **10 / 2 / 8** |
| dev B42 recall | 133/184 | 133/184 |
| dev-2 B42 recall | 60/69 | 60/69. Items shown 61 → 62; B42 display precision 88.5% → 87.1% (the N2 hand-off) |

- **C1 venue on its 4 cases:**
  - 1a13438a3dd67400 (dev) is now completed;
  - 1a15984719fbd60e (dev-2) now has the right venue, but staff's crew mix (2 drivers) still differs;
  - 1a15984f57ab3251 has 4 places that fit, so no guess is made;
  - 1a14063b8d8dd75c: the email's venue word is in neither the place's name nor its address.
  - **Why not more:** in 3 of the 4, the client had never booked the place before the email. The only order using it is
    the one staff built for that email, so the client's history cannot help.
- **C2** is a scoring artefact, not a planner fault. Production's POs were right.
- **C3** fires on one email in the record. It moves the TV's one system-failure card out of the staff's way once a retry
  succeeds.

## What is still wrong on current mail (dev-2, 8)

- **Create shift shapes, 3:**
  - 1a153e512dae2620: three 1 h shifts against staff's two 2 h shifts;
  - 1a144f983605bc19: an end time 01:00 against 03:00;
  - 1a1541de84b036b8: staff made nothing. It is an open card on the TV ("15th" read as October).
- **Creates' crew mix and venue, 3:** 1a14063b8d8dd75c, 1a15984719fbd60e, 1a15984f57ab3251 (above).
- **The chief rule, 1:** 1a158a5e6bd47095, "add 3" on a shift of 1. A question for the owner and Paz.
- **A cancel staff did not make, 1:** 1a163dd1e345c607.

Creates go to To Confirm, where staff complete them. Edits are what would run live, and on current mail the edit writes
are now completed or handed off apart from the chief-rule case and the cancel.

## Not done here, and why

- **The display changes the TV check found:**
  - the 429 card drawn as Needs Created;
  - open needs that never age;
  - reply cards not listed.

  They change the TV and the labels, so they ship only with the owner's and Paz's yes. Proposals: audit/display-proposals.md;
  the Paz draft: audit/paz-acceptance-examples.md.
- **The reader's "nothing asked for" readings** (16 dev cases): a prompt change needs the owner's yes and a capped paid run.
