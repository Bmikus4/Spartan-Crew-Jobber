// Who a signed-in address belongs to, and what they should be called.
//
// THE ORGANISATION IS THE EMAIL DOMAIN, because that is the only organisation identity
// this app actually has. There is no tenant table and no company picker: everyone who
// reaches the dashboard got here through an allowlist keyed on their domain
// (authAllowlist.ts), so the domain is both the fact and the key.

/** Bumping this RE-ASKS every organisation to accept. See org_terms_acceptance's key. */
export const TERMS_VERSION = "2026-08-24";

const ORGANISATIONS: Record<string, string> = {
  "spartancrew.co.uk": "Spartan Crew",
  "samuraisolutions.co.uk": "SamurAI Solutions",
};

/** The domain, lowercased. The key everything organisation-shaped is filed under. */
export function orgKey(email: string): string {
  return (email || "").trim().toLowerCase().split("@")[1] || "";
}

/**
 * The company this address belongs to, or "" for a personal mailbox.
 *
 * "" IS A MEANINGFUL ANSWER and must stay one. Ben's own benjamintmikus@gmail.com and
 * Parth's personal address are on the allowlist in code, and asserting a company for
 * either of them would print something wrong on their profile forever. The onboarding
 * card ASKS when this returns nothing.
 */
export function organisationFor(email: string): string {
  return ORGANISATIONS[orgKey(email)] || "";
}

/**
 * A name read out of the address, or "" when the address does not contain one.
 *
 * IT REFUSES TO INVENT. `bookings@`, `info@` and `admin@` spell out no person, and a
 * profile card reading "Bookings" is worse than an empty box the person fills in — the
 * empty box gets corrected, the plausible wrong name never does.
 */
export function suggestedName(email: string): string {
  const local = (email || "").trim().toLowerCase().split("@")[0] || "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  const GENERIC = new Set(["bookings", "booking", "info", "admin", "accounts", "hello", "office", "team", "sales", "enquiries", "enquiry", "ops", "support", "mail", "contact", "crew", "jobs", "noreply", "no"]);
  // Trailing digits are stripped before the test: crew2@ and bookings1@ are the same
  // kind of mailbox as crew@ and bookings@, and a name of "Crew2" is exactly the
  // plausible-looking wrong answer this function exists to refuse.
  const generic = (t: string) => GENERIC.has(t.replace(/\d+$/, "")) || /^\d+$/.test(t);
  if (!parts.length || parts.every(generic)) return "";
  // A single token is a first name and that is fine; two are first and last. Anything
  // longer is an address doing something else and is left alone.
  if (parts.length > 3) return "";
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
