// ============================================================================
// metrics — append-only event log feeding the dashboard, mirroring the House
// of Hud dashboard pattern (Neon Postgres `metric_events`, UI-only aggregation).
//
// Every stage of the pipeline emits one event. The dashboard NEVER computes
// from live OnSinch/Gmail — it reads/aggregates this table only. Back it with
// Postgres in production; an in-memory sink is provided for the prototype.
// ============================================================================

/** One event per meaningful pipeline transition. */
export type MetricType =
  // funnel
  | "email_received"        // an inbound message entered the pipeline
  | "thread_processed"      // a full thread was compiled
  | "filtered_out"          // classified not-a-job / spam -> no action
  | "job_detected"          // classified new-job or update
  | "reply_drafted"         // a reply draft was created
  | "order_proposed"        // draft-only: order staged for human confirm
  | "order_confirmed"       // a human approved a staged order
  | "order_created"         // an OnSinch order was created
  | "order_updated"         // an OnSinch order was patched
  // quality
  | "needs_human"           // held back by the confidence gate
  | "order_error";          // OnSinch write failed (e.g. 400)

export interface MetricEvent {
  ts: number;
  thread_id: string;
  type: MetricType;
  meta?: Record<string, unknown>; // e.g. {priority, size, match_pct, error}
}

export interface MetricSink {
  emit(e: MetricEvent): Promise<void>;
  all(): Promise<MetricEvent[]>;
}

export class InMemoryMetrics implements MetricSink {
  private events: MetricEvent[] = [];
  async emit(e: MetricEvent) {
    this.events.push(e);
  }
  async all() {
    return [...this.events];
  }
}

/** The aggregate the dashboard renders. Everything derived from the log. */
export interface DashboardStats {
  emails_received: number;
  threads_processed: number;
  filtered_out: number;
  job_requests: number;
  replies_drafted: number;
  orders_proposed: number;      // staged, awaiting confirm (draft-only)
  awaiting_confirmation: number; // proposed but not yet confirmed
  orders_created: number;
  orders_updated: number;
  needs_human: number;
  order_errors: number;
  // headline impact tiles (HoH-style)
  hands_free_rate: number;   // orders auto-completed / job requests
  hours_saved: number;       // estimate: minutes_per_email * emails / 60
  clients_served: number;    // distinct threads that produced an order
}

const MINUTES_SAVED_PER_EMAIL = 6; // tune against the email study

export function aggregate(events: MetricEvent[]): DashboardStats {
  const count = (t: MetricType) => events.filter((e) => e.type === t).length;
  const emails_received = count("email_received");
  const job_requests = count("job_detected");
  const orders_created = count("order_created");
  const orders_updated = count("order_updated");
  const orders_proposed = count("order_proposed");
  const orders_confirmed = count("order_confirmed");
  const needs_human = count("needs_human");
  const clientsSet = new Set(
    events.filter((e) => e.type === "order_created").map((e) => e.thread_id)
  );
  return {
    emails_received,
    threads_processed: count("thread_processed"),
    filtered_out: count("filtered_out"),
    job_requests,
    replies_drafted: count("reply_drafted"),
    orders_proposed,
    awaiting_confirmation: Math.max(0, orders_proposed - orders_confirmed),
    orders_created,
    orders_updated,
    needs_human,
    order_errors: count("order_error"),
    hands_free_rate: job_requests
      ? Math.round(((job_requests - needs_human) / job_requests) * 100)
      : 0,
    hours_saved: Math.round((emails_received * MINUTES_SAVED_PER_EMAIL) / 60),
    clients_served: clientsSet.size,
  };
}
