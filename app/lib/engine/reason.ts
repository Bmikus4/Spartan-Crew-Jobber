// ============================================================================
// reason — the LLM boundary. Exactly THREE tasks touch a model; everything
// else (id resolution, scoring, formatting, dedup) is deterministic code.
// This is the key architectural discipline: the model extracts + writes prose,
// it never resolves an integer id or builds the order body.
//
// Provider: OpenRouter (the same gateway the live n8n uses). Default model
// anthropic/claude-opus-4.6 (temp 0) — one model, replacing the old
// gemini-flash / gemini-pro / glm-5 / gpt-5-nano sprawl. Swap via SPARTAN_MODEL.
//
// The interface is injectable so the compiler is testable offline (see
// test/mockReasoner.ts).
// ============================================================================
import type {
  Classification,
  ConversationFacts,
  ThreadMessage,
} from "./types";
import { CLASSIFY_SYSTEM, EXTRACT_SYSTEM, REPLY_SYSTEM } from "./prompts";

export interface ClassifyResult {
  classification: Classification;
  priority: "low" | "medium" | "high";
  job_summary: string;
}

export interface ReplyResult {
  subject: string;
  html: string;
  priority: "low" | "medium" | "high";
}

export interface Reasoner {
  /**
   * Classification AND facts from one model call. Optional: a mock, or a provider that
   * cannot hold both schemas at once, still satisfies the interface — the compiler
   * falls back to classify + extractFacts when this is absent.
   */
  classifyAndExtract?(
    latest: ThreadMessage,
    history: ThreadMessage[],
    priorOrderExists: boolean
  ): Promise<ClassifyResult & { facts: ConversationFacts }>;

  classify(
    latest: ThreadMessage,
    history: ThreadMessage[],
    priorOrderExists: boolean
  ): Promise<ClassifyResult>;

  extractFacts(
    latest: ThreadMessage,
    history: ThreadMessage[]
  ): Promise<ConversationFacts>;

  composeReply(
    latest: ThreadMessage,
    history: ThreadMessage[],
    classification: Classification
  ): Promise<ReplyResult>;
}

// ---------------------------------------------------------------------------
// Real adapter (OpenRouter, OpenAI-compatible chat completions). Structured
// output is forced via function/tool calling: one tool "emit" whose parameters
// ARE the target schema, with tool_choice pinned to it, so the model must
// return valid JSON. Requires OPENROUTER_API_KEY.
// ---------------------------------------------------------------------------
export interface OpenRouterConfig {
  apiKey: string;
  model?: string;   // default anthropic/claude-opus-4.6
  baseUrl?: string; // default https://openrouter.ai/api/v1
}

