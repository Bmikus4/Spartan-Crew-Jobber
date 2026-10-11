# Spartan simulation, 500 complex create orders (oracle)

- **Mode:** oracle. **Model under test:** oracle (the ground-truth reading) (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 0 replayed. **Spent:** $0.00.
- **Run:** 2026-10-11T01:04:02.167Z to 2026-10-11T01:04:03.239Z.
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
| **Planning** | **500/500** | 99.2%-100.0% | yes | full | | |
| P26 a named crew chief | 40/40 | 91.2%-100.0% | yes | partial (40) | 40/40 |  |
| P26 booking form | 60/60 | 94.0%-100.0% | yes | partial (60) | 60/60 |  |
| P26 build and derig | 60/60 | 94.0%-100.0% | yes | partial (60) | 60/60 |  |
| P26 long run of shifts | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |
| P26 mixed sizes across the chief line | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |
| P26 multi-day run | 80/80 | 95.4%-100.0% | yes | partial (80) | 80/80 |  |
| P26 night shifts with a PO | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |
| P26 two shifts in one day | 60/60 | 94.0%-100.0% | yes | partial (60) | 60/60 |  |
| P26 two venues | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |

**The AI node (intent read correctly):** 500/500 = 100.0%, 95% CI 99.2%-100.0%.
