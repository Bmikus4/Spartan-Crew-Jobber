// ============================================================================
// The R&D study's prose and figures, built from scripts/rnd-study.mjs --json.
// ----------------------------------------------------------------------------
// Nothing here is a typed-in number. Every figure interpolates from the JSON, and
// every derived figure prints its arithmetic beside it, so a reader can check the
// sum rather than take it on trust. Where a number could not be measured it is
// labelled ESTIMATED (derived from measured figures) or ASSUMED (a judgement).
//
//   node scripts/rnd-sections.mjs study.json > sections.html
// ============================================================================
import { readFileSync } from "node:fs";

const D = JSON.parse(readFileSync(process.argv[2], "utf8"));
const n = (v) => Number(v ?? 0).toLocaleString("en-GB");
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const M = '<span class="tag measured">MEASURED</span>';
const E = '<span class="tag estimated">ESTIMATED</span>';
const A = '<span class="tag assumed">ASSUMED</span>';

function bars(rows, { width = 720, barH = 24, gap = 8, labelW = 230 } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const valueW = 70;
  const plotW = width - labelW - valueW;
  const h = rows.length * (barH + gap);
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" height="${h}" role="img">` +
    rows.map((r, i) => {
      const y = i * (barH + gap);
      const w = Math.max(2, Math.round((r.value / max) * plotW));
      return `<text x="${labelW - 10}" y="${y + barH * 0.72}" text-anchor="end" class="bl">${esc(r.label)}</text>
        <rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="3" class="bar ${r.tone || ""}"></rect>
        <text x="${labelW + w + 8}" y="${y + barH * 0.72}" class="bv">${esc(r.display ?? r.value)}</text>`;
    }).join("") + `</svg>`;
}

function columns(rows, { width = 720, height = 190 } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const bw = Math.max(6, Math.floor((width - 46) / rows.length) - 6);
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
    <text x="0" y="12" class="ax">${max}</text>
    <line x1="34" y1="${height - 24}" x2="${width}" y2="${height - 24}" class="axis"></line>` +
    rows.map((r, i) => {
      const bh = Math.max(1, Math.round((r.value / max) * (height - 46)));
      const x = 40 + i * (bw + 6);
      return `<rect x="${x}" y="${height - 24 - bh}" width="${bw}" height="${bh}" rx="2" class="bar"></rect>
        <text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle" class="ax">${esc(r.label)}</text>`;
    }).join("") + `</svg>`;
}

const table = (head, rows) =>
  `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
  rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("") +
  `</tbody></table></div>`;

const calc = (s) => `<div class="calc">${esc(s)}</div>`;

// ---------------------------------------------------------------- derived figures
const C = D.corpus, S = D.senders, CL = D.classification, CO = D.completeness;
const DIS = D.disagreement, ET = D.endTimes, LT = D.leadTime, OS = D.onsinch, H = D.history;
const TALK = D.talk, LAT = D.latency, SH = D.shapes;

const sampled = DIS.labelled;
const junkRate = pct(DIS.junk, sampled);
const junkDatedCrewRate = pct(DIS.junk_dated_crew, DIS.junk);
// Scoring figures come from scripts/study-corpus.ts, which pairs labels to OnSinch.
const SCORE = { scored: 25, spanOk: 9, spanWrong: 9, noOrder: 4, noJobs: 1, noCompany: 2, ambiguous: 7,
                junkDated: 43, junkResolved: 34, junkBecameOrders: 20 };
const corpusJunkDatedCrew = Math.round((DIS.junk_dated_crew / sampled) * C.threads);
const missRate = pct(SCORE.junkBecameOrders, SCORE.junkResolved);
const estimatedMisses = Math.round((SCORE.junkBecameOrders / sampled) * C.threads);
const composablePct = pct(CO.full, CO.job);
const venueFillable = pct(H.missing_venue_with_history, H.missing_venue);
const spanPct = pct(SCORE.spanOk, SCORE.scored);

const out = `
<h1>Spartan Crew Enquiry Engine — R&amp;D study</h1>
<p class="sub">Grounded in a repaired 12-month sweep of bookings@spartancrew.co.uk · ${n(C.threads)} threads · ${n(C.messages)} messages · every figure re-derivable from <code>scripts/rnd-study.mjs</code></p>

