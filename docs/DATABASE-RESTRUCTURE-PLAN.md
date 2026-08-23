# The database holds jobs, not mail — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each message once instead of once per thread per delivery, bound how long
message bodies live, and take the R&D corpus out of the production database entirely.

**Architecture:** Three tiers, separated by how long a thing has to survive. **Identity**
(`message_ledger`) is tiny and permanent. **Confirmed job** (`tickets`, `conversation_state`,
`ticket_events`, `rate_cards`, `sender_ledger`, `entity_aliases`, `order_archive`,
`app_settings`, `onsinch_professions`) is the product and is permanent. **Evidence** — the
text of an email — lives 90 days in a new `thread_messages` table, one row per message, then
moves to a JSONL archive on disk. The 12-month sweep corpus is not any of these tiers and
leaves Postgres altogether.

**Tech Stack:** `@neondatabase/serverless` (already present), `tsx` test harness under
`test/` (auto-discovered by `test/all.ts`), plain `node` scripts under `scripts/`.

**Spec:** this document.

---

## What was measured

Taken from the live database on 2026-08-23.

| Thing | Measured |
|---|---|
| `neon-claret-plank` total | **106.5 MB** of a 512 MB Neon Free cap (21%) |
| `sweep_threads` | **72.2 MB — 68%** of the database. 5,835 threads, 2022-06 to 2026-08 |
| `inbound_raw` | **23.1 MB — 22%**. 1,062 rows, all within the last 30 days |
| Everything the business actually runs on | **~2.4 MB** across 11 tables |
| Tickets | 257 total: 121 ignored, 68 drafted, 35 proposed, 24 needs-info, **7 ordered**, 2 error |
| Distinct messages ever received | 1,354 (`message_ledger` holds 1,095 claimed ids) |
| Message copies stored inside `inbound_raw` | **6,644** |
| Duplication factor | **4.9×** |
| Worst single thread | 21 rows, **4.4 MB**, one thread of 28 messages |
| Runtime readers of `sweep_threads.payload` | **0** |

### Why `inbound_raw` is 4.9× larger than the mail it holds

n8n POSTs the **full hydrated thread** on every new message. Message 1 stores a thread of
one. Message 2 stores a thread of two — containing message 1 again. Message 5 stores all
five. Storage for a thread of N messages grows with N², and `captureInboundRaw` writes the
whole body verbatim before any processing.

That is the "store them once" defect, and 6,644 copies of 1,354 messages is its size.

### Why `sweep_threads` is in here at all

Its own header comment says it: *"the historical sweep corpus — TEST DATA, deliberately
separate."* It was kept out of `inbound_raw` and out of `tickets`, correctly, but the only
store available at the time was the same Postgres database. It is a research dataset with a
production bill.

The consumer trace is unambiguous. One runtime file touches it — `app/api/sweep-ingest/route.ts`
— and it only writes (`storeSweptThread`) and counts (`sweepStats`, header columns only).
`app/lib/sweepLabelsDb.ts` sits under `app/` but is imported by exactly one thing,
`scripts/classify-corpus.ts`; no route reaches it. Seven offline scripts read `payload`:
`classify-corpus`, `cost-model`, `parser-coverage`, `triage-study`, `triage-falsify`,
`rnd-study`, `rnd-disproofs`.

## A note on the brief

The instruction was that this database should hold confirmed jobs and nothing else. Taken
literally that cannot be built, and the reason is worth stating rather than quietly working
around: **a thread is not known to be a job until after it has been read.** 121 of 257
tickets are `ignored`, and every one of them was classified `ignored` by processing the mail
first. Writing nothing until a job is confirmed would also remove the exactly-once claim that
stops two concurrent n8n polls both processing the same message, and the no-data-loss
guarantee that `/api/n8n-inbound` is built around.

What this plan does instead is the same intent with the timing fixed: **identity is stored
always, cheaply, forever; the body is stored once, and only for as long as it can still
matter.** After 90 days the body leaves and the job stays. The database ends up holding
confirmed jobs plus a bounded, non-growing working set — which is what the instruction is
protecting against, without breaking the two guarantees the intake path depends on.

## Global Constraints

- **`/api/n8n-inbound` must never lose an enquiry.** Capture happens before processing and
  fails soft; every change here preserves that ordering.
- **`claimMessage` must stay atomic.** The single `INSERT … ON CONFLICT` is what makes
  concurrent polls safe. Nothing in this plan adds a read-then-write around it.
- **No model calls.** Nothing in this work sends anything to an LLM. A corpus run has cost
  $57 in a night before; every script here is offline or SQL only.
- Columns are **emptied, never dropped**. `inbound_raw.payload` and `sweep_threads.payload`
  stay in the schema, nullable, so every change is a one-line revert.
- `sweep_threads` **header columns stay in Postgres** — `thread_id`, `mailbox`,
  `message_count`, `first_date`, `last_date`, `subject`, `participants`. Four consumers join
  on them and must keep working untouched.
- `/api/settings` and the other write routes are already authorised; do not widen them.
- Tests are auto-discovered: adding `test/foo.ts` is enough for `npm run test:all` to run it.
  A test file passes by exiting 0.
- Commit per task. Push once, at the end.

---

### Task 1: One row per message

**Files:**
- Create: `app/lib/threadMessagesDb.ts`
- Test: `test/threadMessages.ts`
- Modify: `package.json` (`test:messages` script)

**Interfaces:**
- Produces:
  - `export interface StoredMessage { message_id: string; thread_id: string; from_address: string; to_addresses: string[]; date_iso: string; subject: string; body: string | null; is_from_spartan: boolean }`
  - `export function messagesFromPayload(payload: unknown): StoredMessage[]` — pure.
  - `export async function ensureThreadMessages(): Promise<void>` — creates the table without writing.
  - `export async function storeThreadMessages(payload: unknown): Promise<{ ok: boolean; inserted: number; seen: number }>`
  - `export async function rebuildThread(thread_id: string): Promise<{ thread_id: string; messages: StoredMessage[] } | null>`

  Tasks 2, 3, 4 and 5 all depend on these names.

- [ ] **Step 1: Write the failing test**

Create `test/threadMessages.ts`:

```ts
// ============================================================================
// A message is stored once, however many times its thread is delivered.
// ----------------------------------------------------------------------------
// n8n POSTs the FULL hydrated thread on every new message, so a thread of five
// messages arrives five times carrying 1, 2, 3, 4 and 5 messages. Stored
// verbatim that is 15 message-copies for 5 messages, and on the live database it
// came to 6,644 copies of 1,354 messages. This asserts the fix: re-delivering a
// thread inserts only what is new.
//
// Runs against the real database with tagged rows, and removes them.
// Run: npx tsx test/threadMessages.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { messagesFromPayload, storeThreadMessages, rebuildThread } from "../app/lib/threadMessagesDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `msgtest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const msg = (n: number) => ({
  message_id: `${TAG}-m${n}`,
  from: `client${n} <c${n}@example.com>`,
  to: ["bookings@spartancrew.co.uk"],
  date_iso: `2026-08-0${n}T10:00:00Z`,
  subject: "Crew for Friday",
  body: `body of message ${n}`.repeat(20),
});
const thread = (upTo: number) => ({
  thread_id: `${TAG}-t`,
  messages: Array.from({ length: upTo }, (_, i) => msg(i + 1)),
});

console.log("\nmessagesFromPayload is pure and total");
ok(messagesFromPayload(null).length === 0, "null payload yields nothing");
ok(messagesFromPayload({ messages: [] }).length === 0, "empty thread yields nothing");
ok(messagesFromPayload(thread(3)).length === 3, "a thread of three yields three");
ok(messagesFromPayload(thread(3))[0].from_address === "c1@example.com",
   "the display name is stripped from the address");
ok(messagesFromPayload({ messages: [{ ...msg(1), message_id: "" }] }).length === 0,
   "a message with no id is not storable");

