// Neon-backed metric_events store — same pattern as the House of Hud dashboard:
// one append-only table, writes are fire-and-soft (a telemetry failure must never
// break a reply draft or an order). Implements the engine's MetricSink so the
// pipeline can emit straight into Postgres, and exposes a read-model summary the
// dashboard aggregates. Event vocabulary is the engine's MetricType.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { MetricEvent, MetricSink, MetricType } from "./engine/metrics";
import { aggregate, type DashboardStats } from "./engine/metrics";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_DATABASE_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    ""
  ).trim();
}

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

export function metricsDbEnabled(): boolean {
  return !!connString();
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS metric_events (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      thread_id TEXT,
      meta JSONB
    )`;
  await sql`CREATE INDEX IF NOT EXISTS metric_events_kind_ts ON metric_events (kind, ts)`;
  _ready = true;
}

// A MetricSink the pipeline emits into. Never throws.
export class NeonMetrics implements MetricSink {
  async emit(e: MetricEvent): Promise<void> {
    const sql = db();
    if (!sql) return;
    try {
      await ensure(sql);
      await sql`INSERT INTO metric_events (kind, thread_id, meta) VALUES (${e.type}, ${e.thread_id}, ${JSON.stringify(e.meta ?? {})})`;
    } catch (err) {
      console.error("[metrics] emit failed", e.type, err);
    }
  }
  async all(): Promise<MetricEvent[]> {
    const sql = db();
    if (!sql) return [];
    try {
      await ensure(sql);
      const rows = (await sql`SELECT kind, thread_id, extract(epoch from ts)*1000 AS ts, meta FROM metric_events ORDER BY ts`) as {
        kind: string; thread_id: string; ts: number; meta: Record<string, unknown>;
      }[];
      return rows.map((r) => ({ type: r.kind as MetricType, thread_id: r.thread_id, ts: Number(r.ts), meta: r.meta }));
    } catch {
      return [];
    }
  }
}

const FUNNEL_KINDS: MetricType[] = [
  "email_received", "job_detected", "reply_drafted",
  "order_proposed", "order_created", "order_updated",
];

export interface MetricsSummary extends DashboardStats {
  enabled: boolean;
  days: number;
  hours_saved: number;
  series: { date: string; [k: string]: number | string }[];
  firstEventAt: string | null;
  lastEventAt: string | null;
}

const MINUTES_SAVED_PER_EMAIL = 6; // conservative; surfaced on the dashboard

// Aggregate the last `days` days into the dashboard read-model.
export async function metricsSummary(days = 90): Promise<MetricsSummary> {
  const base: MetricsSummary = {
    ...aggregate([]),
    enabled: metricsDbEnabled(),
    days,
    hours_saved: 0,
    series: [],
    firstEventAt: null,
    lastEventAt: null,
  };
  const sql = db();
  if (!sql) return base;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT kind, thread_id, extract(epoch from ts)*1000 AS ts, meta
      FROM metric_events
      WHERE ts >= now() - (${days} || ' days')::interval
      ORDER BY ts`) as { kind: string; thread_id: string; ts: number; meta: Record<string, unknown> }[];
    const events: MetricEvent[] = rows.map((r) => ({ type: r.kind as MetricType, thread_id: r.thread_id, ts: Number(r.ts), meta: r.meta }));

    const stats = aggregate(events);
    const bounds = (await sql`SELECT min(ts) AS first, max(ts) AS last FROM metric_events`) as { first: string | null; last: string | null }[];

    // zero-filled daily series for the funnel kinds
    const byDay = new Map<string, Record<string, number>>();
    for (const e of events) {
      const day = new Date(e.ts).toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? {};
      cur[e.type] = (cur[e.type] ?? 0) + 1;
      byDay.set(day, cur);
    }
    const series: MetricsSummary["series"] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const key = d.toISOString().slice(0, 10);
      const v = byDay.get(key) ?? {};
      const row: { date: string; [k: string]: number | string } = { date: key };
      for (const k of FUNNEL_KINDS) row[k] = v[k] ?? 0;
      series.push(row);
    }

    return {
      ...stats,
      enabled: true,
      days,
      hours_saved: Math.round((stats.emails_received * MINUTES_SAVED_PER_EMAIL) / 6) / 10,
      series,
      firstEventAt: bounds[0]?.first ?? null,
      lastEventAt: bounds[0]?.last ?? null,
    };
  } catch (err) {
    console.error("[metrics] summary failed", err);
    return base;
  }
}
