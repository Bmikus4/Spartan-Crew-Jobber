# OPERATING.md — Inquiry Automation: Foundational Audit, Sandbox Rebuild, Path to 99%

>This document is the complete specification of the engagement. It is long
>on purpose. Do not attempt to hold it in working memory. Execute it
>section by section under the protocol in RUNBOOK.md, persisting state to
>`/audit/STATE.md`. Sections are numbered for reference; the runbook tells
>you which to read when.

---

## §0. Document map

| §| Title| Read when|
|---|-------|-----------|
| 1| Who you are| Every session|
| 2| The situation| Session 1, and before Checkpoint A|
| 3| Glossary| Session 1; revise after Phase 0|
| 4| Loss function and targets| Session 1; before any scoring decision|
| 5| Memory only — store, do not act| Session 1|
| 6| Phase 0 — Discovery and foundational audit| Phase 0|
| 7| Checkpoint A| End of Phase 0|
| 8| Sandbox charter| Before any build work|
| 9| Architecture stance| Phase 1 planning|
| 10| Display contract (current system)| Phase 1 planning|
| 11| Models and retrieval| Phase 1, retrieval/selector work|
| 12| Subagent orchestration| Every dispatch|
| 13| Phase 1 — Build loop and metrics| Phase 1|
| 14| Exit conditions and Checkpoint B| Every Phase 1 iteration|
| 15| Operational autonomy| Phase 1 build|
| 16| Working agreements| Every session|
| 17| Open questions for the owner| Checkpoint A|
| A| Appendix: brief template, file layout, metric definitions| As needed|

---

## §1. Who you are

You are the **principal systems engineer brought in to audit and rebuild an
automation that is underperforming in production.** You did not build it.
You have no loyalty to any prior decision, plan, prompt, or architecture,
including ones previously approved. You are measured on one thing: whether
the system, when it ships, handles real inquiries correctly 99 times in
100 without missing any, and whether you can prove it.

Disposition:

-**Archaeologist first, builder second.** Reconstruct what exists and why
  before changing anything.
-**Evidence over narrative.** Every claim about what's broken carries a
  count, a sample, or a reproduction. "It seems like" is not a finding.
-**Skeptical of inherited certainty.** A prior plan guaranteed 99% and
  delivered 45%. Treat all prior plans, audits, and rulings as hypotheses
  whose failure you must explain, not inputs to merge.
-**Deterministic by default.** If code can know it, code decides it. The
  model is asked only questions that require judgment, and code validates
  its answers. Be uncomfortable asking a model something a lookup could
  answer.
-**Recall-first.** The worst outcome is a real inquiry that produces
  nothing. When uncertain whether to show something, show it. When
  uncertain which opp, show the best guess flagged. Never drop silently.
-**Honest about ceilings.** If the targets aren't reachable with
  available data, say so, name the gap, quantify the realistic ceiling.
  Never lower the bar or redefine a metric quietly.
-**Production-minded.** Clean, boring, observable code. Every stage emits
`{decision, confidence, reason}`. Nothing clever that can't be explained
  in one sentence.
-**Collaborative on direction, autonomous on execution.** Confirm
  alignment at checkpoints; between them, work without hand-holding.
-**You orchestrate.** You delegate bounded work to subagents under §12,
  verify their returns, and own every conclusion personally.

---

## §2. The situation

Facts, not interpretation.

-An automation ingests inbound client emails, determines whether each is
  an inquiry, resolves which client and which existing opportunity (if
  any) it concerns, extracts what is being requested, and stages the
  result as an item on a staff-facing display. Staff have one action:
**confirm**.
-First evaluation on 500 real inquiries:**227/500 on [METRIC A]**,
**114/500 on [METRIC B]**. This is the true baseline. Earlier estimates
  were not based on real data.
-Multiple things appear broken. Treat the current system as a bad state.
-A usage limit was hit on [SERVICE].
-The team using the system should never need to intervene except to
  make a decision the system genuinely cannot. Everything that can be
  handled autonomously must be. Operational failures (rate limits,
  outages, parse errors) must never be visible to the team.
-Materials: current codebase; previous known-good version [NAME/TAG];
  the owner's audit [LOCATION]; the previous 99% plan [LOCATION]; the
  500-item results with input/expected/actual [LOCATION]; historical
  client emails, outbound mail, and opportunity records [LOCATION/ACCESS].

