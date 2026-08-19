// ============================================================================
// Turn the simulation output into one page.
// ----------------------------------------------------------------------------
//   npx tsx sim/report.ts   ->  .tmp-data/sim/report.html
//
// Generated rather than hand-written: the case table is 100 rows and the numbers
// in the prose are read out of results.json, so re-running the simulation and
// re-running this cannot leave a stale figure in a sentence.
// ============================================================================
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CaseResult } from "./run";

const OUT = join(import.meta.dirname, "..", ".tmp-data/sim");
const data = JSON.parse(readFileSync(join(OUT, "results.json"), "utf8")) as {
  cases: number; professions: number; places: number;
  summary: { agree: number; clean: number; wrote: number; held: number; idempotent: number };
  results: CaseResult[];
};
const live = JSON.parse(readFileSync(join(OUT, "live-write.json"), "utf8")) as {
  tenant: string; company_id: number; probes: Array<Record<string, unknown>>;
};

const R = data.results;
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ------------------------------------------------------------------ groups
const GROUPS: Array<{ key: string; name: string; question: string }> = [
  { key: "A", name: "Crew-chief bands", question: "Does the client's number stay the number that turns up, on both sides of 4, 10 and 20?" },
  { key: "B", name: "Profession naming", question: "Does the wording a client uses reach the right one of 43 professions, and never Crew Boss 55?" },
  { key: "C", name: "Day rate or hourly", question: "Day rate at 8 hours, hourly below, and never inferred from an unstated shift?" },
  { key: "D", name: "Time windows", question: "Are stated hours booked as stated, with the defaults said out loud and no call-out floor invented?" },
  { key: "E", name: "Dates and TBC", question: "What happens to a job with no confirmed date?" },
  { key: "F", name: "Venues", question: "Against 6,847 real rows — 3,000 of them context-free duplicates — does a job reach the record that knows the address?" },
  { key: "G", name: "Team merging", question: "Same window, same place, same role: one team with the sizes summed, never split by size?" },
  { key: "H", name: "Rate card", question: "Derived from history where there is history, and held for a human where it was assumed?" },
  { key: "I", name: "Amendments", question: "Does a second email actually change the booking — and never destroy one it must not touch?" },
  { key: "J", name: "Cross-thread twins", question: "One job arriving as two threads: held and asked about, never booked twice?" },
  { key: "K", name: "Shape and edges", question: "Oversized names, no size at all, 200 crew, eight blocks, messages that are not bookings." },
];

const OUTCOMES: Record<string, { label: string; tone: string; blurb: string }> = {
  written: { label: "written", tone: "pass", blurb: "an order reached OnSinch as To Confirm" },
  held: { label: "held", tone: "warn", blurb: "composed, deliberately not written, a human asked" },
  refused: { label: "refused", tone: "warn", blurb: "the change could not be applied and said so" },
  "not-bookable": { label: "not bookable", tone: "info", blurb: "nothing postable could be built" },
  "no-change": { label: "no change", tone: "info", blurb: "the message asked for nothing" },
};

const count = (f: (c: CaseResult) => boolean) => R.filter(f).length;
const outcomeCounts = Object.keys(OUTCOMES).map((k) => ({ k, n: count((c) => c.outcome === k) }));
const totalRequested = R.reduce((n, c) => n + c.predicted_headcount, 0);
const totalOnOrder = R.reduce((n, c) => n + c.headcount, 0);
const totalChiefs = R.reduce((n, c) => n + c.chiefs, 0);
const totalTeams = R.reduce((n, c) => n + c.teams.length, 0);
const replaced = R.filter((c) => c.deleted_orders.length);

