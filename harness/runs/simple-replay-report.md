# Spartan simulation, 500 orders (replay)

- **Mode:** replay. **Model under test:** anthropic/claude-opus-4.8 (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 500 replayed. **Spent:** $0.00.
- **Run:** 2026-10-11T01:04:44.860Z to 2026-10-11T01:04:45.273Z.
- **Preflight:** no production credentials loaded: ok; network closed except the model provider: ok; OnSinch is the fake world: ok; the bot is the recording runner: ok; case set generated: ok.

## Gates

| Gate | Result | Observations |
|---|---|---|
| Never lose an email (every case reaches a recorded final state) | **PASS** | 500/500 |
| Final state within five minutes | **PASS** | 500/500; slowest 5s |
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
| **Grounding** | **35/35** | 90.1%-100.0% | yes | partial (35) | | |
| G11 new booking, no end time | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| G4 vague crew change | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| G5 time change by weekday alone | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| **Planning** | **330/330** | 98.8%-100.0% | yes | full | | |
| P1 booking from a personal address | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P1 booking from a shared domain | 5/5 | 56.6%-100.0% | yes | thin (5) | 5/5 |  |
| P10 time change by R number | 25/25 | 86.7%-100.0% | yes | thin (25) | 25/25 |  |
| P11 longer shift by hours | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P13 crew total | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P14 crew increase | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P16 crew change crossing the crew-chief line | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P17 new booking, 13 crew | 5/5 | 56.6%-100.0% | yes | thin (5) | 5/5 |  |
| P19 cancel a shift | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P2 two R numbers | 5/5 | 56.6%-100.0% | yes | thin (5) | 4/5 |  |
| P20 add a shift to a named order | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P22 already booked | 20/20 | 83.9%-100.0% | yes | thin (20) | 20/20 |  |
| P24 new booking, no venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P25 new booking, unknown venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P26 new booking | 65/65 | 94.4%-100.0% | yes | partial (65) | 65/65 |  |
| P26 new booking with a PO | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P28 PO for a named order | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P29 PO with no order named | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P3 another client's R number | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P6 time change by day | 20/20 | 83.9%-100.0% | yes | thin (20) | 20/20 |  |
| P8 two orders that day, no venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P9 change on a day with no booking | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| **Extraction (AI)** | **135/135** | 97.2%-100.0% | yes | partial (135) | | |
| X1 contacts and meeting point | 25/25 | 86.7%-100.0% | yes | thin (25) | 25/25 |  |
| X1 thanks | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |
| X10 two shifts in one email | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| X11 booking only in the quoted history | 20/20 | 83.9%-100.0% | yes | thin (20) | 20/20 |  |
| X3 quote request | 25/25 | 86.7%-100.0% | yes | thin (25) | 25/25 |  |

**The AI node (intent read correctly):** 499/500 = 99.8%, 95% CI 98.9%-100.0%.
