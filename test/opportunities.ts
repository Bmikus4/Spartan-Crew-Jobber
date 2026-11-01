// ============================================================================
// All Opportunities (lib/feed/opportunities.ts, the owner, 1 Nov): every conversation, the TV's urgent jobs among them.
// ----------------------------------------------------------------------------
// Pinned: every card the TV lists is an opportunity, carried whole (one projection, never two lists kept in step);
// each opportunity is a stored Gmail thread, with its linked R and J; a thread with nothing asked is in All and not on
// the TV; the detail is the whole conversation in order with each email's decision; the route is guarded and writes
// nothing; the Live Feed switches Urgent and All (Urgent by default, never on the TV) and a tile opens its
// conversation; the Jobs Board, its setting and its route are gone.
// npx tsx --require ./test/fixtures/pg.ts test/opportunities.ts
// ============================================================================
import { existsSync, readFileSync } from "node:fs";
import { sql } from "./fixtures/pg";
import { ensureSchema } from "../app/lib/migrations";
import { serveFeed } from "../app/lib/feed/serve";
import { liveFeedDeps } from "../app/lib/feed/live";
import { listOpportunities, opportunityDetail } from "../app/lib/feed/opportunities";

let fails = 0;
const ok = (c: boolean, m: string, d?: unknown) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}${c ? "" : "  " + JSON.stringify(d)}`); if (!c) fails++; };
const NOW = Date.parse("2026-10-28T12:00:00Z");

(async () => {
  await ensureSchema(sql as any);
  const msg = (id: string, thread: string, at: string, from: string, ours: boolean, body: string) =>
    sql`INSERT INTO thread_messages (message_id, thread_id, from_address, date_iso, subject, body, is_from_spartan) VALUES (${id}, ${thread}, ${from}, ${at}, 'Crew for the 4th', ${body}, ${ours})`;
  const decide = (id: string, thread: string, at: string, kind: string, decision: unknown, grounded: unknown) =>
    sql`INSERT INTO v2_decisions (message_id, thread_id, from_address, sent_at, kind, decision, interpretation, code_version, created_at)
      VALUES (${id}, ${thread}, 'ops@north.example', ${at}, ${kind}, ${JSON.stringify(decision)}::jsonb, ${JSON.stringify({ grounded })}::jsonb, 'abc', ${at})`;
  // A change on R11001 (a need: on the TV), with our reply; and a thanks on another thread (nothing asked).
  await msg("a1", "ta", "2026-10-28T09:00:00Z", "Ops <ops@north.example>", false, "Can we add 2 crew on the 4th please?\n\nOn Mon, 26 Oct 2026, Spartan wrote:\n> booked");
  await msg("a2", "ta", "2026-10-28T09:30:00Z", "Bookings <bookings@spartancrew.co.uk>", true, "Thanks, on it.");
  await decide("a1", "ta", "2026-10-28T09:00:00Z", "handoff", { kind: "handoff", reasons: ["a person adds it"], ops: [] }, { intent: "change", requests: [{ action: "change_crew", date: "2026-11-04", crew: 6, problems: [] }] });
  await msg("b1", "tb", "2026-10-27T10:00:00Z", "Ops <ops@north.example>", false, "Thanks, all good.");
  await decide("b1", "tb", "2026-10-27T10:00:00Z", "none", { kind: "none", reason: "nothing asked" }, { intent: "info_only", requests: [] });
  await sql`INSERT INTO onsinch_contacts (email, company_id, company_name, name, refreshed_at) VALUES ('ops@north.example', 7, 'North Events', 'Ops', now())`;
  await sql`INSERT INTO onsinch_orders (order_id, number, company_id, body, read_at) VALUES (1, '11001', 7, ${JSON.stringify({ id: 1, number: "11001", Job: [{ id: 10, SlotTeam: [] }] })}::jsonb, now())`;
  await sql`INSERT INTO job_links (thread_id, order_id, r_number, job_id, state, source, proof) VALUES ('ta', 1, '11001', 10, 'linked', 'planner', 'R11001')`;

  const deps = { ...liveFeedDeps(), jobs: undefined };
  console.log("\n[1] every TV card is an opportunity, carried whole");
  {
    const tv = await serveFeed({ ...deps, remember: undefined }, NOW);
    const cards = ((tv.body as any).items ?? []) as any[];
    const all = await listOpportunities(sql as any, deps, NOW);
    ok(all.ok && cards.length >= 1, "the TV lists the need and All is read", { tv: cards.length });
    const items = all.ok ? all.items : [];
    ok(cards.every((c) => items.some((o) => o.thread_id === c.thread_id && JSON.stringify(o.urgent) === JSON.stringify(c))), "each TV card is in All, the card itself", cards.map((c) => c.thread_id));
    const a = items.find((o) => o.thread_id === "ta"), b = items.find((o) => o.thread_id === "tb");
    ok(a?.state === "urgent" && items[0].thread_id === "ta", "the urgent job leads, as the TV orders it", items.map((o) => [o.thread_id, o.state]));
    ok(a?.r_number === "R11001" && a?.j_number === "J10", "its R and J are the thread's link", a);
    ok(a?.messages === 2 && a?.replied === true, "it is the stored Gmail thread: 2 emails, one ours", a);
    ok(b?.state === "info" && !b?.urgent, "a thanks is in All, and not urgent", b);
  }

  console.log("\n[2] the conversation in full");
  {
    const d = await opportunityDetail(sql as any, "ta");
    ok(d.messages.map((m) => m.message_id).join() === "a1,a2" && d.messages[0].body.includes("On Mon, 26 Oct 2026"), "every email in order, each body whole (quoted history kept, folded by the screen)", d.messages.map((m) => m.message_id));
    ok(d.decisions.length === 1 && d.decisions[0].message_id === "a1" && d.decisions[0].requests[0].action === "change_crew", "each client email's decision beside it", d.decisions);
  }

  console.log("\n[3] the route, the screen, and the Jobs Board gone");
  {
    const route = readFileSync("app/api/opportunities/route.ts", "utf8");
    const lib = readFileSync("app/lib/feed/opportunities.ts", "utf8");
    ok(route.indexOf("authorizeAction") >= 0 && route.indexOf("authorizeAction") < route.indexOf("listOpportunities(sql") && /status: 401/.test(route), "guarded before anything is read");
    ok(!/INSERT|UPDATE|DELETE/.test(route + lib) && /remember: undefined/.test(lib) && /status: 500/.test(route), "it writes nothing, and a failed read is a 500");
    const feed = readFileSync("app/components/LiveFeedScreen.tsx", "utf8");
    ok(/useState<"urgent" \| "all">\("urgent"\)/.test(feed) && /\{!tv && \(\s*<div className="seg"/.test(feed), "the Live Feed opens on Urgent, and the switch is not on the office TV");
    ok(/onOpen=\{tv \? undefined : openInAll\}/.test(feed) && /aria-label="Open in All Opportunities"/.test(feed), "an Urgent tile opens its conversation in All Opportunities (not on the TV)");
    ok(!existsSync("app/components/JobsScreen.tsx") && !existsSync("app/api/jobs/route.ts"), "the Jobs Board screen and its route are deleted");
    const shell = readFileSync("app/components/AppShell.tsx", "utf8") + readFileSync("app/components/Sidebar.tsx", "utf8") + readFileSync("app/components/SettingsScreen.tsx", "utf8") + readFileSync("app/lib/onsinch/types.ts", "utf8");
    ok(!/jobs_board_enabled|JobsScreen|"jobs"/.test(shell), "no rail item, setting or screen for it is left");
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
})();
