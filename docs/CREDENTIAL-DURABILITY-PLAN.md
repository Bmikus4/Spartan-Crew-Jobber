# Intake that survives its own credential

**Written 2026-09-15.** Ben, mid-session: intake will be rebuilt on the Kairo intake module,
which uses Google OAuth, *"so if we scope it properly so it sits above any credential
changes, that is the goal overall."*

This is that design. The short version: **OAuth cannot be made immune to credential
changes — that is documented, with no exemption — so durability has to come from the
INTAKE SHAPE, not the token.** Everything below is evidence first.

---

## 1. What actually happens

**Measured, 2026-09-15.** Of 546 threads addressed to `bookings@spartancrew.co.uk` since
2026-08-04, 71 never reached the engine. **69 of the 71 arrived on five days:**

| | threads | missed | recall |
| --- | --- | --- | --- |
| a normal day | 421 | 2 | **99.5%** |
| 2026-08-26, 08-27, 09-09, 09-10, 09-11 | 125 | 69 | **44.8%** |

The two misses on a normal day are a job application and a thread whose first client
message predates the window. **Intake does not leak. It goes to zero, twice.** Each
occasion cost roughly a day and a half of bookings, which were then audited and re-entered
by hand.

**The failure, in n8n's own words** (execution 353785, 2026-09-11):

```
The credential "Spartan Crew 8/27/26" needs to be reconnected.
```

That is `invalid_grant`: the OAuth **refresh token** stopped working. Not a quota, not a
scope, not a rate limit. The 2026-08-26 pair was the same shape — intake failed every five
minutes for 42 hours with nobody watching, which is the outage the watchdog was built after.

## 2. Why it keeps happening

