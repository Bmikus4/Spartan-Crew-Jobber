export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// THE PROJECT PULLS ITS OWN MAIL (addendum R14, F43).
// ----------------------------------------------------------------------------
// n8n's Gmail trigger posts each thread to /api/n8n-inbound, which puts the one leg that must
// never fail behind a credential a password change revokes and a canvas nobody reviews. This
// route asks Gmail what is new since a cursor it owns, stores each message under Gmail's own ids
// (the same ids n8n's intake stores: test/oneConversationOneThreadId.ts), and hands the client
// mail to the v2 engine (mail/pollIntake.ts settlePolled). INTAKE_PATH says which intake decides
// (intakePath.ts); a paused system stores and marks store-only.
//
// SAFETY. Every message is stored BEFORE the engine sees it, the store dedupes on the Gmail id
// and the RFC Message-ID, and the cursor advances only over a batch that finished. Re-running
// this route is therefore free: the second pass finds everything already held, and decides only
// what still has no decision.
//
// ----------------------------------------------------------------------------
// DORMANT UNTIL ONE ADMIN GRANT.
// ----------------------------------------------------------------------------
// Domain-wide delegation must be granted by a super-admin INSIDE spartancrew.co.uk. It is gated
// by ABSENCE: with GMAIL_SA_* unset, tokenSource() is not "service-account", so this route answers
// {idle:true} and does nothing else. There is no half-on state.
//
// TO TURN IT ON, in this order:
//   1. a @spartancrew.co.uk super-admin grants delegation for Client ID
//      104025308997865565766 at admin.google.com -> Security -> Access and data control
//      -> API controls -> Domain-wide delegation, with BOTH scopes in one entry,
//      comma-separated, matched character for character:
//        https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.modify
//   2. enable the Gmail API on the Cloud project (a separate click from the grant)
//   3. npm run verify:gmail:sa   — proves read, impersonation and a real label change
//   4. set GMAIL_SA_CLIENT_EMAIL, GMAIL_SA_PRIVATE_KEY, GMAIL_SUBJECT in Vercel (CRON_SECRET too,
//      without which every Vercel cron 401s)
//   5. add { "path": "/api/mail-poll", "schedule": "*/2 * * * *" } to vercel.json's crons: a timer
//      lives in the app, never in n8n
//   6. INTAKE_PATH=routing in the same deploy, then turn off n8n's Gmail trigger. A long shadow
//      (step 5 without 6) sends n8n's deliveries to the undecided sweep, behind a card, because
//      the poll stored their messages first (pollIntake.ts).
// ============================================================================

import { authorizeCronCall } from "../../lib/apiAuth";
import { parseRfc822 } from "../../lib/mail/rfc822";
import { gmailClient, getRawMessage } from "../../lib/mail/gmailClient";
import { fetchSince } from "../../lib/mail/gmailCursor";
import { readCursor, writeCursor, touchRun, unseenIds, markSeen } from "../../lib/mail/cursorDb";
import { BOOKINGS_MAILBOX, tokenSource } from "../../lib/mail/gmailAuth";
import { storeMessage, rowFromGmail } from "../../lib/threadMessagesDb";
import { captureInboundRaw } from "../../lib/inboundRawDb";
import { activeIntake } from "../../lib/intakePath";
import { settlePolled, type Polled } from "../../lib/mail/pollIntake";
import { reportError } from "../../lib/errorReport";

/**
 * How many messages one tick will take.
 *
 * Bounded by the function ceiling, not by politeness: each message is a Gmail read
 * plus, for a client message, a model call and possibly an OnSinch write. A backlog
 * drains a batch per tick because the seen-set records progress — see cursorDb.
 */
const BATCH = Math.max(1, Number(process.env.MAIL_POLL_BATCH || 20));
/** Decisions stop here, 60 s inside maxDuration; a thread not reached is the undecided sweep's. */
const DECIDE_FOR_MS = 240_000;

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
    const polled: Polled[] = [];

    for (const id of batch) {
      const msg = await getRawMessage(get, id);
      if (!msg) { handled.push(id); continue; }

      const mail = parseRfc822(msg.raw);
      // Gmail's own grouping, not a guess from headers, keyed as n8n keyed it so an
      // existing conversation keeps its state. A draft of ours is refused by storeMessage.
      const row = rowFromGmail(id, msg.threadId, mail, msg.labelIds);
      const threadId = row.thread_id;
      const isFromSpartan = row.is_from_spartan;

      const stored = await storeMessage(row);
      await captureInboundRaw(
        { thread_id: threadId, message_id: mail.message_id, gmail_id: id, source: "gmail-poll" },
        "gmail-poll",
      );

      // Marked handled as soon as it is DURABLE, not once the engine agrees. A model
      // failure on one thread must not make the poller re-read it every minute forever.
      handled.push(id);

      // Our own replies are stored for continuity and never answered — the engine reads
      // the newest message, and the newest being ours would have it answer itself.
      if (isFromSpartan) { results.push({ id, thread: threadId, engine: "outbound" }); continue; }
      // Held already (n8n's intake stored it first) still goes on: settlePolled decides it if nothing has.
      polled.push({ message_id: row.message_id, thread_id: threadId, inserted: stored.inserted });
    }

    await markSeen(mailbox, handled);
    // THE CURSOR MOVES before the decisions, and only over a batch that finished: what is stored is
    // safe, and a decision this tick does not reach is the undecided sweep's. Truncated means the
    // backlog is still draining, so it stays where it is and the next tick continues.
    if (!truncated) await writeCursor(mailbox, found.nextCursor, handled.length);
    const decided = await settlePolled(polled, undefined, { deadline: started + DECIDE_FOR_MS });

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
      decided,
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
