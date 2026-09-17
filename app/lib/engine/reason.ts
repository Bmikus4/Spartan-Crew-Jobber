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
import { ADJUDICATION_SCHEMA } from "./venueAdjudicate";

export interface ClassifyResult {
  classification: Classification;
  priority: "low" | "medium" | "high";
  job_summary: string;
  /**
   * The name the order carries in OnSinch, written by the model.
   *
   * The order name used to BE the email subject, which is how "Re: Visual Elements Sat
   * 29th Aug 2026" reached the live tenant (order 14860). A reply prefix is not a job
   * title, and a subject line is written to be replied to, not to be read in a list of
   * bookings six weeks later.
   *
   * Optional because the model can omit it and a booking must never fail for want of a
   * name: `orderTitle()` in compiler.ts falls back to a composed one and strips any
   * reply prefix. Ben, 2026-08-26: "named By AI something realistic and representative
   * of the order, never say Re: in them".
   */
  order_title?: string;
  /**
   * The client is calling a job off, in whole or in part.
   *
   * A FLAG rather than a fifth value of Classification, deliberately. A cancellation
   * IS an update — it changes a job that already exists — and every consumer of the
   * enum already branches on four values. It is also not exclusive: one email can
   * cancel Tuesday and add Thursday. Modelling it as its own field is what the swept
   * corpus already does (sweep_labels.is_cancellation), for the same reason.
   */
  cancellation?: boolean;
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