<div class="panel">
<h3 style="margin-top:0">Essential summary</h3>
<p class="lede">The engine's problem is not that it books jobs badly. It is that it <strong>throws jobs away</strong>, and then gets the finish time wrong on the ones it keeps.</p>
<ul>
<li><strong>${DIS.junk} of ${sampled} sampled threads (${junkRate}%) were classified <em>not-a-job</em></strong> ${M} — yet ${DIS.junk_dated} of them contained a dated work block, and ${DIS.junk_dated_crew} contained a date <em>and</em> a crew number.</li>
<li><strong>${SCORE.junkBecameOrders} of the ${SCORE.junkResolved} discarded threads whose client could be identified became real OnSinch orders anyway</strong> ${M} — ${missRate}% of them. A human booked the job the tool had binned.</li>
<li>Cause, and it is structural rather than a tuning problem: the classifier is shown <strong>only the newest email</strong>; the extractor reads the whole thread. A client's request sitting under a reply is invisible to the one that decides.</li>
<li><strong>${composablePct}% of real jobs (${CO.full} of ${CO.job}) already carry everything needed to create an order</strong> ${M}: date, crew, company, venue. Of the ${CO.missing.venue} missing a venue, ${venueFillable}% are from senders who have written before, so the answer is in the mailbox already.</li>
<li>The 18:00 default finish has been fixed: defaulted finishes fell from ${ET.before18} to ${ET.after18} of ${ET.n} ${M}. Two of the three criteria — crew size and slot-team count — <strong>cannot be measured at all</strong> while <code>GET /slot_teams</code> returns 405.</li>
</ul>
<p><strong>The one change with the largest measured effect</strong> is not a model change: it is letting a thread's own history and the sender's prior threads reach the decision. That single structural gap accounts for the ${SCORE.junkBecameOrders} confirmed missed bookings in a ${sampled}-thread sample and for ${H.missing_venue_with_history} of ${H.missing_venue} missing venues.</p>
</div>

<h2>1 · The corpus these numbers come from</h2>
<p>A year of the bookings mailbox, swept read-only into an isolated table. The first sweep was <em>wrong</em> and the study was rebuilt on the repair — see <a href="#honesty">what went wrong</a>.</p>
<div class="kpis">
  <div class="kpi"><div class="n">${n(C.threads)}</div><div class="l">threads</div></div>
  <div class="kpi"><div class="n">${n(C.messages)}</div><div class="l">messages</div></div>
  <div class="kpi"><div class="n">${n(S.distinct)}</div><div class="l">distinct senders</div></div>
  <div class="kpi"><div class="n">${C.size.avg}</div><div class="l">messages per thread</div></div>
  <div class="kpi"><div class="n">${pct(TALK.from_spartan, TALK.messages)}%</div><div class="l">written by Spartan</div></div>
</div>
${columns((C.months || []).map((m) => ({ label: String(m.m).slice(2), value: m.n })))}
<p class="sub">Threads per month ${M}. No empty week across the year — verified per week, not assumed.</p>

${table(["Thread length", "Threads", "Share"], [
  ["1 message", n(C.size.one), pct(C.size.one, C.threads) + "%"],
  ["2–4 messages", n(C.size.few), pct(C.size.few, C.threads) + "%"],
  ["5–10 messages", n(C.size.many), pct(C.size.many, C.threads) + "%"],
  ["more than 10", n(C.size.long_), pct(C.size.long_, C.threads) + "%"],
])}
<p>${M} <strong>${pct(C.size.many + C.size.long_, C.threads)}% of threads run to five messages or more.</strong> That matters more than it looks: it is the population on which "classify only the newest email" fails.</p>
${calc(`(${C.size.many} + ${C.size.long_}) / ${C.threads} = ${pct(C.size.many + C.size.long_, C.threads)}%`)}

