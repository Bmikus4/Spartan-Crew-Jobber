// ============================================================================
// Every write on OnsinchClient must fail loudly, and no write may be exempt.
// ----------------------------------------------------------------------------
// THREE SEPARATE DEFECTS ON 2026-08-27 WERE ONE BUG WEARING THREE COATS: the result
// of a call was never checked against what the call claimed to do.
//
//   replaceOrder   claimed the order was replaced   deleted it, then could not re-post
//   createCompany  claimed the client was created   had never once succeeded
//   createPlace    claimed the venue was created    never read the status; a 400 gave undefined
//
// Two of the three only surfaced when a gate above them was lifted, because a gate does
// not merely stop bad writes — it hides untested ones. The rate-card hold had been
// concealing createCompany since the method was written.
//
// So this asserts the contract itself rather than any one method: for every write, a
// non-2xx throws, and a 2xx that carries no id throws instead of handing back undefined.
// A caller that stores `undefined` as an order id has lost the booking and been told the
// booking succeeded, which is strictly worse than an error.
//
// THE TABLE IS CHECKED AGAINST THE CLASS, NOT MAINTAINED BY HAND. Any method named
// create*/patch*/delete* that is absent from CASES fails this file. That is the whole
// point: the three defects above were all in code nobody had thought to cover, and a
// hand-kept list of what to cover would have had the same hole in it. Adding a write
// method to the client and forgetting it here is now a red test, not a silent gap.
//
// Offline and free — the transport is injected, so nothing here touches the tenant.
//
// Run: npx tsx test/writeContract.ts
// ============================================================================
import { OnsinchClient } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

/** A client whose every call answers with exactly this. */
const clientAnswering = (status: number, data: unknown) =>
  new OnsinchClient((async () => ({ status, data })) as never);

/** Run `fn` and return the thrown message, or "" if it did not throw. */
async function threw(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

/**
 * One row per write method. `call` must be an invocation that passes the method's own
 * argument validation, so that what is under test is the RESPONSE handling and not the
 * guard in front of it — deleteOrders([]) throws before it ever sends, which would make
 * this file pass while proving nothing.
 *
 * `yieldsId` marks the creates: the ones whose return value a caller stores and later
 * writes against. Those must additionally refuse a 2xx that carries no id.
 */
const CASES: Array<{
  name: string;
  yieldsId: boolean;
  call: (c: OnsinchClient) => Promise<unknown>;
}> = [
  { name: "createPlace", yieldsId: true, call: (c) => c.createPlace({ name: "Some Venue" }) },
  { name: "createCompany", yieldsId: true, call: (c) => c.createCompany({ name: "Some Client Ltd." }) },
  {
    name: "createOrder",
    yieldsId: true,
    call: (c) => c.createOrder([{ name: "Job", company_id: 1 } as never]),
  },
  {
    name: "createSlotTeam",
    yieldsId: true,
    call: (c) => c.createSlotTeam({ name: "Crew", size: 2, job_id: 1 } as never),
  },
  { name: "patchOrder", yieldsId: false, call: (c) => c.patchOrder([{ id: 1, name: "Renamed" }]) },
  { name: "patchSlotTeams", yieldsId: false, call: (c) => c.patchSlotTeams([{ id: 1, size: 3 }]) },
  { name: "patchJob", yieldsId: false, call: (c) => c.patchJob([{ id: 1, pricelist_category_id: 311 }]) },
  { name: "deleteOrders", yieldsId: false, call: (c) => c.deleteOrders([1]) },
  { name: "deletePlaces", yieldsId: false, call: (c) => c.deletePlaces([1]) },
];

(async () => {
  console.log("\n[1] no write method escapes this file");
  {
    /**
     * Derived from the prototype, so the list cannot drift from the code. The naming
     * convention is the contract: a method that creates, patches or deletes says so in
     * its name, and if a future write is named otherwise this assertion is the wrong
     * guard — but a wrong guard that has to be edited beats a right guard nobody runs.
     */
    const written = Object.getOwnPropertyNames(OnsinchClient.prototype).filter((m) =>
      /^(create|patch|delete|update|put|post)/.test(m)
    );
    const covered = new Set(CASES.map((c) => c.name));
    const uncovered = written.filter((m) => !covered.has(m));
    ok(
      uncovered.length === 0,
      "every create/patch/delete on the client has a row in CASES",
      uncovered.length ? `MISSING: ${uncovered.join(", ")}` : `${written.length} methods`
    );
    // And the reverse, so a renamed method leaves a dead row rather than a silent hole.
    const stale = [...covered].filter((m) => !written.includes(m));
    ok(stale.length === 0, "and no row names a method that no longer exists", stale.join(", "));
  }

  console.log("\n[2] a rejection throws, and says which call was rejected");
  for (const { name, call } of CASES) {
    // 400 with the shape OnSinch actually returns. The message must carry the method
    // name because these errors reach a ticket a human reads, and "400" alone sent
    // someone hunting through four candidate writes on 2026-08-27.
    const msg = await threw(() =>
      call(clientAnswering(400, { validationErrors: { 0: ["Fill in company city"] } }))
    );
    ok(msg !== "", `${name}: a 400 throws`, msg ? "" : "RETURNED NORMALLY");
    ok(new RegExp(name).test(msg), `${name}: names itself in the message`, msg.slice(0, 80));
  }

  console.log("\n[3] a 500 throws — a server that will not say what it did is not a success");
  for (const { name, call } of CASES) {
    /**
     * The transport retries some 500s (measured 17% on POST /orders under concurrency 4),
     * and that retry lives BELOW this layer. By the time a 500 reaches the client it has
     * already exhausted its budget, so treating it as anything but a failure would turn a
     * lost booking into a booking the ledger believes in.
     */
    const msg = await threw(() => call(clientAnswering(500, { message: "Internal Server Error" })));
    ok(msg !== "", `${name}: a 500 throws`, msg ? "" : "RETURNED NORMALLY");
  }

  console.log("\n[4] a 2xx carrying no id throws instead of returning undefined");
  for (const { name, yieldsId, call } of CASES.filter((c) => c.yieldsId)) {
    void yieldsId;
    /**
     * THE SHAPE THAT MATTERS. A 201 with an empty `data` array is not hypothetical —
     * it is what a caller sees when a write is accepted and nothing is made, and the
     * old code handed back `undefined`. The order id then went into the ledger as
     * undefined, every later amendment matched nothing, and the engine reported success.
     */
    const empty = await threw(() => call(clientAnswering(201, { data: [] })));
    ok(empty !== "", `${name}: 201 with an empty data array throws`, empty ? "" : "RETURNED undefined");

    // No `data` key at all — the shape that used to produce a raw TypeError, which is a
    // throw, but one that names a property instead of the failed booking.
    const missing = await threw(() => call(clientAnswering(201, {})));
    ok(missing !== "", `${name}: 201 with no data key throws`, missing ? "" : "RETURNED undefined");
    ok(
      !/Cannot read propert|undefined is not/.test(missing),
      `${name}: and it is the engine's error, not a TypeError`,
      missing.slice(0, 80)
    );

    // An object present but idless: accepted, made nothing, said so in the only way it can.
    const idless = await threw(() => call(clientAnswering(201, { data: [{ name: "X" }] })));
    ok(idless !== "", `${name}: 201 with an idless record throws`, idless ? "" : "RETURNED an idless object");
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
