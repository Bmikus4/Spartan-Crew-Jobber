// ============================================================================
// Runs one simulated email through production's decideMessage, with this adapter's fakes at
// every boundary: a fake OnSinch (FakeWorld), a runner that records operations instead of
// driving the browser, a recorder (or the oracle) in place of the live model call.
// ============================================================================
import { decideMessage, type Recorded, type DecideDeps } from "../../../app/lib/v2/process";
import { opKey, type Op } from "../../../app/lib/v2/bot/ops";
import { extractWithMeta, interpretModel, PROMPT_ID, userPrompt } from "../../../app/lib/v2/interpret/extract";
import { tracer, type TraceEvent } from "../../../app/lib/v2/trace";
import { Recorder } from "../../core/recorder";
import type { CaseResult } from "../../core/types";
import { FakeWorld } from "./world";
import { score, said, type Outcome } from "./score";
import type { SpartanCase } from "./generate";

type ExtractFn = DecideDeps["extract"];
type Extracted = Awaited<ReturnType<ExtractFn>>;

/** The perfect reader: the case's own ground-truth reading. Validates everything after the model, for free. */
export const oracleExtract = (c: SpartanCase): ExtractFn => async () => ({
  x: structuredClone(c.input.oracle),
  meta: { model: "oracle", prompt_id: PROMPT_ID, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 },
});

/**
 * A control: the oracle with every date read one day late, quote unchanged. A sound pipeline
 * turns that into "a person must act", never into a write on the wrong day.
 */
export const mutantExtract = (c: SpartanCase): ExtractFn => async () => {
  const x = structuredClone(c.input.oracle);
  const late = (d: { value: string; quote: string } | null) => (d ? { ...d, value: new Date(Date.parse(`${d.value}T12:00:00Z`) + 864e5).toISOString().slice(0, 10) } : d);
  for (const r of x.requests) { r.date = late(r.date); if (r.target) r.target.date = late(r.target.date); }
  return { x, meta: { model: "mutant: dates one day late", prompt_id: PROMPT_ID, input_tokens: 0, output_tokens: 0, cost_usd: 0, ms: 0 } };
};

/** The production model through the recorder: a known request replays, a new one is recorded within the cap. */
export const recordedExtract = (rec: Recorder<Extracted>): ExtractFn => (sentIso, from, subject, newest) =>
  rec.call(Recorder.key([interpretModel(), PROMPT_ID, userPrompt(sentIso, from, subject, newest)]), () => extractWithMeta(sentIso, from, subject, newest), (v) => v.meta.cost_usd ?? 0.03);

export async function runCase(c: SpartanCase, extract: ExtractFn): Promise<{ result: CaseResult; out: Outcome; trace: TraceEvent[] }> {
  const trace: TraceEvent[] = [];
  const written: Op[] = [], keys: string[] = [];
  let recorded: Recorded | null = null;
  let error: string | null = null;
  let modelMs = 0;
  const t = tracer((e) => { trace.push(e); if (e.component === "extract") modelMs = Number(e.ms ?? 0); }, { trace_id: c.id, run_mode: "test", case_id: c.id });
  const t0 = Date.now();
  try {
    await decideMessage(c.input.message, {
      extract,
      world: new FakeWorld(c.input.orders),
      threadOrderId: async () => c.input.threadOrderId,
      run: async (source, op) => { written.push(op); const k = opKey(source, op); keys.push(k); return { op_key: k, status: "verified", reasons: [] }; },
      record: async (r) => { recorded = structuredClone(r); },
      trace: t,
    });
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 200);
  }
  // Replayed calls take no time; the recorded model latency stands in for the live one.
  const ms = Date.now() - t0 + modelMs;
  const out: Outcome = { recorded, written, keys, error, ms };
  const observations = score(c, out);
  const cost = Number(trace.find((e) => e.component === "extract")?.data.cost_usd ?? 0);
  return { result: { case_id: c.id, branch: `${c.branch} ${c.template}`, observations, ms, cost_usd: cost, summary: said(recorded) }, out, trace };
}
