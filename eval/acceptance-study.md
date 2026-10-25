# Clients accepting Spartan's quotes: can code catch them?

- Agent: acceptance-study. Brief: audit/briefs/acceptance-study.md with audit/briefs/_common.md, hash 49f7e423.
- Written: 2026-10-25T22:32Z (UTC).
- Data: the 799 emails in .tmp-v2/reads/emails-{1,2,3,4}.json; whole threads from .tmp-data/gold/messages.json (7,289 messages); labels from eval/reads/{A,B}-{1,2,3,4}.csv; decisions from .tmp-data/gold/decisions.json; OnSinch state from .tmp-data/gold/orders.json, timeline.json and links.json.
- B-4.csv was complete when I read it (199 rows), so both readers' labels are used for all 799 emails.
- Read only. No network calls, no model calls, nothing committed. Scratch scripts were kept under .tmp-v2/acc/ and deleted afterwards. The rule is given in full below so its counts can be re-run.

## Summary (one page)

**Q1. Which emails accept a quote?**
- 209 of the 799 emails are in scope:
  - 162 that both readers label new_booking;
  - 47 quotes that list shifts. Both readers label these quote_or_availability, and at least one reader recorded both a day and a crew count (the B42 test).
- 100 of the 209 come after a Spartan message in the same thread. For 99 that message is in the snapshot thread; for 1 it appears only in the client's quoted history.
- I read each of the 100 against Spartan's latest message before it. **73 accept an earlier Spartan quote or offer:**
  - 57 say so outright;
  - 4 only imply it (they send a site contact or promise a PO);
  - 3 accept an offer of crew rather than a quote;
  - 7 accept with a change;
  - 2 accept and add a new request.
- Not counted:
  - 3 answer a Spartan availability offer with a detail before any quote existed;
  - 24 are something else.
- None of the other 109 accepts a quote that was emailed. 3 of them refer to an agreement made by phone.
- **The system decided `none` for 49 of the 73:**
  - none_already_booked: 19;
  - none_nothing_to_do: 19, every one with the reason "no change asked for" (plan.ts:476);
  - "already as asked": 7 (plan.ts:749 and plan.ts:851). The pattern at reasons.ts:42 does not match this bare phrase, so codeOfReason returns "other";
  - none_read_together: 4.
- Of the other 24: 17 were handoffs and 7 were writes (3 verified, 3 blocked, 1 not run).

**The quote is already an order.**
- For 54 of the 73, OnSinch holds an order for that client with a shift on a day the readers named. Each one was created before the acceptance, and no later than about 1 h after Spartan's quoting message.
- Staff created a new order for the day within 6 h of the acceptance in 5 of the 73.
- On the 54 existing orders, staff made these changes in the 72 h after the acceptance:
  - team description: 36;
  - contact list: 34;
  - slot visibility: 31;
  - job admin note: 29;
  - slot status: 20;
  - slot end time: 15; slot start time: 13;
  - crew size: 11.
- So staff do not build these orders by hand. They complete and confirm an order that already exists.

**Q2. Spartan's emails do not state the shifts.**
- How much of each quoting message ground.ts's parsers can read:
  - **fully: 0 of 73**;
  - partly: 20, of which 11 give only a day;
  - not at all: 52;
  - no quoting message in the thread: 1.
- 65 of the 73 quoting messages name a quote. 58 of the 72 in the snapshot thread say the quote is attached, or introduce it in a phrase like "here is a quote". The snapshot holds no attachment, name or content, for any of its 7,289 messages (`attachment_names` is null on all of them).
- **Blocked, partly:** the quoted shifts are missing for all 73 acceptances, though 72 of the 73 quoting messages are present. I continued with what is there.
- The shifts can be read from two other places:
  - the client's own earlier request in the thread: fully readable 26, partly 35, not readable 1, no earlier client message 11;
  - the quote order, for 54.

