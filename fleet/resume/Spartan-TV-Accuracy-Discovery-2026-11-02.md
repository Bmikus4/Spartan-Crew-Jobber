# Spartan TV accuracy: discovery report, 2 Nov 2026

The brief is `Spartan-TV-Accuracy-Handoff-2026-11-01.md`. Everything here is read-only, cost $0, and is reported as counts
and ids only. The scripts are in `.tmp-v2/` and are listed at the end. **Nothing in Phase 2 is built until the owner has
critiqued this report.**

## Headline numbers

| Workstream | Needs on the TV that should not be | Card-hours | What the replay says can be fixed safely now |
|---|---|---|---|
| W1, staff work not recognised | 40 of the 65 never cleared (causes j, a, k, c, b, e, i, g, d) | 4,359 | +9 needs, 344 h (j + a), 0 false clears |
| W2, settled in the thread | 10 by code (cause s); 9 of the 31 read by hand | 734 | Word-free settlement adds no agreements (see D2) |
| W3, deliveries and email types | 3 delivery needs never cleared (cause f) | 149 | Nothing yet: it needs the owner's choice (Q4) |
| No request in the email (cause p) | 7 | 3,289 | Not safe as built: 36 false clears |
| No day in the reading (cause n) | 5 | 2,569 | Owner's ruling (Q5) |

- **Card-hours** run from the email to the end of the need's last day, or to now. They never start before 9 Oct, because
  v2 did not exist before that. The brief's "about 7,200" counted one June email from June, so the dated needs come to
  4,329 h here (median 56 h, p75 105 h). The 14 needs with no day have been open since their email: 6,771 h.
- **Baseline.** Today's rules on 316 needs give 243 done, 6 agreed, 4 quote waits and 65 never cleared. The replay now
  rolls each order back to how it stood at each moment (`bt-load.ts` ROLLBACK). With that, the counts are 246 done and
  63 never cleared. Without the rollback, a value staff set after the email reads as held before it: 64 of 66 "already
  held" clears in D1 were artifacts of that.
- **Two findings change the plan.**
  1. The biggest W1 cause is not workOf at all. It is **j**: 15 senders whose company OnSinch knows only by mail domain
     (or who sit on several companies). For those, rungs 3 to 5 never search the client's orders.
  2. The b hypothesis is mostly an artifact. Most "staff edited the right order and workOf did not count it" was staff
     closing shifts after the job (Slot.status 5 to 6, days later). Once those rows are filtered out, 1 need is left.

## D1. Why the 65 never cleared

The trace (`d1-trace.ts`, written to `.tmp-data/backtest/d1.json`) records, for each need:
- the rung and candidate groups;
- every staff row after the email on each candidate, with workOf's answer;
- the client's orders that hold the day;
- the reading's requests.

Code assigns one cause in a fixed order: p, f, i, j, a, k, then a passed day (e), n, off-day work (e), c, b, s, no
candidate (e or g), d, g2. Causes p, i, j, k, n and s extend the brief's list.

| Cause | Needs | Card-hours | No day | Example ids (last message id) |
|---|---|---|---|---|
| j: the sender's company is known only by mail domain, or the sender is on several companies; rungs 3-5 never search | 15 | 1,853 | 3 | 1a130d2f1bd4b587, 1a13a443201c1d31, 1a13e9ba4edde86b |
| s: Spartan replied, then the client wrote back with no request, and no fitting work followed | 10 | 734 | 0 | 1a12b5734c7b8276, 1a12f19db16de614, 1a13a25e4a10c97b |
| p: the email asks for nothing (thanks, PO, contacts, site info) | 7 | 3,289 | 6 | 1a12071cca1f1f0d, 1a11ac9f47699b23, 1a13a408e18d3802 |
| a: two or more candidate orders | 7 | 451 | 0 | 1a12f99d4cc811b1, 1a13ae4bb1dab34e, 1a12100d6b517c3e |
| i: the sender is on no contact list and no company has its domain | 6 | 1,390 | 0 | 1a13afcc9d32ebd1, 1a11716abc3329f8, 1a12fc246b1151f2 |
| n: no candidate, and the reading has no day | 5 | 2,569 | 5 | 1a12078a52daae2c, 1a11fde9b93f8ab4, 1a1216e6f5c08444 |
| g: no candidate, and nothing was done on the client's orders | 4 | 304 | 0 | 1a12c1a240bbee4a, 1a1537f6f674abca |
| e: the reading's day is wrong (staff changed another day of the order, or the day had passed) | 3 | 39 | 0 | 1a162ee6be44f3ac, 1a12f577b851895d |
| c: the order held the ask, and the edit came in the 48 h before the email | 3 | 199 | 0 | 1a12093913c81661, 1a14539d35697ee9 |
| f: a delivery need | 3 | 149 | 0 | 1a12b2a2199e0ed3, 1a13a979194ef05f, 1a18df940adc019a |
| k: the thread names an older order absolutely; none it names holds the need's day | 1 | 62 | 0 | 1a1254a1b3ef8391 |
| b: staff worked the held order after the email; workOf did not count it | 1 | 61 | 0 | 1a177f34d54e839e |
| d: held, nobody acted | 0 | 0 | 0 | none |

