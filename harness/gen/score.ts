// ============================================================================
// One generated case, scored as 1-or-0 observations at each stage it passes (ADDENDUM §14.7), and the report:
// per category, then across categories, with the first stage that went wrong as each failure's place. An
// invariant is a hard gate, reported apart and never averaged into accuracy (Ben, 10-10).
// ============================================================================
import type { GenCase } from "./cases";
import { wilson } from "../core/stats";

export type Obs = { node: string; ok: 0 | 1; detail?: string };
export type Scored = { id: string; category: string; variant: string; obs: Obs[]; stage: string | null };
type Outcome = { decisions: any[]; stored: number; seen: any[] };

const STAGES = ["stored", "decision", "plan", "tv"];
const stageOf = (node: string) => (node.startsWith("inv.") ? null : STAGES.find((s) => node === s || node.startsWith(`${s}.`)) ?? node);

export function score(c: GenCase, out: Outcome): Scored {
  const obs: Obs[] = [];
  const o = (node: string, ok: boolean, detail?: string) => obs.push({ node, ok: ok ? 1 : 0, ...(ok || !detail ? {} : { detail }) });
  const d = out.decisions[0] ?? null;
  const said = d ? (d.decision.kind === "write" ? `write: ${d.decision.why.join("; ")}` : d.decision.kind === "handoff" ? `handoff: ${d.decision.reasons.join("; ")}` : `none: ${d.decision.reason}`) : "no decision";
  o("stored", out.stored >= c.emails.length && out.seen.filter((x) => x.kind === "email").every((x) => x.ok), `stored ${out.stored} of ${c.emails.length}`);
  o("decision", !!d && d.kind === c.expect.decision, `expected ${c.expect.decision}; got ${said}`);
  if (c.expect.reason && d?.decision.kind === "handoff") o("decision.reason", d.decision.reasons.some((x: string) => c.expect.reason!.test(x)), `expected ${c.expect.reason}; got ${said}`);
  const ops = d?.decision.kind === "write" ? (d.decision.ops as any[]).map((x) => x.op) : [];
  let wrong = false;
  if (c.expect.calls && d?.decision.kind === "write") {
    const create = ops.find((x) => x.kind === "create_order");
    const got = (create?.shifts ?? []) as any[];
    const want = c.expect.calls;
    const key = (x: { date: string; start: string; end: string }) => `${x.date} ${x.start}-${x.end}`;
    const sameCalls = got.length === want.length && want.every((w) => got.some((s) => key(s) === key(w)));
    const seats = want.every((w) => { const s = got.find((x) => key(x) === key(w)); return !!s && s.positions.reduce((n: number, p: any) => n + p.size, 0) === w.crew; });
    const places = want.every((w) => { const s = got.find((x) => key(x) === key(w)); return !!s && (s.place_label === w.place.name || String(s.place_id) === String(w.place.id)); });
    const trades = want.every((w) => !w.trade.profession || got.some((s) => key(s) === key(w) && s.positions.some((p: any) => p.profession_id === w.trade.profession)));
    o("plan.calls", sameCalls, `want ${want.map(key).join(", ")}; got ${got.map(key).join(", ")}`);
    o("plan.seats", seats, "a call's seats are not the crew asked");
    o("plan.venue", places, "a call is at another venue");
    o("plan.trade", trades, "a trade asked is not booked as its profession");
    wrong = !sameCalls || !seats || !places;
  }
  if (c.expect.change && d?.decision.kind === "write") {
    const fits = { times: ["set_position_times"], crew: ["set_position_size", "add_position", "cancel_position"], cancel: ["cancel_position"], add: ["add_shift", "add_position"], po: ["set_po"] }[c.expect.change];
    const ok = ops.length > 0 && ops.every((x) => fits.includes(x.kind));
    o("plan.change", ok, `a ${c.expect.change} wrote ${ops.map((x) => x.kind).join(", ")}`);
    wrong ||= !ok;
  }
  // A write where the business answer is a person's: an out-of-rule control written is the worst failure.
  if (c.expect.decision === "handoff" && d?.decision.kind === "write" && c.category === "M") wrong = true;
  o("inv.no_wrong_write", !wrong, `wrote ${JSON.stringify(ops).slice(0, 240)}`);
  o("inv.tv_served", out.seen.filter((x) => x.kind === "look").every((x) => x.status === 200), "the TV answered something other than 200");
  for (const l of c.looks) {
    const s = out.seen.find((x) => x.kind === "look" && x.label === l.label);
    const card = s?.shown ?? null;
    // A reply the client is owed is a card staff answer by email, kept off the TV's order list (lane "reply").
    const reply = !card && s?.any?.items?.[0]?.kind === "needs-reply";
    const state = reply ? "reply" : !card ? "absent" : card.green ? "done" : /^Possibly done/.test(card.check ?? "") ? "possibly" : "open";
    const tag = l.label.replace(/\s+/g, "_");
    o(`tv.${tag}.state`, state === l.state, `expected ${l.state}; the TV shows ${state}${card ? ` (${card.items?.[0]?.kind}, "${card.check ?? ""}")` : ""}`);
    if (card && l.kind) o(`tv.${tag}.kind`, card.items?.[0]?.kind === l.kind, `expected ${l.kind}; got ${card.items?.[0]?.kind}`);
    if (card && l.name) o(`tv.${tag}.name`, String(card.company ?? "").includes(l.name), `expected a name with "${l.name}"; got "${card.company}"`);
    if (card && l.days) o(`tv.${tag}.days`, JSON.stringify(card.dates) === JSON.stringify(l.days), `expected ${l.days.join(",")}; got ${(card.dates ?? []).join(",")}`);
    if (card) o("inv.no_subject_name", !c.emails.some((e) => e.subject === card.company), `named by the subject "${card.company}"`);
  }
  const first = obs.find((x) => !x.ok && !x.node.startsWith("inv."));
  return { id: c.id, category: c.category, variant: c.variant, obs, stage: first ? stageOf(first.node) : null };
}

