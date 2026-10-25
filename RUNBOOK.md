# RUNBOOK.md — How to execute OPERATING.md

You have been given `OPERATING.md`. It is long by design. You are not
meant to hold it in working memory. You execute it **one section at a
time**, persisting state to disk, delegating bounded work to subagents,
and reloading only what the current section needs. This file tells you
how.

---

## 1. The first five minutes of every session

1. Read `/audit/STATE.md`. If it does not exist, this is session 1:
   create it from the template in §2 below.
2. Read `OPERATING.md` §0 (map), §1 (who you are), §16 (working
   agreements). Always. Every session.
3. Read **only** the section(s) STATE.md says you are in. Do not read
   ahead, except that you may always read §7 and §14 (checkpoints and
   exits) to know what you are working toward.
4. Write this session's plan into STATE.md before doing any work: which
   section, which deliverables, which subagents you expect to dispatch.

If you ever notice you are re-reading material, re-deriving something, or
unsure what phase you are in — you have lost state. Stop. Reload
STATE.md. Continue from it.

---

## 2. The ledger — `/audit/STATE.md`

The single source of truth for where the engagement stands. Update it
before and after every section and at the end of every session.

```
STATE.md
Updated: Session:

Phase and section
Phase: <0|1> Current section: <§n> Status: <not started|in progress|awaiting checkpoint|blocked>

Section checklist
 §6.1 Purpose — owner: self — artifact: /audit/reconstruction.md#purpose
 §6.2 Anatomy — owner: archaeologist — artifact: /audit/pipeline-trace.md
...
Active subagents
| agent | brief hash | dispatched | expected output | status |

Handoff notes (≤10 lines per completed section)
§6.2 → §6.7: pipeline has no NONE output path; display items never expire; ...

Open questions (OPERATING §17 + new)
| # | question | evidence so far | status |

Decisions made this engagement
2026-10-25 /decisions/2026-10-25-metric-redefinition.md

Memory (OPERATING §5 — do not act)
Paz email / display untouched
Owner migrating intake to Gmail API; not my job
Future swipe UI; only keep data model open
Auto-reply authorized for prod; stubbed in sandbox

Blockers
...

Next action
<one sentence — the very next thing to do>
```

---

## 3. Section execution protocol

For each section of OPERATING.md you enter:

**a. Read and decompose.** Read the section. Extract every deliverable as
a checklist item in STATE.md with an owner (self or subagent) and a
target artifact path.

**b. Delegate or do.** Apply OPERATING §12.2: delegate anything that
requires reading >~200 lines of code/data, >~20 records, or that is one
of several independent tasks. Do yourself anything requiring judgment
across returns or a direction decision.

**c. Write briefs.** One page each, using OPERATING Appendix A.1. If the
brief won't fit on a page, split the task. Record the brief hash in
STATE.md.

**d. Dispatch.** Independent tasks in parallel, up to the concurrency
limit (OPERATING §12.4). Dependent tasks wait.

**e. Receive.** Read the **artifact file**, starting with its ≤1-page
summary. Do not accept chat-only returns. Spot-check ≥10% of its claims
by re-executing them yourself or via a fresh verifier agent. Accept or
reject-and-redispatch with the discrepancy noted.

**f. Synthesize.** Write the section's output artifact yourself from the
verified returns. Your name goes on the conclusion.

**g. Handoff and drop.** Before leaving the section, write a ≤10-line
handoff into STATE.md: what the *next* section must know from this one.
Then let the detail go. The files hold it; you don't need to.

**h. Checkpoint gate.** If the section ends at a checkpoint (§7, §14),
follow §6 of this runbook. Do not proceed past a checkpoint on your own.

---

## 4. Context hygiene

- **Never paste** full source files, full emails, full eval CSVs, or full
  subagent outputs into your own context. Subagents read them. You read
  summaries, samples, and the specific lines your spot-check requires.
- **Require summaries.** Every subagent artifact has a ≤1-page summary at
  top. If it doesn't, reject it.
- **Scope what you load.** When you need OPERATING.md, load the section,
  not the file. §0 tells you which section.
- **Compaction protocol.** If your context is compacted or reset
  mid-session: reload STATE.md → §1/§16 → current section → resume from
  "Next action." Nothing else.
- **Write before you think long.** If a reasoning step is going to take
  significant context, write your current state to STATE.md first.

---

## 5. Subagent distribution

### 5.1 Section → roster mapping

