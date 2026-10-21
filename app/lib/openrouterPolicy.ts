/**
 * The one line that decides whether a client's correspondence may be kept by a model provider.
 *
 * WHY THIS IS A CONSTANT AND NOT TEN LITERALS. Ten places in this app post an enquiry thread to
 * OpenRouter, and OpenRouter routes each call to whichever provider it picks — Anthropic, Google
 * or OpenAI, depending on the model. Without a routing policy, "the provider does not keep it" is
 * a hope about somebody else's default rather than a property of our request. `data_collection:
 * "deny"` makes OpenRouter refuse any provider that would collect or train on the prompt, so the
 * sentence in the privacy policy is enforced by the call rather than by trust.
 *
 * The policy this backs, in `app/lib/terms.ts`: your data "is not used to train a model for
 * anybody else". A client accepted that. If this constant stops being spread into a request body,
 * that sentence stops being true for that route — which is why
 * `tests/openrouterPrivacy.test.ts` reads the source of every caller and fails when one drops it.
 *
 * WHAT IT COSTS: routing choice. A provider that will not accept the policy is skipped, so a call
 * can fail over to a costlier route or, rarely, find none. That is the correct trade: a reply that
 * did not happen is recoverable, and an enquiry sitting in somebody's training corpus is not.
 */
export const OPENROUTER_PRIVACY = {
  provider: { data_collection: "deny" as const },
} as const;
