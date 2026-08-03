// ============================================================================
// normalize — deterministic port of the n8n "Normalize Data" code node.
// Cleans email bodies (strip quoted replies, Spartan signatures, image tags,
// HTML), builds a chronological thread, drops duplicates of the latest email.
// Pure, no I/O — trivially testable.
// ============================================================================
import type { HydratedThread, ThreadMessage } from "./types";

const SPARTAN_SIG_MARKERS = [
  "spartan crew ltd",
  "operations spartan crew",
  "designexpert44.com/signature",
  "spartan_crew/logo.png",
  "unit 7 titan business estate",
  "www.spartancrew.co.uk",
  "03333 053374",
];

const SPARTAN_DOMAINS = ["@spartancrew.co.uk"];

// Machine mail. Half of everything that reaches the engine is not a person
// writing to Spartan: OnSinch's own "Client created new order" notifier,
// HandsHQ signature requests, Xero/Crezco payment notices, out-of-office
// bounces. The dangerous one is OnSinch's own notifier — it describes a real
// booking in real detail (company, venue, date, crew count), so a classifier
// reads it as an enquiry and the engine composes an order for a job OnSinch has
// ALREADY created, patching the real order with the notification's subject line
// and a guessed rate card and guessed hours. Sender shape, not content, is what
// separates these, so it is decided here rather than by the model.
const MACHINE_LOCALPARTS =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounce[sd]?|notifications?|automated|auto-?confirm|messaging-service)\b/i;
const MACHINE_DOMAINS = ["sinch.cz", "onsinch.com", "handshq.com", "crezco.com", "xero.com"];
const AUTO_REPLY_SUBJECT = /^\s*(re:\s*)?(automatic reply|auto[- ]?reply|out of (the )?office|ooo\b|undeliverable|delivery status notification)/i;
const AUTO_REPLY_BODY = [
  "out of the office",
  "currently on annual leave",
  "away from the office",
  "will not be checking emails",
];

export function isMachineSender(from: string): boolean {
  const f = (from || "").toLowerCase().trim();
  const [local, domain = ""] = f.split("@");
  if (!domain) return false;
  if (MACHINE_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  return MACHINE_LOCALPARTS.test(local || "");
}

/**
 * Something a person asked for. Deliberately broad: it only ever RESCUES a
 * message from the body heuristic below, so a false positive here costs one model
 * call and a false negative costs a booking.
 */
const ASKS_FOR_SOMETHING =
  /\b\d+\s*(crew|staff|technicians?|carpenters?|drivers?|locals?)\b|\bneed\s+(a\s+)?(crew|staff)\b|\bcan you (confirm|quote|crew|cover|provide)\b|\b(booking|quote) (request|enquiry|for)\b/i;

/**
 * An out-of-office / bounce sent BY a real person's address.
 *
 * The SUBJECT rule is anchored and safe — a message titled "Out of Office …" is
 * one. The BODY rule is an unanchored substring search, and that is the risky
 * half: a client can write "our manager is out of the office this week, so deal
 * with me: we need 6 crew on the 12th" and machine mail is decided BEFORE the
 * model runs, so the whole enquiry would be dropped with nothing able to rescue
 * it. So the body heuristic stands down when the message actually asks for
 * something; the subject rule and the sender-shape rules are unaffected.
 *
 * This had not yet happened — 0 occurrences in 252 live messages — but the trade
 * is lopsided: the guard costs a model call, the failure costs a booking.
 */
export function isAutoReply(subject: string, body: string): boolean {
  if (AUTO_REPLY_SUBJECT.test(subject || "")) return true;
  const raw = body || "";
  if (ASKS_FOR_SOMETHING.test(raw)) return false;
  const b = raw.toLowerCase().slice(0, 600);
  return AUTO_REPLY_BODY.some((p) => b.includes(p));
}

export function isMachineMessage(m: ThreadMessage): boolean {
  return isMachineSender(m.from) || isAutoReply(m.subject, m.body);
}

/**
 * Which message the engine should act on, and whether it is worth acting on.
 *
 * Preference order: newest message from a human client, then newest from anyone
 * outside Spartan, then newest of all. Shared with the pipeline's idempotency
 * key — if the two disagreed, a thread whose newest message is machine mail
 * would re-run the model on every sweep forever.
 */
export function selectLatest(messages: ThreadMessage[]): { latest: ThreadMessage; machine: boolean } | null {
  const sorted = [...messages].sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));
  if (!sorted.length) return null;
  const client = sorted.filter((m) => !m.is_from_spartan);
  const human = client.filter((m) => !isMachineMessage(m));
  const latest = human[human.length - 1] ?? client[client.length - 1] ?? sorted[sorted.length - 1];
  return { latest, machine: isMachineMessage(latest) };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?[^>]+>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanEmailBody(raw: string): string {
  if (!raw) return "";
  let text = raw;
  // drop quoted reply blocks ("On <date> <person> wrote:")
  text = text.split(/\nOn .*wrote:\n/i)[0];
  // drop quoted lines
  text = text
    .split("\n")
    .filter((line) => !line.trim().startsWith(">"))
    .join("\n");
  // drop inline image placeholders
  text = text.replace(/\[image:[^\]]+\]/gi, "");
  // cut everything from the first Spartan signature marker onwards
  const lower = text.toLowerCase();
  for (const marker of SPARTAN_SIG_MARKERS) {
    const idx = lower.indexOf(marker);
    if (idx !== -1) text = text.slice(0, idx);
  }
  return stripHtml(text);
}

export function isFromSpartan(from: string): boolean {
  const f = from.toLowerCase();
  return SPARTAN_DOMAINS.some((d) => f.includes(d));
}

/**
 * Normalize a raw thread: clean each body, sort chronologically, and mark
 * duplicates of the most-recent inbound email so the compiler can ignore them.
 * Returns { latest, history } where history excludes the latest + dupes.
 */
export function normalizeThread(thread: HydratedThread): {
  latest: ThreadMessage;
  history: ThreadMessage[];
  machine: boolean;
} {
  const cleaned = thread.messages
    .map((m) => ({ ...m, body: cleanEmailBody(m.body) }))
    // keep short-but-real client replies ("yes", "ok", "cancel"); only drop empties
    .filter((m) => m.body && m.body.trim().length >= 2)
    .sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

  if (cleaned.length === 0) {
    throw new Error(`Thread ${thread.thread_id} has no usable messages`);
  }

  // Act on the newest CLIENT message. Our own Spartan replies (drafted or sent)
  // show up in the thread as the newest message — they must NEVER be treated as
  // the inbound to classify/reply to (that would reply to ourselves and loop).
  // They remain in history as context only. Machine mail is skipped the same
  // way, so an out-of-office landing on top of a live enquiry does not hide it.
  const { latest, machine } = selectLatest(cleaned)!;
  const history = cleaned.filter((m) => m !== latest && m.body !== latest.body);

  return { latest, history, machine };
}
