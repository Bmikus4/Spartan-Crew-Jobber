# Slot-team id custody — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the engine own the id of every crew block it creates, so a client's crew or
time change is applied to the order that exists instead of becoming a note for a human.

**Architecture:** Today `POST /orders` nests the crew blocks, and an API create logs one
childless audit row — so the nested blocks have no readable ids, `slotTeamsForOrder`
returns `[]`, and the in-place amendment path declines on every order the engine has ever
made. `POST /orders` with `SlotTeam: []` is legal (201), and `POST /slotTeams` **returns
the id it creates**. So the create becomes two phases — an empty order, then one block at
a time — and the returned ids are stored in the conversation state. Amendment then pairs
desired blocks to live blocks by **stored id** rather than by position.

**Tech stack:** TypeScript, Next.js on Vercel, Neon Postgres, `npx tsx` test files
discovered by `test/all.ts`. No test framework — each file exits 0/1.

**Spec:** `docs/Spartan-Crew-Onsinch-API-Reference.md` §12 (the measurements this argues
from) and `docs/AMEND-IN-PLACE-PLAN.md` (the amendment design being unblocked).

---

## Global constraints

- **`SlotTeam: []` is required, not optional.** Omitting the key is `400 "Please fill the
  SlotTeam for this Order"`. Verified 2026-08-24.
- **A block can never be removed.** `DELETE /slotTeams` 405, `/slotTeams/{id}` 404,
  `deleted`/`active` unknown properties, `size: 0` refused at a floor of 1. Dropping a
  block still requires `DELETE /orders` + re-POST. **This plan does not change that** and
  must not pretend to.
- **`happening` defaults to NOW on a blockless order** and corrects to the earliest block
  once one exists (verified: `2026-08-24T03:47` → `2027-11-10T08:00`). So a create that
  dies between the two phases leaves an order dated today with no crew — which is why
  Task 4 rolls back.
- **Never widen what an amendment may touch.** The engine patches only ids it created. A
  block a human added in the UI must remain untouched.
- **No new npm dependencies.**
- **`npx tsc --noEmit` clean, `npx tsx test/all.ts` all files pass, `npx tsx sim/run.ts`
  100/100** before any commit.
- Commit messages follow `docs/COMMIT-STANDARD.md` — state what is now true that was not
  true before.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `app/lib/engine/types.ts` | `ConversationState` shape | add `last_ordered_team_ids` |
| `app/lib/engine/compiler.ts` | carries state across the compile seam | carry the new field |
| `app/lib/engine/format.ts` | serialises order/slot-team bodies | pin `SlotTeam: []` behaviour |
| `app/lib/deps.ts` | `createOrderWithPlace`, the production executor | two-phase create + rollback |
| `app/lib/engine/pipeline.ts` | `Executor` interface, create branch, `tryAmendInPlace` | store and pass the ids |
| `app/lib/engine/amendOrder.ts` | `amendOrderInPlace` | prefer stored ids over the audit read |
| `test/idCustody.ts` | **new** — the compile seam and the two-phase create | create |
| `test/amendByStoredId.ts` | **new** — amendment resolves by id, not position | create |
| `scripts/verify-custody-live.ts` | **new** — the whole loop against TEST company 515 | create |

`test/all.ts` discovers test files automatically — no registration step.

---

### Task 1: State carries the ids, and survives the compile seam

The field is useless unless `compile()` carries it forward. A field the pipeline writes
*after* compile returns is dropped on the next email — that is exactly how the replace
path was correct and unreachable for weeks. So the seam is tested first.

**Files:**
- Modify: `app/lib/engine/types.ts` (beside `last_ordered_teams`, ~line 281)
- Modify: `app/lib/engine/compiler.ts:985`
- Test: `test/idCustody.ts` (create)

**Interfaces:**
- Produces: `ConversationState.last_ordered_team_ids?: number[]`

- [ ] **Step 1: Write the failing test**

Create `test/idCustody.ts`:

```typescript
// ============================================================================
// The ids the engine created must survive the compile seam.
// ----------------------------------------------------------------------------
// last_ordered_teams was correct and unreachable for weeks because compile()
// built its next state without carrying it, so every second email saw undefined.
// This field has the same failure mode and the same consequence — an amendment
// that silently cannot address the blocks it owns — so the seam is pinned before
// anything writes to it.
//
// Run: npx tsx test/idCustody.ts
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const compiler = readFileSync(join(ROOT, "app/lib/engine/compiler.ts"), "utf8");
const types = readFileSync(join(ROOT, "app/lib/engine/types.ts"), "utf8");

console.log("the compile seam");
ok(/last_ordered_team_ids\?\: number\[\]/.test(types), "ConversationState declares last_ordered_team_ids");
ok(
  /last_ordered_team_ids:\s*prior\?\.last_ordered_team_ids/.test(compiler),
  "compile() carries last_ordered_team_ids forward from prior state"
);

console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx test/idCustody.ts`
Expected: two FAIL lines, exit 1.