**Q3. A rule over all 799 emails.**
- The rule: the client's newest words use acceptance wording, and Spartan's latest message in the thread names a quote or asks for confirmation. That message must be no more than 14 days old, the validity Spartan's own footer gives a quote.
- It fires on **88** emails:
  - **70 are booking work for both readers: precision 79.5% (CI 70.0-86.7).**
  - 15 are a PO sent in reply to a quote, which the readers file as po_only. Counting them, 85 of the 88 ask for an action (96.6%).
  - **False positives, where both readers say the email asks for nothing: 1** (1a1362cc9126dca1). It confirms an order Spartan had already confirmed on its side.
  - Of the other 2: one reader says "nothing" for 1a140936e8627133, and both readers call 1a1208e4dea660a8, one of the 73 acceptances, a quote request.
- **Recall: 68 of 73 (93.2%, CI 84.9-97.0).** It catches 44 of the 49 the system decided `none`. It misses 5:
  - 3 implicit acceptances;
  - 1 accepted offer whose Spartan message neither quotes nor asks for confirmation;
  - 1 whose quote is not in the thread within 14 days.
- I tuned the wording on these same 799 emails, so these figures are in-sample. Expect less on new mail.

**Q4. What the order is built from, and what still needs a person.**
- For 54 of the 73 there is nothing to build: the action is to confirm Spartan's own quote order. That means recording:
  - the PO: 37 acceptances carry one, readable with poAfterLabel (ground.ts:162);
  - the site contact: 23 mention one;
  - the team description and admin notes staff set.
- Code alone singles out that order for 37 of the 73. It looks for the client's company, a day the thread's words give, a live order, and creation before the acceptance. Of the other 36, 17 have several candidate orders, 12 have none and 7 have no client company.
- Thread links (links.json) cover 43 of the 73, but 35 of those 43 were first seen after the acceptance, so they cannot be used at decision time.
- A person is still needed for:
  - the 36 whose order code cannot single out;
  - the 9 that change or add to the quote;
  - the 3 accepted offers with no quote order;
  - the 7 that ask for a payment link, a proforma or card payment;
  - the 5 the rule misses.

## Detail

### T1. The 73 acceptances

The columns are:
- **acceptance:** how the email accepts.
- **system and code:** what decisions.json holds. A code is from the stored `code` or codeOfReason (reasons.ts:56).
- **Spartan words readable:** the grade of Spartan's quoting message, with the fields read. A day counts only if it is one the readers named, and a crew count only if a reader wrote it.
- **quote order on day before:** an order of the decision's company_id with a slot on a reader's day, created before the email.
- **code singles it out:** the code-only test in Q4.
- **rule fires:** whether the rule below fires.

