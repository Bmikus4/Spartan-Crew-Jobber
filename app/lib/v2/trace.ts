// ============================================================================
// One trace schema for the harness and for live traffic: the same events from the same code,
// with only the sink and the mode differing. A trace lets one email's whole path (filter,
// read, ground, plan, each write, final state) be rebuilt after the fact.
// ----------------------------------------------------------------------------
// A TRACE NEVER CHANGES OR BLOCKS AN EMAIL'S HANDLING. A sink that throws is swallowed and
// counted; the decision goes on. Live collection is wired but OFF (no live sink is passed
// in production) until the operator says "enable live" (harness/DATA_POLICY.md).
// ============================================================================

export type TraceComponent = "filter" | "extract" | "ground" | "plan" | "run" | "final";

export type TraceEvent = {
  trace_id: string;
  run_mode: "test" | "live";
  case_id?: string;
  component: TraceComponent;
  at: string;
  /** Milliseconds this step took. */
  ms?: number;
  data: Record<string, unknown>;
};

export type Tracer = (component: TraceComponent, data: Record<string, unknown>, ms?: number) => void;

export function tracer(sink: (e: TraceEvent) => void, base: { trace_id: string; run_mode: "test" | "live"; case_id?: string }): Tracer & { failures: () => number } {
  let failures = 0;
  const t = ((component, data, ms) => {
    try {
      sink({ ...base, component, at: new Date().toISOString(), ...(ms === undefined ? {} : { ms }), data });
    } catch {
      failures++;
    }
  }) as Tracer & { failures: () => number };
  t.failures = () => failures;
  return t;
}

/** Production until live collection is enabled: nothing is written anywhere. */
export const noTrace: Tracer = () => {};