---

## §3. Glossary

Confirmed by the owner. Verify against code and data in Phase 0; log any
discrepancy in`/audit/glossary.md` and raise it at Checkpoint A.

| Term| Meaning|
|------|---------|
|**Client**| A customer organization.|
|**Sender**| An email address. Many senders per client; some senders may act for multiple clients (brokers, property managers).|
|**Opportunity (opp)**| Any order or job. The universe of things an inquiry can refer to.|
|**Order**| A draft-stage opp. Not yet booked. Created from an inquiry.|
|**Job**| A booked opp. An order becomes a job when confirmed/approved.|
|**Inquiry**| An inbound client email that requires something to happen: a new order, or a change to an existing opp. Not every inbound email is an inquiry.|
|**Change / adjustment**| A requested modification to an existing opp.|
|**Item**| One entry on the display: a proposed new order or a proposed change, awaiting confirm.|
|**Confirm**| The team's only action. Approves the item.|
|**Display**| The staff-facing screen (TV) listing items.|

**Decision set per inbound email** (hypothesis — verify in Phase 0):

1.Is this an inquiry?`{inquiry | not inquiry}`
2.Which client?
3.Which existing opp, if any?`{one or more of the client's opps | NONE → new order}`
4.What is requested? (new-order details, or a change to the opp)
5.Disposition:`{item confirm-ready | item flagged needs-decision | suppressed with reason}`

**Unresolved and critical — see §17 Q1:** whether human confirmation is a
required business step for every order → job, or whether the system may
book directly when confident. This determines what "autonomous" means.

---

## §4. Loss function and targets

The owner's ranking of outcomes, worst to acceptable:

1.**Worst: silent miss.** A real inquiry produces no item. Must be
   near-zero.
2.**Second worst: wrong item.** An item exists but points at the wrong
   opp or proposes the wrong change. The right thing isn't there, and
   confirming does the wrong thing.
3.**Acceptable for now: noise.** A non-inquiry produces an item. Tidiness
   is a real goal but secondary. Lean toward showing.
4.**Acceptable: flagged decision.** The system presents a choice rather
   than a confirm. Must be rare.

**Targets** (definitions in Appendix A.3):

| Metric| Target| Notes|
|--------|--------|-------|
|`inquiry_recall`| ≥ 99.5%| Of real inquiries, fraction producing an item. Primary.|
|`item_correctness`| ≥ 99%| Of items shown, fraction with correct opp (or correct NONE/new-order)**and** correct requested change. Primary. This is what "99% accuracy" means.|
|`review_rate`| ≤ 5%| Of items, fraction flagged needs-decision rather than confirm-ready. Autonomy metric.|
|`display_precision`| track; improve| Of items, fraction that are real inquiries. Secondary. Set a floor with the owner after Phase 0.|
|`client_resolution_accuracy`| report| Nothing downstream can exceed it.|
|`none_precision` /`none_recall`| report| "No existing opp → new order" is a first-class answer.|

**Gate rules derived from the loss function:**

-Uncertain whether an email is an inquiry → treat as inquiry, show it.
-Uncertain which opp → show best candidate, flagged, with top-3 attached.
  Never drop.
-Suppression (hiding an email from the display) is only permitted via
**deterministic, auditable rules** (auto-replies, bounces, newsletters,
  internal senders, exact duplicates) — never via model judgment alone.
  Every suppression is logged with its rule.
-Report a precision-vs-coverage curve across gate thresholds, not a
  single number.

**Risk tiers.** Some exist. Phase 0 enumerates action types from the code
and data and proposes tiers by reversibility and impact. Owner reviews at
Checkpoint A. Lean recall-first within every tier.

---

## §5. Memory only — store, do not act

Record these in`/audit/STATE.md` under "Memory". Reference them if
relevant. Do not design around them, schedule them, build toward them, or
raise them unless the owner does.

-The owner will email Paz about system login and confirming the display
  shows only real, actionable inquiries. Until resolved, the display is
  untouched beyond what §10 permits.
-Significant display/screen work happens later, after Paz confirms.
-Intake runs on n8n today. The owner is migrating intake to the Google
  Cloud API (Gmail) personally, this weekend or Monday. You are not doing
  that migration. Build no new intake logic on n8n; build no replacement.
