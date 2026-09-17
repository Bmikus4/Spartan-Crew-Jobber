// ============================================================================
// WHICH MAIL IS NEW — asked with a cursor, never subscribed to as a stream.
// ----------------------------------------------------------------------------
// Ben's rule after the OAuth outages: "use a cursor not a stream". A watch/push
// subscription expires and needs renewing, and when it lapses nothing announces it —
// mail just stops, which is exactly how 42 hours passed with every dashboard green.
//
// A cursor has none of that shape. It is a number on disk. Nothing expires, nothing
// renews, and a run that does not happen makes the next run bigger rather than making
// the mail disappear. The only real complication is that Gmail itself forgets history
// after roughly a week, and this file's job is to make that a non-event.
//
// THE SAFETY DIRECTION IS FIXED: at-least-once, never at-most-once. A message delivered
// twice is deduped downstream on its RFC Message-ID and costs nothing; a message skipped
// is an enquiry nobody ever sees. Every judgement call here leans that way — the overlap
// on re-anchor, holding the cursor when unsure, and the caller advancing it only after
// the work is done.
// ============================================================================

/** A GET against `gmail/v1/users/me/`, resolving to parsed JSON and throwing `{status}` on failure. */
export type GmailGet = (path: string) => Promise<any>;

export interface FetchSinceResult {
  /** New message ids, oldest first, deduped. */
  messageIds: string[];
  /**
   * The cursor to store — but ONLY once the caller has finished with messageIds.
   * Advancing it first turns a crash mid-batch into mail nobody will ever look at again.
   */
  nextCursor: string;
  /** True when the cursor was expired or absent and the window was rebuilt by date. */
  reanchored: boolean;
}

/**
 * How far back a re-anchor reaches.
 *
 * Deliberately longer than the poll interval by a wide margin. Re-reading a day costs a
 * handful of deduped rows; missing an hour costs a booking. Gmail's `newer_than` is the
 * cheapest bounded query it offers, and bounded is the point — a first deploy must not
 * replay twelve months of archive through the engine.
 */
const REANCHOR_WINDOW = process.env.GMAIL_REANCHOR_WINDOW || "1d";

/** Gmail history ids are 64-bit and arrive as strings; comparing them as numbers loses precision. */
function higher(a: string, b: string): string {
  const [x, y] = [String(a || "0"), String(b || "0")];
  if (x.length !== y.length) return x.length > y.length ? x : y;
  return x >= y ? x : y;
}

/**
 * Everything added since `cursor`, and the cursor to store next.
 *
 * `cursor` null means "we have never run" — anchored by date rather than from the
 * beginning of the mailbox, because the beginning of the mailbox is twelve months of
 * history and every one of those threads would be handed to the engine as if new.
 */
export async function fetchSince(opts: { gmail: GmailGet; cursor: string | null }): Promise<FetchSinceResult> {
  const { gmail, cursor } = opts;

  if (cursor) {
    try {
      return await walkHistory(gmail, cursor);
    } catch (err) {
      // 404 is Gmail saying the historyId is older than it keeps, which follows any quiet
      // week. It is the documented behaviour, not a fault, and the only wrong response is
      // to stop. Anything else is a real error and must not be swallowed into a re-anchor
      // that silently re-reads the same day forever.
      if ((err as { status?: number })?.status !== 404) throw err;
    }
  }
  return reanchor(gmail);
}

async function walkHistory(gmail: GmailGet, cursor: string): Promise<FetchSinceResult> {
  const ids: string[] = [];
  const seen = new Set<string>();
  let pageToken = "";
  let latest = cursor;

  // Followed to the end rather than taking page one. history.list truncates, and on a
  // busy morning the truncated half is the OLDEST unprocessed mail — the enquiries that
  // have already been waiting longest.
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ startHistoryId: cursor, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await gmail(`history?${q.toString()}`);

    for (const h of res?.history ?? []) {
      for (const added of h?.messagesAdded ?? []) {
        const id = added?.message?.id;
        if (id && !seen.has(id)) { seen.add(id); ids.push(String(id)); }
      }
    }
    if (res?.historyId) latest = higher(latest, String(res.historyId));
    pageToken = res?.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return { messageIds: ids, nextCursor: latest, reanchored: false };
}

/**
 * Rebuild the window by date, and take a fresh cursor from the profile.
 *
 * The cursor comes from `getProfile` rather than from the messages, because the newest
 * message's history id says nothing about history records that carry no message. Reading
 * it from the profile means the next tick starts exactly where this one stopped looking.
 */
async function reanchor(gmail: GmailGet): Promise<FetchSinceResult> {
  const q = new URLSearchParams({ q: `newer_than:${REANCHOR_WINDOW}`, maxResults: "500" });
  const listed = await gmail(`messages?${q.toString()}`);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of listed?.messages ?? []) {
    const id = m?.id;
    if (id && !seen.has(id)) { seen.add(id); ids.push(String(id)); }
  }
  const profile = await gmail("profile");
  return { messageIds: ids, nextCursor: String(profile?.historyId ?? "0"), reanchored: true };
}