| message_id | acceptance | system | code | Spartan words readable | quote order on day before | code singles it out | rule fires |
|---|---|---|---|---|---|---|---|
| 1a13a408e18d3802 | explicit | handoff | request_inconsistent | partly (day) | yes | exactly one | yes |
| 1a13a97ff7a30369 | explicit | handoff | reply_detail_missing | not | yes | exactly one | yes |
| 1a13ad05c65d0447 | explicit | handoff | client_unknown | partly (crew) | no company | no company | yes |
| 1a13ad08da1ce2b9 | explicit | none | none_already_booked | not | yes | several | yes |
| 1a13af9c9a1d50e8 | explicit | none | other: "already as asked" | not | yes | none | yes |
| 1a13f6fc5782f7c3 | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a13fd80597e6e43 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a13fd94ac637812 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a1401fd187dd300 | explicit | none | none_already_booked | not | yes | none | yes |
| 1a143d7e2ac72699 | explicit | none | none_already_booked | partly (day+start) | yes | exactly one | yes |
| 1a14401e46254083 | explicit | none | none_already_booked | not | yes | several | yes |
| 1a14408c111b7d4a | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a1445e617f4b0b2 | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a1449b87f1f53ba | explicit | none | none_already_booked | partly (day) | yes | exactly one | yes |
| 1a14506bcabaaa3a | explicit | none | other: "already as asked" | not | no | none | yes |
| 1a1453ad2be0aa98 | explicit | write | - | not | no | none | yes |
| 1a14638ee5140233 | explicit | handoff | reply_detail_missing | not | no | none | yes |
| 1a15344a323ab432 | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a153bcb54f7f266 | explicit | none | none_nothing_to_do | not | no | several | yes |
| 1a154002a01e1c3e | explicit | none | none_already_booked | partly (len+crew) | yes | several | yes |
| 1a1540528d5a2d27 | explicit | none | none_nothing_to_do | partly (day) | yes | several | yes |
| 1a15473eb1c90e8a | explicit | handoff | reading_unproven | not | yes | exactly one | yes |
| 1a158ba2b8c735d6 | explicit | write | - | not | yes | exactly one | yes |
| 1a158c05c7b4e6b0 | explicit | none | none_already_booked | partly (day) | yes | exactly one | yes |
| 1a158c5ac15f6fdc | explicit | handoff | reply_detail_missing | not | yes | several | yes |
| 1a15902b228e406e | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a1597836ca9af3a | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a159e6d33e42e58 | explicit | none | none_already_booked | not | yes | several | yes |
| 1a159f2b548dfdf2 | explicit | none | none_already_booked | not | yes | none | yes |
| 1a11b442a6f1d6a5 | explicit | none | other: "already as asked" | not | yes | several | yes |
| 1a11bd05142050d8 | explicit | none | none_read_together | not | no company | no company | yes |
| 1a11c1dba37edfea | explicit | none | none_read_together | partly (len) | no company | no company | yes |
| 1a11c837d668e9af | explicit | handoff | other: read together | partly (day) | yes | exactly one | yes |
| 1a11c9e903a4efc5 | explicit | none | none_already_booked | not | yes | exactly one | yes |
| 1a1203afd588ac01 | explicit | none | none_nothing_to_do | partly (day) | yes | exactly one | yes |
| 1a12083a6b0a0ea1 | explicit | none | other: "already as asked" | not | yes | exactly one | yes |
| 1a120963d312ee58 | explicit | handoff | reply_unclear | not | yes | exactly one | yes |
| 1a120ebd658db307 | explicit | none | other: "already as asked" | not | yes | exactly one | yes |
| 1a12129a60b6ebf8 | explicit | none | other: "already as asked" | not | no | several | yes |
| 1a1212b34df3542d | explicit | handoff | reply_unclear | not | no | several | yes |
| 1a1217605fa76233 | explicit | none | none_nothing_to_do | not | no company | no company | yes |
| 1a1217a58683c4a6 | explicit | none | none_nothing_to_do | not | no | none | yes |
| 1a1230b2ceeda6bb | explicit | none | none_nothing_to_do | not | no | several | yes |
| 1a125bc994d79806 | explicit | none | none_nothing_to_do | not | yes | several | yes |
| 1a12f6887ed713a4 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a12fae6327d39de | explicit | none | none_already_booked | partly (day) | yes | exactly one | yes |
| 1a1305b3fb9db23c | explicit | none | other: "already as asked" | partly (start+len) | yes | none | no |
| 1a1307f87ab752b3 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a1308567c26e478 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a130c9740330432 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a1350a4379bc802 | explicit | write | - | not | yes | exactly one | yes |
| 1a1357bc83414e00 | explicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a15ee2f54d7674e | explicit | none | none_read_together | not | no company | no company | yes |
| 1a15ef35c4230de4 | explicit | none | none_read_together | not | no company | no company | yes |
| 1a163209f016cd2d | explicit | write | - | not | yes | exactly one | yes |
| 1a1635a1c1b1b941 | explicit | none | none_already_booked | partly (crew) | yes | exactly one | yes |
| 1a1637f32d75fe09 | explicit | none | none_already_booked | partly (day) | yes | several | yes |
| 1a120422b6fd3b9a | offer | handoff | reply_detail_missing | partly (day) | no | none | yes |
| 1a1211fbe4a3dc72 | offer | none | none_nothing_to_do | partly (day) | yes | several | no |
| 1a130b4e27c044e7 | offer | handoff | booking_not_identified | partly (day+start+crew) | no | none | yes |
| 1a13fc34f09bf745 | implicit | none | none_nothing_to_do | not | yes | exactly one | no |
| 1a14105b82e3493e | implicit | none | none_nothing_to_do | partly (crew) | yes | exactly one | no |
| 1a1215576c68f3e2 | implicit | none | none_nothing_to_do | not | yes | exactly one | no |
| 1a12fba6cf817941 | implicit | none | none_nothing_to_do | not | yes | exactly one | yes |
| 1a14539d35697ee9 | with change | handoff | reply_detail_missing | not | no | none | yes |
| 1a1588e0e23ce5ef | with change | write | - | not | yes | several | yes |
| 1a130467b150f06e | with change | handoff | reply_detail_missing | not | yes | several | yes |
| 1a1308b99b2eaf9b | with change | write | - | not | yes | several | yes |
| 1a162466418c36cc | with change | handoff | reply_detail_missing | not | yes | exactly one | yes |
| 1a162e715892cb17 | with change | handoff | reply_detail_missing | partly (len+crew) | no company | no company | yes |
| 1a158d668f0d1334 | with change | write | - | absent | yes | none | yes |
| 1a11b93614a001a9 | plus new request | handoff | other: read together | not | yes | exactly one | yes |
| 1a1208e4dea660a8 | plus new request | handoff | request_unsupported | partly (day) | no | exactly one | yes |

