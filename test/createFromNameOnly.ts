// ============================================================================
// A name is enough. Creating a client or a venue is never gated on anything else.
// ----------------------------------------------------------------------------
// Ben, 2026-08-27: "nothing like creating a new client, or creating a new venue should
// be gated on information. At MINIMUM a created location should have a name, and a
// created client/member should have a name."
//
// The rule exists because an enquiry gives a client's NAME and a venue's NAME, and
// almost never a registered address or a postcode. Requiring more would mean refusing to
// book work over details the client was never going to send — and both refusals had
// already happened: `createCompany` sent only a name and got a 400 listing six missing
// fields, so no new client was ever created; `createPlace` never checked its status code,
// so a rejection came back as `undefined` and the order carried no venue at all.
//
// WHAT IS DEFAULTED AND WHAT IS BLANK IS A DELIBERATE SPLIT. `country` is GB and `status`
// is active because Spartan books UK crew and a new client is not archived. Address, city
// and postcode are EMPTY, never invented: a placeholder address would put fiction on an
// invoice, which is worse than a blank field somebody can fill in.
//
// The required field sets were established against the live tenant WITHOUT creating
// anything, by sending each payload with one field deliberately the wrong type. When the
// error stops naming missing properties and starts complaining about that one field,
// everything else was accepted:
//   POST /companies  needs name, address, city, zip, country, email_invoice, status
//   POST /places     needs name and country, and nothing else
//
// Run: npx tsx test/createFromNameOnly.ts
// ============================================================================
import { OnsinchClient } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

/** A tenant that enforces exactly what the live one enforces, as measured. */
function fake() {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client = new OnsinchClient((async (method: string, path: string, body: unknown) => {
    if (method !== "POST") return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1 } } };
    const b = (body as Array<Record<string, unknown>>)[0];
    sent.push({ path, body: b });

    if (path === "/companies") {
      const missing = ["name", "address", "city", "zip", "country", "email_invoice", "status"].filter((k) => !(k in b));
      return missing.length
        ? { status: 400, data: { validationErrors: { 0: [`Missing required properties: ${missing.join(", ")}`] } } }
        : { status: 201, data: { data: [{ id: 8801, name: b.name }] } };
    }
    if (path === "/places") {
      const missing = ["name", "country"].filter((k) => !(k in b));
      return missing.length
        ? { status: 400, data: { validationErrors: { 0: [`Missing required properties: ${missing.join(", ")}`] } } }
        : { status: 201, data: { data: [{ id: 6100, name: b.name }] } };
    }
    return { status: 200, data: { data: [] } };
  }) as never);
  return { client, sent };
}

(async () => {
  console.log("\n[1] A CLIENT KNOWN ONLY BY NAME IS CREATED");
  {
    const { client, sent } = fake();
    const made = await client.createCompany({ name: "Spectra Events Ltd." });
    ok(made.id === 8801, "created", JSON.stringify(made));
    const b = sent[0].body;
    ok(b.address === "" && b.city === "" && b.zip === "", "with address, city and zip left blank, not invented",
      JSON.stringify({ a: b.address, c: b.city, z: b.zip }));
    ok(b.country === "GB" && b.status === 1, "and the two facts we do know defaulted", `${b.country} / ${b.status}`);
  }

  console.log("\n[2] A VENUE KNOWN ONLY BY NAME IS CREATED");
  {
    const { client, sent } = fake();
    const made = await client.createPlace({ name: "The Grand Hall" });
    ok(made.id === 6100, "created without an address, a city or a postcode", JSON.stringify(made));
    ok(sent[0].body.country === "GB", "country defaulted so the caller need only know the name", String(sent[0].body.country));
  }

  console.log("\n[3] the one thing that IS required is the name");
  {
    const { client } = fake();
    let msg = "";
    await client.createPlace({ address: "somewhere" } as never).catch((e) => { msg = String(e?.message ?? e); });
    ok(/must have a name/.test(msg), "a nameless venue is refused, and says why", msg.slice(0, 80));
  }

  console.log("\n[4] A REJECTION IS NEVER SWALLOWED");
  {
    // createPlace used to ignore the status code entirely: a 400 came back as `undefined`
    // and the order carried no venue, with nothing on the ticket to explain it. Both of
    // today's silent writes were only diagnosable because the error text survived.
    const client = new OnsinchClient((async () => ({
      status: 400, data: { validationErrors: { 0: ["Missing required properties: lat"] } },
    })) as never);
    let msg = "";
    await client.createPlace({ name: "Somewhere" }).catch((e) => { msg = String(e?.message ?? e); });
    ok(/createPlace 400/.test(msg), "it throws instead of returning undefined", msg.slice(0, 80));
    ok(/lat/.test(msg), "carrying the field OnSinch actually named", msg.slice(0, 90));
  }

  console.log("\n[5] a 201 with no id is also a failure, not a success");
  {
    const client = new OnsinchClient((async () => ({ status: 201, data: { data: [] } })) as never);
    let msg = "";
    await client.createPlace({ name: "Somewhere" }).catch((e) => { msg = String(e?.message ?? e); });
    ok(/returned no id/.test(msg), "an empty 201 cannot pass for a created venue", msg.slice(0, 80));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
