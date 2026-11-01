// ============================================================================
// The TV's list as it stood, kept so the team can look back at it (the owner, 1 Nov: "there should be a history
// button which lets the team view the list from different times in history").
// ----------------------------------------------------------------------------
// The minute sync's cards step builds the TV anyway; it hands the list here. A list is kept when it differs from the
// last one kept and 15 minutes have passed since, so a list that stood still for a day is one row, and the list at any
// moment is the newest row at or before it. 30 days are kept. Nothing here reads OnSinch or the clock.
// ============================================================================
import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { ensureSchema } from "../migrations";
import type { FeedCard } from "./project";

type Sql = NeonQueryFunction<false, false>;
export const HISTORY_EVERY_MS = 15 * 60_000;
export const HISTORY_KEEP_DAYS = 30;
export type Kept = { at: string; items: FeedCard[]; counts: Record<string, number> };

/** What makes two lists the same list: each card's items, done or not, days and what it asks. */
const digestOf = (items: FeedCard[]) => createHash("sha256").update(JSON.stringify(items.map((c) => [c.thread_id, c.green, c.dates, c.check, c.ask, c.items.map((i) => [i.item_key, !!i.green])]))).digest("hex").slice(0, 16);

export async function keepList(sql: Sql, body: { items?: unknown; counts?: unknown }, now: number): Promise<"kept" | "same" | "too soon"> {
  await ensureSchema(sql);
  const items = (body.items ?? []) as FeedCard[];
  const digest = digestOf(items);
  const last = ((await sql`SELECT at, digest FROM feed_history ORDER BY at DESC LIMIT 1`) as Array<{ at: string; digest: string }>)[0];
  if (last && last.digest === digest) return "same";
  if (last && now - Date.parse(new Date(last.at).toISOString()) < HISTORY_EVERY_MS) return "too soon";
  const at = new Date(now).toISOString();
  await sql`INSERT INTO feed_history (at, digest, body) VALUES (${at}::timestamptz, ${digest}, ${JSON.stringify({ items, counts: body.counts ?? {} })}::jsonb) ON CONFLICT (at) DO NOTHING`;
  await sql`DELETE FROM feed_history WHERE at < ${new Date(now - HISTORY_KEEP_DAYS * 864e5).toISOString()}::timestamptz`;
  return "kept";
}

/** Every moment a list was kept, oldest first. */
export async function keptTimes(sql: Sql): Promise<string[]> {
  await ensureSchema(sql);
  return ((await sql`SELECT at FROM feed_history ORDER BY at`) as Array<{ at: string }>).map((r) => new Date(r.at).toISOString());
}

/** The list as it stood at `at`: the newest kept at or before it, or null before the first. */
export async function listAt(sql: Sql, at: number): Promise<Kept | null> {
  await ensureSchema(sql);
  const r = ((await sql`SELECT at, body FROM feed_history WHERE at <= ${new Date(at).toISOString()}::timestamptz ORDER BY at DESC LIMIT 1`) as Array<{ at: string; body: any }>)[0];
  return r ? { at: new Date(r.at).toISOString(), items: r.body?.items ?? [], counts: r.body?.counts ?? {} } : null;
}