**Hand-check by masked reading.** 31 needs were read, which covers every b, c and d plus 20 others.
- **First version of the code: 4 of 21 right.** Its b was wrong in 9 of 10. Seven of those 9 "edits" were Slot.status 5
  to 6, made days later by one user closing shifts after the job.
- **Second version:** the window is 72 h and never past the need's last day, and causes p, s, k and n were added. It
  agrees with the 21 already read on 17 (training, so optimistic). **On 10 fresh needs it agrees on 6.**
- **The four misses on fresh needs:**
  - 3 are a client letting the request go in words the code filed under a structural cause: "stand down on this
    request", "can't confirm", and "stand down" again;
  - 1 is a supplier writing to Spartan (a crew company's terms), filed as i.
- **Across all 31 read:**
  - 9 were settled in words that no rule reads ("stand down" 3 times, "has this covered", "we'll keep all four", "keep
    the booking as is" on a two-candidate need, "found an alternative", a quote answered with an existing order's
    quote, an "unfortunately" accepted);
  - 2 were suppliers, not clients;
  - 4 emails asked for nothing.
- **Small things seen on the way:**
  - "shift_client_change" is the client's own edit in the portal. In 1a14539d35697ee9 the client changed the crew
    themselves, then emailed. workOf never counts that action.
  - spartanOwn cuts the "Van services" footer but not "We now provide courier services", so that footer stays in the
    text the rules read.

**Smallest rule changes, replayed** (`d1-replay.ts` with ROLLBACK=1; each change is behind a switch in `gen/done-var.ts`).
A false clear is fitting staff work, or a confirm, that came after the change cleared a need today's rules do not
clear, or clear later.

| Change | Clears never-cleared | Earlier clears | Card-hours removed | False clears |
|---|---|---|---|---|
| j: search the sender's domain or multi-company orders in rungs 3-5 | 6 | 2 (same hour) | 166 | 0 |
| a: among several candidates with work, a new booking takes the order staff made after the email | 1 | 0 | 37 | 0 |
| k: when no order the thread names holds the day, fall through to the other rungs | 1 | 1 | 101 | 1 (cleared 41 h early, the work came 62 h later) |
| j + k + a | 9 | 3 | 344 | 1 (k's) |
| c2: the order already holds every value asked (times, crew), whoever set it | 2 | 6 | 168 | 2 |
| c: fitting work in the 48 h before the email counts, for any ask | 7 | 30 | 405 | 28 (without rollback) |
| b: any staff row on the order within 72 h counts | 8 | 38 | 1,233 | 36 |
| p: an email with no request is never a need | 7 | 39 | 3,340 | 36 |

- j's 9 other needs then become "possibly" (several of the client's orders that day), which is a/readPlaces' problem.
- 2 of j's 6 clears had their order confirmed from provisional afterwards. Today's rules do the same on 102 of 246
  done clears, so this is how a booking normally runs, not a false clear.

## D2. Word-free settlement

**Side by side** (`d2-replay.ts`, ROLLBACK=1, 316 needs):

| | Today's rules | W2, word-free | W2 + "let go" (a new booking nothing was booked for, the client's later email asks nothing) |
|---|---|---|---|
| Agreed | 5, 0 false | 4, 0 false (one lost) | 5, 0 false |
| Withdrawn | 1 | 1 | 3, 1 false |
| Offer or quote waits | 3: 2 ended by the client, 1 worked (false) | 12: 10 ended by the client, 2 worked | 3 |
| Never cleared | 63 | 57 | 62 |
| Card-hours removed | 623 | 582 | 721 |

