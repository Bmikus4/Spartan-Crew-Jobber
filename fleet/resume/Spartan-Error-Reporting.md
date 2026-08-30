# Spartan Crew — Error Reporting. Handoff, 2026-08-29

Three jobs, in this order. Build the first, verify the second and third.

**Do only what is written here.** The engine has a large backlog and none of it belongs
in this session — see `fleet/resume/Spartan-Jobber.md` for that, and leave it alone.

---

## STATE OF THE WORLD BEFORE YOU START

Repo `D:\Code\SpartanCrew-Enquiry-Engine`, branch **`foundations-identity-record`**,
pushed to origin, **15 commits ahead of `main`**, **not merged**, **not deployed**.
`npx tsc --noEmit` clean, `npx tsx test/all.ts` **87/87**, `npx tsx sim/run.ts` **104/104**.

What is on that branch and live-behaviour-relevant: the year-roll fix, counterparty
identity fields, role funnels, the **Order Built** tag (job 3 below), and simulator
accuracy work. Two things are built but deliberately unwired — `order_records` and
`verifyCreate` — and one, the engine-owned identity gate, was built and reverted.

**A PUSH DEPLOYS NOTHING.** The git trigger on this project is dead: no build, no error,
nothing queued. Production only moves on `npx vercel deploy --prod --yes` by hand, and
you confirm it landed with `npx vercel ls spartan-crew-jobber` and the age of the top
row. This has already caused one live test to be judged against code that was never
deployed.

`SPARTAN_BLOCK_ORDER_REPLACE=1` is set in Production, so nothing in the engine can
delete and recreate an order. Leave it set.

---

# JOB 1 — Build Spartan's error reporting

Spartan has **no error reporting at all**. Eleven `console.error` sites in
`app/lib/engine/pipeline.ts` and `app/lib/deps.ts` write to Vercel logs and nowhere
else. When the Gmail credential expired on 2026-08-26 the intake failed every five
minutes for **42 hours** and nobody knew until someone looked directly.

## Port, do not invent

`D:\Code\HoH-Quote-Tool-GH\app\lib\errorReport.ts` (251 lines) already solves this and
is pinned by `tests/errorReport.test.ts` in that repo. Port it rather than writing a
second design — two error paths is two things to keep working.

What it gives you, and why each part matters:

- **A fingerprint** that normalises the volatile parts of a message, so the same fault
  arriving a hundred times has one identity rather than a hundred.
- **A window** (`DEFAULT_WINDOW_MS`, 6 hours) so a flood collapses into one email
  carrying a running count, and the count travels with the email so the reader can
  judge severity.
- **Every occurrence recorded even when no email is sent** — table `error_reports`,
  keyed on fingerprint. This is the part that makes silence trustworthy: an empty inbox
  has to mean an empty system, not a suppressed one.
- **Fail-soft**: `reportError` never throws and is always called with `void`. An error
  report must never be the reason a booking fails.
- **No webhook means no email, silently.** A preview deployment and a local run have no
  business emailing anyone. In HoH this is `notifyAllowed()`, gated on `process.env.VERCEL`
  with `SUPPORT_TICKET_NOTIFY=1` as the deliberate local override.

**Read the HoH version before you start**, including its comments — they record why the
window is 6 hours and why a `lastEmailedAt` in the future suppresses rather than emails.

## The four routes to build

Distinguished by what they mean to the person reading them, not by where they were
thrown.

**1. A booking was lost.** A create or amendment that failed outright: `createCompany`
or `createPlace` rejected, a 500 that survived the transport's retries, a rebuild that
deleted an order and could not re-post it. The client asked for crew and there is none.
Emails immediately. Call sites are the `catch` blocks in `app/lib/deps.ts` and the
`status = "error"` paths in `app/lib/engine/pipeline.ts`.

**2. A write we cannot confirm.** `verifyCreate` in `app/lib/engine/verifyWrite.ts`
compares a create against OnSinch's own `order_created_via_api` audit row. It exists,
is tested, and **is not wired to anything** — wiring it is part of the amendment plan,
not this one. So: build the route, leave a single clearly-marked call site ready, and
say in your report that it is inert until that plan lands. Do not wire it here.

