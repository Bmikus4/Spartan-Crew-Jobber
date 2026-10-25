AGENT: acceptance-study   PHASE: 1   MODE: read-only

GOAL: Some silent misses are a client accepting a quote that Spartan sent. The newest email says
"go ahead", "confirmed", or here is the PO. The model reads it as info_only, so the result is
`none` (plan.ts:476), and staff then build the order by hand. Measure whether code can catch these
deterministically, by reading the accepted shifts from SPARTAN'S OWN earlier message in the thread.

INPUTS: .tmp-v2/reads/emails-{1,2,3,4}.json (the 799 emails with their earlier thread messages;
you may also read .tmp-data/gold/messages.json for whole threads); the labels in
eval/reads/{A,B}-{1,2,3,4}.csv; .tmp-data/gold/decisions.json (what the system decided);
app/lib/v2/interpret/ground.ts (the parsers to reuse); app/lib/v2/interpret/plan.ts:460-480.

QUESTIONS:
1. Of the emails both readers label new_booking (or quote that lists shifts), which accept an
   earlier quote or offer from Spartan? Count them and list their ids. How many did the system
   decide `none`, and with which code?
2. For each one, does Spartan's quoting message in the thread state day(s), times and crew
   in words that ground.ts's parsers read? Count: fully readable, partly readable, not readable.
3. Propose a deterministic rule, both the acceptance wording and the "Spartan quoted shifts" test,
   and measure it over ALL 799 emails:
   - how many emails it fires on;
   - how many of those both readers call booking work (precision);
   - how many acceptances it misses (recall).
   Fires on an email that asks for nothing = a false positive. Report each.
4. Say what the order would be built from, and what would still need a person.

OUTPUT: eval/acceptance-study.md: agent name, brief hash, UTC time, a summary of at most one page,
then the tables (ids only), then the rule as pseudo-code.

SCOPE: Read only; scratch scripts under .tmp-v2/acc/ only. You may NOT edit tracked files, read
.env.local, make network or model calls, or commit. PRIVACY as in _common.md: no body text, names,
addresses or companies in OUTPUT. Describe wording patterns in generic terms.

BLOCKED: If the quoting messages are not in the snapshot, say how many are missing and stop.

VERIFICATION: The orchestrator re-runs the rule's counts.