**Write outcomes.**
- 1a1453ad2be0aa98 set_po: verified.
- 1a1350a4379bc802 set_po: verified.
- 1a158ba2b8c735d6 add_shift: verified.
- 1a163209f016cd2d set_po: not run.
- 1a1588e0e23ce5ef, 1a1308b99b2eaf9b and 1a158d668f0d1334: blocked. Each changes a position size or times.

**Orders created after an acceptance, by whom is not recorded.** These are orders on the day created within 6 h of the acceptance:
- 1a120422b6fd3b9a: 1 h after. It accepted an offer, and no quote order existed.
- 1a130b4e27c044e7: 0 h after. It accepted an offer, and no quote order existed.
- 1a1597836ca9af3a: 0 h after. A quote order also existed.
- 1a1211fbe4a3dc72: 0 h after. A quote order also existed.
- 1a158d668f0d1334: 5 h after. A quote order also existed.

### T2. Emails after a Spartan message that are not acceptances (27 of 100)

- **They answer Spartan's availability offer with a detail, before any quote (3):** 1a139c08af1111d6, 1a159376628160f2, 1a139d57839581af.
- **Other (24):**
  - a new or further request in the same thread;
  - a quote request;
  - an answer to Spartan's question;
  - an amendment to a quote not yet accepted;
  - a refusal of the offer.

  The ids: 1a1399db710f7409, 1a139ada42ba1d76, 1a13a5149fcd9455, 1a13a5fb091090aa, 1a13f86e46191246, 1a1450b8dc7c1e6c, 1a153fd7592e2239, 1a1587d82ff43dd4, 1a159c377a25725b, 1a15a6583c83e5ba, 1a1215769dd333fd, 1a1216e6f5c08444, 1a12179d602c6df4, 1a1218126b1d210b, 1a1254a1b3ef8391, 1a12fc246b1151f2, 1a1303be1b2344bb, 1a135d12439df374, 1a1637eeed35ce33, 1a163a317d8f7476, 1a163b198663b88e, 1a163b46e0a7df1f, 1a16414e865a317c, 1a15e7dd2a875da9.
- **Of the 109 in-scope emails with no earlier Spartan message,** these 3 refer to an agreement made by phone: 1a121327f3dc6507, 1a134a6d63f9f41b, 1a1212954c0b4e15. They are requests, not acceptances of an emailed quote.

### T3. Where the rule fires outside the 73 (20 of 88)

| class | n | message_ids |
|---|---|---|
| booking work for both readers (labelled `change`); each accepts an updated quote or an offer | 3 | 1a13f9bc1c910e5c, 1a1497d7b3445d5f, 1a1598e6aaaba9d0 |
| a PO sent in reply to a quote (both readers po_only, or one po_only and one new_booking) | 15 | 1a13a3116bc14bf3, 1a13f22ec18faae5, 1a146abc65b6623e, 1a153c6ae7df98a2, 1a159e4c31d0440e, 1a11bcaca08fd2f9, 1a1204915fcb51a9, 1a1208931db0f772, 1a120a656b8d514c, 1a12f6443eb128ac, 1a134c495b1271d6, 1a1352eb400586cf, 1a1352f5e4f4c520, 1a15efb943b1bda0, 1a1627f3895c9a29 |
| **false positive:** both readers say it asks for nothing | 1 | 1a1362cc9126dca1 |
| readers split (A new_booking, B nothing) | 1 | 1a140936e8627133 |