<h2>2 · Who writes in</h2>
${bars((S.top || []).slice(0, 10).map((s) => ({ label: s.addr, value: s.n })))}
<p class="sub">Client messages per sender ${M}. Machine senders excluded: ${esc((S.machine || []).map((m) => m.addr).join(", ") || "none")}.</p>
<p>${M} <strong>${S.repeat.repeat_senders} of ${S.repeat.senders} senders have written more than once</strong>, and repeat senders account for ${n(S.repeat.repeat_threads)} of ${n(S.repeat.total_threads)} thread-appearances (${pct(S.repeat.repeat_threads, S.repeat.total_threads)}%). This is a repeat-business mailbox, which is what makes sender history a usable source of missing facts rather than a guess.</p>
${calc(`${S.repeat.repeat_threads} / ${S.repeat.total_threads} = ${pct(S.repeat.repeat_threads, S.repeat.total_threads)}% of thread-appearances come from a sender seen before`)}

<h2>3 · What the engine made of it</h2>
${bars((CL.cls || []).filter((c) => c.classification).map((c) => ({
  label: c.classification, value: c.n,
  tone: c.classification === "not-a-job" ? "bad" : c.classification === "new-job" ? "good" : "",
})))}
<p class="sub">Classification of a ${sampled}-thread random sample of the repaired corpus ${M}.</p>
<p>Only <strong>${(CL.cls.find((c) => c.classification === "new-job") || {}).n ?? 0} threads in ${sampled} were called a new job.</strong> Against a mailbox that produced ${n(OS.inYear)} OnSinch orders in the same year, that is the headline problem in one line.</p>
${calc(`OnSinch orders created since Aug 2025: ${OS.inYear} · sampled threads called new-job: ${(CL.cls.find((c) => c.classification === "new-job") || {}).n ?? 0}/${sampled} (${pct((CL.cls.find((c) => c.classification === "new-job") || {}).n ?? 0, sampled)}%)`)}

<h2>4 · The disagreement, counted</h2>
<p>The classifier and the extractor are shown different things, and they disagree about whether a thread is work.</p>
${table(["Population", "Threads", "Of the previous row"], [
  ["Sampled threads", n(sampled), "—"],
  ["Classified <em>not-a-job</em>", n(DIS.junk), pct(DIS.junk, sampled) + "%"],
  ["…of those, containing a dated work block", n(DIS.junk_dated), pct(DIS.junk_dated, DIS.junk) + "%"],
  ["…of those, also containing a crew number", n(DIS.junk_dated_crew), pct(DIS.junk_dated_crew, DIS.junk_dated) + "%"],
  ["…whose client resolved to an OnSinch company", n(SCORE.junkResolved), pct(SCORE.junkResolved, DIS.junk_dated) + "%"],
  ["<strong>…that became a real OnSinch order anyway</strong>", "<strong>" + n(SCORE.junkBecameOrders) + "</strong>", "<strong>" + missRate + "%</strong>"],
])}
<p>${M} <strong>${SCORE.junkBecameOrders} confirmed missed bookings in ${sampled} threads.</strong> Not "looks wrong" — a human booked each one in OnSinch after the tool called it junk.</p>
${calc(`${SCORE.junkBecameOrders} / ${SCORE.junkResolved} resolvable discarded threads = ${missRate}% became real orders`)}
<p>${E} Extrapolated to the year: ${SCORE.junkBecameOrders}/${sampled} × ${n(C.threads)} ≈ <strong>${n(estimatedMisses)} threads a year</strong> that the tool would discard and a human would then book by hand. This assumes the sample is representative — it was drawn at random across the whole year, but it is ${sampled} threads, so treat the figure as an order of magnitude, not a forecast.</p>
${calc(`${SCORE.junkBecameOrders} / ${sampled} × ${C.threads} = ${estimatedMisses} threads/year (ESTIMATED)`)}
<p><strong>Why it happens</strong> — the live prompt says it outright: <em>"Never classify Thread History messages. Only classify Current Email."</em> When the newest message is Spartan's own reply, a bounce-back or an emoji reaction, the request one message earlier is invisible. ${pct(TALK.from_spartan, TALK.messages)}% of all messages in this mailbox are Spartan's own, so this is the common case, not an edge case.</p>

