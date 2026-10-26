# Reader diagnostic: the old reader's 11 dev misses, re-read by production's current reader

Orchestrator, 2026-10-26. Authorized by the owner, 10-26: up to $0.20, isolated, no writes. **Spent: $0.1485 over 14 calls.**
Per-case data is in `results.json`; the fixed cases and rules are in `manifest.json`.

**What this is.** A diagnostic on known, tuned-on dev mail. It is not holdout evidence.

## How it was run

1. **Cases fixed before any call** (`manifest.json`, sha256 833df054c5676fd5, recorded in audit/STATE.md before the run):
   - **11 misses.** All are dev B42 inquiries the old reader (anthropic/claude-opus-4.8) left silent, decided 10-09..10-15:
     - 8 read "no change asked for" (info_only, 0 requests);
     - 2 partial readings;
     - 1 read together with a later email (its own words name no day plus a crew or time), re-read through that carrier.
   - **9 controls, by rule.** Dev B42 inquiries the old reader read on their own and HEAD shows, ordered by
     sha256("reader-diagnostic-2026-10-26|" + id), first 9 of a pool of 110.
2. **Input, $0 and offline.** The replay (harness/real/replay.ts) rebuilds what production's reader is given: the newest
   words, and `readContext` over the time-correct world. A throwaway worktree captured those arguments. They are a
   reconstruction, not production's original input. The context code changed 10-13 and 10-15, so an old-vs-new
   difference mixes model and input.
3. **Re-read, the only paid step.**
   - The calls used production's `extractWithMeta` at 305bf84.
   - Before the first call, the script checked: prompt_id `extract@f3e1a862322b`, model `openai/gpt-6.1-sol`, and the
     manifest hash. All 14 responses report that model and prompt.
   - Only the OpenRouter key was loaded: no database, no OnSinch, no mail.
4. **Outcome, $0 and offline.** The new readings replayed through HEAD (305bf84) and through the held patch.

**Stop rule (fixed in advance):** before each call, stop if spent + 2 × max(cost per call so far, $0.012) would pass $0.20.
- The third control cost $0.0355 (15 requests).
- So the run stopped after 14 calls: all 11 misses and 3 of the 9 controls.
- **6 controls were not read.** That is the rule working as written, not a choice made after seeing results.

## Results

| | old reader (stored) | current reader (re-read) |
|---|---|---|
| misses read as asking for something (≥1 request) | 2/11 (the 2 partials) | 3/11 |
| **misses shown at HEAD** | **0/11** | **2/11 = 18.2% (CI 2.3-51.8)** |
| misses shown with the patch | 0/11 | 2/11 |
| controls shown at HEAD (read) | 3/3 | 3/3 |

Per miss:
- **7 of the 8 "no change asked for" misses get the same reading:** info_only, 0 requests. They stay silent (none_nothing_to_do).
- **1a1211fbe4a3dc72 is now read correctly.**
  - 8 new_shift requests, on exactly the readers' 8 days.
  - It becomes a policy_confirmed_proposal card, so it is shown.
- **1a134d846cab863b now gives 2 requests, both action "other".**
  - It is shown as a request_unsupported card.
  - So it reaches a person, but the reading still does not name the change.
- **1a12093913c81661 is the same partial reading** (one change_times). Silent: none_already_as_asked.
- **The read-together miss is unchanged.** Its carrier 1a11bf6850bebc48 is read info_only again, and it stays silent.
- **The 3 controls read show the same actions and stay shown.**
  - 1a13e9ba4edde86b is still a write.
  - 1a13a8890d485caa is still a reading_unproven card.
  - 1a13b45143681d8d is still a write.

## What it means

- **The 10-16 model switch did not fix the old misses.** 9 of 11 stay silent (81.8%, CI 48.2-97.7). 7 of the 8 "no
  change asked for" readings recur word-for-word in kind.
- **So the old dev misses are relevant to the current reader.** Checkpoint B set them aside as the replaced reader's
  (red-team-B2 B2-2). This diagnostic says the failure is shared: the current reader makes it on the 4 prospective
  misses too, and repeats it here on 8 of 11.
- **A reader fix therefore has dev evidence to work on:**
  - 9 old misses that still fail (8 read as asking nothing, 1 partial);
  - the 4 prospective misses, inspected now and so dev evidence;
  - the current-reader dev window as it is labelled (eval/dev-windows.md).
- Any prompt change still needs the owner's yes, and it is measured on untouched mail.
- **Limits:**
  - n = 11 misses and 3 controls;
  - the input is the replay's reconstruction;
  - one reading per email at temperature 0, so run-to-run variation is not measured.