- [ ] **Step 3: Add the field**

In `app/lib/engine/types.ts`, immediately after the `last_ordered_teams` declaration:

```typescript
  /**
   * The OnSinch slot-team ids of exactly those blocks, in the same order.
   *
   * The engine holds these because it CREATED them — `POST /slotTeams` returns the id —
   * not because it can read them back. It cannot: an order created through the API logs
   * one childless audit row, so `slotTeamsForOrder` returns nothing for every order this
   * engine has ever made (API reference §12).
   *
   * This is what lets an amendment address a block directly instead of pairing by
   * position, and pairing by position is fragile in the way that matters: a human adding
   * a block in the OnSinch UI shifts every later index, and the overwrite lands on the
   * wrong block on a 201 that says everything is fine.
   *
   * ABSENT is meaningful and must stay supported — an order raised in the UI, or created
   * before this existed, has no stored ids and falls back to the audit read.
   */
  last_ordered_team_ids?: number[];
```

- [ ] **Step 4: Carry it through compile()**

In `app/lib/engine/compiler.ts`, beside line 985 (`last_ordered_teams: prior?.last_ordered_teams,`):

```typescript
    last_ordered_team_ids: prior?.last_ordered_team_ids,
```

- [ ] **Step 5: Run the test and the suite**

Run: `npx tsx test/idCustody.ts` → both PASS
Run: `npx tsc --noEmit` → clean

- [ ] **Step 6: Commit**

```bash
git add app/lib/engine/types.ts app/lib/engine/compiler.ts test/idCustody.ts
git commit -F- <<'EOF'
State can hold the slot-team ids the engine created

An order created through POST /orders logs one childless audit row, so
slotTeamsForOrder returns nothing for every order this engine has made and the
in-place amendment declines on all of them. The ids are obtainable — POST
/slotTeams returns each one — but there was nowhere to keep them.

Carried through compile() in the same place as last_ordered_teams, and pinned by
a test, because a field the pipeline writes after compile returns is dropped on
the next email. That is how the replace path came to be correct and unreachable.

Nothing writes this field yet.
EOF
```

---

### Task 2: `buildOrderBody` emits an empty `SlotTeam` array, never an absent one

**Files:**
- Test: `test/idCustody.ts` (extend)
- Modify: `app/lib/engine/format.ts:133-141` only if the test fails

**Interfaces:**
- Consumes: `buildOrderBody(o: DesiredOrder): OnsinchOrderBody[]`
- Produces: guarantee that `slot_teams: []` serialises to `SlotTeam: []`

- [ ] **Step 1: Write the failing test**

Append to `test/idCustody.ts`, before the final `console.log`:

```typescript
import { buildOrderBody } from "../app/lib/engine/format";
import type { DesiredOrder } from "../app/lib/engine/types";

const shell: DesiredOrder = {
  name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
  provisional: true, quote: false, pricelist_category_id: 122,
  job_name: "X @ Y", slot_teams: [],
};

console.log("\nthe blockless order body");
const body = buildOrderBody(shell)[0] as any;
// OMITTING the key is a 400 ("Please fill the SlotTeam for this Order"); an EMPTY
// ARRAY is a 201. The difference is the whole two-phase create, so it is pinned.
ok("SlotTeam" in body, "SlotTeam is present as a key");
ok(Array.isArray(body.SlotTeam) && body.SlotTeam.length === 0, "and it is an empty array",
   JSON.stringify(body.SlotTeam));
ok(body.Job && body.Job.pricelist_category_id === 122, "the Job and its rate card still ride along");
```

- [ ] **Step 2: Run it**

Run: `npx tsx test/idCustody.ts`
Expected: these three PASS already — `slot_teams.map(...)` on `[]` yields `[]`. If any
fails, fix `format.ts` so the key is always emitted, then re-run.

- [ ] **Step 3: Commit**

```bash
git add test/idCustody.ts
git commit -F- <<'EOF'
An order body with no crew blocks keeps the SlotTeam key

Omitting SlotTeam is a 400 ("Please fill the SlotTeam for this Order"); sending
an empty array is a 201 carrying an order and its job. The two-phase create
depends on that distinction, and nothing stopped a future tidy-up from dropping
an empty array as redundant.
EOF
```

---

### Task 3: The client can add one block to an existing job and hand back its id

`createSlotTeam` already exists and already returns `{ id }`. This task only proves it,
because everything downstream is built on that return value.

**Files:**
- Test: `test/idCustody.ts` (extend)

**Interfaces:**
- Consumes: `client.createSlotTeam(body: OnsinchSlotTeamBody): Promise<{ id: number }>`,
  `buildSlotTeamBody(job_id: number, team): OnsinchSlotTeamBody`