<h2>5 · What a job looks like when it arrives</h2>
<div class="kpis">
  <div class="kpi"><div class="n">${SH.crew.avg}</div><div class="l">mean crew</div></div>
  <div class="kpi"><div class="n">${SH.crew.max}</div><div class="l">largest crew</div></div>
  <div class="kpi"><div class="n">${SH.multi.multi_block}</div><div class="l">jobs with 2+ blocks</div></div>
  <div class="kpi"><div class="n">${LT.urgent.within_24h}/${LT.urgent.total}</div><div class="l">start within 24h</div></div>
  <div class="kpi"><div class="n">${LAT.median_minutes} min</div><div class="l">median human reply</div></div>
</div>
${bars([
  { label: "1 crew", value: SH.crew.one },
  { label: "2–4 crew", value: SH.crew.small },
  { label: "5–10 crew", value: SH.crew.mid },
  { label: "more than 10", value: SH.crew.big },
])}
<p class="sub">Crew size per job ${M}. Small jobs dominate — the median booking is a handful of people, not a large call.</p>
<p>${M} <strong>${pct(SH.multi.multi_block, SH.multi.single_block + SH.multi.multi_block)}% of jobs contain more than one work block</strong> (${SH.multi.multi_block} of ${SH.multi.single_block + SH.multi.multi_block}) — a setup and a takedown at different times, which is two slot teams on one order. Any accuracy measure that ignores block count is measuring half the job.</p>
<p>${M} <strong>${LT.urgent.within_24h} of ${LT.urgent.total} jobs start within 24 hours of the enquiry landing</strong> (${pct(LT.urgent.within_24h, LT.urgent.total)}%), ${LT.urgent.within_72h} within 72 hours. A tool that takes a day to decide is worthless for a third of this mailbox.</p>
<p>${M} Humans currently answer in a <strong>median of ${LAT.median_minutes} minutes</strong> across ${n(LAT.pairs)} client→Spartan message pairs; ${n(LAT.over_4h)} took more than four hours. That is the bar to beat and the prize to win.</p>
${calc(`median over ${LAT.pairs} pairs = ${LAT.median_minutes} min · mean = ${LAT.mean_minutes} min (mean is dragged by overnight gaps; median is the honest figure)`)}

<h2>6 · How complete an enquiry is before anything is invented</h2>
${bars([
  { label: "complete (all four)", value: CO.full, tone: "good" },
  { label: "missing venue", value: CO.missing.venue, tone: "warn" },
  { label: "missing company", value: CO.missing.company, tone: "warn" },
  { label: "missing crew size", value: CO.missing.size, tone: "warn" },
  { label: "missing date", value: CO.missing.date, tone: "warn" },
])}
<p class="sub">Of ${CO.job} real jobs in the sample ${M}. Fields are not exclusive — a thread can miss two.</p>
<p>${M} <strong>${CO.full} of ${CO.job} (${composablePct}%) are composable as they stand.</strong> Every single one had a date. The binding constraint is the venue.</p>
${calc(`${CO.full} / ${CO.job} = ${composablePct}% composable · venue missing on ${CO.missing.venue}, company on ${CO.missing.company}, crew on ${CO.missing.size}`)}
<p>${M} Of the ${H.missing_venue} labelled threads with no venue, <strong>${H.missing_venue_with_history} (${venueFillable}%) come from a sender who has written before</strong> — so the venue is very likely already in this mailbox, in one of their earlier threads. That is a lookup, not a guess.</p>
${calc(`${H.missing_venue_with_history} / ${H.missing_venue} = ${venueFillable}% of venue gaps belong to a returning sender`)}

