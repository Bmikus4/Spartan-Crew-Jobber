// ============================================================================
// F2 END-TO-END — DOES THE CREATED VENUE ACTUALLY REACH THE ORDER?   (FREE)
// ----------------------------------------------------------------------------
//   npx tsx study/blockvenueE2E.ts
//
// Ben's ask, verbatim: "verify that the created venue is used when creating the
// job." Two unit files already pin the halves — resolveBlockVenues decides it
// (test/blockVenueResolves.ts) and createOrderWithPlace writes it
// (test/createdVenueReachesTheJob.ts) — but a decision and a write agreeing in
// isolation is not the same as a booking arriving correctly, and the two paths
// disagreed for a fortnight precisely because nothing followed one through.
//
// So this runs a real enquiry through the production seam against the REAL
// tenant's 5,567 places, with the fixture transport recording writes instead of
// making them, and prints the order body OnSinch would have received. No money,
// no network, nothing written.
//
// THREE SHAPES, chosen because each one broke differently before today:
//   A  one venue the tenant holds                -> everyone at that id
//   B  two venues, both held                      -> two teams, two ids
//   C  one held + one the tenant does NOT hold    -> the new row is created and
//      takes ONLY the block that asked for it; the held block keeps its id.
//      This is the shape where the create path used to relocate every team.
// ============================================================================
import { buildRig, loadPlaces, loadProfessions, payloadFor, type Wire } from "./rig";
import type { StudyCase } from "./cases";

const HELD_A = { id: 49, name: "ExCel London" };
const HELD_B = { id: 12, name: "The British Museum" };
const UNHELD = "The Glass House, 14 Kestrel Way, Thornbury BS35 2QQ";

interface Shape { key: string; what: string; blocks: Array<{ size: number; venue: string }>; job: string }

const SHAPES: Shape[] = [
  { key: "A", what: "one venue the tenant holds", job: HELD_A.name,
    blocks: [{ size: 6, venue: HELD_A.name }, { size: 4, venue: HELD_A.name }] },
  { key: "B", what: "two venues, both held", job: HELD_A.name,
    blocks: [{ size: 6, venue: HELD_A.name }, { size: 4, venue: HELD_B.name }] },
  { key: "C", what: "one held, one the tenant does NOT hold", job: HELD_A.name,
    blocks: [{ size: 6, venue: HELD_A.name }, { size: 4, venue: UNHELD }] },
];

/** A thread the seam will accept, phrased the way a client writes one. */
function caseFor(s: Shape): StudyCase {
  const body =
    `Hi,\n\nCould you cover the following on Monday 9th March 2026, 8am to 6pm?\n\n` +
    s.blocks.map((b) => `  - ${b.size} crew at ${b.venue}`).join("\n") +
    `\n\nThanks,\nSam\nNorthgate Events`;
  return {
    id: `E2E-${s.key}`,
    cell: { kind: "booking" } as never,
    kind: "booking",
    truth: {} as never,
    sentAt: "2026-02-16",
    subject: `Crew needed 9th March — ${s.what}`,
    messages: [{ from: "sam@northgate-events.co.uk", body } as never],
  } as unknown as StudyCase;
}

/**
 * The extractor, scripted. This file is measuring the VENUE path, not the model:
 * every block is handed to the engine exactly as a perfect extraction would hand
 * it over, so anything wrong downstream is the engine's and not a bad read.
 */
function reasonerFor(s: Shape) {
  return {
    async classify() {
      return { classification: "new-job", priority: "high", job_summary: s.what, order_title: `Northgate Events ${s.key}` };
    },
    async extractFacts() {
      return {
        company_name: "Northgate Events",
        contact_name: "Sam Ferris",
        contact_email: "sam@northgate-events.co.uk",
        location_text: s.job,
        requests: s.blocks.map((b) => ({
          date: "2026-03-09", start_time: "08:00", end_time: "18:00",
          size: b.size, profession_hint: "crew",
          // A block only carries a venue when it DIFFERS from the job's, which is
          // what EXTRACT_SYSTEM asks a real extractor for. Repeating the job's
          // venue on every block would say the crew move when they do not.
          ...(b.venue === s.job ? {} : { location_text: b.venue }),
        })),
      };
    },
    async composeReply() { return { subject: `Re: ${s.what}`, html: "<p>noted</p>", priority: "high" }; },
  } as never;
}

