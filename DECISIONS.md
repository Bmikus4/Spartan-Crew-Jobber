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

---

# Rulings in force for v2 (copied from code comments, 26 Oct)

D1 to D6 above are September's open questions for the old engine. The rulings below bind the live v2 system.
Each was found in a code comment and is copied here with an id; the comment now carries the same id. The words are
the owner's where the comment quotes them. Owner decisions still OPEN are in ADDENDUM.md §6.

## Standing rulings (ADDENDUM §0)

| id | date | ruling | where |
|---|---|---|---|
| O1 | 26 Oct | No heartbeat for this automation runs in n8n, ever: "no heartbeats should run in n8n ever for this automation". Timers live in the app | CLAUDE.md; ADDENDUM F32 |
| O2 | 24-25 Oct | Production stays shadow; writes stay off (bot_writes_enabled=false since 25 Oct 13:21Z). Model confidence alone is not an execution gate. No prompt change and no paid run without the owner's yes | decisions/2026-10-24-production-stays-shadow.md, decisions/2026-10-25-only-bot-writes-paused.md |
| O3 | 25 Oct | The 40 emails from the 21 Oct pause are stored, not decided ("store them without deciding"). Mail that arrives during a pause is stored only | decisions/2026-10-25-pause-window-store-only.md; app/lib/paused.ts |
| O4 | 26 Oct | Display and TV changes go only with the owner's and Paz's yes | ADDENDUM §0 |
| O5 | 20 Oct | A client's acceptance of a quote ("yes, book that") hands off to a person | ADDENDUM F27, 5.9 |

## Rulings in v2 code

