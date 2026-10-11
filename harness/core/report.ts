// ============================================================================
// The report, shaped like the code: gates first, then invariants, then the accuracy tree by
// layer and branch, each with n, a 95% Wilson interval, its target and its coverage depth.
// Every figure is a count of 1-or-0 observations; nothing is estimated or blended.
// ============================================================================
import { INVARIANT, type CaseResult } from "./types";
import { depth, pct, wilson } from "./stats";

const LAYERS: Record<string, string> = { I: "Intake", F: "Filter", X: "Extraction (AI)", G: "Grounding", P: "Planning", B: "Bot", T: "TV", O: "Outcomes" };

export type RunMeta = { title: string; mode: string; model: string; prompt_id: string; cases: number; spent_usd: number; calls: number; replayed: number; preflight: string[]; started: string; finished: string; target: number };

export function renderReport(results: CaseResult[], meta: RunMeta): string {
  const obs = results.flatMap((r) => r.observations.map((o) => ({ ...o, label: r.branch })));
  const rate = (node: string, filter: (o: (typeof obs)[number]) => boolean = () => true) => {
    const xs = obs.filter((o) => o.node === node && filter(o));
    const k = xs.reduce((a, o) => a + o.ok, 0);
    return { k, n: xs.length, fails: xs.filter((o) => !o.ok) };
  };
  const ci = (k: number, n: number) => { const w = wilson(k, n); return `${pct(w.lo)}-${pct(w.hi)}`; };
  const L: string[] = [];
  L.push(`# ${meta.title}`, "");
  L.push(`- **Mode:** ${meta.mode}. **Model under test:** ${meta.model} (prompt ${meta.prompt_id}).`);
  L.push(`- **Cases:** ${meta.cases}. **Model calls:** ${meta.calls} live, ${meta.replayed} replayed. **Spent:** $${meta.spent_usd.toFixed(2)}.`);
  L.push(`- **Run:** ${meta.started} to ${meta.finished}.`);
  L.push(`- **Preflight:** ${meta.preflight.join("; ")}.`, "");

  const term = rate("inv.terminal_state"), five = rate("inv.five_minutes"), e2e = rate("e2e");
  L.push("## Gates", "");
  L.push(`| Gate | Result | Observations |`, `|---|---|---|`);
  L.push(`| Never lose an email (every case reaches a recorded final state) | **${term.k === term.n ? "PASS" : "FAIL"}** | ${term.k}/${term.n} |`);
  L.push(`| Final state within five minutes | **${five.k === five.n ? "PASS" : "FAIL"}** | ${five.k}/${five.n}; slowest ${Math.round(Math.max(...results.map((r) => r.ms)) / 1000)}s |`);
  L.push(`| End to end correct (target ${pct(meta.target)}) | **${e2e.k / Math.max(1, e2e.n) >= meta.target ? "MET" : "NOT MET"}** | ${e2e.k}/${e2e.n} = ${pct(e2e.k / Math.max(1, e2e.n))}, 95% CI ${ci(e2e.k, e2e.n)} |`, "");

  L.push("## Invariants (hard gates, never averaged)", "");
  L.push(`| Invariant | Held | Violations |`, `|---|---|---|`);
  for (const node of [...new Set(obs.filter((o) => o.node.startsWith(INVARIANT)).map((o) => o.node))]) {
    const r = rate(node);
    L.push(`| ${node.slice(INVARIANT.length).replace(/_/g, " ")} | ${r.k}/${r.n} | ${r.fails.length ? r.fails.slice(0, 12).map((f) => f.case_id).join(", ") + (r.fails.length > 12 ? ` (+${r.fails.length - 12})` : "") : "none"} |`);
  }
  L.push("");

  L.push("## Accuracy tree", "");
  L.push(`| Branch | End to end | 95% CI | Target met | Coverage | Model read the intent | Failures |`, `|---|---|---|---|---|---|---|`);
  const labels = [...new Set(results.map((r) => r.branch))].sort((a, b) => a.localeCompare(b));
  const layers = [...new Set(labels.map((l) => l[0]))];
  for (const layer of layers) {
    const inLayer = labels.filter((l) => l[0] === layer);
    const lr = rate("e2e", (o) => o.label[0] === layer);
    L.push(`| **${LAYERS[layer] ?? layer}** | **${lr.k}/${lr.n}** | ${ci(lr.k, lr.n)} | ${lr.k / Math.max(1, lr.n) >= meta.target ? "yes" : "no"} | ${depth(lr.n)} | | |`);
    for (const label of inLayer) {
      const r = rate("e2e", (o) => o.label === label), ai = rate("ai.intent", (o) => o.label === label);
      L.push(`| ${label} | ${r.k}/${r.n} | ${ci(r.k, r.n)} | ${r.k / Math.max(1, r.n) >= meta.target ? "yes" : "no"} | ${depth(r.n)} | ${ai.k}/${ai.n} | ${r.fails.map((f) => f.case_id).slice(0, 8).join(", ")}${r.fails.length > 8 ? ` (+${r.fails.length - 8})` : ""} |`);
    }
  }
  L.push("");
  const ai = rate("ai.intent");
  L.push(`**The AI node (intent read correctly):** ${ai.k}/${ai.n} = ${pct(ai.k / Math.max(1, ai.n))}, 95% CI ${ci(ai.k, ai.n)}.`, "");
  return L.join("\n");
}
