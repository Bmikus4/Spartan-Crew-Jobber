// ============================================================================
// The feed's verifier: evidence that a person dealt with an item, read from OnSinch.
// ----------------------------------------------------------------------------
// GETs ONLY, and structurally so: every call goes through readOnly(), which refuses any
// other method before it reaches the network (test/feedReadsOnly.ts). The engine's own
// writes are real and this must never be able to make one.
//
// Three sources, cheapest first:
//   (a) the timeline log. It records every STAFF edit field by field and never the
//       API's (0 of 2,901 rows in 32 hours, 2026-10-03), so each row is a person. It is
//       sorted oldest-first, so the newest rows are on the LAST page.
//   (b) the engine's own order matcher, for a needed order somebody may have raised by
//       hand. Measured 2026-10-03 it finds 1 of 28; the tick carries the rest.
//   (c) the nested read's modifier/modified stamps, only when (a) cannot be read.
//
// The sweep's "holds" is NOT evidence: straight after a write OnSinch always matches what
// the engine wrote, so it would turn every check green the moment it appeared.
// ============================================================================
import { OnsinchClient, type Transport } from "../engine/onsinch";
import { matchExistingOrder, type OrderRec } from "../engine/resolve";
import { staffChangeSince } from "../engine/reconcile";
import type { FeedCard, FeedItem, FeedMark } from "./project";

export const VERIFY_EVERY_MS = 5 * 60_000;
export const VERIFY_BUDGET_MS = 8_000;
/** Pages read back per round. ~90 staff rows an hour, 100 to a page. */
const MAX_PAGES = 6;

export function readOnly(t: Transport): Transport {
  return (method, path) =>
    method === "GET" ? t("GET", path) : Promise.reject(new Error(`the live feed is read-only: refused ${method} ${path}`));
}

export interface VerifyDeps {
  transport: Transport;
  claim(everyMs: number): Promise<{ timeline_last_id: number | null } | null>;
  save(timeline_last_id: number | null, note: string): Promise<void>;
  addMark(m: Omit<FeedMark, "at">): Promise<void>;
}

/**
 * The fields that change what crew turn up where and when, or what the client is billed
 * against. Slot.group_number, Slot.Tag, Slot.hidden, Attendance.Tag and the description
 * fields move constantly and mean nothing about the order being right.
 */
const DECISION: Record<string, string> = {
  "Order.intern_name": "PO", "Order.name": "order name", "Order.happening": "date",
  "SlotTeam.name": "block",
  "Slot.size": "crew", "Slot.beginning": "start", "Slot.end": "end", "Slot.profession_id": "role", "Slot.cancelled": "cancelled",
};

interface TimelineRow { id: number; action: string; data: string | Record<string, unknown>; creator: number | string; created: string }
interface Change { at: number; creator: number; text: string; model: string; ref: string; order_api_id?: number }

const hhmm = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" }).format(ms);
function show(v: unknown): string {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && Number.isFinite(Date.parse(s))) return hhmm(Date.parse(s));
  return s.length > 24 ? s.slice(0, 23) + "…" : s || "blank";
}

