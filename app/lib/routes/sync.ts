// The minute sync's steps, run in order, with each failure reported (addendum F37). Until 26 Oct
// every step's error was folded under ok:true, so a sync that did nothing read as one that did
// everything. Injected for tests; the route (app/api/bot/sync/route.ts) supplies the real steps.
import type { RunName } from "../runMarks";

export type SyncStep = [name: string, run: () => Promise<unknown>];

/** A step failed when it threw, or answered with an `error` (each step catches its own throw into one). */
const failedOf = (r: unknown) => (typeof r === "string" && r.startsWith("error")) || (!!r && typeof r === "object" && "error" in (r as object));

export async function runSync(steps: SyncStep[], io: { mark: (name: RunName, ok: boolean, detail?: unknown) => Promise<void>; now?: () => number }) {
  const now = io.now ?? Date.now;
  const t0 = now();
  const out: Record<string, unknown> = {};
  const failed: string[] = [];
  for (const [name, run] of steps) {
    out[name] = await run().catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 160) }));
    if (failedOf(out[name])) failed.push(name);
  }
  const ok = failed.length === 0;
  // A sync whose finish cannot be recorded reads as a stale sync to the heartbeat, which is the alarm wanted.
  await io.mark("sync", ok, { failed }).catch(() => {});
  return { ok, failed, ms: now() - t0, ...out };
}

/**
 * The n8n workflow that applies the Gmail labels, called after each cron sync. It holds the
 * mailbox's Gmail credential, which the app does not until the Gmail grant (ADDENDUM R14), so it
 * stays in n8n, started by this call and never by a schedule of its own (DECISIONS O1).
 */
export const labelsWebhook = () => (process.env.SPARTAN_LABELS_WEBHOOK || "https://samuraisolutions.app.n8n.cloud/webhook/spartan-labels").trim();

export async function askLabels(): Promise<{ status: number }> {
  const r = await fetch(labelsWebhook(), { method: "POST", signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`labels webhook ${r.status}`);
  return { status: r.status };
}
