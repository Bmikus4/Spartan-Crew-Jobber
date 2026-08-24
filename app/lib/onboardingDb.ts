// Who has accepted the terms, and who has finished setting their account up.
//
// TWO TABLES BECAUSE THERE ARE TWO DIFFERENT PROMISES. Accepting the terms is an
// ORGANISATION-level act done once, by whoever from that organisation signs in first;
// account setup is a PERSONAL act every single user does. Collapsing them into one row
// per user would re-ask a company to agree to terms it has already agreed to every time
// a colleague joins — and would leave no record of who actually agreed on the company's
// behalf, which is the one fact worth keeping.
//
// Follows the shape of every other Neon module here (settingsDb, jobsDb, metricsDb):
// lazy connection, CREATE TABLE IF NOT EXISTS on first use, and NOTHING THROWS OUTWARD.
// Onboarding must not be able to lock a person out of the tool because a database
// blinked — a person asked again tomorrow has lost nothing; a person who cannot reach
// the board has lost the day.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { TERMS_VERSION } from "./orgProfile";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

// THE SAME THREE NAMES, IN THE SAME ORDER, AS EVERY OTHER NEON MODULE HERE. A name
// added to one module and not the others is how a store comes to be silently absent in
// production while every local test passes.
function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}
function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

export function onboardingEnabled(): boolean {
  return !!connString();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  // org_key is the email DOMAIN — see orgProfile.ts for why that is the only
  // organisation identity this app has.
  await sql`
    CREATE TABLE IF NOT EXISTS org_terms_acceptance (
      org_key TEXT NOT NULL,
      terms_version TEXT NOT NULL,
      accepted_by TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (org_key, terms_version)
    )`;
  // The PRIMARY KEY carries the version, so bumping TERMS_VERSION re-prompts an
  // organisation instead of treating an old signature as covering new terms. That is
  // the whole reason the version is in the key.
  await sql`
    CREATE TABLE IF NOT EXISTS user_onboarding (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      contact_email TEXT,
      organisation TEXT NOT NULL,
      org_key TEXT NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  _ready = true;
}

export interface OnboardingState {
  /** The organisation has agreed to the CURRENT terms version. */
  orgAccepted: boolean;
  /** This person has finished their own account setup. */
  userDone: boolean;
  /** Their saved display name, when they have one. */
  displayName: string | null;
  /** Their contact address, when they have corrected it. */
  contactEmail: string | null;
  /**
   * The organisation on their SAVED row, which is not always the one their domain implies:
   * a personal mailbox types its own, and that typed answer is the only record of it.
   */
  organisation: string | null;
  /** Arrival order within their organisation — 0 for the first person. Their colour. */
  colourIndex: number;
  /** False when there is no database — the caller must then let people through. */
  available: boolean;
}

export async function readState(email: string, key: string): Promise<OnboardingState> {
  const miss: OnboardingState = {
    orgAccepted: false, userDone: false, displayName: null, contactEmail: null,
    organisation: null, colourIndex: 0, available: false,
  };
  const sql = db();
  if (!sql) return miss;
  try {
    await ensure(sql);
    const [org, user] = await Promise.all([
      sql`SELECT 1 FROM org_terms_acceptance WHERE org_key = ${key} AND terms_version = ${TERMS_VERSION} LIMIT 1`,
      // The colour index comes out of the same row_number() as orgMembers uses, so the
      // rail and the profile card cannot disagree about a person's colour. Two queries
      // computing it two ways is the one bug worth a window function to make impossible.
      sql`
        WITH ranked AS (
          SELECT email, display_name, contact_email, organisation,
                 row_number() OVER (ORDER BY completed_at, email) - 1 AS colour_index
          FROM user_onboarding WHERE org_key = ${key}
        )
        SELECT display_name, contact_email, organisation, colour_index FROM ranked WHERE email = ${email} LIMIT 1`,
    ]);
    return {
      orgAccepted: org.length > 0,
      userDone: user.length > 0,
      displayName: (user[0]?.display_name as string) ?? null,
      contactEmail: (user[0]?.contact_email as string) ?? null,
      organisation: (user[0]?.organisation as string) ?? null,
      colourIndex: Number(user[0]?.colour_index ?? 0),
      available: true,
    };
  } catch {
    // A read failure must not gate the app. Reporting "not available" makes the caller
    // skip onboarding rather than trap somebody in a form that cannot save.
    return miss;
  }
}

/** One colleague, as the directory endpoint returns them. */
export interface OrgMemberRow {
  email: string;
  displayName: string;
  contactEmail: string;
  organisation: string;
  colourIndex: number;
}

/**
 * Everyone who shares an organisation, in the order they arrived.
 *
 * THE ORDER IS THE COLOUR. The tie-break on email matters: two people onboarded inside
 * the same clock tick would otherwise swap colours between requests, and a disc that
 * changes colour on refresh reads as a rendering bug.
 */
export async function orgMembers(key: string): Promise<OrgMemberRow[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    const rows = await sql`
      SELECT email, display_name, contact_email, organisation,
             row_number() OVER (ORDER BY completed_at, email) - 1 AS colour_index
      FROM user_onboarding
      WHERE org_key = ${key}
      ORDER BY completed_at, email`;
    return rows.map((r) => ({
      email: String(r.email),
      displayName: String(r.display_name || ""),
      contactEmail: String(r.contact_email || r.email),
      organisation: String(r.organisation || ""),
      colourIndex: Number(r.colour_index ?? 0),
    }));
  } catch {
    return [];
  }
}

/** Record the organisation's acceptance. Idempotent: first writer wins, later ones no-op. */
export async function acceptTerms(key: string, email: string): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO org_terms_acceptance (org_key, terms_version, accepted_by)
      VALUES (${key}, ${TERMS_VERSION}, ${email})
      ON CONFLICT (org_key, terms_version) DO NOTHING`;
    return true;
  } catch {
    return false;
  }
}

/** Record one person's completed setup. Re-running overwrites the name, by design. */
export async function completeUser(
  email: string,
  displayName: string,
  contactEmail: string,
  organisation: string,
  key: string,
): Promise<boolean> {
  const sql = db();
  if (!sql) return false;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO user_onboarding (email, display_name, contact_email, organisation, org_key)
      VALUES (${email}, ${displayName}, ${contactEmail}, ${organisation}, ${key})
      ON CONFLICT (email) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        contact_email = EXCLUDED.contact_email,
        organisation = EXCLUDED.organisation`;
    return true;
  } catch {
    return false;
  }
}