const pct = (k: number, n: number) => (n ? `${((100 * k) / n).toFixed(0)}%` : "-");

export function report(rs: Scored[], meta: Record<string, unknown>): string {
  const cats = [...new Set(rs.map((r) => r.category))];
  const out: string[] = [`# Generated business: ${rs.length} cases`, "", "```", JSON.stringify(meta), "```", ""];
  out.push("## Per category", "", "| cat | cases | end to end | 95% CI | stored | decision | plan | tv | wrong writes |", "|---|---|---|---|---|---|---|---|---|");
  const nodeRate = (xs: Scored[], prefix: string) => {
    const os = xs.flatMap((r) => r.obs.filter((o) => o.node === prefix || o.node.startsWith(`${prefix}.`)));
    return os.length ? pct(os.filter((o) => o.ok).length, os.length) : "-";
  };
  for (const cat of cats) {
    const xs = rs.filter((r) => r.category === cat);
    const ok = xs.filter((r) => !r.stage).length;
    const ci = wilson(ok, xs.length);
    const wrong = xs.filter((r) => r.obs.some((o) => o.node === "inv.no_wrong_write" && !o.ok)).length;
    out.push(`| ${cat} | ${xs.length} | ${ok}/${xs.length} | ${(100 * ci.lo).toFixed(0)}-${(100 * ci.hi).toFixed(0)}% | ${nodeRate(xs, "stored")} | ${nodeRate(xs, "decision")} | ${nodeRate(xs, "plan")} | ${nodeRate(xs, "tv")} | ${wrong} |`);
  }
  out.push("", "## Where cases first went wrong (stage by category)", "", `| stage | ${cats.join(" | ")} | all |`, `|---|${cats.map(() => "---|").join("")}---|`);
  for (const st of STAGES) out.push(`| ${st} | ${cats.map((cat) => rs.filter((r) => r.category === cat && r.stage === st).length).join(" | ")} | ${rs.filter((r) => r.stage === st).length} |`);
  out.push("", "## Invariants (hard gates)", "");
  for (const inv of [...new Set(rs.flatMap((r) => r.obs.filter((o) => o.node.startsWith("inv.")).map((o) => o.node)))]) {
    const os = rs.flatMap((r) => r.obs.filter((o) => o.node === inv));
    out.push(`- ${inv}: ${os.filter((o) => o.ok).length}/${os.length}`);
  }
  out.push("", "## Failure signatures (first failing observation, grouped)", "");
  const sig = new Map<string, string[]>();
  for (const r of rs) {
    const f = r.obs.find((o) => !o.ok && !o.node.startsWith("inv."));
    if (!f) continue;
    const key = `${r.category} ${f.node}: ${String(f.detail ?? "").replace(/\d{4}-\d\d-\d\d/g, "D").replace(/\d\d:\d\d/g, "T").replace(/\d+/g, "N").slice(0, 140)}`;
    sig.set(key, [...(sig.get(key) ?? []), r.id]);
  }
  for (const [k, v] of [...sig].sort((a, b) => b[1].length - a[1].length)) out.push(`- ${v.length} x ${k} (${v.slice(0, 4).join(", ")})`);
  return out.join("\n");
}