/** One timeline row as a change worth reporting, or null. */
export function changeOf(row: TimelineRow, engine: number | null): Change | null {
  const creator = Number(row.creator);
  if (engine && creator === engine) return null;
  const at = Date.parse(row.created);
  if (!Number.isFinite(at)) return null;
  let d: any;
  try { d = typeof row.data === "string" ? JSON.parse(row.data) : row.data; } catch { return null; }
  if (row.action === "common_change") {
    const diff = d?.diffChanges?.[d?.model] ?? {};
    const parts = Object.entries(diff)
      .filter(([f]) => DECISION[`${d.model}.${f}`])
      .map(([f, v]: [string, any]) => `${DECISION[`${d.model}.${f}`]} ${show(v?.old)} → ${show(v?.new)}`);
    if (!parts.length) return null;
    return { at, creator, text: parts.join(", "), model: String(d.model), ref: String(d.id) };
  }
  // A block or a position ADDED by hand carries its order in its path.
  if (row.action === "common_create" && (d?.model === "Slot" || d?.model === "SlotTeam")) {
    const owner = /^Order:(\d+)/.exec(String(d?.data?.path ?? "").replace(/\\\//g, "/"));
    if (!owner) return null;
    return { at, creator, text: d.model === "Slot" ? "crew added" : "block added", model: String(d.model), ref: String(d.id), order_api_id: Number(owner[1]) };
  }
  return null;
}

/** The order item on a card that is still open and could be verified, or null. */
/** The open need on a card that evidence could close, or null. An engine write is done already. */
function openOrderItem(c: FeedCard): FeedItem | null {
  const it = c.items.find((i) => i.kind === "needs-created" || i.kind === "needs-updated");
  return it && !it.green ? it : null;
}

/** staffChangeSince's sentence as evidence: what was touched, and the latest stamp. */
function stampChange(who: string): Change {
  const parts = who.split("; ").map((p) => /^(.*) by user (\d+) at (\S+)$/.exec(p)).filter((m): m is RegExpExecArray => !!m);
  const at = Math.max(...parts.map((m) => Date.parse(m[3] + ":00Z")).filter(Number.isFinite), 0);
  const what = [...new Set(parts.map((m) => m[1].replace(/^the /, "").replace(/^block \d+$/, "a block")))].join(", ");
  const last = parts.find((m) => Date.parse(m[3] + ":00Z") === at);
  return { at, creator: Number(last?.[2]) || 0, text: `${what || "the order"} edited after the client's email`, model: "Order", ref: "" };
}

type Nested = { teams: Set<string>; slots: Set<string>; raw: any };
const nestedCache = new Map<number, { at: number; v: Nested | null }>();
async function nested(client: OnsinchClient, order_id: number, now: number): Promise<Nested | null> {
  const hit = nestedCache.get(order_id);
  if (hit && now - hit.at < 10 * 60_000) return hit.v;
  const o = await client.orderWithBlocks(order_id);
  const v: Nested | null = o ? { teams: new Set(), slots: new Set(), raw: o } : null;
  for (const job of o?.Job ?? []) for (const team of job?.SlotTeam ?? []) {
    v!.teams.add(String(team?.id));
    for (const s of team?.Slot ?? []) v!.slots.add(String(s?.id));
  }
  nestedCache.set(order_id, { at: now, v });
  return v;
}
export function __resetVerifyCache(): void { nestedCache.clear(); engineId = undefined; }

let engineId: Promise<number | null> | undefined;
function engineUser(t: Transport): Promise<number | null> {
  engineId ??= t("GET", "/users/profile").then((r) => {
    const d = r?.data?.data ?? r?.data;
    const id = Number(Array.isArray(d) ? d[0]?.id : d?.id);
    return id > 0 ? id : null;
  }, () => null);
  return engineId;
}

export async function verify(cards: FeedCard[], now: number, deps: VerifyDeps, marks: FeedMark[] = [], budgetMs = VERIFY_BUDGET_MS): Promise<{ ran: boolean; wrote: number; note: string }> {
  const claim = await deps.claim(VERIFY_EVERY_MS);
  if (!claim) return { ran: false, wrote: 0, note: "not due" };
  const deadline = Date.now() + budgetMs;
  const t = readOnly(deps.transport);
  const client = new OnsinchClient(t);
  const engine = await engineUser(t);
  let wrote = 0;
  const notes: string[] = [];

  const blue = cards.filter((c) => c.order_id && openOrderItem(c) && openOrderItem(c)!.kind !== "needs-created");
  const found = new Map<FeedCard, Change[]>();

  // (a) the timeline, newest page back to the cursor
  let cursor = claim.timeline_last_id;
  let timelineOk = true;
  try {
    const first = await t("GET", "/timelineAudits?limit=100&page=1");
    const pageCount = Number(first?.data?.pagination?.pageCount);
    if (first.status >= 400 || !Number.isInteger(pageCount) || pageCount < 1) throw new Error(`timeline ${first.status}`);
    const rows: TimelineRow[] = [];
    for (let p = pageCount, n = 0; p >= 1 && n < (cursor ? MAX_PAGES : 2) && Date.now() < deadline; p--, n++) {
      const r = p === 1 ? first : await t("GET", `/timelineAudits?limit=100&page=${p}`);
      if (r.status >= 400) throw new Error(`timeline page ${p}: ${r.status}`);
      const page = (r.data?.data ?? []) as TimelineRow[];
      rows.push(...page);
      if (!cursor || page.some((x) => Number(x.id) <= cursor!)) break;
    }
    const fresh = rows.filter((r) => !cursor || Number(r.id) > cursor);
    const changes = fresh.map((r) => changeOf(r, engine)).filter((c): c is Change => !!c);

    // Order rows name the R number, Job rows the J number, a create its api order id;
    // a Slot or SlotTeam row names only itself, so those need the order's own blocks.
    const needsNested = changes.some((c) => (c.model === "Slot" || c.model === "SlotTeam") && !c.order_api_id);
    for (const card of blue) {
      const item = openOrderItem(card)!;
      let n: Nested | null = null;
      if (needsNested && Date.now() < deadline) n = await nested(client, card.order_id!, now).catch(() => null);
      const mine = changes.filter((c) => c.at > item.at && (
        (c.model === "Order" && card.r_number === `R${c.ref}`) ||
        (c.model === "Job" && card.j_number === `J${c.ref}`) ||
        (c.order_api_id !== undefined && c.order_api_id === card.order_id) ||
        (c.order_api_id === undefined && c.model === "SlotTeam" && !!n?.teams.has(c.ref)) ||
        (c.order_api_id === undefined && c.model === "Slot" && !!n?.slots.has(c.ref))));
      if (mine.length) found.set(card, mine);
    }
    const newest = rows.reduce((m, r) => Math.max(m, Number(r.id) || 0), cursor ?? 0);
    cursor = newest || cursor;
    notes.push(`timeline: ${fresh.length} new rows, ${changes.length} staff changes`);
  } catch (err) {
    timelineOk = false;
    notes.push(`timeline unreadable (${String((err as Error)?.message ?? err).slice(0, 80)}), used order stamps`);
  }

  /**
   * (c) The stamps on the order itself. Every open item gets this ONCE, for its history:
   * the timeline cursor only sees edits from the day it was first set (2026-10-03), and
   * 13 of 17 open updates on 2026-10-04 had been edited by staff before that. When the
   * timeline cannot be read, every item gets it every round instead.
   */
  const historyDone = new Set(marks.filter((m) => m.mark === "history").map((m) => m.item_key));
  const historyRead: FeedCard[] = [];
  if (engine) {
    for (const card of blue) {
      const item = openOrderItem(card)!;
      if (found.has(card) || (timelineOk && historyDone.has(item.item_key))) continue;
      if (Date.now() >= deadline) { notes.push("history check stopped at the time budget"); break; }
      const n = await nested(client, card.order_id!, now).catch(() => null);
      if (!n) continue;
      const who = staffChangeSince(n.raw, item.at, engine);
      if (who) found.set(card, [stampChange(who)]);
      if (timelineOk) historyRead.push(card);
    }
  }

  for (const [card, ch] of found) {
    const item = openOrderItem(card)!;
    const latest = ch.reduce((a, b) => (b.at > a.at ? b : a));
    await deps.addMark({
      item_key: item.item_key, thread_id: card.thread_id, mark: "staff-edit", by: null,
      evidence: { text: [...new Set(ch.map((c) => c.text))].slice(0, 3).join(", "), at: new Date(latest.at).toISOString(), creator: latest.creator || null },
    });
    wrote++;
  }

  for (const card of historyRead) {
    const item = openOrderItem(card)!;
    await deps.addMark({ item_key: item.item_key, thread_id: card.thread_id, mark: "history", by: null, evidence: null });
  }

  // (b) a needed order somebody raised by hand
  let matched = 0;
  for (const card of cards) {
    const item = openOrderItem(card);
    if (!item || item.kind !== "needs-created" || !card.company_id || !card.dates.length) continue;
    if (Date.now() >= deadline) { notes.push("matcher stopped at the time budget"); break; }
    try {
      const orders = (await client.companyOrdersWithJob(card.company_id)) as OrderRec[];
      const m = matchExistingOrder(card.dates[0], orders, { days: card.dates, location_text: card.venue ?? undefined });
      if (m && "order_id" in m) {
        await deps.addMark({
          item_key: item.item_key, thread_id: card.thread_id, mark: "order-found", by: null,
          evidence: { text: `order ${m.order_number ? `R${m.order_number}` : `#${m.order_id}`} is in OnSinch`, order_id: m.order_id, r_number: m.order_number ?? null },
        });
        wrote++; matched++;
      }
    } catch (err) {
      notes.push(`matcher: ${String((err as Error)?.message ?? err).slice(0, 60)}`);
    }
  }
  notes.push(`${found.size} staff-edited, ${matched} found`);

  const note = notes.join("; ");
  await deps.save(timelineOk ? cursor : null, note);
  return { ran: true, wrote, note };
}