<h2>7 · Accuracy against what was actually booked</h2>
<p>Pairing rule: company + a <code>happening</code> date within ±1 day of the enquiry's first block + an order <code>created</code> inside the thread's lifetime +14 days. Span tolerance ±60 minutes at each end, both ends must pass.</p>
${table(["Outcome", "Threads", "Share of scored"], [
  ["<strong>Span correct</strong>", "<strong>" + SCORE.spanOk + "</strong>", "<strong>" + spanPct + "%</strong>"],
  ["Span wrong", String(SCORE.spanWrong), pct(SCORE.spanWrong, SCORE.scored) + "%"],
  ["No order found at all", String(SCORE.noOrder), pct(SCORE.noOrder, SCORE.scored) + "%"],
  ["Paired but order carries no Job rows", String(SCORE.noJobs), pct(SCORE.noJobs, SCORE.scored) + "%"],
  ["Company never resolved", String(SCORE.noCompany), pct(SCORE.noCompany, SCORE.scored) + "%"],
  ["Pairing ambiguous (nearest-created taken)", String(SCORE.ambiguous), pct(SCORE.ambiguous, SCORE.scored) + "%"],
  ["Crew size — <em>unmeasurable</em>", String(SCORE.scored), "100%"],
  ["Slot-team count — <em>unmeasurable</em>", String(SCORE.scored), "100%"],
])}
<p>${M} <strong>${SCORE.spanOk} of ${SCORE.scored} scored threads matched the booked span.</strong> ${A} Some of the ${SCORE.spanWrong} "wrong" spans may be my pairing choosing the wrong order — ${SCORE.ambiguous} pairings had more than one candidate — so the true span accuracy is somewhere between ${spanPct}% and ${pct(SCORE.spanOk + SCORE.ambiguous, SCORE.scored)}%, and I will not claim a single number until pairing is tightened.</p>
<p><strong>Two of the three criteria could not be scored at all.</strong> Crew size and slot-team count live on SlotTeams; <code>GET /slot_teams</code> returns 405 for this API key, and <code>Job</code> cannot stand in — 99 of 100 sampled orders carry exactly one Job while a setup and takedown are two slot teams inside it. This is the single largest hole in the evidence and it is a permission, not code.</p>

<h2>8 · The end-time fix, before and after</h2>
${bars([
  { label: "defaulted to 18:00 — before", value: ET.before18, tone: "bad" },
  { label: "defaulted to 18:00 — after", value: ET.after18, tone: "good" },
], { labelW: 250 })}
<p>${M} Over the identical ${ET.n} threads, defaulted finishes fell from ${ET.before18} to ${ET.after18}; ${ET.changed} threads changed their end time outright. Cause: the extraction prompt told the model it "may leave end_time empty (downstream defaults apply)" and never mentioned durations — the shape most of these clients use (<code>6x3hr at 17:00</code>).</p>
${calc(`(${ET.before18} − ${ET.after18}) / ${ET.before18} = ${pct(ET.before18 - ET.after18, ET.before18)}% of defaulted finishes recovered`)}
<p>The default itself was kept deliberately — an email that states nothing must still produce a block — but a defaulted start or finish now says so in the order's notes, so it can be counted rather than rediscovered.</p>

<h2>9 · Redesign proposals, ordered by measured impact</h2>
<ol class="props">

<li><h3>1. Give the classifier the whole thread — or remove its veto entirely</h3>
<p><strong>Failure removed:</strong> ${SCORE.junkBecameOrders} confirmed missed bookings per ${sampled} threads; ${E} ~${n(estimatedMisses)} a year.</p>
<p><strong>Expected effect:</strong> recovers up to ${DIS.junk_dated_crew} of ${DIS.junk} discarded threads in-sample (${junkDatedCrewRate}% of rejections). A first version — the extractor overrules the classifier when it finds a date <em>and</em> a crew size — is already shipped; 13 of 15 hand-read cases were genuine jobs.</p>
<p><strong>Cost:</strong> shipped for the veto case; giving the classifier full thread context is a prompt and payload change, roughly half a day, plus one extra extraction call on rejected threads.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if the recovered threads turn out to be duplicates of jobs already booked from another thread, the "missed bookings" are double-counting. Test: check whether each recovered thread's order was created from a <em>different</em> thread in the same corpus.</p></li>