- [ ] **Step 1: Write the failing test**

Append to `test/idCustody.ts`:

```typescript
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { buildSlotTeamBody } from "../app/lib/engine/format";

console.log("\nid comes back from the create");
const posted: any[] = [];
const t: Transport = async (method, path, b) => {
  posted.push({ method, path, body: b });
  if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 35592 }] } };
  return { status: 200, data: null };
};
const c = new OnsinchClient(t);
const made = await c.createSlotTeam(buildSlotTeamBody(14111, {
  name: "build", profession_id: 1, size: 3, place_id: 49,
  beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00",
}));
ok(made.id === 35592, "createSlotTeam returns the new block's id", String(made.id));
ok(posted[0].body[0].job_id === 14111, "and it was posted against the job we named");

// A create that returns no id must throw rather than hand back a hole: an amendment
// storing undefined would later patch nothing and report success.
let threw = "";
try {
  await new OnsinchClient(async () => ({ status: 201, data: { data: [{}] } }))
    .createSlotTeam(buildSlotTeamBody(1, { name: "x", profession_id: 1, size: 1, place_id: 1,
      beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T09:00:00+00:00" }));
} catch (e: any) { threw = String(e?.message ?? e); }
ok(/no id/i.test(threw), "a 201 with no id throws", threw);
```

Wrap the file's body in `async function main() { … }` with `main().then(...)` if it is not
already — these steps use `await`, and top-level await is not available under the `cjs`
transform `tsx` uses here.

- [ ] **Step 2: Run it**

Run: `npx tsx test/idCustody.ts`
Expected: all PASS (this pins existing behaviour).

- [ ] **Step 3: Commit**

```bash
git add test/idCustody.ts
git commit -m "The id POST /slotTeams returns is pinned, since custody depends on it"
```

---

### Task 4: The create becomes two phases, and rolls back if the second fails

**Files:**
- Modify: `app/lib/deps.ts:46-82` (`createOrderWithPlace`)
- Test: `test/idCustody.ts` (extend)

**Interfaces:**
- Produces: `createOrderWithPlace(...): Promise<{ id: number; number?: string; job_id: number; team_ids: number[] }>`

- [ ] **Step 1: Write the failing test**

Append to `test/idCustody.ts`:

```typescript
import { createOrderWithPlace } from "../app/lib/deps";

const order: DesiredOrder = {
  name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
  provisional: true, quote: false, pricelist_category_id: 122, job_name: "X @ Y",
  slot_teams: [
    { name: "build", profession_id: 1, size: 3, place_id: 49,
      beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00" },
    { name: "derig", profession_id: 1, size: 2, place_id: 49,
      beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" },
  ],
};

console.log("\ntwo-phase create");
{
  const calls: any[] = [];
  let nextTeam = 700;
  const tr: Transport = async (method, path, b) => {
    calls.push({ method, path, body: b });
    if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9001 }] } };
    if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: ++nextTeam }] } };
    if (method === "GET" && path.startsWith("/orders"))
      return { status: 200, data: { data: [{ id: 9001, number: "R1", Job: [{ id: 4001 }] }] } };
    return { status: 200, data: null };
  };
  const res = await createOrderWithPlace(new OnsinchClient(tr), order);
  ok(res.id === 9001, "returns the order id", String(res.id));
  ok(res.job_id === 4001, "and the job id", String(res.job_id));
  ok(JSON.stringify(res.team_ids) === "[701,702]", "and one id per block, in order",
     JSON.stringify(res.team_ids));

  const orderPost = calls.find((c) => c.method === "POST" && c.path === "/orders");
  ok(Array.isArray(orderPost.body[0].SlotTeam) && orderPost.body[0].SlotTeam.length === 0,
     "the order was created with NO nested blocks");
  ok(calls.filter((c) => c.method === "POST" && c.path === "/slotTeams").length === 2,
     "and each block was posted separately");
}

console.log("\na half-built order is rolled back, not returned");
{
  const calls: any[] = [];
  const tr: Transport = async (method, path) => {
    calls.push({ method, path });
    if (method === "POST" && path === "/orders") return { status: 201, data: { data: [{ id: 9002 }] } };
    if (method === "GET" && path.startsWith("/orders"))
      return { status: 200, data: { data: [{ id: 9002, number: "R2", Job: [{ id: 4002 }] }] } };
    // First block lands, second fails.
    if (method === "POST" && path === "/slotTeams") {
      const n = calls.filter((c) => c.path === "/slotTeams").length;
      if (n === 1) return { status: 201, data: { data: [{ id: 801 }] } };
      return { status: 400, data: { validationErrors: { size: ["nope"] } } };
    }
    if (method === "DELETE" && path === "/orders") return { status: 204, data: null };
    return { status: 200, data: null };
  };
  let err = "";
  try { await createOrderWithPlace(new OnsinchClient(tr), order); }
  catch (e: any) { err = String(e?.message ?? e); }
  ok(/could not be given its crew blocks/i.test(err), "it throws rather than returning a partial order", err);
  ok(calls.some((c) => c.method === "DELETE" && c.path === "/orders"),
     "and the blockless order was deleted");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx test/idCustody.ts`
