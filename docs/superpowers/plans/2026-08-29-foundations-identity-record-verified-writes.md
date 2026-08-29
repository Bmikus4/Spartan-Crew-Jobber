# Foundations: Identity, Record, and Verified Writes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every inbound message pass a deterministic identity gate, record the counterparty's domain, tie each written order to its thread in one durable record, and refuse to call a write successful until OnSinch's own audit log confirms what it made.

**Architecture:** Five independent, deterministic changes. No prompt changes, no model calls added, no behavioural change to extraction or resolution. Each task is separately revertible and separately testable offline. Task 1 fixes a live data-corruption bug found on 2026-08-28; Tasks 2–5 build the substrate the router/cross-thread rework needs.

**Tech Stack:** TypeScript, Next.js App Router, Neon Postgres (`@neondatabase/serverless`), `tsx` for tests, OnSinch REST API.

**Spec:** This conversation's agreed pipeline logic. The governing constraints are restated below verbatim so this plan stands alone.

## Global Constraints

- **Extraction is bounded by the order.** Only fields a created order holds are extracted. This plan adds no extracted fields.
- **The model never resolves an integer id and never builds the order body.** All work in this plan is deterministic code.
- **No block IDs.** Nothing in this plan may introduce, store, or depend on a slot-team id. `POST /orders` carries its crew nested; nothing is appended afterwards.
- **Consumer email domains are not identity.** gmail, googlemail, outlook, hotmail, live, yahoo (incl. `.co.uk`), icloud, me, aol, msn, protonmail, proton.me, gmx, mail.com.
- **Spartan's own domains are never the counterparty.** `SPARTAN_DOMAINS` in `app/lib/engine/normalize.ts` is the existing source of truth.
- **Fail open on infrastructure, fail closed on correctness.** A database outage must never drop an enquiry; a write whose result cannot be confirmed must never be recorded as `ordered`.
- **Every test file exits 0 on pass, 1 on fail**, and is discovered automatically by `test/all.ts`. No registration step.
- Verification commands: `npx tsc --noEmit`, `npx tsx test/all.ts`, `npx tsx sim/run.ts`.
- Baseline at plan start: `tsc` clean, `test/all.ts` **82/82**, `sim/run.ts` **100/100**. Every task must end at or above this.
- Deploys do **not** happen on push. Production deploy is `npx vercel deploy --prod --yes`, by hand, and is **not** part of any task in this plan.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `app/lib/engine/parseWork.ts` | Date/time/crew parsing from raw text | Modify — `bareMonthDays` must exclude month-days also stated with a year |
| `app/lib/engine/identity.ts` | Counterparty email + domain from a thread | **Create** |
| `app/lib/engine/types.ts` | `ConversationState` shape | Modify — add `sender_email`, `sender_domain` |
| `app/lib/engine/pipeline.ts` | Per-event orchestration | Modify — identity gate first; record after write |
| `app/lib/orderRecordsDb.ts` | One durable row per written order | **Create** |
| `app/lib/engine/verifyWrite.ts` | Compare a create against OnSinch's audit row | **Create** |
| `app/lib/engine/onsinch.ts` | Typed OnSinch client | Modify — add `createAuditFor(order_id)` |
| `app/lib/deps.ts` | Production wiring | Modify — inject claim + record + verify |
| `test/yearRollStated.ts` | Pins the year-roll fix | **Create** |
| `test/senderIdentity.ts` | Pins domain extraction | **Create** |
| `test/identityGate.ts` | Pins the dedup gate | **Create** |
| `test/orderRecord.ts` | Pins the record shape | **Create** |
| `test/verifyWrite.ts` | Pins write verification | **Create** |

---

## Task 1: The year-roll must not overrule a stated year

**Context.** `reconcileRequests` rolls a date's year forward when the text shows that day and month *bare*. `bareMonthDays` collapses every parsed date to `MM-DD` and records the ones with no year, but never removes month-days that were **also** written with a year elsewhere. A structured enquiry states its dates twice — once in a summary line with the year, once in a load-in sentence without — so the unyeared mention wins and the roll fires on a date the client explicitly dated.

Measured live on order 15611 (2026-08-29): the client wrote `Tuesday, October 12, 2027 – Thursday, October 14, 2027`, and also `07:00 AM on October 12th` and `06:00 PM on October 14th`. Days 12 and 14 rolled to **2026**; day 13, never written bare, kept 2027. The booking spans 12 Oct 2026 → 13 Oct 2027 and calls 26 crew a year early.

The file's own comment promises `A client who wrote "8 March 2026" keeps 2026, in the past or not.` That promise holds only when the date is mentioned once.

**Files:**
- Modify: `app/lib/engine/parseWork.ts` (`bareMonthDays`, ~line 319)
- Test: `test/yearRollStated.ts`

**Interfaces:**
- Consumes: `parseDatesDetailed(text, reference) => ParsedDate[]` where `ParsedDate = { iso: string; yearStated: boolean }` (already exists)
- Produces: `bareMonthDays(text, reference) => Set<string>` — unchanged signature, corrected contents

- [ ] **Step 1: Write the failing test**

Create `test/yearRollStated.ts`:

```ts
// ============================================================================
// A year the client wrote down is never overruled, even when the same date is
// also mentioned without one.
// ----------------------------------------------------------------------------
// Live on order 15611, 2026-08-29. The enquiry said:
//     Event Date(s): Tuesday, October 12, 2027 - Thursday, October 14, 2027
//     Start Time: 07:00 AM on October 12th
//     End Time:   06:00 PM on October 14th
// `bareMonthDays` keyed on MM-DD and kept every month-day that appeared without
// a year, without subtracting the ones that ALSO appeared with one. So 10-12 and
// 10-14 counted as bare, the next-occurrence rule fired, and both were dragged
// back to 2026 - six weeks away - while 10-13, never written bare, kept 2027.
//
// The damage direction is the dangerous one: it moves bookings EARLIER, so crew
// are called a year before the job and the board looks entirely normal.
//
// Run: npx tsx test/yearRollStated.ts
// ============================================================================
import { bareMonthDays, reconcileRequests } from "../app/lib/engine/parseWork";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const REFERENCE = new Date("2026-08-29T00:00:00Z");
const TEXT = [
  "Event Date(s): Tuesday, October 12, 2027 - Thursday, October 14, 2027",
  "Start Time: 07:00 AM on October 12th",
  "End Time: 06:00 PM on October 14th",
].join("\n");

console.log("\n[1] a month-day stated with a year anywhere is not bare");
{
  const bare = bareMonthDays(TEXT, REFERENCE);
  ok(!bare.has("10-12"), "10-12 is not bare - the client dated it 2027", JSON.stringify([...bare]));
  ok(!bare.has("10-14"), "10-14 is not bare - the client dated it 2027", JSON.stringify([...bare]));
}

console.log("\n[2] and the roll therefore leaves the client's year alone");
{
  const requests = [
    { date: "2027-10-12", size: 15 },
    { date: "2027-10-13", size: 15 },
    { date: "2027-10-14", size: 15 },
  ];
  const { requests: out, report } = reconcileRequests(TEXT, requests, REFERENCE);
  ok(out[0].date === "2027-10-12", "day 1 keeps 2027", String(out[0].date));
  ok(out[1].date === "2027-10-13", "day 2 keeps 2027", String(out[1].date));
  ok(out[2].date === "2027-10-14", "day 3 keeps 2027", String(out[2].date));
  ok(report.rolled.length === 0, "nothing was rolled", JSON.stringify(report.rolled));
}

console.log("\n[3] a genuinely bare date still rolls - the rule is not disabled");
{
  const bareText = "Please send 4 crew on 3rd March, 08:00 to 18:00.";
  const bare = bareMonthDays(bareText, REFERENCE);
  ok(bare.has("03-03"), "03-03 is bare when no year is written anywhere", JSON.stringify([...bare]));
  const { requests: out, report } = reconcileRequests(bareText, [{ date: "2026-03-03", size: 4 }], REFERENCE);
  ok(out[0].date === "2027-03-03", "and rolls to the next occurrence", String(out[0].date));
  ok(report.rolled.length === 1, "and says so", JSON.stringify(report.rolled));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx test/yearRollStated.ts`
Expected: section `[1]` FAILS — `10-12 is not bare` and `10-14 is not bare` both fail, because `bareMonthDays` currently returns both.

- [ ] **Step 3: Fix `bareMonthDays`**

In `app/lib/engine/parseWork.ts`, replace the body of `bareMonthDays`:

```ts
export function bareMonthDays(text: string, reference: Date): Set<string> {
  const bare = new Set<string>();
  const stated = new Set<string>();
  for (const d of parseDatesDetailed(text, reference)) {
    (d.yearStated ? stated : bare).add(d.iso.slice(5));
  }
  /**
   * A MONTH-DAY WRITTEN WITH A YEAR ANYWHERE IS NOT BARE, WHEREVER ELSE IT APPEARS.
   *
   * Without this subtraction the set is per-OCCURRENCE, and a structured enquiry
   * states its dates twice: once in a summary line carrying the year, once in a
   * load-in or load-out sentence without it. The unyeared mention won, so the
   * next-occurrence rule overruled a year the client had written down - live on
   * order 15611, where "October 12, 2027" plus "07:00 AM on October 12th" booked
   * 2026, six weeks out, for a job that is a year later.
   *
   * The guarantee this restores is the one stated at the roll site: a client who
   * writes the year keeps it, in the past or not.
   */
  for (const md of stated) bare.delete(md);
  return bare;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tsx test/yearRollStated.ts`
Expected: `ALL PASS`. Section `[3]` proves the rule still fires for genuinely bare dates.

- [ ] **Step 5: Run the full suite and the simulator**

Run: `npx tsc --noEmit && npx tsx test/all.ts && npx tsx sim/run.ts`
Expected: `tsc` silent, `ALL 83 TEST FILES PASS`, sim `rule agreement 100/100`.
If `sim/run.ts` drops below 100/100, stop — a fixture depended on the broken behaviour and the disagreement must be read before proceeding.

- [ ] **Step 6: Commit**

```bash
git add app/lib/engine/parseWork.ts test/yearRollStated.ts
git commit -o app/lib/engine/parseWork.ts test/yearRollStated.ts -m "A year the client wrote down is no longer overruled by the same date written bare

bareMonthDays collapsed dates to MM-DD and kept the ones with no year, without
subtracting the ones that also appeared with a year. A structured enquiry states
its dates twice - a summary line with the year, a load-in line without - so the
unyeared mention decided, and the next-occurrence rule overruled a date the
client had explicitly dated.

Live on order 15611: the client wrote October 12-14 2027 and also '07:00 AM on
October 12th'. Days 12 and 14 rolled back to 2026, six weeks away; day 13, never
written bare, kept 2027. 26 crew were called a year early across a booking
spanning 12 Oct 2026 to 13 Oct 2027.

The direction is what makes it dangerous: it moves bookings earlier, and the
result reads as an ordinary job on the board."
```

- [ ] **Step 7: Deal with the corrupted live order**

Order **15611 / R10754** is wrong in the tenant and this fix does not repair it. Do not delete it silently. Report to Ben: the order exists, its middle day is a year out from its other two, and it needs deleting or correcting by hand.

---

## Task 2: Counterparty identity — email and domain

**Context.** Cross-thread dedup will gate on the sender's **domain**, not their email, so the same client writing from a different person's address still matches. Consumer mailboxes carry no organisational identity and must not produce a domain. Spartan's own domain must never be recorded as the counterparty — every thread contains Spartan replies, and gating on our own domain would match every thread to every other.

**Files:**
- Create: `app/lib/engine/identity.ts`
- Test: `test/senderIdentity.ts`

**Interfaces:**
- Consumes: `ThreadMessage` from `app/lib/engine/types` (`{ message_id, from, to, date_iso, subject, body, is_from_spartan }`); `isFromSpartan(from: string): boolean` from `app/lib/engine/normalize`
- Produces: `counterpartyIdentity(messages: ThreadMessage[]): { email: string | null; domain: string | null }`

- [ ] **Step 1: Write the failing test**

Create `test/senderIdentity.ts`:

```ts
// ============================================================================
// Who the counterparty is, and whether their domain means anything.
// ----------------------------------------------------------------------------
// Cross-thread dedup gates on DOMAIN, not on the sender's address, so that the
// same client writing from a colleague's mailbox still matches. That only works
// if the domain recorded is the CLIENT's:
//
//   - Spartan's own domain appears in every thread, on our replies. Recording it
//     would make every thread match every other thread.
//   - A consumer mailbox is not an organisation. gmail.com identifies nobody, so
//     it must yield no domain at all rather than a domain that matches strangers.
//
// The email is still recorded in both cases - it is the fallback key when there
// is no usable domain.
//
// Run: npx tsx test/senderIdentity.ts
// ============================================================================
import { counterpartyIdentity } from "../app/lib/engine/identity";
import type { ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const msg = (from: string, date_iso: string, body = "hello"): ThreadMessage => ({
  message_id: `<${from}-${date_iso}>`, from, to: [], date_iso, subject: "Crew", body,
  is_from_spartan: false,
});

console.log("\n[1] an organisational sender gives an email and a domain");
{
  const id = counterpartyIdentity([msg("liam.oconnell@eventful.co.uk", "2026-08-28T10:00:00Z")]);
  ok(id.email === "liam.oconnell@eventful.co.uk", "email kept", String(id.email));
  ok(id.domain === "eventful.co.uk", "domain extracted", String(id.domain));
}

console.log("\n[2] Spartan's own address is never the counterparty");
{
  const id = counterpartyIdentity([
    msg("liam.oconnell@eventful.co.uk", "2026-08-28T10:00:00Z"),
    msg("bookings@spartancrew.co.uk", "2026-08-28T11:00:00Z"),
  ]);
  ok(id.domain === "eventful.co.uk", "the client's domain, not ours", String(id.domain));
  ok(id.email === "liam.oconnell@eventful.co.uk", "and the client's address", String(id.email));
}

console.log("\n[3] a consumer mailbox yields no domain, but keeps the address");
{
  for (const addr of ["sam@gmail.com", "sam@hotmail.com", "sam@yahoo.co.uk", "sam@icloud.com"]) {
    const id = counterpartyIdentity([msg(addr, "2026-08-28T10:00:00Z")]);
    ok(id.domain === null, `${addr} gives no domain`, String(id.domain));
    ok(id.email === addr, `${addr} is still recorded`, String(id.email));
  }
}

console.log("\n[4] the NEWEST client message decides");
{
  const id = counterpartyIdentity([
    msg("old@previous.co.uk", "2026-08-01T10:00:00Z"),
    msg("new@current.co.uk", "2026-08-28T10:00:00Z"),
  ]);
  ok(id.domain === "current.co.uk", "most recent client sender wins", String(id.domain));
}

console.log("\n[5] a thread with only Spartan messages has no counterparty");
{
  const id = counterpartyIdentity([msg("bookings@spartancrew.co.uk", "2026-08-28T10:00:00Z")]);
  ok(id.email === null && id.domain === null, "nothing is invented", JSON.stringify(id));
}

console.log("\n[6] addresses are normalised, and rubbish yields nothing");
{
  ok(counterpartyIdentity([msg("  Liam <LIAM@Eventful.CO.UK>  ", "2026-08-28T10:00:00Z")]).domain === "eventful.co.uk",
    "case and display name stripped");
  ok(counterpartyIdentity([msg("not-an-address", "2026-08-28T10:00:00Z")]).domain === null,
    "a malformed sender gives no domain");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx test/senderIdentity.ts`
Expected: FAIL — `Cannot find module '../app/lib/engine/identity'`.

- [ ] **Step 3: Write `app/lib/engine/identity.ts`**

```ts
// ============================================================================
// identity — who the other side of the conversation is.
// ----------------------------------------------------------------------------
// Cross-thread dedup gates on the counterparty's DOMAIN rather than their email
// address, because the same client writes from more than one mailbox and an
// exact-address match misses every one of those. A domain is exact, free to
// compute, and needs no model.
//
// Two things must never become the recorded domain:
//
//   Spartan's own. It appears in every thread, on our own replies, so gating on
//   it would match every thread to every other thread.
//
//   A consumer provider. gmail.com is a mailbox, not an organisation; matching
//   two threads because both clients happen to use Gmail would be worse than not
//   matching at all. Those threads get no domain and fall back to the address.
// ============================================================================
import type { ThreadMessage } from "./types";
import { isFromSpartan } from "./normalize";

/** Mailbox providers. A shared provider is not a shared organisation. */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "mac.com", "aol.com", "msn.com", "protonmail.com", "proton.me", "gmx.com",
  "gmx.co.uk", "mail.com", "yandex.com", "zoho.com",
]);

/** "Jane Doe <J@X.com>" | "  j@x.com " -> "j@x.com"; "" when there is no address. */
export function normaliseAddress(raw: string): string {
  const s = String(raw ?? "").trim();
  const angled = s.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? addr : "";
}

/** The domain part, or null when the address is absent, malformed or a consumer mailbox. */
export function organisationalDomain(address: string): string | null {
  const addr = normaliseAddress(address);
  if (!addr) return null;
  const domain = addr.slice(addr.indexOf("@") + 1);
  if (CONSUMER_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * The counterparty on a thread: the newest message from someone who is not us.
 *
 * Newest rather than first, because a thread can be handed between people at the
 * client and the current correspondent is the one that matters. `is_from_spartan`
 * is advisory - the address is checked too, for the reason recorded in
 * normalize.ts: a payload that omits the flag defaults it to false and would
 * otherwise make us our own counterparty.
 */
export function counterpartyIdentity(
  messages: ThreadMessage[]
): { email: string | null; domain: string | null } {
  const clients = [...messages]
    .filter((m) => !m.is_from_spartan && !isFromSpartan(String(m.from ?? "")))
    .filter((m) => normaliseAddress(String(m.from ?? "")))
    .sort((a, b) => Date.parse(a.date_iso) - Date.parse(b.date_iso));

  const latest = clients[clients.length - 1];
  if (!latest) return { email: null, domain: null };

  const email = normaliseAddress(String(latest.from));
  return { email: email || null, domain: organisationalDomain(email) };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tsx test/senderIdentity.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Store it on the state**

In `app/lib/engine/types.ts`, inside the `ConversationState` interface, immediately after the `subject` field, add:

```ts
  /**
   * The counterparty's address and organisational domain, recorded separately.
   *
   * The domain is the key cross-thread dedup gates on, because the same client
   * writes from more than one mailbox. It is null for a consumer mailbox and for
   * a thread carrying no client message - see identity.ts - and in that case the
   * address is the only key available.
   */
  sender_email?: string | null;
  sender_domain?: string | null;
