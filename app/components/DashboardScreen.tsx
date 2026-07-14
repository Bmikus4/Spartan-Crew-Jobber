"use client";

// Dashboard — read-only impact surface for the Spartan Crew enquiry engine.
// Same brand + component language as the House of Hud dashboard. Measures the
// engine's own funnel from the append-only metric_events log: emails intook,
// job requests detected, replies drafted, orders proposed/created. Performs no
// actions. All figures are the live aggregate from /api/metrics.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props { isActive: boolean }

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

function Card({ title, caption, children, style }: { title?: string; caption?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "18px 20px", ...style }}>
      {title && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB }}>{title}</span>
          {caption && <span style={{ fontSize: 10.5, color: FAINT }}>{caption}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

function Sparkline({ values, h = 32 }: { values: number[]; h?: number }) {
  const w = 200, n = values.length, pad = 2, max = Math.max(1, ...values);
  const x = (i: number) => (n <= 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (v: number) => h - pad - (v / max) * (h - 2 * pad);
  const d = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
  const allZero = max <= 1 && values.every((v) => v === 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: "block" }} aria-hidden>
      {allZero
        ? <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={BORDER} strokeWidth={1.5} strokeDasharray="2 4" />
        : <path d={`M${d}`} fill="none" stroke={A} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function StatTile({ label, value, sub, series, accent }: { label: string; value: string; sub?: string; series: number[]; accent?: boolean }) {
  return (
    <div style={{ background: accent ? "var(--accent-subtle)" : "var(--surface)", border: `1px solid ${accent ? "var(--accent-border)" : BORDER}`, borderRadius: "var(--radius-lg)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: MUT, fontWeight: 700 }}>{label}</span>
      <span className="tnum" style={{ fontSize: 30, fontWeight: 700, color: accent ? A : INK, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: FAINT }}>{sub}</span>}
      <div style={{ marginTop: 2 }}><Sparkline values={series.length ? series : [0, 0]} /></div>
    </div>
  );
}

// Funnel — intake to booking, as a set of proportional bars. The honest story of
// where volume goes: received -> job requests -> replies -> proposed -> created.
function Funnel({ m }: { m: Metrics }) {
  const steps = [
    { label: "Emails intook", v: m.emails_received },
    { label: "Job requests", v: m.job_requests },
    { label: "Replies drafted", v: m.replies_drafted },
    { label: "Orders proposed", v: m.orders_proposed },
    { label: "Orders created", v: m.orders_created },
  ];
  const max = Math.max(1, ...steps.map((s) => s.v));
  return (
    <Card title="Enquiry → booking funnel" caption={`${m.days}d`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((s, i) => {
          const pct = Math.round((s.v / max) * 100);
          const prev = i > 0 ? steps[i - 1].v : s.v;
          const conv = prev > 0 ? Math.round((s.v / prev) * 100) : null;
          return (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ width: 120, fontSize: 12, color: SUB, flexShrink: 0 }}>{s.label}</span>
              <div style={{ flex: 1, height: 22, background: "var(--surface-2)", borderRadius: 6, overflow: "hidden", position: "relative" }}>
                <div style={{ width: `${Math.max(pct, s.v > 0 ? 6 : 0)}%`, height: "100%", background: A, opacity: 0.55, borderRadius: 6, transition: "width 400ms cubic-bezier(0.4,0,0.2,1)" }} />
              </div>
              <span className="tnum" style={{ width: 44, textAlign: "right", fontSize: 14, fontWeight: 700, color: INK }}>{fmtInt(s.v)}</span>
              <span className="tnum" style={{ width: 44, textAlign: "right", fontSize: 11, color: conv != null && i > 0 ? MUT : "transparent" }}>{conv != null && i > 0 ? `${conv}%` : "—"}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ActivityChart({ m }: { m: Metrics }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 620, H = 200, PAD = 8, base = H - 24;
  const daily = m.series.map((r) => Number(r["email_received"] || 0));
  const n = daily.length, max = Math.max(1, ...daily);
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (n - 1));
  const y = (v: number) => base - (v / max) * (base - PAD);
  const bw = Math.max(1.5, (W - 2 * PAD) / n - 1.5);
  const total = daily.reduce((a, b) => a + b, 0);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => { const b = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - b.left) / b.width) * (n - 1))))); };
  return (
    <Card title="Daily intake" caption={`${total} emails · ${m.days}d`}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: "block", overflow: "visible" }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <line x1={PAD} y1={base} x2={W - PAD} y2={base} stroke={BORDER} strokeWidth={1} />
        {daily.map((v, i) => v > 0 && (
          <rect key={i} x={x(i) - bw / 2} y={y(v)} width={bw} height={base - y(v)} rx={1.2} fill={A} opacity={0.55} />
        ))}
        {hover != null && <line x1={x(hover)} y1={PAD} x2={x(hover)} y2={base} stroke={BORDER} strokeWidth={0.8} strokeDasharray="3 3" />}
      </svg>
      <div style={{ height: 15, textAlign: "center", fontSize: 11, color: MUT, marginTop: 2 }}>
        {hover != null && m.series[hover] ? <><b style={{ color: INK }}>{daily[hover]}</b> emails · {m.series[hover].date}</> : total === 0 ? <span style={{ color: FAINT }}>no intake yet in this window</span> : <span style={{ color: FAINT }}>hover for a day</span>}
      </div>
    </Card>
  );
}

