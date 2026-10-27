// ============================================================================
// THE LIVE TRACE (addendum 5.2, R11): each decided email's steps, as harness/DATA_POLICY.md's live mode sets out.
// ----------------------------------------------------------------------------
// One row per step (filter, extract, ground, plan, run, final) in v2_trace, so a weekly miss shows which step
// chose wrong. No email text is ever handed to a trace: process.ts sends counts, kinds, codes, reasons and the
// reader's quoted words. An email address inside any of them is replaced by its salted SHA-256
// (SPARTAN_TRACE_SALT), or by "[address]" when no salt is set. Rows are kept TRACE_DAYS (pruneTrace, from the
// minute sync). A row that cannot be written is dropped and counted: a trace never blocks or changes how an
// email is handled. SPARTAN_TRACE=off stops it.
// ============================================================================
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { createHash } from "node:crypto";
import { tracer, type Tracer, type TraceEvent } from "./trace";
import { ensureSchema } from "../migrations";

type Sql = NeonQueryFunction<false, false>;
export const TRACE_DAYS = 90;
const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const traceOn = (flag: string | undefined = process.env.SPARTAN_TRACE) => (flag || "").trim().toLowerCase() !== "off";

/** The value with every email address hashed, at any depth. */
export function scrub(v: unknown, salt: string | undefined = process.env.SPARTAN_TRACE_SALT?.trim()): unknown {
  if (typeof v === "string") return v.replace(ADDRESS, (a) => (salt ? `addr:${createHash("sha256").update(salt + a.toLowerCase()).digest("hex").slice(0, 16)}` : "[address]"));
  if (Array.isArray(v)) return v.map((x) => scrub(x, salt));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, salt)]));
  return v;
}

export type LiveTracer = Tracer & { flush: () => Promise<void>; failures: () => number };

/**
 * One email's tracer. Events are held and written by `flush`, once the decision is made: a serverless function
 * can end before a fire-and-forget write lands, and the re-plan writes only an answer that changed.
 */
export function liveTracer(sql: Sql, message_id: string, source: "intake" | "replan"): LiveTracer {
  const held: TraceEvent[] = [];
  const t = tracer((e) => { if (traceOn()) held.push(e); }, { trace_id: message_id, run_mode: "live" });
  let failed = 0;
  const sinkFailures = t.failures;
  return Object.assign(t, {
    failures: () => failed + sinkFailures(),
    flush: async () => {
      const rows = held.splice(0);
      if (!rows.length) return;
      try {
        await ensureSchema(sql);
        for (const e of rows) {
          await sql`INSERT INTO v2_trace (trace_id, source, component, at, ms, data)
            VALUES (${e.trace_id}, ${source}, ${e.component}, ${e.at}, ${e.ms ?? null}, ${JSON.stringify(scrub(e.data))}::jsonb)`;
        }
      } catch {
        failed += rows.length;
      }
    },
  });
}

/** Rows older than TRACE_DAYS go: the data policy's retention. */
export async function pruneTrace(sql: Sql): Promise<{ deleted: number }> {
  await ensureSchema(sql);
  const rows = (await sql`DELETE FROM v2_trace WHERE at < now() - (${TRACE_DAYS} || ' days')::interval RETURNING 1`) as unknown[];
  return { deleted: rows.length };
}