**3. The engine threw.** Any unhandled exception escaping `handleThread`. Today these
vanish into Vercel logs entirely.

**4. The intake went quiet.** No mail reaching the engine for N minutes during working
hours.

**Route 4 cannot come from the engine, and that is the whole point** — an engine that is
not running cannot report that it is not running. It has to be asked from outside, on a
schedule, which is exactly what was missing during the 42-hour outage while every
dashboard looked healthy. Build it as an n8n Schedule workflow that queries a small
read-only endpoint (`/api/health/intake` or similar) answering "when did anything last
arrive". The engine-side half is a trivial query against `inbound_raw.received_at`; the
alerting half lives in n8n.

**If you only get one route done, make it route 4.** Routes 1–3 tell you a specific job
broke. Route 4 is the only one that tells you the whole thing stopped.

## Verify it

- `npx tsc --noEmit` clean; `npx tsx test/all.ts` at or above 87; `npx tsx sim/run.ts`
  at 104/104.
- A test file pinning: the fingerprint collapses two variants of the same fault to one
  identity; the window suppresses the second email and increments the count; an
  occurrence is recorded even when no email is sent; `reportError` never throws when the
  webhook is absent, when it 500s, and when it returns 200 with an empty body.
- **Prove the test cannot pass against the unbuilt code.** Run it before you implement
  and confirm it fails. This repo has shipped tests that passed for the wrong reason
  twice this week.

**DO NOT let the test suite send real email.** In HoH, local runs sent 17 real emails
before that was gated. Whatever gate you port, assert it in a test: with `VERCEL` unset
and no override, nothing is posted anywhere.

## Then commit and push

Pathspec form — `git commit -o <paths> -m "..."`; this repo has had commits pick up
unrelated staged work. Commit message states what is now true, not what you did.
Push the branch. **Do not deploy** unless Ben says so.

---

# JOB 2 — Verify every error path emails samuraisolutionsofficial@gmail.com

Verification, not a rebuild. Snapshots of both live workflows are already in
`n8n/backups/` as of 2026-08-29.

## What was found on 2026-08-29, and what it means

| path | route | recipients | status |
|---|---|---|---|
| HoH/Kairo `reportError` | n8n `Send Support Tickets` (`zyk7PY7Bju8nepCb`, active) → Gmail node "Send a message" | `ben@samuraisolutions.co.uk, samuraisolutionsofficial@gmail.com` | **already correct** |
| HoH weekly report | same workflow, "Send Weekly Report" | `ben@`, `steven@`, `samuraisolutionsofficial@gmail.com` | **already correct** |
| Samurai Proposal — Error Alert (`317nE47ZpSido0X7`, active) | `errorTrigger` → Resend (`api.resend.com/emails`) | **`steven@samuraisolutions.co.uk` only** | **GAP — fix this** |
| `Email SamurAI Error` (`NZ9lV5RxNz77ttBx`) | inactive | unchecked | check whether it matters |
| Spartan | nothing | — | Job 1 |

So the real work here is the **Resend** path, whose recipient is built in a `code` node
("Build Alert") rather than in a Gmail node.

## The unresolved question — ask Ben before editing

"Change the send-to" has two readings and he has not picked one: **add**
`samuraisolutionsofficial@gmail.com` (already true for the two Gmail paths), or
**replace** `ben@samuraisolutions.co.uk` so errors stop reaching him personally.

Do not guess. Removing Ben from error alerts is not reversible by the next person who
wonders why they stopped arriving.

## How to touch n8n safely

**n8n edits are the recurring production failure in this system.** Snapshot to
`n8n/backups/` first (already done for both workflows, re-snapshot if time has passed),
change one field, and **read the workflow back afterwards rather than trusting the
response**: `PUT /workflows/{id}` returns 200 and silently keeps the old value on
`httpRequest` nodes using a predefined credential type. Native `gmail` nodes take the
change. Verify by re-reading, always.

`scripts/swap-gmail-credential.mjs` is the shape to copy: dry run by default, snapshot
before writing, read back after.

