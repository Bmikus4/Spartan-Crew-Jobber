// ============================================================================
// An order is named for the job, never "Re: something".
// ----------------------------------------------------------------------------
// `orderName` used to be `latest.subject || requests[0].task || "Spartan Crew job"`,
// so the live tenant holds bookings called "Re: Visual Elements Sat 29th Aug 2026"
// (order 14860) and "Availability?". A subject line is written to be replied to; an
// order name is read six weeks later in a list of hundreds by someone deciding which
// job to staff.
//
// Ben, 2026-08-26: "named By AI something realistic and representative of the order,
// never say Re: in them, they should be real descriptive titles."
//
// The model writes it (ORDER_TITLE in prompts.ts). This pins the guarantee AROUND it,
// because a prompt cannot be relied on and a booking must never fail for want of a
// name. What is tested here is the fallback ladder and the one absolute: no reply
// prefix reaches OnSinch by any route.
//
// Run: npx tsx test/orderTitle.ts
// ============================================================================
import { orderTitle, stripReplyPrefix } from "../app/lib/engine/compiler";
import type { ConversationFacts } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const facts = (o: Partial<ConversationFacts> = {}): ConversationFacts =>
  ({
    company_name: "Meridian Exhibitions",
    location_text: "ExCeL London",
    requests: [{ date: "2027-09-12", size: 6, task: "stand build" }],
    ...o,
  } as ConversationFacts);

console.log("\n[1] the model's title is used when it wrote one");
{
  const t = orderTitle("Meridian Exhibitions — stand build at ExCeL, 12 Sep", "Re: Crew request", facts());
  ok(t === "Meridian Exhibitions — stand build at ExCeL, 12 Sep", "the AI title wins over the subject", t);
}

console.log("\n[2] NO REPLY PREFIX REACHES ONSINCH, BY ANY ROUTE");
{
  ok(stripReplyPrefix("Re: Crew request") === "Crew request", "Re:");
  ok(stripReplyPrefix("RE: FW: Fwd: Crew") === "Crew", "stacked prefixes, as mail clients produce them");
  ok(stripReplyPrefix("AW: Crew") === "Crew", "a German client's client");
  ok(stripReplyPrefix("Re[2]: Crew") === "Crew", "the numbered form");
  ok(stripReplyPrefix("Regarding the crew") === "Regarding the crew", "and a word that merely STARTS with re is untouched");
  // Even if the model ignores its instruction, the strip is applied to its answer too.
  const t = orderTitle("Re: Olympia derig, 3 March", "whatever", facts());
  ok(!/^re:/i.test(t), "a model that emits one anyway is cleaned", t);
}

console.log("\n[3] no title from the model -> one composed from the facts");
{
  const t = orderTitle(undefined, "Re: Availability?", facts());
  ok(t.includes("Meridian Exhibitions") && t.includes("6 crew") && t.includes("ExCeL London") && t.includes("2027-09-12"),
    "client, crew, venue and date", t);
  ok(!/^re:/i.test(t), "and never the subject prefix");
}

console.log("\n[4] a model that just echoes the subject has not written a title");
{
  const t = orderTitle("Crew request", "Re: Crew request", facts());
  ok(t !== "Crew request", "the echo is rejected and the composed title used instead", t);
}

console.log("\n[5] the composed title degrades rather than inventing");
{
  // No venue and no date stated. A title naming the wrong day is worse than a vague one.
  const t = orderTitle(undefined, "Re: Crew", facts({ location_text: undefined, requests: [{ size: 4 }] as never }));
  ok(!t.includes("undefined") && !t.includes("NaN"), "no placeholder text leaks into the name", t);
  ok(t.length > 0, "and it is never empty", t);
}

console.log("\n[6] the last resort still never says Re:");
{
  const t = orderTitle(undefined, "Re: Fwd: Availability?", { requests: [] } as ConversationFacts);
  ok(t === "Availability?", "the subject, stripped", t);
}

console.log("\n[7] OnSinch's 80-character order-name limit is respected on every route");
{
  const long = "x".repeat(300);
  ok(orderTitle(long, undefined, facts()).length <= 80, "the AI route");
  ok(orderTitle(undefined, undefined, facts({ company_name: long })).length <= 80, "the composed route");
  ok(orderTitle(undefined, long, { requests: [] } as ConversationFacts).length <= 80, "the subject route");
}

console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
process.exit(fails ? 1 : 0);