Expected: the two-phase block FAILs — `res.job_id` and `res.team_ids` are `undefined`,
and the order POST carries two nested blocks.

- [ ] **Step 3: Implement the two-phase create**

In `app/lib/deps.ts`, replace the final line of `createOrderWithPlace`
(`return client.createOrder(buildOrderBody(o));`) with:

```typescript
  /**
   * TWO PHASES, so the engine ends up holding every block's id.
   *
   * Nesting the blocks in POST /orders is one call instead of N+1, and it is what this
   * did until 2026-08-24. The cost was invisible and total: an API create logs ONE
   * childless audit row, so nested blocks have no readable ids under any key, and the
   * in-place amendment declined on every order the engine ever made — 43 patches, 0
   * amendments, every crew change becoming a note asking a human to do it by hand
   * (API reference §12).
   *
   * `POST /slotTeams` returns the id it creates, so the ids are had by CREATING them
   * rather than by reading them. `SlotTeam: []` is accepted (201); omitting the key is a
   * 400, which is why the empty array is explicit here and pinned by a test.
   */
  const created = await client.createOrder(buildOrderBody({ ...o, slot_teams: [] }));
  const ids = await readOrderIdentifiers(client, created.id);
  const team_ids: number[] = [];
  try {
    for (const team of o.slot_teams) {
      const made = await client.createSlotTeam(buildSlotTeamBody(ids.job_id, team));
      team_ids.push(made.id);
    }
  } catch (err) {
    /**
     * A blockless order is not a harmless leftover. `happening` defaults to NOW on an
     * order with no blocks and only corrects once one exists, so what is left behind
     * reads as a job happening TODAY with no crew on it — in the ops view, next to real
     * work. Nothing references it yet (no attachments, no crew, no R number in anyone's
     * paperwork), so deleting it is the cheap and correct move.
     *
     * If the rollback itself fails, say both things loudly. Do not swallow the original.
     */
    await client.deleteOrders([created.id]).catch((rollback: unknown) =>
      console.error(
        `[order] order #${created.id} was created, could not be given its crew blocks, AND could not be deleted — it is dated today with no crew and needs removing by hand`,
        rollback
      )
    );
    throw new Error(
      `order #${created.id} could not be given its crew blocks and was rolled back: ${String((err as any)?.message ?? err)}`
    );
  }
  return { id: created.id, number: created.number ?? ids.order_number, job_id: ids.job_id, team_ids };
```

Add above `createOrderWithPlace`:

```typescript
/**
 * The job id, which the create does not return. `POST /orders` answers with the order id
 * alone — nested Job and SlotTeam ids are never in the response — and every block that
 * follows has to be posted against a job_id, so this read is not optional.
 */
async function readOrderIdentifiers(
  client: OnsinchClient,
  order_id: number
): Promise<{ job_id: number; order_number?: string }> {
  const live: any = await client.orderById(order_id);
  const o = live?.data ?? live;
  const job = (Array.isArray(o?.Job) ? o.Job[0] : o?.Job) ?? {};
  const job_id = Number(job?.id);
  if (!Number.isInteger(job_id)) {
    throw new Error(`order #${order_id} was created but its job id could not be read back — cannot post crew blocks`);
  }
  return { job_id, order_number: o?.number ? String(o.number) : undefined };
}
```

Add `buildSlotTeamBody` to the existing `format` import in `deps.ts`.

- [ ] **Step 4: Run the test and the suite**

Run: `npx tsx test/idCustody.ts` → all PASS
Run: `npx tsc --noEmit` → clean
Run: `npx tsx test/all.ts` → all files pass
Run: `npx tsx sim/run.ts` → 100/100

- [ ] **Step 5: Commit**

```bash
git add app/lib/deps.ts test/idCustody.ts
git commit -F- <<'EOF'
An order is created empty and given its crew blocks one at a time

The engine nested its crew blocks inside POST /orders, which costs nothing
visible and everything real: an API create logs one childless audit row, so those
blocks have no readable ids under any key. slotTeamsForOrder returned [] for every
order the engine ever made, the in-place amendment declined on all of them, and
every crew change a client asked for became a note asking a human to apply it —
43 patches and 0 amendments across 34 threads.

The order is now created with SlotTeam: [] and each block posted separately,
because POST /slotTeams returns the id it creates. The ids are obtained by
creating them, never by reading them back.

If a block fails to post, the order is DELETED rather than returned half-built.
happening defaults to NOW on a blockless order and only corrects once a block
exists, so the leftover would sit in the ops view as a job happening today with no
crew. Nothing references a seconds-old order, so removing it is safe; a rollback
that itself fails says so and names the order.

