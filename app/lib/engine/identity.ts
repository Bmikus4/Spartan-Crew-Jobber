// ============================================================================
// identity — who the other side of the conversation is.
// ----------------------------------------------------------------------------
// Cross-thread dedup gates on the counterparty's DOMAIN rather than their email
// address, because the same client writes from more than one mailbox and an
// exact-address match misses every one of those. A domain is exact, free to
// compute, and needs no model.
//
// Two things must never become the recorded domain:
//
//   Spartan's own. It appears in every thread, on our own replies, so gating on
//   it would match every thread to every other thread.
//
//   A consumer provider. gmail.com is a mailbox, not an organisation; matching
//   two threads because both clients happen to use Gmail would be worse than not
//   matching at all. Those threads get no domain and fall back to the address.
// ============================================================================
import type { ThreadMessage } from "./types";
import { isFromSpartan } from "./normalize";

/** Mailbox providers. A shared provider is not a shared organisation. */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "mac.com", "aol.com", "msn.com", "protonmail.com", "proton.me", "gmx.com",
  "gmx.co.uk", "mail.com", "yandex.com", "zoho.com",
]);

/** "Jane Doe <J@X.com>" | "  j@x.com " -> "j@x.com"; "" when there is no address. */
export function normaliseAddress(raw: string): string {
  const s = String(raw ?? "").trim();
  const angled = s.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : "";
}

/** The domain part, or null when the address is absent, malformed or a consumer mailbox. */
export function organisationalDomain(address: string): string | null {
  const addr = normaliseAddress(address);
  if (!addr) return null;
  const domain = addr.slice(addr.indexOf("@") + 1);
  if (CONSUMER_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * The counterparty on a thread: the newest message from someone who is not us.
 *
 * Newest rather than first, because a thread can be handed between people at the
 * client and the current correspondent is the one that matters. `is_from_spartan`
 * is advisory - the address is checked too, for the reason recorded in
 * normalize.ts: a payload that omits the flag defaults it to false and would
 * otherwise make us our own counterparty.
 */
export function counterpartyIdentity(
  messages: ThreadMessage[]
): { email: string | null; domain: string | null } {
  const clients = [...messages]
    .filter((m) => !m.is_from_spartan && !isFromSpartan(String(m.from ?? "")))
    .filter((m) => normaliseAddress(String(m.from ?? "")))
    .sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

  const latest = clients[clients.length - 1];
  if (!latest) return { email: null, domain: null };

  const email = normaliseAddress(String(latest.from));
  return { email: email || null, domain: organisationalDomain(email) };
}