| OPERATING section | Dispatch | Mode |
|---|---|---|
| §6.1–6.6 Discovery | `archaeologist`, `historian`, `label-auditor`, `data-cartographer`, `metric-definer`, `glossary-verifier` — **all in parallel** | read-only |
| §6.7 Taxonomy | `taxonomist` — after all discovery returns are verified | read-only |
| §7 Checkpoint A | `red-team-A` — after your draft alignment statement exists | read-only |
| §8 Sandbox | `harness-engineer`, then `isolation-verifier` (must be a different agent) | branch / read-only |
| §9.2–9.3 | `triage-engineer` | branch |
| §9.5 | `deterministic-engineer` | branch |
| §11.2 | `retrieval-ablation` — after deterministic baseline exists | branch |
| §9.6, §11.1 | `selector-engineer` — after §11.3 diagnostic | branch |
| §9.7–9.8 | `action-engineer` — may run parallel to selector on separate branch | branch |
| §15 | `ops-engineer` — parallel to any of the above | branch |
| §14 Checkpoint B | `red-team-B` | read-only |

### 5.2 Dispatch discipline
- A subagent gets **one** brief, **one** output path, and nothing else.
  No history, no other agents' outputs unless listed as INPUTS.
- Build agents work on `sandbox/<agent-name>` branches. You merge; they
  don't.
- No subagent is ever given production credentials, the display, intake
  config, or outbound mail. If a brief would require it, the task is
  yours or the owner's.
- When two returns conflict, you do not average them. You dispatch a
  verifier with both artifacts as INPUTS and a brief to determine which
  is right, or you resolve it yourself with evidence.
- Red teams are always **fresh** agents given only your conclusion
  artifact and the brief "find what is wrong with this."

### 5.3 Dispatch log
Every dispatch and every return is a row in STATE.md "Active subagents"
until accepted, then moves to the section checklist as done with its
artifact path.

---

## 6. Checkpoints

Checkpoints (OPERATING §7, §14) are **hard stops.**

1. Assemble every listed deliverable as files. Verify each exists and
   has a summary.
2. Dispatch the red team. Read its return. Revise your conclusion if it
   lands a hit; note the hit and your response in the alignment / final-
   state document.
3. Write a ≤1-page checkpoint message to the owner: what you delivered,
   file paths, the alignment statement inline, and the decisions you
   need. List OPERATING §17 questions with evidence.
4. Set STATE.md status to `awaiting checkpoint`. Write "Next action:
   await owner response to Checkpoint <A|B>."
5. **Stop.** Do not begin the next phase. Do not "prepare" the next phase
   beyond reading its sections. If the owner corrects the alignment,
   revise and re-present; the checkpoint is not passed until the owner
   says it is.

---

## 7. End-of-session protocol

Before the session ends — or whenever you have reason to think it might:

1. Update every checklist item's status in STATE.md.
2. Write handoff notes for any section in progress.
3. List active subagents and what you are waiting on.
4. Write "Next action" as a single concrete sentence a cold reader could
   execute.
5. Commit all artifacts.

---

## 8. Suggested session sequence

Adjust to reality; record deviations in STATE.md.

| Session | Work |
|---|---|
| 1 | Runbook §1. Create STATE.md. Read OPERATING §0–§5. Record Memory. Write briefs for the six Phase 0 discovery agents; dispatch all. |
| 2 | Receive and spot-check discovery returns. Reject/redispatch as needed. Write handoffs. |
| 3 | Dispatch `taxonomist`. Receive. Draft `/audit/reconstruction.md` and `/audit/alignment.md`. |
| 4 | Dispatch `red-team-A`. Revise. Assemble Checkpoint A per Runbook §6. **Stop.** |
| — | *Owner reviews. Confirms or corrects.* |
| 5 | Read OPERATING §8, §13.1. Dispatch `harness-engineer`. Then `isolation-verifier`. Reproduce baseline. Fix eval labels if §6.5 requires. |
| 6 | Run §11.3 diagnostic. Decide retrieval vs. selection as bottleneck. Dispatch `triage-engineer` and `deterministic-engineer` (parallel) and `ops-engineer`. |
| 7+ | Iterate per OPERATING §13.2. One iteration per session minimum; log each in `/eval/iterations.md`. Dispatch `retrieval-ablation`, `selector-engineer`, `action-engineer` as their prerequisites land. Check §14 exit conditions at the end of every iteration. |
| final | When an exit condition holds: dispatch `red-team-B`, write `/audit/final-state.md`, assemble Checkpoint B. **Stop.** |

---

## 9. Things that will tempt you — don't

- Reading the whole of OPERATING.md "to get oriented." Read §0. That's
  the orientation.
- Starting to fix something you noticed during discovery. Note it in
  STATE.md. Phase 1 is after Checkpoint A.
- Accepting a subagent's conclusion because it's plausible. Spot-check.
- Smoothing over a conflict between two returns. Resolve it with
  evidence.
- Dropping a flagged item because the display is cluttered. Recall-first.
  Propose a rule; don't improvise one.
- Proceeding past a checkpoint because the owner is slow to reply.
  Checkpoints are hard stops.
- Reporting a 2-point gain as progress. $n = 500$; the interval is ±4.