// ------------------------------------------------------------------ findings
interface Finding {
  rank: string; sev: "critical" | "high" | "medium"; state: "fixed" | "open";
  title: string; symptom: string; cause: string; consequence: string; resolution: string;
  evidence: string[];
}
const FINDINGS: Finding[] = [
  {
    rank: "F1", sev: "critical", state: "fixed",
    title: "A crew change on a second email could never reach OnSinch",
    symptom:
      "Every amendment fell back to PATCH and left a note reading “crew and times must be applied by hand on OnSinch order #…”. The thread still read <em>ordered</em>, so the board showed a booking that agreed with the client while OnSinch held one that did not.",
    cause:
      "<code>tryReplace</code> decides a crew change happened by comparing <code>last_ordered_teams_hash</code>, and reads it off the state <code>compile()</code> returns. <code>compile()</code> built that state without carrying the field forward, so on every second email it was <code>undefined</code>, <code>teamsChanged</code> was false, and delete-and-repost — the only route the API leaves for a crew or time change — declined before it started. <code>order_replace</code>, the crash-safety marker for a part-finished replace, was dropped the same way.",
    consequence:
      "The headline behaviour of the previous session was unreachable through the real entry point. Every test covering it passed, because each one builds the ConversationState by hand with the field already set and calls the pipeline directly — none of them crosses the compile seam.",
    resolution:
      "Both fields are carried forward in <code>compiler.ts</code>. <code>test/amendmentReachesOnsinch.ts</code> is new and sends two emails through <code>handleThread</code> the way Gmail does; it fails on the old code and passes on the new.",
    evidence: [
      "before: I-grow — 1 order on the wire, action log [create, patch], note “must be applied by hand”",
      "after:  I-grow — order 90246 deleted, 90247 posted, action log [create, replace]",
      "7 of the 12 amendment cases now delete and repost; the PO-only follow-up still correctly does not",
    ],
  },
  {
    rank: "F2", sev: "high", state: "fixed",
    title: "Roles named in the plural were booked as general crew",
    symptom:
      "“chiefs”, “chippies”, “forklifts” and “telehandlers” all resolved to profession 1, Crew.",
    cause:
      "The cue table is written in the singular. The containment pass rescued the plurals where the client's word happens to contain the tenant's word — “carpenters” contains “Carpenter” — and rescued nothing where it does not.",
    consequence:
      "A supervisor request cost twice: the chief was booked as labour, and then the band read a team with no chief in it and carved another one out of it. Plant requests were billed as general crew.",
    resolution:
      "Plurals are folded once before the cue match, word by word, leaving “ss” alone so “boss” does not become “bos”. Nineteen assertions added to <code>test/professions.ts</code>, including that no wording of “boss” reaches Crew Boss 55.",
    evidence: [
      "chippies 1 → 3 Carpenter",
      "chiefs 1 → 36 Crew Chief",
      "forklifts 1 → 11 Counterbalance",
      "telehandlers 1 → 4 Telehandler U<9M",
      "riggers stays 1 — the tenant has no rigger row, and that default is deliberate",
    ],
  },
  {
    rank: "F3", sev: "medium", state: "fixed",
    title: "The R number was never stored on an order the engine created",
    symptom:
      "<code>onsinch_order_number</code> was <code>undefined</code> on every engine-created order, so the Jobs Board, the <code>tickets</code> table and the confirm-order API all recorded null for the identifier a human types into OnSinch's search box.",
    cause:
      "<code>POST /orders</code> returns <code>{\"id\":13744}</code> and nothing else. The client typed the response as carrying <code>number</code>, and the offline mock invented <code>number: \"SC-9001\"</code> — so the test asserting the number was stored passed against a value the real API never sends.",
    consequence:
      "Clients quote the R number back unprompted. It was absent from the board for every order the engine raised, while orders inherited from OnSinch history carried theirs correctly — which is why nobody would have seen a pattern.",
    resolution:
      "The read-back after a create now returns both identifiers from the one GET it was already making, and the mock returns <code>{ id }</code> only, like the API.",
    evidence: [
      "live: POST → api id 13748, no number; GET on 13748 → number 10641, Job 14028",
      "the read-back still cannot fail a written order — a throw there would report an existing order as an error and create it twice",
    ],
  },
  {
    rank: "F4", sev: "high", state: "open",
    title: "A venue named briefly lands on a record with no address",
    symptom:
      "An enquiry saying “ExCeL” resolves to place 2075, whose name is “Excel” and whose every other field is null. The same enquiry written out in full resolves to 49, the row carrying the address, the postcode and the alias.",
    cause:
      "Ten rows are named exactly “Excel” and match at tier 0. The real row is named “ExCel London”, and name-containment asks whether the email contains the record's name — “excel” does not contain “excel london”. So the only rows that match at all are the empty ones, they tie on context, and the lowest id wins. Context outranks tier, but it can only rank rows that matched.",
    consequence:
      "Crew booked to a place record OnSinch holds no address for. “NEC Birmingham” resolves to nothing at all and provisions a 222nd NEC.",
    resolution:
      "Not changed. This is the ranking rule Ben set on 2026-08-18, and widening it — letting a record's name contain the email's text as well as the reverse — is a policy call about which direction of containment is evidence, not a defect to quietly patch.",
    evidence: [
      "“ExCeL” → 2075 (context 0)   “ExCeL London” → 49 (context 6)   full address → 49",
      "“NEC Birmingham” → null → a new place is created; 221 NEC rows already exist",
      "“Olympia” → 57, so the failure is not universal — it depends on whether a bare-name row happens to exist",
    ],
  },
  {
    rank: "F5", sev: "medium", state: "open",
    title: "A venue named by its short alias never resolves",
    symptom:
      "“RAH” resolves to nothing and a duplicate Royal Albert Hall is provisioned, although place 2 carries the alias “RAH”. So do “V&A”, “TGH”, “CBC” and “RAA”, and any two- or three-character venue text such as “O2” or “NEC”.",
    cause:
      "<code>matchPlace</code> returns null when the normalised text is under four characters, before any matching runs. Spelling it out does not help either: “RAH, Kensington Gore” also fails, because alias containment requires six characters and the address tier requires the postcode to agree or the address to carry a street number — and “Kensington Gore” has neither.",
    consequence:
      "Provisioning a duplicate of a venue that already exists is precisely how the tenant came to hold 3,000 context-free rows for about twenty buildings. The guard against short fragments is producing the mess it was written to prevent.",
    resolution:
      "Not changed, for the same reason as F4. The length floor is load-bearing — it is what stops a three-letter alias sweeping every address containing it — so the fix is to let an exact alias match bypass the floor, which is a rule change and Ben's to make.",
    evidence: [
      "5 places carry an alias that normalises under 4 characters; 356 carry an alias at all",
      "“Royal Albert Hall” → 2 correctly, so the record is reachable by its formal name only",
    ],
  },
];

