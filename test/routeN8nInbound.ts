// ============================================================================
// SP-12: a delivery the engine cannot read is reported, not silently kept.
// ----------------------------------------------------------------------------
// n8n sends each message once. If a workflow edit changes the payload shape, every
// delivery was answered 200 "kept for contract alignment" and nothing was processed or
// reported: intake stops with every dashboard green. Drives the real handler with its
// IO injected; nothing here touches a database or the network.
//
// Offline.  npx tsx test/routeN8nInbound.ts
// ============================================================================
import { handleInbound, type InboundIO } from "../app/lib/n8nInbound";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

function rig() {
  const reports: Array<{ route: string; where: string }> = [];
  const ran: string[] = [];
  const decided: string[] = [];
  const io: InboundIO = {
    capture: (async () => ({ ok: true, captured: true, dedup_key: "k-1", thread_id: null, message_id: null, messages_stored: 0 })) as InboundIO["capture"],
    report: (async (a: { route: string; where: string }) => { reports.push({ route: a.route, where: a.where }); return false; }) as InboundIO["report"],
    decide: (async (id: string) => { decided.push(id); return { message_id: id, decision: { kind: "none", reason: "test" } }; }) as InboundIO["decide"],
    buildDeps: (async () => ({ settings: {} })) as unknown as InboundIO["buildDeps"],
    handleThread: (async (t: { thread_id: string }) => { ran.push(t.thread_id); return { thread_id: t.thread_id, notes: [] }; }) as unknown as InboundIO["handleThread"],
    upsertTicket: async () => {},
    onThrew: async () => {},
  };
  return { io, reports, ran, decided };
}
const post = (body: unknown) => new Request("http://localhost/api/n8n-inbound", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

async function main() {
  const prior = process.env.INTAKE_PATH;
  const priorEngine = process.env.SPARTAN_ENGINE;
  delete process.env.INTAKE_PATH;
  delete process.env.SPARTAN_ENGINE;
  try {
    console.log("\n[1] a payload of the wrong shape: 200, kept, and reported once");
    {
      const r = rig();
      const res = await handleInbound(post({ foo: 1 }), r.io);
      ok(res.status === 200, "answered 200, so n8n does not retry for hours", String(res.status));
      ok(r.reports.length === 1, "exactly one report", String(r.reports.length));
      ok(r.reports[0]?.route === "mail-undeliverable", "on the mail-undeliverable route", r.reports[0]?.route);
      ok(r.ran.length === 0, "and the engine did not run");
    }

    console.log("\n[2] control: a well-formed thread runs the engine and reports nothing");
    {
      const r = rig();
      const res = await handleInbound(post({ thread_id: "t1", messages: [{ message_id: "m1", from: "a@b.c", to: ["bookings@spartancrew.co.uk"], date_iso: "2026-10-04T10:00:00Z", subject: "Crew", body: "4 crew please" }] }), r.io);
      ok(res.status === 200 && r.ran.join() === "t1", "the engine ran on it", `${res.status} ${r.ran.join()}`);
      ok(r.reports.length === 0, "and nothing was reported", String(r.reports.length));
    }

    console.log("\n[3] SPARTAN_ENGINE=v2: the rebuild decides on the polled message; the old engine never runs");
    process.env.SPARTAN_ENGINE = "v2";
    const thread = { thread_id: "t2", messages: [
      { message_id: "old", from: "a@b.c", to: [], date_iso: "2026-10-01T10:00:00Z", subject: "Crew", body: "4 crew please" },
      { message_id: "new", from: "a@b.c", to: [], date_iso: "2026-10-04T10:00:00Z", subject: "Re: Crew", body: "make it 5" },
    ] };
    {
      const r = rig();
      const res = await handleInbound(post({ ...thread, n8n: { latest_message_id: "old" } }), r.io);
      const body = await res.json();
      ok(res.status === 200 && r.decided.join() === "old", "decided on n8n.latest_message_id, not the thread's newest", `${res.status} ${r.decided.join()}`);
      ok(r.ran.length === 0, "the old engine did not run");
      ok(body.engine === "v2" && body.decision === "none", "the decision is in the answer", JSON.stringify(body));
    }
    {
      const r = rig();
      await handleInbound(post(thread), r.io);
      ok(r.decided.join() === "new", "without latest_message_id: the thread's newest message", r.decided.join());
    }
    {
      const r = rig();
      r.io.decide = (async () => { throw new Error("openrouter 502"); }) as InboundIO["decide"];
      const res = await handleInbound(post(thread), r.io);
      ok(res.status === 500 && r.reports[0]?.route === "engine-threw" && r.ran.length === 0, "a failed decision is reported, and does not fall back to the old engine", `${res.status} ${r.reports[0]?.route} ${r.ran.join()}`);
    }
    {
      const r = rig();
      const res = await handleInbound(post({ foo: 1 }), r.io);
      ok(res.status === 200 && r.decided.length === 0 && r.reports[0]?.route === "mail-undeliverable", "a delivery naming no message is reported, nothing decided", `${res.status} ${r.reports[0]?.route}`);
    }
    delete process.env.SPARTAN_ENGINE;
  } finally {
    if (priorEngine === undefined) delete process.env.SPARTAN_ENGINE; else process.env.SPARTAN_ENGINE = priorEngine;
    if (prior === undefined) delete process.env.INTAKE_PATH; else process.env.INTAKE_PATH = prior;
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
