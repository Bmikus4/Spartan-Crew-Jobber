"use client";

// THE ANALYTICS DASHBOARD AS A POPUP (Ben, 2026-10-11: "remove the analytics dashboard,
// instead make it a popup"). The same DashboardScreen, unchanged, in a dialog over whatever
// opened it, so its numbers have one implementation. Escape, the close button or a click on
// the backdrop closes it.

import { useEffect } from "react";
import DashboardScreen from "./DashboardScreen";

export default function AnalyticsPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Analytics" onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(1400px, 100%)", height: "min(900px, 100%)", background: "var(--bg)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: 16, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ height: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", borderBottom: "1px solid var(--border)" }}>
          <span className="eyebrow"><span className="slash">/</span>ANALYTICS</span>
          <button type="button" onClick={onClose} aria-label="Close analytics"
            style={{ width: 36, height: 36, border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center", padding: 0 }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          <DashboardScreen isActive onOpenBoard={onClose} />
        </div>
      </div>
    </div>
  );
}
