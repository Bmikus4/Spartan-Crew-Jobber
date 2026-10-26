# Evaluation windows from 10-26 (owner's item 7)

Orchestrator, 2026-10-26.

**The rules:**
- An email that anyone inspected to design a fix is dev or regression evidence for that fix.
- The next evaluation uses mail defined in advance and touched by nobody until it is scored once.
- The 40 pause-window emails (sent 10-21 01:05Z..10-22 00:25Z) are in no window. On or after 10-28 16:06Z they are
  stored without being decided (decisions/2026-10-25-pause-window-store-only.md), and they stay out of every set.

## Windows

| window | mail | labels | status |
|---|---|---|---|
| **D-old** | dev and dev-2 emails decided before 10-16 07:00:44Z (old reader) | done | dev; tuned on |
| **D-cur** | dev 81 + dev-2 233 decided by the current reader, plus prospective-1 (79) | done (two blind readers, a third on splits) | **dev and regression evidence for the current reader:** 393 emails, 107 B42 inquiries |
| **W2** | client mail dated 10-26 02:19:43Z (after the 10-26 copy) to 10-28 23:59:59Z | two blind readers (brief 76fe3b9c) and a third on splits, in one batch when the window closes | dev; may be inspected |
| **E3** | client mail dated from 10-29 00:00:00Z | none until a fix is frozen and the owner calls a checkpoint | **untouched:** nobody reads, labels, replays or inspects it before then; then labelled blind, locked by hash, scored once |

- **Why W2 waits for its close.** It held 18 client messages on 10-26 by 12:09Z (6 not "none"). D-cur already holds 107
  labelled current-reader inquiries, so labelling W2 in pieces gives nothing to act on now. One batch, one copy and one
  lock is cheaper and cleaner.
- **E3's size.** Prospective-1 gave 24 B42 inquiries in about 3 days. An interval near ±10 points around 85-90% needs
  about 100 inquiries, which is roughly 2-3 weeks of mail. 99% cannot be shown on any window this size (§14 note); the
  owner's shadow period does that.

## The current reader on D-cur (HEAD replay, $0)

| part of D-cur | B42 inquiries | silent at HEAD | silent by code |
|---|---|---|---|
| dev, current reader | 18 | 5 | reply_detail_missing 2, none_nothing_to_do 2, none_already_as_asked 1 (the label recorded as likely wrong) |
| dev-2, current reader | 65 | 8 | reply_detail_missing 4, reply_unclear 1, none_nothing_to_do 1, none_already_booked 1, none_read_together 1 |
| prospective-1 | 24 | 4 | none_nothing_to_do 4 |
| **total** | **107** | **17** | **recall 90/107 = 84.1% (CI 75.8-90.5)** |

- Of the 17: the reader finds nothing asked 7 times; a reply card hides booking work 7 times; already booked, read
  together and a probable label error once each.
- **Correction to Checkpoint B.** "0 silent reply cards on current mail" held for prospective-1 only. On the current
  reader's dev and dev-2 mail, 7 of 83 inquiries are silent reply cards. The display rule's case on current mail is
  therefore not zero (eval/component-assessment.md has the per-component figures).
- These ids are dev evidence. A fix designed from them is measured on E3.

**Inspected from prospective-1 (now dev):**
- the 4 misses: 1a168d83b151f870, 1a16a147cedc24dd, 1a16d5c74ba606ad, 1a16d8ca05a1fea7;
- the 7 acceptance exclusions and the 4 quote orders staff worked on (eval/iterations.md, the checkpoint run).
