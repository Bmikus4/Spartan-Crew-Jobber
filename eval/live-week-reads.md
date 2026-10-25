# Every client email of the live week, read blind by two readers

- Orchestrator: this file. Readers: reader-A1, reader-A2, reader-B1, reader-B2 (brief audit/briefs/reader.md, hash baffb5cd).
- Written: 2026-10-25.
- Data: the 400 client emails of week-review-1014.json (10-14 00:00Z .. 10-21 02:00Z), joined to `.tmp-data/gold/messages.json` on (date, subject), 400 of 400. Decisions come from `.tmp-data/gold/decisions.json`. Staff acts come from week-truth-acts.json.
- Read only. No network. No model API call.
- Labels: eval/reads/A-*.csv and eval/reads/B-*.csv. Rows for the owner or Paz to settle: eval/reads/adjudicate.csv. Scripts: eval/reads/scripts/, run from the repo root with `npx tsx` in this order: build, score, nones, cands, booked, more, adjud. Intermediate files go to .tmp-v2/reads/.

## Summary (one page)

**Why.**
- Silent misses had been counted only over the 84 emails staff acted on; 291 of the 400 were never read (spec-compliance S67-9, S4-2, S67-1).
- Two readers, blind to what the system did, read all 400 from their own words.
- The 109 already read serve as a check on the readers.

**The readers agree.**
- On whether an email asks for booking work (a new booking, a change or a cancellation): 394 of 400 (98.5%, CI 96.8-99.4; kappa 0.97).
- On the days asked for: 109 of 110 rows.
- On crew counts, where both readers stated one: 62 of 64.
- 170 of 800 labels are marked unsure. The 6 disagreements, the third reader's 2 differences and 28 other rows that change a count are in adjudicate.csv.
- **A third blind reader (reader-V) re-read a 10% sample.** It matches the pair on 38 of the 40 rows where they agreed (95%, CI 83-99%), and on 10 of 10 day sets. Its 2 differences are a PO-only versus a change, and a quote versus a booking: the same boundaries flagged below. On the 6 rows the pair split, it sides with reader A 4 times and with B twice.
- The labels are not adjudicated yet. They are a measurement, not the eval set's ground truth (§6.5).

**What the 400 are.**
- 136 ask for booking work, according to both readers.
  - 26 of the 136 are OnSinch's own client-portal notices ("client created order ... needs approval"), all from one OnSinch no-reply address. The order is already in OnSinch and waits for approval there. The sender rule suppresses them (`process.ts:161`), and that is right: they are not requests to this system.
  - 20 more were already done when decided. The system said "already booked" or "already as asked". 14 of these are confirmed against the snapshot: an order with a live shift on the asked day. 4 cite an order no longer in either snapshot, and 2 were not checked.
  - **That leaves 90 outstanding requests for booking work.**
- 23 more are quote or availability requests only, according to both readers.

**Silent misses over all client mail: 16 of the 90. inquiry_recall is 74/90 = 82.2% (CI 72.7-89.5); the target is 99.5%.**
- **8 were decided `none` because the model read no change.**
  - Staff then built or changed the order on the named day for 4 of them: 1a13fd80597e6e43, 1a13fd94ac637812, 1a159376628160f2 and 1a14105b82e3493e.
  - 1a13fd94ac637812 is one of the taxonomist's label_wrong rows. Both readers read it as a booking, and staff created an order on its day. So the label_wrong call is wrong.
  - The other 4 are three quote acceptances and one site-contact change, with no staff act visible in the fetched actions.
- **8 were needs-reply items, which neither the TV nor Gmail shows.** Staff acted on the named day for 4. Our first reply came within 2 h for 7; one waited 61 h (1a14638ee5140233).
- The staff-acted count was 4/84. Over all mail it is 16/90. Counting every quote request as an inquiry, it is 24 of 113 (78.8%, CI 70.1-85.9).
- **Under the owner's own rule B42 (10-15)**, "Quotes that list shifts become orders", a quote is an inquiry when a reader recorded a day and a crew count for it. That adds 15 inquiries and 2 silent misses: **18 of 105, inquiry_recall 82.9% (CI 74.3-89.5)**. This is the working figure. A quote with no shifts is a reply (scripts/b42.mts).

**Quotes are the boundary that moves the numbers.**
- The taxonomist's other 3 silent misses are quote requests, according to both readers, and staff turned them into orders.
- 7 of the system's 19 `create_order` writes were also on quote requests.
- Whether a quote request that names a day, times and crew is a booking is a ruling for the owner.

**What is shown.**
- 104 items were shown: 81 listed cards plus 23 writes that ran.
- Both readers call 96 of them a request of some kind (92.3%, CI 85.4-96.6), and 74 booking work (71.2%).
- Both readers call 5 of them "nothing" (4.8%), all listed cards. That is the noise. **display_precision ≈ 92%.**

**NONE.** Of 19 `create_order` writes, 12 were on emails both readers call a new booking (63%), and 7 on quote requests. None was on an email that asks for nothing.

## Detail

| | count |
|---|---|
| system outcome over the 400 | none 278, listed 81, verified write 23, needs-reply 18 |
| both readers: booking work | 136: listed 59, none 54, verified write 15, needs-reply 8 |
| the 54 `none` | 26 OnSinch portal notices (rule); 16 already booked; 2 already as asked; 2 "other", which are both already as asked; 8 nothing to do |
| readers disagree | 6: 2 `none`, 4 listed (3 declined quotes, 1 crew-chief preference) |
| both readers: quote or availability only | 23: listed 9, verified write 6, needs-reply 6, none 2 |
| both readers: nothing | 176 `none`, 5 listed |
| against the taxonomist's 117 rows | TV outcome derived the same way on 117 of 117. 26 of its 37 label_wrong rows are not booking work for either reader. 57 of its 77 system misses are booking work for both. Of the other 20, 15 are quote requests, 2 are nothing for both, and 3 are disputed |

**Method.**
- Readers saw each email's newest part, its full body cut at 6,000 characters, attachments, and up to 3 earlier thread messages. They saw no system output and no labels (brief).
- "Silent" counts a `none` or a needs-reply item, as the taxonomist did (failure-taxonomy.md §1).
- Staff acts are those of the email's company, within 72 h, on an order with a live shift on a day either reader named (eval/reads/scripts/cands.mts).
- "Already booked" was checked by the R number in the decision's reason against both snapshots (scripts/booked.mts).

**Limits.**
- The readers are two agents with one brief. Their agreement measures consistency, not truth.
- Staff acts cover only the 8 fetched audit actions, so "no staff act" can mean the act was of another kind.
- One week; n = 90. The interval is about ±8 points.