export default function DashboardScreen({ isActive }: Props) {
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

  const repliesSeries = useMemo(() => data ? data.series.map((r) => Number(r["reply_drafted"] || 0)) : [], [data]);
  const ordersSeries = useMemo(() => data ? data.series.map((r) => Number(r["order_created"] || 0)) : [], [data]);
  const intakeSeries = useMemo(() => data ? data.series.map((r) => Number(r["email_received"] || 0)) : [], [data]);
  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };

  if (loading && !data) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT, fontWeight: 500 }}>Loading metrics…</span></div>;
  if (error || !data) return (
    <div style={{ ...wrap, display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", color: MUT }}>
        <p style={{ marginBottom: 12 }}>Couldn&apos;t load metrics.</p>
        <button onClick={() => void load()} style={{ background: A, color: "var(--accent-contrast)", border: "none", borderRadius: "var(--radius-sm)", padding: "8px 18px", fontWeight: 700, cursor: "pointer" }}>Retry</button>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        <header>
          <span className="eyebrow"><span className="slash">/</span>DASHBOARD</span>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "4px 0 2px" }}>Enquiry engine impact</h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Every email intook, filtered, replied to, and booked — measured from the engine&apos;s own run.</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <StatTile label="Hours reclaimed" value={`${fmt1(data.hours_saved)}h`} sub="from handled email" series={intakeSeries} accent />
          <StatTile label="Orders created" value={fmtInt(data.orders_created)} sub={`${fmtInt(data.orders_updated)} updated`} series={ordersSeries} />
          <StatTile label="Awaiting confirm" value={fmtInt(data.awaiting_confirmation)} sub="draft-only queue" series={data.series.map((r) => Number(r["order_proposed"] || 0))} />
          <StatTile label="Hands-free rate" value={`${data.hands_free_rate}%`} sub={`${fmtInt(data.needs_human)} need a human`} series={repliesSeries} />
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }} className="dash-split">
          <Funnel m={data} />
          <ActivityChart m={data} />
        </section>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
          <StatTile label="Replies drafted" value={fmtInt(data.replies_drafted)} sub="every inbound" series={repliesSeries} />
          <StatTile label="Job requests" value={fmtInt(data.job_requests)} sub="new + updates" series={data.series.map((r) => Number(r["job_detected"] || 0))} />
          <StatTile label="Clients served" value={fmtInt(data.clients_served)} sub="threads → order" series={ordersSeries} />
          <StatTile label="Order errors" value={fmtInt(data.order_errors)} sub="OnSinch write fails" series={[0, 0]} />
        </section>

        <footer style={{ display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap", fontSize: 10.5, color: FAINT, letterSpacing: "0.04em", paddingTop: 2 }}>
          <span style={{ color: data.enabled ? A : MUT }}>● {data.enabled ? "operational" : "metrics store not configured"}</span>
          <span>{data.threads_processed} threads processed</span>
          <span>{data.filtered_out} filtered out</span>
        </footer>
      </div>
      <style>{`@media (max-width: 760px){ .dash-split{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
