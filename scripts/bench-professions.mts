// Bench: named professions through the bot, on TEST company 515 only. A new order whose shift
// holds a crew chief, crew, a Carpenter (3) and an AV tech (16); then a Carpenter added to the
// TEST bench order R11466 #16517. Each op is run twice: the second must be a no-op.
import { runOp } from "../app/lib/v2/bot/run";
const n = process.argv[2] ?? "1";
const create: any = { kind: "create_order", company_id: "515", company_name: "TEST - Eventz", client_email: "accounts@spartancrew.co.uk", job_name: "BOT BENCH professions - safe to delete", po: "BENCH-PROF",
  shifts: [{ name: "Crew", date: "2027-12-14", start: "08:00", end: "16:00", place_id: "5", place_label: "Spartan Crew, Unit 7 Ffinch Street",
    positions: [{ size: 1, profession_id: "36", role: "crew_chief" }, { size: 3, profession_id: "1" }, { size: 1, profession_id: "3" }, { size: 1, profession_id: "16" }] }] };
const addPos: any = { kind: "add_position", order_id: 16517, shift_id: 42280, date: "2027-12-09", start: "21:30", end: "01:30", position: { size: 1, profession_id: "3" } };
for (const [label, op] of [["create_order", create], ["add_position", addPos]] as const) {
  const r = await runOp(`bench-prof-${n}-${label}`, op); console.log(label, "->", r.status, JSON.stringify(r.reasons), JSON.stringify(r.detail ?? {}));
  const again = await runOp(`bench-prof-${n}-${label}`, op); console.log(label, "again ->", again.status, JSON.stringify(again.reasons));
}
