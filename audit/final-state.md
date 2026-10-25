# Final state (Checkpoint B, OPERATING §14)

Orchestrator, 2026-10-25. Every figure comes from the real-mail harness (`harness/real/`, accepted after 48 of 48 production figures reproduced), on 799 client emails read by two blind readers. Disagreements were settled by a third. The proposed change is `eval/patches/p1-fixes.diff`, built and tested in a sandbox worktree and **not deployed**. Nothing reached production, and writes stay off.

## Summary

**The exit condition that holds is §14.4, Blocked.** What would move the remaining misses needs the owner:
- a capped paid model run to measure a reader-prompt change (P01);
- authorization for the display changes (§5, §10, Paz).

**Measured.** The figures come from the harness's replay at $0, with no network and no model. They are B42 inquiries, labelled by two blind readers with a third settling splits.

| metric | target | HEAD | with the patch |
|---|---|---|---|
| inquiry_recall, dev (561 emails, 184 inquiries) | ≥ 99.5% | 71.2% (53 silent) | **88.6% (21 silent; CI 83.1-92.8)** |
| **inquiry_recall, locked test set (238 emails, 69 inquiries; run once, here)** | ≥ 99.5% | 87.0% (9 silent) | **95.7% (3 silent; CI 87.8-99.1)** |
| display_precision (any request), dev / test | track | 96.1% / 98.4% | 95.8% / 98.8% |
| review_rate, dev | ≤ 5% | 82.2% | 87.5% |
| new writes on dev from the patch | 0 | | 0 |
| item_correctness | ≥ 99% | not measurable: no label names the order | the same |

The test set is the later weeks, from 10-15; dev is from 10-01. The patch's gain on test (+8.7 points) and on dev (+17.4 points) runs the same way. Neither reaches 99.5%.

**What the patch does** (20 files, 6 behaviour changes, each with its own test; the full suite passes):
1. **The parser** reads "28-Nov", "duration: 4", day lists and ranges, and "reduce this crew to 5". Over 1,336 stored quotes: +13 grounded, 0 lost.
2. **A quote acceptance becomes a card** to confirm the order, instead of `none`. The rule fires on 88 of 799 emails; 1 of those asks for nothing.
3. **The system's own failures email the owner** (`system-failed` route).
4. **Client resolution:**
   - a domain shared by 2-3 companies is resolved by the company the email names;
   - a known domain never becomes a new client.
5. **A replay can no longer erase a write's record.**
6. **Display (needs authorization):**
   - a reply card that asks for crew, or that the reader found unclear, is listed and survives our reply;
   - a chip says System Problem or Ready, Writes Paused;
   - the card shows how its order was found, and up to 3 candidates.

**What remains, and what would move it:**
- **4 silent misses where the model read "no change asked for":** a quote listing shifts, a site-contact change, and 2 acceptances worded outside the rule. Moving them needs a reader-prompt change, measured on a capped paid run. The owner's yes is required.
- **review_rate stays near 80%.** Writes are off, so every write is a card. The order's correctness cannot be measured without order labels: the next labelling step names the order for each inquiry.
- **n = 79 cannot establish 99% (§8.9).** Before unattended operation: a prospective shadow period with the patch, compared with what staff do.

## Decisions for the owner
1. Ship the patch's behaviour changes (1-5) to production in shadow (writes stay off)?
2. Authorize the display changes (6), with Paz?
3. A capped paid run (about $1, 100 emails) to measure a reader-prompt fix for the "no change asked for" misreads?
4. Label the true order for each inquiry, so item_correctness and recall@5 become measurable?