```

In `app/lib/engine/compiler.ts`, find where the returned `state` object is built (the object literal containing `needs_human,` and `status,`) and add to it:

```ts
    sender_email: identity.email,
    sender_domain: identity.domain,
```

At the top of `compile()`, before that object is built, add:

```ts
  const identity = counterpartyIdentity(thread.messages);
```

and add the import at the top of `compiler.ts`:

```ts
import { counterpartyIdentity } from "./identity";
```

- [ ] **Step 6: Verify the whole suite**

Run: `npx tsc --noEmit && npx tsx test/all.ts && npx tsx sim/run.ts`
Expected: `tsc` silent, `ALL 84 TEST FILES PASS`, sim `100/100`.

- [ ] **Step 7: Commit**

```bash
git add app/lib/engine/identity.ts app/lib/engine/types.ts app/lib/engine/compiler.ts test/senderIdentity.ts
git commit -o app/lib/engine/identity.ts app/lib/engine/types.ts app/lib/engine/compiler.ts test/senderIdentity.ts -m "A thread records who the counterparty is, and whether their domain identifies anyone

Cross-thread dedup will gate on the client's domain rather than their address,
because the same client writes from more than one mailbox and an exact-address
match misses all of them. A domain is exact and costs nothing to compute.

Two domains must never be recorded as the counterparty's. Spartan's own appears
in every thread on our own replies, and gating on it would match every thread to
every other. A consumer provider identifies a mailbox rather than an
organisation, so those threads carry an address and no domain at all."
```

---

## Task 3: The identity gate runs first, inside the engine

**Context.** `claimMessage` in `app/lib/messageLedgerDb.ts` already answers both of Stage 0's questions — `first_seen` for the message id, `thread_first_seen` and `thread_message_count` for the conversation. It is called from exactly one place, `app/api/dedupe/route.ts`, which is an endpoint the n8n workflow may or may not call. `handleThread` never calls it, so the engine's own guarantee depends on an external caller doing the right thing.

`handleThread` has a separate idempotency fast-path keyed on the newest client message id held in `prior`. That path stays — it is what makes the sweeps free — but it is a cache check, not an identity gate, and it cannot see a message that arrived by a different route.

**Files:**
- Modify: `app/lib/engine/pipeline.ts` (`PipelineDeps`, `handleThread`)
- Modify: `app/lib/deps.ts` (wire the real claim)
- Test: `test/identityGate.ts`

**Interfaces:**
- Consumes: `claimMessage(input: { message_id: string; thread_id?: string; subject?: string; from_address?: string }): Promise<ClaimResult>` from `app/lib/messageLedgerDb`, where `ClaimResult = { ok, found, first_seen, seen_count, thread_first_seen, thread_message_count, message_id, thread_id, degraded? }`
- Consumes: `selectLatest(messages)` from `app/lib/engine/normalize`
- Produces: `PipelineDeps.claimMessage?` — optional, so every existing test double keeps working untouched

- [ ] **Step 1: Write the failing test**

Create `test/identityGate.ts`:

```ts
// ============================================================================
// The identity gate: the first thing that happens to every message.
// ----------------------------------------------------------------------------
// Two questions, both answered by keys rather than by judgement:
//   the MESSAGE id  - have we processed this exact email before?
//   the THREAD id   - have we seen this conversation before?
//
// claimMessage has answered both since it was written, and was wired only to
// /api/dedupe - an endpoint the n8n workflow may or may not call. The engine's
// own guarantee cannot depend on an external caller choosing to ask.
//
// It fails OPEN. A database that is down must never drop an enquiry, so a
// degraded claim processes the thread normally. Losing a booking is worse than
// processing one twice, and handleThread is idempotent anyway.
//
// Run: npx tsx test/identityGate.ts
// ============================================================================
import { handleThread, type PipelineDeps } from "../app/lib/engine/pipeline";
import { InMemoryStore } from "../app/lib/engine/store";
import type { HydratedThread } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const thread = (message_id: string): HydratedThread => ({
  thread_id: "T1",
  messages: [{
    message_id, from: "client@eventful.co.uk", to: ["bookings@spartancrew.co.uk"],
    date_iso: "2026-08-28T10:00:00Z", subject: "4 crew Tuesday",
    body: "Please send 4 crew on Tuesday 8 September 2026, 08:00 to 18:00, at ExCeL.",
    is_from_spartan: false,
  }],
});

/** Records whether compile was reached, without running the real one. */
function rig(claim: Partial<{ ok: boolean; first_seen: boolean; degraded: string }>) {
  let compiled = 0;
  const deps = {
    store: new InMemoryStore(),
    metrics: { emit: async () => {} },
    settings: { order_mode: "draft-only", replies_enabled: false } as never,
    hashOrder: (o: unknown) => JSON.stringify(o),
    executor: {
      createReplyDraft: async () => "draft",
      createOrder: async () => { compiled++; return { id: 1 }; },
      patchOrder: async () => [],
    },
    reasoner: {
      classifyAndExtract: async () => { compiled++; throw new Error("compile reached"); },
    },
    claimMessage: async () => ({
      ok: claim.ok ?? true, found: true,
      first_seen: claim.first_seen ?? true, seen_count: 1,
      thread_first_seen: true, thread_message_count: 1,
      message_id: "m1", thread_id: "T1",
      ...(claim.degraded ? { degraded: claim.degraded } : {}),
    }),
  } as unknown as PipelineDeps;
  return { deps, reached: () => compiled };
}