- W2 adds no agreement. The client's later email the reader finds no request in is rarely the yes on a held, confirmed
  order. A yes usually restates the booking, and the reader reads that as new_shift requests.
- The offer wait, widened to terms, hides 9 more needs. The client ended every one of them, and one more had staff do
  the work while it was hidden.
- **The reader against the labelled yes sample** (`d2-reader.ts`). Only 18 of the 120 labelled messages have a feed
  decision, because the sample began on 1 Sep and v2 on 9 Oct:

  | Label | Decided | Reader says no request | Reader flags a change |
  |---|---|---|---|
  | Y | 6 | 4 | 0 |
  | c | 2 | 0 | 2 |
  | N | 6 | 0 | 0 |

  The n is too small to call it reliable.
- **TERMS blind test** (`t-snips.ts`). 100 Spartan messages, half matches, half near misses, labelled before scoring:
  - **precision 0.78** (39 of 50), recall against the near misses 0.89;
  - false matches: a bare "unfortunately" (a crew replaced, feedback, "no takers yet", spam, an urgent contact ask),
    "subject to" boilerplate (portal text, compliance text), a client's words forwarded, a supplier negotiation;
  - misses: the 48-hour cancellation window and its charge, a cancellation policy waived, an unsociable-hours bonus, a
    no-show charge, upfront payment for new clients.
- **Recommendation: keep** the current agreement rule and **do not replace** it with W2. Tighten TERMS: drop a bare
  "unfortunately" and "subject to"; add capacity or availability refusals, cancellation policy, the 48-hour window,
  minimum call, and upfront payment. Then blind-test it again. The real settled pool is withdrawal in words (9 of 31
  read). The smallest change aimed at it is "stand down", "covered", "found an alternative" and "no longer need",
  added to WITHDRAW behind the same OnSinch checks. It needs a blind test of at least 100 first. "Stand down" also
  appears in Spartan's own words ("we'll stand down"), which is a client-only rule's risk to measure.

## D3. Email types and deliveries

**Sample.** 301 client emails since 1 Sep, stratified:
- 110 from the 220 with delivery words;
- 191 across month × the reader's intent × the decision kind (18 strata).

Each was labelled blind with one type from masked words. Five types were added: QD (quote declined or lost), SD (a
courier or van supplier writing to Spartan), CI (crew info asked: names, contact, PPE), AK (thanks, ack or chaser
only) and UN (unreadable HTML).

| Type | Sample | With delivery words | Since 9 Oct | v2 kind since 9 Oct | TV card since 9 Oct (how it ended) |
|---|---|---|---|---|---|
| CF confirmation, PO or contacts | 62 | 18 | 20 | none 14, handoff 4, write 2 | 6 (staff work 3, never cleared 1) |
| AK thanks, ack or chaser | 41 | 8 | 21 | none 19, handoff 2 | 1 (never cleared) |
| CC crew change | 31 | 8 | 11 | handoff 7, write 3, none 1 | 10 (staff work 8, settled 1, never 1) |
| CB crew booking | 28 | 9 | 11 | handoff 6, write 4, none 1 | 6 (staff work 5, never 1) |
| AU automated (OnSinch notices, bounces, out of office, courier tracking) | 26 | 10 | 9 | none 9 | 0 |
| CQ crew quote request | 21 | 5 | 7 | handoff 5, write 2 | 6 (staff work 5, never 1) |
| IP invoice or payment | 15 | 2 | 8 | none 8 | 0 |
| DV delivery or van only | 11 | 11 | 2 | handoff 1, write 1 | 2 (staff work 2) |
| SM supplier, marketing or job seeker | 11 | 6 | 7 | none 6, handoff 1 | 1 (never cleared) |
| AF accreditation or forms | 10 | 4 | 4 | none 4 | 0 |
| CD crew plus delivery | 9 | 9 | 3 | handoff 2, none 1 | 1 (never cleared) |
| CI crew info asked | 8 | 3 | 3 | none 3 | 0 |
| SD courier or van supplier | 6 | 6 | 0 | none | 0 |
| CX crew cancellation | 6 | 3 | 3 | write 2, handoff 1 | 3 (staff work 2, never 1) |
| QD quote declined or lost | 6 | 1 | 3 | write 1, handoff 1, none 1 | 2 (staff work 2) |
| PJ post-job (overtime, feedback) | 5 | 4 | 1 | none 1 | 0 |
| UN unreadable | 3 | 3 | 0 | none | 0 |
| IF internal forward | 2 | 0 | 0 | none | 0 |

