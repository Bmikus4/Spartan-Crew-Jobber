# Spartan simulation, 500 orders (mutant)

- **Mode:** mutant. **Model under test:** mutant (oracle with every date one day late) (prompt extract@73b8ec549e7b).
- **Cases:** 500. **Model calls:** 0 live, 0 replayed. **Spent:** $0.00.
- **Run:** 2026-10-10T23:53:54.956Z to 2026-10-10T23:53:55.206Z.
- **Preflight:** no production credentials loaded: ok; network closed except the model provider: ok; OnSinch is the fake world: ok; the bot is the recording runner: ok; case set generated: ok.

## Gates

| Gate | Result | Observations |
|---|---|---|
| Never lose an email (every case reaches a recorded final state) | **PASS** | 500/500 |
| Final state within five minutes | **PASS** | 500/500; slowest 0s |
| End to end correct (target 99.0%) | **NOT MET** | 254/500 = 50.8%, 95% CI 46.4%-55.2% |

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
| **Grounding** | **25/35** | 54.9%-83.7% | no | partial (35) | | |
| G11 new booking, no end time | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| G4 vague crew change | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| G5 time change by weekday alone | 0/10 | 0.0%-27.8% | no | thin (10) | 10/10 | S0140, S0141, S0142, S0143, S0144, S0145, S0146, S0147 (+2) |
| **Planning** | **109/330** | 28.2%-38.3% | no | full | | |
| P1 booking from a personal address | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P1 booking from a shared domain | 5/5 | 56.6%-100.0% | yes | thin (5) | 5/5 |  |
| P10 time change by R number | 0/25 | 0.0%-13.3% | no | thin (25) | 25/25 | S0095, S0096, S0097, S0098, S0099, S0100, S0101, S0102 (+17) |
| P11 longer shift by hours | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0150, S0151, S0152, S0153, S0154, S0155, S0156, S0157 (+7) |
| P13 crew total | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0165, S0166, S0167, S0168, S0169, S0170, S0171, S0172 (+7) |
| P14 crew increase | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0180, S0181, S0182, S0183, S0184, S0185, S0186, S0187 (+7) |
| P16 crew change crossing the crew-chief line | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P17 new booking, 13 crew | 5/5 | 56.6%-100.0% | yes | thin (5) | 5/5 |  |
| P19 cancel a shift | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0195, S0196, S0197, S0198, S0199, S0200, S0201, S0202 (+7) |
| P2 two R numbers | 5/5 | 56.6%-100.0% | yes | thin (5) | 5/5 |  |
| P20 add a shift to a named order | 0/10 | 0.0%-27.8% | no | thin (10) | 10/10 | S0225, S0226, S0227, S0228, S0229, S0230, S0231, S0232 (+2) |
| P22 already booked | 0/20 | 0.0%-16.1% | no | thin (20) | 20/20 | S0480, S0481, S0482, S0483, S0484, S0485, S0486, S0487 (+12) |
| P24 new booking, no venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P25 new booking, unknown venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P26 new booking | 0/65 | 0.0%-5.6% | no | partial (65) | 65/65 | S0000, S0001, S0002, S0003, S0004, S0005, S0006, S0007 (+57) |
| P26 new booking with a PO | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0065, S0066, S0067, S0068, S0069, S0070, S0071, S0072 (+7) |
| P28 PO for a named order | 9/15 | 35.7%-80.2% | no | thin (15) | 15/15 | S0210, S0211, S0213, S0222, S0223, S0224 |
| P29 PO with no order named | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P3 another client's R number | 15/15 | 79.6%-100.0% | yes | thin (15) | 15/15 |  |
| P6 time change by day | 0/20 | 0.0%-16.1% | no | thin (20) | 20/20 | S0120, S0121, S0122, S0123, S0124, S0125, S0126, S0127 (+12) |
| P8 two orders that day, no venue | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| P9 change on a day with no booking | 10/10 | 72.2%-100.0% | yes | thin (10) | 10/10 |  |
| **Extraction (AI)** | **120/135** | 82.5%-93.2% | no | partial (135) | | |
| X1 contacts and meeting point | 25/25 | 86.7%-100.0% | yes | thin (25) | 25/25 |  |
| X1 thanks | 50/50 | 92.9%-100.0% | yes | partial (50) | 50/50 |  |
| X10 two shifts in one email | 0/15 | 0.0%-20.4% | no | thin (15) | 15/15 | S0080, S0081, S0082, S0083, S0084, S0085, S0086, S0087 (+7) |
| X11 booking only in the quoted history | 20/20 | 83.9%-100.0% | yes | thin (20) | 20/20 |  |
| X3 quote request | 25/25 | 86.7%-100.0% | yes | thin (25) | 25/25 |  |

**The AI node (intent read correctly):** 500/500 = 100.0%, 95% CI 99.2%-100.0%.
