// ============================================================================
// An unreadable venue list holds the email; it does not throw it away.
// ----------------------------------------------------------------------------
// resolvePlace called onsinch.allPlaces() with no guard, so one timeout threw out of
// compile, handleThread persisted nothing, and the thread had no row at all. The n8n
// intake strips the Gmail label before the engine runs, so the email was simply gone
// (audit #6, scenario R7). Every other optional read in compile is guarded; the sweep
// already guards this exact call.
//
// Held, not guessed: with no list there is no way to know which building is meant, and
// the placeholder or a created venue would put crew somewhere unverified.
//
// Offline.  npx tsx test/venueListOutage.ts
// ============================================================================
import { compile } from "../app/lib/engine/compiler";
import { OnsinchClient, type Transport } from "../app/lib/engine/onsinch";
import { mockReasoner, mockTransport, msg } from "./mocks";

let fails = 0;
const ok = (cond: boolean, label: string, extra = "") => {
  if (!cond) fails++;
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

const outage: Transport = async (method, path, body) => {
  if (method === "GET" && path.startsWith("/places")) throw new Error("places read timed out");
  return mockTransport(method, path, body);
};

async function main() {
  console.log("\n[1] a venue-list timeout does not lose the email");
  let threw: string | null = null;
  let result: Awaited<ReturnType<typeof compile>> | undefined;
  try {
    result = await compile(
      { thread_id: "t-outage", messages: [msg({ body: "Please book 4 crew on 9 March at Savoy Place. RedBeast Energy" })] },
      undefined,
      { reasoner: mockReasoner, onsinch: new OnsinchClient(outage), now: () => 1, repliesEnabled: false, seededRateCard: async () => 197 },
    );
  } catch (err) {
    threw = String((err as Error)?.message ?? err);
  }
  ok(threw === null, "compile returns", threw ?? "");
  ok(!!result && !result.actions.createOrder && !result.actions.patchOrder, "and books nothing it could not place",
    JSON.stringify(Object.keys(result?.actions ?? {})));
  ok(result?.state.needs_human === true, "the thread is tagged for a person");
  ok((result?.state.notes ?? []).some((n) => /venue list could not be read/.test(n)), "and says why",
    (result?.state.notes ?? []).find((n) => /venue/.test(n)) ?? "(none)");

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILED`}\n`);
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