function report(s: Shape, wire: Wire, places: Array<{ id: number; name?: string }>) {
  const byId = new Map(places.map((p) => [p.id, p]));
  const created = wire.created[0]?.body as Array<{ SlotTeam?: Array<{ name: string; size: number; place_id: number; profession_id: number }> }> | undefined;
  const teams = created?.[0]?.SlotTeam ?? [];
  const madeName = (id: number) => wire.provisioned.find((p) => p.id === id)?.name;

  console.log(`\n${"-".repeat(84)}`);
  console.log(`  ${s.key}. ${s.what}`);
  console.log("-".repeat(84));
  if (wire.provisioned.length) {
    for (const p of wire.provisioned) console.log(`  createPlace -> #${p.id} "${p.name}"`);
  } else {
    console.log("  createPlace -> (none)");
  }
  if (!teams.length) { console.log("  NO ORDER POSTED"); return { ok: false, why: "no order" }; }

  for (const t of teams) {
    const where = madeName(t.place_id) ? `NEW "${madeName(t.place_id)}"` : `"${byId.get(t.place_id)?.name ?? "?"}"`;
    console.log(`  ${String(t.size).padStart(3)} x prof ${String(t.profession_id).padEnd(3)} -> place ${String(t.place_id).padEnd(6)} ${where}`);
  }

  const zeros = teams.filter((t) => !t.place_id).length;
  const sites = new Set(teams.map((t) => t.place_id));
  return { ok: zeros === 0, zeros, sites, teams };
}

(async () => {
  const places = loadPlaces();
  const professions = loadProfessions();
  const { handleThread } = await import("../app/lib/engine/pipeline");

  console.log(`\n${"=".repeat(84)}`);
  console.log("  F2 — THE VENUE A JOB IS BOOKED AT, FOLLOWED FROM THE EMAIL TO THE WIRE");
  console.log("=".repeat(84));
  console.log(`\n  ${places.length} real tenant places, fixture transport, nothing written.`);

  let fails = 0;
  const say = (cond: boolean, label: string, extra = "") => {
    if (!cond) fails++;
    console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  };

  for (const s of SHAPES) {
    const c = caseFor(s);
    const rig = buildRig({ case: c, places, professions, reasoner: reasonerFor(s) });
    await handleThread(payloadFor(c, "new") as never, rig.deps);
    const r = report(s, rig.wire, places as Array<{ id: number; name?: string }>);
    if (!("teams" in r) || !r.teams) { fails++; continue; }

    console.log("");
    say(r.zeros === 0, "every team carries a real place id — no 0 reached the wire", `zeros=${r.zeros}`);
    const crew = r.teams.filter((t) => t.profession_id === 1);

    if (s.key === "A") {
      say(r.sites!.size === 1 && r.sites!.has(HELD_A.id), "one venue, and it is the one the client named",
          [...r.sites!].join(","));
      // HEADCOUNT, not crew: the chief band carves 2 chiefs OUT of ten rather than
      // adding them, so ten people arrive as 8 crew + 2 chiefs. Counting profession 1
      // alone reads that conservation as a loss.
      say(r.teams.reduce((n, t) => n + t.size, 0) === 10, "all ten people are on it",
          String(r.teams.reduce((n, t) => n + t.size, 0)));
    }
    if (s.key === "B") {
      say(r.sites!.has(HELD_A.id) && r.sites!.has(HELD_B.id), "both buildings appear", [...r.sites!].join(","));
      say(crew.length >= 2, "and the crew is split, not merged into one team", `${crew.length} crew teams`);
      say(r.teams.reduce((n, t) => n + t.size, 0) === 10, "with all ten people still booked",
          String(r.teams.reduce((n, t) => n + t.size, 0)));
    }
    if (s.key === "C") {
      const made = rig.wire.provisioned.filter((p) => p.name.toLowerCase() !== "no location");
      say(made.length === 1, "exactly one venue was created", made.map((m) => m.name).join(" | "));
      say(/Glass House/i.test(made[0]?.name ?? ""), "created from the client's own words", made[0]?.name ?? "(none)");
      // THE ASSERTION THIS FILE EXISTS FOR.
      say(r.sites!.has(HELD_A.id), "the block at a HELD venue keeps that venue", [...r.sites!].join(","));
      say(made.length === 1 && r.sites!.has(made[0].id), "and the created venue is used by the block that asked for it",
          [...r.sites!].join(","));
      say(r.sites!.size === 2, "two distinct venues on the order, not one", String(r.sites!.size));
      say(r.teams.reduce((n, t) => n + t.size, 0) === 10, "and nobody was lost to the split",
          String(r.teams.reduce((n, t) => n + t.size, 0)));
    }
  }

  console.log(`\n${"=".repeat(84)}`);
  console.log(fails ? `  ${fails} FAILED` : "  ALL PASS — the created venue reaches the job, and only the job that asked");
  console.log("=".repeat(84) + "\n");
  process.exit(fails ? 1 : 0);
})();
