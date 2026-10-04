// Internal-team email allowlist. Configure via env (unioned with the code
// baselines below):
//   AUTH_ALLOWED_EMAILS = comma-separated exact addresses
//   AUTH_ALLOWED_DOMAIN = comma-separated domains
// If NEITHER env is set the allowlist is open outside production (local and preview
// sign-in keep working) and CLOSED in production apart from the baselines below (SP-22):
// a production deploy that lost its env would otherwise let any Google account in.

function list(envVal: string | undefined): string[] {
  return (envVal || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
}

// ALWAYS allowed, in code, regardless of env — Ben's asks: Spartan Crew + SamurAI
// domains, plus Parth's and Ben's personal + the SamurAI official mailbox.
// Additive only; does NOT count toward allowlistConfigured() so it can't flip the
// open-until-configured fallback or lock anyone out.
const BASELINE_DOMAINS = ["spartancrew.co.uk", "samuraisolutions.co.uk"];
const BASELINE_EMAILS = [
  "parthmansukhani2000@gmail.com",       // Parth (personal)
  "benjamintmikus@gmail.com",            // Ben (personal)
  "samuraisolutionsofficial@gmail.com",  // SamurAI official
];

export function allowlistConfigured(): boolean {
  return list(process.env.AUTH_ALLOWED_EMAILS).length > 0 || list(process.env.AUTH_ALLOWED_DOMAIN).length > 0;
}

// True if this email may sign in.
export function isAllowedEmail(email?: string | null): boolean {
  const e = (email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return false;
  const domain = e.split("@")[1] || "";
  if (BASELINE_EMAILS.includes(e)) return true;
  if (BASELINE_DOMAINS.includes(domain)) return true;
  if (!allowlistConfigured()) return process.env.VERCEL_ENV !== "production";
  if (list(process.env.AUTH_ALLOWED_EMAILS).includes(e)) return true;
  return list(process.env.AUTH_ALLOWED_DOMAIN).includes(domain);
}
