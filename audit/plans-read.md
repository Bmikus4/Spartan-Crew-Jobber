# Plans read: the owner's audit and the previous 99% plan (OPERATING.md §2)

- **Agent:** plans-reader
- **Brief hash:** 65fcb127
- **Written:** 2026-10-25T21:52Z (machine clock, UTC). Read-only. Repo HEAD at read time was `f084d53`
  (the brief names `6a98170`; four commits have landed since). Compared against the working-tree
  copies of `audit/history-and-assumptions.md` (git blob `5e4e451`) and `audit/reconstruction.md`
  (blob `844217c`); line numbers for those two files refer to these copies.

Conventions. `~/fleet/` means `C:\Users\thera\fleet\`. Every other path is relative to the repo.
`S-0nnn` is a ticket in `public/data/feed.json`. "The owner" is the person whose rulings these are.
Inside quotes, the owner's first name is replaced by "[the owner]". Nothing else in a quote is
changed. Staff, reviewers and clients are named by role only.

The three Claude Docs documents were read only with the connector's `read`:

| Key | Doc id | Artifact link id | Title | Byline date | Rev read | Body node |
|---|---|---|---|---|---|---|
| A | 3159313d-a219-447d-a2c2-7edc989ec1fb | 76SP6MbkUW71bczoWc1Y6n | Spartan Audit 2026-10-03 | 2026-10-03 | 40 | e2530355-0513 |
| V | 839e8bd7-05a7-48b7-84be-4988d2a7ae69 | HFfojdoGiw67o84WwAtUet | Spartan V1 Master Plan | 2026-10-15 | 28 | 451c5a7e-7f41 |
| M | 51721661-1d7e-4ab3-be24-41a1f5450a49 | B4KcSocFq1CkCvAQTRhgCG | Spartan Job Matcher Plan | 2026-10-22 | 25 | 284e328f-996f |

How the doc citations work:
- `A .5912` means block `mtkqkg6p0e9.5912` of doc A. V's blocks are `mwdyzgdsdf8.N` and M's are
  `m1pkk196qsf.N`.
- For a table, the id is the table's own id, and the row is named.
- To re-open a quote:
  `read(ref={"object":"node","id":"<body node>"}, container={"kind":"project","id":"<doc id>"}, engine="prose", payload={"kind":"search","text":"<quoted words>"})`.

This mapping settles the three ids that history §6 marked "not readable offline"
(`audit/history-and-assumptions.md:571-572,590-591`):
- HFfojdoGiw67o84WwAtUet is V. The working plan names it as its spec
  (`docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md:3`).
- B4KcSocFq1CkCvAQTRhgCG is M.
- 3159313d... is A. The snapshot's header names it (`~/fleet/resume/Spartan-Audit-2026-10-03.md:1`).

---

## Summary (one page)

**Read.** Each doc was read whole (its `view` read returned `complete: true`), and none was blocked.
The eight local candidates were read in the parts listed under Method.

**What the three docs are.**
- **A** is a read-only audit of the old engine at `0a7c973`, dated 10-03. It found:
  - intake down for about 53 hours with no alarm;
  - 3 live incidents and 9 confirmed defects;
  - every engine order since 09-30 deleted by staff.

  Its later sections record the owner's rulings of 10-03. One of them approves an AI link check, on
  the condition of "a realistic and actual accuracy % after with a safe sample size behind it". That
  measurement ran the next day (S-0120): the check got 314 of 374 real past decisions right (84%)
  and made 14 wrong links (3.7%). A had already stated that "fewer than 1% wrong links" could be
  claimed only with zero wrong links.
- **V** is the V1 plan of 10-15. Its promise was "no more than 1 in 100 reaching the TV". It measured
  the live build at:
  - 10 of 49 bookable emails done;
  - 1 of 15 bot orders kept by staff;
  - 0 of 13 time changes or cancellations written.

  It says itself "1 in 100 not met (this plan)" and "On today's data, the offer is worth less than
  nothing". It promised six phases, ending in four live weeks at 1 in 100.
- **M** is the matcher plan of 10-22/23. Its bar: "99% of its answers on knowable cases must be
  right, proven by the lower 95% bound".
  - Steps 1-4, which call no model, are done. The score alone is 94.3%, which M calls an upper
    estimate, and at a 0.95 threshold it decides 70.5% of emails at 99.63%.
  - M also rules "Unsure counts as a miss". By that rule about 70% of its answers are right today.
  - The model steps (5-6) and the switch to live (9) never ran.

**Placeholders.**
- **"the owner's audit"**
  - Best fit: A. It is the only candidate that is titled an audit, sits in the owner's own docs, and
    records the owner's rulings.
  - Runner-up: the outside review addendum. It is the only audit of the current v2 system, but it
    is a reviewer's "static review", not the owner's.
- **"the previous 99% plan"**
  - Best fit: the verification harness plan, `harness/reports/01-discovery.md` §2.5, with its
    results in `harness/STATE.md`.
  - It is the only candidate that fits both halves of OPERATING.md:51-52, "guaranteed 99% and
    delivered 45%". Its 99% target was reported "MET" on its 500-case simple set, and 45% is 227/500
    on that same set.
  - Runner-up: M. M is the newest plan with 99% as its headline, but it never produced a 45% and
    covers matching only.
  - V rules itself out: it says its own bar is not met.
- Neither placeholder can be settled from the documents alone. Audit STATE N1 still needs the
  owner's answer.

**Changes to the history** (14 items, in the last section):
- **Confirms** history §3.4, §3.5, §3.8 and §4's "no version is named known-good", and
  reconstruction §6.3's "built or pre-selected inputs" pattern (H1, H7, H11, H14).
- **Weakens the label "real-mail end-to-end"** on the 78/100 and 78-81% rows. The 09-29 audit
  says those figures measure the reading leg only, and that "A real thread has to survive both"
  (H3).
- **Adds** the AI link check's real-data result (84% right, 3.7% wrong links, against its own <1%
  bar), and two 10-03 rulings that history §2 does not have (H4).
- **Strengthens** the evidence against `0a7c973` as a known-good version (H5). **Weakens** the use
  of "staff retyped every order" as evidence that the orders were wrong (H6).
- **Extends §3.7**:
  - the reader went live after a 22-email check, where the settled plan required 100 labelled
    emails (H9);
  - by 10-15 the value checker was already causing 63% of hand-offs (H8).
- **Sharpens §3.9**: by M's own metric, its measured state is about 70%, not 99.63% (H10).
- **§5 is unchanged**: none of the three docs mentions 227 or 114 in that sense (H13).

---

## 1. Doc A, "Spartan Audit 2026-10-03" (rev 40), and its text snapshot

**Files.**
- Doc A.
- `~/fleet/resume/Spartan-Audit-2026-10-03.md` (511 lines). It says of itself "this file is the
  20:35Z snapshot", and it names A as "The current version" (`:1`).
- A has three sections the snapshot lacks:
  - "Rulings since the audit: linking and deduplication" (A .28352);
  - "The build, from 2026-10-03" (A .43233);
  - "Session context, 2026-09-30 to 10-03" (A .36872).

**What it measured, and on what data.** It was read-only, against the repo at `0a7c973` (equal to
origin/main) and the production deployment at the same sha (A .430).
- Checks it ran:
  - typecheck;
  - the 147-file suite;
  - the offline harness: "120/135 runs fully correct (89%), 99% of checks, 100% repeatable"
    (A .23282);
  - 3 days of Vercel logs (817 requests), n8n executions, Neon SELECTs and 49 OnSinch GETs
    (A .23282).
- Counts from production:
  - "all 24 engine orders since 09-30 gone; staff created 46 in the same period (8 creators); the
    engine re-bound to 12" (A .14048, row SP-41);
  - `needs_human` 232, of which 189 are older than 7 days (A .14048, row SP-40);
  - "date-only linking made 57 of 90 link decisions (10 since the 09-30 restart)" (A .29253).
- For the link check it built "392 real past decisions: 254 enquiry (153 at a thread's first client
  email, 101 at later emails where the candidates changed) and 138 replacement" (A .45769).
- It did not measure the reading of real mail. The one real-mail figure it gives, "78-81% on real
  mail", is carried over from earlier work (A .21416).

**What it concluded.**
- "Spartan intake was down from 2026-10-01 15:05Z to 2026-10-03 about 20:42Z (about 53 hours), and
  no alarm reached anyone." (A .31)
- "Three production incidents are live now; nine code defects are confirmed, four of them latent
  until an OnSinch or n8n error trips them." (A .5912)
- "The code passes every check it has; the failures are in production wiring and in paths no test
  exercises." (A .23176)
- "Twelve claims made as done are partial, wrong or unverifiable" (A .21319). Among them is "99%
  end-to-end (09-15)", answered with "120/135 offline, 78-81% on real mail" (A .21416).

**What it promised.**
- A nine-step plan: "Intake is back; restore the alarms next, then stop one job overwriting
  another, then the latent defects, then the approved build." (A .24745)
- The approved build:
  - commit the link check switched off;
  - label all 392 decisions by hindsight;
  - "The paid run";
  - "The report: accuracy with its 95% interval, the wrong-link rate, the held rate, and the old
    rule's numbers on the same cases";
  - then switch the check on (A .47090).
- A stated power limit: "with about 380 labelled decisions, the interval at 95% accuracy is about ±2
  to 3 points, and "fewer than 1% wrong links" can be claimed only if there are no wrong links at
  all." (A .47671)

**What became of the promise.** S-0120 (2026-10-04T22:23Z) carries the measurement.
- Data: "392 hindsight-labelled link points (gold.jsonl: 356 by hand, 36 by stated R number; 18
  unsure excluded)".
- The check: 314/374 right (84%, Wilson 95% 79.9-87.3), 14 wrong links (3.7%, 2.2-6.2), 29 held,
  17 missed.
- The old date/venue rule: 269/374 right (71.9%) and 28 wrong links (7.5%).
- The check was committed "behind SPARTAN_LINK_JUDGE (unset in production)" (S-0083).
- No ticket records it being switched on. A search of `feed.json` for `link.?judge|LINK_JUDGE`
  finds only S-0083, S-0094 and S-0120.
- The old engine was paused on 10-07 (`audit/history-and-assumptions.md:100`).

**Against the history:** H1, H2, H4, H5, H14.

## 2. The 09-29 end-to-end audit: `~/fleet/resume/Spartan-Audit-2026-09-29.md` with `audit/REPORT.md`

The handoff (388 lines) says `audit/REPORT.md` (431 lines) "is the executive version of this file"
(09-29 `:22`).

**What it measured, and on what data.**
- The old engine at `5ee98e2`, on 45 scripted scenarios × 3, with a fake tenant and a scripted model:
  - "End-to-end success: 64% — 87 of 135" (`REPORT.md:24`);
  - 71% (96/135) at `0d8688b` (09-29 `:77-78`).
- Separately, the model leg, recomputed from 5 bought runs over 100 real threads: 78–82%, and
  70–71% strict (`REPORT.md:62-64`; 09-29 `:97-100`).

**What it concluded.**
- "The two legs are independent failure sources and **must not be multiplied or averaged**" (`REPORT.md:66`).
- "A real thread has to survive both." (`REPORT.md:68`)
- On the 64%: "It is the right number for comparing this build against the next one; it is not a
  claim that 30% of real bookings go wrong." (`REPORT.md:393-394`)

**What it promised.** Nothing was built: "None of these were made; this pass measured only."
(`REPORT.md:316-317`). It ranks five improvements.

**Against the history:** H3. Its figures agree with history §3.5 (`:365-372`).

## 3. `~/fleet/resume/Spartan-System-Audit-2026-10-06/`

**Contents.**
- `01-intake-map.md` (206 lines), "Read-only research pass, 2026-10-06, against main at about
  71dbae1" (`:3`). Only part 01 of what looks like a numbered set exists.
- Three JSON lists of To Confirm orders:
  - 7 orders listed on 10-07;
  - 10 deletion results from 10-06 to 10-07 (9 "deleted", 1 "already gone");
  - 4 deletions on 10-08.
- `ui-recon/`: captures of three OnSinch admin pages (3 JSON files and 1 HTML file).

**What it measured.** It read the intake code and the n8n workflows. It has no accuracy figure.

**What it concluded.**
- "Once n8n claims a message and strips its "New" label, any failure before the engine stores the
  message loses that email for good." (`:7`)
- It ranks 12 gaps (`:193-206`).

**What it promised.** A fix for each gap, for example "claim after capture, or release on a non-2xx"
(`:195`).

**Against the history:** nothing in §3-§5, because it measures lost intake, not accuracy. Its subject
is OPERATING's `inquiry_recall`, which is outside this brief.

## 4. The outside review addendum: `~/fleet/resume/Spartan-Crew-Review-Addendum.md` (10-23)

**What it measured.** Nothing was run: "This was a static review only. ... Nothing was run and no
endpoint was called." (`:7`)
- Its baseline is v2 at `0f2dcef`.
- Its accuracy table reprints ticket figures (`:229-252`).
- Its findings F1-F15 and F22-F28 are verified against the code at that commit.

**What it concluded.**
- "Can this work? Yes." (`:19`)
- "The gap is in the middle, and it's engineering, not a limit of AI." (`:22`)
- "The write path (bot, ledger, read-back, To Confirm) is the best-defended code in the repo." (`:26`)
- On the scoring: "a held-out week is the honest number, and a 1-in-100 bar needs a few hundred
  emails" (`:262`).

**What it promised.** It names no percentage: "A realistic target: the system completes routine
requests itself, and pre-fills the rest so staff confirm with one click (5.8)." ... "I'm not
putting a percentage on it before that exists." (`:24`) It lists phased priorities and gives
prompts for an agent in its section 9.

**Against the history:** nothing new. History already cites it (`:111,414,417,459,487,509`).

## 5. The 09-15 goal with the 09-16 "A to B" plan

**Files.** `~/fleet/resume/Spartan-Jobber-2026-09-15.md` and `docs/ACCURACY-PLAN-2026-09-16.md`.

**What it measured.** The 09-16 plan scored "the 638-thread live test set against what OnSinch
holds" (`ACCURACY-PLAN:3-5`):
- company 141/141;
- dates 122/122;
- venue text 122/124 after adjudication;
- 0 wrong links of 178;
- 109 of 287 binds pointing at a deleted order (`:23-35`).

**What it concluded.** "On everything currently measurable, the engine is at or near the bar ...
The 99% claim cannot be made, and not because the engine misses — because three of the eight
mechanisms in §4's table have no instrument at all" (`ACCURACY-PLAN:159-162`).

**What it promised.**
- The 09-15 handoff: "get this automation from its current, unmeasured accuracy to 99% end-to-end on
  everything that is truly obtainable — intake to created order — and prove it with a test that
  honestly tries to break it." (`Jobber-2026-09-15.md:3-5`)
- It also says: "The 1% linking bar is NOT currently proven and cannot be proven from existing
  data." (`:192`)
- The 09-16 plan: "Nothing in this file is a reason to change engine behaviour yet. Measure
  first." (`ACCURACY-PLAN:171`)

**Against the history:** nothing new, since history §3.4 already covers it. H2 concerns how doc A
later filed this goal.

## 6. The verification harness: `harness/reports/01-discovery.md` §2.5 with `harness/STATE.md`

**What it measured.** Generated cases, 500 per set.
- "Oracle (perfect reader), 500 cases: 494/500" (`STATE.md:26`).
- Production model: "494/500 = 98.8% (95% CI 97.4-99.4%)" (`STATE.md:34`).
- Complex sets: 500/500 each, after fixes made against those same cases (`STATE.md:43-58`).

**Target.** "End to end: 99% of client emails reach the correct final state." (`01-discovery.md:279`)
It adds: "there is one AI node, so it carries almost the whole budget" (`:280`).

**What it promised.**
- A 3,000-case plan that includes "X: real emails, test split, stratified by intent | 1,200"
  (`:300`). That block never ran (history `:402-404`).
- An honest limit on confidence: "75 cancellation cases with zero failures supports about 96% at
  95% confidence, not 99%" (`:309-310`).

**What its report claimed.** "End to end correct (target 99.0%) | **MET** | 500/500 = 100.0%"
(`harness/runs/simple-oracle-report.md:14`, last committed `92f7256`, 2026-10-10).

**Against the history:** nothing new. It agrees with §3.7 and §3.10.

## 7. Doc V, "Spartan V1 Master Plan" (rev 28), with the repo working plan

**Files.**
- Doc V.
- `docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md` (111 lines). It names V as its spec:
  "Where this file and the doc disagree, the doc's settled table wins." (`:4-5`)

**What it measured, on live data from 13 Oct 16:00 to 15 Oct** (V .561 table):
- 10 of 49 bookable emails done by the system (20%);
- 1 of 15 bot-created orders kept by staff, and 8 of 15 deleted and rebuilt;
- 0 of 13 live time changes and cancellations written;
- 26 of 41 hand-offs caused by the value checker (63%);
- 15 of 19 open TV cards with no R or J number;
- 3 of 4 browser canary runs crashed.

Over every live write since 9 Oct (V .4096), there were 12 verified creates, 3 stopped part-way and
3 blocked, and all 13 time changes and position cancellations were blocked. The working plan adds
mining of "2,000 orders, 3,145 staff shifts" (`:21`), including "Since 10-12: 1 of 8 real bot orders
adopted" (`:33`).

**What it concluded.**
- "On today's data, the offer is worth less than nothing." (V .20981)
- "The main reason is a design choice, not a bug: the rebuild refuses whenever code cannot re-derive
  a value from the client's words." (V .1669)
- "You are right that the rebuild drifted: it rewrote detection and extraction instead of keeping
  the old engine's and swapping only the writer." (V .5976)
- On staff rebuilding the bot's orders: "Staff simply did not use the bot's order." (V .4706)

**What it promised.**
- "Six phases, in this order, each closed by a number measured on live email, not by a test
  passing. ... V1 is declared at the end of Phase 5, after 4 weeks at 99 in 100" (V .18975).
- Phase 5's exit: "4 consecutive weeks at no more than 1 in 100 emails failing or corrected,
  adoption at least 95%" (V .25938).
- Phase 2, "Restore the old reading, piece by piece", with the exit "Replay of 9-15 Oct: no miss
  caused by detection, extraction or a missing venue, and none of the old engine's known failures
  returns" (V .25938).
- The settled measure: "Built to at most 1 failed email in 100; the effect is measured as the share
  of bookings staff never touch" (V .35800, row Measure).

**Its own view of the bar.**
- "1 in 100 not met (this plan)" (V .30729).
- "At about 25 bookable emails a day, 2 weeks gives about 350. That separates 1% from 5%, not 1% from
  2%" (V .22509).

**What became of the promise.** The system was paused on 10-21 (history `:109`), six days after the
plan. The four live weeks that Phase 5 requires could not have passed.

**Against the history:** H6, H7, H8, H9, H14.

## 8. Doc M, "Spartan Job Matcher Plan" (rev 25)

**What it measured.** It replayed history with OnSinch as it stood at each email. No model was called:
"steps 1 to 4 need none of them and are free" (M .21313).
- Today's finder, on 688 client emails from 9 to 22 Oct (M .1750):
  - 85 right, 1 wrong and 10 missed of 96 existing-order emails;
  - 7 of 84 new bookings pinned to an older order;
  - the true order present among the candidates gathered, 301 of 302;
  - production's own recorded links at decision time, 38 of 284.
- The gold set (M .23343):
  - 3,145 client emails since 29 Jul, of which 1,947 are labelled, from 14,712 staff actions;
  - the true order offered for 1,498 of 1,498 labelled emails;
  - score alone 90.3% on 1,540;
  - after the reader fix and 147 adjudications, 94.3% on 1,522;
  - at 0.95, 70.5% decided at 99.63% (lower bound 99.05%);
  - at 0.99, "51.4%, 783 of 783".
- The labels: "The answer key comes from staff actions in OnSinch after each email, so it needs no
  model and labels itself" (M .2624).

**What it concluded.**
- "Finding the possible orders already works, so every error is in the choice." (M .1563)
- "only the 147 emails where score and label disagreed were read. An email where both are wrong
  together still counts as right, so 94.3% is an upper estimate until a random sample of agreements
  is read." (M .24115)
- "Promotion needs at least 300 gold cases with 0 wrong (about 99% at 95% confidence); the best pair
  has 57." (M .29125)

**What it promised.**
- "99% of its answers on knowable cases must be right, proven by the lower 95% bound, not the point
  estimate." (M .82)
- "Proving 99% takes 1,000 knowable cases with at most 3 misses (lower bound 99.12%), or 1,500 with
  at most 7 (99.22%)." (M .1336)
- Nine steps, of which "only steps 5 and 6 cost money" (M .19309). They end with a shadow week
  (M .20586) and "Switch and delete" (M .20726).

**Rulings it attributes to the owner.**
- "Accessible accuracy ... is the accuracy of what we build, regardless of client deviancy or data
  volatility ([the owner], 22 Oct)" (M .637).
- "Code never decides alone. ... Either way, Astra gives the final outcome ([the owner], 23 Oct)."
  (M .14558)

The second ruling sits against OPERATING.md §1's "If code can know it, code decides it". That is a
question for alignment, not for the history.

**What became of the promise.**
- Steps 1-4 shipped (S-0208..S-0212).
- Steps 5-9 "wait on [the owner]'s decisions; the eval is paid and needs his yes"
  (`~/fleet/resume/Spartan-Matcher-Handoff-2026-10-23.md:78-79`).
- The matcher is not wired into the live path (history B67, `:247`).

**About "45%".** M's only "45%" is "only 38 to 45% decided at 0.95", for boosted trees (M .23343,
row "Pairs and trees"). It has nothing to do with OPERATING's 45%.

**Against the history:** H10, H11, H12.

---

## Placeholders

| Placeholder | Best fit | Runner-up | Words that decide it |
|---|---|---|---|
| "the owner's audit [LOCATION]" | Doc A: claude.ai doc `3159313d-a219-447d-a2c2-7edc989ec1fb` (artifact `76SP6MbkUW71bczoWc1Y6n`). Its 20:35Z text snapshot is `~/fleet/resume/Spartan-Audit-2026-10-03.md`. | The outside review addendum, `~/fleet/resume/Spartan-Crew-Review-Addendum.md` (10-23). | **For A:**<br>- its title, "Spartan Audit 2026-10-03" (A .0);<br>- "Audited: repo ... Read-only throughout" (A .430);<br>- it holds the owner's own words and rulings: "go for it, as long as you can give me a realistic and actual accuracy % after with a safe sample size behind it" (A .43260), and a table headed "Decisions waiting on [the owner]" (A .19816).<br>**Against the addendum:** it calls itself a "technical addendum ... A companion to the two-page review notes" (`:2-3`) and says "This was a static review only" (`:7`). It is a reviewer's review. It ranks second because it is the only audit of the current v2 system (`0f2dcef`).<br>**Third:** the 09-29 audit, "A read-only audit of the enquiry engine" (09-29 `:3`), of the old engine at `5ee98e2`.<br>**Last:** the 10-06 folder, a "Read-only research pass" of intake only (`01-intake-map.md:3`).<br>**Caveat:** all three docs carry the owner's byline because the owner's account owns them. A's text was written by an agent ("the first was mine on 2026-10-01", A .21319). For every candidate, "owner's" can only mean owned or commissioned, not written. |
| "the previous 99% plan [LOCATION]" | The verification harness plan: `harness/reports/01-discovery.md` §2.5 (`:275-313`), with its results in `harness/STATE.md`. | Doc M: claude.ai doc `51721661-1d7e-4ab3-be24-41a1f5450a49` (artifact `B4KcSocFq1CkCvAQTRhgCG`). | **OPERATING.md:51-52:** "A prior plan guaranteed 99% and delivered 45%."<br>**Harness:**<br>- target: "End to end: 99% of client emails reach the correct final state." (`01-discovery.md:279`);<br>- its report: "End to end correct (target 99.0%) \| **MET** \| 500/500" (`harness/runs/simple-oracle-report.md:14`);<br>- 45% is 227/500 on that same simple set, measured with the same instrument (history §5, `:521-528`).<br>**M:**<br>- "The target: 99% accessible accuracy" (M .46), "proven by the lower 95% bound" (M .82);<br>- dated 10-22, the newest 99% plan before OPERATING (10-24);<br>- but no M figure is 45%, and it covers matching only.<br>**Ruled out by their own words:**<br>- V: "1 in 100 not met (this plan)" (V .30729) and "On today's data, the offer is worth less than nothing" (V .20981);<br>- the 09-16 plan: "The 99% claim cannot be made" (`ACCURACY-PLAN:160-161`). |

The other two §2 placeholders, `[NAME/TAG]` and the 500-item results, are outside this brief. H14
bears on the first of them.

---

## Changes to the history

| # | Effect | History finding | Evidence |
|---|---|---|---|
| H1 | confirms | §3.4 (`:362-363`), §3.5 (`:366-367`) and the common-thread row "78-81%" (`:484`), all of which cite the snapshot | Doc A carries the same figures as snapshot `:421` and `:439`: "120/135 offline, 78-81% on real mail" (A .21416) and "120/135 runs fully correct (89%), 99% of checks, 100% repeatable" (A .23282). §6 (`:571-572`) and Method (`:590-591`) can drop "not readable offline" for 3159313d..., HFfojdoGiw67o84WwAtUet and B4KcSocFq1CkCvAQTRhgCG. |
| H2 | weakens in part | §3.10: "No plan in the inputs says "guarantee"", and the nearest claim is the harness report (`:463-466`) | A files "99% end-to-end (09-15)" under "D. Claims of completion that do not match reality" (A .21269, row in A .21416), with where made given as "commit message; chats". So a 99% statement had been treated as a completion claim before the harness existed, sourced to chats that history could not search. The snapshot words it "The 99% end-to-end target (09-15) was not reached" (`:421`). Neither says "guarantee". |
| H3 | weakens | The common-thread heading "Real-mail end-to-end figures" (`:479`) for the 78/100 and 78-81% rows (`:483-484`); §4's "The old engine's real-mail figures are 78-81%" (`:515`); the summary's band (`:53`) | The 09-29 audit says the 78–82% "measures whether the interpretation was right", that it must not be "multiplied or averaged" with the machinery figure, and that "A real thread has to survive both" (`REPORT.md:62-68`; 09-29 `:97-99`). The machinery leg scored 64-71% on scripted scenarios (`REPORT.md:24-31`). The 09-17 handoff had called 79/100 "the figure the 99% target is about" (`Jobber-2026-09-17.md:34`); the 09-29 audit is the later and more explicit classification. So no real-mail end-to-end figure exists for the old engine, and 78-82% is an upper bound on one. |
| H4 | adds | §3.4's linking line, which uses only the old rule's 28/374 (`:356-357`); the ruling list in §2 and reconstruction §6.3's "113 rulings" (`reconstruction.md:171`) | (a) S-0120 also reports the AI check the owner approved on 10-03: 314/374 right (84%, Wilson 79.9-87.3) and 14 wrong links (3.7%, 2.2-6.2), on 356 hand labels and 36 R-number labels. A's own bar was "fewer than 1% wrong links can be claimed only if there are no wrong links at all" (A .47671). The check missed it by about 4×, and no ticket shows it switched on (S-0083: "unset in production").<br>(b) Two rulings of 10-03 are absent from §2: "every single deduplication should get an AI step, with reinforced deterministic steps" (A .28403) and "split it, (multiple orders CAN be attatched to a single enquiry)" (A .43260). `grep -n -i "reinforced\|split" audit/history-and-assumptions.md` finds 0 hits. V lists the first as in force, "Yes (hard)" (V .10551). The only code quoting it is `app/lib/engine/linkJudge.ts:6`, in the frozen engine. Their status in v2 is not assessed here. |
| H5 | strengthens | §4's old-engine row, "evidence against" (`:505`), which cites snapshot `:440` for `0a7c973` | At `0a7c973` itself, A records:<br>- "Three production incidents are live now; nine code defects are confirmed" (A .5912);<br>- intake down about 53 hours with no alarm (A .31);<br>- "Venue judge timeouts book the wrong venue" (row SP-06) and "A later email replaces the whole request list", where "12 crew became 8" (row SP-10, A .6119);<br>- "all 24 engine orders since 09-30 gone" (row SP-41, A .14048). |
| H6 | weakens in part | §4's "staff retyped every order it created" (`:515`) and §3.4's business-outcome line (`:360-361`), used as evidence that the orders were wrong | V found that staff rebuilt bot orders whose content was identical: "Staff simply did not use the bot's order." (V .4706). The working plan says: "Two identical re-keys mean the hand-off channel failed, not the order." (`:35-36`). A re-key count measures the hand-off as much as the order. S-0012's reading for the old engine ("the retype is a repair, not a rejection", over a separate chief block) still points at a defect in the order's shape. |
| H7 | confirms, and adds a row | §3.8, "a requirement, not a measurement" (`:438`), and the real-mail table (`:479-490`) | V: "On the current build (13 Oct 16:00 to 15 Oct), the system did 10 of 49 bookable client emails, about 1 in 5. The bar is 99 in 100." (V .358). This falls inside history's 2/22-81% band. V itself: "1 in 100 not met (this plan)" (V .30729). |
| H8 | strengthens | §3.7, "The model was not the only node that missed" (`:412-414`), sourced to S-0217 of 10-21 | Six days earlier, V wrote: "The main reason is a design choice, not a bug: the rebuild refuses whenever code cannot re-derive a value from the client's words." (V .1669). The value checker caused 13 of 39 misses (V .1967) and 26 of 41 hand-offs (63%) (V .561). |
| H9 | extends | §3.7, "The production model changed" (`:424-425`), and B55 "enforced" (`:235`) | The settled table of 15 Oct: "GPT-6.1 Sol decides, a code check verifies every value; Sol is checked on 100 labelled emails before it goes live" (V .35800, row Decider). The working plan: "Validate Sol on 100 labelled emails (about $1) before it decides live" (`:82`). Only one ticket names Sol: S-0189, "vs ops 9/22 (9/15 allowed)". Reproduce with a search of `feed.json` headlines and subjects for `/\bSol\b|gpt-6\.1/`, which gives 1 hit. The reader went live on a 22-email check, not the 100 the settled table required. |
| H10 | sharpens | §3.9 (`:449-458`) and the common-thread row "99.63% on the 70.5% decided" (`:477`) | M's own metric:<br>- "Unsure counts as a miss, so the bar cannot be met by handing work to people" (M .950);<br>- "Every gold case is adjudicated once" (M .783), yet "only the 147 emails where score and label disagreed were read" (M .24115).<br>By M's definition, the measured scorer at 0.95 gets at most 0.705 × 0.9963 = 70.2% of answers right. The other 29.5% stay Unsure until the Astra step (steps 5-6), which was never built or paid for (M .19309; progress lists steps 1-4 only, M .23182). The "1,000 knowable cases" a proof needs (M .1336) have not been adjudicated. |
| H11 | confirms | reconstruction §6.3, "Every figure at or above 97% came from built or pre-selected inputs" (`reconstruction.md:177-181`), and history `:470-477` | Every figure at or above 97% in the three docs fits that rule:<br>- 1,498/1,498 recall and 783/783 at 0.99: labels from staff actions, restricted to labelled emails (M .23343);<br>- 301/302 (M .1750);<br>- "7 of 7 bookings identical through both writers on TEST" (V .16975);<br>- "99% of checks" on the scripted harness (A .23282).<br>V's 243/243 and 77/77 count what staff do, not system accuracy. |
| H12 | weakens the wording | reconstruction §6.3, "On unrelabelled real mail, figures run from 2/22 to 81%" (`reconstruction.md:183`) | History limits this to end-to-end figures (`:53`). Single-mechanism real-mail figures above 81% exist: the link check at 84% on hand labels (S-0120), and today's finder at 85 of 96 existing-order emails (M .1750). Per H3, 78-81% is the reading leg. Restoring the qualifier "end-to-end" keeps the sentence true. |
| H13 | no change | §5, the origin of 227/500 and 114/500 (`:519-562`) | None of the three docs mentions 227 or 114 in this sense. A search of their text finds "227" 0 times, and "114" once, in "114 labels removed on 96 threads" (A .39017). All three are dated before `fb01342` (2026-10-24T02:37Z). |
| H14 | confirms | §4, "No version is named known-good anywhere in the inputs" (`:496`) | None of the three docs names a tag or commit as known-good. V names a component, not a version: "Restore whole-thread detection and the overrule", "Restore full-state extraction" (V .6275), that is, the old engine's reading. A, on that same engine, lists the live defects in H5. |

---

## Method and limits

**The Claude Docs reads.**
- Calls made:
  - `read` on each doc (its tabs);
  - an outline read of each body;
  - a whole-body `{"kind":"view"}` read;
  - one `{"kind":"history"}` read on V, which returned no rows.
- One call to the connector was not a read: `guide(topic.index)`, to learn the read payload. It
  touches no document.
- Nothing was created, edited or commented.
- The large view replies were saved by the harness. I turned them into text with a scratch script in
  the session scratchpad (outside the repo) and deleted it afterwards.

**Local files read.**
- In full: `docs/superpowers/plans/2026-10-15-spartan-v1-working-plan.md`, `harness/STATE.md`, and
  `01-discovery.md` §2.5.
- In part:
  - snapshot `:1-41` and `:403-511`. The rest duplicates A, as the snapshot's own change list at
    `:3-9` says;
  - 09-29 `:1-107` and headings;
  - `REPORT.md:1-71` and `:314-412`;
  - `01-intake-map.md:1-12` and `:171-206`;
  - the addendum `:1-40`, `:229-263`, `:396-412` and section 9;
  - `Jobber-2026-09-15.md:1-47` and `:142-204`;
  - `ACCURACY-PLAN:1-42` and `:135-171`.
- For checking: the matcher handoff `:13-24` and `:60-82`, and `Jobber-2026-09-17.md:28-40`.
- `feed.json` was searched in a sandbox for S-0012, S-0083, S-0094, S-0120, S-0189 and S-0208..S-0212.

**Not read.**
- The outside reviewer's "two-page review notes" (Addendum `:3`).
- The developer handoff PDF.
- The claude.ai docs 0f68c0a7... and 319zX7xj... that history `:590-591` lists, which are not in
  this brief.

**Judgement calls.**
- The placeholder fits are judgements made from the documents' own words. Audit STATE N1 still
  needs the owner's confirmation.
- H4(b) names two rulings without judging whether v2 enforces them.