export function createOpenRouterReasoner(cfg: OpenRouterConfig): Reasoner {
  const model = cfg.model ?? "anthropic/claude-opus-4.6";
  const baseUrl = cfg.baseUrl ?? "https://openrouter.ai/api/v1";
  // Same reasoning as the OnSinch transport: an open-ended model call can eat the
  // whole serverless invocation, and the workflow has already stripped the Gmail
  // label by then, so the email is lost rather than retried. A stage normally
  // takes 1.5-5s; 25s means something is wrong, and saying so beats hanging.
  const TIMEOUT_MS = Number(process.env.REASONER_TIMEOUT_MS || 25_000);

  async function call(system: string, user: string, schema: object) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://spartan-crew-jobber.vercel.app",
        "X-Title": "Spartan Crew Jobber",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        // Every reply here is a small tool-call object — a classification, a facts
        // record, an email. Without a ceiling OpenRouter reserves the model's entire
        // context (65,536 tokens) and refuses the request unless the account can cover
        // all of it, which is how a topped-up account still returned
        // "requires more credits" on every call.
        max_tokens: Number(process.env.REASONER_MAX_TOKENS || 4096),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        tools: [{ type: "function", function: { name: "emit", description: "Return the structured result", parameters: schema } }],
        tool_choice: { type: "function", function: { name: "emit" } },
      }),
      });
    } catch (err) {
      const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
      throw new Error(timedOut ? `OpenRouter (${model}) timed out after ${TIMEOUT_MS}ms` : `OpenRouter (${model}) failed: ${(err as Error)?.message}`);
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const j = await res.json();
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no tool_call in response: " + JSON.stringify(j).slice(0, 400));
    return typeof args === "string" ? JSON.parse(args) : args;
  }

  // History is capped. Uncapped, a thread averaging 31k characters was re-sent on every
  // call — 402M characters to label the corpus once, at $0.247 a thread. The newest
  // message is never truncated, and history is kept NEWEST-FIRST up to the cap, because
  // what a client last said outranks what they said in March.
  const HISTORY_CAP = Number(process.env.REASONER_HISTORY_CAP || 12_000);
  const threadText = (latest: ThreadMessage, history: ThreadMessage[]) => {
    const head =
      `LATEST (${latest.date_iso}) from ${latest.from}\nSubject: ${latest.subject}\n${latest.body}\n\n`;
    const lines: string[] = [];
    let used = 0, dropped = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      const line = `[${m.date_iso}] ${m.from}: ${m.body}`;
      if (used + line.length > HISTORY_CAP) { dropped = i + 1; break; }
      lines.unshift(line);
      used += line.length;
    }
    const note = dropped ? `[${dropped} earlier message(s) omitted for length]\n` : "";
    return `${head}HISTORY (oldest first):\n${note}${lines.join("\n")}`;
  };

  return {
    // One call where there were two, sometimes three. classify and extractFacts were
    // handed identical thread text and differed only in the question asked, so the
    // thread crossed the wire twice to interrogate the same evidence; the deferral rule
    // then needed the facts even on a rejection, making it three.
    async classifyAndExtract(latest, history, priorOrderExists) {
      const r = await call(
        `${CLASSIFY_SYSTEM}

---

In the SAME response, also extract the thread's facts under \"facts\", following these rules:

${EXTRACT_SYSTEM}`,
        `priorOrderExists=${priorOrderExists}

` + threadText(latest, history),
        COMBINED_SCHEMA
      );
      return {
        classification: r.classification,
        priority: r.priority,
        job_summary: r.job_summary,
        facts: (r.facts ?? { requests: [] }) as ConversationFacts,
      };
    },
    async classify(latest, history, priorOrderExists) {
      return call(
        CLASSIFY_SYSTEM,
        `priorOrderExists=${priorOrderExists}\n\n` + threadText(latest, history),
        CLASSIFY_SCHEMA
      );
    },
    async extractFacts(latest, history) {
      return call(EXTRACT_SYSTEM, threadText(latest, history), FACTS_SCHEMA);
    },
    async composeReply(latest, history, classification) {
      return call(
        REPLY_SYSTEM,
        `classification=${classification}\n\n` + threadText(latest, history),
        REPLY_SCHEMA
      );
    },
  };
}

const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["classification", "priority", "job_summary"],
  properties: {
    classification: { type: "string", enum: ["new-job", "update", "confirmation-only", "not-a-job"] },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    job_summary: { type: "string" },
  },
};
const FACTS_SCHEMA = {
  type: "object",
  required: ["requests"],
  properties: {
    company_name: { type: "string" },
    contact_name: { type: "string" },
    contact_email: { type: "string" },
    contact_phone: { type: "string" },
    customer_reference: { type: "string" },
    location_text: { type: "string" },
    requests: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          start_time: { type: "string" },
          end_time: { type: "string" },
          size: { type: "integer" },
          task: { type: "string" },
          profession_hint: { type: "string" },
        },
      },
    },
  },
};

/**
 * Both answers in one tool call: the classification fields, plus the very same facts
 * schema the standalone extractor uses, nested under "facts". Declared after
 * FACTS_SCHEMA so it can reference it directly rather than through a deferred getter.
 */
const COMBINED_SCHEMA = {
  type: "object",
  required: ["classification", "priority", "job_summary", "facts"],
  properties: {
    classification: { type: "string", enum: ["new-job", "update", "confirmation-only", "not-a-job"] },
    priority: { type: "string", enum: ["low", "medium", "high"] },
    job_summary: { type: "string" },
    facts: FACTS_SCHEMA,
  },
};
const REPLY_SCHEMA = {
  type: "object",
  required: ["subject", "html", "priority"],
  properties: {
    subject: { type: "string" },
    html: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
  },
};
