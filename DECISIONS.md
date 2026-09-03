# Open decisions

Business rulings the engine must not make for itself. Each states the question, the
options, the cost of getting each one wrong, a recommendation, and what is blocked until
it is answered. Opened at Phase 0, 2026-09-02.

---

## D1 — Placeholder company fields: keep `TBC`, or route to review?

**The conflict.** The remediation charter forbids "fabricated business data (placeholder
addresses, fake emails) to satisfy API validation" and requires routing to human review
instead. The shipped code does the opposite, deliberately: `createCompany` fills
`address`/`city`/`zip` with `"TBC"` and falls `email_invoice` back to
`bookings@spartancrew.co.uk`.

It was not an accident. Established live without creating anything: OnSinch **rejects
blanks** (`{"address":["Fill in address"], …}`), accepts `"TBC"`, and rejects a
placeholder in `email_invoice` outright — that field must parse as a real address. Ben's
standing rule (2026-08-27) is that creating a client is never gated on information
beyond a name. So the three choices are the only three there are.

| option | cost of being wrong |
|---|---|
| **A. Keep `TBC`** (shipped) | An invoice can leave with `TBC` as the address, and Spartan's own address as the billing email. Visible, searchable, corrigible. It is not fiction and it does not read as real. |
| **B. Route new clients to review, book nothing** | This is the behaviour that was **removed** on 2026-08-27 and it is the failure Ben named: measured that day, 2 of 4 correct test enquiries were held solely because the client was new. It re-introduces the gate that nobody opens. |
| **C. Book, and open a review item for the address** | Costs a review-queue mechanism (Phase 2d). Gets both: the booking lands, and the placeholder is on somebody's list rather than only in a field. |

**Recommendation: C, with A as the interim.** A is already live and working (companies
822 and 823 created successfully). C is A plus the queue entry, and needs Phase 2d to
exist. B should not be revisited — it was measured and rejected.

**Blocked until answered:** nothing. This is a ratification, not a gate. If Ben rules
for B, `createCompany`'s defaults come out and §3.3 reverts to held bookings.

---

## D2 — Is Spartan's own outbound mail a job? (findings §3.7)

**Counted:** 30 threads dismissed as own-mail — 23 from `bookings@spartancrew.co.uk`,
7 from `info@spartancrew.co.uk`. Among them `London - Liverpool Collection` and
`Broadwick Live @ Drumshed`.

Labour Fringe was *also* Spartan writing outbound to a supplier, and it **did** produce
an order — because the supplier replied, and the reply was not own-mail. So the same
shape of work is booked or discarded depending on who answered last.

| option | cost of being wrong |
|---|---|
| **A. Outbound is never a job** (current) | Every job Spartan initiates and the client never replies to is lost silently. Up to 30 threads over the sweep. |
| **B. Outbound is always a job** | Internal notes, supplier chasers and marketing mail compose as bookings. The triage own-mail tier exists because this was noisy. |
| **C. Outbound is a job when it carries a dated crew request; route to review** | Needs the review queue. Judged on content rather than on sender. |

**Recommendation: C, behind `TREAT_OUTBOUND_AS_JOB` defaulting to `false`, plus shadow
mode** — classify both ways and count for two weeks, so the ruling is made against real
volume rather than intuition. The classifier already runs in shadow mode for triage
tiers (`triage WOULD have skipped this …`), so the mechanism exists.

**Blocked until answered:** whether the 30 dismissed threads get re-processed.

---

## D3 — The ~124 KB already served unauthenticated: disclose, or note and move on?

`GET /api/jobs` and `/api/metrics` have been open in production for the life of the
deployment. ~124 KB across 258 threads: contact names, companies, venues, dates, crew
sizes, R and J numbers.

Not a technical question. Whether it needs a disclosure to clients, a note in the file,
or nothing, is Spartan's call and possibly its insurer's. There is no access log
available to say whether anyone but Ben ever fetched it.

**Recommendation:** close the hole first (`HANDOVER.md` H1), then decide. The two are
independent and the fix should not wait on the ruling.

