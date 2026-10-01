// ============================================================================
// DOES THE HARNESS WORK? Attacked rather than reviewed.
// ----------------------------------------------------------------------------
// Every accuracy number this repo has had to withdraw looked exactly like a good
// one. A 98.7% self-match that was 45.9% on real queries; four corpus metrics
// measuring themselves; a gate reading 100% because the scripted reasoner answered
// from the case's own truth; an amend stub that always declined and scored the
// refusal against the engine. None of those is visible by reading the number, so
// this file tries to produce a green run from a broken engine and fails if it can.
//
//   npx tsx audit/selftest.mts
//
// It is FREE and it runs in seconds. Run it before believing audit/run.mts.
// ============================================================================
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { baseTenant, invariants, SCENARIOS, type Check, type Ctx } from "./scenarios.mts";
import { buildRig, deliver, email, scriptedReasoner } from "./harness.mts";
import type { ThreadMessage } from "../app/lib/engine/types";
import type { FakeTenant } from "./tenant.mts";

const HERE = dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
};

const EXCEL = "ExCeL London, Royal Victoria Dock, 1 Western Gateway, London E16 1XL";
const START = Date.parse("2026-10-05T09:00:00Z");
const enquiry = (body?: string): ThreadMessage =>
  email(
    {
      subject: "Crew for the 12th",
      from: "ops@redbeast.co.uk",
      body: body ?? `Hi | Company: RedBeast Energy | Venue: ${EXCEL} | BLOCK: 2026-11-12 08:00-18:00, 6 crew, stand build`,
    },
    START,
    1
  );

/** Run one scenario against a tenant the caller may have sabotaged. */
async function runScenario(id: string, sabotage?: (t: FakeTenant) => void): Promise<Check[]> {
  const s = SCENARIOS.find((x) => x.id === id)!;
  const { tenant } = baseTenant();
  sabotage?.(tenant);
  let rig = buildRig(tenant, { settings: { replies_enabled: true } });
  const checks: Check[] = [];
  const ctx = {
    tenant,
    get rig() {
      return rig;
    },
    checks,
    check(label: string, okk: boolean, detail?: string) {
      checks.push({ label, ok: okk, detail });
    },
    say: (tid: string, m: ThreadMessage[]) => deliver(rig, tid, m),
    rebuild(opts: Parameters<typeof buildRig>[1]) {
      rig = buildRig(tenant, { settings: { replies_enabled: true }, ...opts });
    },
  } as Ctx;
  try {
    await s.run(ctx);
  } catch (err: any) {
    checks.push({ label: "ran to completion", ok: false, detail: String(err?.message ?? err) });
  }
  checks.push(...(await invariants(tenant, rig)));
  return checks;
}

console.log("=".repeat(78));
console.log("HARNESS SELF-TEST — can a broken engine produce a green run?");
console.log("=".repeat(78));

