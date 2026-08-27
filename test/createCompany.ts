// ============================================================================
// Creating a client OnSinch does not hold yet.
// ----------------------------------------------------------------------------
// `POST /companies` answers
//   400 {"0":["Missing required properties: address, city, zip, country,
//             email_invoice, status"]}
// to a body carrying only a name — which is all the engine ever sent. So creating a
// company had never worked, on any path, since the method was written.
//
// It stayed invisible for one reason: a brand-new company always had an assumed rate
// card, an assumed card always HELD the booking, and a held booking never reached the
// write. Removing that hold on 2026-08-27 made the call happen for the first time and
// two live test enquiries died on it — "Spectra Events Ltd." and "Innovate UK Events",
// both otherwise correct: venue matched on postcode, professions resolved by cue, chief
// bands right, year rolled forward properly.
//
// That is the second time in one day that lifting a gate exposed a write nobody had ever
// executed. The first was a rebuild that deleted an order before discovering it could not
// re-post it. A gate does not only stop bad writes; it hides untested ones.
//
// THE FIELD SET WAS ESTABLISHED WITHOUT CREATING ANYTHING, by sending the full payload
// with a deliberately invalid `status`. The error moved from "Missing required
// properties" to "status: Incorrect type", which proves the rest was accepted — and a
// company cannot be deleted through this API, so a probe that created one would have been
// permanent.
//
// Run: npx tsx test/createCompany.ts
// ============================================================================
import { OnsinchClient } from "../app/lib/engine/onsinch";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

function fake() {
  const sent: Array<Record<string, unknown>> = [];
  const client = new OnsinchClient((async (method: string, path: string, body: unknown) => {
    if (method === "POST" && path === "/companies") {
      const b = (body as Array<Record<string, unknown>>)[0];
      sent.push(b);
      // OnSinch's real rule, as measured.
      const required = ["address", "city", "zip", "country", "email_invoice", "status"];
      const missing = required.filter((k) => !(k in b));
      if (missing.length) {
        return { status: 400, data: { validationErrors: { 0: [`Missing required properties: ${missing.join(", ")}`] } } };
      }
      return { status: 201, data: { data: [{ id: 8801, name: b.name }] } };
    }
    return { status: 200, data: { data: [], pagination: { count: 0, pageCount: 1 } } };
  }) as never);
  return { client, sent };
}

(async () => {
  console.log("\n[1] a name alone is completed into something OnSinch accepts");
  {
    const { client, sent } = fake();
    const made = await client.createCompany({ name: "Spectra Events Ltd." });
    ok(made.id === 8801, "the company is created", JSON.stringify(made));
    const b = sent[0];
    for (const k of ["address", "city", "zip", "country", "email_invoice", "status"]) {
      ok(k in b, `${k} is sent`, JSON.stringify(b[k]));
    }
    ok(b.country === "GB", "country defaults to GB — Spartan books UK crew", String(b.country));
    ok(b.status === 1, "status 1 is active", String(b.status));
  }

  console.log("\n[2] THE BLANKS ARE BLANK, not invented");
  {
    // An enquiry gives a client's name and almost never their registered address.
    // A placeholder address would put fiction on an invoice, which is worse than an
    // empty field somebody can fill in.
    const { client, sent } = fake();
    await client.createCompany({ name: "Innovate UK Events" });
    const b = sent[0];
    ok(b.address === "" && b.city === "" && b.zip === "", "address, city and zip go out empty",
      JSON.stringify({ a: b.address, c: b.city, z: b.zip }));
  }

  console.log("\n[3] the caller's own values win over every default");
  {
    const { client, sent } = fake();
    await client.createCompany({
      name: "Known Client Ltd.", email_invoice: "accounts@knownclient.co.uk",
      city: "Manchester", country: "GB",
    });
    const b = sent[0];
    ok(b.email_invoice === "accounts@knownclient.co.uk", "the real invoice address is kept", String(b.email_invoice));
    ok(b.city === "Manchester", "and a city the caller knew", String(b.city));
  }

  console.log("\n[4] a 400 still throws, carrying what OnSinch actually said");
  {
    // The defaults must not swallow a genuine rejection — the two live failures were
    // only diagnosable because the validation error reached the ticket verbatim.
    const client = new OnsinchClient((async () => ({
      status: 400, data: { validationErrors: { 0: ["Missing required properties: ico"] } },
    })) as never);
    let msg = "";
    await client.createCompany({ name: "X" }).catch((e) => { msg = String(e?.message ?? e); });
    ok(/createCompany 400/.test(msg), "it throws", msg.slice(0, 90));
    ok(/ico/.test(msg), "and the field OnSinch named survives into the message", msg.slice(0, 90));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exit(fails ? 1 : 0);
})();