**Update 2026-09-03: the hole is closed** — every `/api/*` route on production answers
401, verified by probe (H1). So the precondition is met and this is now purely the
business question: does data served unauthenticated for the life of the deployment, up
to 2026-09-02, need a disclosure? Nothing in the code is waiting on the answer, and
there is still no access log that could say whether anyone but Ben ever fetched it.

**Blocked until answered:** nothing.

---

## D4 — Recreate orders classified `verified_absent`?

Phase 3 will find some recorded ids where no order exists and the evidence says it was
deleted. Six threads already refuse this by hand, correctly: *"order no longer exists in
OnSinch — not recreating it blindly."*

| option | cost of being wrong |
|---|---|
| **A. Never recreate** (current) | A real job that ops deleted by accident stays unbooked, and nobody is told beyond a note. |
| **B. Recreate automatically** | An order somebody deleted **on purpose** — a cancelled job — comes back, and crew are booked for work that is not happening. |
| **C. Propose a recreation into the review queue, with the evidence** | Needs Phase 2d. |

**Recommendation: C.** B is the failure the engine's cancellation guard already exists to
prevent; doing it by another route would be worse for being indirect.

**Blocked until answered:** the disposition of the `verified_absent` subset in Phase 5b.

---

## D5 — Should the wrong-hour corrections be applied by the engine at all?

Seven future orders are booked an hour late (findings §3.1). Correcting them means
`PATCH /slotTeams` against live orders, some of which may already carry signed-on crew.
Three of the seven are part-fixed by hand and `min`/`max` cannot say which blocks moved.

This is the first time the engine would write to production orders **to correct its own
past output** rather than in response to a client email.

**Recommendation:** dry-run report first, every correction through the review queue, one
human approval per order — never a batch. And nothing at all until A7 in
`ASSUMPTIONS.md` is closed, because if block ids cannot be read for engine-raised
orders then there is no in-place route and the answer is hands, not code.

**Blocked until answered:** Phase 5a.

---

## D6 — May the engine re-point a thread at an order a person raised?

**The situation, measured 2026-09-03.** Of 186 recorded order ids, 132 read back present
and 54 absent. Of those 54, **24 have a live order for the same company on the same day,
raised by a named person, with an id and an R number one or two away from ours** — ours
#15588 to #15590 by user 413, ours #15578 to #15585, ours #13783 to #13784. The team
re-keys the engine's order in the OnSinch UI and the original goes. The work was never
lost; our pointer to it was.

Five threads are stranded at `needs-info` on this today, and the engine's live symptom is
`patchOrder 400: Records with specified IDs not found`.

| option | cost of being wrong |
|---|---|
| **A. Refuse and name it** (shipped) | A person still has to apply every change by hand, and the thread stays open until they do. Nothing can go wrong automatically; nothing gets faster. |
| **B. Adopt the successor automatically** and amend it | The engine writes to an order it did not create, on the strength of a company-and-day match. If the match is wrong it amends a DIFFERENT job for the same client on a day they have two bookings — and it would then delete-and-repost somebody's confirmed work. |
| **C. Propose the adoption into the review queue** with the evidence, one human click | Needs Phase 2d. Gets the speed without the engine deciding whose order it may take over. |

**Recommendation: C, with A shipped as the interim.** A is live now: the refusal names
the replacement order, its R number and who raised it, so ops read an order number
instead of a dead end (`orderPreflight.ts`, `test/orderReplacedByHand.ts`). B should not
be taken without the queue: the match is a heuristic, and the one case it gets wrong is
the case where a client has two jobs on one day, which is exactly the client that books
often enough for ops to re-key.

**What would make B safe:** an OnSinch-side link between the order a person raised and
the one it replaced. None exists — the R number is reused after a delete, so it cannot
serve, and no audit action records the deletion at all.

**Blocked until answered:** whether the 24 identified threads get re-pointed in bulk, and
what an amendment to a re-keyed order does. Phase 5b.
