# Outcome analysis code book (2 Nov 2026)

One line per thread in labels.txt:  `Tnnnn|TYPES|PATH|OUTCOME|FLAGS`

## TYPES (thread; several joined by +)
BK new crew booking (asked directly) | BKQ booking that went through a quote first | CH change to an existing booking |
CX cancellation | QO quote asked, never confirmed | RF Spartan could not supply | DV delivery or van only |
CD crew plus delivery or van | AD admin only (invoice, payment, PO, portal access) | IF job info only (contacts, site,
crew names, accreditation, call sheet) | PJ post-job (overtime, hours, feedback, complaint, no-show) | SU a supplier
writing to Spartan | CW one of Spartan's own crew writing (availability, pay) | SUB Spartan buying crew or vans from a supplier | OUT Spartan's outreach or check-in to a client | MK marketing, recruitment, job seeker |
AU automated (AUp: OnSinch portal notice that a client made or edited an order) | IN internal | MX one thread carrying several separate jobs over time

## PATH (one code per message, in order; client UPPER, Spartan lower)
Client: RB book | RC change | RX cancel | RQ quote/availability ask | Y yes, go ahead, confirm | PO PO sent |
DE declined, too dear, went elsewhere | WD withdrew, stand down, covered | CI contact/site/timing info given |
AQ asks Spartan something (names, status, details) | AF accreditation, forms, compliance | IV invoice/payment ask |
PD paid | TH thanks/ack only | CH chase | FB feedback/complaint | PJ post-job hours/overtime | DL delivery/van ask | NG negotiates price |
AU automated | SU supplier | MK marketing | OT other
Spartan: q quote sent | t terms, refusal, no capacity, policy | c confirmed/booked | a asks the client something |
n crew names/details sent | i invoice, proforma, payment link | h chase/check-in | k ack/thanks | u update (crew
change, late, replacement) | o outreach/other

## OUTCOME
BOOKED | CHANGED | CANCELLED | QUOTED (no answer) | DECLINED | WITHDRAWN | REFUSED | INFO (nothing to do) | PAID |
OWED (Spartan owes the next move at the end) | WAIT (the client owes it) | NA

## FLAGS
miss = a client request the reader decided as nothing (v2 n/info_only) | false = v2 card on an email asking nothing |
dlv = delivery/van in the thread | sup = supplier | multi = several jobs | owed = client asked, no Spartan reply