  /**
   * RETRIES, AND WHY THE BUDGET IS SHARED RATHER THAN PER CALL.
   *
   * One OpenRouter timeout lost a whole thread in the 2026-09-16 study: the engine threw,
   * the thread left the denominator, and the headline moved a point on nothing. There was
   * no retry here at all, so a single slow response loses the email — and in production
   * the Gmail label is already stripped by then, so nothing tries again.
   *
   * WHICH FAILURES. The line is drawn at transport versus answer. Every call here READS
   * the model's opinion, so repeating one cannot double-book anything the way a repeated
   * POST to OnSinch could — but a repeat only helps where the request never got an
   * answer. A 401/402/403 is fatal for the whole run by design and asking again just
   * makes it fatal three times; an ordinary 4xx is a malformed request; and a reply with
   * no tool_call is a real answer of the wrong shape, which at temperature 0 will come
   * back identical, so retrying it spends money to hide a schema bug.
   *
   * WHY ONE SHARED BUDGET. guardReasoner ceilings LOGICAL calls at 25 and cannot see
   * inside this function, so a per-call retry would silently turn that ceiling into 75.
   * A corpus script spent $57 in one night in this account and capped the key. Sharing a
   * small budget across the reasoner's life keeps the worst case at ceiling + budget:
   * a rare timeout is absorbed, and something systematically broken burns the budget in
   * the first second and then fails loudly, which is the behaviour worth having.
   */
  // A malformed env var must fall back, never disable. Read plainly, `Number("")` is 0
  // and `Number("two")` is NaN, and an attempt ceiling of either is a reasoner that
  // never calls the model at all — it would fail every thread while looking configured.
  const num = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : d;
  };
  const ATTEMPTS = Math.max(1, num(process.env.REASONER_ATTEMPTS, 3));
  const BACKOFF_MS = (process.env.REASONER_BACKOFF_MS || "400,1200").split(",").map((s) => num(s, 400));
  let retryBudget = Number.isFinite(Number(process.env.REASONER_RETRY_BUDGET))
    ? Math.max(0, Number(process.env.REASONER_RETRY_BUDGET))
    : 8;

  /** Did the request fail to get an answer? Only then is asking again worth anything. */
  const transient = (e: unknown) => {
    const err = e as Error & { status?: number; transient?: boolean };
    if (err instanceof ReasonerAuthError) return false;
    if (err?.transient === true) return true;
    if (typeof err?.status === "number") return err.status === 429 || (err.status >= 500 && err.status !== 501);
    return false;
  };

  async function call(system: string, user: string, schema: object) {
    let last: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        return await callOnce(system, user, schema);
      } catch (err) {
        last = err;
        if (attempt === ATTEMPTS || !transient(err) || retryBudget <= 0) break;
        retryBudget--;
        await new Promise((r) => setTimeout(r, BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] ?? 400));
      }
    }
    // The attempt count goes in the message because "timed out" and "timed out three
    // times over ninety seconds" call for different responses from whoever reads it.
    if (last instanceof ReasonerAuthError) throw last;
    const e = last as Error;
    const tried = transient(last) ? ` (gave up after ${ATTEMPTS} attempts)` : "";
    throw Object.assign(new Error(`${e?.message ?? String(last)}${tried}`), { status: (last as any)?.status });
  }

  async function callOnce(system: string, user: string, schema: object) {
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
      // Only `fetch` is inside the try, so anything thrown here is the request never
      // reaching an answer. Marked rather than sniffed by name downstream, because the
      // rewrap below loses the original name and that is what the retry keys on.
      throw Object.assign(
        new Error(timedOut ? `OpenRouter (${model}) timed out after ${TIMEOUT_MS}ms` : `OpenRouter (${model}) failed: ${(err as Error)?.message}`),
        { transient: true }
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      // 401 revoked/unknown key, 402 no credit, 403 key limit reached: all fatal for the
      // whole run rather than for this one thread.
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new ReasonerAuthError(res.status, detail);
      }
      throw Object.assign(new Error(`OpenRouter ${res.status}: ${detail}`), { status: res.status });
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
        ...(r.order_title ? { order_title: String(r.order_title) } : {}),
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
        ...(r.order_title ? { order_title: String(r.order_title) } : {}),
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
    order_title: { type: "string" },
    cancellation: { type: "boolean" },
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
          location_text: { type: "string" },
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
    order_title: { type: "string" },
    cancellation: { type: "boolean" },
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

/**
 * A model that answers ONE question: which of these venue records is it.
 *
 * Deliberately its own factory rather than a fourth method on Reasoner. The three
 * Reasoner tasks all read an email; this one reads a shortlist a deterministic
 * matcher produced and never sees the thread. Keeping it separate means the venue
 * model can be a different model — it is, by default — without the classifier and
 * the reply writer moving with it.
 *
 * BEN ASKED FOR "gemini 3.5 pro" AND THERE IS NO SUCH MODEL on OpenRouter: the 3.5
 * family ships flash and flash-lite only, and the newest actual Pro is
 * gemini-3.1-pro-preview. That is the default, because the standing instruction for
 * venue resolution is accuracy above cost and time. SPARTAN_VENUE_MODEL overrides it.
 */
export function createVenueJudge(cfg: { apiKey: string; model?: string; baseUrl?: string }) {
  const model = cfg.model ?? process.env.SPARTAN_VENUE_MODEL ?? "google/gemini-3.1-pro-preview";
  const baseUrl = cfg.baseUrl ?? "https://openrouter.ai/api/v1";
  // Shorter than the reasoner's 25s: this call sits inside the same n8n invocation as
  // everything else and it is the LAST thing on the critical path. A venue the
  // matcher already has a good answer for is not worth a timeout for.
  const TIMEOUT_MS = Number(process.env.VENUE_TIMEOUT_MS || 15_000);

  return {
    async adjudicate(system: string, user: string): Promise<unknown> {
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
            // The answer is four small fields. The ceiling is here for the same reason
            // it is on the reasoner: without one OpenRouter reserves the model's whole
            // context and refuses the request unless the account can cover all of it.
            max_tokens: Number(process.env.VENUE_MAX_TOKENS || 512),
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            tools: [{ type: "function", function: { name: "emit", description: "Return the chosen venue", parameters: ADJUDICATION_SCHEMA } }],
            tool_choice: { type: "function", function: { name: "emit" } },
          }),
        });
      } catch (err) {
        const timedOut = (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError";
        throw new Error(timedOut ? `venue judge (${model}) timed out after ${TIMEOUT_MS}ms` : `venue judge (${model}) failed: ${(err as Error)?.message}`);
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (res.status === 401 || res.status === 402 || res.status === 403) throw new ReasonerAuthError(res.status, detail);
        throw new Error(`venue judge ${res.status}: ${detail}`);
      }
      const j = await res.json();
      const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("venue judge returned no tool_call: " + JSON.stringify(j).slice(0, 300));
      return typeof args === "string" ? JSON.parse(args) : args;
    },
  };
}