Costs N+1 calls per create instead of 1.
EOF
```

---

### Task 5: Amendment resolves blocks by stored id, not by position

**Files:**
- Modify: `app/lib/engine/amendOrder.ts:147-180`
- Test: `test/amendByStoredId.ts` (create)

**Interfaces:**
- Consumes: `ConversationState.last_ordered_team_ids`
- Produces: `amendOrderInPlace(client, args & { known?: { job_id?: number; team_ids?: number[] } }, hooks)`

- [ ] **Step 1: Write the failing test**

Create `test/amendByStoredId.ts`:

```typescript
// ============================================================================
// An amendment addresses the blocks the engine created, by id.
// ----------------------------------------------------------------------------
// amendOrderInPlace read the live blocks from /timelineAudits. That read returns
// NOTHING for an order created through the API (reference §12), so the amendment
// declined on every order the engine has made. With the ids stored at create
// time it does not need the read at all.
//
// The second case is the one that matters longest: a human adds a block in the
// OnSinch UI. Position-pairing shifts and overwrites the wrong block on a 201.
// Owning ids means the engine patches only what it created and cannot touch the
// human's block.
//
// Run: npx tsx test/amendByStoredId.ts
// ============================================================================
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "build", profession_id: 1, size: 3, place_id: 49,
  beginning: "2027-11-10T08:00:00+00:00", end: "2027-11-10T14:00:00+00:00", ...o,
});
const desiredOf = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: "X @ Y", company_id: 515, user_id: 1591, request_approval: true,
  provisional: true, quote: false, pricelist_category_id: 122, job_name: "X @ Y",
  slot_teams: teams,
});
const hooks = { onCreated: async () => {} };  // the real AmendHooks member

/** A transport where the AUDIT READ IS EMPTY, as it is for every engine order. */
function transport(sink: any[]): Transport {
  return async (method, path, body) => {
    sink.push({ method, path, body });
    if (method === "GET" && path.startsWith("/timelineAudits")) return { status: 200, data: { data: [] } };
    if (method === "GET" && path.startsWith("/orders"))
      return { status: 200, data: { data: [{ id: 9001, company_id: 515, provisional: true, Job: [{ id: 4001 }] }] } };
    if (method === "GET" && path.startsWith("/attendance")) return { status: 200, data: { data: [] } };
    if (method === "PATCH" && path === "/slotTeams") return { status: 204, data: null };
    if (method === "POST" && path === "/slotTeams") return { status: 201, data: { data: [{ id: 999 }] } };
    return { status: 200, data: null };
  };
}

async function main() {
  console.log("stored ids make an engine order amendable at all");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      {
        order_id: 9001,
        previous: [team(), team({ name: "derig", size: 2, beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" })],
        desired: desiredOf([team({ size: 5 }), team({ name: "derig", size: 2, beginning: "2027-11-10T18:00:00+00:00", end: "2027-11-10T22:00:00+00:00" })]),
        known: { job_id: 4001, team_ids: [701, 702] },
      },
      hooks
    );
    ok(!res.declined, "it does not decline despite an empty audit read", res.declined ?? "");
    ok(res.amended?.patched === 1, "one block was patched", JSON.stringify(res.amended));
    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/slotTeams");
    ok(patch?.body?.[0]?.id === 701, "and it targeted the STORED id", JSON.stringify(patch?.body));
    ok(patch?.body?.[0]?.size === 5, "with the new size");
    ok(!calls.some((c) => String(c.path).startsWith("/timelineAudits")),
       "the audit read was not even attempted");
  }

  console.log("\na count mismatch in our OWN record declines");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      { order_id: 9001, previous: [team(), team({ name: "derig" })],
        desired: desiredOf([team({ size: 5 })]),
        known: { job_id: 4001, team_ids: [701] } },   // one id for two previous blocks
      hooks
    );
    ok(!!res.declined, "declined rather than guessing which block the id belongs to", res.declined ?? "(did not decline)");
    ok(!calls.some((c) => c.method === "PATCH"), "and nothing was written");
  }

  console.log("\nno stored ids: the audit read is still used");
  {
    const calls: any[] = [];
    const res = await amendOrderInPlace(
      new OnsinchClient(transport(calls)),
      { order_id: 9001, previous: [team()], desired: desiredOf([team({ size: 5 })]) },
      hooks
    );
    ok(calls.some((c) => String(c.path).startsWith("/timelineAudits")),
       "a UI-raised order still reads the audit trail");
    ok(!!res.declined, "and declines when that read is empty, exactly as before", res.declined ?? "");
  }
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx test/amendByStoredId.ts`
Expected: FAIL — `known` is not a parameter, so the first block declines on the empty
audit read.

- [ ] **Step 3: Implement**

In `app/lib/engine/amendOrder.ts`, extend the `args` type with:

```typescript
    /**
     * What the engine recorded when it CREATED this order — the job id and one slot-team
     * id per block, in the order they were written.
     *
     * Present for every order created after id custody shipped. When it is present the
     * audit read is skipped entirely, because for those orders the read returns nothing:
     * an API create logs one childless row (reference §12). Absent for UI-raised orders
     * and for everything created before, which still fall through to the audit read.
     */
    known?: { job_id?: number; team_ids?: number[] };
