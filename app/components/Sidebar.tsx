"use client";

// The left navigation rail.
//
// Condensed to an icon strip, EXPANDING ON HOVER — the same rebuild the quote tool
// took. There is no toggle to find and no collapse state to persist, because the
// pointer is the control. What it replaced was a click-toggle with its state in
// localStorage and a 20px chevron floating halfway down the rail's right edge: an
// affordance you had to discover, remembering a decision you made once, for three
// items. Keyboard users get the same thing through :focus-within.
//
// Mobile is a bottom bar rather than a drawer, and it now carries LABELS. Icon-only
// it could not say which surface you were on: the active colour was --accent, and
// Spartan's accent is a near-white steel that is indistinguishable from the
// --text-primary the inactive icons already wore.

import { useEffect, useState } from "react";
import BrandLogo from "./BrandLogo";

interface NavItemConfig {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface SidebarProps {
  activeTool: string;
  onSelectTool: (toolId: string) => void;
  onSettings: () => void;
}

function IconDashboard() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="20" x2="4" y2="12" />
      <line x1="10" y1="20" x2="10" y2="6" />
      <line x1="16" y1="20" x2="16" y2="14" />
      <line x1="20" y1="20" x2="20" y2="9" />
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
function IconJobs() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

// Settings is an ordinary row at the END of the list, not a pinned footer bay with
// its own divider — the same call the quote tool made (Ben, 2026-08-09). It opens a
// screen exactly like the other rows do, so a separate bay was drawing a
// distinction that is not there.
const NAV_ITEMS: NavItemConfig[] = [
  { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { id: "jobs", label: "Jobs Board", icon: <IconJobs /> },
  { id: "settings", label: "Settings", icon: <IconSettings /> },
];
const NAV_BEVEL_SHADOW = "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.25)";

function MobileBottomBar({ activeTool, onSelectTool, onSettings }: SidebarProps) {
  return (
    <nav aria-label="Main navigation" style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, display: "flex", justifyContent: "space-around", alignItems: "stretch", height: "calc(var(--mobile-nav-h) + var(--mobile-nav-safe) + 20px)", paddingTop: 6, paddingBottom: "calc(var(--mobile-nav-safe) + 6px)", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
      {NAV_ITEMS.map((item) => {
        const active = activeTool === item.id;
        return (
          <button key={item.id} onClick={() => (item.id === "settings" ? onSettings() : onSelectTool(item.id))}
            aria-current={active ? "page" : undefined}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none", cursor: "pointer", color: active ? "var(--text-primary)" : "var(--text-muted)", padding: 0, minWidth: 44 }}>
            <span style={{ display: "flex", transform: "scale(0.72)" }}>{item.icon}</span>
            {/* The label is what actually says where you are on a phone. */}
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: "0.01em", lineHeight: 1 }}>{item.label}</span>
            {/* And an underline, because on a near-monochrome palette weight alone
                is too quiet to mark the current tab. */}
            <span aria-hidden style={{ width: 16, height: 2, borderRadius: 2, background: active ? "var(--accent)" : "transparent" }} />
          </button>
        );
      })}
    </nav>
  );
}

export default function Sidebar({ activeTool, onSelectTool, onSettings }: SidebarProps) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() { setIsMobile(window.innerWidth < 768); }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile) return <MobileBottomBar activeTool={activeTool} onSelectTool={onSelectTool} onSettings={onSettings} />;

  const isCondensed = !expanded;
  const width = expanded ? "var(--nav-w-expanded)" : "var(--nav-w-condensed)";

  function renderButton(item: NavItemConfig, opts: { active: boolean; onClick: () => void }) {
    const isHovered = hoveredItem === item.id;
    const { active } = opts;
    let fill = "transparent";
    if (active) fill = "var(--accent-subtle)";
    else if (isHovered) fill = "var(--surface-hover)";
    const iconColor = active ? "var(--accent)" : isHovered ? "var(--text-primary)" : "var(--text-muted)";
    const labelColor = active ? "var(--accent)" : isHovered ? "var(--text-primary)" : "var(--text-secondary)";
    return (
      <button
        onClick={opts.onClick}
        aria-current={active ? "page" : undefined}
        onMouseEnter={() => setHoveredItem(item.id)}
        onMouseLeave={() => setHoveredItem(null)}
        title={isCondensed ? item.label : undefined}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 0,
          padding: isCondensed ? "3px 2px" : "3px 11px",
          backgroundColor: isCondensed ? "transparent" : fill,
          border: `1px solid ${!isCondensed && active ? "var(--accent-border)" : "transparent"}`,
          borderRadius: "var(--nav-item-radius)",
          boxShadow: !isCondensed && active ? NAV_BEVEL_SHADOW : "none",
          cursor: "pointer", color: iconColor, position: "relative",
          transition: "background-color 250ms, color 250ms, box-shadow 250ms, border-color 250ms, padding var(--nav-dur) var(--nav-ease)",
        }}
      >
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor, width: "var(--nav-icon-box)", height: "var(--nav-icon-box)", borderRadius: "var(--nav-item-radius)", backgroundColor: isCondensed ? fill : "transparent", border: `1px solid ${isCondensed && active ? "var(--accent-border)" : "transparent"}`, boxShadow: isCondensed && active ? NAV_BEVEL_SHADOW : "none", transition: "background-color 250ms, color 250ms" }}>
          {item.icon}
        </span>
        {/* aria-hidden while condensed: the label is still in the DOM (it has to be,
            or expanding would reflow the row), but it is 0-opacity decoration then,
            and the accessible name comes from the title. */}
        <span aria-hidden={isCondensed} style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 14, fontWeight: 500, color: labelColor, whiteSpace: "nowrap", overflow: "hidden", marginLeft: isCondensed ? 0 : 12, opacity: isCondensed ? 0 : 1, transition: "color 250ms, opacity 250ms, margin-left var(--nav-dur) var(--nav-ease)" }}>
          {item.label}
        </span>
      </button>
    );
  }

  return (
    <nav
      role="navigation" aria-label="Main sidebar navigation" className="frosted-glass nav-rail"
      // Hover OR keyboard focus opens it. focus-within is what keeps the rail
      // reachable without a pointer, since there is no longer a toggle to tab to.
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false); }}
      style={{ width, minWidth: width, height: "calc(100% - var(--shell-double-pad))", margin: "var(--shell-pad) 0 var(--shell-pad) var(--shell-pad)", display: "flex", flexDirection: "column", transition: "width var(--nav-dur) var(--nav-ease), min-width var(--nav-dur) var(--nav-ease)", position: "relative", zIndex: 100, overflowY: "auto", overflowX: "hidden", borderRadius: "var(--radius-lg)" }}
    >
      <div style={{ padding: "16px 10px 19px", display: "flex", justifyContent: "center" }}>
        <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrandLogo condensed={isCondensed} />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
        {NAV_ITEMS.map((item) => (
          <div key={item.id} style={{ position: "relative" }}>
            {renderButton(item, {
              active: activeTool === item.id,
              onClick: () => (item.id === "settings" ? onSettings() : onSelectTool(item.id)),
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