**What the system decided for the 88 fires:**
- none_nothing_to_do: 27;
- handoff: 21;
- none_already_booked: 19;
- write: 10;
- "already as asked" (coded as other): 6;
- none_read_together: 4;
- none_already_as_asked: 1.

**The rule misses 5 of the 73:**
- 1a1305b3fb9db23c: Spartan's message in the thread is about 230 days old, so the quote was sent elsewhere;
- 1a1211fbe4a3dc72: an offer of a named crew member, in words that neither quote nor ask for confirmation;
- 1a13fc34f09bf745, 1a14105b82e3493e and 1a1215576c68f3e2: implicit acceptances that give a contact or say thanks, with no acceptance wording.

### Readability method (Q2)

- **Spartan's own words.** This is ground.ts:14 latestText applied to Spartan's message, cut at Spartan's signature boilerplate: the footer line that opens with three asterisks, or the line beginning "Please note, all quotes".
- **The quoting message.** This is the latest Spartan message before the acceptance whose own words name a quote or proforma, or offer crew (availability; "we can", "we could", "we have"; "managed to"). If no message matches, it is the latest Spartan message.
- **The fields:**
  - **day:** datesIn (ground.ts:367) gives a day one of the readers named;
  - **start:** timesIn (ground.ts:304) gives any time;
  - **length:** two times, or durationsIn (ground.ts:350);
  - **crew:** countsIn (ground.ts:331) gives a count either reader wrote.
- **The grades.** Fully readable means all four fields; partly means one to three; not readable means none.
- **A looser grade.** Taking any day and any count, the quoting message is fully readable for 0, partly for 27 and not for 45.
- **Every Spartan message in the thread.** Read together and graded the looser way, they are fully readable for 6 of the 73.
- **The subject line.** subjectDate (ground.ts:213) reads a day from the quoting message's subject in 34 of the 73. Without a time and a count, that is still a partial read at best.

### Order evidence method (Q4)

- **The quote order.** It is an order in orders.json with the decision's company_id, a slot whose London day is one the readers named, and a creation time before the acceptance. Any status in the snapshot counts.
- **Created with the quote.** All 54 such orders were created no later than about 1 h after the quoting message.
- **Staff changes.** These are timeline.json rows on those orders in the 72 h after the acceptance, mapped from Slot, SlotTeam and Job ids to their order.
- **No confirmation step.** No `order_confirm_provisional` row and no `Order.provisional` change falls in that window for any of the 54.
- **What code alone can find.** The test uses only the company, days from datesIn/subjectDate over the thread's words up to the acceptance, a status other than -1, and creation before the acceptance. Reader labels are not used.

## The rule

The rule is written as TypeScript over the snapshot. The helpers come from app/lib/v2/interpret/ground.ts.

