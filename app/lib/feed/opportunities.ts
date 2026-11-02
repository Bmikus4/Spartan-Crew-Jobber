// ============================================================================
// All Opportunities (the owner, 1 Nov): every conversation the bookings inbox holds, one per Gmail thread, with the
// TV's urgent ones inside it rather than beside it.
// ----------------------------------------------------------------------------
// One intake, one projection. The list is built AROUND serveFeed, the TV's own read: every card the TV lists is an
// opportunity here, carried whole, so an urgent job can never be missing from All and never says something else
// there. The rest is every other thread of the same stored mail (thread_messages) with its latest decision, its live
// OnSinch link (R and J, as the TV takes them) and whether it was settled. Nothing here writes: it is a read path of
// the TV's (test/feedReadsOnly.ts).
// The old Jobs Board read the tickets table, which nothing has written since 8 Oct (the old engine was deleted), so
// its list had stopped; this replaces it.
// ============================================================================
import { serveFeed, type FeedDeps } from "./serve";
import type { FeedCard } from "./project";
import { V2_FROM, liveLinks } from "./live";

type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/** What an opportunity is now, from the TV first and the thread's latest decision after. */
export type OppState = "urgent" | "done" | "settled" | "quoted" | "reply" | "info" | "closed" | "undecided";
export type Opportunity = {
  thread_id: string;
  subject: string;
  client: string | null;
  contact: string | null;
  sender: string | null;
  first_at: number;
  last_at: number;
  messages: number;
  replied: boolean;
  r_number: string | null;
  j_number: string | null;
  kind: "new" | "update" | "quote" | null;
  state: OppState;
  dates: string[];
  /** The TV's card for this thread when the TV lists it: the urgent opportunity, exactly as the TV shows it. */
  urgent: FeedCard | null;
  /** The latest decision's reason, in the planner's words. */
  why: string | null;
};

const KIND: Record<string, Opportunity["kind"]> = { booking: "new", change: "update", cancellation: "update", quote_request: "quote" };
const reasonOf = (d: any): string | null => {
  if (!d) return null;
  if (d.kind === "none") return d.reason ?? null;
  if (d.kind === "write") return (d.why ?? [])[0] ?? null;
  return (d.reasons ?? [])[0] ?? null;
};
const daysOf = (g: any): string[] => [...new Set(((g?.requests ?? []) as any[]).flatMap((r) => [r?.date, r?.target?.date]).filter((x): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)))].sort();
const addr = (f: unknown) => String(f ?? "").replace(/.*</, "").replace(/>.*/, "").trim().toLowerCase();

