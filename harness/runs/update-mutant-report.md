# Spartan simulation, 500 complex update orders (mutant)

- **Mode:** mutant. **Model under test:** mutant (oracle with every date one day late) (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 0 replayed. **Spent:** $0.00.
- **Run:** 2026-10-11T01:03:56.110Z to 2026-10-11T01:03:56.428Z.
- **Preflight:** no production credentials loaded: ok; network closed except the model provider: ok; OnSinch is the fake world: ok; the bot is the recording runner: ok; case set generated: ok.

## Gates

| Gate | Result | Observations |
|---|---|---|
| Never lose an email (every case reaches a recorded final state) | **PASS** | 500/500 |
| Final state within five minutes | **PASS** | 500/500; slowest 0s |
| End to end correct (target 99.0%) | **NOT MET** | 10/500 = 2.0%, 95% CI 1.1%-3.6% |

## Invariants (hard gates, never averaged)

| Invariant | Held | Violations |
|---|---|---|
| no wrong write | 500/500 | none |
| client isolation | 500/500 | none |
| no double write | 500/500 | none |
| forbidden fields | 500/500 | none |
| terminal state | 500/500 | none |
| five minutes | 500/500 | none |

## Accuracy tree

| Branch | End to end | 95% CI | Target met | Coverage | Model read the intent | Failures |
|---|---|---|---|---|---|---|
| **Planning** | **10/420** | 1.3%-4.3% | no | full | | |
| P10 move a shift to another day, new times | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0235, U0236, U0237, U0238, U0239, U0240, U0241, U0242 (+32) |
| P10 move a shift to another day, same times | 0/45 | 0.0%-7.9% | no | partial (45) | 45/45 | U0190, U0191, U0192, U0193, U0194, U0195, U0196, U0197 (+37) |
| P10 times on a shift with a second trade | 0/30 | 0.0%-11.4% | no | partial (30) | 30/30 | U0390, U0391, U0392, U0393, U0394, U0395, U0396, U0397 (+22) |
| P13 stand crew down | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0350, U0351, U0352, U0353, U0354, U0355, U0356, U0357 (+32) |
| P16 crew down across the chief line | 0/30 | 0.0%-11.4% | no | partial (30) | 30/30 | U0160, U0161, U0162, U0163, U0164, U0165, U0166, U0167 (+22) |
| P16 crew up across the chief line | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0120, U0121, U0122, U0123, U0124, U0125, U0126, U0127 (+32) |
| P19 cancel one shift of several | 0/35 | 0.0%-9.9% | no | partial (35) | 35/35 | U0315, U0316, U0317, U0318, U0319, U0320, U0321, U0322 (+27) |
| P21 add a shift at one venue of two | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0275, U0276, U0277, U0278, U0279, U0280, U0281, U0282 (+32) |
| P4 change on a linked thread, two orders that day | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | U0460, U0461, U0462, U0463, U0464, U0465, U0466, U0467 (+7) |
| P4 new shift on a linked thread | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | U0475, U0476, U0477, U0478, U0479, U0480, U0481, U0482 (+7) |
| P4 new shift on a linked thread whose order cannot be read | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P9 change one of two shifts by its start | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0040, U0041, U0042, U0043, U0044, U0045, U0046, U0047 (+32) |
| P9 change the derig by name | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0000, U0001, U0002, U0003, U0004, U0005, U0006, U0007 (+32) |
| **Extraction (AI)** | **0/80** | 0.0%-4.6% | no | partial (80) | | |
| X10 every shift of an order at once | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0420, U0421, U0422, U0423, U0424, U0425, U0426, U0427 (+32) |
| X10 two changes on two days | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | U0080, U0081, U0082, U0083, U0084, U0085, U0086, U0087 (+32) |

**The AI node (intent read correctly):** 500/500 = 100.0%, 95% CI 99.2%-100.0%.
