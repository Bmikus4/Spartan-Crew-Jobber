// ============================================================================
// A vanished order names the order that replaced it.
// ----------------------------------------------------------------------------
// Five live threads sit at needs-info reading "crew/time change NOT applied —
// order #15588 no longer exists in OnSinch — not recreating it blindly". The
// message is true and it is useless: it sends a person to look for an order that
// has been deleted.
//
// Measured on the live tenant 2026-09-03: of the 54 recorded ids that read back
// absent, 24 have a PRESENT order for the SAME company on the SAME day, raised
// by a named person, with an id and an R number one or two off ours. Three of
// the five stranded threads are in that set — #15588 -> #15590 (user 413),
// #15578 -> #15585, #13783 -> #13784. Ops re-key the engine's order and the
// original goes.
//
// So the refusal now spends one read to name the live order. It STILL REFUSES:
// re-pointing a thread at an order a person raised is a business ruling
// (DECISIONS.md D6), and nothing here writes.
//
// What is proven:
//   NAMES IT    same company + same day -> the id, the R number and who raised it
//   DAY IS A KEY a same-company order on another day is NOT offered. Dropping the
//               day filter would confidently name a stranger's booking, because
//               the company alone matches whatever that client last booked.
//   NEVER ITSELF the dead id is never offered back as its own successor
//   NO KEYS     no company or no day -> not even a lookup is attempted
//   FAIL SOFT   a lookup that throws degrades to the old message, never a crash
//   VERBATIM    the original sentence is unchanged, because ops read it on the
//               board and test/replaceOrder.ts asserts it
//
// Fixtures only: a fake transport. Nothing reaches OnSinch.
//
// Run: npx tsx test/orderReplacedByHand.ts
// ============================================================================
import { OnsinchClient } from "../app/lib/engine/onsinch";
import { preflightOrder } from "../app/lib/engine/orderPreflight";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const PREFIX = "no longer exists in OnSinch — not recreating it blindly";

type Row = Record<string, unknown>;

/**
 * A fake OnSinch that answers by id and by company separately, and records every
 * path asked for, so "no lookup was attempted" is assertable rather than assumed.
 */
function fake(opts: { byId?: Row | null; byCompany?: Row[]; throwOnCompany?: boolean } = {}) {
  const paths: string[] = [];
  const t = async (method: string, path: string) => {
    paths.push(`${method} ${path}`);
    if (/company_id/.test(path)) {
      if (opts.throwOnCompany) throw new Error("GET /orders -> 500");
      return { status: 200, data: { data: opts.byCompany ?? [] } };
    }
    return { status: 200, data: { data: opts.byId ? [opts.byId] : [] } };
  };
  return { client: new OnsinchClient(t as never), paths };
}

const DEAD = 15588;