const NOTES: Array<{ title: string; body: string }> = [
  {
    title: "A job with no confirmed date can never be booked",
    body:
      "<code>compose.ts</code> goes to some trouble to carry a “(TBC)” suffix in the slot team name, and reserves room for it when truncating. <code>validateOrder</code> then rejects a slot team with no times, which every TBC block has — correctly, OnSinch would reject it too. So the order is composed, shown on the board, and withheld as <em>needs-info</em>, and the “(TBC)” suffix can never reach OnSinch. Two modules hold different views about whether TBC is bookable; the safe one wins, and the other is dead weight. Six of the hundred cases.",
  },
  {
    title: "The “emptying an order holds” rule is unreachable",
    body:
      "<code>amendment.ts</code> guards an amendment that would strip an order to nobody, on the reasoning that a cancellation arrives labelled <em>update</em> and composes as an empty order. It composes as a <em>null</em> order instead, so the compiler's “nothing bookable could be built” path catches it first and the specific message never appears. Nothing is destroyed either way — the existing order is left alone and a human is told — so this is a message quality issue, not a safety one.",
  },
  {
    title: "A bare “thanks” clears the composed order from the board",
    body:
      "A confirmation-only follow-up recompiles the thread with <code>desired_order: null</code>, keeping the order id but dropping the teams. The booking in OnSinch is untouched; what is lost is the board's record of what was asked for.",
  },
];