```

Replace the audit read and `live` derivation with:

```typescript
  /**
   * OUR OWN RECORD OUTRANKS THE AUDIT LOG, because for an engine-created order the audit
   * log holds nothing to outrank. Where ids were stored at create time they are used
   * directly; the name comes from `previous`, which is by definition what we wrote.
   *
   * This also narrows what an amendment can touch, which is the point. The engine patches
   * only ids it created, so a block a human added in the OnSinch UI is invisible to it and
   * cannot be overwritten. Under position-pairing that block shifted every later index and
   * the overwrite landed on the wrong one, reported as a 201.
   */
  const stored = args.known?.team_ids;
  let live: Array<{ id: number; name: string }>;
  let job_id: number | undefined;

  if (stored && stored.length) {
    if (stored.length !== previous.length) {
      // Our own two records disagree. Which id belongs to which block is then a guess,
      // and a wrong guess silently doubles or misplaces crew, so the rebuild takes it.
      return {
        declined:
          `order #${order_id}: ${stored.length} stored slot-team id(s) for ${previous.length} recorded block(s) — ` +
          `cannot say which id is which`,
      };
    }
    live = stored.map((id, i) => ({ id, name: capSlotTeamName(previous[i]).name }));
    job_id = args.known?.job_id;
    /**
     * `done` is NOT excluded here, and must not be. It holds ids a previous attempt
     * APPENDED, which by definition are not in the array recorded at create time — the
     * pipeline only extends that array once an amendment succeeds. So there is nothing
     * of `done` in `live` to filter out, and filtering would be a no-op that reads as a
     * safeguard. The audit-read branch below does need it, because the live read returns
     * appended blocks too.
     */
  } else {
    const read = await client.slotTeamsForOrder(order_id);
    live = done.length ? read.teams.filter((t) => !done.includes(t.id)) : read.teams;
    job_id = read.job_id;
  }
```

Then replace the two later uses of `read.job_id` with `job_id`.

- [ ] **Step 4: Run the tests**

Run: `npx tsx test/amendByStoredId.ts` → all PASS
Run: `npx tsx test/amendInPlace.ts` → still all PASS (the audit-read path is unchanged)
Run: `npx tsc --noEmit` → clean

- [ ] **Step 5: Commit**

```bash
git add app/lib/engine/amendOrder.ts test/amendByStoredId.ts
git commit -F- <<'EOF'
An amendment addresses the blocks the engine created, by id

amendOrderInPlace resolved live blocks through /timelineAudits, which returns
nothing for an order created via the API — so it declined on every order this
engine has made and no crew change has ever reached OnSinch in place.

Where the create recorded the ids, they are used and the audit read is skipped.
Orders raised in the OnSinch UI, and everything created before custody existed,
still fall through to the audit read unchanged.

This also NARROWS what an amendment may touch, which is the reason to prefer ids
over position rather than a side effect: the engine patches only ids it created,
so a block a human adds in the UI is invisible to it. Pairing by position shifted
every later index when that happened and overwrote the wrong block, on a 201 that
reported success.

When the stored id count disagrees with the recorded block count it declines and
the rebuild takes over, because which id belongs to which block is then a guess.
EOF
```

---

### Task 6: The pipeline stores the ids on create and passes them on amendment

**Files:**
- Modify: `app/lib/engine/pipeline.ts:38` (`Executor.createOrder` return type)
- Modify: `app/lib/engine/pipeline.ts:704-718` (create branch)
- Modify: `app/lib/engine/pipeline.ts:388-470` (`tryAmendInPlace`)
- Test: `test/idCustody.ts` (extend)

**Interfaces:**
- Consumes: `createOrderWithPlace` returning `{ id, number?, job_id, team_ids }`
- Produces: `next.last_ordered_team_ids` written on create and after a successful amendment

- [ ] **Step 1: Write the failing test**

Append to `test/idCustody.ts`:

```typescript
console.log("\nthe pipeline keeps the ids, and keeps them after an amendment appends one");
{
  const src = readFileSync(join(ROOT, "app/lib/engine/pipeline.ts"), "utf8");
  ok(/next\.last_ordered_team_ids\s*=\s*created\.team_ids/.test(src),
     "the create branch stores the ids the create returned");
  ok(/known:\s*\{[^}]*team_ids:\s*next\.last_ordered_team_ids/s.test(src),
     "tryAmendInPlace passes the stored ids to amendOrderInPlace");
  // An appended block's id must join the record, or the NEXT amendment loses custody of
  // it and silently falls back to the audit read, which is empty.
  ok(/last_ordered_team_ids\s*=\s*\[[^\]]*res\.amended\.added/s.test(src),
     "and an appended block's id is added to the record");
}
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx tsx test/idCustody.ts`
Expected: three FAILs.

- [ ] **Step 3: Widen the Executor type**

`app/lib/engine/pipeline.ts:38`:

```typescript
  createOrder(order: NonNullable<Actions["createOrder"]>): Promise<{
    id: number;
    number?: string;
    /** The job the crew blocks hang off, so an amendment can append to it. */
    job_id?: number;
    /**
     * One slot-team id per block, in the order written. Optional because a test executor
     * or an older stored order may not have them, and the amendment falls back to the
     * audit read when they are missing.
     */
    team_ids?: number[];
  }>;
