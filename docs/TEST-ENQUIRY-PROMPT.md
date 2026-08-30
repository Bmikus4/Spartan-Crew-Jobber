# Generating test enquiries — medium hardness

A prompt for producing booking emails to send into `bookings@spartancrew.co.uk`, to
exercise the live pipeline end to end.

**The email is never written from the answer.** Declare the booking first, then render it
as a client would type it, then score the engine against the declaration. A matcher study
in this account once measured 98.7% on self-match and 45.9% on real queries because the
questions had been written from the answers — an enquiry generated out of the tenant's own
records only tests whether a string can find itself. The noise goes on the RENDERING; the
truth stays in fields.

---

## What "medium" means here

Not "how long is the email". Medium is defined against the engine's decision surface: an
enquiry is medium if **it must book without a human, but only after the engine does real
work.**

Every generated enquiry MUST satisfy all of these, or it is not testing anything:

- a stated date, in the future
- a venue that exists in the tenant
- a role the tenant has
- a company the engine can identify
- enough information that a competent booker would not need to ask a question

And each one MUST force at least **three** of these:

| dial | what it makes the engine do |
|---|---|
| **crew size crosses a band** — 4, 10 or 20 people | carve a chief OUT of the number, not add one: 4→3+1, 10→8+2, 20→17+3 |
| **two blocks that must merge** — same day, same window, same venue, same role, written as two sentences | collapse to one slot team with the sizes summed |
| **two blocks that must NOT merge** — different window, or a second venue | keep them apart; the merge key is window + place + profession |
| **a role in plural or slang** — "chippies", "forkies", "riggers", "FLT drivers" | fold the plural before matching the tenant's singular cue. Plurals were booked as general crew until recently |
| **times written as people write them** — "8-6", "8am till half 5", "0800-1800" | parse to a real window rather than falling to the default |
| **times omitted entirely** | apply the 08:00–18:00 default, which is a 10-hour day |
| **exactly 8 hours stated** | the day-rate boundary, which only applies when the times were actually stated |
| **the company only in the signature block** | find the client where it really lives in mail |
| **a second day** | one order, two dates |

## What is NOT medium — leave these out

These are the known-hard cases. They will hold, flag, or fail, and a held thread proves
nothing about the booking path:

- **venue aliases under 4 characters** — "RAH", "O2", "V&A", "NEC" never resolve and
  provision a duplicate. This is a known open defect, not a test result.
- **"ExCeL"** — 632 empty shells share that name; it lands on one of them.
- TBC or unstated dates — composed then withheld as needs-info, by design
- cancellations, or an email that empties an order
- a brand-new company AND a brand-new venue in the same email — that provisions two real
  records in the live tenant
- forwarded chains, attachments carrying the detail, out-of-office and machine senders
- anything asking a question rather than placing a booking

## Fixed facts to build from

**Send to:** `bookings@spartancrew.co.uk`

**Company — sign every test email as `TEST - Eventz`.** It is company 515 in the tenant,
it has order history, and it is the designated test account. Using it means the engine
matches an existing client instead of creating one, so nothing new is provisioned and no
real client's account is touched.

**Venues — use these, they exist and each name is unique in the tenant:**

| name | id |
|---|---|
| Business Design Centre | 29 |
| The British Museum | 12 |
| London Stadium | 21 |
| Tobacco Dock Ltd | 1 |
| The Vaults Theatre | 22 |
| Clissold House | 44 |
| Hilton London Canary Wharf | 42 |

**Roles — use these, they are real professions in the tenant:**
Crew · Carpenter · Rigger phrasing → Crew · IPAF 3a/3b · PASMA · CSCS Labourer ·
Counterbalance B1 · Telehandler U< 9M J2 · Crew Chief · Bar Staff · Steward · Climber

## How the email must read

Written by a person, in a hurry, on a phone or in Outlook. Not a spec.

- lowercase starts, missing apostrophes, one typo at most
- numbers sometimes as words ("six lads"), sometimes as digits
- the venue by its ordinary name, not a formal record string
- a real signature block: name, `TEST - Eventz`, a phone number
- a subject line a client would write, not a summary of the contents
- 40–120 words of body. Real enquiries are short.
- no bullet lists of requirements unless the case is deliberately a schedule

---

## The prompt

> You are writing test enquiries for a crew-booking engine. Produce **{{N}}** independent
> emails.
>
> For each one, first decide the booking in fields — date(s), venue, role, headcount,
> start and finish for each block — then write the email a client would send to request
> exactly that booking. Never describe the fields in the email; write the email a person
> would actually type, and let the fields be recoverable from it by a competent reader.
>
> Constraints:
> - Send-to is `bookings@spartancrew.co.uk`. Sign every email as `TEST - Eventz`.
> - Venue must be one of: Business Design Centre, The British Museum, London Stadium,
>   Tobacco Dock Ltd, The Vaults Theatre, Clissold House, Hilton London Canary Wharf.
>   Use its ordinary spoken name.
> - Role must be one of: general crew, carpenters, riggers, IPAF operators, PASMA, CSCS
>   labourers, counterbalance drivers, telehandler drivers, bar staff, stewards, climbers.
> - Dates are in the next 6 weeks and are stated explicitly. Never "TBC".
> - Never use "ExCeL", "the O2", "RAH", "V&A" or "NEC" as a venue.
> - Each email must be bookable with no follow-up question.
>
> Across the set, make each email force at least three of the following, and vary which:
> a headcount of exactly 4, 10 or 20; two blocks that should merge into one; two blocks
> that must stay separate; a role written in plural or slang; times written informally
> ("8-6", "8am till half 5"); times omitted entirely; a shift of exactly 8 hours; the
> company name only in the signature; a second day.
>
> Style: lowercase starts, a missing apostrophe or two, at most one typo, 40–120 words,
> a real signature block. A subject a client would write.
>
> Output each as:
>
> ```
> --- EMAIL n ---
> Subject: <subject>
> <body>
>
> --- ANSWER KEY n (do not send) ---
> company: TEST - Eventz
> blocks:
>   - date: YYYY-MM-DD  venue: <name>  role: <role>  size: <n>  start: HH:MM  end: HH:MM
> dials exercised: <which of the list above>
> expected: books cleanly | books and flags for review — <why>
> ```

---

## After a run

These are **real orders in the live tenant** on company 515. Every test order needs
deleting in OnSinch afterwards, and its `conversation_state` row clearing, or the next
message on that thread will be read as an amendment to an order that no longer exists.

`SPARTAN_BLOCK_ORDER_REPLACE=1` is set in Production, so nothing can delete and recreate
an order while testing.
