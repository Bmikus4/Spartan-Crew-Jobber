# Spec compliance: Phase 0 deliverables against OPERATING.md as written

- Agent: spec-compliance
- Brief hash: 056ac5ff
- Written (UTC): 2026-10-25T21:12:40Z (box clock, `date -u`, when writing began)
- Read: branch `v2` at HEAD 7909894 (6a98170 plus the three audit commits 5b54a78, 8f05615, 7909894), and two untracked files, `audit/briefs/spec-compliance.md` and `scripts/backfill-pause-window.mts`. Read only. No network, no model, no harness, no git write. No scratch scripts were written.

## Summary (one page)

**Counts.** 218 rows: **155 MET, 55 PARTIAL, 5 MISSING, 3 SUPERSEDED.** Every PARTIAL and MISSING row is in "Order of work" at the end.

**How to read MET.** Some rules bind the rebuilt system: the §4 gate rules, §9.9 and most of §10. For these, MET means Phase 0 established, with evidence, where the current system stands against the rule. It does not mean the system complies. Where it does not, the last column says so.

**What Phase 0 covers.** Every question in §6.1-§6.4 is answered with citations, and so is all of §6.5 as written. Each §7 item has a file. Every §17 question has an entry. All eight returns carry an agent name, brief hash and timestamp.

**What bears on the owner's decisions at Checkpoint A:**
1. **The primary metrics have no baseline over real inquiries.**
   - `item_correctness`, which §4 says is what "99% accuracy" means, has no value. Pieces of it are in the files, but nobody has put them together (S4-3).
   - `inquiry_recall` and the silent-miss count cover only emails staff acted on. The audit says this itself (S4-2, S67-1, S67-9).
   - `review_rate` appears as two figures on two definitions (S4-4).
2. **§10 asks for two proposals at Checkpoint A, and neither is in the package:**
   - an aging policy for stale items;
   - the minimal display change for flagged items (S10-6, S10-4).

   §9.9's reason-code distribution was computed in `audit/glossary.md:148-163` but is not reported at the checkpoint (S99-6). The checklist never listed any of these three (RB3-a).
3. **Four glossary discrepancies were never raised at Checkpoint A:** Job, Order, Opportunity and multi-client senders. Q1 is still put in §3's "order → job" terms, which the glossary shows to be wrong (S3-3).
4. **Spot-checks fell under 10% for three returns:**
   - archaeologist: 3 of 340 citations;
   - historian: 7 of 113 rulings;
   - data-cartographer: 4 named counts.

   The body of commit 5b54a78 says every return was checked on at least 10% (RB3-e1, e2, e4).
5. **The ledger is stale in 18 fields.**
   - Six of the seven open questions still read "open" with dispatch-time notes. The seventh (Q4) is open correctly, but its evidence predates the 59-of-62 figure.
   - The next action predates the owner's request for this review.
   - One owner ruling is in no tracked file. On 10-25 the owner said "store them without deciding" about the 40 unstored emails. Only an untracked script quotes it, while STATE.md still calls it the owner's call (RB2-17).
6. **The one-page alignment statement is 966 words.** OPERATING does not define a page, so this check uses a proxy of 600 words, about one single-spaced 11-pt page. By that proxy every return's summary is also over, by 5% to 52% (S7-3, S121-5).

**SUPERSEDED (3).**
- §2's "true baseline on 500 real inquiries". The 500 are generated mail, and the real-mail substitute does not yet give a baseline.
- Sender-to-client coverage "on the 500", and the opps-per-client distribution "on the 500". The 500's companies and domains are made up. Both substitutes, run on 30 days of real client mail, meet the purpose.

**Not in scope.**
- A.2's Phase 1 paths are not due before Checkpoint A, so they have no rows: isolation-report, ops-design, red-team-B, final-state, `eval/harness/`, the ablation files and iterations.
- `audit/` also holds pre-engagement files that A.2 does not list: `REPORT.md` and six `.mts` files, all dated 10-07.

## Table

