# Spartan Crew — Jobber. Handoff, 2026-08-28

Repo `D:\Code\SpartanCrew-Enquiry-Engine`, HEAD **`4e73213`**, everything pushed.
`npx tsc --noEmit` clean, `npx tsx test/all.ts` **80/80**, `npx tsx sim/run.ts` **100/100**.
Production deploy `k9pvmz7uc` is Ready and carries HEAD.

The previous handoff is at `fleet/resume/Spartan-Jobber-2026-08-24.md`. Do not work from
it: the three phases it describes are done, and several of its claims were measured and
found wrong. What is still true is folded in below.

---

# 0. THE FOUR THINGS THAT WILL COST YOU HOURS

**1. THE GIT TRIGGER IS DEAD. A PUSH DEPLOYS NOTHING.**
`git push` produces no build on this project — no error, no queued deployment, nothing.
Every code change needs `npx vercel deploy --prod --yes` by hand. This was proved on
2026-08-27: `e61c539` was pushed, reported fine, and the old code kept running. A live
test was then judged against code that was never deployed.

Setting a Vercel env var DOES trigger a build, which is how a few deploys appeared to
happen on their own and made the trigger look alive.

Always confirm with `npx vercel ls spartan-crew-jobber` and check the age of the top row.

**2. THE INTAKE HAS NO CATCH-UP, AND IT IS THE BIGGEST STRUCTURAL RISK.**
The live n8n workflow (`CPIRu7CpezvKjU8d`, no installer, not built from git) selects mail
with:

    labelIds: ["Label_5089401050847698788"]   (the "New" label)
    receivedAfter: now - 10 minutes

Anything missed by that ten-minute window is never seen again. On 2026-08-26 the Gmail
credential expired and the intake failed every five minutes for **31 hours**; when it
recovered, **33 threads had no engine record at all** — including "4 Crew - Langley -
Monday 09:00" chased three times, and "Q20994 | NEC Conference". Ben chose to drop them.

The label is applied by something outside the engine (a Gmail filter). On 2026-08-27 it
did not fire for 3 of 9 test emails sent within 24 seconds of each other, so those three
were invisible. **There is no filter anywhere in the repo** — the engine dedups on its
own (`inbound_raw.dedup_key`, `message_ledger`, and `handleThread` is idempotent), so the
label is redundant and is a second, unreliable source of truth.

Proposed and NOT yet done, because it edits the live intake: drop the label filter from
`Get many messages`, widen `receivedAfter` to an hour, leave `Poll1` alone. One change,
snapshot first, watch one cycle.

**3. THE OnSinch API LIES BY OMISSION, IN TWO SPECIFIC WAYS.**

*It validates in stages.* Types first, business rules second. A probe that fails on a
type never reaches the rules behind it. This produced a WRONG measurement on 2026-08-27:
poisoning `status` with a string made empty `address`/`city`/`zip` look acceptable to
`POST /companies`. They are not — "Fill in company city" — and four live enquiries died
on the mistake. **When probing, make the deliberate failure land in the SAME stage as the
thing being tested.**

*It accepts credential changes it does not apply.* `PUT /workflows/{id}` on n8n returns
200 and silently keeps the old credential on `httpRequest` nodes using a predefined
credential type. Native `gmail` nodes take it. The only reliable route for those is
DELETE then POST — which is what the installers do.

**4. n8n EDITS ARE STILL THE RECURRING PRODUCTION FAILURE.**
Snapshot to `n8n/backups/` first (gitignored). Prefer editing an installer and re-running
it. `scripts/swap-gmail-credential.mjs` demonstrates the shape: dry run by default,
snapshot before writing, `--from` mandatory, read back afterwards rather than trusting the
response. Its first dry run matched **17 workflows across four different Gmail accounts** —
a blanket swap would have repointed "Send Support Tickets" at the bookings mailbox.

---

# 1. HOUSEKEEPING — do this first, it is small and it is all real

**Artefacts that need a human, because no API can remove them:**

| what | why it exists | how |
|---|---|---|
| company **821** "ZZ PROBE DO NOT CREATE" | the control that proved the createCompany probe method was sound | OnSinch UI — `DELETE /companies` does not exist |
| worker **2715** "ZZ DELETE ME / ProbeWorker (test artefact)" | probing whether the engine can staff its own block | OnSinch UI — `DELETE /workers` is 405 |
| order **15577** R10729 | the one order tonight's tests created; booked against the WRONG client (see §2) | delete unless it is wanted as a sample |
| 4 Gmail drafts "Possible duplicate job:" from 08-24 | real engine output nobody actioned | bin or action them |