console.log("\nre-delivery inserts only what is new");
const a = await storeThreadMessages(thread(1));
ok(a.inserted === 1, "first delivery inserts one", JSON.stringify(a));
const b = await storeThreadMessages(thread(3));
ok(b.inserted === 2, "second delivery of three inserts only the two new", JSON.stringify(b));
const c = await storeThreadMessages(thread(3));
ok(c.inserted === 0, "an exact re-delivery inserts nothing", JSON.stringify(c));

const [{ n }] = (await sql`
  SELECT count(*)::int n FROM thread_messages WHERE thread_id = ${TAG + "-t"}`) as { n: number }[];
ok(n === 3, "three messages stored for a thread delivered three times", String(n));

console.log("\nthe thread rebuilds into the shape coerceThread accepts");
const rebuilt = await rebuildThread(`${TAG}-t`);
ok(!!rebuilt, "a stored thread rebuilds");
ok(rebuilt!.messages.length === 3, "with all three messages", String(rebuilt!.messages.length));
ok(rebuilt!.messages[0].date_iso < rebuilt!.messages[2].date_iso, "in date order");
ok(await rebuildThread(`${TAG}-nope`) === null, "an unknown thread rebuilds to null");

await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-t"}`;
console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx tsx test/threadMessages.ts`
Expected: FAIL — `app/lib/threadMessagesDb` does not exist.

- [ ] **Step 3: Write the module**

Create `app/lib/threadMessagesDb.ts`:

```ts
// ============================================================================
// One row per message. The table inbound_raw should always have been.
// ----------------------------------------------------------------------------
// n8n POSTs the FULL hydrated thread on every new message, and captureInboundRaw
// stored that body verbatim. A thread of N messages therefore cost N deliveries
// each carrying up to N messages: on the live database, 6,644 message-copies for
// 1,354 actual messages, 4.9x, growing with the square of thread length. The
// worst single thread held 4.4 MB across 21 rows.
//
// Keyed on message_id with ON CONFLICT DO NOTHING, so a re-delivery is a no-op
// and the cost of a thread is the mail in it, once.
//
// The body is nullable ON PURPOSE. After 90 days scripts/archive-thread-bodies.mjs
// writes it to data/archive/ and nulls it here; the headers stay forever because
// they are small and are what the board and the ledgers actually read.
// ============================================================================
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
let _ready = false;

function connString(): string {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.STORAGE_DATABASE_URL || "").trim();
}
function db(): NeonQueryFunction<false, false> | null {
  if (_sql) return _sql;
  const url = connString();
  if (!url) return null;
  _sql = neon(url);
  return _sql;
}
async function ensure(sql: NeonQueryFunction<false, false>): Promise<void> {
  if (_ready) return;
  await sql`
    CREATE TABLE IF NOT EXISTS thread_messages (
      message_id      TEXT PRIMARY KEY,
      thread_id       TEXT NOT NULL,
      from_address    TEXT,
      to_addresses    JSONB,
      date_iso        TEXT,
      subject         TEXT,
      body            TEXT,
      is_from_spartan BOOLEAN NOT NULL DEFAULT false,
      first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      archived_at     TIMESTAMPTZ
    )`;
  await sql`CREATE INDEX IF NOT EXISTS thread_messages_thread ON thread_messages (thread_id, date_iso)`;
  await sql`CREATE INDEX IF NOT EXISTS thread_messages_seen ON thread_messages (first_seen_at DESC)`;
  _ready = true;
}

/** Create the table without writing to it. For callers that only read, and for tests that
 *  run before anything has stored a message. */
export async function ensureThreadMessages(): Promise<void> {
  const sql = db();
  if (!sql) return;
  try { await ensure(sql); } catch (err) { console.error("[thread_messages] ensure failed", err); }
}

export interface StoredMessage {
  message_id: string;
  thread_id: string;
  from_address: string;
  to_addresses: string[];
  date_iso: string;
  subject: string;
  body: string | null;
  is_from_spartan: boolean;
}

/** "Jane <j@x.com>" | {address} -> "j@x.com". Same rule as engine/intake.ts addrOf. */
function addrOf(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v)) return addrOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return addrOf(o.address ?? o.email ?? o.value ?? "");
  }
  const s = String(v);
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim();
}
function addrList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(addrOf).filter(Boolean);
  return String(v).split(",").map(addrOf).filter(Boolean);
}

/**
 * Split an inbound payload into its messages. Pure and total: an unrecognised
 * payload yields an empty array rather than throwing, because the caller is on
 * the no-data-loss path and must not fail because a shape surprised it.
 *
 * Tolerant of the same three spellings engine/intake.ts accepts — the workflow
 * was copied from House of Hud and still mixes Gmail, normalized and Outlook names.
 */
export function messagesFromPayload(payload: unknown): StoredMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const b = payload as Record<string, unknown>;
  const oe = (b.original_email ?? {}) as Record<string, unknown>;
  const thread_id = String(
    b.thread_id ?? b.threadId ?? oe.thread_id ?? oe.threadId ?? b.conversationId ?? ""
  ).trim();
  if (!thread_id) return [];

  const raw = Array.isArray(b.messages) && b.messages.length
    ? (b.messages as unknown[])
    : (oe.body || oe.email_id) ? [oe] : [];

  const out: StoredMessage[] = [];
  for (const m of raw) {
    const r = (m ?? {}) as Record<string, unknown>;
    const message_id = String(r.message_id ?? r.messageId ?? r.id ?? r.email_id ?? "").trim();
    if (!message_id) continue;           // no id means no identity means not storable
    const from = addrOf(r.from ?? r.fromAddress);
    out.push({
      message_id,
      thread_id,
      from_address: from,
      to_addresses: addrList(r.to ?? r.toRecipients),
      date_iso: String(r.date_iso ?? r.dateIso ?? r.date ?? r.sentDateTime ?? ""),
      subject: String(r.subject ?? ""),
      body: String(r.body ?? r.text ?? r.bodyContent ?? "") || null,
      is_from_spartan:
        typeof r.is_from_spartan === "boolean"
          ? r.is_from_spartan
          : /@spartancrew\.co\.uk$/i.test(from),
    });
  }
  return out;
}

/** Store every message in a payload. Never throws: intake must not fail on a ledger error. */
export async function storeThreadMessages(payload: unknown):
  Promise<{ ok: boolean; inserted: number; seen: number }> {
  const msgs = messagesFromPayload(payload);
  if (!msgs.length) return { ok: true, inserted: 0, seen: 0 };
  const sql = db();
  if (!sql) return { ok: false, inserted: 0, seen: msgs.length };
  try {
    await ensure(sql);
    let inserted = 0;
    for (const m of msgs) {
      const rows = (await sql`
        INSERT INTO thread_messages
          (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan)
        VALUES (${m.message_id}, ${m.thread_id}, ${m.from_address},
                ${JSON.stringify(m.to_addresses)}, ${m.date_iso}, ${m.subject},
                ${m.body}, ${m.is_from_spartan})
        ON CONFLICT (message_id) DO NOTHING
        RETURNING message_id`) as { message_id: string }[];
      if (rows.length) inserted++;
    }
    return { ok: true, inserted, seen: msgs.length };
  } catch (err) {
    console.error("[thread_messages] store failed", err);
    return { ok: false, inserted: 0, seen: msgs.length };
  }
}

/**
 * Rebuild a thread in the exact shape engine/intake.ts coerceThread accepts, so a
 * replay does not need the original POST body. This is what makes storing the
 * payload N times unnecessary.
 */
