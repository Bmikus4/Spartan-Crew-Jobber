# Handover — tasks only a person can do

Opened at Phase 0, 2026-09-02. Each item says who must do it, the exact steps, the
command or screen that verifies it, and what is blocked until it is done.

---

## H1 — Turn on authentication (findings §3.9) — **Ben, in a browser**

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

## H2b — Try the local build on C:, once, to close §3.9's build failure

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

## H3 — Confirm the createCompany fix actually deployed — **anyone with Vercel access**

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
