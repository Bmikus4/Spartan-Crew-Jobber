// ============================================================================
// The same client on the same day is never, on its own, a reason to link.
// ----------------------------------------------------------------------------
// Ben, 2026-10-03: "the engine should not link an enquiry to an existing order for the
// same client on the same day, and that be the only reason it does it", and "every single
// deduplication should get an AI step, with reinforced deterministic steps".
//
// The rule it replaces (matchExistingOrder) linked a sole same-day order on the date
// alone: 57 of the 90 link decisions in the engine's notes. A client's second job that day
// then rewrote the first job's crew and times. [7] is that case end to end.
//
// Offline, with a fake model.  npx tsx test/linkJudge.ts
// ============================================================================
import { decideLink, buildLinkPrompt, checkAnswer, type LinkQuestion, type LinkCandidate, type LinkJudge } from "../app/lib/engine/linkJudge";
import { rateOrdersForLink } from "../app/lib/engine/resolve";
import { compile } from "../app/lib/engine/compiler";
import type { ConversationFacts, ThreadMessage } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const cand = (order_id: number, rating: LinkCandidate["rating"], extra: Partial<LinkCandidate> = {}): LinkCandidate =>
  ({ order_id, number: String(10000 + order_id), name: `Big Events - Show ${order_id} @ ExCeL`, rating, why: rating, ...extra });

const OWN = "Hi, can we make the crew for the Gala Dinner on Friday 6 instead of 4? Thanks, Jane";
const q = (candidates: LinkCandidate[], mode: LinkQuestion["mode"] = "enquiry"): LinkQuestion => ({
  mode, client: "Big Events Ltd", conversation: `--- CONVERSATION ---\n${OWN}\n--- END ---`, own_text: OWN,
  asks: { days: ["2026-11-06"], blocks: [{ day: "2026-11-06", size: 6 }] }, candidates,
});

/** A fake model that answers from a script, and remembers what it was asked. */
function scripted(...answers: unknown[]): LinkJudge & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    async ask(_s: string, user: string) {
      prompts.push(user);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  };
}
const same = (order_id: number, quote = "the crew for the Gala Dinner on Friday") => ({ decision: "same", order_id, quote, reason: "r" });
const none = { decision: "none", order_id: null, quote: "", reason: "a different job" };