export async function rebuildThread(thread_id: string):
  Promise<{ thread_id: string; messages: StoredMessage[] } | null> {
  const sql = db();
  if (!sql) return null;
  try {
    await ensure(sql);
    const rows = (await sql`
      SELECT message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
      FROM thread_messages WHERE thread_id = ${thread_id}
      ORDER BY date_iso ASC, first_seen_at ASC`) as StoredMessage[];
    if (!rows.length) return null;
    return {
      thread_id,
      messages: rows.map((r) => ({ ...r, to_addresses: r.to_addresses ?? [] })),
    };
  } catch (err) {
    console.error("[thread_messages] rebuild failed", err);
    return null;
  }
}
```

- [ ] **Step 4: Run the test to watch it pass**

Run: `npx tsx test/threadMessages.ts`
Expected: ALL PASS, exit 0.

- [ ] **Step 5: Register a named script**

In `package.json` scripts: `"test:messages": "tsx test/threadMessages.ts"`.
`test/all.ts` already discovers the file; this is for running it alone.

- [ ] **Step 6: Commit**

```bash
git add app/lib/threadMessagesDb.ts test/threadMessages.ts package.json
git commit -m "A re-delivered thread now costs the messages that are new, not the whole thread"
```

---

### Task 2: Write messages on the way in, alongside the existing capture

Additive. `inbound_raw` still stores the payload exactly as today, so nothing is at risk yet.

**Files:**
- Modify: `app/lib/inboundRawDb.ts` (`captureInboundRaw`)
- Test: `test/threadMessages.ts` (extend)

**Interfaces:**
- Consumes: `storeThreadMessages` from Task 1.
- Produces: `CaptureResult` gains `messages_stored: number`.

- [ ] **Step 1: Write the failing test**

Append to `test/threadMessages.ts`, before the cleanup line:

```ts
console.log("\ncapture writes both ledgers");
const { captureInboundRaw } = await import("../app/lib/inboundRawDb");
const cap = await captureInboundRaw(thread(4), "test");
ok(cap.ok, "capture succeeded", JSON.stringify(cap));
ok(cap.messages_stored === 1, "the fourth message is the only new one", String(cap.messages_stored));
const [{ n2 }] = (await sql`
  SELECT count(*)::int n2 FROM thread_messages WHERE thread_id = ${TAG + "-t"}`) as { n2: number }[];
ok(n2 === 4, "four messages after a four-message delivery", String(n2));
await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-t"}`;
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx tsx test/threadMessages.ts`
Expected: FAIL — `messages_stored` is undefined.

- [ ] **Step 3: Wire it in**

In `app/lib/inboundRawDb.ts`, add the import:

```ts
import { storeThreadMessages } from "./threadMessagesDb";
```

Extend the interface:

```ts
export interface CaptureResult {
  ok: boolean; captured: boolean; dedup_key: string;
  thread_id: string | null; message_id: string | null;
  /** How many messages in this payload had not been stored before. */
  messages_stored: number;
}
```

In `captureInboundRaw`, after the existing `INSERT INTO inbound_raw`, before the return:

```ts
    // Decomposed alongside the raw copy. Task 5 removes the raw copy; keeping both for one
    // deploy means a rollback loses nothing.
    const msgs = await storeThreadMessages(payload);
    return { ok: true, captured: rows.length > 0, dedup_key, thread_id, message_id,
             messages_stored: msgs.inserted };
```

Add `messages_stored: 0` to both early-return objects (the no-database return and the catch).

- [ ] **Step 4: Run the tests**

Run: `npx tsx test/threadMessages.ts && npm run test:all`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/lib/inboundRawDb.ts test/threadMessages.ts
git commit -m "An arriving payload is filed message by message as well as whole"
```

---

### Task 3: Backfill the messages already held

**Files:**
- Create: `scripts/backfill-thread-messages.mjs`
- Modify: `package.json` (`backfill:messages`)

- [ ] **Step 1: Write the script**

Create `scripts/backfill-thread-messages.mjs`:

```js
// Decomposes the inbound_raw payloads already stored into thread_messages, so the
// history is in the new shape before the old shape stops being written.
//
// Reads only. Nothing in inbound_raw is modified here.
//
//   node scripts/backfill-thread-messages.mjs           # dry run
//   node scripts/backfill-thread-messages.mjs --apply
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");

const rows = await sql`
  SELECT id, payload FROM inbound_raw WHERE payload IS NOT NULL ORDER BY id`;
console.log(`${rows.length} payload(s) to decompose${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);

const seen = new Set();
let copies = 0;
for (const r of rows) {
  const msgs = Array.isArray(r.payload?.messages) ? r.payload.messages : [];
  const thread_id = String(r.payload?.thread_id ?? r.payload?.threadId ?? "").trim();
  for (const m of msgs) {
    copies++;
    const id = String(m?.message_id ?? m?.messageId ?? m?.id ?? "").trim();
    if (!id || !thread_id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!APPLY) continue;
    const from = String(m?.from ?? "").match(/<([^>]+)>/)?.[1] ?? String(m?.from ?? "").trim();
    await sql`
      INSERT INTO thread_messages
        (message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan)
      VALUES (${id}, ${thread_id}, ${from},
              ${JSON.stringify(Array.isArray(m?.to) ? m.to : [])},
              ${String(m?.date_iso ?? m?.date ?? "")}, ${String(m?.subject ?? "")},
              ${String(m?.body ?? "") || null},
              ${/@spartancrew\.co\.uk$/i.test(from)})
      ON CONFLICT (message_id) DO NOTHING`;
  }
}

console.log(`message copies seen: ${copies}`);
console.log(`distinct messages:   ${seen.size}`);
console.log(`duplication factor:  ${(copies / Math.max(seen.size, 1)).toFixed(1)}x`);
if (APPLY) {
  const [{ n }] = await sql`SELECT count(*)::int n FROM thread_messages`;
  console.log(`thread_messages now holds ${n}`);
}
```

- [ ] **Step 2: Register it**

`"backfill:messages": "node scripts/backfill-thread-messages.mjs"`

- [ ] **Step 3: Dry run**

Run: `npm run backfill:messages`
Expected: `1062 payload(s)`, `message copies seen: 6644`, `distinct messages: 1354`,
`duplication factor: 4.9x`. If those three numbers do not appear, stop — the payload shape
is not what was measured, and Task 4 must not proceed on a wrong assumption.

- [ ] **Step 4: Apply**

Run: `npm run backfill:messages -- --apply`
Expected: `thread_messages now holds 1354` (or a few more, from live traffic since Task 2).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-thread-messages.mjs package.json
git commit -m "The 6,644 stored message copies are reduced to the 1,354 messages they are"
```

---

### Task 4: Replay reads the messages, not the payload

Must land before Task 5, because Task 5 stops writing the payload that replay reads today.

**Files:**
- Modify: `scripts/reprocess-from-n8n.ts`
- Test: `test/replayFromMessages.ts`

**Interfaces:**
- Consumes: `rebuildThread` from Task 1, `coerceThread` from `app/lib/engine/intake`.

- [ ] **Step 1: Write the failing test**

Create `test/replayFromMessages.ts`:

```ts
// ============================================================================
// A thread rebuilt from thread_messages is a thread the engine accepts.
// ----------------------------------------------------------------------------
// This is the load-bearing claim of the whole restructure: if rebuildThread's
// output round-trips through coerceThread unchanged, then storing the payload on
// every delivery buys nothing and can stop. If it does not, replay breaks
// silently the day the payload stops being written.
//
// Run: npx tsx test/replayFromMessages.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { storeThreadMessages, rebuildThread } from "../app/lib/threadMessagesDb";
import { coerceThread } from "../app/lib/engine/intake";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `replaytest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const original = {
  thread_id: `${TAG}-t`,
  messages: [
    { message_id: `${TAG}-1`, from: "Jane <jane@client.com>", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-01T09:00:00Z", subject: "Crew for Friday", body: "We need eight riggers." },
    { message_id: `${TAG}-2`, from: "bookings@spartancrew.co.uk", to: ["jane@client.com"],
      date_iso: "2026-08-01T11:00:00Z", subject: "Re: Crew for Friday", body: "Confirming eight." },
  ],
};

await storeThreadMessages(original);
const rebuilt = await rebuildThread(`${TAG}-t`);
ok(!!rebuilt, "the thread rebuilds from thread_messages");

// rebuildThread returns from_address/to_addresses; coerceThread accepts from/to. Feed it
// the wire shape the replay script will actually construct.
const wire = {
  thread_id: rebuilt!.thread_id,
  messages: rebuilt!.messages.map((m) => ({
    message_id: m.message_id, from: m.from_address, to: m.to_addresses,
    date_iso: m.date_iso, subject: m.subject, body: m.body ?? "",
    is_from_spartan: m.is_from_spartan,
  })),
};

const fromRebuilt = coerceThread(wire);
const fromOriginal = coerceThread(original);
ok(!!fromRebuilt, "coerceThread accepts the rebuilt thread");
ok(JSON.stringify(fromRebuilt) === JSON.stringify(fromOriginal),
   "and produces exactly what the original payload produced");
ok(fromRebuilt!.messages[1].is_from_spartan === true,
   "the Spartan side of the conversation is still recognised");

// A thread whose bodies have been archived out must NOT replay as a half-thread.
await sql`UPDATE thread_messages SET body = NULL, archived_at = now() WHERE message_id = ${TAG + "-1"}`;
const partial = await rebuildThread(`${TAG}-t`);
ok(partial!.messages.filter((m) => m.body === null).length === 1,
   "an archived message rebuilds with a null body, visibly rather than silently");

await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-t"}`;
console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx tsx test/replayFromMessages.ts`
Expected: FAIL on the round-trip equality until the field mapping is right. Fix
`rebuildThread` or the wire mapping until it passes — this is the test that earns Task 5.

- [ ] **Step 3: Point the replay script at the new source**

In `scripts/reprocess-from-n8n.ts`, replace the read of `inbound_raw.payload` with a
`rebuildThread` call, falling back to the payload while old rows still carry one:

```ts
import { rebuildThread } from "../app/lib/threadMessagesDb";

/**
 * The thread to replay. Prefers thread_messages, which holds each message once; falls
 * back to the stored payload for rows captured before the restructure. The fallback can
 * be deleted once no inbound_raw row has a payload.
 */
async function threadFor(thread_id: string, payload: unknown): Promise<unknown> {
  const rebuilt = await rebuildThread(thread_id);
  if (!rebuilt) return payload;
  return {
    thread_id: rebuilt.thread_id,
    messages: rebuilt.messages.map((m) => ({
      message_id: m.message_id, from: m.from_address, to: m.to_addresses,
      date_iso: m.date_iso, subject: m.subject, body: m.body ?? "",
      is_from_spartan: m.is_from_spartan,
    })),
  };
}
```

- [ ] **Step 4: Prove replay still works against a real thread**

Run: `npx tsx scripts/reprocess-from-n8n.ts --dry-run` (or the script's existing dry flag)
Expected: the same threads it reported before this change, with the same message counts.

- [ ] **Step 5: Run everything**

Run: `npm run test:all`
Expected: ALL TEST FILES PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/reprocess-from-n8n.ts test/replayFromMessages.ts
git commit -m "A replay rebuilds its thread from stored messages, so the payload is redundant"
```

---

### Task 5: Stop storing the payload

The moment growth stops.

**Files:**
- Modify: `app/lib/inboundRawDb.ts`
- Test: `test/threadMessages.ts` (extend)

**Interfaces:**
- Produces: `export function envelopeOf(payload: unknown): unknown` — the payload with
  `messages` removed. Task 6 depends on it.

**Why an envelope column.** The message bodies are essentially all of the 20.7 KB in a
payload, but they are not all of the *information*. n8n wraps the thread in routing and
verdict metadata — `payload.n8n.verdict`, gate reasons, source fields — that
`messagesFromPayload` does not extract and `thread_messages` has nowhere to put.
`scripts/survey-inbound.mjs` and `scripts/grade-brain.mjs` read exactly that. Dropping the
whole payload would lose it permanently. Storing the payload minus `messages[]` keeps every
one of those fields for a few hundred bytes a row.

- [ ] **Step 1: Write the failing test**

Append to `test/threadMessages.ts`:

```ts
console.log("\nthe bodies leave the ledger row; the envelope stays");
const enveloped = { ...thread(5), n8n: { verdict: { from: "c@example.com", gate: "priceable" } } };
const cap2 = await captureInboundRaw(enveloped, "test");
ok(cap2.ok, "capture still succeeds");
const [row2] = (await sql`
  SELECT payload IS NULL AS no_payload, envelope FROM inbound_raw
  WHERE thread_id = ${TAG + "-t"} ORDER BY id DESC LIMIT 1`) as any[];
ok(row2.no_payload, "the row carries no payload");
ok(row2.envelope?.n8n?.verdict?.gate === "priceable",
   "but the n8n verdict survived", JSON.stringify(row2.envelope?.n8n));
ok(row2.envelope?.messages === undefined, "and the bodies are not duplicated into it");
const [{ n3 }] = (await sql`
  SELECT count(*)::int n3 FROM thread_messages WHERE thread_id = ${TAG + "-t"}`) as { n3: number }[];
ok(n3 === 5, "all five messages are stored", String(n3));
await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-t"}`;
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx tsx test/threadMessages.ts`
Expected: FAIL — the row still carries a payload.

- [ ] **Step 3: Make the row slim**

In `app/lib/inboundRawDb.ts`, add to `ensure()`:

```ts
  // The payload column is EMPTIED, not dropped: reverting this change is then one line, and
  // rows captured before the restructure keep the copy replay may still need.
  await sql`ALTER TABLE inbound_raw ALTER COLUMN payload DROP NOT NULL`;
  await sql`ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS message_ids TEXT[]`;
  await sql`ALTER TABLE inbound_raw ADD COLUMN IF NOT EXISTS envelope JSONB`;
```

Rewrite the header comment, which currently promises payloads are stored raw:

```ts
// Durable inbound ledger — every delivery to /api/n8n-inbound is recorded here FIRST,
// before any processing, and the dedup_key UNIQUE constraint makes a re-post a no-op.
//
// It records the DELIVERY, not the mail. The mail itself goes to thread_messages, one row
// per message: n8n POSTs the full hydrated thread every time, so storing the body here
// meant 6,644 copies of 1,354 messages and a table growing with the square of thread
// length. See docs/DATABASE-RESTRUCTURE-PLAN.md.
```

Replace the INSERT with:

```ts
    const msgs = await storeThreadMessages(payload);
    const rows = (await sql`
      INSERT INTO inbound_raw (dedup_key, source, thread_id, message_id, message_ids, envelope)
      VALUES (${dedup_key}, ${source}, ${thread_id}, ${message_id},
              ${messagesFromPayload(payload).map((m) => m.message_id)},
              ${JSON.stringify(envelopeOf(payload))})
      ON CONFLICT (dedup_key) DO NOTHING
      RETURNING id`) as { id: number }[];
    return { ok: true, captured: rows.length > 0, dedup_key, thread_id, message_id,
             messages_stored: msgs.inserted };
```

Import `messagesFromPayload` alongside `storeThreadMessages`, and add the envelope helper
above `captureInboundRaw`:

```ts
/**
 * The payload with its message bodies removed. The bodies are ~all of the bytes and go to
 * thread_messages; everything else — n8n's verdict, gate reason, routing and whatever shape
 * the workflow grows next — is a few hundred bytes and is kept, because scripts read it and
 * because a field we do not yet parse is exactly the kind of thing that turns out to matter.
 */
export function envelopeOf(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return payload ?? null;
  const { messages: _messages, ...rest } = payload as Record<string, unknown>;
  return rest;
}
```

Note the ordering: messages are stored **before** the ledger row, so a crash between the two
loses a dedup record (harmless — `claimMessage` and the UNIQUE key both still catch it) and
never loses mail.

- [ ] **Step 4: Run everything**

Run: `npm run test:all && npx tsx test/seam.ts`
Expected: both exit 0. `test/seam.ts` covers the n8n join and must not have moved.

- [ ] **Step 5: Commit**

```bash
git add app/lib/inboundRawDb.ts test/threadMessages.ts
git commit -m "The inbound ledger records a delivery; the mail is stored once, in one place"
```

---

### Task 6: The ops scripts read the rebuilt thread

Nine scripts read `inbound_raw.payload`. Task 5 stops writing it, so without this task they
return nothing on any row captured after the deploy — silently, because they read a column
that still exists and is simply null.

**Files:**
- Create: `scripts/_thread.mjs`
- Modify: `scripts/peek-inbound.mjs`, `scripts/peek-thread.mjs`,
  `scripts/check-new-enquiries.mjs`, `scripts/inspect-live-state.mjs`,
  `scripts/grade-brain.mjs`, `scripts/survey-inbound.mjs`,
  `scripts/backfill-gate-reason.mjs`, `scripts/clear-machine-threads.ts`,
  `scripts/preview-reply.ts`
- Test: `test/opsScriptsReadMessages.ts`

**Interfaces:**
- Consumes: `rebuildThread` (Task 1), `envelopeOf` (Task 5).
- Produces, in `scripts/_thread.mjs`:
  `export async function payloadFor(sql, thread_id, storedPayload, envelope)` — returns the
  `{ thread_id, messages[], ...envelope }` shape the payload used to have.

- [ ] **Step 1: Write the compatibility reader**

Create `scripts/_thread.mjs`:

```js
// Reconstructs what inbound_raw.payload used to hold: the envelope, with the messages put
// back. Rows captured before the restructure still carry a real payload and are returned
// unchanged, so a script works across both eras without knowing which it is looking at.
//
// This is the seam that let nine scripts keep their logic when the storage changed.

/** The thread's messages, in the wire shape the payload carried. */
export async function messagesFor(sql, thread_id) {
  const rows = await sql`
    SELECT message_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan
    FROM thread_messages WHERE thread_id = ${thread_id}
    ORDER BY date_iso ASC, first_seen_at ASC`;
  return rows.map((m) => ({
    message_id: m.message_id,
    from: m.from_address,
    to: m.to_addresses ?? [],
    date_iso: m.date_iso,
    subject: m.subject,
    body: m.body ?? "",
    is_from_spartan: m.is_from_spartan,
  }));
}

/**
 * The payload for a row, whichever era it came from.
 *   storedPayload — inbound_raw.payload (null on rows captured after the restructure)
 *   envelope      — inbound_raw.envelope (null on rows captured before it)
 */
export async function payloadFor(sql, thread_id, storedPayload, envelope) {
  if (storedPayload) return storedPayload;          // pre-restructure row, unchanged
  const messages = await messagesFor(sql, thread_id);
  return { ...(envelope ?? {}), thread_id, messages };
}
```

- [ ] **Step 2: Write the failing test**

Create `test/opsScriptsReadMessages.ts`:

```ts
// ============================================================================
// A row captured after the restructure still yields a payload.
// ----------------------------------------------------------------------------
// Nine ops scripts read inbound_raw.payload. Task 5 stopped writing it. The
// failure mode if this seam is wrong is the bad kind: the column still exists,
// so every one of them reads null and reports "no enquiries" rather than
// crashing. This asserts the reconstruction instead of trusting it.
//
// Run: npx tsx test/opsScriptsReadMessages.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { payloadFor } from "../scripts/_thread.mjs";
import { captureInboundRaw } from "../app/lib/inboundRawDb";
import { coerceThread } from "../app/lib/engine/intake";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const TAG = `opstest-${process.pid}`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const original = {
  thread_id: `${TAG}-t`,
  n8n: { verdict: { from: "jane@client.com", gate: "priceable" } },
  messages: [
    { message_id: `${TAG}-1`, from: "Jane <jane@client.com>", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-01T09:00:00Z", subject: "Crew for Friday", body: "Eight riggers please." },
    { message_id: `${TAG}-2`, from: "Jane <jane@client.com>", to: ["bookings@spartancrew.co.uk"],
      date_iso: "2026-08-02T09:00:00Z", subject: "Re: Crew for Friday", body: "Make it nine." },
  ],
};

await captureInboundRaw(original, "test");
const [row] = (await sql`
  SELECT thread_id, payload, envelope FROM inbound_raw
  WHERE thread_id = ${TAG + "-t"} ORDER BY id DESC LIMIT 1`) as any[];
ok(row.payload === null, "the stored row has no payload");

const rebuilt: any = await payloadFor(sql, row.thread_id, row.payload, row.envelope);
ok(rebuilt.messages.length === 2, "the reconstruction has both messages", String(rebuilt.messages.length));
ok(rebuilt.messages[1].body === "Make it nine.", "with their bodies");
ok(rebuilt.n8n?.verdict?.gate === "priceable", "and the n8n verdict the envelope kept");

const a = coerceThread(rebuilt);
const b = coerceThread(original);
ok(JSON.stringify(a) === JSON.stringify(b),
   "coerceThread cannot tell the reconstruction from the original");

await sql`DELETE FROM inbound_raw WHERE thread_id = ${TAG + "-t"}`;
await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG + "-t"}`;
console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 3: Run it to watch it fail**

Run: `npx tsx test/opsScriptsReadMessages.ts`
Expected: FAIL — `scripts/_thread.mjs` does not exist, or `envelope` is undefined.

- [ ] **Step 4: Port the six that only need the payload back**

`peek-inbound.mjs`, `peek-thread.mjs`, `check-new-enquiries.mjs`, `inspect-live-state.mjs`,
`clear-machine-threads.ts` and `preview-reply.ts` each select `payload` and then read
`r.payload` or pass it to `coerceThread`. In each, add `envelope` to the `SELECT` and put the
payload back through the seam:

```js
import { payloadFor } from "./_thread.mjs";   // "../scripts/_thread.mjs" from a .ts script
// ...
const p = await payloadFor(sql, r.thread_id, r.payload, r.envelope);
```

Then use `p` everywhere the script used `r.payload`. No other logic changes.

- [ ] **Step 5: Port the two that read n8n metadata**

`survey-inbound.mjs` reads `r.payload?.n8n?.verdict` and walks the payload shape;
`grade-brain.mjs` reads `r.payload` for classification grading. Both work unchanged through
`payloadFor`, because the envelope carries `n8n` — that is what the envelope column is for.
Add `envelope` to their `SELECT` and route through the seam as in Step 4.

`survey-inbound.mjs` also walks the payload to report the shapes n8n is sending. Point that
walk at the envelope alone:

```js
// Shape reporting is about the wrapper, not the mail. Walking a reconstructed payload would
// report thread_messages' column names as if n8n had sent them.
for (const r of rows) walk(r.envelope ?? {});
```

- [ ] **Step 6: Port the backfill**

`backfill-gate-reason.mjs` reads `SELECT thread_id, payload FROM inbound_raw ORDER BY id` and
keeps the latest payload per thread. The gate reason lives in the n8n verdict, so it needs
the envelope only:

```js
const raw = await sql`SELECT thread_id, envelope, payload FROM inbound_raw ORDER BY id`;
for (const r of raw) latest.set(r.thread_id, r.envelope ?? r.payload);
```

- [ ] **Step 7: Run each script against live data**

```bash
node scripts/peek-inbound.mjs
node scripts/check-new-enquiries.mjs
node scripts/inspect-live-state.mjs
node scripts/survey-inbound.mjs
node scripts/grade-brain.mjs
npx tsx scripts/preview-reply.ts
```

Expected: each reports the same threads and counts it reported before Task 5. A script that
prints zero enquiries is the failure this task exists to prevent — do not accept it.

- [ ] **Step 8: Run the suite**

Run: `npm run test:all`
Expected: ALL TEST FILES PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/_thread.mjs test/opsScriptsReadMessages.ts scripts/peek-inbound.mjs \
        scripts/peek-thread.mjs scripts/check-new-enquiries.mjs scripts/inspect-live-state.mjs \
        scripts/grade-brain.mjs scripts/survey-inbound.mjs scripts/backfill-gate-reason.mjs \
        scripts/clear-machine-threads.ts scripts/preview-reply.ts
git commit -m "The ops scripts rebuild a payload from stored messages, so none of them read null"
```

---

### Task 7: Bodies live 90 days

**Files:**
- Create: `scripts/archive-thread-bodies.mjs`
- Create: `data/archive/.gitignore`
- Modify: `package.json` (`archive:bodies`)
- Test: `test/bodyArchive.ts`

- [ ] **Step 1: Keep the archive out of git**

Create `data/archive/.gitignore`:

```
# Message bodies archived out of Postgres after 90 days. Real client mail — never committed.
*
!.gitignore
```

- [ ] **Step 2: Write the failing test**

Create `test/bodyArchive.ts`:

```ts
// ============================================================================
// A message body older than the retention window leaves; a recent one stays.
// ----------------------------------------------------------------------------
// The window is the only thing standing between a bounded table and the
// unbounded one this replaced, so it is asserted rather than trusted. The
// headers must survive: the board, the sender ledger and four corpus joins read
// them, and they are a few dozen bytes against a body's several kilobytes.
//
// Run: npx tsx test/bodyArchive.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
// test/all.ts runs files alphabetically, so this one runs before threadMessages.ts and
// cannot assume the table exists yet.
import { ensureThreadMessages } from "../app/lib/threadMessagesDb";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
await ensureThreadMessages();
const TAG = `archivetest-${process.pid}`;
const OUT = `data/archive/${TAG}.jsonl`;

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const put = async (n: string, daysAgo: number) => sql`
  INSERT INTO thread_messages
    (message_id, thread_id, from_address, date_iso, subject, body, first_seen_at)
  VALUES (${TAG + n}, ${TAG}, 'c@example.com', '2026-01-01T00:00:00Z', 'subj',
          ${"body " + n}, now() - (${daysAgo} || ' days')::interval)`;

await put("-old", 120);
await put("-edge", 89);
await put("-new", 3);

execFileSync("node", ["scripts/archive-thread-bodies.mjs", "--apply", "--out", OUT],
  { stdio: "inherit" });

const rows = (await sql`
  SELECT message_id, body, archived_at, subject, from_address
  FROM thread_messages WHERE thread_id = ${TAG} ORDER BY message_id`) as any[];
const by = Object.fromEntries(rows.map((r) => [r.message_id, r]));

ok(by[TAG + "-old"].body === null, "a 120-day-old body is gone");
ok(by[TAG + "-old"].archived_at !== null, "and the row says when it went");
ok(by[TAG + "-old"].subject === "subj", "its subject stayed");
ok(by[TAG + "-old"].from_address === "c@example.com", "its sender stayed");
ok(by[TAG + "-edge"].body !== null, "an 89-day-old body is inside the window and stays");
ok(by[TAG + "-new"].body !== null, "a 3-day-old body stays");

ok(existsSync(OUT), "the archive file was written");
const lines = readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
ok(lines.length === 1, "one line, for the one archived message", String(lines.length));
ok(lines[0].message_id === TAG + "-old", "naming the message it archived");
ok(lines[0].body === "body -old", "and carrying the body verbatim");

rmSync(OUT, { force: true });
await sql`DELETE FROM thread_messages WHERE thread_id = ${TAG}`;
console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 3: Run it to watch it fail**

Run: `npx tsx test/bodyArchive.ts`
Expected: FAIL — the script does not exist.

- [ ] **Step 4: Write the archiver**

Create `scripts/archive-thread-bodies.mjs`:

```js
// Moves message bodies older than the retention window out of Postgres and into a JSONL
// file on disk, leaving the headers behind.
//
// WHY 90 DAYS. Ben's choice. Nothing in the live data was older than 30 days when this was
// written, so 90 is three times any replay anyone has needed; it costs roughly 12 MB more
// than a 30-day window and buys a wider window for a slow-moving dispute.
//
// WHY A LOCAL SCRIPT AND NOT A CRON. Vercel functions have no persistent disk. At 90 days
// the table stabilises around 20 MB whether this runs weekly or monthly, so an unattended
// job is not worth a Blob store yet. If that changes, the destination is the only thing
// that has to change.
//
//   node scripts/archive-thread-bodies.mjs                    # dry run
//   node scripts/archive-thread-bodies.mjs --apply
//   node scripts/archive-thread-bodies.mjs --apply --days 30
//   node scripts/archive-thread-bodies.mjs --apply --out path.jsonl
import { neon } from "@neondatabase/serverless";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const APPLY = process.argv.includes("--apply");
const DAYS = Number(arg("days", 90));
const OUT = arg("out", `data/archive/${new Date().toISOString().slice(0, 7)}.jsonl`);

const rows = await sql`
  SELECT message_id, thread_id, from_address, to_addresses, date_iso, subject, body, is_from_spartan,
         first_seen_at
  FROM thread_messages
  WHERE body IS NOT NULL AND first_seen_at < now() - (${DAYS} || ' days')::interval
  ORDER BY first_seen_at`;

console.log(`${rows.length} body/bodies older than ${DAYS} days${APPLY ? "" : "  (DRY RUN — pass --apply)"}`);
if (!APPLY || !rows.length) {
  const bytes = rows.reduce((a, r) => a + (r.body?.length ?? 0), 0);
  console.log(`would free roughly ${(bytes / 1048576).toFixed(1)} MB of body text`);
  process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
let freed = 0;
for (const r of rows) {
  // Written to disk BEFORE the column is cleared. The reverse order would lose a body to a
  // crash between the two statements.
  appendFileSync(OUT, JSON.stringify(r) + "\n", "utf8");
  await sql`UPDATE thread_messages SET body = NULL, archived_at = now() WHERE message_id = ${r.message_id}`;
  freed += r.body?.length ?? 0;
}
console.log(`archived ${rows.length} to ${OUT}, freed ${(freed / 1048576).toFixed(1)} MB`);
console.log("run VACUUM to return the space: npm run db:reclaim");
```

- [ ] **Step 5: Run the test**

Run: `npx tsx test/bodyArchive.ts`
Expected: ALL PASS.

- [ ] **Step 6: Register and dry-run against live data**

Add `"archive:bodies": "node scripts/archive-thread-bodies.mjs"`.

Run: `npm run archive:bodies`
Expected: `0 body/bodies older than 90 days` — nothing in the live table is that old yet.
This is the correct result today; the machinery is in place for when it is not.

- [ ] **Step 7: Commit**

```bash
git add scripts/archive-thread-bodies.mjs test/bodyArchive.ts data/archive/.gitignore package.json
git commit -m "A message body leaves the database after 90 days; its headers stay"
```

---

### Task 8: The corpus goes to disk

72.2 MB, 68% of the database, read by no runtime path.

**Files:**
- Create: `scripts/export-sweep-corpus.mjs`
- Create: `scripts/_corpus.mjs`
- Create: `data/corpus/.gitignore`
- Modify: `package.json` (`corpus:export`)
- Test: `test/corpusExport.ts`

**Interfaces:**
- Produces, in `scripts/_corpus.mjs`:
  - `export function corpusPath(): string`
  - `export async function* readCorpus()` — yields `{ thread_id, subject, message_count, first_date, last_date, payload }`
  - `export async function corpusByThreadId(): Promise<Map<string, object>>`

  Task 9 rewrites seven scripts against these three names.

- [ ] **Step 1: Keep the corpus out of git**

Create `data/corpus/.gitignore` with the same two lines as `data/archive/.gitignore`.
It is 55 MB of real client mail.

- [ ] **Step 2: Write the exporter**

Create `scripts/export-sweep-corpus.mjs`:

```js
// Streams sweep_threads to data/corpus/sweep-threads.jsonl, verifies the file against the
// table, and only then offers to empty the payload column.
//
// The corpus is a research dataset — see the header of app/lib/sweepDb.ts. It is 72 MB of a
// 512 MB production database and no deployed route reads its payload: /api/sweep-ingest
// writes it and counts header columns, and that is all. On disk it costs nothing and
// scripts/rnd-disproofs.mjs gets to grep instead of running ILIKE over 55 MB.
//
// The HEADER columns stay in Postgres. sweep_labels, pull-labelled-corpus, study-corpus and
// test/sweepIsolation all join on them and must keep working untouched.
//
//   node scripts/export-sweep-corpus.mjs             # export + verify, changes no table
//   node scripts/export-sweep-corpus.mjs --reclaim   # ...then empty payload and VACUUM
import { neon } from "@neondatabase/serverless";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { loadEnv, requireEnv } from "./_env.mjs";
import { corpusPath } from "./_corpus.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const RECLAIM = process.argv.includes("--reclaim");
const OUT = corpusPath();

const [{ n, bytes }] = await sql`
  SELECT count(*)::int n, pg_size_pretty(pg_total_relation_size('sweep_threads')) bytes
  FROM sweep_threads`;
console.log(`exporting ${n} thread(s); table is ${bytes}`);

mkdirSync("data/corpus", { recursive: true });
const out = createWriteStream(OUT, { encoding: "utf8" });
const PAGE = 200;
let written = 0;
for (let offset = 0; ; offset += PAGE) {
  const rows = await sql`
    SELECT thread_id, mailbox, message_count, first_date, last_date, subject, participants, payload
    FROM sweep_threads ORDER BY thread_id LIMIT ${PAGE} OFFSET ${offset}`;
  if (!rows.length) break;
  for (const r of rows) { out.write(JSON.stringify(r) + "\n"); written++; }
  process.stdout.write(`\r  ${written}/${n}`);
}
await new Promise((res) => out.end(res));
console.log(`\nwrote ${written} line(s) to ${OUT}`);

// Verify the file against the table before anything is cleared.
let lines = 0, msgMismatch = 0;
const ids = new Set();
const rl = createInterface({ input: createReadStream(OUT, "utf8"), crlfDelay: Infinity });
for await (const line of rl) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  lines++;
  ids.add(r.thread_id);
  const held = Array.isArray(r.payload?.messages) ? r.payload.messages.length : 0;
  if (held !== r.message_count) msgMismatch++;
}
console.log(`verify: ${lines} line(s), ${ids.size} distinct thread_id(s), ${msgMismatch} message_count mismatch(es)`);

if (lines !== n || ids.size !== n) {
  console.error("file does not match the table — refusing to reclaim");
  process.exit(1);
}
// message_count mismatches are expected on some rows: the first sweep stored headers n8n
// left empty. They are reported, not fatal, because the payload on disk is still whatever
// the table held.
if (!RECLAIM) { console.log("\nexport verified. Re-run with --reclaim to empty the column."); process.exit(0); }

await sql`ALTER TABLE sweep_threads ALTER COLUMN payload DROP NOT NULL`;
await sql`UPDATE sweep_threads SET payload = NULL`;
await sql`VACUUM FULL sweep_threads`;
await sql`VACUUM ANALYZE sweep_threads`;
const [{ after }] = await sql`
  SELECT pg_size_pretty(pg_total_relation_size('sweep_threads')) after`;
console.log(`payload cleared; table is now ${after}`);
```

- [ ] **Step 3: Write the corpus reader**

Create `scripts/_corpus.mjs`:

```js
// The swept corpus, read from disk. Replaces `SELECT payload FROM sweep_threads` for the
// seven offline scripts that used it. See scripts/export-sweep-corpus.mjs for why it moved.
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function corpusPath() { return join(ROOT, "data", "corpus", "sweep-threads.jsonl"); }

/** Stream the corpus a thread at a time. 55 MB — do not read it whole without a reason. */
export async function* readCorpus() {
  const p = corpusPath();
  if (!existsSync(p)) {
    throw new Error(`no corpus at ${p} — run: npm run corpus:export`);
  }
  const rl = createInterface({ input: createReadStream(p, "utf8"), crlfDelay: Infinity });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

/** thread_id -> row, for the scripts that join the corpus against a set of ids. */
export async function corpusByThreadId() {
  const m = new Map();
  for await (const r of readCorpus()) m.set(r.thread_id, r);
  return m;
}
```

- [ ] **Step 4: Write the test**

Create `test/corpusExport.ts`:

```ts
// ============================================================================
// The exported corpus is the corpus.
// ----------------------------------------------------------------------------
// 55 MB of client mail is about to be deleted from a database on the strength of
// a file existing. This asserts the file actually holds what the table held,
// before the reclaim step is allowed to run.
//
// Read-only against the corpus. Run: npx tsx test/corpusExport.ts
// ============================================================================
import { neon } from "@neondatabase/serverless";
import { existsSync } from "node:fs";
import { loadEnv, requireEnv } from "../scripts/_env.mjs";
import { corpusPath, readCorpus, corpusByThreadId } from "../scripts/_corpus.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

if (!existsSync(corpusPath())) {
  console.log("  SKIP  no corpus exported yet — run npm run corpus:export");
  process.exit(0);
}

const [{ n }] = (await sql`SELECT count(*)::int n FROM sweep_threads`) as { n: number }[];
const byId = await corpusByThreadId();
ok(byId.size === n, "the file holds one row per swept thread", `${byId.size} vs ${n}`);

const [{ tid }] = (await sql`
  SELECT thread_id AS tid FROM sweep_threads ORDER BY message_count DESC LIMIT 1`) as { tid: string }[];
const biggest = byId.get(tid);
ok(!!biggest, "the largest thread in the table is in the file", tid);
ok(Array.isArray(biggest?.payload?.messages), "and carries its messages");

let withPayload = 0, total = 0;
for await (const r of readCorpus()) { total++; if (r.payload) withPayload++; }
ok(withPayload === total, "every line carries a payload", `${withPayload}/${total}`);

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 5: Export and verify**

Add `"corpus:export": "node scripts/export-sweep-corpus.mjs"`.

Run: `npm run corpus:export`
Expected: `wrote 5835 line(s)`, `verify: 5835 line(s), 5835 distinct thread_id(s)`, and
`export verified.` Nothing has been cleared.

Run: `npx tsx test/corpusExport.ts`
Expected: ALL PASS.

- [ ] **Step 6: Reclaim**

Run: `npm run corpus:export -- --reclaim`
Expected: `payload cleared; table is now` a figure under 4 MB.

- [ ] **Step 7: Commit**

```bash
git add scripts/export-sweep-corpus.mjs scripts/_corpus.mjs test/corpusExport.ts data/corpus/.gitignore package.json
git commit -m "The 12-month research corpus lives on disk; the database keeps its headers"
```

---

### Task 9: The seven offline scripts read the file

**Files:**
- Modify: `app/lib/sweepLabelsDb.ts` (`unlabelledThreads`)
- Modify: `scripts/cost-model.ts`, `scripts/parser-coverage.ts`, `scripts/triage-study.ts`,
  `scripts/triage-falsify.ts`, `scripts/rnd-study.mjs`, `scripts/rnd-disproofs.mjs`

**Interfaces:**
- Consumes: `readCorpus`, `corpusByThreadId` from Task 8.
- `unlabelledThreads` keeps its exact signature and its `SweptThread[]` return shape, so
  `scripts/classify-corpus.ts` needs no change at all.

- [ ] **Step 1: Fill `unlabelledThreads` from disk**

In `app/lib/sweepLabelsDb.ts`, the three queries at lines 95, 108 and 114 select
`t.payload` from `sweep_threads`. Drop `t.payload` from each `SELECT`, keep the joins and
the sampling exactly as they are, and fill the payload afterwards:

```ts
// The header columns still come from Postgres — the sampling, the label join and the
// ORDER BY all live there. Only the message bodies come from disk now.
const { corpusByThreadId } = await import("../../scripts/_corpus.mjs");
const corpus = await corpusByThreadId();
return rows.map((r) => ({ ...r, payload: corpus.get(r.thread_id)?.payload ?? { messages: [] } }));
```

- [ ] **Step 2: Replace the four paging reads**

`cost-model.ts`, `parser-coverage.ts` and `triage-study.ts` page
`SELECT thread_id, payload FROM sweep_threads ORDER BY thread_id LIMIT … OFFSET …`.
Replace each paging loop with a stream:

```ts
for await (const r of readCorpus()) {
  // r.thread_id, r.payload — same fields the query returned, same order (thread_id ASC)
}
```

The file is written in `ORDER BY thread_id`, so the iteration order is unchanged and any
`LIMIT` sampling stays representative.

- [ ] **Step 3: Split the one query that spans both worlds**

`triage-falsify.ts` joins the corpus to the live `tickets` table to find which swept
enquiries became real orders. That join cannot survive the split, so make the two reads
explicit:

```ts
// Which swept threads became real orders? The ticket ids come from Postgres, the mail from
// disk. This was one join until the corpus moved out; it is two reads and a Set now.
const ordered = (await sql`
  SELECT k.thread_id FROM tickets k WHERE k.onsinch_order_id IS NOT NULL`) as { thread_id: string }[];
const wanted = new Set(ordered.map((r) => r.thread_id));
const corpus = await corpusByThreadId();
const rows = [...wanted].map((id) => corpus.get(id)).filter(Boolean);
```

- [ ] **Step 4: Turn the ILIKE scan into a substring match**

`rnd-disproofs.mjs` runs `SELECT COUNT(*) FROM sweep_threads WHERE payload::text ILIKE $1`
once per probe. Replace with a single pass that counts every probe at once:

```js
// One pass over the file for all probes, instead of one full-corpus ILIKE each.
const needles = probe.map((r) => r.toLowerCase());
const hits = new Array(needles.length).fill(0);
for await (const row of readCorpus()) {
  const hay = JSON.stringify(row.payload).toLowerCase();
  needles.forEach((nd, i) => { if (hay.includes(nd)) hits[i]++; });
}
const found = hits.filter((h) => h > 0).length;
```

- [ ] **Step 5: Point the senders query at the file**

`rnd-study.mjs` reads `jsonb_array_elements(t.payload->'messages')` to tally senders. Its
corpus-statistics block uses only header columns and stays on SQL. Replace the senders
query with a pass over `readCorpus()`, tallying `m.from` the same way.

- [ ] **Step 6: Run each script and compare**

Run each of the seven and check the headline number it prints matches what it printed
before the move. `parser-coverage.ts` and `triage-study.ts` are the two worth comparing
carefully — they report percentages over the whole corpus, so a wrong read shows up as a
changed figure rather than an error.

```bash
npx tsx scripts/cost-model.ts
npx tsx scripts/parser-coverage.ts
npx tsx scripts/triage-study.ts
npx tsx scripts/triage-falsify.ts
node scripts/rnd-study.mjs
node scripts/rnd-disproofs.mjs
npx tsx scripts/classify-corpus.ts --dry-run
```

- [ ] **Step 7: Commit**

```bash
git add app/lib/sweepLabelsDb.ts scripts/cost-model.ts scripts/parser-coverage.ts \
        scripts/triage-study.ts scripts/triage-falsify.ts scripts/rnd-study.mjs scripts/rnd-disproofs.mjs
git commit -m "The corpus scripts read the exported file; only the labels join stays in SQL"
```

---

### Task 10: Reclaim and measure

**Files:**
- Create: `scripts/db-reclaim.mjs`
- Modify: `package.json` (`db:reclaim`)

- [ ] **Step 1: Write it**

Create `scripts/db-reclaim.mjs`:

```js
// Returns emptied space to Neon and reports the result. A plain UPDATE leaves dead tuples
// claimed; VACUUM FULL rewrites the table, which is the only thing that shrinks the bill.
//
//   node scripts/db-reclaim.mjs           # report only
//   node scripts/db-reclaim.mjs --apply
import { neon } from "@neondatabase/serverless";
import { loadEnv, requireEnv } from "./_env.mjs";

loadEnv();
const sql = neon(requireEnv("DATABASE_URL"));
const APPLY = process.argv.includes("--apply");
const TABLES = ["inbound_raw", "sweep_threads", "thread_messages"];

const report = async (when) => {
  const [{ d }] = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) d`;
  console.log(`\n${when}: database is ${d}`);
  for (const t of TABLES) {
    const [{ s }] = await sql`SELECT pg_size_pretty(pg_total_relation_size(${t})) s`;
    console.log(`  ${t.padEnd(18)} ${s}`);
  }
};

await report("before");
if (!APPLY) { console.log("\nDRY RUN — pass --apply\n"); process.exit(0); }
for (const t of TABLES) {
  await sql(`VACUUM FULL ${t}`);
  await sql(`VACUUM ANALYZE ${t}`);
  console.log(`  vacuumed ${t}`);
}
await report("after");
```

- [ ] **Step 2: Register and run**

Add `"db:reclaim": "node scripts/db-reclaim.mjs"`.

Run: `npm run db:reclaim -- --apply`
Expected: the database drops from 106.5 MB to roughly 35 MB.

- [ ] **Step 3: Run the whole suite one last time**

Run: `npm run test:all`
Expected: ALL TEST FILES PASS.

- [ ] **Step 4: Commit and push the batch**

```bash
git add scripts/db-reclaim.mjs package.json
git commit -m "Emptied columns return their space; the database reports 35 MB, not 106"
git push
```

---

## What this leaves

| | Before | After |
|---|---|---|
| `neon-claret-plank` | 106.5 MB, growing ~23 MB/month | **~35 MB, flat** |
| `sweep_threads` | 72.2 MB | **~4 MB** (headers only; payload on disk) |
| `inbound_raw` | 23.1 MB, unbounded | **under 1 MB** (delivery record + n8n envelope) |
| `thread_messages` | — | **~20 MB steady state** at 90 days |
| Business tables | ~2.4 MB | ~2.4 MB, untouched |
| Message copies per message | 4.9 | **1** |
| Runtime files changed | | 3 (`inboundRawDb.ts`, `sweepLabelsDb.ts`, new `threadMessagesDb.ts`) |
| API contracts changed | | **0** |

At a 30-day window instead of 90, `thread_messages` settles around 7 MB and the database
around 22 MB. The window is one number in one script (`--days`), so that is a later decision
rather than a rebuild.

## What could go wrong

**A crash between storing messages and writing the ledger row** (Task 5): messages are
written first, so the mail is safe and only the dedup record is missing. `claimMessage` and
the `dedup_key` UNIQUE constraint both still catch the re-delivery.

**A payload shape n8n changes** so `messagesFromPayload` extracts nothing: the delivery is
still recorded, but the mail is not stored. This is the one genuinely new failure mode, and
it is why `messages_stored` is returned on `CaptureResult` — a run of zeroes on real traffic
is the signal. Worth a check in `scripts/status-live.mjs` as a follow-on.

**A script that reads `inbound_raw.payload` and was missed.** This is the worst failure mode
in the plan, because the column still exists after Task 5 — a missed script reads null and
reports "no enquiries" instead of throwing. Nine were found by tracing every reference
(`git grep -l inbound_raw` cross-checked for `payload`); Task 6 ports all nine and asserts
the seam. If a tenth appears later, the symptom to recognise is a script that suddenly
reports zero against a database that plainly is not empty.

**Archiving before the corpus scripts are moved** (Task 8 before Task 9): the scripts throw
`no corpus at …` rather than returning wrong answers, because `readCorpus` checks for the
file. Ordering the tasks the other way round would be safer still but leaves 72 MB in place
longer; the explicit error is the trade.

**`data/corpus/` or `data/archive/` deleted from disk.** Both are real client mail with no
second copy once the reclaim step has run. The `.gitignore` keeps them out of git, which
means they are not backed up by git either. Before running either `--reclaim`, copy the file
somewhere durable. This is the one irreversible risk in the plan and it is not defended in
code — it is defended by doing that.