// ---------------------------------------------------------------------------
console.log("\n[1] the scripted model cannot see the answer it is being scored against");
{
  const src = readFileSync(join(HERE, "harness.mts"), "utf8");
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  ok(!/from ["']\.\/scenarios\.mts["']/.test(noComments), "harness.mts does not import the scenarios");
  ok(!/expect|assert|invariant/i.test(noComments.split("export interface Spies")[0]), "the reasoner half names no expectation");
  // The stronger form: hand the reasoner a message and confirm its answer depends only
  // on the text. Two identical bodies under different thread ids must agree.
  const { reasoner } = scriptedReasoner();
  const a = await reasoner.classifyAndExtract!(enquiry(), [], false);
  const b = await reasoner.classifyAndExtract!({ ...enquiry(), message_id: "other" }, [], false);
  ok(JSON.stringify(a) === JSON.stringify(b), "the same text gives the same answer whatever thread it is in");
  const c = await reasoner.classifyAndExtract!(enquiry("Hi | just saying thanks"), [], false);
  ok(c.classification !== a.classification, "different text gives a different answer", `${a.classification} vs ${c.classification}`);
}

// ---------------------------------------------------------------------------
console.log("\n[2] nothing leaves this process");
{
  for (const k of ["ONSINCH_API_KEY", "DATABASE_URL", "POSTGRES_URL", "GMAIL_DRAFT_WEBHOOK", "GMAIL_SA_CLIENT_EMAIL", "OPENROUTER_API_KEY"]) {
    ok(!String(process.env[k] ?? "").trim(), `${k} is not set`);
  }
  ok(String(process.env.SPARTAN_ERROR_NOTIFY ?? "") !== "1" && !String(process.env.VERCEL ?? "").trim(),
     "the error reporter cannot email anybody (notifyAllowed is false)");
  const realFetch = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    reached++;
    throw new Error(`the audit made a network call: ${String(args[0])}`);
  }) as typeof fetch;
  try {
    const { tenant } = baseTenant();
    const rig = buildRig(tenant, { settings: { replies_enabled: true } });
    await deliver(rig, "NET", [enquiry()]);
    ok(reached === 0, "a full enquiry ran with zero network calls", `${reached} call(s)`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------------------------------------------------------------------------
console.log("\n[3] a known-good scenario passes");
{
  const checks = await runScenario("N2");
  ok(checks.every((x) => x.ok), "N2 is green on an unsabotaged tenant", checks.filter((x) => !x.ok).map((x) => x.label).join("; "));
}

// ---------------------------------------------------------------------------
console.log("\n[4] a known-BAD engine is caught — the assertions check the booking, not the call");
{
  // OnSinch takes the order and quietly books half the crew. Every HTTP status is a
  // success, the thread is `ordered`, and the client is short four people. If the suite
  // cannot see this, it is checking that functions returned.
  const halved = await runScenario("N1", (t) => {
    const real = t.transport;
    t.transport = async (m, p, b) => {
      if (m === "POST" && p === "/orders") {
        const body = (b as any[])?.[0];
        body.SlotTeam = (body.SlotTeam ?? []).map((s: any) => ({ ...s, size: Math.max(1, Math.floor(s.size / 2)) }));
      }
      return real(m, p, b);
    };
  });
  ok(halved.some((x) => !x.ok), "the suite goes red when the tenant books half the crew",
     halved.filter((x) => !x.ok).map((x) => x.label).join("; "));

  // A silent wrong result with every status 200: the order lands on ANOTHER client.
  const misfiled = await runScenario("X1", (t) => {
    const real = t.transport;
    const wrong = t.companies.find((x) => x.name === "Meridian Energy Solutions")!.id;
    t.transport = async (m, p, b) => {
      if (m === "POST" && p === "/orders") (b as any[])[0].company_id = wrong;
      return real(m, p, b);
    };
  });
  ok(misfiled.some((x) => !x.ok), "the suite goes red when the order lands on the wrong client",
     misfiled.filter((x) => !x.ok).map((x) => x.label).join("; "));

  // The rate card is dropped — OnSinch's silent default, which I1 exists to prevent.
  const cardless = await runScenario("N1", (t) => {
    const real = t.transport;
    t.transport = async (m, p, b) => {
      if (m === "POST" && p === "/orders") (b as any[])[0].Job.pricelist_category_id = 0;
      return real(m, p, b);
    };
  });
  ok(cardless.some((x) => !x.ok && x.invariant), "the rate-card invariant fires when the card is dropped",
     cardless.filter((x) => !x.ok).map((x) => x.label).join("; "));
}

// ---------------------------------------------------------------------------
console.log("\n[5] the forbidden-side-effect detectors actually fire");
{
  // Two threads claiming one order must trip I3, and the durable record must refuse.
  const { tenant } = baseTenant();
  const rig = buildRig(tenant, { settings: { replies_enabled: true } });
  await deliver(rig, "one", [enquiry()]);
  await deliver(rig, "two", [{ ...enquiry(), message_id: "z1", subject: "Same job, other thread" }]);
  const checks = await invariants(tenant, rig);
  const i3 = checks.find((x) => x.label.startsWith("I3"));
  ok(i3 !== undefined && !i3.ok, "I3 fires when two threads point at one order", i3?.detail ?? "it did not fire");
  /**
   * I8 did NOT fire here, and that is a fact about the engine rather than about the
   * detector: the cross-thread hold returns from `handleThread` BEFORE
   * `ensureOrderRecord` is reached, so the second thread never tries to claim the row
   * and the contract the guard protects is never tested on that path. The detector is
   * therefore proved by calling the dependency directly.
   */
  ok(checks.find((x) => x.label.startsWith("I8"))!.ok, "the held path never reaches the durable record (reported, not a harness fault)");
  const rec = {
    order_id: 424242, job_id: null, order_number: null, sender_email: null, sender_domain: null,
    place_id: null, shape_sent: {}, id_source: "api_response" as const, verified_at: null,
  };
  ok((await rig.deps.ensureOrderRecord!({ ...rec, thread_id: "first" })) === true, "a first claim on an order is accepted");
  ok((await rig.deps.ensureOrderRecord!({ ...rec, thread_id: "second" })) === false, "a second thread's claim is refused");
  const contested = await invariants(tenant, rig);
  const i8 = contested.find((x) => x.label.startsWith("I8"));
  ok(i8 !== undefined && !i8.ok, "I8 fires when the durable record is contested", i8?.detail ?? "it did not fire");
}
{
  // A crew mismatch nobody declared must trip I4; a declared one must NOT.
  const { tenant } = baseTenant();
  const rig = buildRig(tenant, { settings: { replies_enabled: true } });
  const s = await deliver(rig, "silent", [enquiry()]);
  const order = tenant.order(Number(s.onsinch_order_id))!;
  tenant.teamsOf(order.id)[0].size = 1; // somebody shrank it and nothing said so
  s.needs_human = false;
  s.status = "ordered";
  s.notes = [];
  await rig.store.put(s);
  const checks = await invariants(tenant, rig);
  const i4 = checks.find((x) => x.label.startsWith("I4"));
  ok(i4 !== undefined && !i4.ok, "I4 fires on an undeclared crew mismatch", i4?.detail ?? "it did not fire");
  s.needs_human = true;
  await rig.store.put(s);
  const after = await invariants(tenant, rig);
  ok(after.find((x) => x.label.startsWith("I4"))!.ok, "I4 does NOT fire once the thread declares it");
}
{
  // An orphan order — one nothing points at — must trip I5.
  const { tenant } = baseTenant();
  const rig = buildRig(tenant, { settings: { replies_enabled: true } });
  const s = await deliver(rig, "orphan", [enquiry()]);
  s.onsinch_order_id = undefined;
  s.status = "ordered";
  s.notes = ["no longer exists"];
  await rig.store.put(s);
  const checks = await invariants(tenant, rig);
  ok(!checks.find((x) => x.label.startsWith("I5"))!.ok, "I5 fires on an order no thread points at");
}
{
  // A duplicated venue must trip I6.
  const { tenant } = baseTenant();
  const rig = buildRig(tenant, { settings: { replies_enabled: true } });
  tenant.addPlace({ name: "ExCeL London" });
  const checks = await invariants(tenant, rig);
  ok(!checks.find((x) => x.label.startsWith("I6"))!.ok, "I6 fires on a duplicated venue");
}

// ---------------------------------------------------------------------------
console.log("\n[6] the fault injector really injects");
{
  const { tenant } = baseTenant();
  tenant.faults.push({ match: (m, p) => m === "POST" && p === "/orders", times: 99, mode: "status", status: 400, data: { validationErrors: { x: ["no"] } } });
  const rig = buildRig(tenant, { settings: { replies_enabled: true } });
  const s = await deliver(rig, "F", [enquiry()]);
  ok(!tenant.orders.some((o) => o.origin === "api"), "a 400 on POST /orders really stops the order being made");
  ok(s.status === "error", "and the thread records it", s.status);
}

// ---------------------------------------------------------------------------
console.log("\n[7] the run is deterministic — two runs of one scenario agree exactly");
{
  const a = await runScenario("S1");
  const b = await runScenario("S1");
  ok(
    a.map((x) => `${x.label}:${x.ok}`).join("|") === b.map((x) => `${x.label}:${x.ok}`).join("|"),
    "S1 gives an identical verdict twice"
  );
}

console.log("\n" + "=".repeat(78));
console.log(fails ? `${fails} SELF-TEST FAILURE(S) — do not trust audit/run.mts until these are green` : "SELF-TEST CLEAN — the harness catches what it claims to catch");
console.log("=".repeat(78));
process.exit(fails ? 1 : 0);
