// ============================================================================
// SP-12: a delivery the engine cannot read is reported, not silently kept.
// ----------------------------------------------------------------------------
// n8n sends each message once. If a workflow edit changes the payload shape, every
// delivery was answered 200 "kept for contract alignment" and nothing was processed or
// reported: intake stops with every dashboard green. Drives the real handler with its
// IO injected; nothing here touches a database or the network.
//
// Offline.  npx tsx --require ./test/fixtures/pg.ts test/routeN8nInbound.ts
// ============================================================================
import { handleInbound, type InboundIO } from "../app/lib/n8nInbound";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** The handler's IO, with capture reporting `stored` as the messages this delivery added. */
function rig(stored: string[] = []) {
  const reports: Array<{ route: string; where: string }> = [];
  const decided: string[] = [];
  const io: InboundIO = {
    capture: (async () => ({ ok: true, captured: true, dedup_key: "k-1", thread_id: "old", message_id: "old", messages_stored: stored.length, new_message_ids: stored })) as InboundIO["capture"],
    report: (async (a: { route: string; where: string }) => { reports.push({ route: a.route, where: a.where }); return false; }) as InboundIO["report"],
    decide: (async (ids: string[]) => { decided.push(`[${ids.join()}]`); return ids.map((id) => ({ message_id: id, decision: { kind: "none" as const, reason: "test" } })); }) as InboundIO["decide"],
    storeOnly: async () => {},
  };
  return { io, reports, decided };
}
const post = (body: unknown) => new Request("http://localhost/api/n8n-inbound", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
// n8n.latest_message_id is the Gmail thread id, i.e. the FIRST message (measured 10-09).
const thread = { thread_id: "old", n8n: { latest_message_id: "old" }, messages: [
  { message_id: "old", from: "a@b.c", to: [], date_iso: "2026-08-14T10:00:00Z", subject: "PO", body: "PO for an event" },
  { message_id: "new", from: "a@b.c", to: [], date_iso: "2026-10-09T09:18:00Z", subject: "Re: PO", body: "make it 5" },
] };

async function main() {
  delete process.env.SPARTAN_PAUSED;

  console.log("\n[1] a payload of the wrong shape: 200, kept, and reported once");
  {
    const r = rig();
    const res = await handleInbound(post({ foo: 1 }), r.io);
    ok(res.status === 200, "answered 200, so n8n does not retry for hours", String(res.status));
    ok(r.reports.length === 1, "exactly one report", String(r.reports.length));
    ok(r.reports[0]?.route === "mail-undeliverable", "on the mail-undeliverable route", r.reports[0]?.route);
    ok(r.decided.length === 0, "and nothing was decided", r.decided.join());
  }

  console.log("\n[2] a well-formed thread: the engine decides on what the delivery stored new, and nothing is reported");
  {
    const r = rig(["new"]);
    const res = await handleInbound(post(thread), r.io);
    const body = await res.json();
    ok(res.status === 200 && r.decided.join() === "[new]", "decided on the newly stored message, not n8n's (first-message) id", `${res.status} ${r.decided.join()}`);
    ok(body.engine === "v2" && body.decided?.[0]?.decision === "none", "the decision is in the answer", JSON.stringify(body));
    ok(r.reports.length === 0, "and nothing was reported", String(r.reports.length));
  }
  {
    const r = rig([]);
    const res = await handleInbound(post(thread), r.io);
    ok(res.status === 200 && r.decided.join() === "[]", "a re-post stores nothing new, so nothing is decided", r.decided.join());
  }

  console.log("\n[3] failures answer 500 and are reported");
  {
    const r = rig(["new"]);
    r.io.decide = (async () => { throw new Error("openrouter 502"); }) as InboundIO["decide"];
    const res = await handleInbound(post(thread), r.io);
    ok(res.status === 500 && r.reports[0]?.route === "engine-threw", "a failed decision", `${res.status} ${r.reports[0]?.route}`);
  }
  {
    const r = rig();
    r.io.capture = (async () => ({ ok: false, captured: false, dedup_key: "k-3", thread_id: "old", message_id: null, messages_stored: 0, new_message_ids: [] })) as InboundIO["capture"];
    const res = await handleInbound(post(thread), r.io);
    ok(res.status === 500 && r.decided.length === 0 && r.reports[0]?.route === "mail-undeliverable", "a failed capture, with nothing decided", `${res.status} ${r.reports[0]?.route}`);
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
