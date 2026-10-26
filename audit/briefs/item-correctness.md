AGENT: item-correctness   PHASE: 1   MODE: read-only, except scratch under .tmp-v2/ic/

GOAL: Measure item_correctness (OPERATING A.3: items with the correct order-or-NONE and the correct change,
divided by items shown) on the dev set, for the HEAD replay and for the held patch. No label names the order
today; derive it from staff's own acts, the way eval/diagnostic-11-3.md "How the true order was derived" did,
and report how sure each derived label is.

INPUTS: eval/diagnostic-11-3.md (method: "How the true order was derived", "Method", "Definitions");
harness/real/ (replay mode, $0); eval/harness/labels/all.jsonl and split-all.json (dev only);
.tmp-data/gold/ (timeline.json, orders.json, links.json); .tmp-data/week-truth-acts.json and
-orders.json; app/lib/v2/score.ts (bookingKeys, truthKeys, judge); eval/patches/p1-fixes.diff.

METHOD:
- Items are the dev emails whose outcome is listed or check, in each column. Replay dev at HEAD from the
  main checkout, and with the patch in a scratch worktree under .tmp-v2/ic/ (git worktree add, junctions for
  node_modules and .tmp-data, both read-only; remove all when done). Keep the decision per item.
- The true order: the diagnostic's rules (staff act on the client's orders on a named day, within the window;
  independent links and written R/J numbers corroborate; system links never label alone). Grade each
  high / medium / conflict / none-derivable.
- Correct order: the item's order (write op, handoff order_id, or the card's single candidate) equals the true
  order, or both are NONE. Correct change: for a write, judge() by value against staff's acts (zone audit times
  as harness/real/world.ts:155 does; run with TZ=UTC); for a card, there is no change to judge, so report it
  separately as order-right / order-wrong / order-absent.
- Exact Clopper-Pearson intervals (harness/real/stats.ts exact()).

OUTPUT: eval/item-correctness.md. First lines: agent name, brief hash, UTC time. Then a summary of at most
one page with:
- item_correctness per column, on all items and on the high-confidence subset;
- for writes, the order and the change separately;
- for cards, the order right / wrong / absent.
Then a per-item table with ids, labels, grades and verdicts only.

SCOPE: Read only, except scratch under .tmp-v2/ic/. You may NOT run any harness mode on the prospective set
(--labels prospective), use --set test, --set all or --checkpoint, read .env.local, make network or model
calls, edit tracked files, commit, or push.

BLOCKED: If an item's true order cannot be derived, grade it none-derivable and say why; never guess.

VERIFICATION: The orchestrator recounts the headline figures from the per-item table and re-derives 10% of
the true orders.