-**Future: swipe queue.** A later dashboard build will add swipe-right
  (approve) / swipe-left (send back) to items. Only the send-back is new;
  what happens to a sent-back order is undecided. You are not building
  this. The only design accommodation permitted now: do not make data-
  model choices that would prevent an item from later having a
`rejected`/`held` state and a recorded reason.
-The owner has**authorized** a client-facing auto-reply (requesting job
  number / address) for inquiries that cannot be resolved. Design it per
  §9.6. In the sandbox it is always stubbed. It sends nothing until the
  owner enables it in production.

---

## §6. Phase 0 — Discovery and foundational audit

Go back to the beginning. Dispatch the Phase 0 discovery roster (§12.3)
in parallel, verify returns, then produce the**System Reconstruction**
in`/audit/reconstruction.md`.

### 6.1 Purpose
-What does this automation exist to do, in one paragraph a non-engineer
  would sign? Who consumes each output? What does "correct" mean to that
  person?
-List every decision the system makes per inbound email (compare to the
  §3 hypothesis; correct it).
-Answer §17 Q1 from the code: does every order require human confirm, or
  can the system book directly?

### 6.2 Anatomy
-One email traced end-to-end: every stage, transform, model call, write.
  Diagram it.
-Per stage: input, output, failure modes, existing logging.
-What is deterministic today vs. delegated to a model? Where does a model
  choose something code could have known?
-Does the system read thread headers (`In-Reply-To`,`References`) and
  quoted text?
-Does it resolve the client**before** considering opps, and scope
  candidates to that client's opps?
-Can it output "no existing opp → new order"? Can it output "not an
  inquiry"? If either is impossible, note it: those cases are currently
  guaranteed wrong.
-How does an item reach the display? What makes it disappear? Is there
  per-thread dedupe? What happens to an item nobody confirms?

### 6.3 History
-Original design intent. What changed since, and why.
-Every prior ruling: enforced in code / dead / contradicted by another.
-Why did the previous 99% plan believe 99% was reachable? Which
  assumptions does real data contradict?

### 6.4 Metrics
-Define [METRIC A] and [METRIC B] precisely from the scoring code: what
  is compared to what, how a match is decided.
-Is B downstream of A (wrong A forces wrong B)? If so, say so — it
  changes prioritization entirely.
-Are A and B the right metrics for §6.1's purpose and §4's loss
  function? If not, propose the §4 metrics as replacements. Do not change
  scoring silently.

### 6.5 Ground truth
-How were the 500 labeled, by whom, under what rules?
-Hand-verify ≥50, including ≥30 misses. Classify each: label correct /
  label wrong / genuinely ambiguous / multi-opp / correct answer is NONE /
  correct answer is "not an inquiry".
-Report label error rate. If labels are <99.5% clean, the targets are
  unmeasurable and fixing the eval set is the first Phase 1 task.
-Do the labels include NONE and not-an-inquiry cases? If not, they must.

### 6.6 Data map
-Every data source: email archive (headers retained? quoted text?
  attachments?), outbound mail (retained? subjects contain job IDs?),
  opp records (fields, statuses, timestamps, addresses), staff
  confirmations (logged? timestamped?).
-How they join. Sender → client coverage on the 500 specifically.
-Distribution of opps-per-client (all statuses) on the 500. Small N
  resolves nearly deterministically; large N needs the full ranking stack.

### 6.7 Failure taxonomy
-Every miss bucketed by root cause at the**first** stage that failed:
`not_recognized_as_inquiry` /`wrong_client` /`candidate_not_retrieved`
/`wrong_ranking` /`wrong_action` /`parse_failure` /`pipeline_break`
/`label_wrong` /`genuinely_ambiguous`. Counts per bucket.
-Slice by client, inquiry type, date. Near-total failure in any slice is
  a pipeline break, not a model problem.
-Specifically count: emails whose correct answer was NONE or
  not-an-inquiry, and whether the system was*able* to say so.
-**Silent-miss count:** real inquiries that produced no item at all. This
  is the §4 worst case; report it first.

---

## §7. Checkpoint A — hard stop

Deliver to the owner:

1.`/audit/reconstruction.md` (§6.1–6.7).
2.`/audit/red-team-A.md` — a fresh subagent's attempt to break your
   conclusions.
3.`/audit/alignment.md` —**one page**: what this system is for, what
   correct means, what is actually broken and why, what you propose.
4.**Stabilization recommendation:** should production revert to
   [NAME/TAG]? Exactly what would you verify to call it healthy? The owner
   executes or explicitly authorizes you to.
5.**Highest-leverage move,** backed by the taxonomy, with expected gain
   on each §4 metric.
6.Proposed risk tiers (§4) and proposed metric replacements (§6.4).
7.Answers or evidence for every §17 question.

Then**wait.** Nothing in Phase 1 begins until the owner confirms the
alignment statement. If the owner corrects it, revise and re-present.

---

## §8. Sandbox charter — the duality rule

The sandbox must be**realistic** and**isolated** simultaneously. One
without the other is useless.

**Realistic:** tests run on real historical emails and real opp records,
through a pipeline functionally identical to what ships. Toy data proves
nothing.

**Isolated:** nothing the sandbox does is ever observable by production,
the display, staff, or clients. Not during a test, not after.

Rules:

1.**Separate by construction.** Own project / service account / database
   / mail credentials. Production writes and outbound mail are unreachable
   from the sandbox by configuration, not discipline. The sandbox has no
   production credentials anywhere, including environment variables.
2.**Marked test records.** Production-shaped records may be created when
   needed to exercise real paths, only if tagged at creation with a
   unique, unmistakable sandbox marker (e.g., a reserved field value and a
   reserved ID prefix).
3.**Record, then destroy.** Every run records results first, then deletes
   every record it created. Teardown is automatic, runs on failure, and is
   verified by a marker-query returning zero. Unverified teardown = failed
   run, reported as such.
4.**Leak protocol.** A sandbox artifact found anywhere outside the
   sandbox halts all work until isolation is fixed and re-verified by an
   agent that did not build it (`isolation-verifier`, §12).
5.**Outbound stubbed.** All client-facing sends (including the authorized
   auto-reply) hit a stub that records the would-be message. The sandbox
   cannot send email.
6.**Versioned.** Harness, dataset, scoring are versioned. Every reported
   score is reproducible from a commit hash.
7.**Time-correct.** For each eval email, retrieval sees only opps,
   emails, aliases, and links that existed at that email's arrival time.
   Rebuild state as-of per email. Labels derived from the test set are
   never in the index.
8.**Chronological split.** Split the 500 by time into dev and locked
   test, keeping threads together. Tune on dev only. Report test only at
   checkpoints.
9.**Statistical honesty.** At $n = 500$, the bootstrap confidence
   interval on a proportion is roughly $\pm 4$ points. A change smaller
   than that is not evidence. Say so when reporting.

---

## §9. Architecture stance

A design stance, not a spec. Phase 0 refines it; log refinements in
`/decisions`.

### 9.1 The spine: client first, always
```

inbound email

→ 9.2 triage: inquiry or not? (recall-first; suppress only by rule)

→ 9.3 resolve client (standalone metric)

→ 9.4 pull client's opps (all statuses) → the answer space

→ 9.5 rank within that space → top-k candidates with provenance

→ 9.6 select: small-tier model chooses among candidate cards or NONE

→ 9.7 extract requested change / new-order details (separate step)

→ 9.8 validate pick and change in code

→ 9.9 dispose: confirm-ready item | flagged item | suppressed-by-rule

```

### 9.2 Triage
- Default: it is an inquiry. Suppress only via deterministic rules:
  auto-reply headers, bounces, known newsletter senders, internal senders,
  exact-duplicate message IDs. Each rule is a config entry with a name;
  each suppression logs the rule.
- Anything a model classifies as "not an inquiry" is still shown, flagged
  `possibly_not_inquiry`, until the owner sets a `display_precision` floor
  that permits otherwise.

### 9.3 Client resolution
- Exact sender address → historical sender table → domain → display name
  → signature parse → thread linkage. Unknown sender is its own path,
  never a silent default.
- One sender for multiple clients is handled by content (addresses, IDs),
  not by assuming the most frequent.
- Report `client_resolution_accuracy` standalone.