**What the system does today, per type, and what it should do**

| Type | Today | Should |
|---|---|---|
| CB, CC, CQ, CX | Read and carded; most end by staff work. | As now. The misses are D1's causes. |
| CF, AK | Mostly decided as nothing. 7 of 41 since 9 Oct made a card, and 2 never cleared. | No card, unless it carries a request (cause p). |
| AU, IP, AF, PJ | No card. | Right. AF and CI owe a reply: see below. |
| CI (crew names, contact, PPE) and AF | No card and nothing else. | These are replies Spartan owes. This is where the owner's "owed a reply, no Needs Follow Up tag" is likely to come from: the backlog item measures it. |
| SM, SD | 1 of 7 SM since 9 Oct made a card that never cleared (a crew supplier's terms). SD never reaches v2. | Supplier senders are not clients. 2 of the 31 D1 needs read were suppliers. |
| QD | Read as a cancellation (2 of 3); the card ends by staff work. | Right in effect. A declined quote needs no OnSinch work when no order exists. |
| DV, CD | Since 9 Oct: 5 emails, 3 carded (1 never cleared). Before 9 Oct, 15 more had no v2. | See the delivery map below. |

**How deliveries live in OnSinch** (`d3-onsinch.ts`, orders created since 1 Sep):
- **Delivery is a shift.** It is booked as a shift of profession Van Service (61), Minivan Driver (46) or Driver (9).
  Of 620 orders, 22 have one: **4 delivery-only and 18 crew plus delivery**.
- **The shape:** 37 van shifts, every one size 1 at one place, 4 to 12 hours, almost all the same day.
- **Where the details sit:** the team description holds them on 34 of 37. The slot's one place is the only address
  field; pickup and drop-off are not separate fields.
- **TransportsTrip is not delivery.** The brief's "70 orders with TransportsTrip" are SlotTeam.TransportsTrip links to
  the carpool: Carpool Driver (45, 48) driving the crew, with 1,462 TransportsAttendance rows. None of those rows carry
  an order id.
- **How staff book and change deliveries:** the same actions as crew (Slot create, times, size, cancel, description).
- **"Done" for a delivery need** is therefore a van-profession shift on the need's day for the client, which workOf
  already counts as "added crew". The 3 f needs stayed for other reasons:
  - 1a12b2a2199e0ed3 is a carpenter on a thread whose absolute link names the older order (k);
  - 1a13a979194ef05f is a cancel staff answered by moving times;
  - 1a18df940adc019a has two "new shifts" with no day, so its order holds a Van Service but the day list is incomplete.

**Deliveries through the pipeline:**
- Of the 26 delivery-labelled emails (DV 11, CD 9, SD 6), 21 came before v2 or are supplier mail with no decision.
- Of the 5 since 9 Oct, 3 made a card, 1 more was a handoff with no TV need, and 1 was read as info_only.
- So in this sample, delivery requests disappearing as info_only is 1 email. The brief's 18 of 28 info_only counted
  logistics replies on delivery threads, which mostly ask nothing.
- Delivery cards done.ts could never clear: 3 (the f needs above). None was a missing profession.

**Proposed changes per type:**
1. **p and AK/CF:** a decided email with no request makes no need (decision rule, `feed/v2.ts`). The replay says 36
   of 46 such needs were followed by staff work (mostly confirming after a PO), so it needs the owner's ruling (Q2).
2. **Suppliers:** a supplier list (the sender's company marked supplier) keeps SM and SD off the TV. That affects i and
   h needs: 2 of 31 read.
3. **Deliveries:** take the type from OnSinch (a van profession on the linked order's day) and from the reader's words.
   The TV shows "Van" and the team description. Done stays a van shift on the day.
4. **CI/AF:** feed Needs Follow Up. This is the owner's new ask.

## Ranked build list

Each step goes through the gate and is replayed first.

| # | Change | Effect (replay) | Risk (replay) | Touches |
|---|---|---|---|---|
| 1 | j: rungs 3-5 search the sender's domain or multi-company orders | +6 needs, 166 h | 0 false clears | done.ts candidates |
| 2 | a: a new booking's made-after order breaks a candidate tie | +1, 37 h | 0 | done.ts doneVerdict |
| 3 | WITHDRAW: "stand down", "covered", "found an alternative", "no longer need" (client words only) | about 9 of 31 read; not yet replayed | blind test of at least 100 first | done.ts WITHDRAW |
| 4 | TERMS tightened (above) | precision from 0.78 | blind test again | done.ts TERMS |
| 5 | shift_client_change counts as the client's own edit before an email (part of c) | 1 need read | replay first | done.ts workOf |
| 6 | Suppliers off the TV | 2 of 31 read; SM 1 of 7 since 9 Oct | needs a supplier list | v2 sender check, TV |
| 7 | Deliveries labelled from OnSinch van professions | 3 f needs, 149 h | none measured | feed/v2.ts, TV |
| 8 | No-request emails make no need (p) | +7 never cleared, 3,289 h | 36 false clears as built | feed/v2.ts: owner ruling |
| - | Not recommended | b (36 false), c (28), c2 (2), k (1), W2 word-free (0 agreements gained) | | |

## Open questions for the owner, with what the data says

1. **Q1, staff worked the right order but workOf says no.** After filtering the post-job closing rows, 1 need is left
   (b), and "any staff row counts" would clear 36 needs early. The data says no.
2. **Q2, held before the email for every ask kind.** c with values (c2) clears 2, but falsely clears 2 others. The
   asked value being held is not proof that nothing was left to do. The data says not yet. And separately: should an
   email with no request ever be a need (7 never cleared, 3,289 h, but 36 of 46 such needs were followed by staff
   work)?
3. **Q3, a confirmed order plus a client email that asks nothing.** The replay gains 0 agreements and loses 1. The yes
   that matters is restated booking words the reader reads as new shifts. The data says keep words, and tighten them
   with blind tests.
4. **Q4, where an email's type comes from.** For deliveries, OnSinch: a van-profession shift is the booking, the team
   description holds the details, and TransportsTrip is the carpool. The reader adds the words for the many logistics
   emails on delivery threads. What should a delivery card show: Van and the description?
5. **Q5, needs with no day** (n, plus 6 of the p needs). 14 needs have been open since their email: 6,771 card-hours.
   They cannot leave with their day. Should a no-day need leave after some days with no activity on its thread?

6. **Q6, a client owed a reply with no Needs Follow Up tag** (owner, 2 Nov; `owed-reply.ts`).
   - 112 threads since 9 Oct end in a client email that has been unanswered for 24 h to 14 days, and none carries the
     tag.
   - The tag only exists on a TV card ("open, nothing from anyone for 24 h"). 109 of the 112 have no card: their newest
     email was decided as nothing to do (80 info_only, 29 no intent).
   - Most need no reply: thanks, a PO, contacts. From the D3 sample since 9 Oct, about 1 in 6 of the no-card emails asks
     Spartan something: crew names, accreditation, a payment link, a contact. That is roughly 15 to 25 of the 109.
   - Nothing marks a reply as owed today: the decision has no reply flag.
   - The fix needs a "the client asks Spartan something" signal from the reader. That is a prompt change (PROMPT_ID),
     measured on a contained session, never on OpenRouter. Then Needs Follow Up would go on the thread 24 h after such
     an email with no reply from Spartan, card or no card. Should it be built that way?

## Scripts (all read-only, $0, under `.tmp-v2/`)

- **Shared:**
  - `bt-load.ts`: the shared world; ROLLBACK=1 sets order bodies as at each moment.
  - `gen-variants.py` generates `gen/done-var.ts`, done.ts with each change behind a switch.
- **D1:**
  - `d1-trace.ts`: trace and causes, written to `.tmp-data/backtest/d1.json`.
  - `d1-read.ts` and `mask.ts`: the masked hand-check view, for this session's own reading.
  - `d1-replay.ts`: each change replayed (VARS=j,k,a,...).
- **D2:**
  - `d2-replay.ts`: today's rules against W2 (MODES=today,w,wx).
  - `d2-reader.ts`: the reader against the yes labels.
  - `t-snips.ts`: the TERMS sample; labels in `tlabels1-2.txt`.
- **D3:**
  - `d3-sample.ts`, `d3-dates.ts`, `d3-decided.ts`, `d3-score.mjs`: the sample, its key and the cross-tab; labels in
    `d3labels1-4.txt`.
  - `d3-onsinch.ts`, `d3-trips.ts`: the delivery data map.
- Q6: `owed-reply.ts`.

Run them with `npx tsx --env-file=.env.local --require ./.tmp-v2/ro-neon.ts <script>`.
