// The review file a person reads: every failure, then two passes per branch, each with the
// email, what the system did, what was expected, and boxes to tick. Verdicts written here
// are ingested in Phase 4 and override the scorers.
import type { Observation } from "../../core/types";
import type { SpartanCase } from "./generate";
import { said, type Outcome } from "./score";

export function renderReview(rows: { c: SpartanCase; out: Outcome; observations: Observation[] }[]): string {
  const failed = rows.filter((r) => r.observations.some((o) => !o.ok));
  const sample: typeof rows = [];
  for (const t of [...new Set(rows.map((r) => r.c.template))]) sample.push(...rows.filter((r) => r.c.template === t && r.observations.every((o) => o.ok)).slice(0, 2));
  const one = (r: (typeof rows)[number]) => [
    `### ${r.c.id} · ${r.c.branch} ${r.c.template}`,
    `- **Rules:** ${r.c.rules.join(", ") || "none"} · **Source:** ${r.c.source}`,
    `- **Failed observations:** ${r.observations.filter((o) => !o.ok).map((o) => `${o.node} (${o.detail ?? ""})`).join("; ") || "none"}`,
    `- **Expected:** ${r.c.expected.kind}${r.c.expected.ops.length ? ` ${JSON.stringify(r.c.expected.ops.map((o) => o.kind))}` : ""}; intent ${r.c.expected.intents.join(" or ")}`,
    `- **System:** ${said(r.out.recorded)}; intent ${r.out.recorded?.interpretation?.extraction.intent ?? "none"}`,
    "",
    "```text",
    `Subject: ${r.c.input.message.subject}`,
    `From: ${r.c.input.message.from_address}`,
    `Sent: ${r.c.input.message.date_iso}`,
    "",
    String(r.c.input.message.body),
    "```",
    "",
    "[ ] correct  [ ] incorrect",
    "",
    "notes:",
    "",
  ].join("\n");
  return [
    "# 02 Review",
    "",
    `Every failure (${failed.length}), then two passing cases per template (${sample.length}). Tick one box per case; a verdict here overrides the scorer.`,
    "",
    "## Failures",
    "",
    ...failed.map(one),
    "## Passing sample",
    "",
    ...sample.map(one),
  ].join("\n");
}
