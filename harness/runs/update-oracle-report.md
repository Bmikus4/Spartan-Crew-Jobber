# Spartan simulation, 500 complex update orders (oracle)

- **Mode:** oracle. **Model under test:** oracle (the ground-truth reading) (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 0 replayed. **Spent:** $0.00.
- **Run:** 2026-10-11T01:04:06.211Z to 2026-10-11T01:04:06.740Z.
- **Preflight:** no production credentials loaded: ok; network closed except the model provider: ok; OnSinch is the fake world: ok; the bot is the recording runner: ok; case set generated: ok.

## Gates

| Gate | Result | Observations |
|---|---|---|
| Never lose an email (every case reaches a recorded final state) | **PASS** | 500/500 |
| Final state within five minutes | **PASS** | 500/500; slowest 0s |
| End to end correct (target 99.0%) | **MET** | 500/500 = 100.0%, 95% CI 99.2%-100.0% |

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
| **Planning** | **420/420** | 99.1%-100.0% | yes | full | | |
| P10 move a shift to another day, new times | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P10 move a shift to another day, same times | 45/45 | 92.1%-100.0% | yes | partial (45) | 45/45 |  |
| P10 times on a shift with a second trade | 30/30 | 88.6%-100.0% | yes | partial (30) | 30/30 |  |
| P13 stand crew down | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P16 crew down across the chief line | 30/30 | 88.6%-100.0% | yes | partial (30) | 30/30 |  |
| P16 crew up across the chief line | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P19 cancel one shift of several | 35/35 | 90.1%-100.0% | yes | partial (35) | 35/35 |  |
| P21 add a shift at one venue of two | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P4 change on a linked thread, two orders that day | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P4 new shift on a linked thread | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P4 new shift on a linked thread whose order cannot be read | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P9 change one of two shifts by its start | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P9 change the derig by name | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| **Extraction (AI)** | **80/80** | 95.4%-100.0% | yes | partial (80) | | |
| X10 every shift of an order at once | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| X10 two changes on two days | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |

**The AI node (intent read correctly):** 500/500 = 100.0%, 95% CI 99.2%-100.0%.
