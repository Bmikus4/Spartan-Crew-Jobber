// ============================================================================
// Say what is left on the OpenRouter key, before it runs out rather than after.
// ----------------------------------------------------------------------------
// On 2026-08-04 the key hit its $150 cap. The engine kept accepting mail — 17
// emails that day — and classified none of it, because every model call returned
// 403. Nothing in the logs said why: an exhausted key looks exactly like a quiet
// morning from the outside, and the only reason it was noticed at all was someone
// comparing "emails received" against "jobs detected" by eye.
//
// The killer detail is `limit_reset: null`. That cap does NOT roll over. It is not a
// daily budget that frees up overnight; once spent, the key is dead until a human
// raises the limit or issues a new one. So this is not a transient condition to ride
// out, it is an outage that waits to be noticed.
//
// GET /api/v1/key costs nothing — no tokens, not a completion — so asking is free.
// It runs ONCE per process, on the first reasoner construction, and never blocks a
// request: the answer is a log line, and a log line is not worth adding latency to
// an email or a reason to fail one. Every failure mode here is swallowed.
// ============================================================================

export interface KeyBalance {
  /** The key's own spend cap, or null when no limit is set. */
  limit: number | null;
  usage: number;
  /** limit - usage, or null when there is no limit to subtract from. */
  remaining: number | null;
  /** null means the cap NEVER resets — the key is dead until a human acts. */
  resetsAt: string | null;
  exhausted: boolean;
  /** Under 10% of the cap, or under $5, whichever is hit first. */
  low: boolean;
  label?: string;
}

/** Below this, warn regardless of how big the cap is. A dollar buys ~50 emails. */
const LOW_ABSOLUTE_USD = 5;
const LOW_FRACTION = 0.1;

export function interpret(data: Record<string, unknown>): KeyBalance {
  const limit = typeof data.limit === "number" ? data.limit : null;
  const usage = typeof data.usage === "number" ? data.usage : 0;
  // Prefer OpenRouter's own remaining figure when it gives one: it accounts for
  // things our subtraction does not, such as BYOK spend excluded from the limit.
  const remaining =
    typeof data.limit_remaining === "number"
      ? data.limit_remaining
      : limit === null
        ? null
        : Math.max(0, limit - usage);
  const resetsAt = typeof data.limit_reset === "string" ? data.limit_reset : null;
  return {
    limit,
    usage,
    remaining,
    resetsAt,
    exhausted: remaining !== null && remaining <= 0,
    low:
      remaining !== null &&
      remaining > 0 &&
      (remaining < LOW_ABSOLUTE_USD || (limit !== null && limit > 0 && remaining < limit * LOW_FRACTION)),
    label: typeof data.label === "string" ? data.label : undefined,
  };
}

/** The line that goes in the log. Exported so a test can assert on the wording. */
export function describe(b: KeyBalance): string {
  const money = (n: number | null) => (n === null ? "no limit" : `$${n.toFixed(2)}`);
  const head = `[openrouter] key ${b.label ?? "?"} — spent ${money(b.usage)} of ${money(b.limit)}, ${money(b.remaining)} left`;
  if (b.exhausted) {
    return (
      `${head}. THE KEY IS EXHAUSTED: every model call will return 403 and NO email will be ` +
      `classified. ` +
      (b.resetsAt
        ? `It resets at ${b.resetsAt}.`
        : `limit_reset is null, so this does NOT recover on its own — raise the key's limit or issue a new one.`)
    );
  }
  if (b.low) return `${head}. RUNNING LOW — classification stops silently when this reaches zero.`;
  return head;
}

/**
 * Ask OpenRouter what is left, once per process.
 *
 * `fetchImpl` is injectable so the tests never touch the network. The promise is
 * cached rather than the value: two concurrent cold-start requests then share one
 * lookup instead of racing, and a failure is not retried on every email.
 */
let cached: Promise<KeyBalance | null> | null = null;

export function resetKeyBalanceCache(): void {
  cached = null;
}

export async function getKeyBalance(
  apiKey: string,
  opts: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<KeyBalance | null> {
  if (cached) return cached;
  const f = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://openrouter.ai/api/v1";
  const timeoutMs = opts.timeoutMs ?? 5_000;

  cached = (async () => {
    try {
      const res = await f(`${baseUrl}/key`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        // A 401 here is itself worth knowing: it means the key is revoked, which is the
        // other way classification stops without explanation.
        console.error(`[openrouter] could not read key balance (HTTP ${res.status})` +
          (res.status === 401 ? " — the key is REVOKED; no email will be classified" : ""));
        return null;
      }
      const j = (await res.json()) as { data?: Record<string, unknown> };
      return interpret(j?.data ?? {});
    } catch (err) {
      // Never a reason to fail an email. The balance is diagnostics, not a dependency.
      console.error("[openrouter] could not read key balance:", (err as Error)?.message ?? err);
      return null;
    }
  })();

  return cached;
}

/**
 * Fire the check and log it, without making the caller wait.
 *
 * Deliberately not awaited by the pipeline: the cost of a blocking check is latency on
 * every cold start, and the benefit is a log line that is just as useful arriving a
 * second later.
 */
export function logKeyBalanceOnce(apiKey: string, opts?: Parameters<typeof getKeyBalance>[1]): void {
  void getKeyBalance(apiKey, opts)
    .then((b) => {
      if (!b) return;
      if (b.exhausted) console.error(describe(b));
      else if (b.low) console.warn(describe(b));
      else console.log(describe(b));
    })
    .catch(() => { /* getKeyBalance already swallows; this is belt and braces */ });
}
