// Onboarding state for the signed-in person: has their organisation accepted the terms,
// and have they set their own account up. Plus who they are, for the rail and the card.
//
// Authenticated by the normal session gate in middleware.ts — this route is NOT on the
// skip list, deliberately. Everything it touches is keyed to the caller's own email, which
// it reads FROM THE SESSION rather than the request body: a route that accepted "which
// user am I" as a parameter would let anyone record a terms acceptance in a colleague's
// name.

import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../lib/session";
import { orgKey, organisationFor, suggestedName, TERMS_VERSION } from "../../lib/orgProfile";
import { readState, acceptTerms, completeUser, onboardingEnabled } from "../../lib/onboardingDb";
import { handleFor } from "../../lib/userIdentity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function emailFromSession(): Promise<string> {
  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  return (session.email || "").trim().toLowerCase();
}

export async function GET(): Promise<Response> {
  const email = await emailFromSession();
  if (!email) return Response.json({ error: "not signed in" }, { status: 401 });

  const key = orgKey(email);
  const state = await readState(email, key);

  // WITHOUT A DATABASE, NOBODY IS ONBOARDED AND EVERYBODY IS LET STRAIGHT IN. The
  // alternative — treating "cannot read" as "not yet accepted" — puts a form in front of
  // the whole team that can never save, which turns a missing env var into a total outage
  // of the dashboard.
  const skip = !onboardingEnabled() || !state.available;
  const organisation = organisationFor(email);

  return Response.json({
    email,
    orgKey: key,
    // "" when this address belongs to no configured organisation — a personal mailbox,
    // which the allowlist does admit. The client then ASKS rather than asserting a company
    // that would be wrong on their profile forever.
    organisation,
    // TWO SOURCES, IN THIS ORDER: what they saved, then what the address spells out. The
    // second returns "" rather than guessing, so the box is empty for bookings@ and info@.
    suggestedName: state.displayName || suggestedName(email),
    termsVersion: TERMS_VERSION,
    needsTerms: skip ? false : !state.orgAccepted,
    needsProfile: skip ? false : !state.userDone,
    // Who they are, so the rail and the profile card do not need a second round trip.
    me: {
      email,
      contactEmail: state.contactEmail || email,
      displayName: state.displayName || "",
      organisation: state.organisation ?? organisation,
      handle: handleFor(email),
      colourIndex: state.colourIndex,
      isSelf: true,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const email = await emailFromSession();
  if (!email) return Response.json({ error: "not signed in" }, { status: 401 });

  const key = orgKey(email);
  const body = (await req.json().catch(() => ({}))) as {
    step?: string; displayName?: string; contactEmail?: string; organisation?: string;
  };

  if (body.step === "terms") {
    return Response.json({ ok: await acceptTerms(key, email) });
  }

  if (body.step === "profile") {
    const name = (body.displayName || "").trim().slice(0, 120);
    if (!name) return Response.json({ error: "a name is required" }, { status: 400 });
    // Their CONTACT address, which is theirs to correct — it is not the identity this row
    // is keyed on. `email` from the session stays the key, so editing this field can never
    // point a record at somebody else's account.
    const contact = (body.contactEmail || "").trim().slice(0, 200) || email;
    // A typed organisation is only trusted when the deployment could not supply one.
    // Letting somebody on a known domain rename their employer would relabel the company
    // for everybody who arrives after them.
    const typed = (body.organisation || "").trim().slice(0, 160);
    const org = organisationFor(email) || typed || "Independent";
    return Response.json({ ok: await completeUser(email, name, contact, org, key) });
  }

  return Response.json({ error: "unknown step" }, { status: 400 });
}