Google states the rule plainly
([OAuth 2.0 for Google APIs](https://developers.google.com/identity/protocols/oauth2),
"Refresh token expiration"). A refresh token stops working when, among other things:

> - The user has revoked your app's access.
> - The refresh token has not been used for six months.
> - **The user changed passwords and the refresh token contains Gmail scopes.**
> - The user account has exceeded a maximum number of granted (live) refresh tokens.
> - If an admin set any of the services requested in your app's scopes to Restricted.

And separately:

> A Google Cloud Platform project with an OAuth consent screen configured for an
> **external** user type and a publishing status of **"Testing"** is issued a refresh token
> **expiring in 7 days**.

Two clocks, and both apply today.

**The password rule is the one that matters, and there is no way around it.** It is specific
to Gmail scopes, which is why the mailbox integration dies while nothing else on the account
notices — rotating the `bookings@` password is ordinary hygiene and it silently breaks
intake. The list carries **no exemption for Internal apps, for Workspace domains, or for
admin-trusted clients**; it was checked for one. So no OAuth configuration, however well
scoped, makes the token immortal.

**It is a Workspace policy with no admin override**, set out in
[Automatic OAuth 2.0 token revocation upon password change](https://support.google.com/a/answer/6328616):
tokens issued for access to certain products are revoked automatically when a user changes
their password, and third-party mail apps "and other applications that use mail scopes to
access a user's mail" stop syncing until a new token is granted. The exceptions it lists are
narrow and none of them is ours — Apps Script projects, Android account sync where the
password change originated on that same device, and OAuth-authenticated Gmail IMAP sessions
(which survive only for the access token's ~1 hour anyway). The admin FAQ answers whether
re-setting an identical password counts (no, via Directory API with the same hash and salt)
and whether Less Secure Apps affects it (it does not). **There is no setting that turns it
off.**

**This is a narrow exception to a correct general rule.** OAuth is right, and it is right for
exactly the reason it is usually given: refresh tokens renew access without anyone
re-entering a password, which app passwords and static IMAP credentials cannot do. That
holds for every Google scope except this one case — mail scopes plus a password change — and
this one case is the one Spartan lives in.

**Therefore "sits above any credential changes" cannot mean the token never dies.** It has
to mean the engine does not LOSE anything when it does.

### What is NOT established, and how to settle it in two minutes

The *mechanism* above is documented and certain. That a password change caused **these two
outages** is inferred, not proved, and the inference should not be repeated as fact. Other
entries on Google's list fit the evidence too — in particular **"the user account has
exceeded a maximum number of granted (live) refresh tokens"** (the limit is 100, and older
tokens then become invalid), which is a live risk here: this n8n instance holds eleven
`gmailOAuth2` credentials and each reconnect mints another token for the same client and
user. The credential named "Spartan Crew 8/27/26" was created the day after the August
outage and died around 09-09 — roughly 13 days, which rules out the 7-day Testing clock but
does not choose between the remaining causes.

**Google Admin console → Reporting → Audit and investigation → Login audit log** records
password changes, and the Token audit log records grants and revocations for a client id.
Ten minutes there names the cause outright, and it is worth doing before building anything,
because "too many live refresh tokens" is fixed by pruning credentials rather than by any of
this.

## 3. The design: make completeness independent of uptime

Today intake is a **stream**, and that is the actual defect. Gmail labels a message "New",
the poll takes it, and the poll strips the label. Miss the window and the evidence that the
message was ever new is gone — which is exactly how 69 threads became a hand audit. The
credential outage was the trigger; the stream was the reason it was unrecoverable.

**Replace the label with a cursor.** The new intake records where it got to and, on every
run, asks Gmail for everything since. A run that did not happen is simply a bigger next run.

- **Normal operation:** `users.history.list` with the stored `startHistoryId` — Gmail's own
  incremental feed, cheap and exact.
- **After a gap:** Gmail keeps only about a week of history, so a stale or rejected
  `historyId` falls back to `users.messages.list?q=after:<epoch of last ingest>`. The corpus
  sweep already proves this path works against this mailbox — it pulled 6 weeks in 7 windows
  today.
- **The cursor advances only on a confirmed store.** Never on "the request returned"; on the
  row landing in `inbound_raw`. A crash mid-batch re-reads, and re-reading is free because
  ingest is already idempotent on `dedup_key`.

With that, a dead credential costs **latency, not bookings**. Reconnect and the backlog
drains by itself, with no human deciding what was missed.

This is worth building even if the credential never breaks again, because it caps the cost
of *every* future failure — a Vercel outage, an n8n outage, a bad deploy — not just this one.

### Labels stay, but stop being the ledger

The four labels (`Order Built`, `Order Updated`, `Order Needs Built`, `Order Needs Updated`)
are a product feature and keep working. What changes is that nothing depends on a label to
know whether a message has been seen. That is what `inbound_raw` and `message_ledger` are
for, and they already exist.

## 3b. The version with no credential in it at all: receive the mail, do not fetch it

Everything above still asks Gmail for mail, so everything above still has a token in the
path that matters. There is a way to take the token out of it entirely, and for a
multi-tenant product it is cheaper than the OAuth it replaces.

**A Google Workspace admin routing rule delivers a copy of inbound mail to an address you
control.** Admin console → Apps → Google Workspace → Gmail → **Routing**, matching envelope
recipient `bookings@spartancrew.co.uk`, action "add more recipients". Point it at an address
handled by an inbound-mail webhook (Cloudflare Email Routing, Postmark inbound, SendGrid
Inbound Parse, Mailgun routes), which POSTs the raw message to an endpoint on this app.

What that buys, and it is the whole ask:

- **There is no OAuth token in the intake path.** Nothing to expire, revoke, reconnect or
  re-consent. A password change is irrelevant. So is the 100-refresh-token ceiling, the
  7-day Testing clock and the restricted-scope review.
- **It is an admin-level rule, not a user grant.** It survives the mailbox owner changing
  their password, losing their phone, or leaving the company.
- **For Kairo's multi-tenancy it is dramatically cheaper.** A tenant's admin adds one routing
  rule. No Google verification, no CASA security assessment, no annual renewal — none of
  which is avoidable if a multi-tenant app asks for restricted Gmail scopes.
- **Latency drops from a 3-minute poll to seconds.**

What it does not do, stated plainly:

- **It delivers messages, not threads.** Threading is reconstructed from `Message-ID`,
  `In-Reply-To` and `References`, which every real client sets. The engine already keys on a
  thread identity and stores messages individually, so this is a mapping change rather than a
  redesign — but it is the one piece of real work in the option.
- **It cannot WRITE to Gmail.** The four labels and the reply drafts still need an OAuth
  token, because there is no inbound path that writes.

That split is the point rather than a compromise. **Reading is the half that must never
fail; writing a label is cosmetic.** Put intake on routing, where nothing can revoke it, and
leave the labels on OAuth, where a dead token degrades a nicety and heals itself on the next
reconnect. Today the two are fused, which is why a credential event costs bookings.

### So the architecture that actually sits above credential changes

| leg | auth | what a credential failure costs |
| --- | --- | --- |
| inbound mail | **none** — admin routing rule → webhook | nothing; there is no credential |
| reconciliation / backfill | OAuth, cursor-based (§3) | latency: the next run is bigger |
| labels and drafts | OAuth, `gmail.modify` | a label is late; no booking is lost |

Each leg fails independently and none of them loses mail. That is the property Ben asked
for, and no amount of scoping a single OAuth grant produces it.

## 4. Scoping the OAuth so re-consent is rare and cheap

The token will still die occasionally. Make that rare, obvious, and a ten-second fix.

- **Consent screen: Internal**, if this intake serves Spartan only. Spartan is on Google
  Workspace — `spartancrew.co.uk` resolves to `aspmx.l.google.com` — so Internal is
  available. It removes the 7-day Testing clock entirely, needs no verification review, and
  shows no "unverified app" warning.
- **THE FORK BEN NEEDS TO DECIDE BEFORE BUILDING, because it is expensive to get wrong:**
  Internal is **one Workspace domain**. If the Kairo intake module is multi-tenant — other
  clients' mailboxes on their own domains — it must be **External and Published**, and Gmail
  scopes are *restricted*, which means Google's verification plus a **CASA security
  assessment**, renewed annually, at real cost and real lead time. Single-tenant is free and
  instant; multi-tenant is a procurement exercise. Decide the tenancy first and the OAuth
  configuration follows.
- **One scope:** `https://www.googleapis.com/auth/gmail.modify`. It covers reading messages
  and threads, adding and removing the four labels, and creating drafts. **Never
  `https://mail.google.com/`** — full access including permanent delete, and nothing needs
  it. **Never `gmail.send`** — the engine creates drafts and a human sends them; keeping that
  boundary in the credential as well as the code is worth the line.
- **`access_type=offline` with `prompt=consent` on the initial grant**, or Google may return
  no refresh token at all on a re-authorisation and the failure looks like a bug in the app.
- **Admin-trust the client ID** in Admin console → Security → Access and data control → API
  controls → App access control. Restricted scopes are otherwise subject to an admin policy
  that can block them, which appears as `admin_policy_enforced` and reads like a code fault.
- **The token lives with the app, not in n8n.** That is the real gain from the Kairo module:
  reconnect becomes a button in a UI Ben controls, instead of finding the right credential in
  n8n. It also lets the app see `invalid_grant` the moment it happens and say so, rather than
  the failure being buried in execution bodies nobody reads.

### The one configuration that IS immune, recorded as the road not taken

A **service account with domain-wide delegation** has no password and no refresh token — it
signs a JWT per call — so nothing about password rotation touches it. It was the original
recommendation here and Ben has chosen OAuth for good reasons: the Kairo module needs OAuth
anyway, and OAuth is what a multi-tenant product can actually ship.

Two things make it the weaker option regardless. Google
[discourages domain-wide delegation](https://cloud.google.com/iam/docs/best-practices-service-accounts#domain-wide-delegation)
because the service account can impersonate anyone in the domain, super-admins included. And
n8n marks Gmail ⚠️ for service accounts: *"Google technically supports Service Accounts for
use with Gmail, but it requires enabling domain-wide delegation, which Google discourages,
and its behavior can be inconsistent. n8n recommends using OAuth2 with the Gmail node."*

Worth keeping in mind only if a Spartan-only, never-multi-tenant intake is ever wanted and
the cursor design somehow does not settle it. It should.

## 5. Detection, which is the remaining half

The 09-09 outage ran for two days because nothing told anyone. Three things already exist and
are nearly enough:

- `/api/health/intake` checks `lastInboundAt()` and files its own error report — this is the
  alarm that DID fire on 2026-09-10.
- The intake watchdog covers the case the app cannot report: the endpoint not answering.
- `scripts/health.ts` scans every workflow for the dead credential id by hand, because n8n
  reports a revoked grant per EXECUTION and never on the credential — a workflow not
  triggered since the revocation looks perfectly healthy.

What is missing is that `health.ts` runs only when somebody types it. The reconciliation
sweep got a nightly n8n schedule today; the same mechanism should carry a nightly health run,
and the new intake should expose token state so the check is a fact rather than an inference.

## 6. What this does not fix

The 44.8% recall during an outage is an availability number and says nothing about how well
the engine reads email. Venue resolution, the stale-year rule and the
classification-contradicts-the-facts case are untouched by any of this, and they are the
larger body of work.