| id | section | requirement (OPERATING's own words, quoted, at most 25) | where met (file:line or section) | status | what is missing |
|---|---|---|---|---|---|
| S2-1 | §2 :81-82 | "Staff have one action: **confirm**." | glossary.md:60; reconstruction.md:33-37; alignment.md:31-35 | MET | Checked and found false (the TV tick writes nothing, check.ts:1-6). Raised at Checkpoint A. |
| S2-2 | §2 :83-85 | "First evaluation on 500 real inquiries: 227/500 on [METRIC A], 114/500 on [METRIC B]. This is the true baseline." | Why it cannot apply: history-and-assumptions.md:552-562; metrics.md:26-29; label-audit.md:45-51. Instead: live-week real mail, failure-taxonomy.md:94-101 | SUPERSEDED | The substitute is real mail but counts only the 84 inquiries staff acted on, and has no item_correctness. checkpoint-A.md:64-73 shows no §4 metric yet has a baseline over all real inquiries, so the purpose (a true baseline) is not met. The proposed eval set is the audit's route to it. |
| S2-3 | §2 :86 | "Multiple things appear broken. Treat the current system as a bad state." | alignment.md:20-36; reconstruction.md:31-53 | MET | none |
| S2-4 | §2 :87 | "A usage limit was hit on [SERVICE]." | checkpoint-A.md:127-130 | MET | none (OpenRouter 402 on 10-11, a balance, not a rate) |
| S2-5 | §2 :88-90 | "The team using the system should never need to intervene except to make a decision the system genuinely cannot." | reconstruction.md:29, :305-312; checkpoint-A.md:70 | MET | The gap is measured, not closed: staff do every booking, and 3 of 84 inquiries were completed durably. |
| S2-6 | §2 :90-91 | "Operational failures (rate limits, outages, parse errors) must never be visible to the team." | pipeline-trace.md:165, :205, :467; failure-taxonomy.md:514-516; checkpoint-A.md:22-23 | PARTIAL | The failure paths are traced. No file checks the TV against this rule or counts the listed items that are operational failures, not requests: `system_failed`, "could not read", "could not plan", held-link cards. |
| S2-7 | §2 :92 | "previous known-good version [NAME/TAG]" | history-and-assumptions.md:494-515; checkpoint-A.md:9-12 | MET | none. Nothing is named known-good; six candidates are weighed. |
| S2-8 | §2 :93 | "the owner's audit [LOCATION]" | history-and-assumptions.md:571 | PARTIAL | Four candidates are named. The 10-03 audit is a claude.ai doc that was not read offline (:571, :590-592). checkpoint-A.md:131 asks which is meant; alignment.md:56-62 does not. |
| S2-9 | §2 :93-94 | "the previous 99% plan [LOCATION]" | history-and-assumptions.md:572, :293-491 | PARTIAL | Ten plans are analysed. Two candidate docs (the V1 spec, the matcher plan) were not readable offline (:572, :590-592). The owner has not confirmed which plan is meant. |
| S2-10 | §2 :94 | "the 500-item results with input/expected/actual [LOCATION]" | history-and-assumptions.md:544-549, :573; metrics.md:22-23 | MET | none. The 227/114 runs were overwritten, and both figures were reproduced in-process. |
| S2-11 | §2 :94-95 | "historical client emails, outbound mail, and opportunity records" | data-map.md:31-182 | MET | none (inbound_raw is not in the snapshot, data-map.md:83-85) |
| S3-1 | §3 :101 | "Verify against code and data in Phase 0" | glossary.md:50-61 (10 of 10 terms) | MET | none |
| S3-2 | §3 :101-102 | "log any discrepancy in `/audit/glossary.md`" | glossary.md:10-18, :50-66 | MET | none |
| S3-3 | §3 :102 | "and raise it at Checkpoint A." | Confirm: alignment.md:31-35. Item: reconstruction.md:33-37. Inquiry: reconstruction.md:38 | PARTIAL | Four discrepancies are raised in no Checkpoint A file: Job is a child record from creation (glossary.md:56), Order is the booking at every stage (:55), Opportunity is orders only with cancelled ones excluded (:54), and multi-client senders are not served (:53). The Job point appears only in STATE.md:48. |
| S3-4 | §3 :117-123 | "Decision set per inbound email (hypothesis — verify in Phase 0)" | glossary.md:138-146; reconstruction.md:68-87 | MET | none |
| S4-1 | §4 :133-143 | "The owner's ranking of outcomes, worst to acceptable: ... silent miss ... wrong item ... noise ... flagged decision." | alignment.md:14-18; metrics.md:241-254 | MET | none |
| S4-2 | §4 :149 | "`inquiry_recall` ≥ 99.5% Of real inquiries, fraction producing an item. Primary." | checkpoint-A.md:68; failure-taxonomy.md:94-101; reconstruction.md:263 | PARTIAL | 80/84 = 95.2% (79/84 with the ambiguous `none`) is over inquiries staff acted on. A request nobody acted on is excluded by construction (reconstruction.md:265). There is no baseline over all real inquiries. |
| S4-3 | §4 :150 | "`item_correctness` ≥ 99% ... correct opp (or correct NONE/new-order) **and** correct requested change. ... This is what '99% accuracy' means." | checkpoint-A.md:69 | PARTIAL | There is no value: "not measurable: no labels for listed items". Pieces in the files are not put together: 29/29 gold items that name an order (metrics.md:294); 0 of 19 gold writes on a wrong order (failure-taxonomy.md:273); 3 wrong writes and 13 rebuilt creates in the live week (reconstruction.md:307-309). |
| S4-4 | §4 :151 | "`review_rate` ≤ 5% Of items, fraction flagged needs-decision rather than confirm-ready." | checkpoint-A.md:70; reconstruction.md:201 | PARTIAL | Two figures on two meanings of "item": 100% by construction over listed cards (checkpoint-A.md:70), and 207/275 = 75.3% over writes plus handoffs (reconstruction.md:201; metrics.md:295). They are not reconciled, and both are deferred to Q1. |
| S4-5 | §4 :152 | "`display_precision` track; improve Of items, fraction that are real inquiries." | checkpoint-A.md:71 | PARTIAL | The only figure is 59 of 62 listed rows, from a set drawn from staff-worked emails. Noise was not tested (reconstruction.md:326). metrics.md:296 says it is not computable yet. |
| S4-6 | §4 :152 | "Set a floor with the owner after Phase 0." | alignment.md:62; checkpoint-A.md:121 | MET | Asked. The evidence behind it is thin (S4-5). |
| S4-7 | §4 :153 | "`client_resolution_accuracy` report Nothing downstream can exceed it." | checkpoint-A.md:72; reconstruction.md:237-239 | PARTIAL | The figure reported is coverage (85.9% and 82.2% stored, 89.1% replayed), not A.3's correct client ÷ emails with a client. Accuracy rests on 92 hand links and gold 186/189 (metrics.md:297), with 2 wrong companies (failure-taxonomy.md:272). There is no live-week accuracy. |
| S4-8 | §4 :154 | "`none_precision` / `none_recall` report "No existing opp → new order" is a first-class answer." | checkpoint-A.md:73; failure-taxonomy.md:361-372 | PARTIAL | Only recall is given: 38/43, from one reader. none_precision (NONE outputs that were right) is reported nowhere. |
| S4-9 | §4 :158 | "Uncertain whether an email is an inquiry → treat as inquiry, show it." | reconstruction.md:73, :139; failure-taxonomy.md:104 | MET | The system does not comply: model `info_only` makes `none`, which is never shown, and this caused 1 strict silent miss. |
| S4-10 | §4 :159-160 | "Uncertain which opp → show best candidate, flagged, with top-3 attached. Never drop." | reconstruction.md:75; pipeline-trace.md:444-474 | PARTIAL | The drop paths are documented. No file examines whether a handoff card carries a best candidate or any top-3. |
| S4-11 | §4 :161-163 | "Suppression ... is only permitted via **deterministic, auditable rules** ... never via model judgment alone." | reconstruction.md:327; failure-taxonomy.md:378-387 | MET | The system does not comply: the sender regex is the only rule, and the model suppressed all 21 auto-reply or newsletter-like emails. |
| S4-12 | §4 :163-164 | "Every suppression is logged with its rule." | pipeline-trace.md:130, :206; glossary.md:150-162 | MET | Logged as reason text. Codes are stamped only from 10-24, so snapshot rows have none. |
| S4-13 | §4 :165-166 | "Report a precision-vs-coverage curve across gate thresholds, not a single number." | not found: alignment.md, checkpoint-A.md and reconstruction.md contain "threshold" and "curve" 0 times | MISSING | Every Checkpoint A figure is a single number. No file says whether the current gate has thresholds at all (its policy rules are binary), which would make the curve not yet applicable. |
| S4-14 | §4 :168-169 | "Phase 0 enumerates action types from the code and data" | reconstruction.md:146-160; checkpoint-A.md:92 | MET | none |
| S4-15 | §4 :169 | "and proposes tiers by reversibility and impact." | checkpoint-A.md:90-102 | MET | T3 rests on Q3, which was not measured (checkpoint-A.md:94). |
| S4-16 | §4 :169-170 | "Owner reviews at Checkpoint A." | checkpoint-A.md:90-104 | MET | The tiers are in the package, but the one-page decision list names only Q3 (alignment.md:56-62). |
| S4-17 | §4 :170 | "Lean recall-first within every tier." | checkpoint-A.md:104 | MET | none |
| S6-1 | §6 :202-203 | "Dispatch the Phase 0 discovery roster (§12.3) in parallel" | STATE.md:9-11, :31-38 | MET | none |
| S6-2 | §6 :203 | "verify returns" | STATE.md:31-38 | PARTIAL | Three returns were checked on under 10% (RB3-e1, e2, e4). Commit 5b54a78's body says all were checked on at least 10%. |
| S6-3 | §6 :203-204 | "then produce the **System Reconstruction** in `/audit/reconstruction.md`." | reconstruction.md:1-327 | MET | none |
| S61-1 | §6.1 :207-208 | "What does this automation exist to do, in one paragraph a non-engineer would sign?" | reconstruction.md:57 | MET | none |
| S61-2 | §6.1 :208 | "Who consumes each output?" | reconstruction.md:59-66 | MET | none |
| S61-3 | §6.1 :208-209 | "What does "correct" mean to that person?" | reconstruction.md:61-66 | MET | none |
| S61-4 | §6.1 :210 | "List every decision the system makes per inbound email" | reconstruction.md:68-87 | MET | none |
| S61-5 | §6.1 :210-211 | "(compare to the §3 hypothesis; correct it)." | reconstruction.md:68, :73, :85; glossary.md:138-146 | MET | none |
| S61-6 | §6.1 :212-213 | "Answer §17 Q1 from the code: does every order require human confirm, or can the system book directly?" | reconstruction.md:89-102; glossary.md:68-136 | MET | none. The code answer is given (creates: yes; edits: none), and booking directly is left to the owner. |
| S62-1 | §6.2 :216 | "One email traced end-to-end: every stage, transform, model call, write." | pipeline-trace.md:271-311, :315-348 | MET | none. Two emails are traced, and the model call is shown from the stored reading ($0). |
| S62-2 | §6.2 :217 | "Diagram it." | pipeline-trace.md:37-73; reconstruction.md:108-123 | MET | none |
| S62-3 | §6.2 :218 | "Per stage: input" | pipeline-trace.md:99-206 (S0-S8 labelled), :208-267 (S9-S17 in prose) | MET | none |
| S62-4 | §6.2 :218 | "[Per stage:] output" | pipeline-trace.md:99-206, :208-267 | MET | none |
| S62-5 | §6.2 :218 | "[Per stage:] failure modes" | pipeline-trace.md:102, :117-122, :129, :148, :158, :165, :180, :205, :231 | PARTIAL | Given for 9 of 18 stages. Missing for S3 (sender filter), S9 (record), S10 (link), S12 (retries and sweep), S13 (replan), S14 (link sweeps), S15 (TV projection), S16 (verifier and tick) and S17 (labels). |
| S62-6 | §6.2 :218 | "[Per stage:] existing logging" | pipeline-trace.md:103, :123, :130, :137, :149, :166, :181, :206, :232 | PARTIAL | Given for 9 of 18 stages. Missing for S5, S10 and S12-S17. S9 is itself the record. |
| S62-7 | §6.2 :219 | "What is deterministic today vs. delegated to a model?" | pipeline-trace.md:352-385; reconstruction.md:125 | MET | none |
| S62-8 | §6.2 :219-220 | "Where does a model choose something code could have known?" | pipeline-trace.md:387-394 | MET | none |
| S62-9 | §6.2 :221 | "Does the system read thread headers (`In-Reply-To`,`References`)" | pipeline-trace.md:398-402; reconstruction.md:131 | MET | none |
| S62-10 | §6.2 :222 | "and quoted text?" | pipeline-trace.md:403-408; reconstruction.md:132-134 | MET | none |
| S62-11 | §6.2 :223 | "Does it resolve the client **before** considering opps" | pipeline-trace.md:414; reconstruction.md:135-136 | MET | none |
| S62-12 | §6.2 :224 | "and scope candidates to that client's opps?" | pipeline-trace.md:414-421; reconstruction.md:136-137 | MET | none |
| S62-13 | §6.2 :225 | "Can it output "no existing opp → new order"?" | pipeline-trace.md:428-433; reconstruction.md:138 | MET | none |
| S62-14 | §6.2 :225-226 | "Can it output "not an inquiry"?" | pipeline-trace.md:434-438; reconstruction.md:139 | MET | none |
| S62-15 | §6.2 :226-227 | "If either is impossible, note it: those cases are currently guaranteed wrong." | reconstruction.md:139; failure-taxonomy.md:384-387 | MET | Noted. The audit calls `none` right for a non-inquiry but indistinguishable from a miss. That judgment is outside this check. |
| S62-16 | §6.2 :228 | "How does an item reach the display?" | pipeline-trace.md:444; reconstruction.md:141 | MET | none |
| S62-17 | §6.2 :228 | "What makes it disappear?" | pipeline-trace.md:453-467; reconstruction.md:143-144 | MET | none |
| S62-18 | §6.2 :229 | "Is there per-thread dedupe?" | pipeline-trace.md:446-451; reconstruction.md:142 | MET | none |
| S62-19 | §6.2 :229 | "What happens to an item nobody confirms?" | pipeline-trace.md:469-474; reconstruction.md:145 | MET | none |
| S63-1 | §6.3 :232 | "Original design intent." | history-and-assumptions.md:17-20, :82 | MET | none |
| S63-2 | §6.3 :232 | "What changed since, and why." | history-and-assumptions.md:22-33, :79-113 | MET | none |
| S63-3 | §6.3 :233 | "Every prior ruling: enforced in code / dead / contradicted by another." | history-and-assumptions.md:35-44, :121-292 (113 rows: 76 / 12 / 25) | MET | Spot-checked on 7 rows only (RB3-e2). |
| S63-4 | §6.3 :234 | "Why did the previous 99% plan believe 99% was reachable?" | history-and-assumptions.md:46-59, :293-491 | MET | none |
| S63-5 | §6.3 :234-235 | "Which assumptions does real data contradict?" | history-and-assumptions.md:56-59, :479-490 | MET | none |
| S64-1 | §6.4 :238 | "Define [METRIC A] and [METRIC B] precisely from the scoring code" | metrics.md:10-23, :78-135 | MET | none |
| S64-2 | §6.4 :239 | "what is compared to what, how a match is decided." | metrics.md:19-21 | MET | none |
| S64-3 | §6.4 :240-241 | "Is B downstream of A (wrong A forces wrong B)? If so, say so" | metrics.md:42-45, :208-218 | MET | none (no; the dependency inside `e2e` is named) |
| S64-4 | §6.4 :242-243 | "Are A and B the right metrics for §6.1's purpose and §4's loss function?" | metrics.md:47-57, :220-254 | MET | none |
| S64-5 | §6.4 :243-244 | "If not, propose the §4 metrics as replacements." | metrics.md:59-66, :270-275; checkpoint-A.md:106-110 | MET | none |
| S64-6 | §6.4 :244 | "Do not change scoring silently." | metrics.md:74; reconstruction.md:198; `git show --stat 5b54a78 8f05615 7909894` (audit, eval, OPERATING.md, RUNBOOK.md and feed.json only) | MET | none |
| S65-1 | §6.5 :247 | "How were the 500 labeled, by whom, under what rules?" | label-audit.md:101-113, :115-130 | MET | none |
| S65-2 | §6.5 :248 | "Hand-verify ≥50, including ≥30 misses." | label-audit.md:7, :24-26; label-audit.csv (98 rows) | MET | Done on the generated sets as written: 98 rows, 59 of them misses. The real-mail labels the §4 metrics are to stand on (reconstruction.md:210-214) have no comparable sample: label_wrong is one reader's call, and the re-check covered 14 rows without reading the text (reconstruction.md:252). |
| S65-3 | §6.5 :248-250 | "Classify each: label correct / label wrong / genuinely ambiguous / multi-opp / correct answer is NONE / correct answer is "not an inquiry"." | label-audit.md:16-22; label-audit.csv `class` (40 correct, 57 wrong, 1 ambiguous) | MET | none |
| S65-4 | §6.5 :251 | "Report label error rate." | label-audit.md:11-14, :19 | MET | none (532/1,000, projected from 98) |
| S65-5 | §6.5 :251-252 | "If labels are <99.5% clean, the targets are unmeasurable and fixing the eval set is the first Phase 1 task." | label-audit.md:13-14; reconstruction.md:207; alignment.md:51 | MET | none |
| S65-6 | §6.5 :253 | "Do the labels include NONE and not-an-inquiry cases?" | label-audit.md:53-59 | MET | none |
| S65-7 | §6.5 :253 | "If not, they must." | checkpoint-A.md:53-56 | MET | The update set has neither. The proposed real-mail set labels both but is not built yet (Phase 1). |
| S66-1 | §6.6 :256-257 | "email archive (headers retained? quoted text? attachments?)" | data-map.md:33-69 | MET | none |
| S66-2 | §6.6 :257-258 | "outbound mail (retained? subjects contain job IDs?)" | data-map.md:71-81 | MET | none. Drafts cannot be counted offline (:81). |
| S66-3 | §6.6 :258 | "opp records (fields, statuses, timestamps, addresses)" | data-map.md:87-121 | MET | none |
| S66-4 | §6.6 :258-259 | "staff confirmations (logged? timestamped?)" | data-map.md:12, :123-146 | MET | none |
| S66-5 | §6.6 :260 | "How they join." | data-map.md:184-213 | MET | none |
| S66-6 | §6.6 :260 | "Sender → client coverage on the 500 specifically." | Why it cannot apply: label-audit.md:45-51 (the 500's companies 9001-9012 and 11 domains are absent from real data); reconstruction.md:209. Instead: data-map.md:215-234 | SUPERSEDED | The substitute meets the purpose: 1,175 of 1,319 real client emails resolved (89.1%), with 0 disagreements in 92 hand links. But 89.1% is a replay; production stored a company for 82.2% and 85.9% (reconstruction.md:237). No file states the reason for the switch; it follows from label-audit.md. |
| S66-7 | §6.6 :261-262 | "Distribution of opps-per-client (all statuses) on the 500." | Why it cannot apply: label-audit.md:45-51. Instead: data-map.md:238-261 | SUPERSEDED | The substitute meets the purpose: median 7, p90 48, max 288 in all statuses; live pool median 2 (83.4% at 5 or fewer). For 26 of 112 companies the history is cut off by the 3,500-order snapshot (data-map.md:240). |
| S67-1 | §6.7 :265 | "Every miss bucketed by root cause at the **first** stage that failed" | failure-taxonomy.md:24-39, :142-248, :446+ (117 rows); gold :249-285 (100 rows) | PARTIAL | Misses among the live week's 246 `none` and 45 no-work handoffs are not bucketed: 291 of 400 emails were never read (failure-taxonomy.md:380-382; reconstruction.md:265). |
| S67-2 | §6.7 :266-268 | "`not_recognized_as_inquiry` / ... / `genuinely_ambiguous`. Counts per bucket." | failure-taxonomy.md:26-37, :259-269 | MET | none |
| S67-3 | §6.7 :269 | "Slice by client" | failure-taxonomy.md:331-350 | MET | none |
| S67-4 | §6.7 :269 | "[Slice by] inquiry type" | failure-taxonomy.md:311-329 | MET | none |
| S67-5 | §6.7 :269 | "[Slice by] date." | failure-taxonomy.md:291-309 | MET | none |
| S67-6 | §6.7 :269-270 | "Near-total failure in any slice is a pipeline break, not a model problem." | failure-taxonomy.md:41-50, :304-309, :323-329, :347-356 | MET | none |
| S67-7 | §6.7 :271 | "Specifically count: emails whose correct answer was NONE or not-an-inquiry" | failure-taxonomy.md:359-382 | MET | none |
| S67-8 | §6.7 :272 | "and whether the system was *able* to say so." | failure-taxonomy.md:365-375, :384-387 | MET | none |
| S67-9 | §6.7 :273 | "**Silent-miss count:** real inquiries that produced no item at all." | failure-taxonomy.md:10-14, :94-115 | PARTIAL | 4 of 84 counts only inquiries staff acted on (19 on the wide reading). A request nobody acted on cannot appear (reconstruction.md:265; checkpoint-A.md:44-45; red-team-A.md:24-27). |
| S67-10 | §6.7 :274 | "This is the §4 worst case; report it first." | failure-taxonomy.md:10, :68-115; reconstruction.md:263 | MET | none |
| S7-1 | §7 :282 | "`/audit/reconstruction.md` (§6.1–6.7)." | reconstruction.md:55-327 | MET | none |
| S7-2 | §7 :283-284 | "`/audit/red-team-A.md` — a fresh subagent's attempt to break your conclusions." | red-team-A.md:1-45; STATE.md:34 | MET | none |
| S7-3 | §7 :285 | "`/audit/alignment.md` — **one page**" | alignment.md (62 lines, 966 words, `wc -w`) | PARTIAL | About 1.6 pages at the 600-word proxy. |
| S7-4 | §7 :285 | "what this system is for" | alignment.md:5-10 | MET | none |
| S7-5 | §7 :286 | "what correct means" | alignment.md:12-18 | MET | none |
| S7-6 | §7 :286 | "what is actually broken and why" | alignment.md:20-36 | MET | none |
| S7-7 | §7 :286 | "what you propose." | alignment.md:45-54 | MET | none |
| S7-8 | §7 :287-288 | "**Stabilization recommendation:** should production revert to [NAME/TAG]?" | checkpoint-A.md:5-25 | MET | none |
| S7-9 | §7 :288-289 | "Exactly what would you verify to call it healthy?" | checkpoint-A.md:27-39 | MET | none. Check 2, a Gmail-side count, is proposed but not built (alignment.md:47). |
| S7-10 | §7 :289 | "The owner executes or explicitly authorizes you to." | STATE.md:62-70; commit 8f05615 | MET | none. The one change made rests on the owner's recorded words. |
| S7-11 | §7 :290 | "**Highest-leverage move,** backed by the taxonomy" | checkpoint-A.md:41-62 | MET | none |
| S7-12 | §7 :290-291 | "with expected gain on each §4 metric." | checkpoint-A.md:64-73 | MET | Every §4 metric has a row, and the stated gain in value is zero for each (:64). The three follow-on moves (:75-80) carry counts but no gain per metric. |
| S7-13 | §7 :292 | "Proposed risk tiers (§4)" | checkpoint-A.md:90-104 | MET | none |
| S7-14 | §7 :292 | "and proposed metric replacements (§6.4)." | checkpoint-A.md:106-110 | MET | none |
| S7-15 | §7 :293 | "Answers or evidence for every §17 question." | checkpoint-A.md:112-134 | MET | Q3 and Q4 are thin (S17-3, S17-4). |
| S7-16 | §7 :295-296 | "Then **wait.** Nothing in Phase 1 begins until the owner confirms the alignment statement." | STATE.md:6, :100-102; no `eval/harness/`; no `sandbox/*` branch (`git branch -a`) | MET | none |
| S7-17 | §7 :296 | "If the owner corrects it, revise and re-present." | alignment.md:36; checkpoint-A.md:21-25; commit 8f05615 changed alignment.md after the 10-25 ruling | MET | none |
| S99-1 | §9.9 :450 | "**Confirm-ready:** gate cleared, validation passed. One tap for staff." | reconstruction.md:37, :85; glossary.md:42 | MET | The state does not exist; a write runs at once. |
| S99-2 | §9.9 :451 | "**Flagged:** needs a decision. Carries `reason_code`, top-3, evidence." | pipeline-trace.md:206 | PARTIAL | reason_code has been stamped since 10-24. Whether a card carries candidates or evidence is not examined. |
| S99-3 | §9.9 :453 | "**Suppressed:** by deterministic rule only. Logged." | reconstruction.md:327; pipeline-trace.md:206 | MET | The system does not comply: the model suppresses (S4-11). |
| S99-4 | §9.9 :454 | "One item per thread" | pipeline-trace.md:447-448 | MET | The system has one card per thread, with one item per email's need. |
| S99-5 | §9.9 :454-455 | "later emails in a thread update the item rather than creating another." | pipeline-trace.md:448-451 | MET | Established: each email's need is its own item (v2.ts:110). A later email answers a need only for its days or its order. |
| S99-6 | §9.9 :456-458 | "The reason_code distribution is the engineering backlog ... Report it at every checkpoint." | computed: glossary.md:148-163 (847 snapshot decisions); failure-taxonomy.md:259-269 (gold) | PARTIAL | It is in no Checkpoint A file: alignment.md and checkpoint-A.md never mention reason codes, and reconstruction.md:118 names only the column. There is no distribution for the live week or for flagged items. |
| S10-1 | §10 :479-481 | "Dedupe per thread, deterministic suppression, and stale-item handling are your responsibility." | reconstruction.md:140-145, :327 | MET | none. The current behaviour of all three is established. |
| S10-2 | §10 :482-484 | "Every item must be correct and complete enough that confirm is safe." | checkpoint-A.md:69; glossary.md:60 | PARTIAL | Item correctness is unmeasured (S4-3). Today's tick writes nothing, so a confirm itself carries no write risk. |
| S10-3 | §10 :485-486 | "Flagged items must be visually distinguishable from confirm-ready ones and must show their top-3 and evidence." | reconstruction.md:37 | PARTIAL | There are no confirm-ready items to tell apart. What a card shows (candidates, evidence) is not examined. |
| S10-4 | §10 :486-487 | "Propose the minimal display change needed for this" | not found | MISSING | The only display change proposed is the needs-reply clearing rule (checkpoint-A.md:77-79), which is a different change. |
| S10-5 | §10 :487-488 | "do not implement display changes without authorization" | `git show --stat 8f05615 7909894` (no display code); STATE.md:65-70 | MET | none. The "Intake Paused" banner went through Settings, on the owner's recorded words. |
| S10-6 | §10 :489-490 | "Stale items: define an aging policy (time-sensitive escalate; stale non-urgent consolidate, never silently vanish). Propose at Checkpoint A." | Current lifecycle only: reconstruction.md:144-145; pipeline-trace.md:462-463, :469-474 | MISSING | Silent vanishing is documented, at the last job day and after 14 quiet days. No policy is proposed. |
| S10-7 | §10 :491 | "items carry `status ∈ {confirm_ready, flagged, confirmed, suppressed}`" | glossary.md:59-60; pipeline-trace.md:453-467 | PARTIAL | The current kinds and marks are documented, but not mapped to the four statuses. confirm_ready has no counterpart, and suppressed (`none`) is not an item at all (v2.ts:109). |
| S10-8 | §10 :492 | "plus room for a future `rejected`/`held` with reason (§5)." | not found | MISSING | No file examines whether feed_marks or v2_decisions could hold such a state. No Phase 0 choice blocks it. |
| S10-9 | §10 :493 | "Do not build the reject path." | no app/ change after 6a98170 (`git show --stat`, three commits) | MET | none |
| S121-1 | §12.1 r5 :551 | "Every return is a file under `/audit`, `/eval`, or `/decisions`" | STATE.md:31-38 (8 of 8) | MET | none |
| S121-2 | §12.1 r5 :552 | "with agent name" | pipeline-trace.md:3; history-and-assumptions.md:3; data-map.md:1; glossary.md:3; metrics.md:3; label-audit.md:3; failure-taxonomy.md:3; red-team-A.md:3 | MET | none |
| S121-3 | §12.1 r5 :552 | "brief hash" | line 4 of each (data-map.md:2) | MET | none |
| S121-4 | §12.1 r5 :552 | "timestamp" | line 5 of each (data-map.md:3) | MET | none |
| S121-5 | §12.1 r5 :552 | "and a ≤1-page summary at top." | pipeline-trace.md:10-19 (666 words); history-and-assumptions.md:15-74 (638); data-map.md:6-17 (715); glossary.md:8-43 (743); metrics.md:8-75 (747); label-audit.md:9-64 (630); failure-taxonomy.md:8-65 (912); red-team-A.md:8-45 (744) | PARTIAL | All 8 summaries are at the top. At the 600-word proxy all 8 run over, from 5% to 52%. |
| S16-1 | §16 :683-684 | "Persist findings in the repo (`/audit`, `/eval`, `/decisions`), not chat." | audit/, eval/ (commit 5b54a78) | MET | none |
| S16-2 | §16 :684 | "Decisions get dated entries with reasoning." | STATE.md:61-75 | PARTIAL | Dated entries are inline in STATE.md, and `decisions/` is empty. The owner's 10-25 "store them without deciding" (scripts/backfill-pause-window.mts:4, untracked) has no entry. |
| S16-3 | §16 :685-686 | "`/audit/STATE.md` is the source of truth ... Update it before and after every section and every session" | STATE.md:3 | PARTIAL | Stale in 18 fields (RB2 rows). The 10-25 review work is not recorded. |
| S16-4 | §16 :687 | "Prior rulings are overturnable by evidence; log every overturn." | history-and-assumptions.md:121-292 | MET | none. No ruling was overturned by this engagement, and the 25 contradicted rulings are logged. |
| S16-5 | §16 :688 | "Ask when a question changes direction. Don't ask when it doesn't." | alignment.md:56-62 | MET | none |
| S16-6 | §16 :689-690 | "No changes to production, the display, intake, or outbound mail without the owner's explicit authorization." | STATE.md:62-75; commit 8f05615 | MET | The Settings flip and the Intake Watchdog rest on the owner's words. The temporary list-only n8n workflow on intake's Gmail credential (STATE.md:71-73) rests on a request to "check gmail", not on approval of that method. |
| S16-7 | §16 :691 | "Checkpoints are hard stops." | STATE.md:6, :100-102 | MET | none |
| S17-1 | §17 :701 | "Q1 Is human confirmation a required business step for every order → job, or may the system book directly when confident?" | checkpoint-A.md:114-118; reconstruction.md:89-102 | MET | none |
| S17-2 | §17 :702 | "Q2 What are [METRIC A] and [METRIC B] exactly?" | checkpoint-A.md:119; metrics.md:10-23 | MET | none |
| S17-3 | §17 :703 | "Q3 Which action types are reversible vs. not?" | checkpoint-A.md:92-102, :120 | PARTIAL | Creates are measured (11 of 21 deleted). That an edit notifies crew comes from a code comment and was never measured (:94); the timeline holds no notification actions (glossary.md:168). |
| S17-4 | §17 :704 | "Q4 What `display_precision` floor is acceptable once recall is secured?" | checkpoint-A.md:121, :71 | PARTIAL | The owner is asked, but the only figure is 59 of 62 on a staff-worked set (S4-5). |
| S17-5 | §17 :705 | "Q5 Are outbound emails and thread headers retained? Do outbound subjects contain opp IDs?" | checkpoint-A.md:122-126; data-map.md:9-10, :71-81 | MET | none |
| S17-6 | §17 :706 | "Q6 Which service hit the usage limit, and at what volume?" | checkpoint-A.md:127-130 | MET | Volume is today's (3-103 model calls a day), not the 10-11 volume. The limit was a balance, not a rate. |
| S17-7 | §17 :697 | "Find evidence for each in Phase 0; present at Checkpoint A." | checkpoint-A.md:112-134 | MET | Presented in checkpoint-A.md, not in the one-page message (RB6-8). |
| A2-1 | A.2 :734-736 | "OPERATING.md" "RUNBOOK.md" | repo root | MET | none |
| A2-2 | A.2 :738 | "/audit/STATE.md ← ledger; read first every session" | audit/STATE.md | MET | none |
| A2-3 | A.2 :740 | "/audit/reconstruction.md" | audit/reconstruction.md | MET | none |
| A2-4 | A.2 :742 | "/audit/alignment.md" | audit/alignment.md | MET | none |
| A2-5 | A.2 :744 | "/audit/glossary.md" | audit/glossary.md | MET | none |
| A2-6 | A.2 :746 | "/audit/pipeline-trace.md" | audit/pipeline-trace.md | MET | none |
| A2-7 | A.2 :748 | "/audit/history-and-assumptions.md" | audit/history-and-assumptions.md | MET | none |
| A2-8 | A.2 :750 | "/audit/data-map.md" | audit/data-map.md | MET | none |
| A2-9 | A.2 :756 | "/audit/red-team-A.md" | audit/red-team-A.md | MET | none |
| A2-10 | A.2 :760 | "/eval/metrics.md" | eval/metrics.md | MET | none |
| A2-11 | A.2 :762 | "/eval/label-audit.csv" | eval/label-audit.csv | MET | none |
| A2-12 | A.2 :764 | "/eval/failure-taxonomy.md" | eval/failure-taxonomy.md | MET | none |
| A2-13 | A.2 :772 | "/decisions/YYYY-MM-DD-.md" | `decisions/` exists and is empty (`ls -la`) | MISSING | No decision file exists. Decisions live in STATE.md:61-75. |
| A3-1 | A.3 :777 | "`inquiry_recall` = items produced for real inquiries ÷ real inquiries." | metrics.md:293 | MET | none. The Checkpoint A value uses a narrower denominator (S4-2). |
| A3-2 | A.3 :778-779 | "`item_correctness` = items with correct opp-or-NONE **and** correct change ÷ items shown." | metrics.md:294 | MET | none |
| A3-3 | A.3 :780 | "`review_rate` = flagged items ÷ items shown." | metrics.md:295 | PARTIAL | metrics.md:295 counts verified writes as items shown, though the TV never lists them (serve.ts:116, pipeline-trace.md:444). checkpoint-A.md:70 counts listed cards. The two are not reconciled. |
| A3-4 | A.3 :781 | "`display_precision` = items that are real inquiries ÷ items shown." | metrics.md:296 | MET | none. The path is named, and it needs a not-inquiry label. |
| A3-5 | A.3 :782 | "`client_resolution_accuracy` = correct client ÷ emails with a client." | metrics.md:297 | MET | none. Checkpoint A quotes coverage instead (S4-7). |
| A3-6 | A.3 :783-784 | "`recall@5` = inquiries whose true opp is in top-5 ÷ inquiries with a true opp." | metrics.md:298 | MET | none. Not run; the live planner exposes no ranked list. |
| A3-7 | A.3 :785-786 | "`selection_given_correct_candidate` = correct pick ÷ cases where the true opp was in the candidate set." | metrics.md:299 | MET | none |
| A3-8 | A.3 :787 | "`none_precision` / `none_recall` on NONE outputs vs. NONE labels." | metrics.md:300 | MET | none. Precision is never computed (S4-8). |
| A3-9 | A.3 :788 | "`action_accuracy` = correct change ÷ items with correct opp." | metrics.md:301 | MET | none |
| A3-10 | A.3 :789 | "`silent_miss_count` = real inquiries with no item (absolute count)." | metrics.md:302; failure-taxonomy.md:94-101 | MET | none. The count covers staff-acted inquiries only (S67-9). |
| RB2-1 | RUNBOOK §2 :36 | "Updated: Session:" | STATE.md:3 | PARTIAL | Stale: it reads 2026-10-24, session 1, though the file has 10-25 entries (:34, :65, :71) and was last written 10-25 09:32 local (`ls -la`). |
| RB2-2 | RUNBOOK §2 (ledger) | session plan field ("Write this session's plan into STATE.md before doing any work", RUNBOOK :20) | STATE.md:8-12 | PARTIAL | Stale: it is still session 1's plan ("Session 2: receive, spot-check..." is done). There is no plan for the 10-25 work, including this review (briefs/spec-compliance.md, written 10-25 16:58 local). |
| RB2-3 | RUNBOOK §2 :39 | "Phase: <0\|1> Current section: <§n> Status:" | STATE.md:6 | MET | none. Current: the owner has not confirmed the alignment. |
| RB2-4 | RUNBOOK §2 :41-44 | "Section checklist" | STATE.md:15-26 | PARTIAL | Stale: :23 says "draft, before red team" and :24 says "draft", though both files were revised after red team A (reconstruction.md:6; checkpoint-A.md:3). §7 items 4-7, §10's two proposals and §9.9's report are not items. |
| RB2-5 | RUNBOOK §2 :45-46 | "Active subagents \| agent \| brief hash \| dispatched \| expected output \| status \|" | STATE.md:28-38 | PARTIAL | Stale: there is no row for spec-compliance (056ac5ff). The eight accepted agents stay in the table, although RUNBOOK §5.3 moves them to the checklist on acceptance. |
| RB2-6 | RUNBOOK §2 :48 | "Handoff notes" (§6.7 line) | STATE.md:46 | PARTIAL | Stale: it says "12 right creates rebuilt by staff". The accepted hit N2 makes it 9 equal by day, times and crew, and 7 with trades (checkpoint-A.md:149). |
| RB2-7 | RUNBOOK §2 :48 | "Handoff notes" (§6.6 line) | STATE.md:45 | PARTIAL | Stale: it says "sender->client 89.1%" without accepted N5: production stored 85.9% and 82.2%, with 2 wrong companies (checkpoint-A.md:152). |
| RB2-8 | RUNBOOK §2 :48 | "Handoff notes" (§6.4 line) | STATE.md:41 | PARTIAL | Stale: the first cut "silent misses 104 ... VERIFY before use" was checked, and its 79 `none_nothing_to_do` misses are a label artefact (failure-taxonomy.md:64; reconstruction.md:274). The note does not say so. |
| RB2-9 | RUNBOOK §2 :51-52 | "Open questions" (Q1) | STATE.md:53 | PARTIAL | Stale: "glossary-verifier to settle ... open". It was settled from code (reconstruction.md:89-102; checkpoint-A.md:114-118); only the owner's part is open. |
| RB2-10 | RUNBOOK §2 :51-52 | "Open questions" (Q2) | STATE.md:54 | PARTIAL | Stale: "metric-definer to verify ... open". Verified and answered (metrics.md:10-23; checkpoint-A.md:119). |
| RB2-11 | RUNBOOK §2 :51-52 | "Open questions" (Q3) | STATE.md:55 | PARTIAL | Stale: "not started". Tiers and evidence are in checkpoint-A.md:90-104, :120. |
| RB2-12 | RUNBOOK §2 :51-52 | "Open questions" (Q4) | STATE.md:56 | PARTIAL | Stale: the evidence column predates the 59-of-62 figure (checkpoint-A.md:71). "open" is right. |
| RB2-13 | RUNBOOK §2 :51-52 | "Open questions" (Q5) | STATE.md:57 | PARTIAL | Stale: "data-cartographer to count". Counted (checkpoint-A.md:122-126). |
| RB2-14 | RUNBOOK §2 :51-52 | "Open questions" (Q6) | STATE.md:58 | PARTIAL | Stale: "not started". Answered (checkpoint-A.md:127-130). |
| RB2-15 | RUNBOOK §2 :51-52 | "Open questions" (N1) | STATE.md:59 | PARTIAL | Stale: "historian to propose candidates". Proposed (history-and-assumptions.md:566-573). |
| RB2-16 | RUNBOOK §2 :51 | "Open questions (OPERATING §17 + new)" | STATE.md:50-59 | PARTIAL | Stale: the new questions raised at Checkpoint A are missing. They are whether "client" counts as the second fact (checkpoint-A.md:132), who labels and who settles (:134), and why staff rebuilt the bot's orders (alignment.md:61). |
| RB2-17 | RUNBOOK §2 :54 | "Decisions made this engagement" | STATE.md:61-75 | PARTIAL | Stale: :74-75 calls the backfill of the 40 unstored emails "the owner's call". An untracked script quotes the owner's 10-25 ruling "store them without deciding" (scripts/backfill-pause-window.mts:4). Whether it has run cannot be judged from the files. |
| RB2-18 | RUNBOOK §2 :57-61 | "Memory (OPERATING §5 — do not act)" | STATE.md:77-86 | MET | none. Current, and it matches OPERATING §5 item by item. |
| RB2-19 | RUNBOOK §2 :63 | "Blockers" | STATE.md:97-98 | MET | none |
| RB2-20 | RUNBOOK §2 (ledger) | "Live state read 2026-10-24" (extra field) | STATE.md:93-95 | PARTIAL | Stale: it says in the present tense "Settings intake_paused=true", which has been false since 10-25 (STATE.md:65-70). |
| RB2-21 | RUNBOOK §2 :66-67 | "Next action <one sentence — the very next thing to do>" | STATE.md:100-102 | PARTIAL | Stale: "Await the owner's response to Checkpoint A". The owner has since asked for this review and for the audit to continue item by item (briefs/spec-compliance.md:3-5). |
| RB3-a | RUNBOOK §3a :76-78 | "Extract every deliverable as a checklist item in STATE.md with an owner (self or subagent) and a target artifact path." | STATE.md:15-26 | PARTIAL | 12 items have owners and paths. §7 items 4-7 are folded into one line, and three things due at Checkpoint A were never listed: §10's aging policy and display change, and §9.9's reason-code report. All three are missing from the package. |
| RB3-b | RUNBOOK §3b :80-83 | "Delegate or do." | STATE.md:31-38 | MET | none |
| RB3-c1 | RUNBOOK §3c :85-86 | "One page each, using OPERATING Appendix A.1." | audit/briefs/*.md (8 briefs, 181-355 words, all nine A.1 fields) | MET | none |
| RB3-c2 | RUNBOOK §3c :86-87 | "Record the brief hash in STATE.md." | STATE.md:31-38 | MET | none |
| RB3-d | RUNBOOK §3d :89-90 | "Independent tasks in parallel, up to the concurrency limit ... Dependent tasks wait." | STATE.md:10-11; failure-taxonomy.md:5 (after the returns' :5 times) | MET | none |
| RB3-e0 | RUNBOOK §3e :92-93 | "Read the **artifact file** ... Do not accept chat-only returns." | 8 of 8 returns are files | MET | none |
| RB3-e1 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (archaeologist) | STATE.md:31 | PARTIAL | 3 claims were re-opened, against 340 file:line citations in pipeline-trace.md (grep), about 1%. The brief promised 10% and one re-traced stage (briefs/archaeologist.md:25-26); no stage was re-traced. |
| RB3-e2 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (historian) | STATE.md:32 | PARTIAL | 7 of 113 ruling rows (6.2%), against the 10% the brief promised (briefs/historian.md:28). |
| RB3-e3 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (label-auditor) | STATE.md:35 | MET | none (10 of 98, 10.2%) |
| RB3-e4 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (data-cartographer) | STATE.md:36 | PARTIAL | 4 named figures were reproduced. data-map.md has 69 table rows alone, so this is under 10% of its counts; the brief promised 10% (briefs/data-cartographer.md:26). |
| RB3-e5 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (metric-definer) | STATE.md:37 | MET | none. A, B, the 71 crash-passes and the 236/40/500 crashes were reproduced, the brief's own check. |
| RB3-e6 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (glossary-verifier) | STATE.md:38 | MET | none. 2 of 10 term mappings were checked, plus the Q1 counts, and one discrepancy is noted. |
| RB3-e7 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (taxonomist) | STATE.md:33 | MET | 14 of 117 (12%), without reading the text (reconstruction.md:252). |
| RB3-e8 | RUNBOOK §3e :94 | "Spot-check ≥10% of its claims" (red-team-A) | STATE.md:34 | MET | none (6 of 20 hits, 30%) |
| RB3-e9 | RUNBOOK §3e :95-96 | "Accept or reject-and-redispatch with the discrepancy noted." | STATE.md:31-38 | MET | none |
| RB3-f | RUNBOOK §3f :97-98 | "Write the section's output artifact yourself from the verified returns. Your name goes on the conclusion." | reconstruction.md:3 | MET | none |
| RB3-g | RUNBOOK §3g :100-102 | "write a ≤10-line handoff into STATE.md" | STATE.md:41-48 | PARTIAL | There is one line each for §3, §6.2-§6.7 and the red team, and none for §6.1. Three of the lines are stale (RB2-6, RB2-7, RB2-8). |
| RB3-h | RUNBOOK §3h :104-105 | "Do not proceed past a checkpoint on your own." | STATE.md:6, :100-102 | MET | none |
| RB6-1 | RUNBOOK §6 :169-170 | "Assemble every listed deliverable as files. Verify each exists and has a summary." | reconstruction.md:16-54; red-team-A.md:8-45; alignment.md | PARTIAL | checkpoint-A.md, which holds §7 items 4-7, has no summary; line 3 is a one-line pointer. §10's two proposals are not in any file. |
| RB6-2 | RUNBOOK §6 :171 | "Dispatch the red team. Read its return." | STATE.md:34 | MET | none |
| RB6-3 | RUNBOOK §6 :171-173 | "Revise your conclusion if it lands a hit; note the hit and your response in the alignment / final-state document." | checkpoint-A.md:136-161; alignment.md:3, :53-54 | MET | none. The responses sit in checkpoint-A.md, which alignment.md:3 points to. |
| RB6-4 | RUNBOOK §6 :174 | "Write a ≤1-page checkpoint message to the owner" | alignment.md (STATE.md:26) | PARTIAL | 966 words (S7-3). |
| RB6-5 | RUNBOOK §6 :174-175 | "what you delivered, file paths" | alignment.md:3 | PARTIAL | It names reconstruction.md and checkpoint-A.md only. red-team-A.md, the eight returns and live-state-2026-10-24.md are not listed. |
| RB6-6 | RUNBOOK §6 :175 | "the alignment statement inline" | alignment.md:5-54 | MET | none |
| RB6-7 | RUNBOOK §6 :175-176 | "and the decisions you need." | alignment.md:56-62 | MET | none |
| RB6-8 | RUNBOOK §6 :176 | "List OPERATING §17 questions with evidence." | checkpoint-A.md:112-134 | PARTIAL | Not in the message. alignment.md:56-62 names Q1, Q3 and Q4 without evidence. Q2, Q5, Q6 and the placeholder question appear only in checkpoint-A.md. |
| RB6-9 | RUNBOOK §6 :177-178 | "Set STATE.md status to `awaiting checkpoint`. Write "Next action: await owner response to Checkpoint <A\|B>."" | STATE.md:6, :100-102 | MET | Done at the time; it has gone stale since (RB2-21). |
| RB6-10 | RUNBOOK §6 :179-180 | "**Stop.** Do not begin the next phase. Do not "prepare" the next phase" | `git show --stat` of the three commits after 6a98170 (audit and feed only); no `eval/harness/` | MET | none |

## Order of work

These are the PARTIAL and MISSING rows, ordered by how much each changes what the owner decides at Checkpoint A, most first.

1. **S4-3.** item_correctness is what "99% accuracy" means and has no baseline. Pieces of it are in the files and can be put together before the owner approves the plan.
2. **S67-9.** The silent-miss count covers only emails staff acted on. The move the owner is asked to approve rests on exactly this gap.
3. **S4-2.** The 95.2% inquiry_recall has the same denominator, so it must not be read as the primary metric's baseline.
4. **S67-1.** Misses among 291 unread emails of the live week are not bucketed. Any larger bucket would hide there.
5. **S10-6.** §10 asks for an aging policy at Checkpoint A. Without one, the owner rules on the needs-reply clearing proposal with no policy for silent removal.
6. **S10-4.** The minimal display change for flagged items is due at Checkpoint A, and it has to come before any display discussion with the staff contact.
7. **S3-3.** Q1 is asked in §3's order→job terms, which the glossary shows are wrong (Job, Order, Opportunity), so the owner may answer a different question.
8. **S4-4.** Two review_rate figures sit in the package, and Q1 asks the owner to choose between review_rate and auto_book_rate.
9. **A3-3.** The same conflict at the definition: metrics.md counts writes the TV never lists as items shown.
10. **RB6-8.** The one-page message names Q1, Q3 and Q4 without evidence. An owner who reads only that page decides without it.
11. **S4-5.** The owner is asked for a display_precision floor (Q4) on 59 of 62 rows from a staff-worked set.
12. **S17-4.** Q4 has thin evidence, for the same cause.
13. **S17-3.** Tier T3 and the owner's reversibility ruling rest on an unmeasured code comment about crew notification.
14. **RB3-e2.** The conflicting rulings behind the Q1 answer were checked on 7 of 113 rows.
15. **RB3-e1.** The anatomy behind "not an inquiry cannot be said" and the TV lifecycle was checked on about 1% of its citations.
16. **RB3-e4.** Sender-to-client coverage and the pool size of 2, the basis of "the spine holds", were checked on 4 figures.
17. **S6-2.** Taken together, the returns' verification is below the bar that commit 5b54a78 says was met.
18. **S99-6.** The reason-code distribution is the backlog that orders the follow-on fixes the owner will approve: the parser, the client resolution and needs-reply.
19. **S4-7.** A client fix is proposed, and "nothing downstream can exceed" client accuracy, but only coverage is reported.
20. **S4-8.** NONE is a first-class answer, and its precision is unreported.
21. **S10-2.** Item safety follows from item_correctness (S4-3) and is unmeasured with it.
22. **S7-3.** At about 1.6 pages, the alignment statement is longer than the one page the owner was promised.
23. **RB6-4.** The checkpoint message is the same file, with the same length.
24. **RB6-5.** The message does not list the files the owner can open: the red team, the returns and the live state.
25. **S2-8.** The owner's own audit was not read. Naming it could change the history findings.
26. **S2-9.** Two candidate 99% plans were not read, and the owner can name the right one.
27. **RB2-17.** The owner's "store them without deciding" ruling is missing from the ledger. Without it, the 40 emails could be asked about again or decided.
28. **S16-2.** That ruling has no dated decision entry either, and `decisions/` is empty.
29. **RB2-21.** The next action predates the owner's request for this review, so a cold reader would only wait.
30. **RB2-16.** Three questions now put to the owner are not in the ledger's question list.
31. **RB2-9.** Q1 reads "open, glossary-verifier to settle", though the code answer exists.
32. **RB2-10.** Q2 reads open, though it is answered.
33. **RB2-11.** Q3 reads "not started", though the tiers and evidence exist.
34. **RB2-14.** Q6 reads "not started", though it is answered.
35. **RB2-13.** Q5 reads "to count", though it is counted.
36. **RB2-15.** N1 reads "to propose", though the candidates are listed.
37. **RB2-12.** Q4's evidence column lacks the one figure there is.
38. **RB2-6.** The "12 right creates" handoff contradicts the accepted 9 and 7. That figure feeds the question to staff about rebuilds.
39. **RB2-7.** The 89.1% handoff omits production's 85.9% and 82.2%.
40. **RB2-8.** The first-cut handoff still says "VERIFY", though the 79 have been shown to be a label artefact.
41. **S4-10.** Whether an uncertain-order card shows a best candidate and a top-3 is unexamined. S10-4 needs this.
42. **S99-2.** A flagged card's contents (candidates, evidence) are unexamined. The same input is needed.
43. **S10-3.** Whether flagged items show their top-3 and evidence is unexamined, for the same reason.
44. **S2-6.** Operational failures shown to staff are traced but not counted. This is a Phase 1 ops target.
45. **S4-13.** There is no precision-vs-coverage curve. It is not yet applicable if the gate has no thresholds, but no file says so.
46. **S62-5.** Failure modes are missing for 9 of 18 stages, which Phase 1 ops design needs.
47. **S62-6.** Logging is missing for 9 of 18 stages, needed for "a miss diagnosable from logs alone".
48. **S10-7.** No mapping exists from the current item kinds and marks to the required four statuses.
49. **S10-8.** Room for a future rejected or held state is not examined, although no Phase 0 choice blocks it.
50. **RB3-a.** The incomplete checklist is why S10-4, S10-6 and S99-6 were missed.
51. **RB6-1.** checkpoint-A.md has no summary at the top.
52. **RB2-4.** The checklist still calls two final files "draft".
53. **RB2-5.** Active subagents lacks spec-compliance and still holds accepted agents.
54. **RB2-1.** The ledger header date and session are stale.
55. **RB2-2.** The session plan is stale.
56. **RB2-20.** The live-state field still reads intake_paused=true.
57. **S16-3.** STATE.md was not updated for the 10-25 work (rolls up RB2).
58. **S121-5.** The return summaries run over a page by the 600-word proxy.
59. **A2-13.** The `/decisions` path in the layout is empty.
60. **RB3-g.** There is no handoff line for §6.1.