**Test residue already cleaned, for the record:** 10 test threads from
`benjamintmikus@gmail.com` archived out of the inbox (label removed, nothing deleted);
3 internal-test Gmail drafts deleted; every corpus order and provisioned venue deleted and
read back; order 15573 deleted; the bad `event solutions uk -> 502` alias deleted.

**19 fuzzy company aliases are still cached** from before the fix that stopped recording
them (`solotech uk group -> 279` seen 9 times, `lacd uk trading as delta live -> 208` seen
8, and 17 more). Each is a guess promoted to a fact, consulted BEFORE the whole-list match,
so it can never be revisited. Most look right. **Do not mass-delete** — that would cause
re-resolution churn on live clients. Review them with Ben, or delete only the ones whose
`raw_example` does not obviously belong to the matched company.

**Scratch scripts** live in `.tmp-data/q/` (gitignored) and several are worth promoting
into `scripts/` if they get used again: the throwaway-n8n-Gmail-proxy pattern (used for
label reads, draft deletion, inbox archiving) is genuinely reusable and is currently
re-implemented in five files.

---

# 2. SECURITY — nothing here is on fire, and all of it is unattended

**The n8n API key has been pasted into chat twice** (2026-08-27). It was rotated once
mid-session; the current key is in `.env.local`. **Rotate it again** — the live one is in a
transcript. Nothing in git contains it.

**`AUTH_REQUIRED=true` is on and holding**: `/api/jobs` and `/api/metrics` both 401 in
production, verified. Google OAuth works — Ben signed in. But:

- `AUTH_ALLOWED_EMAILS` is **not set**. Access is `AUTH_ALLOWED_DOMAIN` plus the in-code
  `BASELINE_EMAILS` in `app/lib/authAllowlist.ts`. Read the recorded trap there before
  touching it: the domain check is enforced IN THE CALLBACK, and an earlier attempt to
  enforce it earlier locked out everyone the allowlist admits by email.
- `INTERNAL_API_SECRET` is referenced at `middleware.ts:28` and **set nowhere**. With
  enforcement on, any NEW machine route that is not added to
  `SKIP = ["/api/auth", "/api/n8n-inbound", "/api/dedupe", "/api/sweep-ingest"]` will 401
  silently. Middleware accepts a session or `INTERNAL_API_SECRET` — **not**
  `x-webhook-secret`.
- Auth envs are **Production-only**, so preview deployments are ungated. A preview URL is
  an unauthenticated read of the same database.

**The Gmail credential is a single point of failure with no alerting.** Its expiry killed
the intake for 31 hours and nobody knew until it was looked at directly. There is no
monitor on n8n execution failures, on intake volume dropping to zero, or on credential
age. That is the highest-value thing to add and it does not exist in any form.

`GMAIL_CRED_ID` / `GMAIL_CRED_NAME` now come from the environment (default
`hGFZ7vGl625ZeExK` / "Spartan Crew 8/27/26"), so the next reconnect is: reconnect in n8n,
set the two vars, re-run the installers, and run `swap-gmail-credential.mjs` for the
bookings workflow which has no installer.

**`SPARTAN_BLOCK_ORDER_REPLACE` is unset**, so the destructive replace path is armed. It
is guarded by attendance (nobody signed on) rather than by a flag — see §3.

---

# 3. LONGEVITY — what actually breaks, and how to test for it

## The pattern behind every serious defect found on 2026-08-27

**Three silent writes, all the same bug wearing different coats: the result of a call was
never checked against what the call claimed to do.**

| write | claimed | actually |
|---|---|---|
| `replaceOrder` | order replaced | deleted it, THEN found it could not re-post — booking lost |
| `createCompany` | client created | had never once succeeded; sent 1 field of 7 |
| `createPlace` | venue created | never checked the status code; a 400 returned `undefined` |

**Two of the three only surfaced when a gate above them was removed.** Treat every gate
you take off as first contact with the path behind it, not as a no-op. The rate-card hold
had been hiding `createCompany` since the method was written.

**A test for this class does not exist and should.** Something that asserts, for every
write method on `OnsinchClient`, that a non-2xx throws and that a 2xx with no id throws.
`createSlotTeam`, `patchOrder`, `patchSlotTeams`, `deleteOrders`, `deletePlaces` have not
been audited for it.

## The three harnesses, and what each is for

    npx tsx sim/run.ts                        100 cases, offline, FREE, no model, no tenant
    npx tsx sim/corpus.ts --n=100 --complex   live tenant, model scripted out, FREE
    npx tsx sim/corpus-real.ts --n=50         live tenant + real model, ~$0.56