```ts
// Inputs: one client email e (message_id, thread_id, date_iso, subject, newest, full_body);
// the thread's messages from .tmp-data/gold/messages.json (is_from_spartan, date_iso, body).
const VALID_H = 14 * 24;                       // Spartan's own terms: a quote is valid 14 days
const own = (body) => latestText(body).split(/\*{3} We now|\*Please note, all quotes/)[0];

// 1. SPARTAN QUOTED: its LATEST message in the thread, within 14 days, names a quote or asks to confirm.
const QUOTE_WORD = /\bquot(e|es|ed|ation)\b|\bpro ?forma\b/i;
const ASKS = /\b(chas(e|ing)|follow(ing)? up|provisional(ly)?|pencil(led)?|any (word|update)|ready to (confirm|move ahead|go ahead)|(moving|move|go(ing)?) ahead|confirm|proceed)\b|\b(see|find)\b.{0,30}\battached\b/i;
function spartanQuoted(e) {
  const t = Date.parse(e.date_iso);
  const last = thread(e).filter(x => x.is_from_spartan && Date.parse(x.date_iso) < t).sort(byDate).at(-1);
  if (last && t - Date.parse(last.date_iso) <= VALID_H * 36e5
      && (QUOTE_WORD.test(own(last.body)) || ASKS.test(own(last.body)))) return true;
  // OnSinch sends the quote itself; its notice survives only in the client's quoted history.
  return /^(re|fw|fwd)\s*:\s*price quote - r\d+/i.test(norm(e.subject))
      && /new order approved[\s\S]{0,300}quote attached/i.test(norm(e.full_body));
}

// 2. ACCEPTANCE WORDING in the client's newest words (HTML tags stripped, normalised, first 600 chars).
const ACCEPT = new RegExp([
  /\bgo(ing)? ahead\b/, /\bproceed\b/,
  /\b(can|could|may|shall) (we|i) (please )?confirm\b/, /\bplease (could i |can we )?confirm (this|it|the (booking|order|job|crew|shifts?))\b/,
  /\b(happy|good|ok|okay|fine) to confirm\b/,
  /\b(this|that|it|order|job|jobs|booking|one|all|everything)('s| is| are| has been| have been)? (all |now )?confirmed\b/, /^(yes,? )?(all )?confirmed\b/,
  /\b(like|want|wish) to (confirm|book)\b/, /\bbook (this|it|that|them|these|the crew)( one)?\b/, /\bplease book\b/, /\bmay this be booked\b/,
  /\block (it |this |that |the \w+ )?in\b/, /\b(looks|sounds) good\b/, /\b(as|for) confirmation\b/,
  /\bp\.?o\.?( number| no\.?)?\s*(is|:|-|#)?\s*[a-z_\-]*\d{3,}/, /\b(attached|find|see) (the |our )?(p\.?o|purchase order)\b/, /\bpurchase order\b/,
  /\b(send|get|raise|sort)( over| you| out)? (a |the |our )?(p\.?o|purchase order)\b/, /\bp\.?o\.? (to follow|will follow)\b/,
].map(r => r.source).join("|"), "i");
const NOT = /\b(cancel(led|ling)?|no longer|not (be )?(go(ing)?|proceed(ing)?) ahead|won'?t (be )?(go(ing)?|proceed(ing)?) ahead|won'?t be (needed|required)|stand down|decline|still (go(ing)? ahead|on|happening))\b|\bconfirm (if|whether|availability|that you|you)\b|\b(can|could) you (please )?confirm\b/i;
const head = (e) => norm(e.newest.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")).slice(0, 600);

// 3. FIRES when both hold.
const accepts = (e) => spartanQuoted(e) && ACCEPT.test(head(e)) && !NOT.test(head(e));

// 4. WHAT IT DOES: confirms the quote order. It never builds shifts from the email.
//    order = the one live order of the sender's company with a slot on a day that the thread's
//            words give (datesIn over each message, subjectDate over each subject), created before e.
//    exactly one -> record the PO (poAfterLabel) and the site contact, and mark the order confirmed
//    several / none / no company, or the email also changes or adds shifts -> a card for a person
```

**Measured over all 799 emails:**
- **It fires on 88.**
- **Both readers call 70 of the 88 booking work.**
- **It catches 68 of the 73 acceptances.**
- **False positives (both readers "nothing"): 1.**
- One part alone fires on: Spartan quoted 269; acceptance wording 130.
- **Two variants were measured and set aside:**
  - Requiring any Spartan message within 14 days that names a quote, rather than the latest message: fires 89, booking work 67, recall 64 of 73, false positives 2.
  - Requiring both conditions: fires 82, booking work 64, recall 63 of 73, false positives 1.

## Limits

- **The acceptance labels are my own reading.** I judged the 100 in-scope emails that follow a Spartan message, as a single reader, and these labels are not adjudicated. The two blind readers labelled what each email asks, not whether it accepts. The boundary cases are in T2 (offer answered) and in T1 (implicit, offer).
- **The rule is in-sample.** Its wording and its Spartan test were tuned on these 799 emails. A held-out week is needed before any figure is quoted as the rule's precision or recall.
- **The quoted shifts are not in the snapshot.** No attachment is stored for any message, so "Spartan's quote states the shift" cannot be tested against the PDF Spartan actually sent. It is tested only against Spartan's email words.
- **Order status is as of the 10-22 snapshot.** Status at the time of each acceptance is not recorded, so "quote order existed" counts orders of any current status. The 72 h staff changes come from timeline.json, which covers only the audit actions fetched.