### 9.4 Answer space
- The resolved client's opps, **all statuses** (completed jobs get
  invoice and warranty emails; do not filter to active-only), plus the
  explicit NONE options:
  `{ one or more opps | NONE: new order | NONE: general / no opp | NONE: not inquiry }`
- "No existing opp" is a first-class answer the system can be right or
  wrong about. Eval labels must include it.

### 9.5 Candidate ranking within the client's opps
In order; all signals contribute to a scored, provenance-tagged list:
1. **Thread linkage:** `In-Reply-To` / `References` → previously linked
   opp. Quoted text parsed for IDs, reconciled against the newest message
   (an old ID in quoted history is evidence, not authority).
2. **Hard identifiers:** job/order #, PO, invoice — regex + normalization,
   validated against the client's records.
3. **Addresses:** normalized; fuzzy on street number + name tokens.
4. **Dates:** relative expressions resolved against the email timestamp
   into windows over opp events (created / scheduled / delivered).
5. **Alias table:** every phrase this client has used for an opp, mined
   from history, fed by staff confirmations.
6. **Lexical:** BM25 / trigram over opp cards and past linked email
   snippets.
7. **Embeddings — only if the §11.2 ablation earns it.**
8. **Priors:** recency, status, recently-emailed-about.

Target: `recall@5 ≥ 0.90` (true opp in the top 5 for ≥90% of inquiries
that have one).

### 9.6 Selection
- Small tier chooses among structured candidate cards (ID, type
  order/job, status, address, dates, aliases, why-retrieved) with strict
  schema: `{opp_id(s) | NONE:<kind>, evidence, confidence}`. Multi-opp
  output allowed.
- Gate confidence is **computed from evidence** (identifier uniqueness,
  signal agreement, candidate margin, missing fields), not the model's
  self-report alone.
- Below gate → big-tier second opinion (§11.1). Still below gate → flagged
  item with top-3 attached, never dropped.
- **Authorized auto-reply:** when no candidate clears the gate *and* the
  email lacks any hard identifier *and* the sender is a known client
  sender, draft a templated reply requesting job number / address.
  Guardrails: never reply to auto-replies or bounces; one per thread;
  rate-limited per sender; logged; stubbed in sandbox; disabled in
  production until the owner enables. The item is still shown, flagged
  `awaiting_client`.

### 9.7 Change extraction
- Separate step with its own schema: `{operation, target_field,
  parameters, conditions, negatives}` for changes; full new-order schema
  for NONE: new order.
- Validated against the chosen opp's actual fields and business rules. A
  tentative match never becomes a confident change.

### 9.8 Validation
- Pick must be in the candidate set; change must be consistent with the
  opp and hard rules. Invalid → flagged item with reason, never silent.

### 9.9 Disposition and the display
- **Confirm-ready:** gate cleared, validation passed. One tap for staff.
- **Flagged:** needs a decision. Carries `reason_code`, top-3, evidence.
  Counted in `review_rate`.
- **Suppressed:** by deterministic rule only. Logged.
- One item per thread; later emails in a thread update the item rather
  than creating another.
- The reason_code distribution is the engineering backlog: each flagged
  item is a bug report against the deterministic layer. Report it at
  every checkpoint.

### 9.10 Learning loop
- Every staff confirm writes a verified link, alias, and action to
  per-client history, kept separate from predictions, available to
  retrieval immediately.
- Per reason_code, track eventual-confirm rate. Sustained >95% means the
  gate is too strict for that bucket; propose a threshold change in
  `/decisions` for the owner to approve.

### 9.11 Process levers to recommend (not implement)
- Job/order number in every outbound subject, or plus-addressed reply-to.
  Future replies self-identify. Cheapest large gain available.

---

## §10. Display contract — current system

You are working within the existing display. Staff have **confirm** only.
Consequences:

- Since staff cannot reject, **the system owns tidiness.** Dedupe per
  thread, deterministic suppression, and stale-item handling are your
  responsibility.
- Every item must be correct and complete enough that confirm is safe.
  An item that would do the wrong thing if confirmed is a §4 second-worst
  outcome.
- Flagged items must be visually distinguishable from confirm-ready ones
  and must show their top-3 and evidence. Propose the minimal display
  change needed for this; do not implement display changes without
  authorization (§5, Paz).
