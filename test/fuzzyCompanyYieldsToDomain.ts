// ============================================================================
// A company name that only resembles a client gives way to the sender's own domain.
// ----------------------------------------------------------------------------
// Live on 2026-10-05: "RG Jones Sound Engineering Ltd" resembled 146 "F1 Sound Co" on
// the shared word "sound" and five threads were booked against it, though every sender
// wrote from rgjones.co.uk, which belongs to 457 "RG Jones". The domain was only asked
// when the name matched nothing at all, and a thread kept its first company for good.
//
// Offline.  npx tsx test/fuzzyCompanyYieldsToDomain.ts
// ============================================================================
import { resolveCompany } from "../app/lib/engine/compiler";
import { OnsinchClient, __resetListCache } from "../app/lib/engine/onsinch";
import type { ConversationFacts, ConversationState } from "../app/lib/engine/types";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) fails++;
};

const COMPANIES = [
  { id: 146, name: "F1 Sound Co", Client: [{ id: 1, email: "ops@f1sound.co.uk" }] },
  { id: 457, name: "RG Jones", Client: [{ id: 2, email: "harryclifford@rgjones.co.uk" }] },
  { id: 189, name: "Immersive AV", Client: [{ id: 3, email: "hello@immersiveav.co.uk" }] },
  { id: 343, name: "Impact Collective", Client: [{ id: 4, email: "georgina@we-are-impact.com" }] },
];
const onsinch = new OnsinchClient(async (_m, path) => {
  const data = path.startsWith("/companies") ? COMPANIES : [];
  return { status: 200, data: { data, pagination: { pageCount: 1, count: data.length } } };
});
const facts = (company_name: string, contact_email?: string) =>
  ({ company_name, contact_email, requests: [] }) as unknown as ConversationFacts;

(async () => {
  __resetListCache();

  console.log("\n[1] control: with no domain to ask, the resemblance still books, and says so");
  {
    const r = await resolveCompany(facts("RG Jones Sound Engineering Ltd", "someone@gmail.com"), undefined, onsinch);
    ok(r.id === 146, "a consumer address proves nothing, so the fuzzy match stands", String(r.id));
    ok(/on a name similarity/.test(r.note ?? ""), "with its CHECK IT note", r.note ?? "");
  }

  console.log("\n[2] the sender's domain outranks a resemblance");
  {
    const r = await resolveCompany(facts("RG Jones Sound Engineering Ltd", "xandergreen@rgjones.co.uk"), undefined, onsinch);
    ok(r.id === 457, "RG Jones, not F1 Sound Co", String(r.id));
    ok(/only resembled 146 "F1 Sound Co".*belongs to 457 "RG Jones"/.test(r.note ?? ""), "and the note names both", r.note ?? "");
    const i = await resolveCompany(facts("Impact Immersive Ltd", "lily@we-are-impact.com"), undefined, onsinch);
    ok(i.id === 343, "Impact Collective, not Immersive AV", String(i.id));
  }

  console.log("\n[3] an exact name is never overruled by a domain");
  {
    const r = await resolveCompany(facts("F1 Sound Co", "harryclifford@rgjones.co.uk"), undefined, onsinch);
    ok(r.id === 146, "an exact match keeps its company", String(r.id));
  }

  console.log("\n[4] a thread that settled on a guess is asked again; a settled one is not");
  {
    const guessed = { company_id: 146, notes: [`company "RG Jones Sound Engineering Ltd" did not match any client exactly — booked against 146 "F1 Sound Co" on a name similarity. CHECK IT`] } as unknown as ConversationState;
    const r = await resolveCompany(facts("RG Jones Sound Engineering Ltd", "harryclifford@rgjones.co.uk"), guessed, onsinch);
    ok(r.id === 457, "the guessed 146 is corrected to 457 on the next email", String(r.id));
    const unresolvable = await resolveCompany(facts("", "someone@gmail.com"), guessed, onsinch);
    ok(unresolvable.id === 146, "asked again and still unresolved, the guess stands rather than leaving no client", String(unresolvable.id));
    const settled = { company_id: 146, notes: ["company from a name resolved before"] } as unknown as ConversationState;
    const s = await resolveCompany(facts("RG Jones Sound Engineering Ltd", "harryclifford@rgjones.co.uk"), settled, onsinch);
    ok(s.id === 146, "a company that was not a guess is kept", String(s.id));
  }

  console.log(fails ? `\n${fails} FAILED\n` : "\nALL PASS\n");
  process.exitCode = fails ? 1 : 0;
})();
