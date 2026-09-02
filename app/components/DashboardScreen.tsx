"use client";

// Dashboard — what the enquiry engine has done, and what is waiting.
//
// THE ONE IDEA THIS SCREEN IS BUILT ON: a count of EVENTS and a count of THINGS are
// different questions, and the old screen asked the second while printing the answer
// to the first. Its headline tiles read "Awaiting confirm 24" and "32 need a human"
// from the event log, while the Jobs Board those numbers describe said 9 and 12. The
// log records what HAPPENED — a thread re-processed three times flags three times,
// and a proposal that was later superseded stays proposed in the log forever.
//
// So the screen is now in two halves that are labelled apart:
//
//   RIGHT NOW    counted in threads, from the tickets table. A queue you can act on.
//   OVER THE WINDOW   counted in events, from the log. Flow, which the log is right for.
//
// The second change is that four sparklines became one chart. Four 200x32 sparklines
// answer "is this roughly rising?" four times and nothing else — no axis, no date, no
// value at a point — so the tiles are now the SELECTOR for a single real chart, which
// is the same conclusion the quote tool's dashboard reached.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CHART, GridLine, InfoDot, Plot } from "./charts/chartKit";
import { BeamRing } from "./BeamRing";

interface Props { isActive: boolean }

interface StateCounts {
  live: number; awaiting_confirm: number; needs_human: number;
  with_order: number; failed: number; dismissed: number;
}