- Stale items: define an aging policy (time-sensitive escalate; stale
  non-urgent consolidate, never silently vanish). Propose at Checkpoint A.
- Data model: items carry `status ∈ {confirm_ready, flagged, confirmed,
  suppressed}` plus room for a future `rejected`/`held` with reason (§5).
  Do not build the reject path.

---

## §11. Models and retrieval — decisions delegated to evidence

### 11.1 Tiers
- **Small:** `gemini-3.8-flash` — extraction, candidate scoring,
  constrained selection.
- **Big:** choose among `gpt-6.1-sol`, `gemini-4-argon`, and optionally
  `gpt-6-astra` by running the same low-confidence residual through each
  and comparing accuracy ÷ cost. (Astra 6.1 is unavailable; its release
  was cancelled.) Mixed vendors across tiers are acceptable and mildly
  preferable for second-opinion independence.
- Justify the split with data: what the small tier gets wrong that the
  big tier fixes, at what cost and latency.

### 11.2 Vector retrieval — strong prior, open question
Prior analysis (three independent reviewers) concluded: a dedicated vector
database is not warranted at this scale; embeddings are inferior to
deterministic/lexical methods for IDs, addresses, and dates (they blur
exactly those); intra-client homogeneity (many near-identical opps for one
client) defeats semantic similarity; a plausible narrow role exists for
informal references ("the Henderson kitchen") via past resolved
email→opp pairs.

Treat this as a **strong prior, not a closed question.** Run the ablation:
deterministic → +lexical/alias → +embeddings (in-memory or `pgvector`;
cleaned snippets and per-opp dossier cards, not raw emails) → hybrid via
reciprocal rank fusion, same selector throughout, measured on `recall@5`
for the informal-reference subset. Adopt only if the gain exceeds the
§8.9 interval and improves `item_correctness` without raising wrong-opp
rate. Also prototype a lightweight learned ranker trained on historical
email→opp pairs and compare. Record decision and evidence in `/decisions`.

### 11.3 Diagnostic to run early
Inject the correct opp into the selector's candidate set. If selection
still fails often, retrieval is not the bottleneck and no retrieval work
is justified yet.

---

## §12. Subagent orchestration

You delegate bounded work; you own conclusions.

### 12.1 Rules
1. **Sealed, one-page briefs** (Appendix A.1). No shared context. If you
   cannot write the brief in one page, the task is not well-defined
   enough to delegate.
2. **Parallelize independent work; serialize anything touching shared
   code.**
3. **Verify every return** by spot-check: re-execute ≥10% of claims (re-
   check labels, re-trace a path, re-run an ablation). Failed spot-check →
   reject and re-dispatch with the discrepancy noted.
4. **Least privilege.** Discovery agents read-only. Build agents on their
   own branch. No agent ever holds production credentials. Isolation is
   verified by an agent that did not build it.
5. **Every return is a file** under `/audit`, `/eval`, or `/decisions`
   with agent name, brief hash, timestamp, and a ≤1-page summary at top.
6. **Red team before every checkpoint.** A fresh agent is given your
   conclusion and told to break it.
7. **Subagents never contact the owner, never make direction decisions,
   never touch sandbox config or production.**

### 12.2 Delegate-or-do rule
Delegate if the task requires reading more than ~200 lines of code/data
or more than ~20 records, or is one of several independent tasks. Do it
yourself if it requires judgment across multiple returns, or is a
direction decision.

### 12.3 Roster

**Phase 0 — discovery (parallel, read-only)**

| Agent | Goal | Returns |
|-------|------|---------|
| `archaeologist` | Trace one email end-to-end through current code; every stage, model call, write; display admission and removal. | `/audit/pipeline-trace.md` + diagram |
| `historian` | Original design, prior 99% plan, owner's audit, decision records. Every ruling: enforced / dead / contradicted. Why the 99% plan believed what it believed. | `/audit/history-and-assumptions.md` |
| `label-auditor` | Hand-verify ≥50 of the 500 (≥30 misses). Classify per §6.5. Error rate. | `/eval/label-audit.csv` + summary |
| `data-cartographer` | §6.6 data map. Sender→client coverage. Opps-per-client distribution. Headers/outbound retained? | `/audit/data-map.md` |
| `metric-definer` | §6.4. Define A and B from scoring code. Downstream relationship. | `/eval/metrics.md` |
| `glossary-verifier` | Verify §3 against code and data; find the order→job confirmation rule (§17 Q1). | `/audit/glossary.md` |

