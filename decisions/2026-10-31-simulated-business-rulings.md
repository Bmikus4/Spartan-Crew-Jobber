# 2026-10-31 Rulings from the simulated business (ADDENDUM §14)

**Decided by:** the owner (31 Oct), answering ADDENDUM §14.10 after the first 270 generated cases.

**Rulings.**
1. **No crew ceiling.** A call of 20 crew from one email is planned like a call of 2.
2. **"We shouldn't be creating or updating jobs ourselves live."** Production never creates or updates an OnSinch
   job: bot_writes_enabled stays false, and the planner's writes are plans the TV and the measurement loop read. Only
   the simulator applies them, to its fake OnSinch.
3. **The missing-venue rule stands:** a booking with no venue is asked of the client, unless the two-week rule hands
   it to staff first; **"unless a good match is nearly beyond a reasonable doubt."** Measured the same day
   (`.tmp-v2/venuehistory.ts`, `.tmp-v2/novenue.ts`, read-only), nothing reaches that yet, so nothing is inferred:
   - the client's history: when its last 10 staff orders were all at one venue the next was there 94.4% of the time
     (102 of 108); 20 of 20, 98.5% (64 of 65), on 2% of orders;
   - the subject or earlier in the thread: of the 5 real "no venue" decisions since 9 Oct, none names exactly one
     OnSinch place there.
4. **"With no year specified always assume current year."** A date written without a year is in the year of the
   email's sent date, also when that day has passed (the planner then refuses it as past). Until this ruling a date
   before the sent day rolled to next year (a January written in December), and a weekday with a bare day could
   read as a year on.
5. **The OpenRouter key:** Spartan's model calls use the Spartan Crew Pipeline key only (the one n8n uses).