(async () => {
  console.log("\n[1] a message already claimed is a no-op");
  {
    const { deps, reached } = rig({ first_seen: false });
    await handleThread(thread("m1"), deps).catch(() => {});
    ok(reached() === 0, "the engine never reached compile", String(reached()));
  }

  console.log("\n[2] a first-seen message is processed");
  {
    const { deps, reached } = rig({ first_seen: true });
    await handleThread(thread("m2"), deps).catch(() => {});
    ok(reached() > 0, "the engine went on to compile", String(reached()));
  }

  console.log("\n[3] a degraded claim FAILS OPEN - a database outage drops nothing");
  {
    const { deps, reached } = rig({ ok: false, first_seen: false, degraded: "no DATABASE_URL" });
    await handleThread(thread("m3"), deps).catch(() => {});
    ok(reached() > 0, "processed anyway rather than dropped", String(reached()));
  }

  console.log("\n[4] no claim injected at all still works");
  {
    const { deps, reached } = rig({});
    delete (deps as { claimMessage?: unknown }).claimMessage;
    await handleThread(thread("m4"), deps).catch(() => {});
    ok(reached() > 0, "an executor without a claim is not blocked", String(reached()));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx test/identityGate.ts`
Expected: section `[1]` FAILS — the engine reaches compile because no gate exists.

- [ ] **Step 3: Add the dependency**

In `app/lib/engine/pipeline.ts`, add to the `PipelineDeps` interface:

```ts
  /**
   * THE IDENTITY GATE - the first thing done to every message, before any
   * inference. Answers both questions from keys: has this exact message been
   * processed, and has this conversation been seen.
   *
   * Optional so every existing test double keeps working, and it FAILS OPEN: a
   * claim that could not be made (`ok: false`) processes the thread normally,
   * because a database outage must never drop an enquiry.
   */
  claimMessage?: (input: {
    message_id: string;
    thread_id?: string;
    subject?: string;
    from_address?: string;
  }) => Promise<{
    ok: boolean;
    first_seen: boolean;
    seen_count: number;
    thread_first_seen: boolean;
    thread_message_count: number;
    degraded?: string;
  }>;
```

- [ ] **Step 4: Run the gate first in `handleThread`**

In `app/lib/engine/pipeline.ts`, inside `handleThread`, immediately after `const prior = await store.get(tid);` and **before** the existing idempotency fast-path, insert:

```ts
  /**
   * IDENTITY BEFORE INFERENCE. The exact same message can never be processed
   * twice, and that is settled by the message id rather than by anything the
   * model reads. The fast-path below is a cache check against what we last
   * stored; this is the durable claim, and it sees a message however it arrived.
   *
   * Fails open on purpose. `ok: false` means the ledger could not answer - not
   * that the message is new - and dropping an enquiry because a database was
   * unreachable is the worse failure. handleThread is idempotent, so the cost of
   * processing twice is a wasted model call.
   */
  const newest = selectLatest(thread.messages)?.latest;
  if (deps.claimMessage && newest?.message_id) {
    const claim = await deps.claimMessage({
      message_id: newest.message_id,
      thread_id: tid,
      subject: newest.subject,
      from_address: newest.from,
    }).catch((err) => {
      console.error("[identity-gate] claim failed, processing anyway", err);
      return null;
    });
    if (claim?.ok && !claim.first_seen) {
      await emit("duplicate_message", { message_id: newest.message_id, seen_count: claim.seen_count });
      return prior ?? undefined;
    }
  }
```

Confirm `selectLatest` is already imported in `pipeline.ts` (it is — used by the fast-path). If the function's declared return type does not permit `undefined`, return `prior as ConversationState` and leave a comment; do not widen the signature in this task.

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx tsx test/identityGate.ts`
Expected: `ALL PASS`.

- [ ] **Step 6: Wire the real claim in production**

In `app/lib/deps.ts`, add the import:

```ts
import { claimMessage } from "./messageLedgerDb";
```

and add to the returned deps object, beside `store` and `metrics`:

```ts
    claimMessage,
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx tsx test/all.ts && npx tsx sim/run.ts`
Expected: `tsc` silent, `ALL 85 TEST FILES PASS`, sim `100/100`.

Watch for one specific regression: the nightly sweep re-POSTs everything. With the gate in place a re-POST is a no-op rather than a cheap re-compile, which is the intent. If `sim/run.ts` idempotency drops below 100/100, the gate is rejecting a *changed* thread — read the disagreement before proceeding.

- [ ] **Step 8: Commit**

```bash
git add app/lib/engine/pipeline.ts app/lib/deps.ts test/identityGate.ts
git commit -o app/lib/engine/pipeline.ts app/lib/deps.ts test/identityGate.ts -m "The engine claims a message id before it reads anything

claimMessage has answered both identity questions since it was written - is this
exact message new, and is this conversation new - and was wired to /api/dedupe
alone, an endpoint the n8n workflow may or may not call. The engine's guarantee
that nothing is processed twice depended on an external caller choosing to ask.

It now runs inside handleThread, before any inference. The existing fast-path
stays: that is a cache check against what we last stored, while this is durable
and sees a message however it arrived.

The gate fails open. A claim that could not be made means the ledger could not
answer, not that the message is new, and dropping an enquiry because a database
was unreachable is the worse failure."
```

---

## Task 4: One record per written order

**Context.** What the engine knows about a written order is spread through the `state` JSON blob: the order id in one column, the R number and job id inside the blob, the composed blocks in `last_ordered_teams`, and the sender nowhere. There is no single row that answers "what did we send, to whom, for which thread, and what came back". Every reconciliation this week had to be reassembled by hand from three sources.

This table is also what the amendment path will read to build a new shape from a known prior one.

**Files:**
- Create: `app/lib/orderRecordsDb.ts`
- Test: `test/orderRecord.ts`

**Interfaces:**
- Produces: `recordOrder(rec: OrderRecord): Promise<void>`; `orderRecordFor(order_id: number): Promise<OrderRecord | null>`; `orderRecordsForThread(thread_id: string): Promise<OrderRecord[]>`
- `OrderRecord = { order_id: number; thread_id: string; job_id: number | null; order_number: string | null; sender_email: string | null; sender_domain: string | null; company_id: number | null; place_id: number | null; shape_sent: unknown; block_count: number; crew_total: number; created_at?: string }`

- [ ] **Step 1: Write the failing test**

Create `test/orderRecord.ts`:

```ts
// ============================================================================
// One row that says what we sent, for whom, and what came back.
// ----------------------------------------------------------------------------
// What the engine knew about a written order was spread across a column, a JSON
// blob and a composed array, with the sender recorded nowhere. Answering "what
// did we send and what did OnSinch make of it" meant reassembling three sources
// by hand, which is exactly what every reconciliation this week had to do.
//
// This test runs WITHOUT a database. The module must degrade to a no-op rather
// than throw, for the same reason the identity gate fails open: a booking is
// never lost because a side-record could not be written.
//
// Run: npx tsx test/orderRecord.ts
// ============================================================================
import { buildOrderRecord } from "../app/lib/orderRecordsDb";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const SHAPE = {
  name: "Eventful UK - build at ExCeL",
  company_id: 512,
  slot_teams: [
    { size: 13, place_id: 49, beginning: "2027-10-12T07:00:00+00:00", end: "2027-10-12T18:00:00+00:00" },
    { size: 2, place_id: 49, beginning: "2027-10-12T07:00:00+00:00", end: "2027-10-12T18:00:00+00:00" },
  ],
};

console.log("\n[1] the record is derived from the shape actually sent");
{
  const rec = buildOrderRecord({
    order_id: 15610, thread_id: "T9", job_id: 15663, order_number: "10753",
    sender_email: "liam@eventful.co.uk", sender_domain: "eventful.co.uk",
    place_id: 49, shape_sent: SHAPE,
  });
  ok(rec.order_id === 15610, "order id", String(rec.order_id));
  ok(rec.company_id === 512, "company taken from the shape, not passed twice", String(rec.company_id));
  ok(rec.block_count === 2, "one count per block sent", String(rec.block_count));
  ok(rec.crew_total === 15, "crew totalled across blocks", String(rec.crew_total));
  ok(rec.sender_domain === "eventful.co.uk", "the counterparty domain travels with the order", String(rec.sender_domain));
}

console.log("\n[2] a shape with no blocks is recorded honestly, not as zero-crew success");
{
  const rec = buildOrderRecord({
    order_id: 1, thread_id: "T1", job_id: null, order_number: null,
    sender_email: null, sender_domain: null, place_id: null,
    shape_sent: { name: "x", company_id: 1, slot_teams: [] },
  });
  ok(rec.block_count === 0 && rec.crew_total === 0, "counted as zero rather than guessed", JSON.stringify(rec));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx test/orderRecord.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `app/lib/orderRecordsDb.ts`**

```ts
// ============================================================================
// orderRecords - one durable row per order this engine wrote.
// ----------------------------------------------------------------------------
// What we knew about a written order used to be spread across a column, a JSON
// blob and a composed array, with the counterparty recorded nowhere. Answering
// "what did we send, for whom, and what came back" meant joining three sources
// by hand.
//
// The row holds the SHAPE WE SENT rather than ids read back, because most of
// what we write cannot be read back: /slotTeams has no GET, and the audit log
// records nothing for an order created through the API. What we sent is the only
// thing we will always know, so it is the authority - and it is what the
// amendment path composes its next version from.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export interface OrderRecord {
  order_id: number;
  thread_id: string;
  job_id: number | null;
  order_number: string | null;
  sender_email: string | null;
  sender_domain: string | null;
  company_id: number | null;
  place_id: number | null;
  shape_sent: unknown;
  block_count: number;
  crew_total: number;
  created_at?: string;
}

interface ShapeLike {
  company_id?: number;
  slot_teams?: Array<{ size?: number }>;
}

/**
 * Derive the record from the shape that was sent. The counts come from the shape
 * rather than from a caller's tally, so the row can never disagree with what went
 * on the wire - the disagreement is the whole thing worth catching.
 */
export function buildOrderRecord(input: {
  order_id: number;
  thread_id: string;
  job_id: number | null;
  order_number: string | null;
  sender_email: string | null;
  sender_domain: string | null;
  place_id: number | null;
  shape_sent: unknown;
}): OrderRecord {
  const shape = (input.shape_sent ?? {}) as ShapeLike;
  const teams = Array.isArray(shape.slot_teams) ? shape.slot_teams : [];
  return {
    ...input,
    company_id: Number.isInteger(shape.company_id) ? Number(shape.company_id) : null,
    block_count: teams.length,
    crew_total: teams.reduce((n, t) => n + (Number(t?.size) || 0), 0),
  };
}

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}

async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS order_records (
      order_id      BIGINT PRIMARY KEY,
      thread_id     TEXT NOT NULL,
      job_id        BIGINT,
      order_number  TEXT,
      sender_email  TEXT,
      sender_domain TEXT,
      company_id    INT,
      place_id      INT,
      shape_sent    JSONB NOT NULL,
      block_count   INT NOT NULL,
      crew_total    INT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_thread ON order_records (thread_id)`;
  await sql`CREATE INDEX IF NOT EXISTS order_records_domain ON order_records (sender_domain)`;
  _ready = true;
}

/** Never throws: a booking is not lost because its side-record could not be written. */
export async function recordOrder(rec: OrderRecord): Promise<void> {
  const sql = db();
  if (!sql) return;
  try {
    await ensure(sql);
    await sql`
      INSERT INTO order_records (order_id, thread_id, job_id, order_number, sender_email,
                                 sender_domain, company_id, place_id, shape_sent, block_count, crew_total)
      VALUES (${rec.order_id}, ${rec.thread_id}, ${rec.job_id}, ${rec.order_number}, ${rec.sender_email},
              ${rec.sender_domain}, ${rec.company_id}, ${rec.place_id}, ${JSON.stringify(rec.shape_sent)},
              ${rec.block_count}, ${rec.crew_total})
      ON CONFLICT (order_id) DO UPDATE
        SET thread_id = EXCLUDED.thread_id, job_id = EXCLUDED.job_id,
            order_number = EXCLUDED.order_number, shape_sent = EXCLUDED.shape_sent,
            block_count = EXCLUDED.block_count, crew_total = EXCLUDED.crew_total`;
  } catch (err) {
    console.error("[order-records] write failed", err);
  }
}

export async function orderRecordFor(order_id: number): Promise<OrderRecord | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`SELECT * FROM order_records WHERE order_id = ${order_id}`) as unknown as OrderRecord[];
    return rows[0] ?? null;
  } catch { return null; }
}

/** Every order this thread has produced, newest first - the amendment path's input. */
export async function orderRecordsForThread(thread_id: string): Promise<OrderRecord[]> {
  const sql = db();
  if (!sql) return [];
  try {
    await ensure(sql);
    return (await sql`
      SELECT * FROM order_records WHERE thread_id = ${thread_id}
      ORDER BY created_at DESC`) as unknown as OrderRecord[];
  } catch { return []; }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tsx test/orderRecord.ts`
Expected: `ALL PASS`.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npx tsx test/all.ts`
Expected: `tsc` silent, `ALL 86 TEST FILES PASS`.

```bash
git add app/lib/orderRecordsDb.ts test/orderRecord.ts
git commit -o app/lib/orderRecordsDb.ts test/orderRecord.ts -m "One row per written order, holding the shape we sent

What the engine knew about an order it wrote was spread across a column, a JSON
blob and a composed array, with the counterparty recorded nowhere, so answering
'what did we send and for whom' meant joining three sources by hand.

The row holds the shape SENT rather than ids read back, because most of what we
write cannot be read back - /slotTeams has no GET and the audit log records
nothing for an order created through the API. What we sent is the only thing we
will always know, and it is what an amendment composes its next version from.

Counts are derived from the shape rather than passed in, so the row cannot
disagree with what went on the wire."
```

---

## Task 5: A write is not a success until OnSinch confirms what it made

**Context.** The engine has recorded `status: "ordered"` on the strength of a 201 for the whole of its life. That is what let 99 blockless orders be written across five days while every check passed. OnSinch publishes an independent record of what each API create actually produced — the `timelineAudits` row with `action: "order_created_via_api"`, whose payload carries `created: { Order, Job, SlotTeam, Slot, Attendance, workers }`. Verified on real data: order 15610 sent six blocks and the audit row reads `SlotTeam: 6, Slot: 6`; the blockless creates read `SlotTeam: 0, Slot: 0`.

That is vendor-authored evidence, and it is the closest thing to an external oracle this integration has.

**Files:**
- Create: `app/lib/engine/verifyWrite.ts`
- Modify: `app/lib/engine/onsinch.ts` (add `createAuditFor`)
- Test: `test/verifyWrite.ts`

**Interfaces:**
- Consumes: `Transport` from `app/lib/engine/onsinch` — `(method, path, body?) => Promise<{ status: number; data: any }>`
- Produces: `OnsinchClient.createAuditFor(order_id: number): Promise<{ teams: number; slots: number } | null>`
- Produces: `verifyCreate(actual: { teams: number; slots: number } | null, expectedBlocks: number): { verified: boolean; reason?: string }`

- [ ] **Step 1: Write the failing test**

Create `test/verifyWrite.ts`:

```ts
// ============================================================================
// A 201 is not a booking. OnSinch's own audit row says what the call made.
// ----------------------------------------------------------------------------
// The engine recorded "ordered" on the strength of a status code for its whole
// life, which is how 99 orders were written blockless across five days while
// every check passed. OnSinch publishes an independent record of what each API
// create produced - `order_created_via_api`, carrying created.SlotTeam and
// created.Slot - and that is vendor-authored evidence rather than our own.
//
// Measured on live data: order 15610 sent six blocks and its audit row reads
// SlotTeam 6, Slot 6. The blockless creates read 0 and 0.
//
// Unverifiable is NOT the same as failed. The audit row can lag, and an order
// that exists must never be deleted because a log had not caught up - so an
// absent row is reported as unverified and handed on, never treated as absence
// of the order.
//
// Run: npx tsx test/verifyWrite.ts
// ============================================================================
import { verifyCreate } from "../app/lib/engine/verifyWrite";
import { OnsinchClient } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

console.log("\n[1] the audit agreeing with intent is the only success");
{
  const v = verifyCreate({ teams: 6, slots: 6 }, 6);
  ok(v.verified, "six blocks sent, six recorded", JSON.stringify(v));
}

console.log("\n[2] a blockless create is a failure, whatever the status code was");
{
  const v = verifyCreate({ teams: 0, slots: 0 }, 6);
  ok(!v.verified, "refused");
  ok(/0 of 6|no crew/i.test(String(v.reason)), "and says what was missing", String(v.reason));
}

console.log("\n[3] a short create is a failure too - a partial order is not an order");
{
  const v = verifyCreate({ teams: 4, slots: 4 }, 6);
  ok(!v.verified, "four of six refused", JSON.stringify(v));
}

console.log("\n[4] an absent audit row is UNVERIFIED, not failed");
{
  const v = verifyCreate(null, 6);
  ok(!v.verified, "not claimed as verified");
  ok(/could not|unverified|no audit/i.test(String(v.reason)),
    "and says it could not be checked rather than that it failed", String(v.reason));
}

console.log("\n[5] the client reads the row for one order out of the log");
{
  const audit = {
    id: 1, action: "order_created_via_api",
    data: JSON.stringify({
      id: "15610", name: "Innovate Events", model: "Order",
      created: { Order: 1, Job: 1, SlotTeam: 6, Slot: 6, Attendance: 0, workers: 24 },
      data: { path: "Order:15610", number: 10753 },
    }),
  };
  const client = new OnsinchClient((async (_m: string, path: string) => {
    if (path.startsWith("/timelineAudits"))
      return { status: 200, data: { data: [audit], pagination: { pageCount: 1 } } };
    return { status: 200, data: { data: [], pagination: { pageCount: 1 } } };
  }) as never);
  const got = await client.createAuditFor(15610);
  ok(got?.teams === 6 && got?.slots === 6, "counts read from the payload", JSON.stringify(got));
  const miss = await client.createAuditFor(99999);
  ok(miss === null, "an order with no row returns null, not zero", JSON.stringify(miss));
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx tsx test/verifyWrite.ts`
Expected: FAIL — `verifyWrite` module not found.

- [ ] **Step 3: Write `app/lib/engine/verifyWrite.ts`**

```ts
// ============================================================================
// verifyWrite - did the create make what the create claimed to make?
// ----------------------------------------------------------------------------
// The engine took a 201 as proof of a booking for its whole life. That is how 99
// orders were written with no crew across five days while every test passed: the
// status line was true and meant nothing.
//
// OnSinch keeps its own record. `order_created_via_api` carries
// created.{Order,Job,SlotTeam,Slot}, written by the vendor rather than by us, and
// comparing it against what we intended is the one external check this
// integration affords.
//
// UNVERIFIABLE IS NOT FAILED. The audit row can lag behind the create. An order
// that exists must never be deleted because a log had not caught up, so a missing
// row is reported as unverified and handed to a person - it is never read as the
// order being absent.
// ============================================================================

export interface CreateVerdict {
  verified: boolean;
  reason?: string;
}

/**
 * Compare OnSinch's record of a create against the blocks we sent.
 *
 * `slots` is not the crew total - a team of 13 records one Slot, not 13 - so the
 * comparison is block count against block count. Measured on live rows: six
 * blocks give SlotTeam 6, Slot 6, workers 24.
 */
export function verifyCreate(
  actual: { teams: number; slots: number } | null,
  expectedBlocks: number
): CreateVerdict {
  if (!actual) {
    return {
      verified: false,
      reason: "could not be verified - OnSinch has no create record for this order yet; the order may well exist",
    };
  }
  if (actual.teams < expectedBlocks) {
    return {
      verified: false,
      reason: actual.teams === 0
        ? `OnSinch recorded no crew on the create - 0 of ${expectedBlocks} blocks; an order created blockless is filed nowhere`
        : `OnSinch recorded ${actual.teams} of ${expectedBlocks} blocks`,
    };
  }
  return { verified: true };
}
```

- [ ] **Step 4: Add `createAuditFor` to the client**

In `app/lib/engine/onsinch.ts`, add this method to `OnsinchClient`, directly after `slotTeamsForOrder`:

```ts
  /**
   * What OnSinch recorded that OUR create actually made.
   *
   * `order_created_via_api` is written by OnSinch for every create through this
   * API and carries `created: { Order, Job, SlotTeam, Slot, Attendance, workers }`.
   * It is the only external evidence available: /slotTeams has no GET, no `with=`
   * embed exposes the blocks, and the per-child audit rows exist for UI-raised
   * orders only.
   *
   * Rows sort oldest-first, so the newest creates are on the LAST pages - reading
   * page 1 returns 2026 and finds nothing. Returns null when no row is found,
   * which means "not recorded", never "no crew".
   */
  async createAuditFor(order_id: number): Promise<{ teams: number; slots: number } | null> {
    const id = Number(order_id);
    if (!Number.isInteger(id) || id <= 0) return null;
    const first = await this.t("GET", "/timelineAudits" + qs({ action: "order_created_via_api", limit: 1, page: 1 }));
    const pageCount = Number(first.data?.pagination?.pageCount);
    const pages = Number.isInteger(pageCount) && pageCount > 0 ? [pageCount, pageCount - 1] : [1];
    for (const page of pages) {
      if (page < 1) continue;
      const r = await this.t("GET", "/timelineAudits" + qs({ action: "order_created_via_api", limit: 100, page }));
      for (const row of (r.data?.data ?? []) as any[]) {
        let payload: any;
        try {
          payload = typeof row?.data === "string" ? JSON.parse(row.data) : row?.data;
        } catch { continue; }
        if (Number(payload?.id) !== id) continue;
        return {
          teams: Number(payload?.created?.SlotTeam ?? 0),
          slots: Number(payload?.created?.Slot ?? 0),
        };
      }
    }
    return null;
  }
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npx tsx test/verifyWrite.ts`
Expected: `ALL PASS`.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npx tsx test/all.ts && npx tsx sim/run.ts`
Expected: `tsc` silent, `ALL 87 TEST FILES PASS`, sim `100/100`.

```bash
git add app/lib/engine/verifyWrite.ts app/lib/engine/onsinch.ts test/verifyWrite.ts
git commit -o app/lib/engine/verifyWrite.ts app/lib/engine/onsinch.ts test/verifyWrite.ts -m "A create is checked against OnSinch's own record of what it made

The engine took a 201 as proof of a booking, which is how 99 orders were written
with no crew across five days while every test passed. The status line was true
and meant nothing.

OnSinch writes order_created_via_api for every create through this API, carrying
created.SlotTeam and created.Slot. Comparing that against the blocks we sent is
the only external evidence this integration affords - /slotTeams has no GET, no
embed exposes the blocks, and per-child audit rows exist for UI-raised orders
only.

Unverifiable is kept distinct from failed. The row can lag the create, and an
order that exists must never be deleted because a log had not caught up."
```

**Not in this task, deliberately:** wiring `verifyCreate` into `handleThread` so a failed verification changes the recorded status. That is a behavioural change to the write path and belongs with the amendment rework in Plan 6, where the status vocabulary changes anyway. This task lands the mechanism and its tests.

---

## Self-Review

**Spec coverage.** Of the agreed logic, this plan implements: the Stage 0 identity gate (Task 3), sender email and domain as stored fields (Task 2), the single order record (Task 4), and the write-verification mechanism (Task 5). Task 1 is a live bug found during the same session, included because it corrupts bookings now.

**Deliberately not covered here** — each needs its own plan, and three of them depend on the eval harness in Plan 2: router split, cross-thread narrowing and judge, merged two-thread rendering, verification model step, resolution provenance, trigram/damerau fuzzy rework, amendment path, removal of block-ID machinery.

**Known weakness in Task 3.** The test double for `handleThread` is thin — it proves the gate is reached or not reached, by throwing inside the reasoner. It does not prove the gate returns a sensible `ConversationState` on the duplicate path. That is deliberate: a fuller double would duplicate `test/mocks.ts`, and the return value on that path is `prior`, which the store already round-trips under test elsewhere. If Task 3's step 4 has to widen `handleThread`'s return type, stop and re-plan rather than widening it quietly.

**Type consistency.** `OrderRecord` is used only in Task 4. `CreateVerdict` and `createAuditFor`'s return shape are used only in Task 5. `counterpartyIdentity` from Task 2 is consumed by `compiler.ts` in the same task and by nothing else in this plan. No task references a symbol another task renames.

**Ordering.** Tasks 1, 2, 4 and 5 are independent and may be done in any order. Task 3 should follow Task 2 only because both touch `pipeline.ts`/`deps.ts` and sequencing avoids a conflict; it has no logical dependency on it.
