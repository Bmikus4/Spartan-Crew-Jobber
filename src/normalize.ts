// ============================================================================
// normalize — deterministic port of the n8n "Normalize Data" code node.
// Cleans email bodies (strip quoted replies, Spartan signatures, image tags,
// HTML), builds a chronological thread, drops duplicates of the latest email.
// Pure, no I/O — trivially testable.
// ============================================================================
import type { HydratedThread, ThreadMessage } from "./types.js";

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
} {
  const cleaned = thread.messages
    .map((m) => ({ ...m, body: cleanEmailBody(m.body) }))
    .filter((m) => m.body && m.body.length > 5)
    .sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

  if (cleaned.length === 0) {
    throw new Error(`Thread ${thread.thread_id} has no usable messages`);
  }

  const latest = cleaned[cleaned.length - 1];
  const history = cleaned
    .slice(0, -1)
    .filter((m) => m.body !== latest.body); // drop exact duplicates of latest

  return { latest, history };
}
