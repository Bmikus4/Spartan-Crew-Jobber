// ============================================================================
// FOUR LABELS, AND NEVER TWO AT ONCE.
// ----------------------------------------------------------------------------
// Ben, 2026-09-13: the system may produce four labels and only four — Order Built,
// Order Updated, Order Needs Built, Order Needs Updated. They are a terminal signal, not
// a queue: a person reads one off a thread and knows where that booking stands.
//
// THE FAILURE CASE IS TWO OF THEM. A thread wearing both "Order Built" and "Order Needs
// Built" says the work is simultaneously done and outstanding, and the one thing a label
// must never do is claim work is outstanding when it is done. Gmail's modify endpoint
// takes addLabelIds AND removeLabelIds in one call, so exclusivity is expressible in a
// single request and there is no window where a thread wears two.
//
// This replaces the n8n "Spartan Engine — Manual Tag" workflow. The DECISION already
// lived in pipeline.ts; only the carrying-out was outside the codebase, behind a Gmail
// OAuth credential that has been dead since 2026-09-09.
//
// Offline. Gmail is a stub.  npx tsx test/gmailWrite.ts
// ============================================================================
import { applyThreadLabel, clearThreadLabel, draftMime, THE_FOUR, __resetLabelCache } from "../app/lib/mail/gmailWrite";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** A Gmail that already holds the four labels, recording every write. */
function stub(existing: string[] = THE_FOUR.slice()) {
  const calls: Array<{ path: string; body: any }> = [];
  const labels = existing.map((name, i) => ({ id: `L${i + 1}`, name }));
  const api = async (method: string, path: string, body?: any) => {
    calls.push({ path, body });
    if (method === "GET" && path === "labels") return { labels };
    if (method === "POST" && path === "labels") {
      const made = { id: `NEW${labels.length + 1}`, name: body?.name };
      labels.push(made);
      return made;
    }
    if (method === "POST" && /threads\/.+\/modify/.test(path)) return { id: "t1" };
    if (method === "POST" && path === "drafts") return { id: "draft-1", message: { id: "m1" } };
    throw new Error(`stub has no route for ${method} ${path}`);
  };
  return { api, calls, labels };
}

async function main() {
  console.log("\n[1] applying one of the four REMOVES the other three, in one call");
  {
    __resetLabelCache();
    const g = stub();
    await applyThreadLabel(g.api, "t1", "Order Built");
    const mod = g.calls.find((c) => /modify/.test(c.path))!;
    ok(!!mod, "the thread was modified");
    ok(mod.body.addLabelIds.length === 1, "exactly one label added", JSON.stringify(mod.body.addLabelIds));
    ok(mod.body.removeLabelIds.length === 3, "and the other three removed", JSON.stringify(mod.body.removeLabelIds));
    // One request, so there is no instant where the thread wears two of them.
    ok(g.calls.filter((c) => /modify/.test(c.path)).length === 1, "in a single request, not four");
  }

  console.log("\n[2] every one of the four behaves the same way");
  {
    for (const name of THE_FOUR) {
      __resetLabelCache();
      const g = stub();
      await applyThreadLabel(g.api, "t1", name as any);
      const mod = g.calls.find((c) => /modify/.test(c.path))!;
      const added = g.labels.find((l) => l.id === mod.body.addLabelIds[0])!;
      ok(added.name === name, `${name} is the one added`, added.name);
      ok(!mod.body.removeLabelIds.includes(mod.body.addLabelIds[0]), "and it is not also removed");
    }
  }

  console.log("\n[3] a missing label is created once, then cached");
  {
    __resetLabelCache();
    const g = stub(["Order Built"]);          // the other three do not exist yet
    await applyThreadLabel(g.api, "t1", "Order Needs Built");
    const created = g.calls.filter((c) => c.path === "labels" && c.body?.name);
    ok(created.length === 3, "the three absent labels were created", String(created.length));

    const before = g.calls.length;
    await applyThreadLabel(g.api, "t2", "Order Needs Built");
    const listed = g.calls.slice(before).filter((c) => c.path === "labels");
    ok(listed.length === 0, "a second thread re-lists nothing — the ids are cached", String(listed.length));
  }

  console.log("\n[4] a label is never invented outside the four");
  {
    __resetLabelCache();
    const g = stub();
    let threw = "";
    try { await applyThreadLabel(g.api, "t1", "Manual" as any); } catch (e) { threw = String((e as Error).message); }
    ok(/only four|not one of/i.test(threw), "anything else is refused", threw.slice(0, 70));
    ok(g.calls.every((c) => !/modify/.test(c.path)), "and nothing was written");
  }

  console.log("\n[5] the thread id is Gmail's, not ours");
  {
    // Our ids are prefixed `gmail:` so they cannot collide with the webhook intake's.
    // Sending that prefix to Gmail addresses a thread that does not exist.
    __resetLabelCache();
    const g = stub();
    await applyThreadLabel(g.api, "gmail:abc123", "Order Built");
    const mod = g.calls.find((c) => /modify/.test(c.path))!;
    ok(mod.path === "threads/abc123/modify", "the prefix is stripped before Gmail sees it", mod.path);
  }

  console.log("\n[6] a draft is a real RFC 822 reply, on the thread it answers");
  {
    const mime = draftMime({
      to: "pier@redbeast.co.uk",
      from: "bookings@spartancrew.co.uk",
      subject: "Re: Crew for Friday",
      html: "<p>Yes — 4 crew, 08:00.</p>",
      inReplyTo: "<abc@mail.example>",
    });
    ok(/^To: pier@redbeast\.co\.uk/m.test(mime), "addressed to the client");
    ok(/^Subject: Re: Crew for Friday/m.test(mime), "carries the subject");
    ok(/^In-Reply-To: <abc@mail\.example>/m.test(mime), "and In-Reply-To, which is what threads it");
    ok(/^References: <abc@mail\.example>/m.test(mime), "and References, which older clients thread on instead");
    ok(/Content-Type: text\/html/i.test(mime), "sent as html");
    ok(mime.includes("Yes"), "with the body in it");
  }

  console.log("\n[7] a draft with no parent is still valid, and threads on nothing");
  {
    const mime = draftMime({ to: "a@b.com", from: "bookings@spartancrew.co.uk", subject: "Hello", html: "<p>Hi</p>" });
    ok(!/In-Reply-To/.test(mime), "no In-Reply-To invented");
    ok(!/References/.test(mime), "and no References");
    ok(/^To: a@b\.com/m.test(mime), "but it is still a sendable message");
  }

  console.log("\n[8] clearing takes one off and puts NOTHING on");
  {
    // A thread may legitimately end up wearing none of the four — a conversation that
    // turned out not to be a job. Filling the gap with a replacement would be the engine
    // asserting a conclusion it has not reached.
    __resetLabelCache();
    const g = stub();
    await clearThreadLabel(g.api, "gmail:t9", "Order Needs Built");
    const mod = g.calls.find((c) => /modify/.test(c.path))!;
    ok(mod.body.addLabelIds.length === 0, "nothing added", JSON.stringify(mod.body.addLabelIds));
    ok(mod.body.removeLabelIds.length === 1, "exactly the one label removed", JSON.stringify(mod.body.removeLabelIds));
    ok(mod.path === "threads/t9/modify", "and the prefix is stripped here too", mod.path);
  }

  console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}

main();