interface Metrics {
  enabled: boolean;
  days: number;
  emails_received: number;
  threads_processed: number;
  filtered_out: number;
  job_requests: number;
  replies_drafted: number;
  orders_proposed: number;
  awaiting_confirmation: number;
  orders_created: number;
  orders_updated: number;
  needs_human: number;
  order_errors: number;
  hands_free_rate: number;
  hours_saved: number;
  clients_served: number;
  minutes_per_email?: number;
  now?: StateCounts | null;
  series: { date: string; [k: string]: number | string }[];
  firstEventAt: string | null;
  lastEventAt: string | null;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");
const fmt1 = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const A = "var(--accent)";
const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const FAINT = "var(--text-faint)";
const BORDER = "var(--border)";

// ── card ─────────────────────────────────────────────────────────────────────
// The ground is --chart-surface, a step off the panel it sits on, so a chart reads
// as an object ON the page rather than a hairline drawn on it. A role token, not
// raw --surface-2: the elevation order inverts between the themes.
function Card({ title, caption, info, className, children, style }: {
  title?: string; caption?: string; info?: string; className?: string;
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div className={`dash-card${className ? ` ${className}` : ""}`}
      style={{ background: "var(--chart-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "14px 16px 22px", ...style }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB }}>{title}</span>
          {caption && <span style={{ fontSize: 10.5, color: FAINT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption}</span>}
        </div>
      )}
      {children}
      {info && <InfoDot text={info} />}
    </div>
  );
}

// ── right now: the queue, in threads ─────────────────────────────────────────
// Four readings of one instrument, divided by rules rather than gaps. Each is a
// number of THREADS and each is clickable in the sense that matters — it names a
// lane of the Jobs Board, so the caption says which.
function QueueStrip({ now, onOpenBoard }: { now: StateCounts | null | undefined; onOpenBoard?: () => void }) {
  const cells: { label: string; value: string; sub: string; tone: string }[] = now
    ? [
        { label: "Awaiting confirm", value: fmtInt(now.awaiting_confirm), sub: "staged, needs a click", tone: now.awaiting_confirm > 0 ? A : MUT },
        { label: "Needs a human", value: fmtInt(now.needs_human), sub: "missing something only a person has", tone: now.needs_human > 0 ? "var(--warn)" : MUT },
        { label: "With an order", value: fmtInt(now.with_order), sub: `of ${fmtInt(now.live)} live threads`, tone: "var(--up)" },
        { label: "Failed", value: fmtInt(now.failed), sub: "an OnSinch write threw", tone: now.failed > 0 ? "var(--down)" : MUT },
      ]
    : [];

  return (
    <section style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB }}>Right now</span>
        <span style={{ fontSize: 10.5, color: FAINT }}>
          counted in threads{onOpenBoard ? " · " : ""}
          {onOpenBoard && (
            <button onClick={onOpenBoard} style={{ background: "none", border: "none", padding: 0, font: "inherit", color: A, cursor: "pointer", fontWeight: 600 }}>
              open the board
            </button>
          )}
        </span>
      </div>
      {!now ? (
        // Not zeros. The tickets table being unreachable is not the same as an empty
        // queue, and a dashboard that renders the two identically is the reason
        // nobody trusts a dashboard.
        <div style={{ padding: "18px 16px", fontSize: 12.5, color: MUT }}>
          The ticket store is unreachable, so the live queue is unknown. The window figures below come from the event log and are unaffected.
        </div>
      ) : (
        <div className="metric-strip">
          {cells.map((c) => (
            <div key={c.label} className="metric-strip__cell metric-strip__cell--flat">
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: MUT, marginBottom: 8 }}>{c.label}</div>
              <div className="tnum" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: c.tone }}>{c.value}</div>
              <div style={{ fontSize: 11, color: FAINT, marginTop: 7 }}>{c.sub}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── over the window: flow, as a selectable strip over one real chart ─────────
type FlowKey = "email_received" | "job_detected" | "order_created" | "order_error";

const FLOW: Record<FlowKey, { label: string; total: (m: Metrics) => number; sub: (m: Metrics) => string; color: string; info: string }> = {
  email_received: {
    label: "Emails intook", color: A,
    total: (m) => m.emails_received,
    sub: (m) => `${fmtInt(m.filtered_out)} filtered out as not a job`,
    info: "Every inbound message the engine read in this window, including the ones it correctly threw away. One email, not one thread — a conversation of six emails counts six times.",
  },
  job_detected: {
    label: "Job requests", color: "var(--viz-teal)",
    total: (m) => m.job_requests,
    sub: (m) => `${fmtInt(m.threads_processed)} threads compiled`,
    info: "Emails the classifier judged to be a request for crew — a new job or a change to one. Counted per email, so a thread that is updated twice contributes twice.",
  },
  order_created: {
    label: "Orders written", color: "var(--viz-blue)",
    total: (m) => m.orders_created,
    sub: (m) => `${fmtInt(m.orders_updated)} existing orders updated`,
    info: "Orders this engine created in OnSinch during the window. It is NOT the number of threads that have an order: most threads inherit an order raised by hand, which is why 'With an order' above is much larger.",
  },
  order_error: {
    label: "Write failures", color: "var(--down)",
    total: (m) => m.order_errors,
    sub: () => "OnSinch rejected the write",
    info: "Times a write to OnSinch actually threw. This tile used to draw a flat sparkline from a hardcoded [0, 0] because the daily series had no column for it — now it plots the real thing.",
  },
};

/**
 * Period-over-period, suppressed wherever it would be decoration rather than
 * measurement.
 *
 * The guard is deliberately strict, because the first version was not and it
 * published "▲254%" against emails intook. That number was real arithmetic and
 * still meaningless: the two halves being compared were the week the engine was
 * being switched on and the week after, so it measured the rollout. A trend needs
 * both a big enough base AND enough days on each side of the split to be a trend
 * and not the shape of the launch.
 */
// Two weeks per half. Seven was not enough: with 15 days of history the earlier half
// IS the week the engine was switched on, so it cleared a base of 10 easily and
// published "▲256%" — a measurement of the rollout wearing the clothes of a trend.
// Any split of a fortnight's data has the same defect, so the honest answer until
// there are four weeks is to say nothing.
const DELTA_MIN_DAYS = 14;  // per half
const DELTA_MIN_BASE = 10;  // events in the earlier half

function delta(values: number[]): { pct: number; dir: "up" | "down" | "flat" } | null {
  const n = values.length;
  if (n < DELTA_MIN_DAYS * 2) return null;
  const half = Math.floor(n / 2);
  const prior = values.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = values.slice(half).reduce((a, b) => a + b, 0);
  if (prior < DELTA_MIN_BASE) return null;
  const pct = Math.round(((recent - prior) / prior) * 100);
  return { pct, dir: pct > 2 ? "up" : pct < -2 ? "down" : "flat" };
}

function Delta({ d, goodDown }: { d: ReturnType<typeof delta>; goodDown?: boolean }) {
  if (!d) return null;
  if (d.dir === "flat") return <span style={{ fontSize: 10.5, color: FAINT }}>level</span>;
  const good = goodDown ? d.dir === "down" : d.dir === "up";
  const color = good ? "var(--up)" : "var(--down)";
  return (
    <span className="tnum" style={{ fontSize: 10.5, fontWeight: 700, color, display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span aria-hidden>{d.dir === "up" ? "▲" : "▼"}</span>{Math.abs(d.pct)}%
    </span>
  );
}

function FlowExplorer({ m, plotted }: { m: Metrics; plotted: Metrics["series"] }) {
  const [sel, setSel] = useState<FlowKey>("email_received");
  const [hover, setHover] = useState<number | null>(null);
  const keys = Object.keys(FLOW) as FlowKey[];

  const values = plotted.map((r) => Number(r[sel] || 0));
  const n = values.length;
  const conf = FLOW[sel];
  const H = 240, L = 44, PAD = 14, base = H - 26;
  const max = Math.max(1, ...values);
  const yTicks = [0, Math.round(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const total = values.reduce((a, b) => a + b, 0);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left - L) / Math.max(1, b.width - L - PAD)) * (n - 1)))));
  };

