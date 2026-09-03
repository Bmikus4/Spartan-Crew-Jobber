# Handover — tasks only a person can do

Opened at Phase 0, 2026-09-02. Each item says who must do it, the exact steps, the
command or screen that verifies it, and what is blocked until it is done.

---

## H1 — Turn on authentication (findings §3.9) — **DONE, verified 2026-09-03**

**This is closed and needed nothing from this session.** Somebody completed it between
09-02 and 09-03. Measured against `https://spartan-crew-jobber.vercel.app`:

| probe | answer |
|---|---|
| `GET /api/jobs`, `/api/metrics`, `/api/settings`, `/api/onboarding`, `/api/confirm-order` | **401**, body `{"error":"Unauthorized"}` |
| `GET /api/health/intake` | 401 from its own secret check, not the session gate |
| `GET /api/auth/google` | **302** to `accounts.google.com` with a real `client_id` and `redirect_uri=https://spartan-crew-jobber.vercel.app/api/auth/google/callback` |
| `GET /` | 200, the board still renders |

The 401 body is the middleware's own JSON rather than a Vercel login page, so the gate
is `AUTH_REQUIRED=true` in Production and not deployment protection — which matters,
because deployment protection would also have blocked n8n. Google OAuth is configured,
so the team is not locked out: the failure mode this item warned about did not happen.

