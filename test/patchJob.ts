// ============================================================================
// PATCH /jobs must not be able to become a no-op that reports success, and must not
// change a rate card.
// ----------------------------------------------------------------------------
// It was written as the route to correct a wrong rate card. Measured 10-15 on TEST, it
// is not one: PATCH /jobs moves the Job's pricelist_category_id and leaves every
// position priced on the old card (pricelist_id and price_fix unchanged). The builder's
// Job form reprices ("Prices of job shifts will be recalculated!"), so a card is changed
// there and patchJob refuses it before anything is sent.
//
// The trap this file pins is the one test/patchApply.ts found on /orders:
// PATCH with an id and no fields returns 204, changes nothing, and reads as
// success. On /jobs the same shape is refused before it is sent, so a caller
// cannot be told a rate card moved when nothing was written.
//
// What is NOT tested here is the pipeline using this method, because it must
// not: on an existing order the rate card in OnSinch is the invoiced one and
// ours is inferred. See the comment on patchJob.
//
// Run: npx tsx test/patchJob.ts
// ============================================================================
import { OnsinchClient, type Transport } from "../app/lib/onsinch/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

/** Every call the client made, so a case can assert nothing was sent. */
const sent: Array<{ method: string; path: string; body: any }> = [];
const transport: Transport = async (method, path, body) => {
  sent.push({ method, path, body });
  return { status: 204, data: null };
};
const client = new OnsinchClient(transport);

async function refuses(label: string, patches: any[], expect: RegExp) {
  const before = sent.length;
  let err = "";
  try {
    await client.patchJob(patches);
  } catch (e: any) {
    err = String(e?.message ?? e);
  }
  ok(expect.test(err), label, err ? `threw: ${err}` : "did not throw");
  ok(sent.length === before, `${label} - nothing reached the tenant`);
}

async function main() {
  console.log("PATCH /jobs");

  // A rate card is refused: through the API it relabels the job and reprices nothing.
  await refuses("a rate-card change is refused", [{ id: 13993, pricelist_category_id: 311 }], /priced on the old card/);

  // Any other job field still goes through.
  sent.length = 0;
  ok(await client.patchJob([{ id: 13993, name: "Renamed" }]), "a name change is accepted");
  ok(sent.length === 1 && sent[0].method === "PATCH" && sent[0].path === "/jobs", "goes to PATCH /jobs");
  ok(
    JSON.stringify(sent[0].body) === JSON.stringify([{ id: 13993, name: "Renamed" }]),
    "the array is sent at the tag root, unwrapped",
    JSON.stringify(sent[0].body)
  );

  // An empty list is a caller with nothing to do, not an error, and must not be sent:
  // what an empty PATCH body means to this API is undocumented.
  sent.length = 0;
  ok(await client.patchJob([]), "an empty patch list is a no-op");
  ok(sent.length === 0, "an empty patch list sends no request");

  // The patchApply.ts trap, on /jobs.
  await refuses("an id with no fields is refused", [{ id: 13993 }], /no fields to change/);
  await refuses("a patch with no id is refused", [{ name: "x" }], /no job id/);
  await refuses("a non-numeric id is refused", [{ id: "13993abc", name: "x" }], /no job id/);
  await refuses("a zero id is refused", [{ id: 0, name: "x" }], /no job id/);
  await refuses("a negative id is refused", [{ id: -1, name: "x" }], /no job id/);

  // A bad entry anywhere in the array stops the whole array. Validating as it sends
  // would leave the earlier patches applied and the rest not - a half-applied change
  // nobody asked for, the same reason patchSlotTeams pre-validates.
  await refuses(
    "one bad entry stops the whole array",
    [{ id: 13993, name: "x" }, { id: 13994 }],
    /no fields to change/
  );

  // A non-204 must not read as success.
  const failing = new OnsinchClient(async () => ({
    status: 400,
    data: { validationErrors: { name: ["nope"] } },
  }));
  let threw = "";
  try {
    await failing.patchJob([{ id: 13993, name: "x" }]);
  } catch (e: any) {
    threw = String(e?.message ?? e);
  }
  ok(/patchJob 400/.test(threw), "a 400 throws rather than returning true", threw);
}

main().then(() => {
  console.log(fails ? `${fails} FAILED` : "all passed");
  process.exit(fails ? 1 : 0);
});