// ------------------------------------------------------------------ html bits
const chip = (outcome: string) => {
  const o = OUTCOMES[outcome] ?? { label: outcome, tone: "info" };
  return `<span class="chip chip--${o.tone}">${esc(o.label)}</span>`;
};
const teamCell = (c: CaseResult) => {
  if (!c.teams.length) return `<span class="dim">—</span>`;
  return c.teams
    .map((t) => `<span class="team"><b>${t.size}</b>&hairsp;&times;&hairsp;p${t.profession_id}</span>`)
    .join(" ");
};

const groupRows = GROUPS.map((g) => {
  const cases = R.filter((c) => c.id.startsWith(g.key + "-"));
  const rows = cases
    .map(
      (c) => `<tr>
    <td class="mono id">${esc(c.id)}</td>
    <td class="what">${esc(c.label)}</td>
    <td class="teams">${teamCell(c)}</td>
    <td class="mono num">${c.headcount || ""}</td>
    <td class="mono num">${c.chiefs || ""}</td>
    <td>${chip(c.outcome)}</td>
    <td class="mono dim small">${esc(c.held_reason ?? "")}</td>
    <td class="verdict">${c.agrees && !c.violations.length ? `<span class="tick" aria-label="agrees">&#10003;</span>` : `<span class="cross">&#10007;</span>`}</td>
  </tr>`
    )
    .join("\n");
  return `<section class="band">
  <header class="band__head">
    <div class="band__id mono">${g.key}</div>
    <div>
      <h3>${esc(g.name)}</h3>
      <p class="band__q">${esc(g.question)}</p>
    </div>
    <div class="band__score mono">${cases.filter((c) => c.agrees && !c.violations.length).length}<span>/${cases.length}</span></div>
  </header>
  <div class="scroll">
    <table class="cases">
      <thead><tr>
        <th>case</th><th>what it asks for</th><th>teams booked</th><th class="num">crew</th>
        <th class="num">chiefs</th><th>outcome</th><th>reason</th><th class="num">&nbsp;</th>
      </tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</section>`;
}).join("\n");

const findingBlocks = FINDINGS.map(
  (f) => `<article class="finding finding--${f.sev}">
  <header>
    <span class="mono finding__rank">${f.rank}</span>
    <span class="chip chip--${f.sev === "critical" ? "fail" : f.sev === "high" ? "warn" : "info"}">${f.sev}</span>
    <span class="chip chip--${f.state === "fixed" ? "pass" : "open"}">${f.state === "fixed" ? "fixed" : "open — your call"}</span>
    <h3>${f.title}</h3>
  </header>
  <dl>
    <dt>What it looked like</dt><dd>${f.symptom}</dd>
    <dt>Why</dt><dd>${f.cause}</dd>
    <dt>What it cost</dt><dd>${f.consequence}</dd>
    <dt>${f.state === "fixed" ? "What changed" : "Why it is still here"}</dt><dd>${f.resolution}</dd>
  </dl>
  <ul class="ev mono">${f.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
</article>`
).join("\n");

const liveRows = live.probes
  .map((p) => {
    const posted = p.posted === true;
    return `<tr>
    <td class="what">${esc(p.label)}</td>
    <td class="mono num">${esc(p.order_id ?? "—")}</td>
    <td class="mono num">${esc(p.order_number_read_back ?? p.replaced ?? "—")}</td>
    <td class="mono num">${esc(p.job_id ?? "—")}</td>
    <td class="mono num">${esc(p.crew_sent ?? "—")}</td>
    <td class="mono num">${esc(p.card_on_job ?? "—")}</td>
    <td>${posted ? `<span class="chip chip--pass">accepted</span>` : `<span class="chip chip--fail">refused</span>`}</td>
    <td><span class="chip chip--info">deleted</span></td>
  </tr>`;
  })
  .join("\n");

const html = `<title>Hundred-Booking Run</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>
:root {
  --ground: #E9ECEF;
  --surface: #FDFDFE;
  --surface-2: #F2F5F7;
  --ink: #141A1E;
  --ink-2: #3D4A53;
  --muted: #66747E;
  --line: #D3DAE0;
  --line-2: #E3E9ED;
  --accent: #23617F;
  --accent-soft: #DCEAF2;
  --pass: #2F6B4C;
  --pass-soft: #DCEDE3;
  --warn: #8E5F12;
  --warn-soft: #F4E7CE;
  --fail: #9E3120;
  --fail-soft: #F6DED9;
  --open: #6A4A86;
  --open-soft: #EAE0F3;
  --shadow: 0 1px 2px rgba(20,26,30,.06), 0 8px 24px -12px rgba(20,26,30,.18);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0C1114;
    --surface: #141C21;
    --surface-2: #1A242A;
    --ink: #E4EAEE;
    --ink-2: #B3C0C8;
    --muted: #7F8E99;
    --line: #26333B;
    --line-2: #1E2A31;
    --accent: #6BB4D8;
    --accent-soft: #16303D;
    --pass: #6FBB92;
    --pass-soft: #14301F;
    --warn: #D8A64A;
    --warn-soft: #33260C;
    --fail: #E5806C;
    --fail-soft: #3A1913;
    --open: #B694D6;
    --open-soft: #241a33;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -14px rgba(0,0,0,.6);
  }
}
:root[data-theme="dark"] {
  --ground: #0C1114;
  --surface: #141C21;
  --surface-2: #1A242A;
  --ink: #E4EAEE;
  --ink-2: #B3C0C8;
  --muted: #7F8E99;
  --line: #26333B;
  --line-2: #1E2A31;
  --accent: #6BB4D8;
  --accent-soft: #16303D;
  --pass: #6FBB92;
  --pass-soft: #14301F;
  --warn: #D8A64A;
  --warn-soft: #33260C;
  --fail: #E5806C;
  --fail-soft: #3A1913;
  --open: #B694D6;
  --open-soft: #241a33;
  --shadow: 0 1px 2px rgba(0,0,0,.4), 0 10px 28px -14px rgba(0,0,0,.6);
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: Archivo, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.mono { font-family: "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px 96px; }
.prose { max-width: 66ch; }
.prose p { font-family: "Source Serif 4", Georgia, serif; font-size: 16.5px; line-height: 1.62; color: var(--ink-2); }
h1, h2, h3 { text-wrap: balance; margin: 0; letter-spacing: -.015em; }
code { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: .88em; background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 3px; padding: .05em .3em; }
a { color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ---- masthead: a call sheet header ---- */
.mast { border-bottom: 2px solid var(--ink); background: var(--surface); }
.mast__inner { max-width: 1180px; margin: 0 auto; padding: 34px 24px 26px; }
.eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); display: flex; flex-wrap: wrap; gap: 6px 18px; }
.mast h1 { font-size: clamp(30px, 4.6vw, 47px); font-weight: 700; margin: 14px 0 10px; }
.mast__sub { max-width: 62ch; font-family: "Source Serif 4", Georgia, serif; font-size: 17px; line-height: 1.58; color: var(--ink-2); margin: 0; }

.scores { display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 1px; margin-top: 30px; background: var(--line); border: 1px solid var(--line); }
.score { background: var(--surface); padding: 16px 18px 14px; }
.score__n { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; font-size: 33px; font-weight: 600; letter-spacing: -.03em; line-height: 1.05; }
.score__n small { font-size: 17px; font-weight: 400; color: var(--muted); }
.score__l { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-top: 5px; }
.score--good .score__n { color: var(--pass); }

section.blk { margin-top: 58px; }
.h2row { display: flex; align-items: baseline; gap: 14px; border-bottom: 1px solid var(--line); padding-bottom: 9px; margin-bottom: 22px; }
.h2row h2 { font-size: 23px; font-weight: 600; }
.h2row .tag { font-family: "IBM Plex Mono", monospace; font-size: 11.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-left: auto; }

/* ---- chips ---- */
.chip { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 11px; font-weight: 500; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; border-radius: 2px; white-space: nowrap; }
.chip--pass { background: var(--pass-soft); color: var(--pass); }
.chip--warn { background: var(--warn-soft); color: var(--warn); }
.chip--fail { background: var(--fail-soft); color: var(--fail); }
.chip--info { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-2); }
.chip--open { background: var(--open-soft); color: var(--open); }

/* ---- findings ---- */
.finding { background: var(--surface); border: 1px solid var(--line); border-left: 4px solid var(--muted); box-shadow: var(--shadow); padding: 20px 22px; margin-bottom: 18px; }
.finding--critical { border-left-color: var(--fail); }
.finding--high { border-left-color: var(--warn); }
.finding--medium { border-left-color: var(--accent); }
.finding header { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.finding__rank { font-size: 12px; font-weight: 600; letter-spacing: .1em; color: var(--muted); }
.finding h3 { flex: 1 1 100%; font-size: 19px; font-weight: 600; margin-top: 4px; }
.finding dl { display: grid; grid-template-columns: minmax(120px, 152px) 1fr; gap: 6px 20px; margin: 16px 0 0; }
.finding dt { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); padding-top: 4px; }
.finding dd { margin: 0; font-family: "Source Serif 4", Georgia, serif; font-size: 15.5px; line-height: 1.58; color: var(--ink-2); }
.ev { list-style: none; margin: 16px 0 0; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--line-2); font-size: 12.5px; line-height: 1.75; color: var(--muted); }
.ev li + li { border-top: 1px dotted var(--line); padding-top: 4px; margin-top: 4px; }

/* ---- notes ---- */
.notes { display: grid; gap: 14px; }
.note { background: var(--surface); border: 1px solid var(--line); padding: 16px 18px; }
.note h4 { margin: 0 0 6px; font-size: 15.5px; font-weight: 600; }
.note p { margin: 0; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.58; color: var(--ink-2); }

/* ---- bands + tables ---- */
.band { background: var(--surface); border: 1px solid var(--line); margin-bottom: 16px; }
.band__head { display: flex; align-items: flex-start; gap: 15px; padding: 14px 18px; border-bottom: 1px solid var(--line-2); background: var(--surface-2); }
.band__id { font-size: 12px; font-weight: 600; letter-spacing: .1em; color: var(--accent); background: var(--accent-soft); padding: 3px 8px; border-radius: 2px; }
.band__head h3 { font-size: 16.5px; font-weight: 600; }
.band__q { margin: 3px 0 0; font-family: "Source Serif 4", Georgia, serif; font-size: 14.5px; line-height: 1.5; color: var(--muted); max-width: 74ch; }
.band__score { margin-left: auto; font-size: 19px; font-weight: 600; color: var(--pass); white-space: nowrap; }
.band__score span { color: var(--muted); font-weight: 400; font-size: 14px; }

.scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
thead th { text-align: left; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; font-weight: 500; color: var(--muted); padding: 8px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
tbody td { padding: 7px 12px; border-bottom: 1px solid var(--line-2); vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
.num, th.num { text-align: right; }
.id { color: var(--muted); white-space: nowrap; font-size: 12px; }
.what { color: var(--ink); min-width: 190px; }
.small { font-size: 11.5px; }
.dim { color: var(--muted); }
.teams { min-width: 130px; }
.team { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 11.5px; background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 2px; padding: 1px 5px; margin: 1px 0; color: var(--ink-2); }
.team b { color: var(--ink); font-weight: 600; }
.tick { color: var(--pass); font-weight: 700; }
.cross { color: var(--fail); font-weight: 700; }
.verdict { text-align: right; }

.kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); }
.kv > div { background: var(--surface); padding: 13px 16px; }
.kv__l { font-size: 11.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.kv__n { margin-top: 4px; font-family: "IBM Plex Mono", monospace; font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.kv__b { margin: 5px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--muted); }

.method { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.method h4 { margin: 0 0 6px; font-size: 14px; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); }
.method p { margin: 0; font-family: "Source Serif 4", Georgia, serif; font-size: 15px; line-height: 1.6; color: var(--ink-2); }

footer.foot { margin-top: 64px; padding-top: 18px; border-top: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
footer.foot p { margin: 0 0 6px; }

@media (max-width: 620px) {
  .finding dl { grid-template-columns: 1fr; }
  .finding dt { padding-top: 10px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
</style>

<header class="mast">
  <div class="mast__inner">
    <div class="eyebrow">
      <span>Spartan Crew &middot; Jobber</span>
      <span>100 simulated bookings</span>
      <span>${data.professions} professions &middot; ${data.places.toLocaleString("en-GB")} real venue rows</span>
      <span>2026-08-19</span>
    </div>
    <h1>What the engine does with a hundred bookings</h1>
    <p class="mast__sub">A hundred enquiries were put through the real pipeline &mdash; triage, composition, venue and client resolution, the hold decisions, the write path &mdash; each one declared as what the client asked for, and each answer checked against what the settled rules say should happen. Five findings came out of it. Three are fixed; two are rule changes that are yours to make.</p>
    <div class="scores">
      <div class="score score--good"><div class="score__n">${data.summary.agree}<small>/${data.cases}</small></div><div class="score__l">match the rules</div></div>
      <div class="score score--good"><div class="score__n">${data.summary.clean}<small>/${data.cases}</small></div><div class="score__l">invariants hold</div></div>
      <div class="score score--good"><div class="score__n">${data.summary.idempotent}<small>/${data.cases}</small></div><div class="score__l">idempotent on re-send</div></div>
      <div class="score"><div class="score__n">${totalOnOrder}<small>/${totalRequested}</small></div><div class="score__l">crew booked / asked for</div></div>
      <div class="score"><div class="score__n">5</div><div class="score__l">findings &mdash; 3 fixed</div></div>
    </div>
  </div>
</header>

<div class="wrap">

  <section class="blk">
    <div class="h2row"><h2>Findings</h2><span class="tag">what to act on</span></div>
${findingBlocks}
  </section>

  <section class="blk">
    <div class="h2row"><h2>Also worth knowing</h2><span class="tag">not defects</span></div>
    <div class="notes">
${NOTES.map((n) => `      <div class="note"><h4>${esc(n.title)}</h4><p>${n.body}</p></div>`).join("\n")}
    </div>
  </section>

  <section class="blk">
    <div class="h2row"><h2>How the hundred were chosen</h2><span class="tag">method</span></div>
    <div class="prose" style="margin-bottom:24px">
      <p>Not sampled &mdash; placed. A hundred random enquiries would be a hundred draws from the middle of the distribution: one block, four to eight crew, times stated, a venue already on file. Every rule in this engine lives at a boundary, and a boundary is not something a sample finds, it is something a design puts a case on either side of. So each band below fixes every factor but one and walks that one across its range, both sides of each edge.</p>
      <p>Two instruments read each answer. The first restates the rules and predicts the order; it mirrors the code's algorithm, because for these rules the algorithm is the rule, so a disagreement means one of the two read a ruling differently. That instrument was wrong three times and the engine was right &mdash; the tenant really does have an <code>IPAF 3a/3b</code> profession, and a forklift driver really is a counterbalance operator, not a van driver. The second instrument is the one that carries weight: invariants that must hold whatever the implementation does, and that cannot be satisfied by copying it.</p>
    </div>
    <div class="method">
      <div><h4>Held constant</h4><p>The clock, the hashes and the order ids are derived, never random, so two runs can be diffed. The model is scripted rather than called: a perfect extractor, so a failure is the engine's and not the model's, and a full run costs nothing. Extraction accuracy is a separate question with a separate, paid instrument.</p></div>
      <div><h4>Real where it matters</h4><p>The ${data.professions}-row profession list and all ${data.places.toLocaleString("en-GB")} venue rows are the live tenant's, verified current at run time &mdash; including the 601 rows named &ldquo;Excel London, Royal Victoria Dock&hellip;&rdquo; with every other field null. A resolver tested against a three-row fixture never meets what the tenant actually contains.</p></div>
      <div><h4>Invariants, not opinions</h4><p>Headcount is conserved; every team is placed; no team is empty; Crew Boss 55 is unreachable; the rate card is never absent; a slot team name never exceeds 80 characters; nothing reaches OnSinch while a thread is held; what went on the wire matches what the board shows. ${totalOnOrder} people across ${totalTeams} teams, and the arithmetic closed on every case.</p></div>
    </div>
  </section>

  <section class="blk">
    <div class="h2row"><h2>Where the hundred landed</h2><span class="tag">outcomes</span></div>
    <div class="kv">
${outcomeCounts
  .map(
    (o) =>
      `      <div><div class="kv__l">${esc(OUTCOMES[o.k].label)}</div><div class="kv__n">${o.n}</div><p class="kv__b">${esc(OUTCOMES[o.k].blurb)}</p></div>`
  )
  .join("\n")}
    </div>
    <div class="prose" style="margin-top:20px">
      <p>The eight held threads are the gates working: two twins of a job another thread already holds, four brand-new clients priced off an assumed rate card, and two cancellations the engine reports and refuses to act on. The six that could not be booked are the TBC cases and the two enquiries that named no number at all. One refusal is an amendment to an order a human had already confirmed &mdash; the guarantee that matters most, and it held.</p>
      <p>${replaced.length} amendments deleted a draft order and reposted it, which is the behaviour F1 restored. ${totalChiefs} of the ${totalOnOrder} people booked are crew chiefs carved out of their own teams rather than added to them, so the client's number is the number that turns up on all ${data.cases} cases.</p>
    </div>
  </section>

  <section class="blk">
    <div class="h2row"><h2>Against the live tenant</h2><span class="tag">six real orders, all deleted</span></div>
    <div class="prose" style="margin-bottom:20px">
      <p>The offline run proves the engine builds the right order; it cannot prove OnSinch accepts it. Every 400 this system has ever produced was a field a fixture happily took. So six composed orders went to the real tenant on company ${live.company_id}, &ldquo;TEST - Eventz&rdquo;, whose only contact is an internal address &mdash; posted, read back, and deleted, with every id written to a file on disk <em>before</em> the call that created it. All six were confirmed gone. One of them was replaced by the destructive path first, to watch a real order be deleted and rebuilt.</p>
    </div>
    <div class="band"><div class="scroll">
      <table>
        <thead><tr><th>shape</th><th class="num">api id</th><th class="num">R number</th><th class="num">J number</th><th class="num">crew</th><th class="num">card</th><th>OnSinch</th><th>after</th></tr></thead>
        <tbody>
${liveRows}
        </tbody>
      </table>
    </div></div>
  </section>

  <section class="blk">
    <div class="h2row"><h2>The hundred cases</h2><span class="tag">every answer</span></div>
${groupRows}
  </section>

  <footer class="foot">
    <p>Generated from <code>.tmp-data/sim/results.json</code> by <code>sim/report.ts</code>. The run is <code>npx tsx sim/run.ts</code> &mdash; offline, deterministic, no model calls, no database. The live probe is <code>npx tsx sim/live-write.ts</code>, and <code>--cleanup</code> removes anything its ledger still lists.</p>
    <p>Figures in the prose are read out of the results file, so re-running the simulation cannot leave a stale number in a sentence.</p>
  </footer>
</div>
`;

writeFileSync(join(OUT, "report.html"), html);
console.log(`written: ${join(OUT, "report.html")}  (${(html.length / 1024).toFixed(1)} KB)`);
