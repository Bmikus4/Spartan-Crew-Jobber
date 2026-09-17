export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// THE PROJECT PULLS ITS OWN MAIL.
// ----------------------------------------------------------------------------
// Until now something else fetched the mail and pushed it in: n8n held a Gmail OAuth
// credential, watched the mailbox, and POSTed threads to /api/n8n-inbound. That put the
// one leg that must never fail outside the codebase, behind a credential a password
// change revokes and a canvas nobody reviews.
//
// This route inverts it. A timer calls it, it asks Gmail what is new since a cursor it
// owns, and it runs the engine itself. n8n is no longer a mail client — and once the
// timers move to Vercel crons it is not needed at all.
//
// WHY THE ENGINE RUNS HERE RATHER THAN BEHIND ANOTHER HOP. /api/mail-inbound exists for
// mail PUSHED by a provider webhook and rebuilds the thread from RFC headers because a
// routing rule carries no thread id. We have Gmail's own `threadId`, which is
// authoritative — measured, header threading splits 1 thread in 40 — so binding to it is
// strictly better and there is nothing to gain from posting to ourselves over HTTP.
//
// SAFETY. Every message is stored BEFORE the engine sees it, the store dedupes on RFC
// Message-ID, and the cursor advances only over a batch that finished. Re-running this
// route is therefore free: the second pass finds everything already held and skips it.
// The INTAKE_PATH interlock still governs whether the engine runs at all, so this can be
// left polling in shadow — storing and threading, writing nothing to OnSinch — until it
// is deliberately handed the engine.
//
// ----------------------------------------------------------------------------
// DORMANT, 2026-09-17. NOT DEAD — BLOCKED ON ONE ADMIN GRANT.
// ----------------------------------------------------------------------------
// This whole path is built, tested and deployed, and it does nothing, because the
// credential it needs cannot be created yet: domain-wide delegation must be granted by a
// super-admin INSIDE spartancrew.co.uk, and a personal @gmail.com account cannot
// administer that domain however much it owns the Cloud project. Until someone with a
// @spartancrew.co.uk super-admin does it, n8n remains the intake and nothing here runs.
//
// It is gated by ABSENCE rather than by a switch, which is why nothing had to be
// reverted: with GMAIL_SA_* unset, serviceAccountConfigured() is false, so this route
// answers {idle:true}, deps.ts posts labels and drafts to the n8n webhooks exactly as
// before, and gmailAuth falls back to the refresh token. There is no half-on state.
//
// TO TURN IT ON, in this order:
//   1. a @spartancrew.co.uk super-admin grants delegation for Client ID
//      104025308997865565766 at admin.google.com -> Security -> Access and data control
//      -> API controls -> Domain-wide delegation, with BOTH scopes in one entry,
//      comma-separated, matched character for character:
//        https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.modify
//   2. enable the Gmail API on the Cloud project (a separate click from the grant)
//   3. npm run verify:gmail:sa   — proves read, impersonation and a real label change
//   4. set GMAIL_SA_CLIENT_EMAIL, GMAIL_SA_PRIVATE_KEY, GMAIL_SUBJECT in Vercel
//   5. restore vercel.json, which was REMOVED so these would not fire against the n8n
//      workflows they duplicate — /api/health/intake is already driven by the Intake
//      Watchdog and /api/reconcile by the Reconciliation Sweep, and two of each is worse
//      than one:
//        { "$schema": "https://openapi.vercel.sh/vercel.json",
//          "crons": [ { "path": "/api/mail-poll",      "schedule": "*/2 * * * *"  },
//                     { "path": "/api/health/intake",  "schedule": "*/15 * * * *" },
//                     { "path": "/api/reconcile",      "schedule": "0 3 * * *"    } ] }
//      and set CRON_SECRET, without which every cron 401s — fail-closed, deliberately.
//   6. watch it in shadow, then INTAKE_PATH=routing to hand it the engine.
// ============================================================================

import { authorizeCronCall } from "../../lib/apiAuth";
import { parseRfc822 } from "../../lib/mail/rfc822";
import { gmailClient, getRawMessage } from "../../lib/mail/gmailClient";
import { fetchSince } from "../../lib/mail/gmailCursor";
import { readCursor, writeCursor, touchRun, unseenIds, markSeen } from "../../lib/mail/cursorDb";
import { BOOKINGS_MAILBOX, tokenSource } from "../../lib/mail/gmailAuth";
import { storeMessage, rebuildThread } from "../../lib/threadMessagesDb";
import { captureInboundRaw } from "../../lib/inboundRawDb";
import { coerceThread } from "../../lib/engine/intake";
import { handleThread } from "../../lib/engine/pipeline";
import { buildDeps } from "../../lib/deps";
import { upsertTicketFromState } from "../../lib/ticketsDb";
import { activeIntake, mayRunEngine } from "../../lib/intakePath";
import { reportError } from "../../lib/errorReport";

const SPARTAN = /@spartancrew\.co\.uk$/i;

/**
 * How many messages one tick will take.
 *
 * Bounded by the 60s function ceiling, not by politeness: each message is a Gmail read
 * plus, for a client message, a model call and possibly an OnSinch write. A backlog
 * drains a batch per tick because the seen-set records progress — see cursorDb.
 */
const BATCH = Math.max(1, Number(process.env.MAIL_POLL_BATCH || 20));