  return (
    <section style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "11px 16px", borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB }}>Over the window</span>
        <span style={{ fontSize: 10.5, color: FAINT }}>counted in events · pick one to plot</span>
      </div>

      <div className="metric-strip" role="tablist" aria-label="Which flow to plot">
        {keys.map((k) => {
          const active = k === sel;
          const c = FLOW[k];
          const series = plotted.map((r) => Number(r[k] || 0));
          return (
            <button key={k} role="tab" aria-selected={active} className="metric-strip__cell"
              onClick={() => { setSel(k); setHover(null); }}
              style={{ borderBottom: `2px solid ${active ? c.color : "transparent"}`, background: active ? "var(--surface-hover)" : undefined }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: active ? SUB : MUT }}>{c.label}</span>
                <Delta d={delta(series)} goodDown={k === "order_error"} />
              </div>
              <div className="tnum" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: active ? INK : SUB }}>
                {fmtInt(c.total(m))}
              </div>
              <div style={{ fontSize: 11, color: FAINT, marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.sub(m)}</div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: "16px 16px 12px", position: "relative" }}>
        <Plot height={H} glowColor={conf.color} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          ariaLabel={`${conf.label} per day, ${total} in total`}>
          {({ w, glowId }) => {
            const x = (i: number) => (n <= 1 ? (L + w - PAD) / 2 : L + (i * (w - L - PAD)) / (n - 1));
            const y = (v: number) => base - (v / max) * (base - 16);
            // CAPPED. Dividing the width by the number of days is right for 90 days
            // and absurd for 15: on a 1700px panel it gave 110px-wide bars, so a
            // daily series read as five grey slabs and the line looked like it was
            // tracing their tops rather than carrying the trend.
            const bw = Math.min(22, Math.max(2, (w - L - PAD) / Math.max(1, n) - 2));
            const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
            // Bars for the day, a line for the shape. The bars carry the reading a
            // single day needs and the line carries the trend; the old chart had
            // bars alone, with no axis to read them against.
            return (
              <>
                {yTicks.map((t) => <GridLine key={t} y={y(t)} label={fmtInt(t)} x1={L} x2={w - PAD} />)}
                {values.map((v, i) => v > 0 && (
                  <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={base - y(v)} rx={1.5}
                    fill={conf.color} opacity={0.22 + 0.5 * (v / max)} />
                ))}
                {total > 0 && (
                  <path d={`M${line}`} fill="none" stroke={conf.color} strokeWidth={CHART.stroke}
                    strokeLinecap="round" strokeLinejoin="round" filter={`url(#${glowId})`} opacity={0.95} />
                )}
                {hover != null && values[hover] != null && (
                  <>
                    <line x1={x(hover)} y1={12} x2={x(hover)} y2={base} stroke={CHART.grid} strokeWidth={1} strokeDasharray="3 3" />
                    <circle cx={x(hover)} cy={y(values[hover])} r={CHART.dotR} fill={conf.color} stroke={CHART.dotRing} strokeWidth={2} />
                  </>
                )}
                {[0, n - 1].map((i) => (
                  <text key={i} x={i === 0 ? L : w - PAD} y={H - 8} fontSize={CHART.tickFont} fill={CHART.tickFill} textAnchor={i === 0 ? "start" : "end"}>
                    {String(plotted[i]?.date ?? "").slice(5)}
                  </text>
                ))}
              </>
            );
          }}
        </Plot>
        <div style={{ height: 16, textAlign: "center", fontSize: 11, color: MUT, marginTop: 4 }}>
          {hover != null && plotted[hover]
            ? <><b className="tnum" style={{ color: INK }}>{fmtInt(values[hover])}</b> on {plotted[hover].date}</>
            : total === 0
            ? <span style={{ color: FAINT }}>nothing recorded in this window</span>
            : <span style={{ color: FAINT }}>hover for a day</span>}
        </div>
        <InfoDot text={conf.info} />
      </div>
    </section>
  );
}

