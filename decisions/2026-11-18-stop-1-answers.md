# 2026-11-18 Stop 1 answers: only a person clears a TV card, and five settled questions

**Decided by:** the owner, 18 Nov, answering Stop 1 of the data-home program
(`decisions/2026-11-17-data-home-program-rulings.md`, open decisions A to E). The answers came in two messages; the
second corrected the first reading of B.

| id | ruling | supersedes |
|---|---|---|
| O43 | **Only a person clears a TV card** (B). "The app never marks anything confirmed in the dashboard anymore. All decisions are up to staff in the dashboard." What the system infers (staff's work found in OnSinch, agreed with the client, answered by a later email) shows on the card as a "Looks ..." hint and never clears it. Measured scale (fact pack, `v2_card_exits` 12 Oct to 17 Nov): of 335 exits, those three closed 225 on their own; a person's tick closed 22. | O33 (work found in OnSinch turns a card Done). Settles O41's scope (open decision B). Housekeeping exits (day passed, superseded, left the TV) are not confirmations and are unchanged. |
| O44 | **A check and an X on every card.** The single Confirm becomes two icon-only rounded buttons at the card's right-hand end: a green check (done, right) and a red X (not needed), large enough to hit on the TV. Either clears the card; pressing the lit one again undoes it. Neither writes to OnSinch; O35 still decides when the check books. The owner asked for this to be built now ("build it, go"), ahead of Stop 2. | The 10-10 rule that kept Confirm off red, for the X only. The prompt's "display changes need the owner's and Paz's yes": the owner's is given; Paz has not seen it yet. |
| O45 | **A: the direction of the day window is confirmed.** Jobs far off may be written automatically once enabled; jobs near go to staff with a plan. | Closes open decision A as worded in the 17 Nov file. |
| O46 | **C and C2: the data home's scope.** bookings@ in full; paz@, jenny@, info@ and accounts@ only with Paz's yes. Staff personal data is pulled; staff pay data is not: OnSinch payments, wallets and reimbursements are skipped, and bank, wage and payment-method fields are dropped from workers, attendance and transport attendance (and from the production snapshot), each dropped field named in the manifest. Client prices stay. Mailboxes are pulled last and never stop the program: they wait on Paz's grant. | Closes C and the C2 added at Stop 1. Replaces the prompt's "if the grant is not in place, stop and tell me" with: skip it, keep going, report the gap. |
| O47 | **D: the data home lives on D:** (`D:/spartan-data`), and its second copy also goes on D. No other location is proposed. | Closes D; the Stop 1 plan's M: proposal is withdrawn. |
| O48 | **E: when the app or intake goes quiet, one email to the owner's inbox, and nowhere else.** | Amends O39 (email alarms removed completely) for this one alarm. Not built yet. Today no alarm reaches anyone: `errorReport.ts` posts to the n8n webhook of the deleted Spartan Alarms workflow. |

Also settled: the n8n Watchdog and Alarms workflows were already deleted, so that item leaves the owner's list.