async function poll(): Promise<Response> {
  const mailbox = BOOKINGS_MAILBOX;
  const started = Date.now();

  /**
   * IDLE, NOT BROKEN, until the service account exists.
   *
   * The cron ships with the code; the credential is an admin action that happens later.
   * Between the two this route would otherwise throw every two minutes and file an error
   * report each time -- hundreds of identical alarms for a thing nobody has got to yet,
   * which is how real alarms stop being read. Silence here is wrong too, so it answers
   * plainly and says what is missing.
   */
  if (tokenSource() !== "service-account") {
    return Response.json({
      ok: true,
      idle: true,
      mailbox,
      credential: tokenSource(),
      note: "no service account configured: set GMAIL_SA_CLIENT_EMAIL and GMAIL_SA_PRIVATE_KEY (and GMAIL_SUBJECT) to start pulling. The n8n intake is unaffected.",
    });
  }

  try {
    const get = gmailClient();
    const cursor = await readCursor(mailbox);
    const found = await fetchSince({ gmail: get, cursor });

    // Already-handled ids are dropped BEFORE any Gmail read, so a re-run of a drained
    // backlog costs one history call rather than a hundred message fetches.
    const pending = await unseenIds(mailbox, found.messageIds);
    const batch = pending.slice(0, BATCH);
    const truncated = pending.length > batch.length;

    if (!found.messageIds.length) await touchRun(mailbox);

    const handled: string[] = [];
    const results: Array<{ id: string; thread: string; engine: string }> = [];

    for (const id of batch) {
      const msg = await getRawMessage(get, id);
      if (!msg) { handled.push(id); continue; }

      const mail = parseRfc822(msg.raw);
      // Gmail's own grouping, not a guess from headers. Prefixed so a thread from this
      // path can never collide with one minted by the webhook intake.
      const threadId = msg.threadId ? `gmail:${msg.threadId}` : `mail:${mail.message_id || id}`;
      const isFromSpartan = SPARTAN.test(mail.from);

      const stored = await storeMessage({
        message_id: mail.message_id || `gmail:${id}`,
        thread_id: threadId,
        from_address: mail.from,
        to_addresses: [...new Set([...mail.to, ...mail.cc])],
        date_iso: mail.date_iso,
        subject: mail.subject,
        body: mail.body || null,
        is_from_spartan: isFromSpartan,
      });
      await captureInboundRaw(
        { thread_id: threadId, message_id: mail.message_id, gmail_id: id, source: "gmail-poll" },
        "gmail-poll",
      );

      // Marked handled as soon as it is DURABLE, not once the engine agrees. A model
      // failure on one thread must not make the poller re-read it every minute forever.
      handled.push(id);

      if (!stored.inserted) { results.push({ id, thread: threadId, engine: "already held" }); continue; }
      // Our own replies are stored for continuity and never answered — the engine reads
      // the newest message, and the newest being ours would have it answer itself.
      if (isFromSpartan) { results.push({ id, thread: threadId, engine: "outbound" }); continue; }
      if (!mayRunEngine("routing")) { results.push({ id, thread: threadId, engine: `shadow (INTAKE_PATH=${activeIntake()})` }); continue; }

      try {
        const thread = await rebuildThread(threadId);
        const coerced = thread ? coerceThread(thread) : null;
        if (!coerced) { results.push({ id, thread: threadId, engine: "not coercible" }); continue; }
        const state = await handleThread(coerced, await buildDeps());
        await upsertTicketFromState(state);
        results.push({ id, thread: threadId, engine: `${state.classification}/${state.status}` });
      } catch (err) {
        // One bad thread does not stop the batch: the rest of the mailbox is still waiting.
        void reportError({
          route: "engine-threw", where: "api/mail-poll",
          what: String((err as Error)?.message ?? err),
          detail: `thread ${threadId} (gmail ${id})`,
        });
        results.push({ id, thread: threadId, engine: "failed" });
      }
    }

    await markSeen(mailbox, handled);
    // THE CURSOR MOVES LAST, and only over a batch that finished. Truncated means the
    // backlog is still draining, so it stays where it is and the next tick continues.
    if (!truncated) await writeCursor(mailbox, found.nextCursor, handled.length);

    return Response.json({
      ok: true,
      mailbox,
      credential: tokenSource(),
      cursor_in: cursor,
      cursor_out: truncated ? cursor : found.nextCursor,
      reanchored: found.reanchored,
      found: found.messageIds.length,
      pending: pending.length,
      processed: handled.length,
      truncated,
      intake_path: activeIntake(),
      ms: Date.now() - started,
      results,
    });
  } catch (err) {
    void reportError({
      route: "mail-pull-failed", where: "api/mail-poll",
      what: String((err as Error)?.message ?? err),
      detail: "the pull failed; nothing was lost, the cursor did not move",
    });
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}

/**
 * GET IS THE POLL, because a Vercel cron can only issue a GET.
 *
 * Putting the work on POST and a status page on GET reads better and would have meant
 * the cron fetched the status page every two minutes while no mail was ever collected —
 * a scheduler that runs perfectly and does nothing, which is the failure this whole
 * exercise is about. `?status=1` keeps the read-only view for a human.
 */
export async function GET(request: Request): Promise<Response> {
  if (!authorizeCronCall(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (new URL(request.url).searchParams.get("status")) {
    const { cursorStatus } = await import("../../lib/mail/cursorDb");
    return Response.json({
      ok: true,
      mailbox: BOOKINGS_MAILBOX,
      credential: tokenSource(),
      intake_path: activeIntake(),
      cursor: await cursorStatus(BOOKINGS_MAILBOX),
    });
  }
  return poll();
}

/** Kept so the poll can be triggered by hand with the machine secret. */
export async function POST(request: Request): Promise<Response> {
  if (!authorizeCronCall(request).ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return poll();
}