`sim/run.ts` is the regression net — keep it at 100/100. The scripted corpus is the one
that finds engine mechanics (it found the 500s under concurrency). The model run is the
only thing that measures extraction, and it found the venue-move bug, the booking-loss
bug and the company bug.

**Always `--cleanup` after a live run**, and read the ledger back. Every corpus order and
provisioned venue from this session was deleted and verified.

## Known measurement traps in the harnesses themselves

- **A rig's clock must be BEFORE the dates its cases book.** `test/seam.ts` sat at
  2026-08-06 for a job its mock dated 2026-03-09; `sim/harness.ts` sat at 2027-01-15 for
  scenarios running from 2026-06-10. Both were simulating work that had already happened,
  invisibly, until the past-date rule exposed them.
- **Never write a time rule against `Date.now()`.** Use the injected `now()`. Doing
  otherwise turned nine test files red and would have rotted every dated fixture.
- **A zero from an unvalidated query is not evidence.** Two Gmail sweeps returned 0 this
  session and both were wrong — one wrong filter field, one wrong label id. Probe the
  query with a control that MUST return rows before trusting a zero.
- **The corpus case generator can ask for changes that are not changes** — a shrink of a
  block of 1, a "move-end" on a case with no stated times, a profession swap between two
  trades the tenant does not have. Nine amendments were scored as engine failures for
  this. Fixed, but the class recurs whenever a factor is added.

## The study, and what it says today

`docs/CORPUS-STUDY-2026-08.md` + the published analysis:
https://claude.ai/code/artifact/15063553-1f6e-4bc8-aea7-d10bec3a5a51

Last full model-in-the-loop run (50 enquiries, $0.56): crew, date, times, role family and
block count all **100%**; venue **90%**; zero errors; amendments applied in place **72%**.
The companion 106-case scripted run: creates **100%**, headcount **100%**, amendments in
place **97.7%**, error taxonomy **none**.

**The study should be re-run after this session's changes** — several fixes landed after
it, and the venue adjudicator wiring changed what it measures.

---

# 4. OPEN DECISIONS FOR BEN — none are safe to guess

1. **A fuzzy company match still books.** "Events Solutions Ltd." booked against
   `502 "Vision Events Solutions LTD"` tonight and took rate card 144 from that company's
   history. The ticket now says so unmissably and the alias is not cached — but it is
   still the wrong client on a real order, and the rate card follows the company. Should a
   fuzzy match book with a warning, or hold?
2. **Shrinking a block crew are signed on to** remains the one unproven row in the
   amendment matrix. The engine refuses it. Answering it needs ONE order raised by hand in
   the OnSinch UI on TEST 515 with a crew block of 3 — the API genuinely cannot fill a seat
   (no `/slots` resource, `POST /attendance` needs a `slot_id` that only a UI-raised order
   exposes). Measured, not inherited.
3. **The intake window and the "New" label** — see §0.2. Needs a yes before touching the
   live workflow.
4. **Reducing crew below 4 rebuilds the order** and changes the R number, because the
   crew-chief block disappears and OnSinch cannot delete a slot team. Correct behaviour,
   but ops should know.

---

# 5. WHERE THINGS ARE

    app/lib/engine/pipeline.ts       the ladder: create -> amend -> replace -> patch
    app/lib/engine/compiler.ts       resolution, composition, every hold decision
    app/lib/engine/onsinch.ts        typed client; createCompany/createPlace defaults live here
    app/lib/engine/provisionPlace.ts venue created BEFORE anything is deleted
    app/lib/engine/venueSearch.ts    RULED_WORDINGS — Spartan's own venue rulings
    app/lib/deps.ts                  the production executor and every webhook
    middleware.ts                    AUTH_REQUIRED and the SKIP list

    scripts/swap-gmail-credential.mjs      credential rotation, scoped and snapshotted
    scripts/install-manual-tag-workflow.mjs the "Manual" tag workflow
    scripts/install-reply-draft-workflow.mjs
    scripts/verify-amend-live.ts --write    the 15-shape live amendment matrix

**Shipped this session** (all deployed): orders reach To Confirm; attendance replaces
`provisional` as the amendment gate; a 500 is retried; a no-op follow-up stops calling a
human; a client who moves the venue is no longer ignored; orders are named by the model
and never "Re:"; a rebuild provisions the venue before deleting; "Albert Hall" means the
Royal Albert Hall; unbookable jobs are tagged **Manual** in the mailbox; an assumed rate
card books and flags rather than holding; a client and a venue can be created from a name
alone.
