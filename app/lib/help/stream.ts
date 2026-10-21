/**
 * Reads the help route's server-sent events into text.
 *
 * A NON-2XX ANSWER OR AN EMPTY ONE IS A FAILURE, NOT A REPLY. The House of Hud widget this was
 * copied from threw only when the response had no body; a 500 "Failed to connect to OpenRouter"
 * has a body, so it was read as a stream with no data lines and the person saw an empty answer
 * with no error (seen 10-21). `ok` is false for both, and the widget says so.
 */
export interface HelpStreamResult {
  ok: boolean;
  text: string;
}

export async function readHelpStream(res: Response, onText: (text: string) => void): Promise<HelpStreamResult> {
  if (!res.ok || !res.body) return { ok: false, text: "" };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let done = false;

  const handleLine = (raw: string) => {
    const line = raw.replace(/\r$/, "");
    if (!line.startsWith("data: ")) return;
    const data = line.slice(6);
    if (data === "[DONE]") { done = true; return; }
    try {
      const delta = JSON.parse(data)?.choices?.[0]?.delta?.content ?? "";
      if (delta) { text += delta; onText(text); }
    } catch { /* a partial or keep-alive line */ }
  };

  while (!done) {
    const { done: end, value } = await reader.read();
    if (end) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while (!done && (nl = buffer.indexOf("\n")) !== -1) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  if (!done && buffer) handleLine(buffer);
  return { ok: text.trim().length > 0, text };
}

/** The most turns sent back with each question: a long chat must not grow every request forever. */
export const MAX_HELP_TURNS = 20;
/** The longest single message forwarded, in characters. */
export const MAX_HELP_CHARS = 4000;

/** The conversation as the route accepts it: user and assistant turns only, the newest kept. */
export function trimHistory(messages: unknown): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HELP_CHARS) }))
    .slice(-MAX_HELP_TURNS);
}