## Prove it end to end

A recipient list that looks right is not proof. Trigger one real error on each live path
and confirm an email arrives at `samuraisolutionsofficial@gmail.com`. For HoH the
override is `SUPPORT_TICKET_NOTIFY=1`. Record in your report which paths you actually
fired versus which you only read.

---

# JOB 3 — Verify "Order Built" lands as a TAG, not an email

`flagBuiltIfNeeded` in `app/lib/engine/pipeline.ts` and `flagOrderBuilt` in
`app/lib/deps.ts` are on the branch, tested by `test/orderBuiltTag.ts`, and **not yet
deployed**.

## What it is meant to do

When an order exists for a thread, the thread gets the Gmail label **"Order Built"** in
the bookings mailbox. It clears if the order stops existing. It is independent of the
Manual tag — a job booked on an assumed rate card is honestly both.

**It must never send an email.** It posts to `MANUAL_TAG_WEBHOOK`, the same n8n workflow
the Manual tag uses, which applies a Gmail *label*. That workflow reads the label out of
the payload (`label: b.label || 'Manual'`) and creates it in the mailbox if it has never
seen it — which is why this needed no n8n change at all.

## How to verify

1. Deploy the branch (Ben's call), then confirm production carries the new HEAD:
   `npx vercel ls spartan-crew-jobber` and check the age of the top row. **A push alone
   proves nothing.**
2. `MANUAL_TAG_WEBHOOK` is set in **Production only**. Confirm with `npx vercel env ls`.
   Unset means no tag, silently, and the verification will look like a failure that is
   really a missing variable.
3. Send one enquiry through the live endpoint
   (`https://spartan-crew-jobber.vercel.app/api/n8n-inbound`, header `x-webhook-secret`)
   and confirm it books. The pattern is in this session's history; use an existing
   client and a real venue so nothing new is provisioned.
4. **Look in the mailbox.** The thread must carry the label "Order Built" and **no email
   must have been sent about it**. Both halves matter — the second is the thing Ben
   asked to be verified.
5. Delete the test order in OnSinch and read it back to confirm it is gone, then clear
   the engine's `conversation_state` row so nothing points at a deleted order.

## Two behaviours that will look like bugs and are not

- **It only fires on threads that see activity after the deploy.** Existing bookings
  stay untagged until their thread gets another message. It is not retroactive.
- **A failed post leaves the marker unset on purpose**, so the next message retries. If
  you see it attempt twice, that is the design, not a loop.

---

## TRAPS THAT WILL COST YOU HOURS

- **A push deploys nothing.** Manual `vercel deploy --prod --yes`, then confirm.
- **The local server writes to the LIVE production database.** `conversation_state`,
  `error_reports` and everything else. There is no separate dev database.
- **n8n `PUT /workflows/{id}` returns 200 and silently ignores credential changes on
  `httpRequest` nodes.** Read back, never trust the response.
- **`sim/run.ts` reports outcome and reason agreement separately now.** 104/104 outcome
  with 103/104 reason is the expected baseline — `I-confirmed-order` refuses correctly
  for a different reason than the rules predict. Do not "fix" it without reading it.
- **Do not bulk-run `sim/corpus-real.ts`.** It spends real money and writes real orders
  to the live tenant. Price with `sim/corpus-price.ts` first and always `--cleanup`.

## DEFERRED, FROM THE BRANCH'S OWN REVIEWS

- `order_records` is tested but receives **no production writes**: `Executor.createOrder`
  takes only a `DesiredOrder`, which carries no thread id. Widening that interface was
  ruled out of scope and belongs to a later plan.
- `verifyCreate` / `readCreateAudit` exist and are wired to nothing.
- The engine-owned identity gate was **reverted**. `/api/dedupe` already claims every
  message before the engine runs, so the engine's own claim always saw
  `first_seen: false` and silently dropped every amendment. A gate the engine owns needs
  a consumer column on `message_ledger`.
- `dataCollection.ts`'s comment still says support tickets go to
  `ben@samuraisolutions.co.uk`. That stopped being true; fix the comment while you are
  in there for Job 2.