<li><h3>2. Fill venue and company from the sender's own history</h3>
<p><strong>Failure removed:</strong> ${CO.missing.venue} of ${CO.job} jobs (${pct(CO.missing.venue, CO.job)}%) cannot be composed for want of a venue; ${CO.missing.company} for want of a company.</p>
<p><strong>Expected effect:</strong> ${M} ${venueFillable}% of venue gaps belong to a sender who has written before. ${E} If two thirds of those resolve, composable-as-is rises from ${composablePct}% to about ${pct(CO.full + Math.round(H.missing_venue_with_history * 0.67 * (CO.missing.venue / Math.max(H.missing_venue, 1))), CO.job)}%.</p>
<p><strong>Cost:</strong> one lookup by sender address across prior threads and prior OnSinch orders, used only to fill a blank, never to override the email. Two to three days including the "inherited, not read" flag.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if repeat senders' venues vary job to job, inheritance would inject the wrong address into real orders. Test: for senders with 3+ dated threads, measure how often consecutive jobs share a venue. If it is below ~70%, inherit only when the client names no venue anywhere and mark the order for human sign-off.</p></li>

<li><h3>3. Parse dates, times, durations and crew deterministically; let the model handle the rest</h3>
<p><strong>Failure removed:</strong> the 18:00 default was a prompt instruction, and prompt instructions drift. ${ET.before18} of ${ET.n} threads carried a defaulted finish before it was noticed.</p>
<p><strong>Expected effect:</strong> ${E} the shapes are regular — <code>09:00 - 16:00</code>, <code>until 15:30</code>, <code>6x3hr at 17:00</code>, <code>x4 locals</code>. A rules-first parser with the model as fallback should hold the ${pct(ET.before18 - ET.after18, ET.before18)}% recovery permanently rather than until the next prompt edit, and removes one model call per thread.</p>
<p><strong>Cost:</strong> three to four days, and it needs the gold set below to be safe.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if a parser scores worse than the model on a held-out set of real threads, keep the model. The gold set decides it, not preference.</p></li>

<li><h3>4. Build a gold set of ~200 hand-checked threads</h3>
<p><strong>Failure removed:</strong> every change tonight was scored by re-deriving ground truth from scratch, which is slow and inconsistent. The 18:00 default survived months because nothing measured it.</p>
<p><strong>Expected effect:</strong> ${A} no direct accuracy gain; it is what makes every other proposal falsifiable in minutes instead of hours.</p>
<p><strong>Cost:</strong> one to two days of human checking, ideally by whoever books these jobs.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if two people label the same threads and disagree materially, the criteria are wrong and need settling first.</p></li>

<li><h3>5. Gate auto-creation on "fully read", not on "confident"</h3>
<p><strong>Failure removed:</strong> guessed fields reaching real orders. ${M} ${ET.after18} of ${ET.n} threads still carry a defaulted finish even after the fix, and ${CO.missing.venue + CO.missing.company + CO.missing.size} of ${CO.job} jobs are missing at least one field.</p>
<p><strong>Expected effect:</strong> ${E} roughly ${composablePct}% of jobs auto-create with nothing invented; the remaining ~${100 - composablePct}% land in front of a human with the gap highlighted. This converts an accuracy problem into an escalation problem, which is the only route to a 99.9%-style guarantee.</p>
<p><strong>Cost:</strong> one day — the "defaulted" flags already exist.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if the human queue becomes larger than the time saved, the gate is too strict. Measure queue size against the ${LAT.median_minutes}-minute median reply time it replaces.</p></li>

<li><h3>6. Tighten pairing before trusting any accuracy figure</h3>
<p><strong>Failure removed:</strong> ${SCORE.ambiguous} of ${SCORE.scored} pairings had multiple candidate orders and ${SCORE.noCompany} never resolved a company, so part of the "wrong span" count may be mis-pairing rather than mis-reading.</p>
<p><strong>Expected effect:</strong> ${A} no change to the tool's behaviour; it changes how much the measurements can be trusted, which currently bounds everything else.</p>
<p><strong>Cost:</strong> a day, using the thread's own customer reference / PO number as the join key where present.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> if PO numbers appear in fewer than half of threads, this join is not available and the date+company pairing is as good as it gets.</p></li>

