"use client";
// ============================================================================
// The TV's history picker (the owner, 1 Nov: "a history button which lets the team view the list from different
// times in history"). The minute sync keeps the list whenever it changes, at most every 15 minutes, for 30 days
// (lib/feed/history.ts); this lists those moments by day and hands the one picked back to the screen.
// ============================================================================
import { useEffect, useState } from "react";
import type { FeedCard } from "../lib/feed/project";

export type PastList = { at: string; items: FeedCard[] };

const LONDON = "Europe/London";
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: LONDON });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: LONDON, weekday: "short", day: "numeric", month: "short" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: LONDON, hour: "2-digit", minute: "2-digit" });
export const momentLabel = (iso: string) => `${dayLabel(dayOf(iso))}, ${timeLabel(iso)}`;

export default function HistoryPicker({ s, onPick, onClose }: { s: number; onPick: (list: PastList) => void; onClose: () => void }) {
  const [times, setTimes] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/feed/history", { cache: "no-store" });
        const b = await r.json();
        if (!r.ok || !b.ok) throw new Error("history");
        const ts = (b.times as string[]).slice().reverse();
        setTimes(ts);
        setDay(ts.length ? dayOf(ts[0]) : null);
      } catch { setFailed(true); }
    })();
  }, []);

  const pick = async (at: string) => {
    setLoading(at);
    try {
      const r = await fetch(`/api/feed/history?at=${encodeURIComponent(at)}`, { cache: "no-store" });
      const b = await r.json();
      if (!r.ok || !b.ok || !b.list) throw new Error("history");
      onPick({ at: b.list.at, items: b.list.items });
    } catch { setFailed(true); } finally { setLoading(null); }
  };

  const days = [...new Set((times ?? []).map(dayOf))];
  const onDay = (times ?? []).filter((t) => dayOf(t) === day);
  const chip = (on: boolean) => ({ fontSize: 16 * s, fontWeight: 700, padding: `${8 * s}px ${14 * s}px`, borderRadius: 10 * s, cursor: "pointer",
    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent)" : "var(--surface-2)", color: on ? "var(--accent-contrast)" : "var(--text-primary)" } as const);

  return (
    <div role="dialog" aria-label="History" onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 92%)", maxHeight: "80%", overflowY: "auto", background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 16 * s, padding: 24 * s, display: "flex", flexDirection: "column", gap: 18 * s }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 * s }}>
          <span style={{ fontSize: 24 * s, fontWeight: 800 }}>History</span>
          <span style={{ fontSize: 15 * s, color: "var(--text-muted)" }}>The list as it stood. Kept for 30 days.</span>
          <button onClick={onClose} style={{ ...chip(false), marginLeft: "auto" }}>Close</button>
        </div>
        {failed ? <div style={{ fontSize: 18 * s, color: "var(--text-muted)" }}>The history could not be read.</div>
          : times == null ? <div style={{ fontSize: 18 * s, color: "var(--text-muted)" }}>Loading…</div>
          : !times.length ? <div style={{ fontSize: 18 * s, color: "var(--text-muted)" }}>Nothing kept yet: the list is kept from now on.</div>
          : (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 * s }}>
                {days.map((d) => <button key={d} onClick={() => setDay(d)} style={chip(d === day)}>{dayLabel(d)}</button>)}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 * s }}>
                {onDay.map((t) => <button key={t} onClick={() => void pick(t)} disabled={!!loading} style={{ ...chip(loading === t), fontVariantNumeric: "tabular-nums" }}>{timeLabel(t)}</button>)}
              </div>
            </>
          )}
      </div>
    </div>
  );
}
