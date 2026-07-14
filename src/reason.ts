// ============================================================================
// reason — the LLM boundary. Exactly THREE tasks touch a model; everything
// else (id resolution, scoring, formatting, dedup) is deterministic code.
// This is the key architectural discipline: the model extracts + writes prose,
// it never resolves an integer id or builds the order body.
//
// Default model: claude-opus-4-8 (temp 0). One model, replacing the old
// gemini-flash / gemini-pro / glm-5 / gpt-5-nano sprawl.
//
// The interface is injectable so the compiler is testable offline (see
// test/mockReasoner.ts).
// ============================================================================
import type {
  Classification,
  ConversationFacts,
  ThreadMessage,
} from "./types.js";

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
// Real adapter (Anthropic Messages API, structured via tool-use). Requires
// ANTHROPIC_API_KEY. Prompts are versioned in ./prompts (ported from n8n).
// Left as a thin sketch — the prototype's tests run against the mock.
// ---------------------------------------------------------------------------
export interface AnthropicConfig {
  apiKey: string;
  model?: string; // default claude-opus-4-8
}

export function createAnthropicReasoner(cfg: AnthropicConfig): Reasoner {
  const model = cfg.model ?? "claude-opus-4-8";
  async function call(system: string, user: string, schema: object) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system,
        tools: [{ name: "emit", description: "Return structured result", input_schema: schema }],
        tool_choice: { type: "tool", name: "emit" },
        messages: [{ role: "user", content: user }],
      }),
    });
    const j = await res.json();
    const block = j.content?.find((b: any) => b.type === "tool_use");
    if (!block) throw new Error("no tool_use in response: " + JSON.stringify(j).slice(0, 400));
    return block.input;
  }

  const threadText = (latest: ThreadMessage, history: ThreadMessage[]) =>
    `LATEST (${latest.date_iso}) from ${latest.from}\nSubject: ${latest.subject}\n${latest.body}\n\n` +
    `HISTORY (oldest first):\n` +
    history.map((m) => `[${m.date_iso}] ${m.from}: ${m.body}`).join("\n");

  return {
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

// --- schemas (structured output) -------------------------------------------
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
const REPLY_SCHEMA = {
  type: "object",
  required: ["subject", "html", "priority"],
  properties: {
    subject: { type: "string" },
    html: { type: "string" },
    priority: { type: "string", enum: ["low", "medium", "high"] },
  },
};

// Prompts ported verbatim from the live n8n workflows (trimmed here; the full
// text lives in ./prompts/*.md in the real build).
const CLASSIFY_SYSTEM = `Classify the LATEST email only as new-job | update | confirmation-only | not-a-job. History is context only. Confirmation with no changes => confirmation-only. Prefer update if a prior order exists and the email modifies it.`;
const EXTRACT_SYSTEM = `Extract structured booking facts for the CLIENT company (never Spartan Crew). Copy values verbatim; reformat dates to YYYY-MM-DD. Never invent. One request entry per distinct date/size/task block. Exclude @spartancrew.co.uk addresses.`;
const REPLY_SYSTEM = `You are the Spartan Crew email assistant. Write one casual, natural crew-style reply. Never mention IDs, priority, or internal ops. Body wrapped in <div>…<p>Thanks,<br>Spartan Crew</p></div>.`;
