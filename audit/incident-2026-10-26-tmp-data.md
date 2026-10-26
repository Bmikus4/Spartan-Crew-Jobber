# Incident, 2026-10-26: the local data copies were deleted

Orchestrator. **Nothing in production, the repository or OnSinch was affected.** The loss is local, gitignored working data.

## What happened

- A worker I dispatched (the items 5-8 assessment) built four throwaway worktrees (spartan-v2-c0, c5-c8, cw).
- Each held Windows junctions to the main checkout's `.tmp-data` and `node_modules`, as every sandbox worktree here did.
- To clean up, it ran `cmd //c rmdir` on each junction, then `git worktree remove --force`.
- The rmdir failed silently (quoting, with stderr discarded). `git worktree remove --force` then deleted the junctions'
  contents, which emptied `C:\Users\thera\spartan-v2\.tmp-data` and `node_modules`. Both folders show 08:18 on the
  box's clock.
- I found it about 25 minutes later, when a new worktree could not read the copy. I stopped the worker; it confirms it ran
  nothing else.

## What was lost

- **`.tmp-data/gold`:** the 10-23 01:45Z read-only copy, dataset hash 9b809529e0917927. Every dev figure was computed on it.
- **`.tmp-data/gold-1026`:** the 10-26 02:19Z copy behind the prospective set.
- The truth-script outputs (week-truth-*, ops-truth*), score files, link files and older scratch folders.
- `extract-cache.jsonl`: 892 readings from the old synthetic harness, bought with model calls in an earlier era.
- No shadow copy and no Recycle Bin entry exists. No other checkout holds a copy.

## What survives

- Everything committed:
  - labels, blind reads, splits and lock hashes;
  - the case-level run files, including eval/harness/checkpoint-b/;
  - production as shown (production-shown.jsonl, production-shown-gold-1026.jsonl);
  - every report.
- `.env.local` and `.tmp-v2/`, which hold the reader diagnostic's captured inputs and the pause-window payloads (so the
  10-28 store is unaffected).
- `node_modules`, reinstalled from package-lock.json (`npm ci`, exit 0).

## What it means for the evidence

- No committed figure changes. Every result was computed before the loss and is on file case by case.
- Those results can no longer be re-run on the exact copies they were measured on. A fresh read-only snapshot is being
  taken (`.tmp-data/gold-r1026`).
- The harness refuses a different dataset (shown.ts:30) rather than compare silently. So "production as shown" must be
  re-frozen on the new copy (production's app code is unchanged since 6a98170).
- The per-email outcomes are then diffed against the committed run files. The rollback makes the new copy rebuild each
  email's world at its time; differences can only come from unlogged changes and parts deleted since. Any difference is
  reported, never smoothed.

## Prevention

- **Rule (memory, feedback_worktree_remove_follows_junctions):**
  - never `git worktree remove` or recursively delete a worktree that holds junctions;
  - unlink each one first and verify it is gone;
  - no subagent removes worktrees or runs a recursive delete.
- **The snapshots get a backup outside every worktree:** `C:\Users\thera\spartan-data-backup\`.