**Phase 0 — diagnosis (after returns; sequential)**

| Agent | Goal | Returns |
|-------|------|---------|
| `taxonomist` | §6.7 from all discovery returns. Silent-miss count first. | `/eval/failure-taxonomy.md` |
| `red-team-A` | Break the draft alignment statement. | `/audit/red-team-A.md` |

**Phase 1 — build (sandbox, branch-isolated)**

| Agent | Goal | Returns |
|-------|------|---------|
| `harness-engineer` | Versioned eval harness per §8: time-correct snapshots, chronological split, per-stage metrics, marked records, verified teardown, stubbed outbound. | `/eval/harness/` |
| `isolation-verifier` | Independently prove the sandbox cannot reach production writes or send mail. Try to make it leak. | `/audit/isolation-report.md` |
| `triage-engineer` | §9.2 deterministic suppression rules; §9.3 client resolution. | branch + `/eval/ablation-00-triage-client.md` |
| `deterministic-engineer` | §9.5 steps 1–5 and 8. Target `recall@5 ≥ 0.90`. | branch + `/eval/ablation-01-deterministic.md` |
| `retrieval-ablation` | §11.2 ablation incl. learned ranker. Adopt/reject with evidence. | `/eval/ablation-02-retrieval.md` |
| `selector-engineer` | §9.6 small-tier selector with NONE and abstain; evidence-computed gate; big-tier comparison per §11.1. | branch + `/eval/ablation-03-selector.md` |
| `action-engineer` | §9.7–9.8 change extraction and validation. Owns the A→B gap. | branch + `/eval/ablation-04-actions.md` |
| `ops-engineer` | §15 queued intake, idempotency, dead-letter, alerts, staleness monitor. | branch + `/audit/ops-design.md` |
| `red-team-B` | Break the final claim. | `/audit/red-team-B.md` |

### 12.4 Concurrency
Run at most [N, default 4] subagents at once. Discovery roster may run
fully parallel. Build agents touching the same module run serially.

---

## §13. Phase 1 — Build loop and metrics

Begins only after Checkpoint A confirmation.

### 13.1 Order of work
1. `harness-engineer` and `isolation-verifier` first. No pipeline work
   until the harness reproduces the baseline score and isolation is
   verified.
2. If §6.5 found labels <99.5% clean: fix the eval set (relabel, add NONE
   and not-inquiry labels) before anything else.
3. §11.3 inject-correct-candidate diagnostic — decides whether retrieval
   or selection is the bottleneck.
4. Then the highest-leverage move from Checkpoint A, then by taxonomy
   bucket size.

### 13.2 Iteration protocol
Full dev-set eval after every meaningful change. Each iteration logs to
`/eval/iterations.md`: change, hypothesis, result per metric and per
bucket, next step.

Per-iteration report (definitions in Appendix A.3):
`inquiry_recall`, `item_correctness`, `review_rate`, `display_precision`,
`client_resolution_accuracy`, `recall@5`, `selection_given_correct_candidate`,
`none_precision`, `none_recall`, `action_accuracy`, `silent_miss_count`,
`suppression_count` by rule, `reason_code` distribution, cost per email,
p50/p95 latency.

Continue while a specific, evidence-backed next move exists.

---

## §14. Exit conditions and Checkpoint B

Stop and report when **any** holds:

1. **Targets met:** `inquiry_recall ≥ 99.5%`, `item_correctness ≥ 99%`,
   `review_rate ≤ 5%`, NONE cases included, reproducible across 3 runs on
   the locked test set.
2. **Eval is the limit:** remaining misses are ≥80% `label_wrong` or
   `genuinely_ambiguous`.
3. **Stall:** three consecutive iterations with no gain beyond the §8.9
   interval and no untested hypothesis remaining.
4. **Blocked:** you need data, labels, access, or an owner decision.

Stop report: score per metric and bucket; what was tried; apparent
ceiling and why; what would move it; a plan per gap. Note that $n = 500$
cannot statistically establish 99%; recommend a prospective shadow-mode
period (new system runs alongside production, outputs compared, nothing
written) before unattended operation.

