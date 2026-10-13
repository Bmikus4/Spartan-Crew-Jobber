// End to end on TEST 515 (one paid reading per email): a client email -> the live reader -> grounding -> plan
// -> the bot (testOnly: TEST 515 only) -> read back; then a follow-up change on the same thread.
// The sender is mapped to TEST 515 by a wrapped companies() list; nothing else is faked.
import { decideMessage, onsinchWorld, type MessageIn } from "../app/lib/v2/process";
import { extractWithMeta } from "../app/lib/v2/interpret/extract";
import { runOp, readOrder, slotsOf } from "../app/lib/v2/bot/run";
import { utcToLondon } from "../app/lib/v2/bot/ops";
const live = onsinchWorld();
const SENDER = "jamie@test-eventz.example";
const world = { ...live, companies: async () => (await live.companies()).map((c: any) => (Number(c.id) === 515 ? { ...c, Client: [...([] as any[]).concat(c.Client ?? []), { id: 1591, email: SENDER }] } : c)) };
let order: number | null = null;
const thread: { who: "client" | "spartan"; at: string; text: string }[] = [];
async function send(id: string, subject: string, body: string, sent: string) {
  const m: MessageIn = { message_id: id, thread_id: "e2e-thread-" + process.argv[2], from_address: SENDER, date_iso: sent, subject, body, is_from_spartan: false };
  const r = await decideMessage(m, {
    extract: extractWithMeta, world, threadOrderId: async () => order, thread: async () => thread,
    run: (source, op) => runOp(`${source}:e2e${process.argv[2]}`, op, { testOnly: true }),
    record: async () => {}, trace: () => {}, link: async (id) => { order = id; },
  });
  thread.push({ who: "client", at: sent, text: body });
  console.log(`\n${subject}\n  decision: ${r.decision.kind} ${JSON.stringify((r.decision as any).why ?? (r.decision as any).reasons ?? (r.decision as any).reason).slice(0, 300)}`);
  console.log(`  executed: ${(r.executed ?? []).map((e) => `${e.status}${(e.detail as any)?.number ? " R" + (e.detail as any).number : ""} ${e.reasons.join("; ").slice(0, 120)}`).join(" | ")}`);
  if (order) { const o = await readOrder(order); console.log(`  R${o.number} user ${o.user_id}: ` + slotsOf(o).filter((s: any) => !s.cancelled).map((s: any) => `${utcToLondon(s.beginning).date} ${utcToLondon(s.beginning).time}-${utcToLondon(s.end).time} x${s.size} p${s.profession_id} r${s.role} h${s.hidden ? 1 : 0} c${s.concept ? 1 : 0}`).join(" | ")); }
}
await send("e2e-1-" + process.argv[2], "Crew for Spartan Crew yard - 18th December 2027", "Hi team,\n\nCould we book 5 crew and a carpenter on Saturday 18th December 2027, 08:00 - 16:00, at the Spartan Crew unit on Ffinch Street?\n\nThanks,\nJamie\nTEST - Eventz", "2027-12-01T10:00:00Z");
await send("e2e-2-" + process.argv[2], "Re: Crew for Spartan Crew yard - 18th December 2027", "Hi,\n\nCan we start an hour earlier on the 18th please, so 07:00 - 15:00? And add 2 more crew.\n\nThanks,\nJamie", "2027-12-02T09:00:00Z");
