# Spartan outcome analysis: every thread read, the types and how to measure each (2 Nov 2026)

The owner's test (2 Nov): read every email of every thread in order, trace each thread's line of thought to its
outcome, find every type of business the mailbox carries and how each can be measured, so the types and their
training data can go into the system. Read by hand, no model run, $0, read-only.

**Coverage:** 1,145 threads, 6,729 emails, 30 Jul to 2 Nov 2026, every one read and coded
(`harness/outcome/labels.tsv`, codes in `harness/outcome/codebook.md`). The reading was of masked excerpts cut at
180 characters, by one reader; see the README there for what that limits.

## 1. The types

Primary type is the thread's main business; a thread can carry several (a booking that later changes is BKQ+CH).

| Type | What it is | Threads (primary / any) | Emails | How it ended |
|---|---|---|---|---|
| BKQ | crew booking that went through a quote | 370 / 375 | 3,916 (58%) | 301 booked, 56 changed, 7 cancelled, 7 Spartan owes the next move |
| AU | automated: OnSinch portal notices (72 threads), auto-replies, bounces, login codes | 149 | 256 | nothing to do |
| QO | quote asked, never confirmed | 102 / 106 | 509 | 36 no answer, 29 withdrawn, 18 declined, 11 client owes, 9 Spartan owes |
| AD | PO, remittance, invoice or statement only | 90 / 109 | 287 | 51 a PO on a booking, 17 paid |
| IF | job info only: site contact, meeting point, packs, crew changes | 64 / 66 | 158 | 60 nothing to do |
| BK | booking with no quote: regular clients, portal orders, phone bookings | 63 / 66 | 374 | 54 booked, 7 changed |
| OUT | Spartan's own check-ins (the November run of 19 Oct: 47 threads in 90 minutes) | 62 / 63 | 135 | 50 no reply or "nothing now" |
| MK | marketing, awards, sales, job seekers | 43 | 71 | nothing |
| CH | change to a booking, in its own thread | 38 / 174 | 201 | 101 changed |
| SUB | Spartan buying crew or vans from another company | 31 | 281 | 7 booked, the rest open or spoken for |
| RF | Spartan could not supply ("at capacity", "no takers") | 27 / 45 | 116 | 25 refused |
| AF | accreditation, venue registration, documents to sign | 26 / 32 | 101 | 13 with no visible reply |
| SU | a supplier's invoice, statement or quote to Spartan | 24 | 47 | nothing for the TV |
| IN, CW, OT | internal, Spartan's own crew, other | 29 | 45 | nothing |
| DV / CD | van and driver only / crew plus van or driver | 8+7 primary, 34 threads with delivery in them | 175 | 11 booked |
| PJ | after the job: no-shows, lateness, overtime, feedback | 4 / 36 | 11 | adjusted invoices |
| CX | cancellation | 4 / 21 | 15 | 13 cancelled |
| MX | one thread carrying several jobs over time | 2 / 20 | 27 | the R11390 problem |

## 2. The line of thought

**The one dominant path is BKQ, 58% of all mail.** It opens with a booking (RB 158) or a quote request (RQ 144).
Spartan answers with a quote (119 and 112 times), then the client says yes. Of 355 BKQ confirmations, 158 were a
plain yes, 52 a yes with a PO, 47 a PO alone, 33 a yes with contact details, and 32 had no confirmation in the
thread at all (phone or portal). Crew names follow, then often a change.

How Spartan answers each client act, counted from the coded paths:
- A booking (RB): an ack (123) or a quote (119); terms or refusal 20.
- A change (RC): a new quote (139) or an ack (88); terms 19. Inside 48 hours the change is refused under the
  cancellation policy, and the client keeps the booking as it was (seen 4 times).
- The client asks something (AQ, nearly always crew names): crew names (62) or an ack (47).
- A PO: an ack (145), crew names (45), a confirmation (39).
- A withdrawal or decline (WD, DE): an ack (34, 18). Nothing else follows.

After a quote, the client's next move was:

| Next move | Count |
|---|---|
| yes | 240 |
| PO | 115 |
| a change | 88 |
| nothing at all | 89 |
| thanks only | 77 |
| contact details | 54 |
| withdrew | 23 |
| negotiated | 15 |
| declined | 14 |

77 of the 102 unconfirmed quotes were never chased.

## 3. The reader against this reading

1,276 client emails carry a stored v2 decision (card h, wait w, nothing n), mostly mail from 7 Oct on. In 1,132
threads my codes line up message for message with the dump. The join below covers those threads; 13 threads did
not line up and are left out.

| Client act (my code) | v2: card | wait | nothing |
|---|---|---|---|
| booking RB | 79 | 27 | 8 |
| quote request RQ | 70 | 23 | 13 |
| change RC | 66 | 30 | 17 |
| yes Y | 18 | 11 | 81 |
| PO | 8 | 11 | 72 |
| withdrew WD | 11 | 2 | 6 |
| declined DE | 7 | 0 | 3 |
| asks Spartan AQ | 8 | 0 | 64 |
| thanks TH | 4 | 0 | 158 |
| info CI | 12 | 2 | 127 |
| supplier SU | 8 | 0 | 45 |

