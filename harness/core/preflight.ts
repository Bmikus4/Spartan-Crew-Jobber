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

/**
 * ANY NAME SHAPED LIKE A CREDENTIAL, not only the list above: audit/isolation-report.md (10-25) planted 15
 * names the app reads that the list missed (STORAGE_POSTGRES_URL, the Gmail service account, the webhook
 * URLs, ...) and replay started with all of them. A list goes stale as the app grows; a shape does not.
 */
const CREDENTIAL_SHAPE = /(SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|_KEY$|DATABASE|POSTGRES|WEBHOOK|CREDENTIAL|SERVICE_ACCOUNT|COOKIE|ONSINCH|GMAIL|N8N_)/i;
/** The agent runner's own channel, never a Spartan credential. */
const NOT_SPARTAN = /^CLAUDE_CODE_/;

export type PreflightResult = { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };

export function preflight(opts: { env: Record<string, string | undefined>; allowHosts: string[]; adapterChecks: { name: string; ok: boolean; detail: string }[] }): PreflightResult {
  const checks: PreflightResult["checks"] = [];
  // The model key is the one credential record mode needs, and only while its host is open.
  const modelKeyAllowed = opts.allowHosts.some((h) => /(^|\.)openrouter\.ai$/.test(h));
  const shaped = Object.keys(opts.env).filter((k) => (opts.env[k] ?? "").trim() && CREDENTIAL_SHAPE.test(k) && !NOT_SPARTAN.test(k) && !(modelKeyAllowed && k === "OPENROUTER_API_KEY"));
  const loaded = [...new Set([...PRODUCTION_SECRETS.filter((k) => (opts.env[k] ?? "").trim()), ...shaped])];
  checks.push({ name: "no production credentials loaded", ok: loaded.length === 0, detail: loaded.length ? `present: ${loaded.join(", ")}` : `none of ${PRODUCTION_SECRETS.length} present` });
  checks.push({ name: "network closed except the model provider", ok: opts.allowHosts.every((h) => /(^|\.)openrouter\.ai$/.test(h)), detail: opts.allowHosts.length ? `allowed: ${opts.allowHosts.join(", ")}` : "no host allowed (replay)" });
  checks.push(...opts.adapterChecks);
  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * Closes the network for the whole process: a request to any host not allowed throws. fetch, and since
 * 10-25 http/https, raw sockets and child processes too (audit/isolation-report.md G3: the lock covered
 * fetch alone, while the bot's browser runs as a child process).
 */
export function closeNetwork(allowHosts: string[]): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!allowHosts.includes(url.hostname)) throw new Error(`harness isolation: refused a request to ${url.hostname}`);
    return real(input, init);
  }) as typeof fetch;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const refuse = (what: string) => () => { throw new Error(`harness isolation: refused ${what}`); };
  const hostOf = (a: any) => (typeof a === "string" ? new URL(a).hostname : a instanceof URL ? a.hostname : a?.hostname ?? a?.host ?? "");
  for (const name of ["http", "https"]) {
    const mod = require(`node:${name}`);
    for (const fn of ["request", "get"]) {
      const orig = mod[fn];
      mod[fn] = (...args: any[]) => { if (!allowHosts.includes(String(hostOf(args[0])).replace(/:\d+$/, ""))) throw new Error(`harness isolation: refused ${name}.${fn} to ${hostOf(args[0])}`); return orig.apply(mod, args); };
    }
  }
  const net = require("node:net"), tls = require("node:tls");
  for (const [mod, fns] of [[net, ["connect", "createConnection"]], [tls, ["connect"]]] as const) {
    for (const fn of fns) {
      const orig = (mod as any)[fn];
      (mod as any)[fn] = (...args: any[]) => { const h = String(typeof args[0] === "object" ? args[0]?.host ?? args[0]?.servername ?? "" : args[1] ?? ""); if (!allowHosts.includes(h)) throw new Error(`harness isolation: refused a socket to ${h || "an unnamed host"}`); return orig.apply(mod, args); };
    }
  }
  const cp = require("node:child_process");
  for (const fn of ["spawn", "exec", "execFile", "fork", "spawnSync", "execSync", "execFileSync"]) cp[fn] = refuse(`child_process.${fn}`);
}
