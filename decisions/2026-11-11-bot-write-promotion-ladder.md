# 2026-11-11 Bot-write promotion ladder: shadow mode now has an exit

**Decided by:** the owner, 11 Nov ("yes, ship the ladder"), on the draft presented 10 Nov. Writes have
been off since 25 Oct (2026-10-25-only-bot-writes-paused.md) with no exit condition — the exact
anti-pattern named in spartan-research 08-outside/02 §3 ("shadow with no exit date"). This file is the
exit: stages per action class, entry gates as feed-checkable numbers, rollback pre-registered before
anything turns on. It also gives the comparator its first consumer — its verdicts are what the gates read.

Every number below traces to a measurement taken 10 Nov (spartan-research r45/r46 + comparator tallies
over 747 asks). The per-class record, agreement counted over keyed asks:

| ask kind | op kind | n | disagree | rate | volume (2-wk avg) | op-complete |
|---|---|---|---|---|---|---|
| change_crew | set_position_size | 55 | 2 | 3.6% | ~12.5/wk | 26/55 |
| change_times | set_position_times | 114 | 3 | 2.6% | ~32/wk | 42/115 |
| new_shift | add_shift / add_position | 501 | 33 | 6.6% | ~128/wk | — |
| cancel_shift | cancel_position | 62 | 9 | 14.5% | ~20/wk | — |

bot_ledger history (the live-writes era, through 25 Oct): verified 134, blocked 22, mismatch 3. All
three mismatches were `create_order` rows, 14–15 Oct 2026. The edit classes have never mismatched.

## The ladder

**Stage 0 — shadow (today).** `bot_writes_enabled` off, `SPARTAN_WRITES` unset. The comparator runs
continuously; it can veto a promotion, never grant one by itself.

**Stage 1 — canary: `set_position_size` only.** The smallest possible write — one integer on one
existing slot, reversible by one edit — on the class with the best record among those with volume, and
an edit class with zero historical mismatches.
- **Entry gate:** over the 28 trailing days, ≥ 20 op-complete `change_crew` asks, and every disagreement
  on the class in that window hand-checked as world-side (plan changed by phone/portal), none caused by
  a wrong reading; suite green. The gate is a hand-check, not a flat zero, because at the 3.6% base rate
  zero-in-20 is a coin flip — the check verdicts land in spartan-research 01-data as a dated tsv, counts
  cited here on promotion.
- **Canary conditions:** cap 2 writes/day. Each op requires an absolutely-linked order and grounded
  values (otherwise `blocked`, as today), capture-before-decide, and the read-back diff. All existing
  rails; nothing is waived.

**Stage 2 — uncap size + add `set_position_times`,** after 4 consecutive canary weeks with zero
mismatch rows, zero staff reversals of a bot edit on the same slot within 72h, zero write-path error
reports.

**Stage 3 — `add_position` / `add_shift`,** same gates, after times holds 4 weeks.

**Stage 4 — `create_order`, only into "To Confirm"** (PATCH request_approval; staff approval stays in
the loop — OnSinch support confirmed the path 30 Oct, and API writes log "via API" so attribution stays
clean). All three historical mismatches were creates; the half-step is not optional. Enters only after
B5 (idempotency ask) and B8 (order codes in outbound subjects) are answered.

**Never automatic: `cancel_position`.** Excluded by measurement, not caution — 14.5% disagreement,
four times the canary class, and destructive. Revisit only after stage 4 has months of record, by a new
dated entry here.

## Auto-rollback — pre-registered, all stages, enforced by the minute sync

1. A `mismatch` ledger row on an enabled class → that class off, automatically.
2. A staff edit reversing a bot edit on the same slot within 72h → class off, plus a card.
3. Any write-path error report → all classes off.

Re-entry after any rollback is never automatic: it takes a new dated file in this directory. The global
`bot_writes_enabled` switch and `SPARTAN_WRITES` remain above everything and fail closed.

## What this commissions

The ladder reads only things that already exist (ledger statuses, read-back diffs, comparator verdicts,
"via API" actor attribution, error_reports). The next build, small and named: per-class enable flags,
the three rollback checks in the sync, and the reversal detector. Until that build ships, nothing turns
on — stage 1 entry is gated on the build as well as the numbers.