async function main() {
  console.log("\n[1] nothing on the day: a new order, and no model call");
  {
    const j = scripted();
    const v = await decideLink(q([]), j);
    ok(v.action === "new" && j.prompts.length === 0, "new, unasked", v.how);
  }

  console.log("\n[2] the model agrees with the code: act on it");
  {
    const v = await decideLink(q([cand(1, "possible")]), scripted(same(1)));
    ok(v.action === "link" && v.action === "link" && v.order_id === 1 && v.how === "judge", "linked on the client's quoted words", `${v.action} ${v.how}`);
    const n = await decideLink(q([cand(1, "supports")]), scripted(none));
    ok(n.action === "new", "and 'none' is a new order even beside a same-venue order (two shows, one venue)", n.action);
  }

  console.log("\n[3] same client, same day alone never links: a quote the client did not write is refused");
  {
    const j = scripted(same(1, "please book order 1"), same(1, "please book order 1"));
    const v = await decideLink(q([cand(1, "possible")]), j);
    ok(v.action === "hold" && j.prompts.length === 2, "held after one second look", `${v.action} ${v.how}`);
    ok(/A CHECK DISAGREES/.test(j.prompts[1]) && /quote does not appear/.test(j.prompts[1]), "the second look is told why");
    const k = await decideLink(q([cand(1, "possible")]), scripted(same(1, "please book order 1"), same(1)));
    ok(k.action === "link" && k.how === "judge-second-pass", "a corrected second answer is taken", `${k.action} ${k.how}`);
  }

  console.log("\n[4] a different venue argues against; the model alone cannot overrule it");
  {
    const v = await decideLink(q([cand(1, "contrary", { why: "a different venue (Park Royal)" })]), scripted(same(1), same(1)));
    ok(v.action === "hold" && v.how === "disagreement", "held, not linked", `${v.action} ${v.how}`);
  }

  console.log("\n[5] a named R number overrules the model, through the second look");
  {
    const c = [cand(1, "contrary"), cand(2, "named")];
    const v = await decideLink(q(c), scripted(none, same(2)));
    ok(v.action === "link" && v.action === "link" && v.order_id === 2 && v.how === "judge-second-pass+r-number", "linked to the named order", `${v.action} ${v.how}`);
    const w = await decideLink(q(c), scripted(none, none));
    ok(w.action === "hold", "and a model that keeps saying none is held, not ignored", w.action);
  }

  console.log("\n[6] a model that fails, or answers out of shape or off the list, never decides");
  {
    const a = await decideLink(q([cand(1, "possible")]), scripted(new Error("timed out after 45000ms")));
    ok(a.action === "hold" && a.how === "judge-unavailable", "timeout: held", a.how);
    const b = await decideLink(q([cand(1, "possible")]), scripted({ nonsense: true }));
    ok(b.action === "hold", "out of shape: held", b.how);
    const c = await decideLink(q([cand(1, "possible")]), scripted(same(9), none));
    ok(c.action === "new" && c.how === "judge-second-pass", "an id not on the list goes back once, then 'none' stands", `${c.action} ${c.how}`);
    const d = await decideLink(q([cand(1, "possible")]), null);
    ok(d.action === "hold" && d.how === "judge-unavailable", "no model configured: held");
  }

  console.log("\n[7] successor mode needs no client quote");
  {
    const v = await decideLink(q([cand(1, "supports")], "successor"), scripted(same(1, "")));
    ok(v.action === "link" && v.how === "judge+venue", "linked to the re-typed order", `${v.action} ${v.how}`);
  }

  console.log("\n[8] the model never sees the code's ratings on the first look");
  {
    const j = scripted(none);
    await decideLink(q([cand(1, "supports", { why: "same venue" })]), j);
    ok(!/supports|same client and day only|same venue/.test(j.prompts[0]), "no rating words in the first prompt");
    ok(buildLinkPrompt(q([cand(1, "possible")])).includes("order_id 1 (R10001)"), "each order is listed by id and R number");
    ok(checkAnswer(q([cand(1, "possible")]), { decision: "same", order_id: 1, quote: "Thanks", reason: "" }) !== null, "a quote under 8 characters proves nothing");
  }

  console.log("\n[9] the code's ratings");
  {
    const orders = [
      { id: 1, number: "10701", happening: "2026-11-06T08:00:00Z", name: "Big Events - Gala @ ExCeL" },
      { id: 2, number: "10702", happening: "2026-11-06T08:00:00Z", name: "Big Events - Awards @ Olympia" },
    ];
    const byR = rateOrdersForLink(orders, { r_numbers: ["10702"] });
    ok(byR[1].rating === "named" && byR[0].rating === "contrary", "a named R number names one and argues against the rest", byR.map((r) => r.rating).join());
    const byText = rateOrdersForLink(orders, { location_text: "ExCeL London" });
    ok(byText[0].rating === "supports" && byText[1].rating === "possible", "the venue supports, it never names", byText.map((r) => r.rating).join());
  }

  console.log("\n[10] END TO END: a client's second job on a day it already has one");
  {
    // The client holds R10701, a gala at ExCeL on 6 Nov. A new thread asks for crew at a
    // venue that does not resolve, on the same day. The old rule linked it on the date
    // alone and rewrote the gala's crew; with the judge on, the model says it is another
    // job, the code has nothing against that, and a second order is composed instead.
    const msg = { message_id: "m1", from: "jane@bigevents.co.uk", to: ["bookings@spartancrew.co.uk"], date_iso: "2026-10-03T09:00:00Z",
      subject: "Crew for the awards", body: "Hi, separate to the gala, we need 4 crew for the Awards night at The Brewery on 6 Nov, 18:00-23:00. Jane", is_from_spartan: false } as ThreadMessage;
    const facts: ConversationFacts = { company_name: "Big Events Ltd", contact_email: "jane@bigevents.co.uk", location_text: "The Brewery",
      requests: [{ date: "2026-11-06", start_time: "18:00", end_time: "23:00", size: 4, task: "Awards night" }] };
    const reasoner = {
      async classifyAndExtract() { return { classification: "new-job", priority: "high", job_summary: "crew", facts }; },
      async classify() { return { classification: "new-job", priority: "high", job_summary: "x" }; },
      async extractFacts() { return facts; },
      async composeReply() { return { subject: "", html: "", priority: "medium" }; },
    };
    const onsinch = {
      async allCompanies() { return [{ id: 501, name: "Big Events Ltd", invoice_name: "Big Events Ltd" }]; },
      async allPlaces() { return [{ id: 49, name: "ExCeL London", zip: "E16 1XL", active: true }]; },
      async companyClients() { return [{ id: 9001, email: "jane@bigevents.co.uk" }]; },
      async companyOrdersWithJob() { return [{ id: 1, number: "10701", happening: "2026-11-06T08:00:00+00:00", name: "Big Events - Gala @ ExCeL", Job: [{ id: 71, pricelist_category_id: 315 }] }]; },
      async orderWithBlocks() { return null; },
    } as never;
    const run = (linkJudge: LinkJudge | null) => compile({ thread_id: "t-awards", messages: [msg] } as never, undefined, {
      reasoner, onsinch, now: () => Date.parse("2026-10-03T12:00:00Z"), repliesEnabled: false, seededRateCard: async () => 315, linkJudge,
    } as never);

    delete process.env.SPARTAN_LINK_JUDGE;
    const legacy = await run(null);
    ok(Number(legacy.state.onsinch_order_id) === 1, "BEFORE: the old rule links the awards to the gala on the date alone", String(legacy.state.onsinch_order_id));

    process.env.SPARTAN_LINK_JUDGE = "on";
    const judge = scripted({ decision: "none", order_id: null, quote: "", reason: "the awards night is separate from the gala" });
    const now = await run(judge);
    // needs_human is set here by the venue ("The Brewery" is created from a name and asks
    // for a look, review_only), not by the judge — so the assertion is on the hold note.
    ok(!now.state.onsinch_order_id && !!now.state.desired_order && !(now.state.notes ?? []).some((n) => /not linked and not created/.test(n)),
      "AFTER: not linked, not held; a new order is composed", `order=${now.state.onsinch_order_id} review_only=${now.state.review_only}`);
    ok((now.state.notes ?? []).some((n) => /not the same job/.test(n)), "and the note says why");
    ok(judge.prompts.length === 1 && /R10701/.test(judge.prompts[0]) && /separate to the gala/.test(judge.prompts[0]), "the model read the thread and the gala order");

    const failing = await run(scripted(new Error("timed out")));
    ok(!failing.state.onsinch_order_id && failing.state.needs_human, "a model that fails holds the email for a person", `needs_human=${failing.state.needs_human}`);
    delete process.env.SPARTAN_LINK_JUDGE;
  }

  console.log("\n[11] a thread naming a MULTI-DAY order by number is judged against it on any of its days");
  {
    // R11029 runs 7-14 Oct; `happening` reads 7 Oct. On 2026-10-04 the client moved the
    // 14 Oct shift on a thread whose subject names R11029, and the order never reached
    // the judge because only first days were compared, so the change read as a new job.
    const msg = { message_id: "m1", from: "kajaal@wearefamily.co.uk", to: ["bookings@spartancrew.co.uk"], date_iso: "2026-10-04T09:00:00Z",
      subject: "Re: Price quote - R11029 WAF - Spotify Roadshow", body: "Hi, please can we move the 14/10 shift to the Shoreditch site. Thanks, Kajaal", is_from_spartan: false } as ThreadMessage;
    const facts: ConversationFacts = { company_name: "We Are Family", contact_email: "kajaal@wearefamily.co.uk", location_text: "Shoreditch",
      requests: [{ date: "2026-10-14", start_time: "09:00", end_time: "17:00", size: 2, task: "roadshow" }] };
    const reasoner = {
      async classifyAndExtract() { return { classification: "update", priority: "high", job_summary: "move a shift", facts }; },
      async classify() { return { classification: "update", priority: "high", job_summary: "x" }; },
      async extractFacts() { return facts; },
      async composeReply() { return { subject: "", html: "", priority: "medium" }; },
    };
    const slot = (day: string) => ({ beginning: `${day}T09:00:00+01:00`, end: `${day}T17:00:00+01:00`, name: "Roadshow", Slot: [{ size: 2 }] });
    const roadshow = (days: string[]) => ({ id: 2, number: "11029", happening: "2026-10-07T09:00:00+01:00", name: "WAF - Spotify Roadshow", Job: [{ id: 72, SlotTeam: days.map(slot) }] });
    const onsinchWith = (order: unknown) => ({
      async allCompanies() { return [{ id: 324, name: "We Are Family", invoice_name: "We Are Family" }]; },
      async allPlaces() { return [{ id: 49, name: "ExCeL London", zip: "E16 1XL", active: true }]; },
      async companyClients() { return [{ id: 9002, email: "kajaal@wearefamily.co.uk" }]; },
      async companyOrdersWithJob() { return [{ id: 2, number: "11029", happening: "2026-10-07T09:00:00+01:00", name: "WAF - Spotify Roadshow", Job: [{ id: 72, pricelist_category_id: 315 }] }]; },
      async orderWithBlocks() { return order; },
    }) as never;
    const run = (order: unknown, linkJudge: LinkJudge) => compile({ thread_id: "t-waf", messages: [msg] } as never, undefined, {
      reasoner, onsinch: onsinchWith(order), now: () => Date.parse("2026-10-04T12:00:00Z"), repliesEnabled: false, seededRateCard: async () => 315, linkJudge,
    } as never);

    process.env.SPARTAN_LINK_JUDGE = "on";
    const judge = scripted({ decision: "same", order_id: 2, quote: "move the 14/10 shift", reason: "the thread names R11029 and moves its 14 Oct shift" });
    const spans = await run(roadshow(["2026-10-07", "2026-10-10", "2026-10-14"]), judge);
    ok(judge.prompts.length === 1 && /11029/.test(judge.prompts[0]), "the named order reaches the judge although it starts on 7 Oct", `prompts=${judge.prompts.length}`);
    ok(Number(spans.state.onsinch_order_id) === 2, "and the thread binds to it, not to a new booking", String(spans.state.onsinch_order_id));

    const unasked = scripted({ decision: "same", order_id: 2, quote: "move the 14/10 shift", reason: "x" });
    const short = await run(roadshow(["2026-10-07", "2026-10-08"]), unasked);
    ok(unasked.prompts.length === 0 && !short.state.onsinch_order_id, "a named order with no block on an asked day is still not a candidate", `prompts=${unasked.prompts.length}`);
    delete process.env.SPARTAN_LINK_JUDGE;
  }

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
