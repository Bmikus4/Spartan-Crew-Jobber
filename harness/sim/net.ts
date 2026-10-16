// ============================================================================
// The simulator's network: every fetch the app makes ends here, and nothing leaves the machine.
//   OnSinch          -> the fake (onsinch.ts)
//   the model        -> the stored reading of the email being decided (no model is called)
//   n8n webhooks     -> recorded, answered {ok:true}
//   anything else    -> refused, and counted
// The email being decided is read off the app's own SELECT on thread_messages (pg.ts).
// ============================================================================
import { readFileSync } from "node:fs";
import { onsinch } from "./onsinch";
import { current } from "./pg";

const readings = new Map<string, any>();
for (const r of JSON.parse(readFileSync(".tmp-data/sim/readings.json", "utf8"))) if (r.extraction) readings.set(String(r.message_id), r);

export const net = { model: 0, modelMissing: [] as string[], webhooks: [] as Array<{ url: string; body: unknown }>, refused: [] as string[] };
const json = (status: number, data: unknown) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export function installFetch(): void {
  (globalThis as any).fetch = async (input: any, init: any = {}) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    const method = String(init.method ?? input?.method ?? "GET").toUpperCase();
    const raw = init.body ?? null;
    const body = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw;
    if (/onsinch\.com\/api\/v1/.test(url)) { const r = await onsinch(method, url, body); return json(r.status, r.data); }
    if (/openrouter\.ai|ai-gateway\.vercel\.sh/.test(url)) {
      net.model++;
      const r = current.message_id ? readings.get(current.message_id) : null;
      if (!r) net.modelMissing.push(current.message_id ?? "?");
      const x = r?.extraction ?? { intent: "unclear", po: null, requests: [], note: "no stored reading for this email" };
      return json(200, { model: r?.meta?.model ?? "recorded", choices: [{ message: { content: JSON.stringify(x) } }], usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 } });
    }
    if (/n8n\.cloud\/webhook|\/webhook\//.test(url)) { net.webhooks.push({ url, body }); return json(200, { ok: true }); }
    net.refused.push(`${method} ${url.slice(0, 80)}`);
    return json(599, { message: "the simulator refuses every network call it does not stand in for" });
  };
}
