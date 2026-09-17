// ============================================================================
// GMAIL WRITES — the four labels, and the reply draft.
// ----------------------------------------------------------------------------
// This is the last thing n8n was doing. The DECISIONS have always been here: pipeline.ts
// works out which label a thread has earned and composes the reply. n8n only carried them
// out, which put the mailbox's one visible signal behind an OAuth credential that has
// been dead since 2026-09-09 and a canvas nobody reviews.
//
// SCOPE. Reading needs gmail.readonly; this needs gmail.modify, which covers labels AND
// draft creation. Domain-wide delegation matches scope strings CHARACTER FOR CHARACTER,
// so a grant made for readonly does not cover this and adding it later means editing the
// grant — worth knowing before the admin does it once.
//
// WHY WRITES ARE ALLOWED TO FAIL QUIETLY AND READS ARE NOT. Ben's split: reading is the
// half that must never fail, a label is cosmetic. A dead write costs a late tag on a
// thread; a dead read costs a booking. So the caller is expected to let these throw and
// carry on — see the poller, which never lets a label failure stop an order being made.
// ============================================================================

/** A Gmail call: `(method, path, body?)` against `gmail/v1/users/me/`. */
export type GmailApi = (method: string, path: string, body?: any) => Promise<any>;

/**
 * FOUR, AND ONLY FOUR. Ben, 2026-09-13.
 *
 * They are a terminal signal, not a queue: somebody reads one off a thread and knows
 * where that booking stands. Order matters to nothing here, but membership does — see
 * applyThreadLabel, which refuses anything outside this list rather than inventing a
 * fifth the way "Manual" once was.
 */
export const THE_FOUR = ["Order Built", "Order Updated", "Order Needs Built", "Order Needs Updated"] as const;
export type SpartanLabel = (typeof THE_FOUR)[number];

/**
 * Ben asked for the two "done" labels to read apart at a glance in a list of threads.
 * Colour is a property of the LABEL, not of the thread, so it is set once at creation.
 */
const COLOUR: Record<SpartanLabel, { backgroundColor: string; textColor: string }> = {
  "Order Built":         { backgroundColor: "#16a766", textColor: "#ffffff" },
  "Order Updated":       { backgroundColor: "#4a86e8", textColor: "#ffffff" },
  "Order Needs Built":   { backgroundColor: "#cc3a21", textColor: "#ffffff" },
  "Order Needs Updated": { backgroundColor: "#eaa041", textColor: "#ffffff" },
};

let cache: Map<string, string> | null = null;

/** Test seam: the cache is module-global, so one case would answer the next. */
export function __resetLabelCache(): void {
  cache = null;
}

/**
 * The id of every one of the four, creating any that are missing.
 *
 * Listed once per process and then held. Gmail's modify endpoint takes label IDs rather
 * than names, so this lookup is unavoidable; doing it per thread would be a request per
 * enquiry for an answer that changes roughly never.
 */
async function labelIds(api: GmailApi): Promise<Map<string, string>> {
  if (cache) return cache;
  const res = await api("GET", "labels");
  const byName = new Map<string, string>();
  for (const l of res?.labels ?? []) if (l?.name) byName.set(String(l.name), String(l.id));

  for (const name of THE_FOUR) {
    if (byName.has(name)) continue;
    const made = await api("POST", "labels", {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      color: COLOUR[name],
    });
    if (made?.id) byName.set(name, String(made.id));
  }
  cache = byName;
  return cache;
}

/**
 * Gmail's own thread id.
 *
 * Ours are prefixed `gmail:` so a thread from the poller can never collide with one the
 * webhook intake minted from RFC headers. Gmail has never heard of that prefix, and
 * sending it addresses a thread that does not exist — a 404 that reads like a deleted
 * conversation rather than a string bug.
 */
function bareThreadId(threadId: string): string {
  return String(threadId).replace(/^gmail:/, "");
}

/**
 * Put one of the four on a thread and take the other three off, in ONE request.
 *
 * The exclusivity is the point. A thread wearing "Order Built" and "Order Needs Built"
 * together says the work is both done and outstanding, and a label must never claim work
 * is outstanding when it is done. Gmail takes addLabelIds and removeLabelIds in the same
 * call, so there is no instant in which the thread wears two.
 */
export async function applyThreadLabel(api: GmailApi, threadId: string, label: SpartanLabel): Promise<void> {
  if (!THE_FOUR.includes(label)) {
    throw new Error(`"${label}" is not one of the four labels this system may produce (${THE_FOUR.join(", ")})`);
  }
  const ids = await labelIds(api);
  const add = ids.get(label);
  if (!add) throw new Error(`label "${label}" could not be resolved or created`);
  const remove = THE_FOUR.filter((n) => n !== label).map((n) => ids.get(n)).filter((v): v is string => !!v);

  await api("POST", `threads/${bareThreadId(threadId)}/modify`, { addLabelIds: [add], removeLabelIds: remove });
}

/**
 * The reply, as RFC 822.
 *
 * `In-Reply-To` AND `References` are both set from the parent: Gmail threads on the
 * former, plenty of clients thread on the latter, and a reply that lands outside its
 * conversation is worse than no draft at all — the client sees an orphan email about a
 * job they are mid-discussion on.
 *
 * Neither is invented when there is no parent. An In-Reply-To pointing at a message id
 * nobody holds is exactly the orphan case the threading rule exists to avoid.
 */
export function draftMime(a: { to: string; from: string; subject: string; html: string; inReplyTo?: string }): string {
  const lines = [
    `To: ${a.to}`,
    `From: ${a.from}`,
    `Subject: ${a.subject}`,
  ];
  if (a.inReplyTo) {
    lines.push(`In-Reply-To: ${a.inReplyTo}`);
    lines.push(`References: ${a.inReplyTo}`);
  }
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push("");
  lines.push(a.html);
  return lines.join("\r\n");
}

/**
 * Create the draft, on the thread it answers.
 *
 * A DRAFT, never a send. Ben's standing position is that the engine composes and a human
 * sends; the settings layer decides whether anything is delivered at all, and this
 * function is not the place that decision gets quietly widened.
 */
export async function createDraft(
  api: GmailApi,
  a: { threadId: string; to: string; from: string; subject: string; html: string; inReplyTo?: string },
): Promise<string | null> {
  const raw = Buffer.from(draftMime(a), "utf8").toString("base64url");
  const res = await api("POST", "drafts", { message: { raw, threadId: bareThreadId(a.threadId) } });
  return res?.id ? String(res.id) : null;
}

/**
 * Take one of the four OFF a thread, adding nothing.
 *
 * `state: "cleared"` on the wire means the reason for a "Needs" tag has gone. It is NOT
 * the same as applying a different label: the thread may legitimately end up wearing
 * none of the four — a conversation that turned out not to be a job at all — and
 * inventing a replacement to fill the gap would be the engine asserting something it has
 * not concluded.
 */
export async function clearThreadLabel(api: GmailApi, threadId: string, label: SpartanLabel): Promise<void> {
  if (!THE_FOUR.includes(label)) {
    throw new Error(`"${label}" is not one of the four labels this system may produce (${THE_FOUR.join(", ")})`);
  }
  const ids = await labelIds(api);
  const id = ids.get(label);
  if (!id) return; // never created, so never worn
  await api("POST", `threads/${bareThreadId(threadId)}/modify`, { addLabelIds: [], removeLabelIds: [id] });
}
