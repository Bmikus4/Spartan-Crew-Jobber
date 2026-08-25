// One rendered conversation, every message labelled by who sent it.
//
// Ported from Ben's n8n conversational renderer (github.com/Bmikus4/
// msconversationalrenderer). Its shape is the point: split the thread into
// messages, label each one DETERMINISTICALLY by sender role, sort by real time,
// and hand the model one flat block. The model is then answering about a
// conversation it can see, instead of being asked to work out who was speaking.
//
// What this replaces sent "LATEST … / HISTORY (oldest first): [date] from: body".
// Two things followed from that. The model had to infer from the address whether a
// line was the client asking or Spartan answering — the classifier prompt spends a
// whole rule (1b) telling it how. And "LATEST" being structurally apart from the
// rest is what made "just classify the newest email" the easy reading.
//
// THE CAP DROPS SPARTAN'S REPLIES FIRST, and that is not a size heuristic — only a
// CLIENT message can create a job (prompt Rule 1b), so Spartan's own replies are the
// only messages that can be lost without changing the answer. Measured over 307 live
// threads from 2026-08: normalised history is 4,674 chars mean and 18,369 max, of
// which client messages are 2,689 mean and 12,047 max. Exactly one thread in 307 has
// client history over the 12k cap, against 29 that exceed it once Spartan's replies
// are counted. So capping this way keeps every client word on all but 1 in 307
// threads. Raw bodies are ~20x bigger (96k mean); normalize strips the quoted copies
// before anything reaches here.
import type { ThreadMessage } from "./types";

export type MessageLabel = "from_client" | "reply_spartan";

export interface RenderedConversation {
  text: string;
  /** Messages actually rendered, oldest first. */
  shown: number;
  /** Spartan replies dropped to fit the cap. Client messages are dropped only after these. */
  droppedSpartan: number;
  /** Client messages dropped — non-zero means the cap bit into evidence. */
  droppedClient: number;
}

export function labelOf(m: ThreadMessage): MessageLabel {
  return m.is_from_spartan ? "reply_spartan" : "from_client";
}

// "2026-08-10 14:32 UK". The model reasons about dates constantly ("the 3rd", "next
// Tuesday"), so a readable stamp in the client's own timezone beats an ISO string.
// Invalid dates render as the raw value rather than a fake one.
export function stamp(iso: string): string {
  const d = new Date(Date.parse(iso));
  if (isNaN(d.getTime())) return iso || "unknown date";
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")} UK`;
}

function header(m: ThreadMessage, newest: boolean): string {
  return `[${stamp(m.date_iso)}] <${m.from || "unknown"}> [${labelOf(m)}]${newest ? " [NEWEST]" : ""}`;
}

/**
 * Render the whole conversation, oldest first, newest message included and marked.
 *
 * `cap` bounds the HISTORY only — the newest message is never trimmed, because it is
 * the one thing every call is definitely about.
 */
export function renderConversation(
  latest: ThreadMessage,
  history: ThreadMessage[],
  cap = Number(process.env.REASONER_HISTORY_CAP || 12_000),
): RenderedConversation {
  // Chronological, and stable when two messages share a timestamp (or carry none):
  // a thread read out of order reads as the client contradicting themselves.
  const ordered = [...history].sort((a, b) => {
    const ta = Date.parse(a.date_iso) || 0, tb = Date.parse(b.date_iso) || 0;
    return ta - tb;
  });

  // Fit newest-first so the trim falls on the oldest of whichever class is being
  // dropped, then restore reading order.
  const keep = new Set<ThreadMessage>();
  let used = 0, droppedSpartan = 0, droppedClient = 0;

  const fit = (msgs: ThreadMessage[], onDrop: () => void) => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const cost = header(m, false).length + 1 + (m.body || "").length + 2;
      if (used + cost > cap) { onDrop(); continue; }
      used += cost;
      keep.add(m);
    }
  };
  // Client messages claim the budget first; Spartan's replies take what is left.
  fit(ordered.filter((m) => !m.is_from_spartan), () => { droppedClient++; });
  fit(ordered.filter((m) => m.is_from_spartan), () => { droppedSpartan++; });

  const shown = ordered.filter((m) => keep.has(m));
  const parts: string[] = [];
  parts.push(`--- CONVERSATION (${shown.length + 1} messages, oldest first) ---`);
  const omitted: string[] = [];
  if (droppedSpartan) omitted.push(`${droppedSpartan} earlier Spartan reply(s)`);
  if (droppedClient) omitted.push(`${droppedClient} earlier client message(s)`);
  if (omitted.length) parts.push(`[${omitted.join(" and ")} omitted for length]`);

  for (const m of shown) {
    parts.push("");
    parts.push(header(m, false));
    parts.push(m.body || "(empty)");
  }
  parts.push("");
  parts.push(header(latest, true));
  parts.push(latest.body || "(empty)");
  parts.push("");
  parts.push("--- END CONVERSATION ---");
  /**
   * The reference date, said once in plain words at the end where nothing can push
   * it out of the window.
   *
   * Every per-message header already carries a timestamp, but "the model can see
   * the dates" was an assumption and the corpus study read 19 of 100 work dates a
   * year early — always by taking the year of the email for a date the client wrote
   * without one. Whether the model could not find the reference date or found it and
   * had no rule to apply to it, this line and the FIELD RULE for `date` answer both.
   * The deterministic roll in parseWork is the authority either way; this is the
   * cheap half of a fix that is made in two places on purpose.
   */
  parts.push("");
  parts.push(`TODAY, for reading any date the client wrote without a year: ${stamp(latest.date_iso)}`);

  return { text: parts.join("\n"), shown: shown.length + 1, droppedSpartan, droppedClient };
}
