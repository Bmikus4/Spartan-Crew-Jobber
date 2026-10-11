# Spartan simulation, 500 complex create orders (mutant)

- **Mode:** mutant. **Model under test:** mutant (oracle with every date one day late) (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 0 replayed. **Spent:** $0.00.
- **Run:** 2026-10-11T01:03:52.319Z to 2026-10-11T01:03:52.871Z.
- **Preflight:** no production credentials loaded: ok; network closed except the model provider: ok; OnSinch is the fake world: ok; the bot is the recording runner: ok; case set generated: ok.

## Gates

| Gate | Result | Observations |
|---|---|---|
| Never lose an email (every case reaches a recorded final state) | **PASS** | 500/500 |
| Final state within five minutes | **PASS** | 500/500; slowest 0s |
| End to end correct (target 99.0%) | **NOT MET** | 0/500 = 0.0%, 95% CI 0.0%-0.8% |

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
| **Planning** | **0/500** | 0.0%-0.8% | no | full | | |
| P26 a named crew chief | 0/40 | 0.0%-8.8% | no | partial (40) | 40/40 | C0410, C0411, C0412, C0413, C0414, C0415, C0416, C0417 (+32) |
| P26 booking form | 0/60 | 0.0%-6.0% | no | partial (60) | 60/60 | C0250, C0251, C0252, C0253, C0254, C0255, C0256, C0257 (+52) |
| P26 build and derig | 0/60 | 0.0%-6.0% | no | partial (60) | 60/60 | C0080, C0081, C0082, C0083, C0084, C0085, C0086, C0087 (+52) |
| P26 long run of shifts | 0/50 | 0.0%-7.1% | no | partial (50) | 50/50 | C0450, C0451, C0452, C0453, C0454, C0455, C0456, C0457 (+42) |
| P26 mixed sizes across the chief line | 0/50 | 0.0%-7.1% | no | partial (50) | 50/50 | C0310, C0311, C0312, C0313, C0314, C0315, C0316, C0317 (+42) |
| P26 multi-day run | 0/80 | 0.0%-4.6% | no | partial (80) | 80/80 | C0000, C0001, C0002, C0003, C0004, C0005, C0006, C0007 (+72) |
| P26 night shifts with a PO | 0/50 | 0.0%-7.1% | no | partial (50) | 50/50 | C0360, C0361, C0362, C0363, C0364, C0365, C0366, C0367 (+42) |
| P26 two shifts in one day | 0/60 | 0.0%-6.0% | no | partial (60) | 60/60 | C0140, C0141, C0142, C0143, C0144, C0145, C0146, C0147 (+52) |
| P26 two venues | 0/50 | 0.0%-7.1% | no | partial (50) | 50/50 | C0200, C0201, C0202, C0203, C0204, C0205, C0206, C0207 (+42) |

**The AI node (intent read correctly):** 500/500 = 100.0%, 95% CI 99.2%-100.0%.
