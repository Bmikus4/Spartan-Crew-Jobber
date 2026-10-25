AGENT: taxonomist   PHASE: 0   MODE: read-only

GOAL: OPERATING.md §6.7: bucket every miss on REAL mail by the first stage that failed, with the
silent-miss count reported first.

INPUTS: audit/briefs/_common.md; the accepted discovery returns: audit/pipeline-trace.md,
audit/history-and-assumptions.md, audit/data-map.md, audit/glossary.md, eval/metrics.md,
eval/label-audit.md. Real-mail data: .tmp-data/week-review-1014.json (one row per client email of
the live week 2026-10-14 to 10-21: the live decision, its code, a verdict against what staff did
after; produced by scripts/week-review.mts), .tmp-data/week-truth.json, -acts.json, -orders.json
(staff actions with values, from scripts/ops-truth.mts), and the gold set in .tmp-data/gold/
(truth.jsonl, decisions.json) with data/gold/adjudications.jsonl. The generated harness sets are
NOT the dataset: their labels are 53% stale (eval/label-audit.md); cite them only for contrast.

OUTPUT: eval/failure-taxonomy.md

SCOPE: You may read the inputs and code and run offline scripts under .tmp-v2/. Deliver:
1. FIRST: the silent-miss count: real inquiries (staff then booked or changed something) for
   which the system produced no item on the TV. Say exactly what "no item" means in this code
   (no card, a card the TV does not list, a "none" decision), with file:line.
2. Every miss of the live week bucketed at the first stage that failed: not_recognized_as_inquiry
   / wrong_client / candidate_not_retrieved / wrong_ranking / wrong_action / parse_failure /
   pipeline_break / label_wrong / genuinely_ambiguous. Counts per bucket, each with two or three
   message_ids as examples. Read the stored decision, its reasons and code, and the staff actions
   to decide the stage; open the email in messages.json only when needed, and never quote it.
3. The same buckets on the gold set where its labels allow, kept apart from the live week.
4. Slices: by company id, by inquiry type (new booking / change / cancel / question), by date.
   Name any slice where nearly everything fails: that is a pipeline break.
5. The count of emails whose right answer was NONE (a new order) or not an inquiry, and whether
   the system was able to say so (cite the code path).
You may NOT propose fixes or judge what to build.

BLOCKED: Write what you need to OUTPUT and stop. Do not improvise around it.

VERIFICATION: The orchestrator will re-bucket 10% of your misses from the same files.