| id | date | ruling | where (comment) |
|---|---|---|---|
| V1 | 10-03, 10-15 | Never the day alone: a link, a pick or a find needs the day plus one more fact (client, venue, times, crew). Code and model must agree | v2/evidence.ts, v2/threadState.ts, interpret/context.ts, interpret/interpret.ts, interpret/plan.ts findOrder, feed/verify.ts |
| V2 | 10-06 | "Never infer from history unless explicitly requested and the job can be found"; a vague request "shouldn't do anything" | interpret/ground.ts, interpret/interpret.ts, interpret/plan.ts header |
| V3 | 10-06 | "The harness needs to know when any UI changes were made so that it can update the protocol": a form is checked against its contract before every fill | v2/bot/contract.ts, v2/bot/canary.ts |
| V4 | 10-09 | A new end alone keeps the shift's start and moves the end; a new start alone moves the whole call and keeps its length | interpret/plan.ts (change_times) |
| V5 | 10-11 | 1 failed order in 100 is the bar; a question back is not a failed order | interpret/plan.ts Decision type |
| V6 | 10-11 | "Drafts should assume the order was already created so that the team can just send them" | v2/draft.ts (deleted 27 Oct, S-0241: reached by nothing; the ruling stands for when drafts are built) |
| V7 | 10-11 | Orders are created whatever profession is named; a trade the system cannot verify is booked as standard crew; an unlisted word is plain crew | interpret/professions.ts |
| V8 | 10-11 | A card note is simple, reliable, informative, and never the system's own reasoning | feed/cardNote.ts |
| V9 | 10-11 | "Port everything from the jobs board into the tv dashboard, mark them all as completed" | feed/ported.ts |
| V10 | 10-13 | The bot tracks every order it makes or changes by the job's J number, linked to the R number; a sweep finds what is not linked | v2/links.ts |
| V11 | 10-13 | "Everything should always be synced every minute" | api/bot/sync/route.ts |
| V12 | 10-13 | The TV shows only what the system could not do | feed/serve.ts |
| V13 | 10-15 | The crew chief rule: 4 or more on a shift carry a Crew Chief, 10+ two, 20+ three, one more per further 10, inside the headcount | interpret/plan.ts chiefsFor |
| V14 | 10-15 | "We should only be creating orders that are more than two weeks out, all updates still should be enabled" (open questions in ADDENDUM §6.1) | interpret/plan.ts (create) |
| V15 | 10-15 | Times a client did not write are assumed from that client's history ("better it exists than not"): no start 08:00, no end the usual length or 4 hours; every assumption is said | interpret/assume.ts, interpret/interpret.ts |
| V16 | 10-15 | A venue that cannot be settled: the client's most used, then the oldest, flagged for staff; no venue at all: "No Location" | interpret/plan.ts (create venue) |
| V17 | 10-15 | No hand-off for a detail the order itself can answer | interpret/plan.ts (location) |
| V18 | 10-15 | Flag a card when the bot assumed the price list | v2/bot/apiCreate.ts |
| V19 | 10-15 | Staffed positions: every change is made, workers included (replacing 10-06's "goes to ops"); a change leaving fewer seats than workers waits; workers come off unconfirmed first, then most recent | v2/bot/run.ts |
| V20 | 10-15 | GPT-6.1 Sol reads the emails ("go with sol") | interpret/extract.ts |
| V21 | 10-15 | Gmail labels come from the TV's own state; earlier systems' labels come off every thread | mail/threadLabels.ts |
| V22 | 10-16 | "Anything that the staff got to first ... you should go quiet" | interpret/plan.ts (staff precedence) |
| V23 | 10-17 | The re-plan is the planner itself, run again: no second pass or second state | v2/replan.ts |
| V24 | 10-20 (Q2a) | The planner runs again every minute on every open card, against OnSinch now, reads only | v2/replan.ts, api/bot/sync/route.ts |
| V25 | 10-20 (Fix 1) | Requests read from history are never new work | interpret/plan.ts |
| V26 | 10-20 (Fix 2) | Already booked is the day and the start, not the exact window | interpret/plan.ts bookedAt, interpret/interpret.ts |
| V27 | 10-20 (Fix 3) | A day already over is never written | interpret/plan.ts |
| V28 | 10-20 (Q4) | The TV no longer draws the paused engine's threads | feed/live.ts |
| V29 | 10-21 | Every job carries its own order's R and J, always correct, or it is not shown | feed/serve.ts, feed/v2.ts, feed/ported.ts |
| V30 | 08-25 | The order manager is Samurai AI (2257) on every order the automation builds: "fill it, leave the contact alone" | v2/bot/apiCreate.ts |
| V31 | 09-29 | The owner's own account (2257) is the stand-in contact on an order whose client has none yet | v2/bot/apiCreate.ts |
| V32 | 08-27 | Creating a client is never gated on information beyond a name (the owner's standing rule; ADDENDUM §6.2 asks again) | interpret/plan.ts (new client) |
| V33 | | A PO is cosmetic (1 in 50): one not proven is left off with a note and never blocks the booking | interpret/interpret.ts, interpret/plan.ts |
| V34 | 10-04..10-10 | The TV's order and clocks: a client waiting 24 h is red and rises (10-04); old untouched work sinks, never hidden (10-05); open above done (10-04, 10-05); Needs Follow Up after a quiet day (10-10); a job has no timer (10-06); quiet resets on any update (10-06); the colour is the need (10-04) | feed/order.ts, feed/project.ts |
| V35 | 10-05, 10-10 | An order the engine wrote is not done until somebody checks it; nothing is sent to ops, ops are told on the TV; the TV starts from go-live (10-10); synced once a minute (10-10) | feed/project.ts, feed/v2.ts, feed/verify.ts |

## Defaults set in code, the owner's to change

| id | date | default | dial |
|---|---|---|---|
| A1 | 27 Oct | Who may change the write and reply switches (bot_writes_enabled, replies_enabled, reply_delivery): the break-glass admin session and the owner's two addresses. Not an owner ruling: the addendum (F34) asked for "admin only" and named no list | SPARTAN_ADMIN_EMAILS adds addresses; the list is OWNER_EMAILS in app/lib/apiAuth.ts |
