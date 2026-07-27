"use client";

// Jobs — the tickets-style view of every conversation linked to (or heading
// toward) an OnSinch order. Backed by conversation_state via /api/jobs. Shows
// the thread -> order link, a status lane, and a green check when the engine
// drafted the reply. Read-only for now (confirm actions land with the queue).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface Props { isActive: boolean }

interface Job {
  thread_id: string; subject: string; contact: string;
  company_id: number | null; order_id: number | null; order_number: string | null;
  classification: string; status: string; priority: string;
  needs_human: boolean; ai_replied: boolean; crew_size: number | null;
  dates: string[]; location: string | null; updated_at: string;
}

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const FAINT = "var(--text-faint)";
const A = "var(--accent)";
const OK = "var(--ok)";
const BORDER = "var(--border)";

type Filter = "all" | "proposed" | "needs_human" | "booked";

function badge(j: Job): { label: string; color: string; bg: string; bd: string } {
  if (j.needs_human || j.status === "error")
    return { label: "Needs human", color: "var(--danger)", bg: "var(--danger-subtle)", bd: "rgba(239,68,68,0.3)" };
  if (j.status === "proposed")
    return { label: "Awaiting confirm", color: A, bg: "var(--accent-subtle)", bd: "var(--accent-border)" };
  if (j.status === "ordered")
    return { label: "Booked", color: OK, bg: "rgba(52,211,153,0.12)", bd: "rgba(52,211,153,0.32)" };
  return { label: "Replied", color: SUB, bg: "var(--surface-2)", bd: BORDER };
}

function CheckMark() {
  return (
    <span title="AI reply drafted" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: 9999, background: "rgba(52,211,153,0.14)", border: "1px solid rgba(52,211,153,0.4)" }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={OK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
    </span>
  );
}

function JobRow({ j, onSelect }: { j: Job; onSelect: (id: string) => void }) {
  const b = badge(j);
  const meta = [
    j.dates.length ? j.dates.join(", ") : null,
    j.crew_size ? `${j.crew_size} crew` : null,
    j.location,
  ].filter(Boolean).join("  ·  ");
  return (
    <div onClick={() => onSelect(j.thread_id)} style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius)", padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.contact}</span>
          {j.classification === "update" && <span style={{ fontSize: 10, fontWeight: 700, color: MUT, textTransform: "uppercase", letterSpacing: "0.06em" }}>update</span>}
        </div>
        <div style={{ fontSize: 12.5, color: SUB, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.subject}</div>
        {meta && <div style={{ fontSize: 11.5, color: MUT, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{meta}</div>}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        {j.ai_replied && <CheckMark />}
        <span className="mono" style={{ fontSize: 12, color: j.order_number ? SUB : FAINT, width: 74, textAlign: "right" }}>
          {j.order_number ? `#${j.order_number}` : j.status === "proposed" ? "staged" : "—"}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, border: `1px solid ${b.bd}`, borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap", width: 118, textAlign: "center" }}>{b.label}</span>
      </div>
    </div>
  );
}

const PROFESSION_LABEL: Record<number, string> = {
  1: "Crew", 3: "Carpenter", 4: "Telehandler", 9: "Driver", 11: "Forklift",
  16: "AV Tech", 17: "Rough Terrain", 32: "CSCS", 36: "Crew Chief",
};

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: `1px solid ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "16px 18px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: SUB, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  return (
    <div style={{ display: "flex", gap: 12, fontSize: 12.5, padding: "3px 0" }}>
      <span style={{ color: MUT, width: 120, flexShrink: 0 }}>{k}</span>
      <span style={{ color: SUB }}>{v}</span>
    </div>
  );
}

// Read-only ticket detail: the AI decision (transparency) + the composed draft order.
function Detail({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const [d, setD] = useState<any | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let ok = true;
    fetch(`/api/jobs?id=${encodeURIComponent(threadId)}`).then((r) => r.json()).then((x) => { if (ok) setD(x.ticket || null); }).catch(() => { if (ok) setErr(true); });
    return () => { ok = false; };
  }, [threadId]);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };
  const back = <button onClick={onBack} style={{ alignSelf: "flex-start", background: "none", border: "none", color: A, cursor: "pointer", fontWeight: 700, fontSize: 13, padding: 0 }}>&larr; Jobs Board</button>;
  if (!d && !err) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT }}>Loading…</span></div>;
  if (err || !d) return <div style={wrap}><div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{back}<p style={{ color: MUT, fontSize: 13 }}>Couldn&apos;t load this ticket.</p></div></div>;

  const b = badge(d);
  const order = d.extracted?.desired_order;
  const teams: any[] = order?.slot_teams ?? [];
  return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        {back}
        <header>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: INK, margin: 0 }}>{d.contact}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, color: b.color, background: b.bg, border: `1px solid ${b.bd}`, borderRadius: 999, padding: "4px 10px" }}>{b.label}</span>
            {d.ai_replied && <CheckMark />}
          </div>
          <p style={{ fontSize: 13, color: MUT, margin: "4px 0 0" }}>{d.subject}</p>
        </header>

        <Panel title="AI decision">
          <Row k="Classification" v={d.classification} />
          <Row k="Priority" v={d.priority} />
          <Row k="Client inquiry" v={d.is_client_inquiry ? "yes" : "no"} />
          <Row k="Gate reason" v={d.gate_reason} />
          {!!d.notes?.length && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, color: MUT, marginBottom: 4 }}>Notes</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: SUB, fontSize: 12.5, lineHeight: 1.6 }}>
                {d.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </Panel>

        <Panel title="Draft order">
          {order ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {order.provisional && <span style={{ fontSize: 10.5, fontWeight: 700, color: A, background: "var(--accent-subtle)", border: "1px solid var(--accent-border)", borderRadius: 999, padding: "3px 9px" }}>PROVISIONAL</span>}
                {order.quote && <span style={{ fontSize: 10.5, fontWeight: 700, color: SUB, background: "var(--surface-2)", border: `1px solid ${BORDER}`, borderRadius: 999, padding: "3px 9px" }}>QUOTE</span>}
                <span className="mono" style={{ fontSize: 11.5, color: MUT }}>rate card #{order.pricelist_category_id}</span>
              </div>
              <Row k="Job" v={order.job_name} />
              <Row k="Summary" v={order.specification} />
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 11.5, color: MUT, marginBottom: 6 }}>Slot teams</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {teams.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, background: "var(--surface-2)", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "8px 12px" }}>
                      <span style={{ fontWeight: 700, color: INK, width: 90 }}>{PROFESSION_LABEL[t.profession_id] || `prof ${t.profession_id}`}</span>
                      <span className="tnum" style={{ color: SUB, width: 46 }}>×{t.size}</span>
                      <span style={{ color: MUT, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {t.beginning ? `${t.beginning.slice(0, 16).replace("T", " ")} – ${(t.end || "").slice(11, 16)}` : "date TBC"}
                      </span>
                      <span className="mono" style={{ color: FAINT, fontSize: 11 }}>place {t.place_id || "new"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: MUT, margin: 0 }}>No order composed yet — status <b style={{ color: SUB }}>{d.status}</b>{d.needs_human ? " (needs a human)" : ""}.</p>
          )}
        </Panel>

        <Panel title="Details">
          <Row k="Company id" v={d.company_id} />
          <Row k="Contact id" v={d.user_id} />
          <Row k="Place id" v={d.place_id} />
          <Row k="OnSinch order" v={d.order_number ? `#${d.order_number}` : d.order_id} />
          <Row k="Dates" v={d.dates?.join(", ")} />
          <Row k="Location" v={d.location} />
          <Row k="Reply" v={d.reply_state} />
        </Panel>
      </div>
    </div>
  );
}

