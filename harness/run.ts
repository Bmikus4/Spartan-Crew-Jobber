// ============================================================================
// The one command.
//   npx tsx harness/run.ts --mode oracle            validate the harness and the deterministic pipeline ($0)
//   npx tsx harness/run.ts --mode record --cap 15   run the production model, recording every call
//   npx tsx harness/run.ts --mode replay            rescore from recordings ($0)
//   npx tsx harness/run.ts --mode mutant            control: every date read a day late must write nothing wrong ($0)
//   npx tsx harness/run.ts --preflight-selftest     prove the preflight aborts on a production credential
// Options: --n 500 (cases), --seed, --concurrency 6, --model <OpenRouter slug>.
// Run it WITHOUT --env-file: the preflight refuses a process holding production credentials.
// Only the model key is read from .env.local, and only in record mode.
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { preflight, closeNetwork } from "./core/preflight";
import { Recorder } from "./core/recorder";
import { renderReport } from "./core/report";
import type { CaseResult } from "./core/types";
import { generate, type SpartanCase } from "./adapters/spartan/generate";
import { runCase, oracleExtract, mutantExtract, recordedExtract } from "./adapters/spartan/adapter";
import { FakeWorld } from "./adapters/spartan/world";
import { interpretModel, PROMPT_ID } from "../app/lib/v2/interpret/extract";
import { renderReview } from "./adapters/spartan/review";

const arg = (name: string, dflt?: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const mode = arg("mode", "oracle") as "oracle" | "mutant" | "record" | "replay";
const N = Number(arg("n", "500")), SEED = Number(arg("seed", "20261010")), CAP = Number(arg("cap", "0")), CONC = Number(arg("concurrency", "6"));
const OUT = "harness/runs";

/** One line of .env.local, by name. The file holds production secrets; nothing else is read. */
function envLine(name: string): string | undefined {
  try {
    const line = readFileSync(".env.local", "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim().replace(/^"(.*)"$/, "$1") || undefined;
  } catch { return undefined; }
}

async function main() {
  if (process.argv.includes("--preflight-selftest")) {
    const bad = preflight({ env: { ...process.env, ONSINCH_API_KEY: "planted" }, allowHosts: [], adapterChecks: [] });
    const good = preflight({ env: { PATH: process.env.PATH }, allowHosts: [], adapterChecks: [] });
    console.log(`with a planted ONSINCH_API_KEY: ${bad.ok ? "PASSED (the preflight is broken)" : "ABORTED, as it must"}`);
    console.log(`with a clean environment: ${good.ok ? "passed" : "aborted (unexpected)"}`);
    process.exit(!bad.ok && good.ok ? 0 : 1);
  }

  const allowHosts = mode === "record" ? ["openrouter.ai"] : [];
  // Record and replay must name the same model: it is part of every recording's key.
  process.env.SPARTAN_INTERPRET_MODEL = arg("model", "anthropic/claude-opus-4.8");
  if (mode === "record") {
    process.env.OPENROUTER_API_KEY = envLine("OPENROUTER_API_KEY");
    if (!(CAP > 0)) throw new Error("record mode needs --cap <USD>: no spend without a ceiling");
  }
  const cases = generate(N, SEED);
  const pf = preflight({
    env: process.env, allowHosts,
    adapterChecks: [
      { name: "OnSinch is the fake world", ok: new FakeWorld([]).fake === true, detail: "FakeWorld" },
      { name: "the bot is the recording runner", ok: true, detail: "no browser is launched; runCase passes a recorder for run()" },
      { name: "case set generated", ok: cases.length === N, detail: `${cases.length} of ${N}` },
    ],
  });
  for (const c of pf.checks) console.log(`preflight  ${c.ok ? "ok  " : "FAIL"}  ${c.name}: ${c.detail}`);
  if (!pf.ok) { console.error("preflight failed: aborted before any case ran"); process.exit(2); }
  closeNetwork(allowHosts);

  const rec = new Recorder<any>(`harness/recordings/extract.jsonl`, mode === "record" ? "record" : "replay", CAP);
  const started = new Date().toISOString();
  const results: (CaseResult & { _case: SpartanCase; _out: any })[] = [];
  const traces: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const { result, out, trace } = await runCase(c, mode === "oracle" ? oracleExtract(c) : mode === "mutant" ? mutantExtract(c) : recordedExtract(rec));
      results.push({ ...result, _case: c, _out: out });
      traces.push(...trace);
      if (results.length % 50 === 0) console.log(`  ${results.length}/${cases.length}  spent $${rec.spent.toFixed(2)}`);
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  results.sort((a, b) => a.case_id.localeCompare(b.case_id));

  const meta = {
    title: `Spartan simulation, ${N} orders (${mode})`, mode, model: mode === "oracle" ? "oracle (the ground-truth reading)" : mode === "mutant" ? "mutant (oracle with every date one day late)" : interpretModel(), prompt_id: PROMPT_ID,
    cases: N, spent_usd: rec.spent, calls: rec.calls, replayed: rec.replayed, preflight: pf.checks.map((c) => `${c.name}: ok`), started, finished: new Date().toISOString(), target: 0.99,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${mode}-results.jsonl`, results.map(({ _case, _out, ...r }) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(`${OUT}/${mode}-traces.jsonl`, traces.map((t) => JSON.stringify(t)).join("\n") + "\n");
  writeFileSync(`${OUT}/${mode}-report.md`, renderReport(results, meta));
  writeFileSync(`${OUT}/${mode}-review.md`, renderReview(results.map((r) => ({ c: r._case, out: r._out, observations: r.observations }))));
  const e2e = results.flatMap((r) => r.observations).filter((o) => o.node === "e2e");
  console.log(`done: e2e ${e2e.filter((o) => o.ok).length}/${e2e.length}, spent $${rec.spent.toFixed(2)}, report ${OUT}/${mode}-report.md`);
}

main().catch((e) => { console.error(e); process.exit(1); });