// tsx transforms these files to CJS, where top-level await is a syntax error, so the
// whole suite is wrapped the way test/replaceOrder.ts wraps its own.
async function main() {
  const ARGS = { order_id: DEAD, company_id: 713, happening_day: "2026-09-02T09:00:00+01:00" };

  console.log("\n[1] a re-keyed order is named, with its R number and who raised it");
  {
    const { client, paths } = fake({
      byId: null,
      byCompany: [{ id: 15590, number: "10740", happening: "2026-09-02T08:00:00+00:00", creator: 413 }],
    });
    const r = await preflightOrder(client, ARGS);
    ok(!!r.refused, "still refused — naming is not adopting");
    ok(r.live === undefined, "and no live order is handed back");
    ok(r.refused!.includes(PREFIX), "the original sentence is unchanged", PREFIX);
    ok(r.refused!.includes("#15590"), "names the replacement id");
    ok(r.refused!.includes("R10740"), "names its R number");
    ok(r.refused!.includes("user 413"), "names who raised it");
    ok(r.refused!.includes("2026-09-02"), "and the day it is for");
    ok(paths.some((p) => /company_id/.test(p)), "one company read was made", String(paths.length) + " calls");
  }

  console.log("\n[2] THE DAY IS A KEY — a same-client order on another day is not offered");
  {
    const { client } = fake({
      byId: null,
      byCompany: [{ id: 15999, number: "10999", happening: "2026-11-30T08:00:00+00:00", creator: 413 }],
    });
    const r = await preflightOrder(client, ARGS);
    ok(r.refused === `order #${DEAD} ${PREFIX}`, "the bare message, with nothing invented", r.refused);
    ok(!r.refused!.includes("15999"), "the client's other booking is NOT named");
  }

  console.log("\n[3] the dead order is never offered back as its own successor");
  {
    // The filter being ignored by the server is a real failure mode on this API, so
    // the dead id appearing in its own company list must not become "found it".
    const { client } = fake({
      byId: null,
      byCompany: [{ id: DEAD, number: "10738", happening: "2026-09-02T08:00:00+00:00", creator: 413 }],
    });
    const r = await preflightOrder(client, ARGS);
    ok(r.refused === `order #${DEAD} ${PREFIX}`, "itself is not a replacement", r.refused);
  }

  console.log("\n[4] the highest id wins when the client has two orders that day");
  {
    const { client } = fake({
      byId: null,
      byCompany: [
        { id: 15590, number: "10740", happening: "2026-09-02T08:00:00+00:00", creator: 413 },
        { id: 15594, number: "10744", happening: "2026-09-02T08:00:00+00:00", creator: 2714 },
      ],
    });
    const r = await preflightOrder(client, ARGS);
    ok(r.refused!.includes("#15594"), "the later row is the replacement", r.refused);
    ok(!r.refused!.includes("#15590"), "the earlier one is not named");
  }

  console.log("\n[5] the day can also come from the Job's own window");
  {
    const { client } = fake({
      byId: null,
      byCompany: [{ id: 15590, number: "10740", happening: null, Job: [{ min_beginning: "2026-09-02T08:00:00+00:00" }], creator: 413 }],
    });
    const r = await preflightOrder(client, ARGS);
    ok(r.refused!.includes("#15590"), "matched on Job.min_beginning when happening is null", r.refused);
  }

  console.log("\n[6] no keys means no lookup is even attempted");
  {
    for (const [label, args] of [
      ["no company_id", { order_id: DEAD, happening_day: "2026-09-02T09:00:00+01:00" }],
      ["no day", { order_id: DEAD, company_id: 713 }],
    ] as const) {
      const { client, paths } = fake({ byId: null, byCompany: [{ id: 15590, number: "10740", happening: "2026-09-02T08:00:00+00:00", creator: 413 }] });
      const r = await preflightOrder(client, args);
      ok(r.refused === `order #${DEAD} ${PREFIX}`, `${label}: the bare message`, r.refused);
      ok(!paths.some((p) => /company_id/.test(p)), `${label}: no company read was wasted`);
    }
  }

  console.log("\n[7] a lookup that fails degrades to the old message rather than throwing");
  {
    const { client } = fake({ byId: null, throwOnCompany: true });
    let threw = false;
    let r: Awaited<ReturnType<typeof preflightOrder>> | null = null;
    try { r = await preflightOrder(client, ARGS); } catch { threw = true; }
    ok(!threw, "preflight did not throw");
    ok(r?.refused === `order #${DEAD} ${PREFIX}`, "and the refusal is the one it always was", r?.refused);
  }

  console.log("\n[8] an order that DOES exist is unaffected — no successor read at all");
  {
    const { client, paths } = fake({ byId: { id: DEAD, company_id: 713, provisional: false } });
    const r = await preflightOrder(client, ARGS);
    ok(!!r.live && r.live.id === DEAD, "the live order is returned");
    ok(r.refused === undefined, "nothing is refused");
    ok(!paths.some((p) => /company_id/.test(p)), "and no company lookup was made");
  }

  console.log("\n[9] another client's order is still refused for that reason, not this one");
  {
    const { client } = fake({ byId: { id: DEAD, company_id: 999 } });
    const r = await preflightOrder(client, ARGS);
    ok(/belongs to company 999/.test(String(r.refused)), "the company mismatch wins", r.refused);
    ok(!String(r.refused).includes(PREFIX), "and is not confused with a vanished order");
  }


  console.log(fails ? `\n${fails} FAILED\n` : "\nall passed\n");
process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
