AGENT: spec-compliance   PHASE: 0   MODE: read-only

GOAL: Decide, requirement by requirement, whether the Phase 0 deliverables meet OPERATING.md as
written. The owner asked for the original spec to be reviewed and the audit continued one item at
a time; this list is the order of that work. You judge only whether each requirement is met by
what is in the files. You do not judge whether the conclusions are right (red-team-A did that).

INPUTS:
- OPERATING.md §2, §3, §4, §6 (all of 6.1-6.7), §7 (items 1-7), §9.9, §10, §12.1 rule 5,
  §16, §17, Appendix A.2 and A.3. RUNBOOK.md §2, §3 (a-h), §6.
- Every file in audit/ and eval/ (summaries first; open detail only where a requirement needs it).
- audit/briefs/_common.md applies, except that this brief has no data or harness inputs.

OUTPUT: audit/spec-compliance.md, with a summary of at most one page at the top, then one table:
| id | section | requirement (OPERATING's own words, quoted, at most 25) | where met (file:line or section) | status | what is missing |
- One row per separately checkable requirement. A sentence asking for two things is two rows.
  ("Diagram it" is its own row; "on the 500" is part of the requirement it qualifies.)
- status is exactly one of: MET, PARTIAL, MISSING, SUPERSEDED. SUPERSEDED requires the file:line
  where the audit says why the requirement cannot apply as written (e.g. "the 500" are not real
  mail) and what was done instead; then judge whether the substitute meets the requirement's
  purpose, and write that judgment in "what is missing".
- Also check RUNBOOK §2's ledger: is every field of STATE.md current with the artifacts (open
  questions, decisions, checklist)? Each stale field is a row.
- End with "Order of work": the PARTIAL and MISSING rows, ordered by how much each changes what
  the owner decides at Checkpoint A (most first), one line each saying why.

SCOPE: You may read any file in the repo and run read-only commands (grep, wc, node on local JSON
under .tmp-data/). You may NOT read .env.local, make any network call, run the gate, the harness or
any model, commit, or write any file but OUTPUT.

BLOCKED: If a requirement cannot be judged from the files, mark it PARTIAL with "cannot judge from
files: <why>" and move on. Do not improvise around it.

VERIFICATION: The orchestrator will re-open at least 10% of your rows at the cited file:line,
including every MET row you cite for §6.5 and §6.7 and every SUPERSEDED row. Cite exact lines.
