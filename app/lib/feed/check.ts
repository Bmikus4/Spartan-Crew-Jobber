// ============================================================================
// Confirm and False flag: "a person has looked, and it is right" (checked) or "it is a false flag" (denied).
// ----------------------------------------------------------------------------
// It records who and when, and does NOTHING else — no OnSinch write, no email, no label. One item holds at most
// one of the two: setting either removes both first, so a changed mind never leaves a check and an X together.
// A reply cannot be ticked: it clears only when the follow-up board stops listing it,
// because a person glancing at the TV has not answered the client.
// ============================================================================
import type { FeedMark } from "./project";

/** One press as the log keeps it: what was pressed, by whom, and the card as it was on the screen. */
export type Press = { item_key: string; thread_id: string; press: "confirm" | "false_flag" | "undo"; by: string; card: Record<string, unknown> | null };

export interface CheckStore {
  addMark(m: Omit<FeedMark, "at">): Promise<void>;
  removeCheck(item_key: string): Promise<void>;
  /** Appends to card_presses. A failed log never undoes or blocks the press itself. */
  logPress(p: Press): Promise<void>;
}

/** The card as the screen sent it, capped: it is evidence for learning, not something the press depends on. */
function cardOf(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const s = JSON.stringify(v);
  return s.length > 4000 ? null : (v as Record<string, unknown>);
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
  if (!TICKABLE.test(item_key) || item_key.length > 300 || !thread_id || typeof b.checked !== "boolean" || (b.denied !== undefined && typeof b.denied !== "boolean"))
    return { status: 400, body: { ok: false, error: "item_key, thread_id and checked are required, and only an order item can be ticked" } };
  const denied = b.checked && b.denied === true;
  await store.removeCheck(item_key);
  if (b.checked) await store.addMark({ item_key, thread_id, mark: denied ? "denied" : "checked", by: actor, evidence: name ? { name } : null });
  await store.logPress({ item_key, thread_id, press: !b.checked ? "undo" : denied ? "false_flag" : "confirm", by: actor, card: cardOf(b.card) })
    .catch((err) => console.error("[check] press log failed", String(err?.message ?? err).slice(0, 120)));
  return { status: 200, body: { ok: true, item_key, checked: b.checked, denied } };
}
