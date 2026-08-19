> **DISOWNED, 2026-08-18.** Ben: "generally disregard the doc." This is the original
> hand-written spec, kept for history only. Every staffing rule below is now reversed in
> code: the chief is CARVED OUT of the team (4 -> 3+1, not 4+1), crew size is not a
> splitting axis, there is no minimum call-out and no long-shift split, and chronology
> stays out of the engine. The code is the specification. Do not cite this file, do not
> reconcile against it, and do not "fix" code to match it.

# Order Rules

Business logic for turning an enquiry email into an OnSinch order. Domain rules only —
nothing here concerns output format, transport, or field syntax.

A **SlotTeam is the unit of work.** Every rule below that refers to a block, a team, or a
slot means one SlotTeam entry. There is no other grouping construct: the order carries a
job, the job carries SlotTeams, and a SlotTeam is one profession working one time window
at one size in one place.

## Splitting

A separate SlotTeam is created when, and only when, one of these differs:

- the time window (start or end)
- the profession
- the crew size

Task description is **not** a splitting axis. Two different jobs of work performed by the
same profession in the same window are one SlotTeam, not two. "Unload the truck and then
help with the induction" on the same morning is a single team.

Profession is structural rather than descriptive: a SlotTeam carries exactly one
profession, so a request for carpenters and general crew at the same time is necessarily
two teams even though it is one block of work in the client's mind.

Crew size is a splitting axis. Two separately stated requests are kept as two SlotTeams
even where they share a window and a profession — they are never summed into a single
larger team. The client asked for two things and the order shows two things.

This is a splitting rule only. The crew-chief bands still read the whole shift, so two
teams of 4 in the same window are 8 people and take 1 chief between them, not 1 each.

## Staffing composition

Crew chiefs are assigned by band, counted per **shift** — all SlotTeams sharing a start
and end are summed before the band is applied:

- 4 or more -> 1 crew chief
- 10 or more -> 2 crew chiefs
- 20 or more -> 3 crew chiefs

The chief is **added, never substituted**. A request for 4 crew produces 5 people. A
request for 4 carpenters produces 4 carpenters plus 1 chief, also 5 people — a
specific-role request is not exempt from the band.

Because the bands read a shift and not a team, 4 carpenters plus 4 general crew in the
same window is 8 people and therefore 1 chief, not 1 per team.

## Profession selection

Crew is the default and the fallback. Ambiguity resolves downward to Crew, never upward
into a specialism.

- CSCS stated as **required** -> CSCS Labourer
- CSCS stated as **preferred** -> Crew. The word "preferred" removes the requirement.
- Named plant (forklift, telehandler, counterbalance) -> the matching plant profession
- Driving duties -> Driver
- Event or AV work -> the AV profession
- Anything else, or anything unclear -> Crew

## Scheduling under incomplete information

A booking is always produced. Missing detail degrades to a stated default; it never
suppresses a team.

- No start time given -> 08:00
- No end time given -> 18:00
- One date given and the other missing -> the given date covers both ends
- A date marked TBC or unconfirmed -> the team is still created, at the best available
  date, with the uncertainty carried in the team name
- Year unstated -> take the year from the most recent email in the thread

## Source authority

The original email body outranks thread history wherever the two disagree. Thread history
is context, not correction.

## Party scoping

Only the client company is ever recorded.

- No Spartan Crew data is data. Own-domain addresses are excluded at every point.
- A name is a real person or company. Sign-offs, department labels, and job titles alone
  are not names.
- Thread and message identifiers are never order identifiers.
- A flag is recorded only where its value literally appears. Absence is not false.

## Thread chronology

The oldest message in the thread is the creation event. Every later message, the current
one included, is a modification.

## Open

Two rules of the same kind as the chief bands are not yet specified:

- **Minimum call-out.** Nothing states what happens to a 2-hour request — whether a shift
  below some length is extended, rounded, or billed at a floor.
- **Long-shift handling.** The 08:00-18:00 default is a 10-hour day. Nothing states
  whether that triggers a break, a split, or a different rate.
