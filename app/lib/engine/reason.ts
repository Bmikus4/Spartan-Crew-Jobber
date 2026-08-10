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
import { renderConversation } from "./renderThread";

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

  /**
   * The same combined question, but shown the facts already established instead of the
   * messages they came from. A thread is re-processed on every new client message, and
   * re-sending the whole thread each time means the corpus is read 6.26 times over
   * (77,523 message-reads for 12,380 messages). Optional for the same reason as
   * classifyAndExtract: the compiler falls back to the full-thread call.
   */
  classifyAndExtractIncremental?(
    latest: ThreadMessage,
    priorFacts: ConversationFacts,
    priorClassification: Classification | undefined,
    priorOrderExists: boolean,
    // Required in practice, optional in the type only so an existing mock still
    // compiles. Omit it and classification is back to judging one email.
    history?: ThreadMessage[]
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
    classification: Classification,
    context?: ReplyContext
  ): Promise<ReplyResult>;
}

/**
 * What the order path concluded, handed to the reply writer so it can stop
 * promising bookings that were never made.
 *
 * The reply used to be composed BEFORE any of this was known, so it committed
 * either way — live thread 19fadd4ff8152dea drafted "both dates are now booked in"
 * on a needs-info ticket with no order at all.
 *
 * Optional on the interface so a mock or a different provider still satisfies it,
 * but the production path always passes it. The compiler decides the wording
 * rules; this only reports the situation.
 */
export interface ReplyContext {
  /**
   *  staged             an order is built and waiting for one click
   *  updating-existing  an order already exists and this changes it
   *  blocked            no order exists and cannot be built yet
   *  not-a-job          nothing to book
   */
  order_state: "staged" | "updating-existing" | "blocked" | "not-a-job";
  /**
   * Things ONLY THE CLIENT can supply, without which no order can be built —
   * crew size, dates, times, venue. Never company or rate: an unknown company is
   * created and an unknown rate is Spartan's to set, so neither is a question to
   * put to a client. Empty unless order_state is "blocked".
   */
  ask_for: string[];
}

// ---------------------------------------------------------------------------
// Real adapter (OpenRouter, OpenAI-compatible chat completions). Structured
// output is forced via function/tool calling: one tool "emit" whose parameters
// ARE the target schema, with tool_choice pinned to it, so the model must
// return valid JSON. Requires OPENROUTER_API_KEY.
// ---------------------------------------------------------------------------
/**
 * The key is dead, capped, or the account is out of credit — every subsequent call will
 * fail the same way. Distinguished from an ordinary failure because the right response
 * is to stop, not to retry the next thread: a revoked key returns 401 on all 5,835 of
 * them, and a batch that "completes" with an error row per thread reads like data.
 */
export class ReasonerAuthError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(
      status === 402
        ? `OpenRouter is out of credit (402). Nothing will run until the account is topped up. ${detail}`
        : status === 403
          ? `OpenRouter refused the key (403) — usually its own spend limit. ${detail}`
          : `OpenRouter rejected the key (${status}) — revoked or wrong. ${detail}`
    );
    this.name = "ReasonerAuthError";
    this.status = status;
  }
}

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

  // The system prompt is byte-identical on every call and is 2,744 tokens — 34M tokens
  // over a pass of the corpus, about $170 of a $289 bill. Marked cacheable it is charged
  // at 0.1x after a 1.25x write.
  //
  // OFF by default, and that is the honest setting rather than a timid one: live traffic
  // is ~34 events a day, so a 5-minute cache is cold on nearly every live call and the
  // saving is ~0 while the request-shape change is a real risk to the one path that must
  // not break. Turn it on for a batch, where calls are back-to-back and it pays:
  //
  //   SPARTAN_PROMPT_CACHE=1
  //
  // Only for anthropic/* — cache_control is the Anthropic breakpoint format; other
  // providers cache implicitly and ignore it, but sending an unfamiliar content shape to
  // them buys nothing. NOT yet confirmed against a live call: it needs one 20-thread
  // paid run to verify, which is exactly the check the cost report asks for.
  const CACHE_PROMPT = process.env.SPARTAN_PROMPT_CACHE === "1" && model.startsWith("anthropic/");
  const systemBlocks = (system: string) =>
    CACHE_PROMPT
      ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }]
      : system;

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
          { role: "system", content: systemBlocks(system) },
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
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // 401 revoked/unknown key, 402 no credit, 403 key limit reached: all fatal for the
      // whole run rather than for this one thread.
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new ReasonerAuthError(res.status, detail);
      }
      throw new Error(`OpenRouter ${res.status}: ${detail}`);
    }
    const j = await res.json();
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no tool_call in response: " + JSON.stringify(j).slice(0, 400));
    return typeof args === "string" ? JSON.parse(args) : args;
  }

  // The conversation is rendered as ONE labelled block — see renderThread.ts for the
  // shape and for why the cap sheds Spartan's replies before the client's messages.
  //
  // What was here put the newest message under a "LATEST" heading with the rest under
  // "HISTORY", which is a structure that invites classifying the heading rather than
  // the thread: a client's crew request one message down reads as background. The
  // newest message is now the last line of the conversation, marked [NEWEST].
  const threadText = (latest: ThreadMessage, history: ThreadMessage[]) =>
    `Subject: ${latest.subject}\n\n${renderConversation(latest, history).text}`;

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
    // Prior FACTS in place of prior MESSAGES. The system prompts are the ones ported
    // verbatim from the live n8n workflow and are not altered here — only the evidence
    // that accompanies them changes, from "the whole thread again" to "what we already
    // established, plus the one message that just arrived".
    //
    // It asks for the COMPLETE updated facts rather than a diff: a patch language is a
    // second thing to get right, and the caller merges the answer conservatively anyway
    // (mergeFacts refuses to blank a known field), so a lazy reply cannot erase history.
    async classifyAndExtractIncremental(latest, priorFacts, priorClassification, priorOrderExists, history = []) {
      const r = await call(
        `${CLASSIFY_SYSTEM}

---

In the SAME response, also extract the thread's facts under \"facts\", following these rules:

${EXTRACT_SYSTEM}`,
        `priorOrderExists=${priorOrderExists}
priorClassification=${priorClassification ?? "none"}

FACTS ALREADY ESTABLISHED FROM EARLIER MESSAGES IN THIS THREAD.
Return the COMPLETE facts as they now stand, not only what changed. Where the
conversation below contradicts them, the conversation wins — these are a summary,
it is the evidence.

${JSON.stringify(priorFacts)}

Subject: ${latest.subject}

${renderConversation(latest, history).text}`,
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
    async composeReply(latest, history, classification, context) {
      // The situation is stated in words rather than passed as a flag the prompt has
      // to decode, because the prompt is the only thing that turns it into wording.
      const state = context?.order_state ?? "not-a-job";
      const situation =
        state === "staged"
          ? "A draft booking HAS been prepared from this thread and is waiting for a colleague to confirm it. It is NOT confirmed yet."
          : state === "updating-existing"
            ? "A booking for this job ALREADY EXISTS and the change in this email is being applied to it."
            : state === "blocked"
              ? "NO booking has been made and none can be until the client sends more information."
              : "There is nothing to book in this thread.";
      const asks = (context?.ask_for ?? []).length
        ? `\nTO BOOK THIS, THE CLIENT STILL NEEDS TO TELL US:\n- ${context!.ask_for.join("\n- ")}`
        : "";
      return call(
        REPLY_SYSTEM,
        `classification=${classification}\nBOOKING SITUATION: ${situation}${asks}\n\n` + threadText(latest, history),
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