export default function JobsScreen({ isActive }: Props) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    setError(false);
    try { const r = await fetch("/api/jobs"); if (!r.ok) throw new Error(); setJobs((await r.json()).jobs); }
    catch { setError(true); setJobs([]); }
  }, []);
  useEffect(() => { if (isActive && !loaded.current) { loaded.current = true; void load(); } }, [isActive, load]);

  const counts = useMemo(() => {
    const j = jobs ?? [];
    return {
      all: j.length,
      proposed: j.filter((x) => x.status === "proposed" && !x.needs_human).length,
      needs_human: j.filter((x) => x.needs_human || x.status === "error").length,
      booked: j.filter((x) => x.order_id != null).length,
    };
  }, [jobs]);

  const shown = useMemo(() => {
    const j = jobs ?? [];
    if (filter === "all") return j;
    if (filter === "proposed") return j.filter((x) => x.status === "proposed" && !x.needs_human);
    if (filter === "needs_human") return j.filter((x) => x.needs_human || x.status === "error");
    return j.filter((x) => x.order_id != null);
  }, [jobs, filter]);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };
  if (!jobs) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT }}>Loading jobs…</span></div>;
  if (selected) return <Detail threadId={selected} onBack={() => setSelected(null)} />;

  const tabs: { id: Filter; label: string }[] = [
    { id: "all", label: `All ${counts.all}` },
    { id: "proposed", label: `Awaiting confirm ${counts.proposed}` },
    { id: "needs_human", label: `Needs human ${counts.needs_human}` },
    { id: "booked", label: `Booked ${counts.booked}` },
  ];

  return (
    <div style={wrap}>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <header>
          <span className="eyebrow"><span className="slash">/</span>JOBS BOARD</span>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: INK, margin: "4px 0 2px" }}>Jobs Board</h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Every conversation linked to an OnSinch order. A green check means the engine drafted the reply.</p>
        </header>

        <div style={{ display: "inline-flex", background: "var(--surface-2)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: 3, gap: 3, alignSelf: "flex-start", flexWrap: "wrap" }}>
          {tabs.map((t) => {
            const active = filter === t.id;
            return (
              <button key={t.id} onClick={() => setFilter(t.id)}
                style={{ padding: "7px 13px", borderRadius: 8, border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`, background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 12.5, cursor: "pointer", transition: "all 200ms" }}>
                {t.label}
              </button>
            );
          })}
        </div>

        {error && <div style={{ fontSize: 12.5, color: MUT }}>Couldn&apos;t load jobs. <button onClick={() => void load()} style={{ color: A, background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>Retry</button></div>}

        {shown.length === 0 ? (
          <div style={{ background: "var(--surface)", border: `1px dashed ${BORDER}`, borderRadius: "var(--radius-lg)", padding: "40px 24px", textAlign: "center", color: MUT, fontSize: 13 }}>
            No jobs yet in this view. They appear as booking emails flow through the engine.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map((j) => <JobRow key={j.thread_id} j={j} onSelect={setSelected} />)}
          </div>
        )}
      </div>
    </div>
  );
}
