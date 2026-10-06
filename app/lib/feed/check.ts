// ============================================================================
// The tick: "a person has looked, and it is right".
// ----------------------------------------------------------------------------
// It records who and when, and does NOTHING else — no OnSinch write, no email, no label.
// A reply cannot be ticked: it clears only when the follow-up board stops listing it,
// because a person glancing at the TV has not answered the client.
// ============================================================================
import type { FeedMark } from "./project";

export interface CheckStore {
  addMark(m: Omit<FeedMark, "at">): Promise<void>;
  removeCheck(item_key: string): Promise<void>;
}

const TICKABLE = /^(needs-created|needs-updated|created-check|updated-check):/;

/**
 * `actor` is the audit identity (the email) and goes in `by`; `name` is the signer's display
 * name and goes in the evidence, because the screen showed the email's local part
 * ("Checked by Benjamintmikus") when it had nothing better.
 */
export async function applyCheck(body: unknown, actor: string, store: CheckStore, name: string | null = null): Promise<{ status: number; body: Record<string, unknown> }> {
  const b = (body ?? {}) as Record<string, unknown>;
  const item_key = typeof b.item_key === "string" ? b.item_key : "";
  const thread_id = typeof b.thread_id === "string" ? b.thread_id : "";
  if (!TICKABLE.test(item_key) || item_key.length > 300 || !thread_id || typeof b.checked !== "boolean")
    return { status: 400, body: { ok: false, error: "item_key, thread_id and checked are required, and only an order item can be ticked" } };
  if (b.checked) await store.addMark({ item_key, thread_id, mark: "checked", by: actor, evidence: name ? { name } : null });
  else await store.removeCheck(item_key);
  return { status: 200, body: { ok: true, item_key, checked: b.checked } };
}
