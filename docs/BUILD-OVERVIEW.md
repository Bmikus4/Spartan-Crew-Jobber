# Spartan Crew Enquiry Engine — Build Overview (human interpretation)

*2026-07-20. Companion doc: `CLAUDE-BUILD-MANUAL.md` (the executable version of this
plan). API ground truth: `Spartan-Crew-Onsinch-API-Reference.md` (verified live).*

## 1. What this is, in one paragraph

An email comes into the Spartan Crew bookings inbox. The engine reads the whole
thread, decides whether it's a job, extracts the facts (who, where, when, how many,
what skill), resolves them to real OnSinch records, composes the order **on that
client's correct rate card**, stages it as a booked draft, and writes the reply.
A human clicks once to confirm. That's the entire product: enquiry → booked job,
with the human reduced to one click — and eventually to zero.

## 2. Where it stands today (verified, not aspirational)

**Built and live:**
- The pure engine (compile loop over a Save State Table) — 20/20 offline test.
- The Next.js dashboard app, deployed at `spartan-crew-jobber.vercel.app`,
  Neon Postgres wired, metrics/settings/webhook routes all live.
- OnSinch API fully mapped against the production tenant (2026-07-20, with
  Tracy's key): every endpoint, every accepted field, verified live with
  create→patch→delete cycles on the TEST company.

**Not built yet (the gap this plan closes):**
1. The engine speaks an *idealized* OnSinch — it must be aligned to the verified
   contract (camelCase endpoints, rate cards, id custody, no nested patches).
2. **Rate resolution** — Tracy's #1 requirement — has no module yet.
3. The LLM prompts are trimmed stand-ins; the full ported prompts are owed.
4. No Gmail trigger workflow in n8n; two secrets missing on Vercel.
5. The dashboard shows counts but has no confirm-queue *list* (the one-click).
6. No replay proof against real historical threads.

## 3. The one rule that outranks everything (Tracy)

Clients are on different default rates. In OnSinch, money never appears on the
order — the rate comes entirely from `Job.pricelist_category_id`. We proved live
that omitting it silently books a **default** card. Therefore:

> **Invariant #1: every order the engine writes carries an explicitly resolved
> `pricelist_category_id`. If the engine cannot resolve it with confidence, the
> order stops in the needs-human lane. No exceptions, in any mode.**

Resolution = the client's own recent order history (majority card, most recent
period wins), seeded by a one-time export from Tracy, audited after the fact
against invoice line prices.

## 4. Why this shape (the philosophies, applied)

- **Retardmaxxed:** one compile function, one state row per thread, re-runnable
  any time with zero duplicate work. No orchestration spaghetti — 155 n8n nodes
  became one loop.
- **Foundational:** the Save State Table is the load-bearing wall. Dedup,
  idempotency, "never miss a lead", the confirm queue, and metrics are all just
  views of that one table.
- **Deterministic > model:** the LLM does exactly 3 jobs (classify, extract,
  write the reply). Code does everything with an integer in it — ids, rates,
  order bodies, diffs. The model never touches money or ids.
- **Plan then execute:** launch is draft-only. The flip to hands-free is earned
  with measured numbers, not vibes (§6).

## 5. The build, in five phases

| Phase | What | Why it's ordered here |
|---|---|---|
| **A. Truth alignment** | Engine ↔ verified API contract: rate module, id custody, real update paths, camelCase clients | Everything downstream writes through this |
| **B. Rate ground truth** | Script-pull every client's order history → company→rate-card table in Neon + Tracy's export | Invariant #1 needs data before code can honor it |
| **C. Live plumbing** | n8n Gmail trigger → webhook; two secrets on Vercel; full prompts ported | Turns the deployed shell into a running system |
| **D. Replay proof** | Re-run real historical threads through the engine; score against the real orders that were actually created | The only honest accuracy number; gates launch |
| **E. Launch & earn auto** | Confirm-queue UI, draft-only launch, measure, statistically-gated flip to auto | Human-in-the-loop until the numbers say otherwise |

Phases A+B can run in parallel; C needs A; D needs A+B+C; E needs D.

## 6. The measurable gates (nothing ships on feel)

- **Replay gate (enter launch):** on ≥100 real historical threads —
  job-detection ≥97%, zero wrong-client orders, zero wrong-rate orders among
  resolvable clients, 100% idempotency (every thread re-run twice → identical
  state, zero duplicate writes).
- **Auto-flip gate (leave draft-only):** ≥50 consecutive engine-proposed orders
  confirmed by a human **without edits**, and a needs-human rate that has
  stabilized below 20%. Flip is reversible with one settings toggle.
- **Rate audit (forever):** nightly job compares invoiced unit prices per client
  against their history; any drift flags the order and freezes auto mode.

## 7. Who does what

- **Claude (build-time):** Claude Code executes the manual — main session
  implements; scoped subagents do recon and parallel ports; every phase ends
  with its verification step run, not skipped.
- **Claude (runtime):** one model — `anthropic/claude-opus-4.8` via OpenRouter,
  temperature 0 — doing only the 3 language tasks.
- **Ben:** provides the two secrets to Vercel, approves the n8n workflow going
  live, owns the auto-flip decision.
- **Tracy / Spartan ops:** one-time export of client → rate-card (with names)
  from the OnSinch admin UI; confirms the default-rate behavior question;
  supplies 20–50 real enquiry emails if the mail export lacks them.

## 8. What the finished thing looks like

A bookings inbox where every enquiry already has a drafted reply and a staged
OnSinch order on the right rate card by the time a human looks at it; a
dashboard whose confirm queue is a list of one-click approvals; a funnel chart
proving hours saved; and a settings toggle that — once the numbers have earned
it — removes the click too.