Charter invariant 4 ("every API route denies unauthenticated requests by default in
production") is therefore satisfied, and it is held in code as well as in config:
`test/machineRouteAuth.ts` parses the SKIP list out of `middleware.ts` and asserts each
skipped route has no "unconfigured means allowed" branch, and
`test/writeRoutesAuthorised.ts` sweeps every route file and asserts each state-changing
method consults an authority. A route added tomorrow is checked by both.

The original steps are kept below as the record of what was done.

### The original instructions

`GET /api/jobs` and `/api/metrics` are open in production. ~124 KB across 258 threads:
contact names, companies, venues, dates, crew sizes, R and J numbers.

**Nothing needs building.** `middleware.ts` already gates `/api/*` on an iron-session,
fails closed, and enforces on preview deployments regardless of the switch
(`VERCEL_ENV === "preview"`). The whole item is a sequence of clicks, and the order
matters — flipping the switch before sign-in is verified locks the team out of the board.

1. **Google Cloud console** — create an OAuth 2.0 Web client for the project.
   Authorised redirect URI: `https://<production-domain>/api/auth/google/callback`.
2. **Vercel → Project → Settings → Environment Variables**, Production:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SESSION_PASSWORD` — 32+ random chars, if not already set in Production
   - `AUTH_ALLOWED_DOMAIN` — the allowlist. **The trap:** an empty or absent allowlist
     with enforcement on admits nobody. Set it and confirm it before step 4.
3. **Redeploy**, then sign in at the production URL **while `AUTH_REQUIRED` is still
   unset**. You should reach the board normally. If sign-in fails here, the lock is not
   ready and nothing has been broken.
4. Only once step 3 succeeds: add `AUTH_REQUIRED=true` to Production and redeploy.

**Verify:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<production-domain>/api/jobs   # expect 401
curl -s -o /dev/null -w '%{http_code}\n' https://<production-domain>/api/health/intake  # expect 200 or 401 by secret, never 500
```

Then open the board in a browser and confirm it still loads and lists jobs.

**Do not skip the n8n check.** `/api/n8n-inbound`, `/api/dedupe`, `/api/sweep-ingest`
and `/api/health` are in the middleware SKIP list and authenticate on
`N8N_WEBHOOK_SECRET` instead. Confirm that variable is set in Production before step 4,
or the mailbox stops being processed the moment enforcement turns on.

**Blocked until done:** nothing in the code. This is the largest open exposure in the
system and it is waiting on a browser, not on a commit.

**Related ruling:** whether the data already served needs a disclosure is `DECISIONS.md`
D3. Independent of this — close the hole first.

---

## H2 — Correct three September orders by hand in the OnSinch UI (findings §3.1)

Three of the seven wrong-hour orders **cannot** be corrected by the engine. Their crew
blocks have no addressable ids and never will — see `docs/PHASE0-SYSTEM-MODEL.md` §5.4a.
An order raised through `POST /orders` logs one childless audit row, so the block ids
exist nowhere, and there is no service key that changes that.

Every block on each of these is exactly **one hour late**. Move each block one hour
earlier:

| order | R | date | blocks to move |
|---|---|---|---|
| #15761 | R10807 | 2026-09-04 | 1 |
| #15762 | R10808 | 2026-09-24 → 09-30 | **blocks 2 and 3 only** — block 1 was already corrected by hand |
| #15763 | R10809 | 2026-09-07 | 4 |

`R10808` is Labour Fringe. Blocks 2 and 3 currently read 10:00–18:00 and should read
09:00–17:00. Block 1 is already right; moving it again makes it wrong.

**Verify:** `node scripts/verify-times.mjs` and confirm these three no longer appear
under the untouched/part-fixed headings.

**Note on the other four** (#14855 R10702, #15574 R10726, #15593 R10742, #15594 R10743):
these *are* addressable — they carry real team ids from the two-phase-create era — and
are Phase 5a code work, once `DECISIONS.md` D5 is ruled on.

An earlier version of this item said #15574 carried a "suspect R number" and warned
against touching it. **That was wrong and is withdrawn.** #15574 holds `R10726` in
OnSinch, which is exactly what we recorded — verified by direct read, 2026-09-02. There
is no R-number defect; see `docs/PHASE0-SYSTEM-MODEL.md` §5.4b for why the claim was made
and how it was falsified.

---

## H2b — Try the local build on C: — **DONE, 2026-09-03. It is the filesystem.**

Run at commit `46c7cd3` in a git worktree on `C:` (NTFS) with its own `npm ci`:

```
tsc --noEmit   exit 0
npm run build  Compiled successfully in 16.4s, 14 routes + middleware, exit 0
```

No `EISDIR`, no readlink failure, nothing changed in the repo. The diagnosis in
`docs/PHASE0-SYSTEM-MODEL.md` §5.3 is confirmed: `D:` is exFAT and its driver answers
`readlink()` on a regular file with EISDIR where NTFS answers EINVAL, and webpack's
resolver only handles EINVAL. **The answer is to keep a build checkout on `C:`; nothing
in the repo needs changing.** The worktree used was `C:/spartan-headcheck`, made with
`git worktree add --detach`, which costs no second clone.

That run also caught something the exFAT failure had been masking: **HEAD `1471293` did
not typecheck.** It carried the reader for `id_source`/`verified_at`/`OrderContext` in
`app/lib/deps.ts` while the type declarations sat uncommitted in the working tree, so
`tsc` gave 4 errors and `next build` failed on the type check rather than on readlink.
It was never deployed — production is a CLI deploy from 09-02 — and committing the
working tree repaired it. The lesson is in H3.

### The original instructions

Not engine work and it changes no production behaviour, which is why it is here rather
than in a phase. `next build` fails on this checkout with `EISDIR ... readlink` on an
ordinary file. Cause is proven — `D:` is exFAT and its driver answers `readlink` with
EISDIR on every regular file, where NTFS answers EINVAL (see
`docs/PHASE0-SYSTEM-MODEL.md` §5.3). Three config fixes were tried and none work; the
readlink is inside webpack's resolver file-system layer.

The one test that would settle it:

```bash
# stop the dev server on 3111 first, or this fights it for .next
git clone D:/Code/SpartanCrew-Enquiry-Engine C:/spartan-buildtest
cd C:/spartan-buildtest && npm ci && npm run build
```

If it builds on `C:`, the failure is entirely the filesystem and the answer is to keep a
build checkout on `C:` — nothing in the repo needs changing. If it fails there too, there
is a real defect and it deserves a proper look.

`tsc --noEmit` and the 93-file test suite both pass either way, and Vercel builds fine
(Linux, ext4), so nothing is blocked on this except local bundling checks.

---

## H3 — Confirm the createCompany fix deployed — **CANNOT BE CLOSED THIS WAY**

`vercel ls` and `vercel inspect` were run, 2026-09-03. **No deployment of this project
carries any git metadata** — no commit sha, no branch, no author. Every one was made
with `npx vercel --prod`, which uploads the working DIRECTORY, so a deployment is not a
commit and there is nothing to match `4e73213` against. The production alias points at
`dpl_BWun8QWezXMo2ucNxGsyG3z2UrpQ`, created 2026-09-02T20:13:43Z.

The consequence is bigger than this item and belongs on the record: **what is running in
production is not identifiable from git.** A CLI deploy from a dirty tree ships
uncommitted work, and a commit that is never deployed ships nothing; both have happened
here in the last two days. The 09-02 deploy may well contain Phase 0's uncommitted
fixes, and no evidence available now can say.

So A3 stays open as stated and cannot be closed by looking. What DOES stand on its own,
without knowing the deploy time, is the outcome: zero `createCompany` 400s since
2026-08-28T00:19Z, and companies 822 and 823 created successfully. §3.3 is fixed
whichever deployment carried it.

**Worth fixing properly:** connect the Vercel git integration, or deploy only from a
clean tree and record the sha. Until then no claim of the form "production has X" is
verifiable.

### The original instructions

§3.3 is called fixed on measured evidence: zero `createCompany` failures since
2026-08-28T00:19Z, and companies 822 and 823 created successfully after commit
`4e73213`. What is inferred rather than checked is that the commit reached production
before those creations.

```bash
npx vercel ls        # find the deployment carrying 4e73213 and read its timestamp
```

It must be earlier than `2026-08-28T23:02:15Z`. Two minutes' work, and it closes A3 in
`ASSUMPTIONS.md`.

---

## H4 — Six stale Gmail drafts in the bookings mailbox

Left by `scripts/install-reply-draft-workflow.mjs --test*` runs on 2026-08-24. There is
no API access to delete a draft, so they need binning by hand:

```
r-8614937724169100663   r-6400668473869502374   r-5670202254866566339
r-3323390275933262223   r-3842904857179492212   (+1 from the first --test-internal run)
```

Harmless — drafts are not sends and nothing in this system can send — but they
accumulate and they look like real pending replies to anyone working the mailbox.

---

## H5 — B2, the staffed-shrink question (carried over) — **Ben, in the OnSinch UI**

`scripts/verify-shrink-staffed.ts` needs an order raised **by hand in the OnSinch UI** on
TEST company 515 ("TEST - Eventz"), with crew signed on to at least two blocks of
different sizes. The engine's own orders cannot serve: their blocks are not addressable,
which is the whole point of H2.

The question it answers: what does `PATCH /slotTeams` do to a block that already has
people on it? The engine currently refuses to shrink a staffed block, and that refusal
is a guess, not a measurement.

**Do not claim this complete until the test has actually been run.** Preconditions,
input, expected calls, expected OnSinch result, expected internal state and cleanup all
belong here once the shape of the test is agreed.

---

## H6 — Ratify or overturn the `TBC` placeholder decision — **Ben**

`DECISIONS.md` D1. The shipped code writes `address/city/zip = "TBC"` and falls
`email_invoice` back to `bookings@spartancrew.co.uk` for a brand-new client, which the
remediation charter forbids and which is the only reason new clients can be booked at
all. Recommendation is to keep it and add a review-queue entry once one exists.

**Blocked until answered:** whether `createCompany`'s defaults stay in the code.

---

## H7 — Five threads are stranded on an order that was re-keyed — **Ben or ops**

These sit at `needs-info` with "crew/time change NOT applied — order #N no longer exists
in OnSinch". The client's change never reached OnSinch, so each needs a person.

Three of them have a live order that is almost certainly the same job, re-keyed by hand
(same client, same day, adjacent id and R number) — found 2026-09-03 by
`node scripts/approval-forensics.mjs --survive`:

| thread | our dead order | the live order to work on |
|---|---|---|
| `1a0481a801dde268` | #15588 / R10738 | **#15590 / R10740**, raised by user 413 |
| `1a0477e1e0de5ac4` | #15578 / R10730 | **#15585 / R10735**, raised by user 413 |
| `1a01e5fb812611a1` | #13783 / R10653 | **#13784 / R10654**, raised by user 2620 |
| `1a043daff1110f26` | #15591 / R10741 | none found that day — genuinely gone |
| `1a057789646e6272` | #15700 / R10758 | none found that day — genuinely gone |

Apply the client's change to the live order by hand, then clear the thread. The engine
now names the replacement in its own refusal note, so the next occurrence will not need
this table — but it still refuses to write, which is `DECISIONS.md` D6.