```

- [ ] **Step 4: Store them in the create branch**

In the `intended.kind === "create"` branch, after `next.last_ordered_teams = …`:

```typescript
      // The ids, beside the blocks they belong to. Without these the amendment on the
      // next email has nothing to address and declines to the rebuild.
      next.last_ordered_team_ids = created.team_ids ?? [];
```

- [ ] **Step 5: Pass them on amendment, and extend them after one**

In `tryAmendInPlace`, at the `amendOrderInPlace` call, add to its args:

```typescript
      known: { job_id: next.onsinch_job_id, team_ids: next.last_ordered_team_ids },
```

And in the success branch, beside `next.last_ordered_teams = …`:

```typescript
      /**
       * An APPENDED block's id joins the record. Miss this and the next amendment sees
       * fewer stored ids than recorded blocks, declines on the mismatch, and the rebuild
       * destroys an order that was perfectly amendable.
       */
      next.last_ordered_team_ids = [
        ...(next.last_ordered_team_ids ?? []),
        ...(res.amended.added ?? []),
      ];
```

- [ ] **Step 6: Run everything**

Run: `npx tsx test/idCustody.ts` → all PASS
Run: `npx tsc --noEmit` → clean
Run: `npx tsx test/all.ts` → all files pass
Run: `npx tsx sim/run.ts` → 100/100

- [ ] **Step 7: Commit**

```bash
git add app/lib/engine/pipeline.ts test/idCustody.ts
git commit -F- <<'EOF'
A crew change reaches the order it belongs to

The create now records one slot-team id per block and the amendment reads them,
so a resize, a moved window, a new venue, a changed profession or an added block
is applied to the order that exists. Before this every one of them became a note
asking a human to do it by hand: 43 patches and 0 in-place amendments across 34
threads, because PATCH /orders is top-level only and carries no crew field.

An APPENDED block's id joins the record on success. Without that the next
amendment finds fewer stored ids than recorded blocks, declines on the mismatch,
and the rebuild destroys an order that was amendable.

Dropping a block is unchanged and still costs the order and its R number: OnSinch
has no way to remove a slot team, verified six ways (API reference §12).
EOF
```

---

### Task 7: Prove the whole loop against the live tenant

Unit tests cannot cover this. The thing being relied on is OnSinch's behaviour, and the
one field that can be read back — the Job window — is derived from the blocks and so
cannot lie about one still existing.

**Files:**
- Create: `scripts/verify-custody-live.ts`

- [ ] **Step 1: Write the script**

```typescript
// ============================================================================
// The custody loop, against the live tenant. TEST company 515 only, hardcoded.
// ----------------------------------------------------------------------------
// Creates an order the new way, amends it in place, and PROVES the amendment
// landed by reading the Job window — which is derived from the order's blocks
// and is therefore the only field that cannot lie about them. Size, profession,
// place and name are ACCEPTED (204) and unreadable; that asymmetry is permanent.
//
//   npx tsx scripts/verify-custody-live.ts --write
// ============================================================================
import { OnsinchClient, httpTransport } from "../app/lib/engine/onsinch";
import { amendOrderInPlace } from "../app/lib/engine/amendOrder";
import { createOrderWithPlace } from "../app/lib/deps";
import type { DesiredOrder, DesiredSlotTeam } from "../app/lib/engine/types";
import { loadEnv, onsinchBase } from "./_env.mjs";

loadEnv();
if (!process.argv.includes("--write")) {
  console.log("read-only by default. Pass --write to create one order on TEST 515.");
  process.exit(0);
}

const COMPANY = 515, USER = 1591, RATE = 122, PLACE = 49, DAY = "2027-11-10";
const L = "CUSTODY VERIFY - safe to delete";
const client = new OnsinchClient(httpTransport({ baseUrl: onsinchBase(), apiKey: (process.env.ONSINCH_API_KEY || "").trim() }));