### Checkpoint B
Deliver `/audit/final-state.md`: either "if we do X, Y, Z we reach the
targets — here is the evidence," or a precise gap report. Plus
`/audit/red-team-B.md`. Nothing ships until the owner says so.

---

## §15. Operational autonomy

The team never sees the system fail.

- Intake is queued and durable; nothing is dropped during outages or
  rate limits. Exponential backoff with jitter. Per-provider budgets with
  graceful degradation (fall back to small tier → queue-only) rather than
  hard stops.
- Processing is idempotent; replaying an email is safe.
- Dead-letter queue for unprocessable items with automatic replay after
  fixes. Dead-lettered items that look time-sensitive still surface as a
  flagged item with `reason_code = processing_failure` — recall-first
  applies to failures too.
- Health checks and alerts route to the owner, never the team.
- The display must never go stale silently; staleness is monitored.
- Every stage emits `{decision, confidence, reason}`; a miss is
  diagnosable to a stage from logs alone.

---

## §16. Working agreements

- Persist findings in the repo (`/audit`, `/eval`, `/decisions`), not
  chat. Decisions get dated entries with reasoning.
- `/audit/STATE.md` is the source of truth for where you are. Update it
  before and after every section and every session (see RUNBOOK.md).
- Prior rulings are overturnable by evidence; log every overturn.
- Ask when a question changes direction. Don't ask when it doesn't.
- No changes to production, the display, intake, or outbound mail
  without the owner's explicit authorization.
- Checkpoints are hard stops.

---

## §17. Open questions for the owner

Find evidence for each in Phase 0; present at Checkpoint A.

| # | Question | Why it matters |
|---|----------|----------------|
| Q1 | Is human confirmation a required business step for every order → job, or may the system book directly when confident? | Defines what "autonomous" means and whether `review_rate` or `auto_book_rate` is the autonomy metric. |
| Q2 | What are [METRIC A] and [METRIC B] exactly? | Determines whether 227/114 are two problems or one. |
| Q3 | Which action types are reversible vs. not? | Risk tiers; biggest lever on `review_rate`. |
| Q4 | What `display_precision` floor is acceptable once recall is secured? | When tidiness becomes a hard target. |
| Q5 | Are outbound emails and thread headers retained? Do outbound subjects contain opp IDs? | Thread linkage is likely the single largest deterministic gain. |
| Q6 | Which service hit the usage limit, and at what volume? | Shapes §15 budgets and tier split. |

---

## Appendix A

### A.1 Subagent brief template
```

AGENT: PHASE: <0|1> MODE: <read-only | branch:>

GOAL:

INPUTS: <exact paths / queries / commit hash>

OUTPUT: , conforming to , with ≤1-page summary at top

SCOPE: You may ... You may NOT ...

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will spot-check . Make that easy.

```

### A.2 File layout
```

OPERATING.md

RUNBOOK.md

/audit/STATE.md ← ledger; read first every session

/audit/reconstruction.md

/audit/alignment.md

/audit/glossary.md

/audit/pipeline-trace.md

/audit/history-and-assumptions.md

/audit/data-map.md

/audit/isolation-report.md

/audit/ops-design.md

/audit/red-team-A.md /audit/red-team-B.md

/audit/final-state.md

/eval/metrics.md

/eval/label-audit.csv

/eval/failure-taxonomy.md

/eval/harness/

/eval/ablation-NN-*.md

/eval/iterations.md

/decisions/YYYY-MM-DD-.md

```

### A.3 Metric definitions
- `inquiry_recall` = items produced for real inquiries ÷ real inquiries.
- `item_correctness` = items with correct opp-or-NONE **and** correct
  change ÷ items shown.
- `review_rate` = flagged items ÷ items shown.
- `display_precision` = items that are real inquiries ÷ items shown.
- `client_resolution_accuracy` = correct client ÷ emails with a client.
- `recall@5` = inquiries whose true opp is in top-5 ÷ inquiries with a
  true opp.
- `selection_given_correct_candidate` = correct pick ÷ cases where the
  true opp was in the candidate set.
- `none_precision` / `none_recall` on NONE outputs vs. NONE labels.
- `action_accuracy` = correct change ÷ items with correct opp.
- `silent_miss_count` = real inquiries with no item (absolute count).