- **The yes is the weak point.** Of the first confirmations after a quote, 94 of 132 (71%) were decided "nothing";
  their intent was mostly right (booking), but no card or wait came from that email. Per S-0286 a client reply on a
  quote-waiting thread brings the thread's card back, so this is not yet a measured TV miss. It needs a
  thread-level replay of whether a card was on the TV between the yes and staff confirming the order (next step,
  section 5).
- **Crew-name requests get no card:** 64 of 72 were decided "nothing", and Spartan's answer to them is the crew
  list. This is the owed-reply gap of Q6 (§15) seen from the other side; 22 threads end on a client ask with no
  reply.
- **Supplier mail makes false cards:** 8 supplier emails got a card, mostly "we can cover it" from companies
  Spartan buys crew from. Thanks and info are almost always right (4 of 162 and 12 of 141 false).

## 4. How to measure each type

Each definition uses only what is already stored: the email's words the rules already read, Spartan's own reply,
and OnSinch's booking history.

- **BKQ.** Spartan's reply hands over a quote ("attached / please find / here is", 0.98 recall, S-0286), then a client
  yes or PO. In OnSinch, the provisional order made before the quote is confirmed by staff. Done when the order is
  confirmed and holds the days asked.
- **BK.** A booking with no quote between: a portal order (OnSinch create row by the client's user, then Spartan's
  "Thanks for the new order on OnSinch" template), an E-number or monthly schedule from a regular client, or a
  phone booking that Spartan confirms by email. Done as BKQ.
- **QO.** A quote handed over and no yes or PO by the job's day. It ends in withdrawal words (stand down, booked
  elsewhere, no longer needed, "release"), a decline (too dear, budget), silence, or Spartan removing the order
  ("removed it from the system", an OnSinch deletion). Measure the chase too: 77 of 102 had none.
- **CH.** Change words on a thread with a live order, then a staff edit of that order's shifts after the email
  (done.ts already reads this). Inside 48 hours of the job, the policy reply plus "keep it as it was" is resolved
  with nothing edited.
- **CX.** Cancel words, then an OnSinch cancel row on the order. A cancel inside 48 hours is still billed.
- **RF.** Spartan's terms words ("at capacity", "unable to", "no takers", "won't be able to") and no order made,
  or the order deleted.
- **AD.** A PO number on a thread or subject with an R or J link (the subject "PO - date - venue" is the commonest
  form). It is the BKQ yes when it arrives in its own thread. Remittances (PD) and statements are nothing for the TV.
- **IF.** Contact, meeting point or production pack with no ask. Nothing to do but pass to crew. The ask inside
  it (AQ) is the owed-reply signal.
- **AF.** Signature-service links ("documents for the event"), venue registration portals, and right-to-work
  questions. Staff tasks, not orders; 13 of 32 have no visible reply.
- **PJ.** After the job's day: no-show, late, overtime, deduction, feedback. It ends in an adjusted invoice.
- **DV / CD (delivery).** Van, driver, sprinter, 7.5T or 12T, collection or removal words, and in OnSinch a Van
  Service, Minivan Driver or Driver shift (D3). Truck jobs over a van's size go to a haulier: SUB threads that
  quote Spartan, not the client.
- **SUB / SU.** A thread Spartan opens to another crew or haulage company, or mail from a sender who quotes or
  invoices Spartan. A supplier list (senders who send Spartan quotes and invoices) would stop the 8 false cards.
- **AU.** The subject patterns already marked AUTO. A portal notice (AUp) means the order already exists in
  OnSinch.
- **OUT, MK, CW, IN.** By sender and subject; nothing for the TV. A reply to an OUT check-in that asks something
  (one asked for the rate card) is RQ.
- **MX.** Two or more different R links, or a new booking after the thread's booking closed. The reused-thread
  case, where the card showed the old order (R11390).

## 5. What this gives the build, and what is next

- **Training data:** `harness/outcome/labels.tsv`, 1,145 threads keyed by Gmail thread id, with a code per email.
  On the 1,276 client emails with a stored decision, it is a reference answer for card, wait or nothing.
- **Next measurements, all $0:**
  1. A thread-level replay of the 132 first confirmations: was a card on the TV from the yes until staff confirmed
     the order? This settles whether the reader's "nothing" on a yes matters.
  2. The same for the 72 crew-name asks, against Q6.
  3. A supplier list from senders who quote or invoice Spartan, and its effect on the 8 false cards.
- **For the owner:**
  - Should SUB and SU threads (55, Spartan as the buyer) be off the TV entirely?
  - Should AF tasks (accreditation, venue registration, documents to sign) be a TV item, given 13 of 32 have no
    visible reply?
  - Should an unchased quote be a TV item? (77 of 102 were never chased.)
