// ============================================================================
// A LIVE BINDING IS PERMANENT — EXCEPT WHERE THE THREAD NAMES A DIFFERENT ORDER.
// ----------------------------------------------------------------------------
// Ben, 2026-09-13: "An order that was turned into a job and matched should then be
// permanently associated with that thread", and "never skip a fresh check when jobs or to
// confirm orders still exist." Those pull in opposite directions the moment a binding is
// wrong, and the compiler resolves them the narrow way: the fresh check CONFIRMS the
// bound order still exists and otherwise leaves it alone. Re-deriving a live binding on
// every pass could only ever move it off a settled decision.
//
// That makes a wrong binding permanent too. Measured against all 265 live bindings on
// 2026-09-14, exactly one thread carries evidence strong enough to overturn its own:
//
//   #13841  subject "Price quote - R10687 Delta Live - BBC PROMS 53 @ RAH - 26.8."
//           bound to R10688 — PROMS 54 @ Various, a different show at a different venue,
//           created five minutes later. PROMS 54 still exists, so the fresh check keeps
//           it, and without this rule the thread amends the wrong show forever.
//
// A thread naming its own order number is the same class of evidence as a stated date
// change — the thread asserting a fact about its own job — and it is the ONLY signal
// allowed to move a live binding. Everything else waits for the order to disappear.
//
// Ben, 2026-09-14: "Threads will likely NEVER directly name an R number, dont expect to
// find it in an order, though for consistency in code we can look for it." So this path
// fires on 16 of 265 bindings. It is a bonus, and the guards below are what stop a bonus
// becoming a hazard.
//
// Run: npx tsx test/rebindOnStatedRNumber.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient } from "../app/lib/engine/onsinch";
import type { ConversationState, HydratedThread } from "../app/lib/engine/types";
import { mockReasoner, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

/**
 * The date the fixture reasoner extracts. The orders have to sit on it or nothing binds,
 * which is also why the subjects below drop the "- 26.8." the real thread carries — the
 * fixture reasoner would read it as a second date and the disagreement is noise here.
 */
const DAY = "2026-03-09";
/** Delta Live's two BBC Proms orders, same client, same day, five minutes apart. */
const PROMS_53 = { id: 13839, number: "10687", happening: `${DAY}T08:00:00+00:00`, name: "Delta Live - BBC PROMS 53 @ RAH", Job: [{ id: 9001 }] };
const PROMS_54 = { id: 13841, number: "10688", happening: `${DAY}T08:00:00+00:00`, name: "Delta Live - BBC PROMS 54 @ Various", Job: [{ id: 9002 }] };

function onsinchWith(orders: unknown[]) {
  return new OnsinchClient(async (method, path) => {
    const page = (data: unknown[]) => ({
      status: 200 as const,
      data: { data, pagination: { count: data.length, pageCount: 1, nextPage: false } },
    });
    if (method !== "GET") return { status: 204, data: null };
    if (path.startsWith("/orders")) return page(orders);
    if (path.startsWith("/companies"))
      return page([{ id: 42, name: "Delta Live", invoice_name: "Delta Live", Client: [{ id: 1337, email: "p@deltalive.co.uk", name: "Pat" }] }]);
    if (path.startsWith("/places")) return page([{ id: 88, name: "Royal Albert Hall", address: "kensington gore", city: "london", country: "GB" }]);
    return page([]);
  });
}

/** A thread already bound to PROMS 54, which is the state the live system is in. */
const boundToProms54 = (): ConversationState =>
  ({
    thread_id: "T-13841",
    onsinch_order_id: PROMS_54.id,
    onsinch_order_number: PROMS_54.number,
    onsinch_job_id: 9002,
    company_id: 42,
    facts: { requests: [{ date: DAY, start_time: "08:00", end_time: "18:00", size: 4 }] },
  }) as unknown as ConversationState;

const thread = (subject: string, body: string): HydratedThread => ({
  thread_id: "T-13841",
  messages: [msg({ message_id: "m1", from: "p@deltalive.co.uk", subject, body })],
});

const deps = (orders: unknown[]) =>
  ({ reasoner: mockReasoner, onsinch: onsinchWith(orders), now: () => 1, repliesEnabled: false }) as never;

(async () => {
  const { __resetListCache } = await import("../app/lib/engine/onsinch");

  console.log("\n[1] the thread names R10687 while bound to R10688 — it is rebound");
  {
    __resetListCache();
    const { state } = await compile(
      thread("Re: Price quote - R10687 Delta Live - BBC PROMS 53 @ RAH", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53, PROMS_54])
    );
    ok(Number(state.onsinch_order_id) === PROMS_53.id, "bound to the order its own subject names", `#${state.onsinch_order_id}`);
    ok(state.onsinch_order_number === "10687", "and carries that R number", String(state.onsinch_order_number));
    ok(Number(state.onsinch_job_id) === 9001, "and that order's job, not the old one", String(state.onsinch_job_id));
    ok(
      (state.notes ?? []).some((n: string) => n.includes("rebinding")),
      "and says why, because a binding moving on its own is otherwise invisible",
      JSON.stringify(state.notes)
    );
  }

  console.log("\n[2] the same thread with no number named leaves the binding alone");
  {
    // The 83% case. Nothing about the shape is consulted, so a crew change to a thread
    // bound to the wrong order stays on the wrong order — which is correct, because the
    // alternative is re-deriving every binding on every pass.
    __resetListCache();
    const { state } = await compile(
      thread("Re: Crew for Wednesday", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53, PROMS_54])
    );
    ok(Number(state.onsinch_order_id) === PROMS_54.id, "the binding is untouched", `#${state.onsinch_order_id}`);
  }

  console.log("\n[3] the three guards — each one on its own leaves the binding alone");
  {
    // A number naming an order this client does not hold. The commonest shape of a
    // wrong number: a reference copied out of an older quote, or a supplier's own ref.
    __resetListCache();
    const a = await compile(
      thread("Re: our ref R99999", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53, PROMS_54])
    );
    ok(Number(a.state.onsinch_order_id) === PROMS_54.id, "a number no order carries changes nothing", `#${a.state.onsinch_order_id}`);

    // A number naming an order on a day this thread does not ask for. Last year's job.
    __resetListCache();
    const OLD = { id: 7000, number: "10687", happening: "2025-03-09T08:00:00+00:00", name: "Delta Live @ RAH", Job: [{ id: 6000 }] };
    const b = await compile(
      thread("Re: same as R10687 last year", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([OLD, PROMS_54])
    );
    ok(Number(b.state.onsinch_order_id) === PROMS_54.id, "a number on a day the thread never asks for changes nothing", `#${b.state.onsinch_order_id}`);

    // Two numbers. A quote reply listing several jobs picks none of them.
    __resetListCache();
    const c = await compile(
      thread("Re: quotes for R10687 and R10688", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53, PROMS_54])
    );
    ok(Number(c.state.onsinch_order_id) === PROMS_54.id, "two numbers decide nothing", `#${c.state.onsinch_order_id}`);

    // "Repeat of R10687" names the order this job is a COPY of, deliberately not the one
    // the thread is about. Rebinding to it would put a new booking's crew on an old job.
    __resetListCache();
    const d = await compile(
      thread("Re: Repeat of R10687", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53, PROMS_54])
    );
    ok(Number(d.state.onsinch_order_id) === PROMS_54.id, "'Repeat of' changes nothing", `#${d.state.onsinch_order_id}`);
  }

  console.log("\n[4] a binding whose order is GONE is released, not kept");
  {
    // The other half of the fresh check, and the common one: staff delete our To Confirm
    // order and raise their own job. 100 of 139 scored bindings are in this state.
    __resetListCache();
    const { state } = await compile(
      thread("Re: Crew for Wednesday", "Can we make that 6 crew please."),
      boundToProms54(),
      deps([PROMS_53]) // PROMS 54 is gone; only PROMS 53 remains that day
    );
    ok(Number(state.onsinch_order_id) === PROMS_53.id, "it re-matches onto the order that is there", `#${state.onsinch_order_id}`);
    ok(
      (state.notes ?? []).some((n: string) => n.includes("no longer exists")),
      "and records that the old one went",
      JSON.stringify(state.notes)
    );
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