let fails = 0;
const ok = (c: boolean, label: string, extra = "") => {
  if (!c) fails++;
  console.log(`  ${c ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};
const team = (o: Partial<DesiredSlotTeam> = {}): DesiredSlotTeam => ({
  name: "build", profession_id: 1, size: 3, place_id: PLACE,
  beginning: `${DAY}T08:00:00+00:00`, end: `${DAY}T14:00:00+00:00`, ...o,
});
const derig = team({ name: "derig", size: 2, beginning: `${DAY}T18:00:00+00:00`, end: `${DAY}T22:00:00+00:00` });
const orderOf = (teams: DesiredSlotTeam[]): DesiredOrder => ({
  name: L, company_id: COMPANY, user_id: USER, request_approval: true,
  provisional: true, quote: false, pricelist_category_id: RATE, job_name: L, slot_teams: teams,
});
const windowOf = async (id: number) => {
  const live: any = await client.orderById(id);
  const o = live?.data ?? live;
  const job = (Array.isArray(o?.Job) ? o.Job[0] : o?.Job) ?? {};
  return `${String(job?.min_beginning).slice(11, 16)}-${String(job?.max_end).slice(11, 16)}`;
};

(async () => {
  const created = await createOrderWithPlace(client, orderOf([team(), derig]));
  console.log(`order ${created.id} job ${created.job_id} teams ${JSON.stringify(created.team_ids)}`);
  ok(created.team_ids.length === 2, "the create handed back one id per block");
  ok(await windowOf(created.id) === "08:00-22:00", "both blocks are live", await windowOf(created.id));

  // The read that used to be the only route, on an order created this way.
  const read = await client.slotTeamsForOrder(created.id);
  ok(read.teams.length === 0, "the audit read is still empty — custody is what makes this work");

  // Move the LATE block's window: the one change the window can prove.
  const res = await amendOrderInPlace(
    client,
    { order_id: created.id, previous: [team(), derig],
      desired: orderOf([team(), team({ name: "derig", size: 2, beginning: `${DAY}T18:00:00+00:00`, end: `${DAY}T20:00:00+00:00` })]),
      known: { job_id: created.job_id, team_ids: created.team_ids } },
    { onCreated: async () => {} }
  );
  ok(!res.declined && !res.refused, "the amendment ran", res.declined ?? res.refused ?? "");
  const after = await windowOf(created.id);
  ok(after === "08:00-20:00", "PROVEN: the window shrank to the amended end time", after);

  console.log(`\nleaving order ${created.id} for inspection — delete it when done`);
  process.exit(fails ? 1 : 0);
})();
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-custody-live.ts --write`
Expected: every line PASS, and the final window `08:00-20:00`.

- [ ] **Step 3: Delete the verification order in OnSinch, then commit**

```bash
git add scripts/verify-custody-live.ts
git commit -m "One command proves the custody loop against the live tenant"
```

---

### Task 8: Retire the stale reasoning the old design left behind

**Files:**
- Modify: `docs/Spartan-Crew-Onsinch-API-Reference.md` §12 and the §10 id-custody entry
- Modify: `docs/AMEND-IN-PLACE-PLAN.md` (the position-pairing rationale)
- Modify: `app/lib/engine/amendOrder.ts` (the header's "by position" explanation)

- [ ] **Step 1: Update the three explanations**

Each currently says block resolution is by position *because ids are unavailable*. That
premise is gone. State instead that resolution is by stored id, that position survives
only as the fallback for UI-raised orders, and keep the warning about what position does
when a human adds a block — it is the reason ids are preferred.

Mark the §10 entry "State row should store owned slot-team ids" **DONE**, and in §12
replace "Not implemented" with the commit that implemented it.

- [ ] **Step 2: Run the suite and commit**

```bash
npx tsx test/all.ts
git add docs/ app/lib/engine/amendOrder.ts
git commit -m "Block resolution is by stored id; position is the fallback, not the design"
```

---

## Rollout

No feature flag. The change is additive by construction: an order with no stored ids
behaves exactly as today, so nothing already in flight changes behaviour. Existing orders
are **not** migrated — their ids were never recorded and cannot be recovered, so they keep
taking the rebuild path for the rest of their lives.

After deploying, confirm on the first real amendment:

```
select meta from metric_events where kind='order_updated' order by ts desc limit 5;
```

`in_place: true` appearing for the first time is the signal. It has never appeared — 0 of
48 to date.

## What this plan does not do

- **Dropping a block.** Still `DELETE /orders` + re-POST, still costs the R number.
- **The stuck threads** (13793, 13783, 13795) which point at orders a human deleted and
  re-raised by hand. All 7 `replace-refused` entries are these. Custody removes the churn
  that creates the situation but does not re-point an existing ticket.
- **`verify-shrink-staffed.ts`** (item B2). That needs slot ids, not slot-team ids, and
  slot ids appear only in a UI or service-key create's audit trail. Unchanged.
