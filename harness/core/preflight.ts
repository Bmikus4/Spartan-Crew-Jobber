// ============================================================================
// Isolation, proved before every run and enforced during it.
// ----------------------------------------------------------------------------
// 1. No production credential is in the environment: the database, OnSinch (API and staff
//    login), the bot's secrets, the webhook secret, Gmail. A harness that cannot reach
//    production cannot touch it, whatever a bug in the code under test tries.
// 2. The network is closed except for the hosts the mode needs (the model provider when
//    recording; nothing at all when replaying). Any other request throws.
// 3. The adapter's own check: its fakes are fakes.
// Any failure aborts the run before a single case starts.
// ============================================================================

export const PRODUCTION_SECRETS = [
  "DATABASE_URL", "POSTGRES_URL", "STORAGE_DATABASE_URL",
  "ONSINCH_API_KEY", "ONSINCH_UI_EMAIL", "ONSINCH_UI_PASSWORD",
  "BOT_SECRET", "BOT_SESSION_KEY", "N8N_WEBHOOK_SECRET", "N8N_API_KEY",
  "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GOOGLE_SERVICE_ACCOUNT_JSON",
];

export type PreflightResult = { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };

export function preflight(opts: { env: Record<string, string | undefined>; allowHosts: string[]; adapterChecks: { name: string; ok: boolean; detail: string }[] }): PreflightResult {
  const checks: PreflightResult["checks"] = [];
  const loaded = PRODUCTION_SECRETS.filter((k) => (opts.env[k] ?? "").trim());
  checks.push({ name: "no production credentials loaded", ok: loaded.length === 0, detail: loaded.length ? `present: ${loaded.join(", ")}` : `none of ${PRODUCTION_SECRETS.length} present` });
  checks.push({ name: "network closed except the model provider", ok: opts.allowHosts.every((h) => /(^|\.)openrouter\.ai$/.test(h)), detail: opts.allowHosts.length ? `allowed: ${opts.allowHosts.join(", ")}` : "no host allowed (replay)" });
  checks.push(...opts.adapterChecks);
  return { ok: checks.every((c) => c.ok), checks };
}

/** Replaces fetch for the whole process: a request to any host not allowed throws. */
export function closeNetwork(allowHosts: string[]): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!allowHosts.includes(url.hostname)) throw new Error(`harness isolation: refused a request to ${url.hostname}`);
    return real(input, init);
  }) as typeof fetch;
}