// ── the funnel ───────────────────────────────────────────────────────────────
// Intake to booking. Each step is shaded by its own conversion rather than every
// bar wearing one flat opacity, so where the volume falls away is visible without
// reading the numbers.
function Funnel({ m, label }: { m: Metrics; label: string }) {
  const steps = [
    { label: "Emails intook", v: m.emails_received },
    { label: "Job requests", v: m.job_requests },
    { label: "Replies drafted", v: m.replies_drafted },
    { label: "Orders staged", v: m.orders_proposed },
    { label: "Orders written", v: m.orders_created },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  return (
    <Card title="Enquiry → booking" caption={label}
      info="Each bar is a share of the widest one, and the right-hand figure is the conversion from the step above. Replies drafted sits at zero while AI replies are switched off in Settings — that is a setting, not a fault.">
      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {steps.map((s, i) => {
          const pct = Math.round((s.v / max) * 100);
          const prev = i > 0 ? steps[i - 1].v : s.v;
          const conv = i > 0 && prev > 0 ? Math.round((s.v / prev) * 100) : null;
          const dead = s.v === 0;
          return (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 104, fontSize: 12, color: dead ? MUT : SUB, flexShrink: 0 }}>{s.label}</span>
              <div style={{ flex: 1, height: 20, background: "var(--surface-2)", borderRadius: 5, overflow: "hidden" }}>
                <div style={{ width: `${Math.max(pct, s.v > 0 ? 4 : 0)}%`, height: "100%", background: A, opacity: 0.28 + 0.42 * (s.v / max), borderRadius: 5, transition: "width 400ms var(--nav-ease)" }} />
              </div>
              <span className="tnum" style={{ width: 42, textAlign: "right", fontSize: 13.5, fontWeight: 700, color: dead ? MUT : INK }}>{fmtInt(s.v)}</span>
              {/* An empty cell, not a "—" in transparent ink: the old row rendered a
                  dash it then hid, which is a character nobody can select or read. */}
              <span className="tnum" style={{ width: 38, textAlign: "right", fontSize: 11, color: MUT }}>{conv != null ? `${conv}%` : ""}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── the gate ─────────────────────────────────────────────────────────────────
// The red→green ramp is interpolated in OKLCH, not hex or HSL: OKLCH holds
// lightness and chroma steady while only the hue turns, so every colour along the
// sweep has the same visual weight. The same ramp in RGB dips muddy-brown through
// the middle and in HSL blows out to a pale yellow that reads as a highlight.
//
// t is a fraction of the WHOLE circle, not of the swept arc, which is what makes
// the ring encode the value: a 40% share never gets past orange, so the colour at
// the arc's tip IS the reading.
function ramp(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const L = 0.58 + (0.72 - 0.58) * k;
  const C = 0.21 + (0.19 - 0.21) * k;
  const H = 27 + (145 - 27) * k;
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
}

function GateRing({ m }: { m: Metrics }) {
  const frac = Math.max(0, Math.min(1, (m.hands_free_rate || 0) / 100));
  const pct = Math.round(frac * 100);
  const S = 168, C = S / 2, r = 62;
  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [C + r * Math.cos(rad), C + r * Math.sin(rad)];
  };
  const sweep = frac * 360;
  // A stroke cannot carry a gradient that follows a circle — SVG has no conic
  // gradient — so the arc is a run of short segments each stroked with its own point
  // on the ramp. Segments overlap by half a degree because butt caps meeting exactly
  // at a shared angle leave a hairline of background at fractional pixel ratios.
  const segs = Math.max(1, Math.ceil(sweep / 3.75));
  const arc = Array.from({ length: segs }, (_, i) => {
    const a0 = (i / segs) * sweep;
    const a1 = ((i + 1) / segs) * sweep + (i < segs - 1 ? 0.5 : 0);
    const [x0, y0] = polar(a0), [x1, y1] = polar(a1);
    return { d: `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`, stroke: ramp(((i + 0.5) / segs) * frac) };
  });
  const tip = ramp(frac);
  return (
    <Card title="Cleared the gate" caption={`${pct}% of job requests`} className="dash-square"
      info="The share of job requests the engine handled without flagging a human. This was labelled 'hands-free rate', which it is not: in draft-only mode every order still waits for someone to click confirm, so nothing is hands-free. What it measures is the confidence gate — how often the engine had everything it needed.">
      <div className="dash-square__body">
        <svg viewBox={`0 0 ${S} ${S}`} className="dash-square__ring" role="img" aria-label={`${pct}% of job requests cleared the confidence gate`}>
          <circle cx={C} cy={C} r={r} fill="none" stroke={BORDER} strokeWidth={12} />
          {frac > 0 && (
            <>
              {arc.map((s, i) => <path key={i} d={s.d} fill="none" stroke={s.stroke} strokeWidth={12} strokeLinecap="butt" />)}
              <circle cx={polar(0)[0]} cy={polar(0)[1]} r={6} fill={ramp(0)} />
              <circle cx={polar(sweep)[0]} cy={polar(sweep)[1]} r={6} fill={tip} />
            </>
          )}
          <text x={C} y={C - 2} textAnchor="middle" fontSize={30} fontWeight={700} fill={frac > 0 ? tip : INK} className="tnum">{pct}%</text>
          <text x={C} y={C + 18} textAnchor="middle" fontSize={9.5} letterSpacing="0.1em" fill={MUT} style={{ textTransform: "uppercase" }}>cleared</text>
        </svg>
        <div style={{ display: "flex", gap: 20, flexShrink: 0 }}>
          <div style={{ textAlign: "center" }}>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: INK }}>{fmtInt(m.job_requests - m.needs_human)}</div>
            <div style={{ fontSize: 10.5, color: MUT }}>clean</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div className="tnum" style={{ fontSize: 16, fontWeight: 700, color: "var(--warn)" }}>{fmtInt(m.needs_human)}</div>
            <div style={{ fontSize: 10.5, color: MUT }}>flagged</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── hours reclaimed ──────────────────────────────────────────────────────────
// A cumulative step curve, because the quantity is banked: it only ever goes up,
// and what a reader wants from it is "how much, by when". Drawn against the model
// that produced it, which is stated on the card rather than left implicit — the old
// screen printed "30.7h · from handled email" and never said what an hour was.
function HoursChart({ m, plotted, minutes, ringed }: { m: Metrics; plotted: Metrics["series"]; minutes: number; ringed?: boolean }) {
  const H = 178, L = 44, PAD = 12, base = H - 24;
  const perDay = plotted.map((r) => (Number(r["email_received"] || 0) * minutes) / 60);
  const cum: number[] = [];
  perDay.reduce((acc, v, i) => (cum[i] = acc + v), 0);
  const n = cum.length;
  const last = cum[n - 1] ?? 0;
  const max = Math.max(0.5, last);
  return (
    <Card title="Hours reclaimed" caption={`${fmt1(last)}h banked`}
      info={`An estimate, not a measurement: every email the engine read is credited ${minutes} minutes of the reading, classifying and typing a person would otherwise have done. The curve is that rate applied to the emails that actually arrived, so it steps up on busy days and is flat when the inbox is quiet.`}>
      {/* Inside the Card, so it rings the card's own radius. Card is position:
          relative via .dash-card, which the ring's absolute inset needs. */}
      {ringed && <BeamRing radius={12} thickness={1.5} duration={6} blob={200} />}
      {/* The hero states its reading before its curve. A cumulative line already
          ends at the number, but the label at the line's tip is 12px and set inside
          the plot — findable, not first. */}
      {ringed && (
        <div className="dash-hero__value">
          <b style={{ color: INK }} className="tnum">{fmt1(last)}h</b>
          <span style={{ fontSize: 12, color: MUT }}>reclaimed so far</span>
        </div>
      )}
      <Plot height={H} glowColor={A} ariaLabel={`${fmt1(last)} hours reclaimed, cumulative`}>
        {({ w, glowId }) => {
          const x = (i: number) => (n <= 1 ? (L + w - PAD) / 2 : L + (i * (w - L - PAD)) / (n - 1));
          const y = (v: number) => base - (v / max) * (base - 16);
          const path = cum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
          const yTicks = [0, Math.round(max / 2), Math.round(max)].filter((v, i, a) => a.indexOf(v) === i);
          return (
            <>
              {yTicks.map((t) => <GridLine key={t} y={y(t)} label={`${t}h`} x1={L} x2={w - PAD} />)}
              <path d={`M${path} L${x(n - 1).toFixed(1)},${base} L${x(0).toFixed(1)},${base} Z`} fill={A} opacity={0.07} />
              <path d={`M${path}`} fill="none" stroke={A} strokeWidth={CHART.stroke} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${glowId})`} />
              {last > 0 && (
                <>
                  <circle cx={x(n - 1)} cy={y(last)} r={CHART.dotR} fill={A} stroke={CHART.dotRing} strokeWidth={2} />
                  <text x={x(n - 1)} y={y(last) - 13} textAnchor="end" fontSize={12} fill={INK} fontWeight={700} className="tnum">{fmt1(last)}h</text>
                </>
              )}
              {[0, n - 1].map((i) => (
                <text key={i} x={i === 0 ? L : w - PAD} y={H - 8} fontSize={CHART.tickFont} fill={CHART.tickFill} textAnchor={i === 0 ? "start" : "end"}>
                  {String(plotted[i]?.date ?? "").slice(5)}
                </text>
              ))}
            </>
          );
        }}
      </Plot>
      <p style={{ margin: "8px 2px 0", fontSize: 11.5, color: MUT, lineHeight: 1.5 }}>
        {fmtInt(m.emails_received)} emails × {minutes} min ÷ 60 — the rate is an assumption and is stated here rather than hidden in the figure.
      </p>
    </Card>
  );
}

// ── skeleton ─────────────────────────────────────────────────────────────────
// The screen loads by drawing itself, in the true geometry of what is coming, so
// nothing MOVES when the metrics land. It used to load as one centred shimmering
// word, which reflowed the whole layout on arrival.
function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <header>
        <span className="skel" style={{ height: 22, width: 210 }} />
        <div style={{ marginTop: 8 }}><span className="skel" style={{ height: 12, width: 340 }} /></div>
      </header>
      {/* The hero comes FIRST here too. This block is the reason the order matters:
          a skeleton that draws yesterday's layout makes the whole page jump the
          moment the metrics land, which is the one thing it exists to prevent. */}
      <section className="dash-hero">
        {[0, 1].map((i) => (
          <div key={i} className={i === 1 ? "dash-square" : undefined}
            style={{ background: "var(--chart-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "14px 16px 22px" }}>
            <span className="skel" style={{ display: "block", height: 10, width: 118, marginBottom: 14 }} />
            <span className="skel" style={{ display: "block", height: 178, borderRadius: "var(--radius)" }} />
          </div>
        ))}
      </section>
      {[0, 1].map((s) => (
        <section key={s} style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
          <div style={{ padding: "11px 16px", borderBottom: `1px solid ${BORDER}` }}><span className="skel" style={{ height: 10, width: 92 }} /></div>
          <div className="metric-strip">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="metric-strip__cell metric-strip__cell--flat">
                <span className="skel" style={{ display: "block", height: 10, width: 96, marginBottom: 10 }} />
                <span className="skel" style={{ display: "block", height: 26, width: 78 }} />
                <span className="skel" style={{ display: "block", height: 10, width: 120, marginTop: 10 }} />
              </div>
            ))}
          </div>
          {s === 1 && <div style={{ padding: 16 }}><span className="skel" style={{ display: "block", height: 240, borderRadius: "var(--radius)" }} /></div>}
        </section>
      ))}
      <div style={{ background: "var(--chart-surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "14px 16px 22px" }}>
        <span className="skel" style={{ display: "block", height: 10, width: 118, marginBottom: 14 }} />
        <span className="skel" style={{ display: "block", height: 168, borderRadius: "var(--radius)" }} />
      </div>
    </div>
  );
}

export default function DashboardScreen({ isActive, onOpenBoard }: Props & { onOpenBoard?: () => void }) {
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { const res = await fetch("/api/metrics?days=90"); if (!res.ok) throw new Error("bad"); setData((await res.json()) as Metrics); }
    catch { setError(true); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (isActive && !loadedRef.current) { loadedRef.current = true; void load(); } }, [isActive, load]);

  /**
   * Only the days the engine has actually existed for.
   *
   * The API zero-fills 90 days, and the engine's first event is 2026-07-27 — so
   * three quarters of every chart was a flat line across a period in which the tool
   * did not exist, compressing the part that has data into the last inch. Drawing a
   * zero for a day nobody was measuring is not a smaller reading, it is a false one.
   */
  const plotted = useMemo(() => {
    if (!data) return [];
    const from = data.firstEventAt?.slice(0, 10);
    if (!from) return data.series;
    const i = data.series.findIndex((r) => String(r.date) >= from);
    return i <= 0 ? data.series : data.series.slice(i);
  }, [data]);

  const wrap: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: "auto", padding: "20px var(--panel-pad-x) 44px" };

  // No header bar of its own. The shell already draws one, holding the eyebrow and
  // the window's controls — a second bar underneath it spent 48px repeating the word
  // "Dashboard" one line below where the shell had just said it.
  const shell = (body: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>{body}</div>
  );

  if (loading && !data) return shell(<div style={wrap}><Skeleton /></div>);
  if (error || !data) return shell(
    <div style={{ ...wrap, display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", color: MUT }}>
        <p style={{ marginBottom: 12, fontSize: 13 }}>Couldn&apos;t load metrics.</p>
        <button onClick={() => void load()} style={{ background: A, color: "var(--accent-contrast)", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Retry</button>
      </div>
    </div>
  );

  const minutes = data.minutes_per_email ?? 6;
  const from = plotted[0]?.date ?? "";
  const to = plotted[plotted.length - 1]?.date ?? "";
  const windowLabel = from ? `${String(from).slice(5)} → ${String(to).slice(5)}` : `${data.days}d`;

  return shell(
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "0 0 2px" }}>Engine impact</h1>
            <p style={{ fontSize: 13, color: MUT, margin: 0 }}>
              What is waiting on a person right now, and what the engine has handled since {String(from).slice(0, 10) || "it started"}.
            </p>
          </div>
          <span style={{ fontSize: 10.5, color: FAINT, whiteSpace: "nowrap" }}>
            {plotted.length} day{plotted.length === 1 ? "" : "s"} measured
          </span>
        </header>

        {/* Hours reclaimed is the headline, so it is the first thing on the page and
            the only card wearing the beam. Ben, 2026-09-02. It used to sit third in
            the bottom row, below two charts and beside a dial — the number the whole
            screen exists to report, ranked under the working detail. */}
        <section className="dash-hero">
          <HoursChart m={data} plotted={plotted} minutes={minutes} ringed />
          <GateRing m={data} />
        </section>

        <QueueStrip now={data.now} onOpenBoard={onOpenBoard} />
        <FlowExplorer m={data} plotted={plotted} />
        <Funnel m={data} label={windowLabel} />

        <footer style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", fontSize: 10.5, color: FAINT, letterSpacing: "0.04em", paddingTop: 2 }}>
          {/* A status light that lights. This read var(--accent), which on this
              palette is a near-white steel — an "operational" stamp the same colour
              as the text beside it. */}
          <span style={{ color: data.enabled ? "var(--up)" : "var(--down)" }}>● {data.enabled ? "operational" : "metrics store not configured"}</span>
          <span>{fmtInt(data.threads_processed)} threads compiled</span>
          <span>{fmtInt(data.filtered_out)} filtered out</span>
          <span>model: {minutes}m saved per email read</span>
          {data.lastEventAt && <span>last event {new Date(data.lastEventAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
        </footer>
      </div>
    </div>
  );
}
