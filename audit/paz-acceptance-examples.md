# Quote acceptances on the TV: examples for Paz (draft for the owner to send)

Prepared 2026-10-26 from the frozen prospective cases and the dev replay (eval/component-assessment.md). Nobody has
contacted Paz. Ids are message ids and OnSinch order numbers; no client names.

**The owner's direction (decisions/2026-10-26-checkpoint-b-response.md):**
- genuine outstanding work after a client accepts a quote belongs on the TV;
- work on an existing quote order is never labelled as creating a new order;
- no "update" label may imply a target the system has not found.

---

## Draft message to Paz

Hi Paz,

When a client accepts a quote ("go ahead", "please book", a PO), the TV shows nothing today: the system reads "no change
asked for" or "already booked". Your team then finishes the order by hand. We'd like the TV to show that work, and we need
your call on how. There are three situations.

**1. We know the order. Complete it.** On 10-23, 4 acceptances came in for quotes whose orders already existed:

| email | order | what your team did after |
|---|---|---|
| 1a1685bf51fb7ef6 | R11806 | within the hour: confirmed it, added the PO, filled team descriptions and contact lists |
| 1a16915c98972d9e | R11827 | within 15 minutes: confirmed it, added the PO, descriptions and contacts. The order was built about 3 h earlier from the client's quote request. |
| 1a1695fbc4797b55 | R11838 | within minutes: PO and confirm |
| 1a1685cd856e3d9a | R11807 | within the hour: confirmed it, added the PO, filled team descriptions and contact lists |

The TV showed none of these.

- Proposed card: "Client accepted: complete R11806 (confirm, PO, team details)", with the order shown.
- Proposed Gmail label: Order Needs Updated, until it is ticked.

**2. There is an order, but we're not sure which. Find it and confirm it.**

| email | date | client's open orders | what your team did after |
|---|---|---|---|
| 1a130c9740330432 | 10-12 | 4 (R11025, R11382, R11385, R11520) | confirmed R11520 and added its PO |
| 1a1357bc83414e00 | 10-13 | 8 | confirmed R11532 and added its PO |
| 1a1308567c26e478 | 10-12 | 1 (R11472) | confirmed it, PO, descriptions |

In the third, the system had only one order to choose and still named none.

- Proposed card: "Client accepted: which order?", listing up to 3 candidates.
- Proposed label: none of the four order labels until someone picks the order. "Needs Updated" would claim we know the
  order, and "Needs Created" would be wrong because the order exists.

**3. We can't find a quote order. Investigate.**

| email | date | what we saw |
|---|---|---|
| 1a13f22ec18faae5 | 10-15 | A PO came in. The system could not tell which client it was, and no order was touched in the next 4 days. |
| 1a140936e8627133 | 10-15 | The client had 3 orders coming up (R9570, R11246, R11602), and your team built a new one (R11661) instead. |

- Proposed card: "Client accepted: no quote order found, check".
- Proposed label: no order label, unless someone confirms the order must be created. Then Order Needs Created.

**Not acceptances, which we'd stop.** On 10-23 the draft rule also fired on:
- 1a168607d1875747: a PO for R11029, a job that ended on 10-22;
- 1a16902a3939cb51: a question, sent 40 minutes after your team had built R11836.

Neither needed work.

**Questions for you:**
1. Do you want acceptances on the TV at all, and does the team treat "confirm the quote order and add the PO" as work it
   would want listed?
2. Situation 1: is "Order Needs Updated" right, or should acceptances carry their own wording or chip? What does "done"
   look like: confirmed in OnSinch, PO entered, team details filled? Should the TV clear the card on that alone?
3. Situation 2: is a list of up to 3 candidate orders useful, or does the team prefer to search OnSinch themselves? Should
   the Gmail thread carry any label while the order is unknown?
4. Situation 3: is "no quote order found" usually a quote sent outside OnSinch (a PDF only), or a client who changed
   plans? Who should pick it up?
5. When a thread first had an inquiry card ("Order Needs Created") and the team then built the order, should ticking that
   first card be required before the acceptance shows as an update? Today the thread keeps "Order Needs Created" while
   both are open (1a16915c98972d9e, on the same thread as 1a16867fcd072728).
6. Is a PO on its own (no other words) an acceptance, or invoice admin? Does it depend on whether the job has already
   happened?

---

## Which label fits each case (the four order labels only; Needs Follow Up is another axis)

| case | card | label | why |
|---|---|---|---|
| 1. order identified | complete R… | Order Needs Updated | The target is known, and it is an existing order. |
| 2. candidates, none certain | which order? up to 3 R… | none of the four | Needs Updated implies a found target; Needs Created is wrong because an order exists. |
| 3. no quote order | investigate | none of the four, until a person decides | The order may exist outside what the system can see. Needs Created only once confirmed. |

A fifth label would break the invariant of exactly four (CLAUDE.md). So cases 2 and 3 are listed on the TV with no Gmail
order label, if Paz agrees.

## A quote-work metric, kept apart from inquiry_recall

**Population.**
- Emails that both readers (plus a third on splits) read as accepting a Spartan quote or offer.
- After each, staff worked on an order of that client within 96 h: a confirm, a PO, team description or contacts, or a
  booking edit.
- This needs an `accepts_quote` field in the reader brief. The current labels mark these only as excluded "already done".

**Metrics.**
- **quote_work_recall** = population emails whose card is in the right case:
  - case 1 names the order staff completed;
  - case 2 lists it among at most 3 candidates;
  - case 3 is flagged with no order, and staff built a new one;

  all ÷ the population.
- **quote_work_precision** = acceptance cards in the right case ÷ acceptance cards shown.
  - A fire on a non-acceptance counts against it, for example 1a168607d1875747.

**Kept apart.**
- inquiry_recall (B42) stays as defined. The two figures are never summed.
- An email counts in both only when the readers also read new booking work in it.

**Illustration on the prospective set, now spent.**
- quote_work_recall: production 0/4, patch 4/4 (R11806, R11807, R11827, R11838).
- quote_work_precision: patch 4/6.
- n = 4 shows direction only.