export async function listOpportunities(sql: Sql, deps: FeedDeps, now: number): Promise<{ ok: true; generated_at: string; items: Opportunity[] } | { ok: false }> {
  const tv = await serveFeed({ ...deps, remember: undefined }, now);
  if (tv.status !== 200) return { ok: false };
  const shown = ((tv.body as { items?: FeedCard[] }).items ?? []) as FeedCard[];
  const every = new Map((tv.all ?? []).map((c) => [c.thread_id, c]));
  const shownIds = shown.map((c) => c.thread_id);

  const threads = (await sql`SELECT thread_id, min(date_iso) AS first_at, max(date_iso) AS last_at, count(*)::int AS n,
      (array_agg(subject ORDER BY date_iso DESC))[1] AS subject,
      bool_or(coalesce(is_from_spartan, false)) AS replied,
      (array_agg(from_address ORDER BY date_iso) FILTER (WHERE NOT coalesce(is_from_spartan, false)))[1] AS first_client
    FROM thread_messages GROUP BY thread_id
    HAVING (max(date_iso) >= ${V2_FROM} AND bool_or(NOT coalesce(is_from_spartan, false))) OR thread_id = ANY(${shownIds})`) as any[];
  const ids = threads.map((t) => String(t.thread_id));
  const decisions = new Map(((await sql`SELECT DISTINCT ON (thread_id) thread_id, kind, company, decision, replan, interpretation->'grounded' AS grounded
    FROM v2_decisions WHERE thread_id = ANY(${ids}) AND coalesce(code_version, '') <> 'local' ORDER BY thread_id, sent_at DESC`) as any[]).map((d) => [String(d.thread_id), d]));
  const days = new Map<string, string[]>();
  for (const d of (await sql`SELECT thread_id, interpretation->'grounded' AS g FROM v2_decisions WHERE thread_id = ANY(${ids}) AND coalesce(code_version, '') <> 'local'`) as any[])
    days.set(String(d.thread_id), [...new Set([...(days.get(String(d.thread_id)) ?? []), ...daysOf(d.g)])].sort());
  const links = new Map((await liveLinks()).map((l) => [l.thread_id, l]));
  // An agreed mark is a settlement, or a quote sent and waiting on the client (done.ts quoteSent), told by its words.
  const agreedMarks = (await sql`SELECT thread_id, evidence->>'text' AS text FROM feed_marks WHERE mark = 'agreed' AND thread_id = ANY(${ids})`) as any[];
  const quoted = new Set(agreedMarks.filter((m) => /^Quote sent/.test(String(m.text ?? ""))).map((m) => String(m.thread_id)));
  const settled = new Set(agreedMarks.filter((m) => !/^Quote sent/.test(String(m.text ?? ""))).map((m) => String(m.thread_id)));
  const contacts = new Map(((await sql`SELECT email, name, company_name FROM onsinch_contacts WHERE email = ANY(${threads.map((t) => addr(t.first_client))})`) as any[]).map((c) => [String(c.email), c]));

  const items = new Map<string, Opportunity>();
  for (const t of threads) {
    const id = String(t.thread_id);
    const d = decisions.get(id), card = every.get(id) ?? null, onTv = shown.find((c) => c.thread_id === id) ?? null;
    const answer = d?.replan?.kind ? d.replan : d?.decision;
    const link = links.get(id);
    const sender = addr(t.first_client) || null;
    const contact = sender ? contacts.get(sender) : undefined;
    const state: OppState = onTv ? (onTv.green ? "done" : "urgent")
      : settled.has(id) ? "settled"
      : quoted.has(id) ? "quoted"
      : card?.lane === "reply" ? "reply"
      : card?.green ? "done"
      : !d ? "undecided"
      : answer?.kind === "none" ? "info"
      : card && card.items.every((i) => i.kind === "created-check" || i.kind === "updated-check") ? "done"
      : "closed";
    items.set(id, {
      thread_id: id, subject: String(t.subject ?? ""),
      client: onTv?.company ?? card?.company ?? (contact?.company_name ? String(contact.company_name) : null) ?? (d?.company ? String(d.company) : null),
      contact: onTv?.contact ?? (contact?.name ? String(contact.name) : null), sender,
      first_at: Date.parse(t.first_at) || 0, last_at: Date.parse(t.last_at) || 0, messages: Number(t.n) || 0, replied: !!t.replied,
      r_number: onTv?.r_number ?? (link?.r_number ? `R${String(link.r_number).replace(/^R/i, "")}` : null),
      j_number: onTv?.j_number ?? (link?.job_id ? `J${link.job_id}` : null),
      kind: (onTv ?? card) ? ((onTv ?? card)!.colour === "red" ? "new" : (onTv ?? card)!.colour === "blue" ? "update" : KIND[d?.grounded?.intent] ?? null) : KIND[d?.grounded?.intent] ?? null,
      state, dates: onTv?.dates?.length ? onTv.dates : days.get(id) ?? [], urgent: onTv, why: reasonOf(answer),
    });
  }
  // A card the TV lists whose thread holds no stored message (a tile carried over from the old Jobs Board) is still an
  // opportunity: the TV's card is the record of it.
  for (const c of shown) if (!items.has(c.thread_id)) items.set(c.thread_id, {
    thread_id: c.thread_id, subject: "", client: c.company, contact: c.contact, sender: null, first_at: c.at, last_at: c.at, messages: 0, replied: false,
    r_number: c.r_number, j_number: c.j_number, kind: c.colour === "red" ? "new" : c.colour === "blue" ? "update" : null,
    state: c.green ? "done" : "urgent", dates: c.dates, urgent: c, why: null,
  });
  // The TV's order first, as the TV lists them; then the newest conversation first.
  const rank = new Map(shownIds.map((id, k) => [id, k]));
  const list = [...items.values()].sort((a, b) => (rank.get(a.thread_id) ?? Infinity) - (rank.get(b.thread_id) ?? Infinity) || b.last_at - a.last_at);
  return { ok: true, generated_at: new Date(now).toISOString(), items: list };
}

/** One conversation in full: every message as stored, each email's decision, and the TV's card and marks. */
export async function opportunityDetail(sql: Sql, threadId: string) {
  const messages = ((await sql`SELECT message_id, from_address, to_addresses, cc_addresses, date_iso, subject, body, coalesce(is_from_spartan, false) AS ours, attachment_names
    FROM thread_messages WHERE thread_id = ${threadId} ORDER BY date_iso`) as any[]).map((m) => ({
    message_id: String(m.message_id), from: m.from_address ?? null, to: m.to_addresses ?? [], cc: m.cc_addresses ?? [], at: m.date_iso ?? null,
    subject: m.subject ?? "", body: m.body ?? "", ours: !!m.ours, attachments: Array.isArray(m.attachment_names) ? m.attachment_names : [],
  }));
  const decisions = ((await sql`SELECT message_id, sent_at, kind, decision, replan, interpretation->'grounded' AS grounded FROM v2_decisions
    WHERE thread_id = ${threadId} AND coalesce(code_version, '') <> 'local' ORDER BY sent_at`) as any[]).map((d) => {
    const answer = d.replan?.kind ? d.replan : d.decision;
    return {
      message_id: String(d.message_id), kind: answer?.kind ?? d.kind, code: answer?.code ?? null, intent: d.grounded?.intent ?? null,
      reasons: answer?.kind === "write" ? answer.why ?? [] : answer?.kind === "none" ? [answer.reason].filter(Boolean) : answer?.reasons ?? [],
      requests: ((d.grounded?.requests ?? []) as any[]).map((r) => ({ action: r.action, date: r.date ?? r.target?.date ?? null, start: r.start ?? null, end: r.end ?? null, crew: r.crew ?? null, venue: r.venue ?? null, history: !!r.history })),
    };
  });
  const marks = ((await sql`SELECT mark, by, evidence, at FROM feed_marks WHERE thread_id = ${threadId} AND mark IN ('done', 'possibly', 'agreed', 'checked', 'resolved') ORDER BY at`) as any[])
    .map((m) => ({ mark: String(m.mark), by: m.by ?? null, text: (m.evidence as { text?: string } | null)?.text ?? null, at: m.at }));
  return { messages, decisions, marks };
}