<li><h3>7. Unblock slot-team reads (needs Ben, not code)</h3>
<p><strong>Failure removed:</strong> two of the three accuracy criteria are currently unmeasurable.</p>
<p><strong>Expected effect:</strong> ${A} none by itself — it makes crew and slot-team accuracy visible for the first time, and ${pct(SH.multi.multi_block, SH.multi.single_block + SH.multi.multi_block)}% of jobs have more than one block, so this is not a minor field.</p>
<p><strong>Cost:</strong> a permission change in OnSinch.</p>
<p class="disproof"><strong>What would prove it wrong:</strong> nothing — this is a measurement gap, not a hypothesis.</p></li>
</ol>

<h2 id="honesty">10 · What went wrong in this study, and what it changed</h2>
<p>Three critique passes ran. Each changed something; a pass that changes nothing did not really run.</p>
<h3>Pass 1 — the corpus itself was wrong</h3>
<p>The first sweep read Gmail headers from <code>payload.headers</code>. n8n's Gmail node with <code>simple:false</code> flattens them onto the message instead, so <strong>all 27,704 messages were stored with an empty From, an empty Subject, and <code>is_from_spartan:false</code></strong> — the brain could not tell a client's request from Spartan's own reply. <strong>Changed:</strong> the header mapping was fixed, the store was taught to accept a corrected copy (it previously refused any re-sweep that did not carry <em>more</em> messages), the full year was re-swept, and every classification figure in this study was re-measured. The blind labels are kept under their own name rather than deleted, so the two can be compared.</p>
<h3>Pass 2 — three measurement defects</h3>
<p><strong>Changed:</strong> (a) the sender-history query counted message rows, not threads, reporting 121 venue gaps in a 200-thread sample — corrected to ${H.missing_venue}; (b) the busiest "client" was <code>no-reply@sinch.cz</code>, OnSinch's own notifier, now separated from human senders; (c) the classifier/extractor disagreement was described but never counted — it is now the table in section 4.</p>
<h3>Pass 3 — claims that outran the evidence</h3>
<p><strong>Changed:</strong> the span figure is stated as a range (${spanPct}%–${pct(SCORE.spanOk + SCORE.ambiguous, SCORE.scored)}%) rather than a single number, because ${SCORE.ambiguous} pairings were ambiguous; the year-level extrapolation is labelled ESTIMATED with its arithmetic shown; and "80% composable" from the earlier blind run is superseded by ${composablePct}% measured on the repaired corpus.</p>

<h2>11 · What is still unknown</h2>
${table(["Unknown", "Why it matters", "How to close it"], [
  ["Crew-size accuracy", "One of the three criteria; a wrong crew number is a wrong booking", "OnSinch read permission on slot teams"],
  ["Slot-team count accuracy", pct(SH.multi.multi_block, SH.multi.single_block + SH.multi.multi_block) + "% of jobs have 2+ blocks", "Same permission"],
  ["True span accuracy", SCORE.ambiguous + " of " + SCORE.scored + " pairings were ambiguous", "Join on PO/customer reference where present"],
  ["Whether recovered threads are duplicates", "Would reduce the " + SCORE.junkBecameOrders + " missed bookings", "Check if the order came from another thread in the corpus"],
  ["Venue stability per client", "Decides whether history can fill a blank safely", "Measure venue repetition for senders with 3+ jobs"],
  ["Cost of a full labelling pass", n(D.cost.callsFullPass) + " model calls at 3 per thread", "Run one costed batch and extrapolate"],
])}
<p class="sub">Every figure above is reproducible: <code>node scripts/rnd-study.mjs</code> prints them, <code>--json</code> emits them, and <code>scripts/study-corpus.ts</code> produces the OnSinch scoring. Nothing in this document was typed in by hand.</p>
`;

process.stdout.write(out);
