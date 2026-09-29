"use client";

// ============================================================================
// "Needs Follow-Up" — the first thing on the dashboard.
// ----------------------------------------------------------------------------
// RED IS A TINT, NOT A FILL. --danger-subtle behind a --danger-border, with the
// number and the word "overdue" carrying the weight. A panel that is solid red is
// read as broken rather than urgent, and a dashboard that shouts every morning
// teaches a team to scroll past the one morning it matters.
//
// AND NEVER RED ALONE. Every alert states its direction in words ("Client waiting
// for Spartan"), states how long in words ("2 days overdue"), and carries a dot with
// a text label beside it. Colour is the last signal here, not the only one.
//
// FOUR STATES, ALL DISTINCT. Loading, error, empty and populated. The one that
// matters is error: a failed request must never render as "You're all caught up",
// because the reassuring reading of a broken panel is the dangerous one. The API
// answers ok:false with a 500 for exactly this reason.
//
// THE DORMANT LINE IS NOT AN ALERT. 329 threads have been waiting longer than the
// horizon as at 2026-09-29 — mostly conversations that ended on the phone. They are
// reported as a quiet count with a plain explanation, because hiding them would be a
// lie by omission and reddening them would make the panel permanently alarming.
// ============================================================================
import { useCallback, useEffect, useState } from "react";

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const BORDER = "var(--border)";
const DANGER = "var(--danger)";

interface Alert {
  thread_id: string;
  owed_by: "us" | "them";
  direction_label: string;
  contact_name: string | null;
  contact_email: string | null;
  company_name: string | null;
  subject: string;
  preview: string;
  last_activity_iso: string;
  waiting_since_iso: string;
  due_iso: string;
  overdue_hours: number;
  thread_url: string | null;
  link_label: string;
  fallback_url: string;
}
interface Board { ok: boolean; alerts: Alert[]; dormant_count: number; dormant_days: number }

/** "3 days overdue" reads; "72h" makes the reader do arithmetic to feel anything. */
function overdueText(hours: number): string {
  if (hours < 1) return "just overdue";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} overdue`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const SHOWN = 5;

export default function FollowUpRow() {
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch("/api/followups");
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as Board;
      if (!j.ok) throw new Error("not ok");
      setBoard(j);
    } catch {
      // Deliberately does NOT set an empty board: see the note about state four.
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const frame = (children: React.ReactNode, tinted: boolean) => (
    <section
      aria-label="Needs follow-up"
      style={{
        background: tinted ? "var(--danger-subtle)" : "var(--surface)",
        border: `1px solid ${tinted ? "var(--danger-border)" : BORDER}`,
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}
    >
      {children}
    </section>
  );

  if (failed) {
    return frame(
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: INK }}>Follow-ups could not be loaded</div>
          <div style={{ fontSize: 12, color: SUB, marginTop: 2 }}>
            This is not the same as having none outstanding. Try again.
          </div>
        </div>
        <button onClick={() => void load()} style={btn(false)}>Retry</button>
      </div>,
      false
    );
  }

  if (!board) {
    return frame(
      <div style={{ padding: "14px 16px" }}>
        <span className="skel" style={{ display: "block", height: 11, width: 150, marginBottom: 10 }} />
        <span className="skel" style={{ display: "block", height: 44, borderRadius: "var(--radius)" }} />
      </div>,
      false
    );
  }

  const { alerts, dormant_count, dormant_days } = board;
  const shown = expanded ? alerts : alerts.slice(0, SHOWN);

  return frame(
    <>
      <header
        style={{
          padding: "11px 16px",
          borderBottom: `1px solid ${alerts.length ? "var(--danger-border)" : BORDER}`,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: alerts.length ? DANGER : "var(--ok)", flex: "0 0 auto",
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>Needs follow-up</span>
        <span
          className="tnum"
          style={{
            fontSize: 12, fontWeight: 700, padding: "1px 7px", borderRadius: 999,
            color: alerts.length ? DANGER : MUT,
            background: alerts.length ? "var(--danger-subtle)" : "transparent",
            border: `1px solid ${alerts.length ? "var(--danger-border)" : BORDER}`,
          }}
        >
          {alerts.length} outstanding
        </span>
        {dormant_count > 0 && (
          <span style={{ fontSize: 11, color: MUT, marginLeft: "auto" }}>
            {dormant_count} waiting over {dormant_days} days — not chased automatically
          </span>
        )}
      </header>

      {!alerts.length ? (
        <div style={{ padding: "18px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>You&rsquo;re all caught up</span>
          <span style={{ fontSize: 12, color: SUB }}>Nothing is overdue a reply in either direction.</span>
        </div>
      ) : (
        <>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {shown.map((a) => (
              <li
                key={a.thread_id}
                style={{
                  padding: "12px 16px",
                  borderBottom: `1px solid ${BORDER}`,
                  display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>
                      {a.company_name ?? a.contact_name ?? a.contact_email ?? "Unknown contact"}
                    </span>
                    {a.contact_name && a.company_name && (
                      <span style={{ fontSize: 12, color: SUB }}>{a.contact_name}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600, color: DANGER }}>
                      {overdueText(a.overdue_hours)}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: SUB, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.subject}
                  </div>
                  {a.preview && (
                    <div style={{ fontSize: 11, color: MUT, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.preview}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: MUT, marginTop: 5 }}>
                    {a.direction_label} · last activity {shortDate(a.last_activity_iso)} · due {shortDate(a.due_iso)}
                  </div>
                </div>
                <a
                  href={a.thread_url ?? a.fallback_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={btn(!!a.thread_url)}
                >
                  {a.link_label}
                </a>
              </li>
            ))}
          </ul>
          {alerts.length > SHOWN && (
            <div style={{ padding: "10px 16px" }}>
              <button onClick={() => setExpanded((v) => !v)} style={btn(false)}>
                {expanded ? "Show fewer" : `Show all ${alerts.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </>,
    alerts.length > 0
  );
}

/**
 * A real thread link and a search fallback look DIFFERENT on purpose. The fallback
 * is honest about being one — it says "Search inbox for this subject" and is styled
 * as a secondary action — because a button that looks like it opens the conversation
 * and instead dumps you in a search is worse than no button.
 */
function btn(primary: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 11px",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${primary ? "var(--danger-border)" : BORDER}`,
    background: primary ? "var(--danger-subtle)" : "transparent",
    color: primary ? DANGER : SUB,
    textDecoration: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
}
