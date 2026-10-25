# History and assumptions (OPERATING.md §6.3)

- **Agent:** historian
- **Brief hash:** 70667283
- **Written:** 2026-10-25T00:45Z (machine clock, UTC), at repo `v2` = `6a98170`, read-only.

Conventions. `~/fleet/` means `C:\Users\thera\fleet\` (outside the repo); every other path is
relative to `C:\Users\thera\spartan-v2`. `S-0nnn` is a ticket in `public/data/feed.json`. "The
owner" is the person whose rulings these are; staff, clients and reviewers are named by role only.
The PDF is `C:\Users\thera\Desktop\Spartan-Crew-Enquiry-Engine-Developer-Handoff.pdf`, cited by
page and by line of its `pdftotext -layout` text.

---

## Summary (one page)

**Original intent (2026-07-20, `docs/BUILD-OVERVIEW.md:8-13,56-60,74-82`).** Read each email,
compose an OnSinch order on the client's correct rate card, stage it as a draft, and let a person
confirm with one click, "and eventually zero". The model does three language jobs; code does
everything with an integer in it. Launch draft-only; earn automation through measured gates.

**What changed, in four turns.**
1. 2026-09-13: the owner ruled the system "agentic and standalone. No step may require a human"
   (`~/fleet/resume/Spartan-Jobber-2026-09-14.md:31-33`). The one-click design was dropped.
2. 2026-10-06: "rebirth". The old engine (`app/lib/engine/`) was frozen as data and a new one
   (`app/lib/v2/`) was built: the model reads, code grounds every value in the client's words,
   a planner emits explicit operations, a browser bot writes
   (`~/fleet/resume/Spartan-Rebuild-Handoff-2026-10-06.md:294-328`). It wrote to real clients
   from 2026-10-10 (`b950a8d`, S-0151).
3. 2026-10-10 to 10-20: the TV became the only channel to staff (10-10), creates moved to the
   API into To Confirm (10-13), data-driven defaults replaced "never infer" (10-15), and one
   planner re-planned every minute replaced side passes (10-17, 10-20).
4. 2026-10-21: paused. 10-23: an outside review; S-0213..S-0217 shipped its first three phases.

**Rulings (section 2).** 113 rows: 76 enforced, 12 dead, 25 contradicted (17 by a later ruling
or by code, 8 by measurement). 11 rows carry a qualifier ("in part", or two statuses). The
contradictions that matter most: "money stays human" vs. the
rate card the bot writes on every create (`app/lib/v2/bot/apiCreate.ts:95`); "the browser bot
does all writes" vs. API creates (`app/lib/v2/bot/run.ts:265-269`, while `run.ts:5` still says
"The API is used only to read"); "an R number is never the mechanism" vs. the finder that decides
on one first (`app/lib/v2/interpret/plan.ts:190-198`); "crew is never identity" vs. the crew
count accepted as evidence (`app/lib/v2/evidence.ts:8-10`); "no step may require a human" vs.
To Confirm and the TV. Two identity rules are live at once: the planner's (`evidence.ts`) and the
old engine's `matchExistingOrder`, still called by the TV verifier (`app/lib/feed/verify.ts:240`).

**The 99% plans (section 3).** Ten plans or bars, 2026-07-20 to 10-24. Each figure at 97% or
above came from an instrument whose inputs were built or pre-selected. Instruments of that kind:
- a scripted or perfect reader;
- generated email;
- threads already bound to staff orders;
- labels derived offline from staff actions.

Every real-mail end-to-end figure scored on unrelabelled mail falls between 2 of 22 and 81%.
The two higher figures, 45/50 and 47/53, came after 10 cases were relabelled as truth noise, on
the same weeks used for tuning (S-0172, S-0175; Addendum `:262`). The weakest belief was the
harness's (10-10): it assumed the model was the only node that could miss, and that
generated cases stood in for real ones. Real mail contradicted both:
- the same Opus reader got 2 of 22 bookings right against ops (`app/lib/v2/interpret/extract.ts:96-98`);
- the live week 10-14..10-21 completed 7 of 108 bookable items (S-0217).

**Known-good version (section 4).** No tag, commit message, handoff or doc names one (searches in
section 4). The only tags are `v0.01`-`v0.03` (2026-07-14, the prototype). Six candidates are
listed with evidence for and against. None was measured at or near 99% on real mail.

**227/500 and 114/500 (section 5).** Both are the harness's end-to-end counts, measured with the
perfect reader (oracle) on two different generated sets of 500: simple 227/500 and update 114/500.
The create set scored 0/500 in the same run. They were first written in commit `fb01342`
(2026-10-24T02:37Z, body of S-0215). They measure a broken instrument: from `2e95eb6` (2026-10-20)
the harness's fake OnSinch lost its class methods. `83e4972` (S-0216) repaired it, giving 304, 171
and 154. `npx tsx test/harnessGate.ts` reproduces 304/171/154 at HEAD. OPERATING.md §2 says
"500 real inquiries ... [METRIC A] ... [METRIC B] ... the true baseline". All three parts are
contradicted: the emails are generated, there is one metric on two sets, and the instrument was
broken. "Delivered 45%" (OPERATING.md:51-53) is 227/500 = 45.4%.

---

## 1. Timeline of design intent and major changes

| Date | What happened | Intent or change | Evidence |
|---|---|---|---|
| 2026-07-14 | Prototype, then Next.js dashboard, then reasoner on OpenRouter | First code; the only git tags | tags `v0.01` 43cd59e, `v0.02` 204c0c9, `v0.03` 2bcea24 (`git tag -l`) |
| 2026-07-20 | Build plan written | Email -> booked draft on the right rate card -> one human click, "eventually zero"; model does 3 jobs; draft-only launch; replay gate (>=97% job detection, zero wrong-client or wrong-rate orders on >=100 real threads); auto only after >=50 consecutive unedited confirms | `docs/BUILD-OVERVIEW.md:8-13,40-42,56-60,74-82`; commit c0c47df |
| 2026-07-24 | Rate ground truth, live plumbing (n8n inbound) | Phases B and C | d367c3f, 77d6baa |
| by 2026-08-10 | Old engine live; owner sets order mode back from auto to draft-only | Human confirm kept | `~/fleet/resume/spartan-engine.md:6-15` |
| 2026-08-09..08-27 | Unknown clients and venues are created; "No Location"; owner's user 2257 as stand-in contact; never gate a client on more than a name | Never hold a booking for missing master data | `spartan-engine.md:33-35`; `app/lib/engine/onsinch.ts:139-141,214-219` |
| 2026-08-19 | 100-booking simulation "100/100 on all three measures"; production live | Offline proof, scripted reasoner | `~/fleet/resume/Spartan-Jobber-2026-08-19.md:4-6,317` |
| 2026-08-24 | "500 job corpus study ... THEN WE GO LIVE" pre-registered | Prove the write path on TEST 515, model excluded | `docs/CORPUS-STUDY-2026-08.md:7-9,19-29`; Results never filled (`:143-145`) |
| 2026-09-02..09-03 | Phase 0 system model; DECISIONS D1-D6, HANDOVER, ASSUMPTIONS opened; the 2% survival finding is made and withdrawn | Remediation charter | `docs/PHASE0-SYSTEM-MODEL.md:1-3`; `DECISIONS.md:1-5`; S-0001 |
| 2026-09-13..09-14 | Standing rulings: no human step; identity = client+date+venue+times; crew never identity; R number never the mechanism | Fully autonomous | `~/fleet/resume/Spartan-Jobber-2026-09-14.md:31-46` |
| 2026-09-15 | Phases 2-5 deployed (c6cfc03); goal set: 99% end-to-end "on everything truly obtainable" | First 99% target | `~/fleet/resume/Spartan-Jobber-2026-09-15.md:3-10,48-53` |
| 2026-09-16 | "A to B" plan: measured mechanisms "at or near the bar"; the 99% "cannot be made" for lack of instruments | Measure first | `docs/ACCURACY-PLAN-2026-09-16.md:23-35,157-171` |
| 2026-09-17 | Study harness on 100 real threads: 78%, 79% excluding hard gates | First real-mail end-to-end number | `~/fleet/resume/Spartan-Jobber-2026-09-17.md:33-39` |
| 2026-09-19..09-29 | Capture gap ("before intake went live") | Intake off | `~/fleet/resume/Spartan-Rebuild-Handoff-2026-10-06.md:140` |
| 2026-09-29 | Session gate and feed created; offline audit harness: 87/135 (64%) | Every commit ticketed | S-0002; `audit/REPORT.md:22-31` |
| 2026-09-29..10-01 | Job-identity design (fold, resolver) built in shadow; restart with a supervised week; audit harness 114 -> 120/135 | Target design then | `docs/JOB-IDENTITY-DESIGN-2026-09-29.md:1-3`; S-0032, S-0042, S-0057 |
| 2026-10-03..10-04 | Audit: 99% "not reached: 120/135 offline harness, 78-81% on real mail"; office TV feed live; remediation SP-xx | TV becomes a surface | `~/fleet/resume/Spartan-Audit-2026-10-03.md:421,439`; S-0063..S-0121 |
| 2026-10-05 | Paused for the week, simulation mode, then live again | Data collection | S-0128, S-0129, S-0132 |
| 2026-10-06 | Wrong write on order #13709 (one block moved onto an added day); grilling; "rebirth" decided: old engine frozen as data, browser bot, explicit operations | v2 design | `Spartan-Rebuild-Handoff-2026-10-06.md:267-273,294-328`; last old-engine commit 462d449 |
| 2026-10-07..10-08 | Browser bot on TEST; grounded interpretation and planner | v2 built | 699ff2a, c594f16, 6e4f1d0 (S-0139..S-0143) |
| 2026-10-07 | Old engine paused | | PDF p2, line 144 |
| 2026-10-09 | `SPARTAN_ENGINE=v2`: intake feeds v2 in shadow, old routes shut | | 685838f, S-0144; `app/lib/paused.ts:13-19` |
| 2026-10-10 | v2 writes to real clients (`SPARTAN_WRITES=live`) for every operation type at once; TV is the only channel | Live | b950a8d, S-0151; `~/fleet/resume/Spartan-TV-Handoff-2026-10-11.md:229-233`; `app/lib/feed/v2.ts:4-7` |
| 2026-10-11 | Harness: 494/500 on generated mail (S-0155), complex sets 500/500 (S-0157); owner drops the 1500-case pin ("real email is the measure"); `test/harnessScore.ts` deleted; OpenRouter credit ran out (402) | Harness as proof, then set aside | `harness/STATE.md:26-36,45-58,67-71`; 1bf6cde; S-0160 |
| 2026-10-13 | Core spec; creates via API into To Confirm; the reader picks the booking from OnSinch; minute sync; TV shows failures only | Bridge design | `~/fleet/resume/Spartan-Handoff-2026-10-21/B-items-1011-1015.md:35`; 3735d41, 689ea7e, 690065d, 6d61e84 |
| 2026-10-14 | First week graded against staff: 75 of 80 not done by the system | | S-0177 |
| 2026-10-15..10-16 | V1 grilling: two-week create rule, crew-chief rule, assumed times, rate-card fallback, staffed changes allowed; reader switched to GPT-6.1 Sol; labels live | Data-driven defaults | B-items `:44-61`; `~/fleet/resume/Spartan-Handoff-2026-10-21/C-items-1016.md:18-91`; S-0184..S-0192 |
| 2026-10-17 | "the planner is the thing making the errors": no side pass, no second state | One planner | `~/fleet/resume/Spartan-Handoff-2026-10-21.md:525-527` |
| 2026-10-20 | Releases 1-3 approved and built; `plan.ts` `once()` introduced (the harness rot starts here) | Planner finds orders by evidence, re-plans every minute | 17ebdc6, 2e95eb6, 8d36336 (S-0197..S-0199) |
| 2026-10-21 | Paused 01:06 UTC; TV every job with checked R and J; overview PDF | Data collection | `Spartan-Handoff-2026-10-21.md:501-504`; S-0194..S-0205 |
| 2026-10-22..10-23 | Matcher audit: gold set, fitted weights, 94.3% offline, not wired | "99% accessible accuracy" target | S-0208..S-0212; `~/fleet/resume/Spartan-Matcher-Handoff-2026-10-23.md:13-24` |
| 2026-10-23 | Outside review addendum at 0f2dcef | Close leaks, repair scoring, one shared finder | `~/fleet/resume/Spartan-Crew-Review-Addendum.md:6,31-39` |
| 2026-10-24 (UTC) | Suite on PGlite; leaks closed; F22/F23/F28; harness repaired (227->304, 0->171, 114->154); strict weekly scorer | | bd10dae, 1f3ae9a, fb01342, 83e4972, 6a98170 (S-0213..S-0217) |
| 2026-10-24 | This engagement opens (OPERATING.md) | Path to 99% | `OPERATING.md:1-7` |

Two names cause confusion. The owner calls the rebuild "V1"
(`docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md:1-9`), but its code lives in
`app/lib/v2/` on branch `v2`. "The old engine" is `app/lib/engine/` (`app/lib/paused.ts:13-19`).

---

## 2. Rulings

Status means one of three things:
- **enforced:** the code does it (cited).
- **dead:** it lives only in the frozen old engine or in code with no caller, was never built, or
  its subject is gone.
- **contradicted:** a later ruling, the code or a measurement says otherwise (cited).

"Contradicted (measurement)" marks a bar or target that the data shows is not met.

### 2a. Pre-rebuild rulings (2026-07-20 to 2026-10-05)

| # | Date | Source | Ruling, in brief | Status | Evidence |
|---|---|---|---|---|---|
| A01 | 07-20 | `docs/BUILD-OVERVIEW.md:34-42` (a staff requirement, adopted as Invariant #1) | Every order carries an explicitly resolved rate card; if it cannot be resolved with confidence, the order stops for a person, "no exceptions" | contradicted | v2 books the card from the client's newest staff order, else house card 355, and only flags it (`app/lib/v2/bot/apiCreate.ts:16-20,79-81,95`); the owner's 10-15 ruling B43 |
| A02 | 07-20 | `BUILD-OVERVIEW.md:12-13,59-60,80-82` | Launch draft-only, with one human click; auto only after >=50 consecutive unedited confirms and needs-human under 20% | contradicted | edits go straight to live orders when `botWrites()` (`app/lib/v2/process.ts:28-36`); only creates wait in To Confirm (`apiCreate.ts:92`); live writes went on for every op type at once (`~/fleet/resume/Spartan-TV-Handoff-2026-10-11.md:229-233`); `grep -rni consecutive app/lib/v2 app/lib/feed app/api`: 0 hits |
| A03 | 07-20 | `BUILD-OVERVIEW.md:56-58` | The model does exactly 3 jobs (classify, extract, reply); code does everything with an integer; the model never touches ids | contradicted (in part) | the v2 reader picks the booking and shift ids from a list and code checks the pick (S-0168; `app/lib/v2/interpret/interpret.ts:214-226`); reply drafting is parked (B47) |
| A04 | 08-10 | `~/fleet/resume/spartan-engine.md:13` | Order mode set back from auto to draft-only | dead | old-engine setting; `app/lib/settingsDb.ts:32` calls `order_mode` "retired" |
| A05 | 08-10 | `spartan-engine.md:50` (9e7bf29) | An assumed rate is never auto-written | contradicted | `apiCreate.ts:95` writes the assumed card on every create; B43 |
| A06 | 08-09 | `app/lib/engine/onsinch.ts:139-141` | A created company or venue must be found the next time its name is used | enforced | `apiCreate.ts:105-111` finds a bot-made client again by name or domain before creating (S-0206, S-0207) |
| A07 | 08-09/10 | `spartan-engine.md:33-35` | Unknown companies and venues are created; "No Location" placeholder; user 2257 is the stand-in contact | enforced | `plan.ts:489-500` (client), `:797-798` (venue), `:813-819` (No Location by name); `apiCreate.ts:101,114` |
| A08 | 08-09 | `app/lib/engine/resolve.ts:667-670` | Match an update to an existing OnSinch order only when "absolutely 100% sure" | contradicted (measurement) | v2 links on the day plus one more fact (`evidence.ts:2-10`); the old date/venue rule was wrong on 28 of 374 hindsight-labelled link points, 7.5% (S-0120); offline, the new matcher picks the wrong order 3.5% of the time (S-0212; `~/fleet/resume/Spartan-Matcher-Handoff-2026-10-23.md:38`) |
| A09 | 08-18 | `resolve.ts:296-301` | Among duplicate venues, keep the one with the most context | dead | that resolver is not imported by v2, whose only imports from resolve.ts are `CONSUMER_DOMAINS, domainOfEmail, matchCompanyBySender, normName, rNumbersIn, matchExistingOrder`; v2's own rule is an address first, then the oldest, flagged (`plan.ts:788-796`, owner 10-15) |
| A10 | 08-24 | `docs/CORPUS-STUDY-2026-08.md:7-9` | "run a 500 job corpus study ... THEN WE GO LIVE" | dead | Results section empty (`CORPUS-STUDY-2026-08.md:143-145`); v2 went live 10-10 without it (b950a8d) |
| A11 | 08-25 | `apiCreate.ts:23-25` | Fill the order manager with 2257 and leave the contact alone | enforced | `apiCreate.ts:34,92`; the read-back checks it (`run.ts`, "order manager reads") |
| A12 | 08-26 | `app/lib/engine/reason.ts:38-41` | Order names are realistic and never say "Re:" | enforced (new form) | v2 names orders as staff do: `<company>[ - <PO>] @ <venue>` (`plan.ts:831`) |
| A13 | 08-27 | `onsinch.ts:214-219,936-942`; `DECISIONS.md:19-21` | Creating a client or venue is never gated on more than a name (so the address fields read "TBC") | enforced (narrowed) | v2 creates a client from its written name (`plan.ts:489-500`) through `createCompany`, which fills address, city and zip with "TBC" (`onsinch.ts:950-960`; `apiCreate.ts:111`). Narrowed: not when the name shares a word with an existing client (`plan.ts:496-500`, S-0175). The TBC choice (DECISIONS D1) was never ratified (2c) |
| A14 | 09-13 | `~/fleet/resume/Spartan-Jobber-2026-09-14.md:31-33` | "agentic and standalone. No step may require a human"; a label is a terminal signal, never a queue; do not propose human-in-the-loop again | contradicted | every create waits for a person in To Confirm (`apiCreate.ts:92`); every handoff is a TV card for a person (`app/lib/feed/v2.ts:4-7`; `app/lib/feed/serve.ts:103-115`); the owner's own 10-13 spec sends <=1/100 to the TV (B31) |
| A15 | 09-13 | `Jobber-2026-09-14.md:34-37`; `resolve.ts:672-675` | Job identity = client + date + venue + times; crew is never identity; silence means inherit | contradicted | the v2 planner accepts "the crew count that day" as the second fact beside the day (`evidence.ts:8-10`; `plan.ts:185`). The old rule still runs in the TV verifier (`app/lib/feed/verify.ts:26,240` calls `matchExistingOrder`), so two identity rules are live at once |
| A16 | 09-13 | `Jobber-2026-09-14.md:38-41`; `resolve.ts:508` | A stated change proves identity; a bare difference with no change signal means a different job | dead (planner) | the planner does not use it. It survives only inside `matchExistingOrder`, which the TV verifier calls (`verify.ts:240`); it shapes TV marks, not writes |
| A17 | 09-14 | `Jobber-2026-09-14.md:42-44`; `resolve.ts:476-477` | An R number is a bonus, never the mechanism; build and measure as if absent | contradicted | v2's finder takes an R number first and decides on it (`plan.ts:190-198`). Clients rarely write one: 4 of 49 missed threads did (`~/fleet/resume/Spartan-Crew-Review-Addendum.md:23`) |
| A18 | 09-15 | `~/fleet/resume/Spartan-Jobber-2026-09-15.md:72-73` | Four labels only: Order Built, Order Updated, Order Needs Built, Order Needs Updated | enforced (renamed) | `app/lib/mail/threadLabels.ts:15,28-31` renames Built to Created in place (owner 10-16, B52); `README.md:16` still lists the old names |
| A19 | 09-15 | `Jobber-2026-09-15.md:78` | Never skip a fresh check; never destroy a staff-raised order | enforced | v2 reads the order before every edit (`run.ts:262`); the bot has no delete-order op (`app/lib/v2/bot/ops.ts:31-37`); test-data clearing deletes only orders created by 2257 (`app/lib/testData.ts:18,27,83`) |
| A20 | 09-15 | `Jobber-2026-09-15.md:79`; `Jobber-2026-09-17.md:233` | Linking must be wrong less than 1% of the time | contradicted (measurement) | "0 of 178" counted only threads already bound to staff-raised orders (`docs/ACCURACY-PLAN-2026-09-16.md:11-16,31`); on 374 hindsight-labelled points the old rule was wrong 28 times, 7.5% (S-0120); the handoff itself said the bar "cannot be proven from existing data" (`Jobber-2026-09-15.md:192-193`) |
| A21 | 09-15 | `Jobber-2026-09-15.md:3-10` | 99% end-to-end on everything "truly obtainable"; hard gates excluded | contradicted (measurement) | 79/100 real threads excluding gates (`Jobber-2026-09-17.md:33-39`); "not reached: 120/135 offline harness, 78-81% on real mail" (`~/fleet/resume/Spartan-Audit-2026-10-03.md:421`) |
| A22 | 09-29 | S-0021; `docs/RESTART-PLAN-2026-09-29.md:223,370` | Naming the owner's user 2257 as the client contact is intentional | enforced | `apiCreate.ts:101,114` |
| A23 | 09-29 | S-0026 | Sender check on match-binding removed; a stranger quoting an R number is an accepted risk | dead | old-engine pipeline, routes shut under v2 (`paused.ts:19`). The v2 analogue: an R number decides only when it belongs to the sender's company (`plan.ts:194-197`) |
| A24 | 09-29 | S-0029; `docs/JOB-IDENTITY-DESIGN-2026-09-29.md:338,468` | Outbound asks dropped; "OPS" means a Gmail tag only (ops rarely open the dashboard); design steps 3-5 in shadow only | contradicted | from 10-10 the TV is the one channel (`feed/v2.ts:4-7`); labels are derived from the TV every minute (`threadLabels.ts:2-3`) |
| A25 | 09-29 | `JOB-IDENTITY-DESIGN-2026-09-29.md:287` | No process change is asked of ops | enforced (no code) | consistent with 10-22: staff were never asked why they rebuild bot orders (`~/fleet/resume/Spartan-Handoff-2026-10-22.md:151-153`) |
| A26 | 09-30 | S-0032 | Supervised first week: every write labelled "Check Engine Write" | dead | `grep -rn SPARTAN_SUPERVISED app/lib/v2 app/lib/feed app/api`: 0 hits |
| A27 | 09-30 | S-0039 | Before restart, only creation, amendments and normal labels are visible; follow-ups off unless flagged | contradicted (later rulings) | Needs Follow Up label live (`threadLabels.ts:16`; owner 10-10, 10-16); one AI drafts switch, off (S-0196) |
| A28 | 09-30 | S-0041 (owner Q6) | An update the engine cannot make gets a Gmail tag | enforced (new channel) | a v2 handoff is a TV card, and its Order Needs Updated label is derived from it (`threadLabels.ts:2-7`) |
| A29 | 09-30 | S-0045, S-0048 | One order label at a time; other labels stack | enforced | `threadLabels.ts:5-7,15-16` |
| A30 | 10-01 | S-0049 | Drafts that send a document carry [ATTACH HERE] | dead | drafting parked 10-15 (B-items `:61`); `app/lib/v2/draft.ts` has no caller (B-items `:27`) |
| A31 | 10-01 | S-0050 | A crew or time change never moves ops' venue | enforced (by construction) | v2 edit ops carry no venue (`ops.ts:32-33`) |
| A32 | 10-01 | S-0056 | Build the send path but leave it off | dead | v2 has no send path; the AI drafts switch is off (PDF p3, line 203; S-0196) |
| A33 | 10-03 | S-0165; `resolve.ts:636-638` | The same client on the same day must never be the only reason to link | enforced | `plan.ts:185-186`; `evidence.ts:2-10`; `verify.ts:260-264`; `interpret.ts:217-224` (fb01342). Stale contradiction in a comment: `plan.ts:8-12` still says a change may be placed by "the day ... that exactly one of the client's orders has a shift on" |
| A34 | 10-04 | `app/lib/feed/order.ts:9-10` | A client waiting 24 h for our reply is red and rises to the top | enforced (sort only) | no clock is drawn since 10-07 and 10-10 (S-0137, S-0153); still the second sort key (`order.ts:55-60`) |
| A35 | 10-05 | `order.ts:13-18` | Open work quiet for 7 days sinks under its own label, never hidden | enforced | `order.ts:18,59` |
| A36 | 10-05 | `app/lib/feed/project.ts:27` | An order the engine wrote is not done until somebody checks it | contradicted (later ruling) | 10-13 "TV = failures only": bot writes are counted as `done_by_system`, not shown (`serve.ts:103-109,116`; S-0171) |
| A37 | 10-04..10-11 | `C-items-1016.md:381-387` | TV design: one list, matte, grain, no timers (10-10); no colour key, card lines never internal reasoning (10-11); softer chime (10-04); Needs Follow Up = 24 h with no activity | enforced | S-0153; `app/lib/feed/cardNote.ts:4-7`; `order.ts:21-26` |

### 2b. Rebuild and v2 rulings (2026-10-06 to 2026-10-22)

`Rebuild` = `~/fleet/resume/Spartan-Rebuild-Handoff-2026-10-06.md`. `B-items` and `C-items` are
the appendices in `~/fleet/resume/Spartan-Handoff-2026-10-21/`. `H21` =
`~/fleet/resume/Spartan-Handoff-2026-10-21.md`.

| # | Date | Source | Ruling, in brief | Status | Evidence |
|---|---|---|---|---|---|
| B01 | 10-06 | Rebuild `:296` | Maximum automation, "but that means it needs to work well" | contradicted (measurement) | live week 10-14..10-21: 7 of 108 bookable items completed (S-0217) |
| B02 | 10-06 | Rebuild `:297-301` | Zero tolerance for a wrong day, time, crew size or client; cosmetic fields no worse than 1 in 50; every write verified; both rates reported weekly | contradicted (measurement); PO part enforced | 2 wrong writes 10-14..10-21 (S-0217); PO 1-in-50 encoded (`plan.ts:839-840`; `interpret.ts:351`); weekly scoring is run by hand (B-items `:39`) |
| B03 | 10-06 | Rebuild `:302-303` | Edits the API cannot make are done by a browser bot in the staff screens | enforced | `app/lib/v2/bot/builder.ts:71-81` (`editNode`), called from `run.ts` |
| B04 | 10-06 | Rebuild `:304-305` | The bot logs itself back in | enforced | `app/lib/v2/bot/session.ts:12-13,81-91` |
| B05 | 10-06 | Rebuild `:306-307`; C-items `:81` | Host on Vercel | enforced | PDF p1, lines 56-57, 68 |
| B06 | 10-06 | Rebuild `:308-309` | After login, select "Spartan Crew" under Companies before any write | contradicted | the bot works in the Agency "partner" role (`session.ts:2-9,22`), an engineering call marked as needing the owner's nod (`~/fleet/resume/Spartan-Rebuild-2026-10-06/decisions.md:7-10`) and still awaiting it on 10-11 (TV-Handoff-10-11 item 49) |
| B07 | 10-06 | Rebuild `:310-311` | UI change detection is mandatory | enforced | contract checked before every builder fill (`builder.ts:122`; `app/lib/v2/bot/contract.ts:4-6`; `app/lib/v2/bot/canary.ts:5-6`); the canary is run by hand, not scheduled (`harness/reports/01-discovery.md:390`) |
| B08 | 10-06 | Rebuild `:312-316` | Parity: "it needs to do everything ops does"; V1 covers every order change a client email can drive | contradicted (measurement) | trade totals and reductions refused (`plan.ts:598-602`); a time change plus a new absolute crew total refused (Addendum `:207-208`); 7 of 108 completed (S-0217) |
| B09 | 10-06 | Rebuild `:314-316,516`; Rebuild-2026-10-06/decisions.md `:27-28` | Money stays human: never write price, wage, rate or pricelist fields | contradicted | every create writes `Job.pricelist_category_id` (`apiCreate.ts:95`); the owner's 10-15 card ruling (B43) and "fix R11552's card to 354 yourself" (B-items `:43`) |
| B10 | 10-06 | Rebuild `:317-319,517-518` | Any change touching signed-on crew goes to ops | contradicted (later ruling) | the owner, 10-15: "any ruling I made in the past was for safety" (C-items `:60-61`); `run.ts:11-14` makes every change except a cut below booked workers (`staffedRefusal`, `run.ts:77`) |
| B11 | 10-06 | Rebuild `:320-325` | Old engine "truncated" = frozen, kept as data, no table emptied | enforced | old-engine routes shut under v2 (`paused.ts:13-19`); its tables are read, never written (`process.ts:10-11`) |
| B12 | 10-06 | Rebuild `:325-326` | The browser bot does all writes, creates included; the API reads and verifies only | contradicted | creates go through the API (`run.ts:265-269`; `apiCreate.ts:1-8`), after the owner's 10-12 "jobs are being created blank" (B-items `:34`); test data is deleted through the API (Addendum `:111-113`); `run.ts:5` still says "The API is used only to read" |
| B13 | 10-06 | Rebuild `:322-323,519-520`; `plan.ts:8` | Never infer from history unless explicitly asked and the job can be found | contradicted (in part, later rulings) | missing times assumed from the client's past shifts (`app/lib/v2/interpret/assume.ts:1-9`, owner 10-15); rate card taken from past orders (`apiCreate.ts:16-20`). Consistent remnant: history is never new work (`plan.ts:524-540`, 10-20) |
| B14 | 10-06 | Rebuild `:323-324,327` | A vague request produces no write | enforced | `plan.ts:475` (unclear intent becomes a reply card); `plan.ts:471` (any problem becomes a card) |
| B15 | 10-06 | Rebuild `:521` | No messages to clients or workers from the system; drafts only | enforced (clients); contradicted (workers) | no client send path in v2 (S-0196 switch off); by the owner's 10-15 choice, OnSinch notifies workers of staffed changes (`run.ts:11-13`; C-items `:75`, Q18) |
| B16 | 10-09 | `plan.ts:579-586` | A change of length keeps the start; the end moves | enforced | `plan.ts:579-586`. The separate start-only rule (keep the length) came from an ops edit on R11029, not from a ruling (S-0186); the addendum asks for it to be confirmed (Addendum `:355`) |
| B17 | 10-10 | `feed/v2.ts:4-7`; `harness/reports/01-discovery.md:29` | Nothing is sent to ops; ops are told on the TV | enforced | `feed/v2.ts:4-7`; `process.ts:5-6` |
| B18 | 10-10 | `01-discovery.md:31-34`; `harness/README.md:43` | Every observation is 1 or 0; invariants are never averaged in | enforced | `harness/README.md:43`; S-0217 reports four numbers apart |
| B19 | 10-10 | `01-discovery.md:365-374` | Weekly: score, report, review, improve, at no model cost | enforced (in part) | `scripts/week-review.mts` (645b5b8; S-0217); not scheduled (B-items `:39`) |
| B20 | 10-10 | `app/lib/feed/project.ts:71-75` | The TV starts from the day the new system went live | enforced | `FEED_FROM` hard-coded (`project.ts:75`) |
| B21 | 10-11 | B-items `:27` (B1) | An unknown purpose or profession books standard Crew plus the chief rule; drafts assume the order exists | enforced (crew); dead (drafts) | `app/lib/v2/interpret/professions.ts:14-21`; `draft.ts` has no caller (B-items `:27`) |
| B22 | 10-11 | B-items `:29` (B3) | Card lines simple, informative, never internal reasoning; every named trade is booked | enforced | `cardNote.ts:4-7`; `professions.ts:4-5` |
| B23 | 10-11 | B-items `:30` (B4); `plan.ts:46` | The bar: at most 1 failed write or update in 100; a question is not a failure | contradicted (measurement) | 9 of 22 against ops (S-0189); 7 of 108 completed and 2 wrong writes (S-0217) |
| B24 | 10-11 | B-items `:31` (B5) | Drop the 1500-case perfect-reader pin; "real email is the measure" | enforced, then reversed | `test/harnessScore.ts` deleted in 1bf6cde (10-11). The harness is back in the gate as `test/harnessGate.ts` (83e4972, 10-24) under the review addendum 5.1; no owner ruling for the reversal was found in the inputs |
| B25 | 10-11 | `harness/STATE.md:74,80` | "Rule 3": an ambiguous change gets a drafted question and the order raised as Needs Follow Up | dead | never built; drafting parked 10-15 (B-items `:61`) |
| B26 | 10-11 | `harness/STATE.md:67`; S-0160 | Do not validate through paid OpenRouter runs | enforced | paid harness work dropped (d1fabd5, S-0160); re-recording the 500 readings with context waits on the owner (83e4972 body) |
| B27 | 10-12 | B-items `:32` (B6) | Remove date-only matching ("we already decided this") | enforced | 688583e (S-0165); `plan.ts:185-186` |
| B28 | 10-12 | B-items `:33` (B7) | A trade that cannot be verified, security included, books as standard Crew | enforced | `professions.ts:14-19` |
| B29 | 10-12 | B-items `:34` (B8) | Bot creates must not be blank drafts | enforced | API create into To Confirm with `request_approval` (`apiCreate.ts:1-8,92`; 3735d41) |
| B30 | 10-13 | B-items `:35` (B9) | Core spec. Parts: (1) every new order in To Confirm, fully filled; (2) update by R, or by J for a job; (3) sync every minute; (4) thread dedup is the foundation; (5) per-type, data-trained dedup protocols; (6) what cannot be done stays <=1/100 and only that reaches the TV | enforced (in part) | (1) `apiCreate.ts:92`; (3) `app/api/bot/sync/route.ts:16-24`; (6) only failures reach the TV (`serve.ts:103-109`); (5) not wired (`app/lib/match/` is imported only by `scripts/gold/*` and `test/match*.ts`); the 1/100 is not met (S-0217) |
| B31 | 10-13 | B-items `:36` (B10) | "No publish" and the contact block were the agent's rules, not the owner's | enforced | contact fallback in `apiCreate.ts:16-17`; standing rule "present no rule as the owner's that he did not make" (PDF p3, line 237) |
| B32 | 10-13 | `serve.ts:103-106`; S-0171 | The TV shows only what the system could not do | enforced | `serve.ts:103-109` |
| B33 | 10-14 | B-items `:40` (B14) | Clear test data every 15 minutes when the setting is on; never when it is off | enforced (narrowed) | `app/api/bot/sync/route.ts:38-40` also requires both write keys and no pause (S-0214) |
| B34 | 10-15 | B-items `:44` (B18); `plan.ts:770-776` | Create only orders more than two weeks out; all updates stay enabled | enforced | `plan.ts:770-776`; switchable (`settingsDb.ts:41-43`, d280dac). Which clock counts (email date or decision time) was never ruled (Addendum `:117-127`) |
| B35 | 10-15 | B-items `:45` (B19) | A code extractor, then the model decides, then a deterministic step | enforced (in part) | reader `extract.ts:101`; grounding in `interpret.ts` and `ground.ts`; no code extractor runs before the model (B-items `:45`) |
| B36 | 10-15 | B-items `:46` (B20); `evidence.ts:2-3` | No order links on a date alone; a date plus another fact (client, venue, times, crew) may | enforced | `evidence.ts:2-10`; `plan.ts:182-186` (2e95eb6); `interpret.ts:217-224` (fb01342) |
| B37 | 10-15 | B-items `:43` (B17) | Every problem: find why it appeared; several problems: find the root-cause invariant and scan every layer | enforced (process) | 6bc1fc6 (S-0181) |
| B38 | 10-15 | `run.ts:11-14`; C-items `:60-61` | Staffed positions: make every change; OnSinch tells the workers; only a cut below booked workers waits | enforced | `run.ts:11-14,77` |
| B39 | 10-15/16 | `plan.ts:61-66`; C-items `:42-44` | Crew chief: 4+ get 1, 10+ get 2, 20+ get 3, one more per further 10, inside the headcount; nothing refused for size | enforced | `plan.ts:68-71` |
| B40 | 10-15/16 | `assume.ts:1-4`; C-items `:62-63` | No start: 08:00, flagged. No end: the client's usual length when 7 of its last 10 shifts agree, else 4 h, flagged | enforced | `assume.ts:18-19` and the 7-of-10 rule in the same file |
| B41 | 10-15 | B-items `:53`; `plan.ts:813` | No venue: "No Location", flagged | enforced | `plan.ts:813-819` |
| B42 | 10-15 | B-items `:52`; C-items `:63-64` | Quotes that list shifts become orders ("better it exists than not") | enforced | `plan.ts:472-474` plans a quote with its shifts as an order (a quote without shifts becomes a reply card), subject to B34 |
| B43 | 10-15 | B-items `:55`; `apiCreate.ts:73` | Rate card: the newest staff card, else 355, "flagged assumed until 95% match" | enforced (the flag never lifts) | `apiCreate.ts:16-20,73-81,95`; `cardCheck` flags whenever a card is assumed, and no code lifts it at a 95% match |
| B44 | 10-15 | `threadLabels.ts:2-3,34-35` | Labels set from the TV's state by n8n each minute; strip HIGH/MEDIUM/LOW/SamurAI/TEST | enforced | `threadLabels.ts:34-35`; labels live 10-16 (S-0191) |
| B45 | 10-15 | B-items `:58` | Vercel only; user 2257 is "automation only" | enforced (in part) | 2257 is still the owner's own login, so his hand edits count as the bot's (B-items `:110,216`) |
| B46 | 10-15 | B-items `:61` | Drafting and deleting the old engine are parked | enforced | `draft.ts` has no caller; `app/lib/engine/` still present |
| B47 | 10-16 01:29 | C-items `:20-23` | "all jobs that can be created get created, even if some info is missing" | enforced (in part) | assumptions and No Location (B40, B41); B34 and the refusals (B08) still hand creatable jobs to staff |
| B48 | 10-16 01:29 | C-items `:24-26` | "we drifted from the original extraction and job detection step. The accuracy and shape of that system should have been preserved" | contradicted | v2 reads with its own prompt and model (`extract.ts:96-103`), not the old engine's (`app/lib/engine/prompts.ts`); no old-vs-new detection measurement was found in the inputs |
| B49 | 10-16 | C-items `:27-28,50,65` | "1/100 is the number we are striving for"; "no more than 1 fail in 100 emails"; "must work 99% of the time"; enquiry to created or updated order in 5 minutes | contradicted (measurement) | S-0217: 7 of 108 completed, 32 missed changes, 2 wrong writes |
| B50 | 10-16 01:46 | C-items `:33-35` | No order refused for size (the 10+ refusal was the agent's invention) | enforced | `plan.ts:61-66` |
| B51 | 10-16 01:47 | C-items `:37-40` | Our five labels, synced to state; a confirmed order loses every tag | enforced | `threadLabels.ts:5-7,15-16` |
| B52 | 10-16 01:47 | C-items `:37-38`; Q21 `:78` | Rename Order Built and Order Needs Built in place | enforced | `threadLabels.ts:28-31` |
| B53 | 10-16 02:09 (Q9) | C-items `:64-65` | Anything staff got to first is linked and goes quiet ("these could be updates") | enforced | `plan.ts:240-270` (`settle`) |
| B54 | 10-16 02:09 (Q11) | C-items `:66-67` | Always use existing professions; anything unmatched is standard Crew | enforced | `professions.ts:14-21` |
| B55 | 10-16 02:14 | C-items `:81-82` | Reader = GPT-6.1 Sol; Vercel; OpenRouter test cap $15, then $20 | enforced | `extract.ts:101` (default `openai/gpt-6.1-sol`). Docs still name Opus: `README.md:53-54`; `harness/STATE.md:9` |
| B56 | 10-16 11:42-12:06 | C-items `:111-127` | One pass, no separate reconciliation; "the only thing that should appear in the tv display are orders with R and J numbers" | enforced (as corrected 10-21) | `app/lib/v2/replan.ts:15`; `serve.ts:110-115`; see B62 |
| B57 | 10-17 | H21 `:525-527` | "the planner is the thing making the errors": fix it inside the planner, with no side state | enforced | `replan.ts:2-15` |
| B58 | 10-20 | H21 `:507-511` | Q10(a), "an email older than 48 h never writes", rejected; Q10(b), "never write a day already over", kept | enforced | `plan.ts:517-523` |
| B59 | 10-20 | `plan.ts:524-532` | Fix 1: requests from history are never new work | enforced | `plan.ts:524-540` |
| B60 | 10-20 | `plan.ts:365-377` | Fix 2: already booked = the day and the start; staff's later shape stands; "even booked orders may still need updated" | enforced | `plan.ts:379-394` |
| B61 | 10-20 (Q2a) | `replan.ts:2` | Re-plan every open card every minute; the re-plan never writes | enforced | `replan.ts:2-15`; `sync/route.ts:35-36` |
| B62 | 10-20/21 | `app/lib/feed/live.ts:24-27`; `serve.ts:52-58` | Q4: retire the paused engine's states from the TV; delete the Everything tab | enforced | `live.ts:24-27`; `serve.ts:52-58`; S-0195 |
| B63 | 10-21 | `~/fleet/resume/Spartan-Handoff-2026-10-21-PM.md:133-134` | Every job is listed, and every job has its own correct R and J | enforced | `serve.ts:110-115`; `feed/v2.ts:144` (R and J only from `job_links`) |
| B64 | 10-21 01:06 | H21 `:502-503` | Pause intake and all job creation; the TV stays up and live | enforced (switches) | `paused.ts:33-48`; `settingsDb.ts:46-47`. The production state cannot be checked offline |
| B65 | 10-21 | S-0196 | One AI email drafts switch for replies and follow-ups | enforced | 5f90065 (S-0196) |
| B66 | 10-21 | S-0202; `process.ts:28-36` | A Settings master switch for bot creates and updates, read at every write | enforced | `process.ts:28-36` |
| B67 | 10-22 | Matcher handoff `:13-23` | Matcher design (target 99% "accessible accuracy"): (1) extract every piece of data for each link and weight each; (2) grouped string similarity; (3) a small AI reader, Gemini 3.8 Flash; (4) Astra decides; (5) deterministic overrides rare and planned | dead (not wired) | `app/lib/match/` is imported only by `scripts/gold/*` and `test/match*.ts` (`grep -rln "lib/match/" app scripts test harness`); no gemini or astra reference in `app/lib/v2`; the live reader is `extract.ts:101` |

### 2c. Process rulings and repo invariants

| # | Date | Source | Ruling, in brief | Status | Evidence |
|---|---|---|---|---|---|
| P01 | 10-13..10-16 | B-items `:37`; C-items `:81-85`; PDF p1, line 66 | Paid model runs are capped and need the owner's yes | enforced (process) | the gate suite spends nothing (S-0172); `test/harnessGate.ts:7` ($0) |
| P02 | 09-29 | `CLAUDE.md:3-13` | `scripts/session.py` is the only commit and push | enforced | 217 tickets, S-0001..S-0217, each one a commit (`public/data/feed.json`) |
| I01 | (repo) | `CLAUDE.md:37-39` | `unreconciled` and `unactionable` are different claims | dead | old-engine sweep; `/api/reconcile` shut under v2 (`paused.ts:11,19`) |
| I02 | (repo) | `CLAUDE.md:40-42` | A decline (`amendOrderInPlace`) is neither a failure nor a success | dead | old engine only |
| I03 | (repo) | `CLAUDE.md:43-52` | Never write `Job.min_beginning` / `max_end` | enforced | `grep -rn "min_beginning\|max_end" app/lib/v2`: 0 hits |
| I04 | (repo) | `CLAUDE.md:53-54` | 6922 "No Location" is exempt; it is found by name | enforced | `plan.ts:813-816` |
| I05 | (repo) | `CLAUDE.md:56-63` | Four order labels, mutually exclusive; Needs Follow Up on its own axis; derived every minute | enforced | `threadLabels.ts:5-7,15-16` |
| I06 | (repo) | `CLAUDE.md:64-66` | A draft is not a message | enforced | `app/lib/threadMessagesDb.ts:164-183` |
| O01 | 10-24 | `OPERATING.md:193-196` | A client-facing auto-reply for unresolved inquiries is authorized, stubbed until enabled | contradicted by earlier rulings | B15 (drafts only), B25 and B46 (drafting parked), B65 (drafts switch off). No send path exists in v2 (A32) |

### 2d. Asked of the owner and never ruled (not rulings; listed so nobody treats them as settled)

| Question | Asked | Where | What the code does meanwhile |
|---|---|---|---|
| D1 "TBC" placeholder fields: keep, route to review, or book plus review | 09-02 | `DECISIONS.md:9-34`; unrecorded per `Spartan-Audit-2026-10-03.md` C6 | Ships A, "TBC" (`onsinch.ts:950-960`), now on v2 creates too (`apiCreate.ts:111`) |
| D2 Is Spartan's own outbound mail a job? | 09-02 | `DECISIONS.md:38-59` | v2 treats every `spartancrew.co.uk` sender as not a client (`process.ts:161,192-195`) |
| D3 Disclosure of data served unauthenticated before 09-02 | 09-02 | `DECISIONS.md:63-82` | none |
| D4 Recreate orders verified absent? / D5 engine corrects its own past orders? / D6 re-point a thread to a re-keyed order? | 09-02..09-03 | `DECISIONS.md:86-153` | old-engine questions; v2 re-links by evidence every minute (B61), which answers D6 in practice without a ruling |
| Portal notices ("Client created new order" from OnSinch): ignore, link, or other | 09-17 | `~/fleet/resume/Spartan-Jobber-2026-09-17.md:80-93` | dropped as not a client (`process.ts:161`: `onsinch`, `sinch.cz`) |
| Q13 cutover bar; Q16 what counts as booked; Q20 a dedicated bot user | 10-06 | Rebuild `:336-363`; TV-Handoff-10-11 items 13, 20 | live writes on without a bar (A02); bot runs as 2257 |
| Q3 bookings inside 14 days (recommended: 30-min grace, then create in To Confirm) | 10-20 | `Spartan-Handoff-2026-10-21-PM.md` §4.3 | handed to staff (`plan.ts:775`) |
| Q8 the TV rule table R1-R37 / N1-N8 | 10-17 | H21 `:803`; 10-21 PM §4.6 | open for R2, R3, R8, N1, N2, N3, N7 |
| Round 3 Q25-Q32 (2257 automation-only, attachments shadow-first, keep the old engine 4 weeks, drafting parked) | 10-16 | C-items `:87-91` "recorded-not-confirmed" | treated as settled by sessions (B45, B46) |
| The addendum's six rules for Spartan (two-week clock, new clients, start-only moves, "yes, book that", always-to-a-person, CC and old threads) | 10-23 | Addendum `:352-359` | none ruled |

**Tally.** 113 rows in 2a-2c: 37 A, 67 B, 2 P, 6 I, 1 O. Counted by the first word of each
status cell:

| Status | Rows | Which |
|---|---|---|
| enforced | 76 | every row not listed below |
| dead | 12 | A04 A09 A10 A16 A23 A26 A30 A32 B25 B67 I01 I02 |
| contradicted by a later ruling or by code | 17 | A01 A02 A03 A05 A14 A15 A17 A24 A27 A36 B06 B09 B10 B12 B13 B48 O01 |
| contradicted by measurement | 8 | A08 A20 A21 B01 B02 B08 B23 B49 |

Eleven rows carry a qualifier ("in part", or two statuses): A03, B02, B13, B15, B19, B21, B24,
B30, B35, B45, B47. Each row's own status cell is authoritative.

---

## 3. Every plan that promised or targeted 99%, its assumptions, and what contradicted them

### 3.1 The build plan's replay and auto-flip gates (2026-07-20)
- **Target:** on >=100 real historical threads, >=97% job detection, zero wrong-client orders,
  zero wrong-rate orders; auto after >=50 consecutive unedited confirms
  (`docs/BUILD-OVERVIEW.md:74-82`).
- **Assumptions:**
  - a replay scored "against the real orders that were actually created" is honest (`:69`);
  - the rate card can always be resolved from history, or the order stops (`:40-46`).
- **Contradicted:**
  - never run as specified: the first real-mail end-to-end score is 2026-09-17
    (`Jobber-2026-09-17.md:33-39`);
  - wrong-client orders happened: 7 threads were booked against look-alike companies 146 and 189
    (S-0135);
  - a wrong price list was reported by staff on R11552 (H21 `:520-521`);
  - the rate card is assumed and written, not resolved (A01).

### 3.2 The 100-booking simulation (2026-08-19)
- **Claim:** "100/100 rule agreement, 100/100 invariant-clean, 100/100 idempotent"
  (`~/fleet/resume/Spartan-Jobber-2026-08-19.md:4,317`).
- **Assumptions:**
  - a scripted reasoner returns exactly what each case declares;
  - three synthetic clients stand in for the tenant (`docs/CORPUS-STUDY-2026-08.md:19-20,41-44`
    describe `sim/run.ts`).
- **Contradicted:** real mail read at 78/100 four weeks later (`Jobber-2026-09-17.md:33-35`).

### 3.3 The 500-booking corpus study (pre-registered 2026-08-24)
- **Targets:**
  - H1, creates accepted >= 99%;
  - H2, headcount 100%;
  - H6, nothing reported done that did not happen: 0 (`CORPUS-STUDY-2026-08.md:54-63`).
- **Assumptions, stated in the study itself:**
  - one client;
  - "perfect extraction", so "every misread-email failure mode is out of scope by construction"
    (`:38-44`);
  - the model is excluded on purpose (`:19-29`).
- **Contradicted:**
  - no results were ever written (`:143-145`);
  - the error mass the study excluded by construction turned out to dominate: classification was
    20 of 30 rulings against the engine (`Jobber-2026-09-17.md:61-68`).

### 3.4 The 09-15 goal and the 09-16 "A to B" plan
- **Claim:** "get this automation ... to 99% end-to-end on everything that is truly obtainable"
  (`Jobber-2026-09-15.md:3-5`). The 09-16 plan concluded the engine was "at or near the bar" on
  everything measurable (`docs/ACCURACY-PLAN-2026-09-16.md:157-160`).
- **Why it was believed** (`ACCURACY-PLAN-2026-09-16.md:23-35`):
  - company 141/141;
  - dates 122/122 "not falsified";
  - venue text 122/124 after adjudication;
  - linking 0 wrong of 178.
- **Assumptions:**
  1. Hard gates are excluded from the denominator (`Jobber-2026-09-15.md:7-10`;
     `ACCURACY-PLAN-2026-09-16.md:147-155`).
  2. The population is the threads already bound to a staff-raised order, 141 of 178
     (`ACCURACY-PLAN-2026-09-16.md:11-16`). That selects threads the engine had already linked.
  3. The three unmeasured mechanisms (classification, crew/block shape, labels) would not pull the
     number down. The plan said itself that classification "decides the fate of 40% of all
     traffic" (`:160-163`).
  4. Venue would dominate the error (`Jobber-2026-09-15.md:187-190`).
- **Contradicted:**
  - The unmeasured mechanism dominated: real mail read at 79/100 excluding gates, and
    classification was two-thirds of the error (`Jobber-2026-09-17.md:33-39,61-68`).
  - Venue did not dominate (`ACCURACY-PLAN-2026-09-16.md:39-41`).
  - Linking: the old date/venue rule was wrong on 28 of 374 hindsight-labelled points, 7.5%
    (S-0120).
  - Company "solved, do not touch" (`ACCURACY-PLAN-2026-09-16.md:27`), against the wrong-client
    incident of 10-05/10-06 (S-0135).
  - The business outcome sat outside every mechanism score: 0 of 86 engine-created orders were
    still alive, because staff retyped them (S-0012).
  - The 10-03 audit: "not reached: 120/135 offline harness, 78-81% on real mail"
    (`Spartan-Audit-2026-10-03.md:421`).

### 3.5 The offline audit harness (2026-09-29 to 10-01; old engine)
- **Figures:** 87/135 (64%) at 5ee98e2, rising to 120/135 (89%) by 10-01, with "99% of checks"
  (`audit/REPORT.md:22-31`; S-0042, S-0057; `Spartan-Audit-2026-10-03.md:439`).
- **Assumptions:** scripted scenarios on a fake tenant and a fake model represent the traffic.
- **Contradicted:**
  - its own report warns that a stub "more faithful than production" had inflated the first pass
    (`audit/REPORT.md:10-18`);
  - it measures the old engine, which is now frozen (`paused.ts:13-19`).

### 3.6 The rebuild's cutover bar (2026-10-06, proposed as Q13)
- **Target:** on >=200 held-out emails, zero critical errors, >=98% of operations matching ops,
  missed operations <=5%, zero silent drops. Its own caveat: "zero errors in 200 still allows a
  true rate of about 1.5%" (Rebuild `:452-472`).
- **Assumptions:** cutover would go by operation type, each passing on its own.
- **Contradicted:** never applied. Q13 was never answered (Rebuild `:336`). Live writes went on
  for every operation type at once at b950a8d, and the held-out backtest and the review of the
  first 20 live writes were never done (`Spartan-TV-Handoff-2026-10-11.md:229-233`).

### 3.7 The verification harness: 99% target, 494/500 (2026-10-10 to 10-11)
- **Target:** "End to end: 99% of client emails reach the correct final state"
  (`harness/reports/01-discovery.md:279`).
- **Results:**
  - 494/500, 98.8%, CI 97.4-99.4% (`harness/STATE.md:34`; S-0155);
  - its own report: "NOT MET" (`harness/runs/simple-record-report.md:14`);
  - complex sets 500/500 and 500/500 (S-0157).
- **Why it was believed:**
  1. There is one AI node, which "carries almost the whole budget"; every deterministic node
     scores 100% (`01-discovery.md:277-282`).
  2. The perfect reader also scored 494, so "the model added no end-to-end miss of its own"
     (`harness/STATE.md:26,34`).
  3. The model read intent on 499/500 (`STATE.md:35`), and the late-dates mutant wrote nothing
     wrong (`STATE.md:28`).
  4. Cases use "the date, time and count shapes ... measured in real client mail"; expected
     outcomes are "the BUSINESS answer" (`harness/adapters/spartan/generate.ts:6-10`).
  5. "The model under test is the production model" (`harness/README.md:48-49`;
     `STATE.md:9`).
- **Contradicted:**
  - **No real mail was ever scored.** The plan's 1,200-case real-email block
    (`01-discovery.md:297-306`) never ran. The owner set it aside on 10-11 ("real email is the
    measure", B24), and paid harness work was dropped (S-0160).
  - **On real mail the same reader failed.** The Opus reader got 2 of 22 bookings right against
    ops (`extract.ts:96-98`). Other real-mail figures:
    - real-email replay 10-09..10-11: order failure 36.4% (S-0163, `measured.real_email_replay.order_failure_pct`);
    - 36/58 against ops (S-0168);
    - 75 of 80 not done by the system (S-0177);
    - 9/22 (S-0189);
    - strict scorer 10-14..10-21: 7 of 108 completed, 32 missed changes, 2 wrong writes (S-0217).
  - **The model was not the only node that missed.** S-0217's codes include
    `reading_unproven` 34, `reply_detail_missing` 12, `request_unsupported` 6 and `client_unknown`
    6. The planner refuses common requests (`plan.ts:598-602`; Addendum `:207-210`).
  - **The recorded reader never saw its live context.** The adapter took four arguments where
    production passes five, so every recorded reading was made blind; and the fake runner returns
    "verified" without a writer (83e4972 body; Addendum `:261`).
  - **The expected answers were not the owner's.** They predate four of his rulings (10-13 quotes
    with shifts; 10-15 two-week rule, never the day alone, the chief count): "329 creates now
    meet the two-week rule, 339 updates name their booking by the day alone" (83e4972 body).
  - **Tuned and scored on the same set.** The complex updates went from 260/500 with 40 wrong
    writes to 500/500 within one session, by fixing code against those same cases
    (`STATE.md:43-58`; S-0157).
  - **The production model changed.** Since 10-15 the live reader is `openai/gpt-6.1-sol`
    (`extract.ts:101`). The 494/500 was measured on `anthropic/claude-opus-4.8` (`STATE.md:9`).
  - **The instrument rotted silently.** From 2e95eb6 (10-20) the fake OnSinch lost its class
    methods. 165 of the simple set's 273 misses read "could not plan", every create failed, and
    nothing went red, because `test/harnessScore.ts` had been deleted (fb01342 body; 83e4972 body;
    `test/harnessGate.ts:4-6`).

### 3.8 The owner's 1-in-100 bar and the V1 plan (2026-10-11 to 10-21)
- **Statements:**
  - "1 in 100 is good for a failed update or write" (B-items `:30`);
  - <=1/100 reaches the TV (B-items `:35`);
  - "must work 99% of the time" (C-items `:65`);
  - V1 plan: "no more than 1 failed email in 100" (`docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md:7-9`);
  - PDF: "The bar is one wrong order in a hundred" (p1, line 9).
- **Basis:** a requirement, not a measurement. The V1 plan names its own most important line: 7 of
  8 bot orders were re-keyed by staff (`2026-10-15-spartan-v1-working-plan.md:33-37`).
- **Data:**
  - adoption 1 of 12 (S-0188);
  - of 21 bot creates since 10-12, 1 still exists (`Spartan-Handoff-2026-10-22.md:139-152`);
  - S-0217 as in 3.7.

### 3.9 The matcher plan's "99% accessible accuracy" (2026-10-22)
- **Target:** 99% "accessible accuracy (accuracy of what we build, regardless of client deviancy or
  data volatility)" (`~/fleet/resume/Spartan-Matcher-Handoff-2026-10-23.md:19-20`).
- **Why it was believed:**
  - at p >= 0.95, 70.5% of emails are decided at 99.63% (Wilson lower bound 99.05%);
  - at p >= 0.99, 51.4% are decided, 783/783 (`:40`; S-0212).
- **Assumptions:**
  1. Labels derived from staff timeline actions are truth. Only disagreements were adjudicated
     (147), so 94.3% is "an upper estimate" (`:67-69`).
  2. "Accessible" excludes some cases, and its definition is still an open decision (`:76-77`).
  3. The 29.5% left undecided at 0.95 goes to an AI step that is not built (`:78-79`).
  4. An offline replay stands in for live (it cannot see shifts staff deleted, `:95-96`).
- **Contradicted, or the limits:**
  - overall accuracy is 94.3%, and the wrong order is picked 3.5% of the time (`:38`);
  - not wired into the live path (B67; Addendum `:226`);
  - the live reader still has the quote-header bug fixed only in the matcher (`:80-82`).

### 3.10 OPERATING.md's "a prior plan guaranteed 99% and delivered 45%" (2026-10-24)
- `OPERATING.md:51-53`. No plan in the inputs says "guarantee" about accuracy (`grep -rni
  guarantee` over `~/fleet/resume/Spartan*`, `docs/`, `harness/`: no hit about accuracy).
- The nearest claim is the harness report "End to end correct (target 99.0%) **MET**, 500/500",
  `harness/runs/simple-oracle-report.md:14`, tracked since 92f7256.
- 45% = 227/500, the simple set on the broken harness (section 5).

### Common thread (counts, not judgement)
- **High figures, from built or pre-selected inputs:**

  | Figure | Source |
  |---|---|
  | 100/100 | 08-19 |
  | 141/141, 0/178 | 09-16 |
  | 494/500, 500/500 | 10-11 |
  | 99.63% on the 70.5% decided | 10-23 |

- **Real-mail end-to-end figures:**

  | Figure | Source |
  |---|---|
  | 78/100 | `Jobber-2026-09-17.md:34` |
  | 78-81% | `Spartan-Audit-2026-10-03.md:421` |
  | 2/22 (Opus reader) | `extract.ts:96-98` |
  | 36/58 | S-0168 |
  | 45/50 and 47/53, after 10 cases relabelled as truth noise, on the weeks used for tuning | S-0172, S-0175; Addendum `:262` |
  | 75/80 not done | S-0177 |
  | 9/22 | S-0189 |
  | 7/108 completed | S-0217 |

---

## 4. Candidates for "the previous known-good version"

**No version is named known-good anywhere in the inputs.**
- `git log --all -i --grep "known.good\|last good\|rollback\|revert"` finds 4 unrelated commits.
- A search of the handoffs and docs for "known good", "last good version" and "roll back to"
  finds one hit: a 08-19 Vercel rollback command (`Spartan-Jobber-2026-08-19.md:423`).
- OPERATING.md:92-95 leaves `[NAME/TAG]` unfilled.

| Candidate | What it is | Evidence for | Evidence against |
|---|---|---|---|
| `v0.03` (2bcea24, 2026-07-14) and `v0.01`/`v0.02` | The only git tags | The only named versions | A prototype: "20/20 offline test", the API contract not yet aligned, no replay proof (`BUILD-OVERVIEW.md:15-32`); never scored on real mail |
| Old engine at 462d449 (2026-10-06; last old-engine commit) or 0a7c973 (2026-09-30; local `main`, Vercel READY per `Spartan-Audit-2026-10-03.md:440`) | `app/lib/engine/`, the engine in production until the 10-07 pause | 141/141 company binding, 0/178 wrong binds, venue text 98.4% (`ACCURACY-PLAN-2026-09-16.md:27-31`); 120/135 offline (S-0057); the owner, 10-16: "the date plus matching evidence, worries me because the last version worked well" and "we drifted from the original extraction and job detection step" (C-items `:24-30`) | 78-81% on real mail (`Spartan-Audit-2026-10-03.md:421`); 0 of 86 engine-created orders alive, all retyped (S-0012); old date/venue rule wrong 28/374 (S-0120); wrong-client bookings (S-0135); wrong write on #13709 on 10-06 (Rebuild `:267-273`) |
| b950a8d (2026-10-10) | First v2 commit to write to real clients | Shadow day 1: 3/3 writes matched ops (S-0149); harness 494/500 on generated mail (S-0155) | Live 10-09..10-14: 75 of 80 not done by the system (S-0177, "pre-ebba11e builds"); a live day-move wrong write fixed the next day (S-0157); no cutover bar (3.6) |
| 6f570a3 (2026-10-16, S-0193) | Last commit before the 10-20 planner releases, and before the harness rot (2e95eb6) | A $0 replay reproduced 8 of production's 11 open cards, with all differences traced (S-0193); the harness world was intact | Staff reported two bot errors from this build on 10-20: the price list on R11552 and a duplicate shift on R11766 (H21 `:520-523`); 4 of 6 shifts the bot added duplicated staff's (`plan.ts:365-369`); 9/22 against ops (S-0189); adoption 1/12 (S-0188) |
| 6422afb (2026-10-21, S-0205) | The PDF's "Production = origin/main" at the pause (PDF p1, lines 11-15) | 0 of 201 TV cards with a wrong or dead number, from 184 of 455 (S-0205); duplicate shifts 6 -> 0 in replay (S-0197) | Paused from 10-21 01:06, so no live write evidence; the review found leaks F1-F3 and wrong-write paths F22, F23 at the next commit (Addendum `:60-108,196-206`) |
| 0f2dcef (2026-10-22) | The outside review's baseline | "The write path ... is the best-defended code in the repo" (Addendum `:26`) | Same findings as the row above; the harness was broken at this commit (fb01342 body) |

What the evidence shows across these rows:
- No candidate was measured at or near 99% on real mail.
- The only version the owner called good is the old engine's matching ("the last version worked
  well", 10-16).
- The old engine's real-mail figures are 78-81%, and staff retyped every order it created.

---

## 5. Origin of 227/500 and 114/500

1. **What they count.** The harness's `e2e` observation: an email reaches its expected final
   state. The reader is the perfect one (oracle mode). The cases are generated with seeds
   (`harness/adapters/spartan/generate.ts:1-10`):
   - **227/500** is the `simple` set (`generate()`);
   - **114/500** is the `update` set (`generateUpdate()`, `generate-complex.ts`);
   - the third set, `create`, scored **0/500** in the same run.

   The numbers are one metric on two different sets, not two metrics on one set.
2. **First written:** commit fb01342, 2026-10-23T22:37:50-04:00 = 2026-10-24T02:37Z. The S-0215
   body, under the review addendum's Phase 2, reads: "the perfect reader scores 227/500, 0/500 and
   114/500, and 165 of the simple set's 273 misses read 'could not plan this email'"
   (`git show -s fb01342`). The same body says the figures were identical case by case at 1f3ae9a.
3. **Cause.** Commit 2e95eb6 (2026-10-20, S-0198) added `once()` to `plan.ts`, which copied the
   World with a spread. The harness's `FakeWorld` is a class, so it lost `placesNamed`,
   `orderByNumber` and `orderById`. Every case naming a venue or an R number ended "could not
   plan" (`git show -s 83e4972`; `test/harnessGate.ts:4-6`). Nothing went red, because
   `test/harnessScore.ts` had been deleted on 10-11 (1bf6cde).
4. **Repaired:** commit 83e4972, S-0216 (2026-10-24T03:11Z), headline "simple 227->304, create
   0->171, update 114->154 of 500". The new floors are written into `test/harnessGate.ts:25`.
   The same body says what remains: the cases' expected answers predate four owner rulings.
5. **Reproduced at HEAD 6a98170, $0, in-process:** `npx tsx test/harnessGate.ts` printed simple
   304/500 (19 wrong-write flags), create 171/500, update 154/500 (6 flags), context 40/40, and
   mutant 240/500 with 0 wrong writes, then "ALL PASS".
6. **On disk.** `harness/runs/{simple,create,update}-oracle-results.jsonl` (mtime
   2026-10-24T02:55Z) hold the post-fix runs: 304, 171 and 154 (counted from each row's `e2e`
   observation). The 227 and 114 runs were overwritten, and no file now holds them.
   `harness/runs/simple-replay-results.jsonl` (mtime 02:29Z, before fb01342's commit at 02:37Z)
   scores 140/500, probably the broken-world replay that fb01342 reports. That is an inference
   from the timestamps; no ticket gives the figure.
7. **Not the same 114.** S-0042 (2026-09-30) reads "harness 114 -> 120/135". That is the old
   engine's 135-scenario audit harness, an unrelated figure.
8. **Against OPERATING.md §2** ("First evaluation on 500 real inquiries: 227/500 on [METRIC A],
   114/500 on [METRIC B]. This is the true baseline. Earlier estimates were not based on real
   data", `OPERATING.md:83-85`):
   - not real: generated email, with people, companies and venues "made up"
     (`generate.ts:9-10`);
   - not two metrics: one metric, `e2e`, on two sets;
   - not a baseline of the system: the perfect reader on a fake OnSinch broken since 10-20,
     repaired 34 minutes after the figures were first written (fb01342 at 02:37Z, 83e4972 at
     03:11Z);
   - the 494/500 that preceded it was also generated email, so "earlier estimates were not based
     on real data" holds for the 494 as well as for the 227.

---

## 6. Referents for OPERATING.md §2's unfilled placeholders (audit STATE N1)

| Placeholder | Candidates found in the inputs |
|---|---|
| "previous known-good version [NAME/TAG]" | Section 4; nothing is named |
| "the owner's audit [LOCATION]" | `~/fleet/resume/Spartan-Audit-2026-10-03.md` (a claude.ai doc 3159313d..., not readable offline); `~/fleet/resume/Spartan-Audit-2026-09-29.md` with `audit/REPORT.md`; `~/fleet/resume/Spartan-System-Audit-2026-10-06/`; the outside review `~/fleet/resume/Spartan-Crew-Review-Addendum.md` (10-23) |
| "the previous 99% plan [LOCATION]" | `Spartan-Jobber-2026-09-15.md` with `docs/ACCURACY-PLAN-2026-09-16.md`; `harness/reports/01-discovery.md` §2.5 with `harness/STATE.md` (494/500); `docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md` (its spec, claude.ai doc HFfojdoGiw67o84WwAtUet, not readable offline); the matcher plan (claude.ai doc B4KcSocFq1CkCvAQTRhgCG, not readable offline) |
| "the 500-item results with input/expected/actual [LOCATION]" | `harness/runs/{simple,create,update}-oracle-results.jsonl` and `-review.md` (10-24 post-fix runs; each row holds the case id, branch, observations and an expected-vs-got detail); the 10-10/10-11 runs `harness/runs/{oracle,record,replay}-results.jsonl` (494/500) |

---

## Method and limits

- **Read in full:**
  - `DECISIONS.md`, `HANDOVER.md`, `ASSUMPTIONS.md`, `README.md`, `CLAUDE.md`;
  - `harness/STATE.md`, `harness/README.md`;
  - `docs/BUILD-OVERVIEW.md`, `docs/CORPUS-STUDY-2026-08.md`, `docs/ACCURACY-PLAN-2026-09-16.md`,
    the V1 working plan;
  - the 09-15, 09-17, 10-06 rebuild, 10-23 matcher and outside-review handoffs, and the PDF;
  - sections 1 of appendices B and C, and section 3 of the 10-21 handoff.
- **Read in part, or searched:** every other `~/fleet/resume/Spartan-*.md` and every `docs/*.md`
  (indexed and searched for 99%, rulings, open questions); all 217 tickets (headlines, plus
  measured fields where cited); the full `git log` (504 commits on `v2`); code comments under
  `app/` matching the owner's first name, "approved", "ruling" and "decided".
- **Not readable offline**, and not read: claude.ai docs cited by handoffs
  (HFfojdoGiw67o84WwAtUet, B4KcSocFq1CkCvAQTRhgCG, 0f68c0a7..., 3159313d..., 319zX7xj...); the
  outside reviewer's "two-page review notes" (Addendum `:3`); session transcripts.
- **Outside my inputs, not read:** two other Spartan text files on the Desktop.
- **Agents may have paraphrased rulings.** Rulings older than 10-11 are mostly known through agent
  handoffs, not the owner's words. The 10-21 handoff warns never to present a rule the agent
  invented as the owner's (H21 `:498-499`), and Round 3 is "recorded-not-confirmed" (C-items
  `:87-91`). Rows
  sourced only to a code comment (for example A11, A34, A35, B16, B20) rest on that comment's
  attribution.
- **What I ran.** The only executions were read-only: `git log` and `git show`, grep, the
  `pdftotext` extraction, and `npx tsx test/harnessGate.ts` (in-process oracle and mutant, $0, no
  network). The PDF text and a scratch folder lived in `.tmp-v2/historian/`, deleted on
  completion.
