export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// The help assistant: answers questions about the tool from the guide (lib/help/knowledge.ts)
// plus the switches as they stand now, streamed. A copy of House of Hud's Hud Assistant route
// (Kairo c930fa96) with three differences that are the point of the copy:
//   - the live state is read HERE from Settings and the environment, never taken from the
//     browser: what the assistant says about the system being paused is the server's word;
//   - the conversation is capped (lib/help/stream.ts trimHistory), so a long chat cannot grow
//     every request without bound;
//   - an upstream failure answers 502 with JSON, which the widget reports as a failure instead of
//     reading it as an empty answer.
// GUARDED like every route (test/writeRoutesAuthorised.ts): it spends model credit.

import { authorizeAction } from "../../lib/apiAuth";
import { getSettings } from "../../lib/settingsDb";
import { v2Writes } from "../../lib/paused";
import { OPENROUTER_PRIVACY } from "../../lib/openrouterPolicy";
import { HELP_GREETING, HELP_KNOWLEDGE } from "../../lib/help/knowledge";
import { trimHistory } from "../../lib/help/stream";
import { liveState } from "../../lib/help/liveState";

const SYSTEM_PROMPT = `<identity>
You are the Spartan Crew help assistant, the in-app guide to Spartan Crew's booking tool. You help the operations team understand the Live Feed (the TV board), the Gmail labels, what the bot does in OnSinch, the Jobs Board and Settings. You speak plainly, with no technical detail.
</identity>

<knowledge>
Everything you know about the tool is in the guide below. Answer ONLY from it. Never invent buttons, labels, screens, steps or settings that it does not describe.

${HELP_KNOWLEDGE}
</knowledge>

<style>
- Keep answers short and skimmable, usually 1 to 4 sentences. Get to the step.
- Use the tool's own names for things (e.g. **Confirm**, **Order Needs Updated**, **Email intake paused**) and put those names in bold.
- For a process, give a tight numbered list. Otherwise reply in plain prose.
- Never output code, JSON, or anything technical.
</style>

<boundaries>
- If asked something the guide does not cover, say so plainly. Do not guess, and never fill the gap with what a tool like this usually does.
- You cannot see clients, orders, emails or cards, and you never claim to know what is on the board or in OnSinch. Tell the person where to look.
- Spartan Crew's own prices, rates and policies are the team's, not the tool's: say the guide does not state them and suggest asking the colleague who handles them.
- You cannot change anything: not a card, an order, a label or a setting. Say where to go and what to press.
- A problem with the tool itself: suggest **Report an issue**. Anything else outside the tool: SamurAI Solutions at samuraisolutions.co.uk.
</boundaries>`;

function devStream(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}

export async function POST(request: Request): Promise<Response> {
  const caller = await authorizeAction(request);
  if (!caller.ok) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = trimHistory(body?.messages);

  const apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!apiKey) {
    // Local development without a key: the greeting, or an honest message, never a model.
    return devStream(messages.length === 0 ? HELP_GREETING : "The help service is not configured here. Please try again later.");
  }

  const settings = await getSettings().catch(() => null);
  const system = [
    { role: "system", content: SYSTEM_PROMPT },
    // Behind the stable prefix, so the guide still caches across questions.
    { role: "system", content: liveState(settings, v2Writes()) },
  ];

  let upstream: Response;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spartan-crew-jobber.vercel.app",
        "X-Title": "Spartan Crew Help",
      },
      body: JSON.stringify({
        ...OPENROUTER_PRIVACY,
        model: process.env.HELP_MODEL || "anthropic/claude-haiku-4.5",
        messages: [...system, ...messages],
        stream: true,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    return Response.json({ ok: false, error: "the help service could not be reached" }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return Response.json({ ok: false, error: `the help service answered ${upstream.status}` }, { status: 502 });
  }
  return new Response(upstream.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
