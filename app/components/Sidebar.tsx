"use client";

// The left navigation rail.
//
// It is NOT a panel. Transparent, no border, no radius, no shadow, flush to the
// window edge — so the content panel is the only framed thing on screen and the
// navigation reads as part of the ground it sits on. It used to wear .frosted-glass
// with a margin, which made it a second floating card competing with the one that
// holds the work.
//
// Condensed to an icon strip, expanding on hover. Two details that are the whole
// difference between smooth and jittery, both learned from the quote tool's rail:
//
//   1. ONLY THE ROWS OPEN IT. A hover handler on the container throws the whole nav
//      open when the pointer merely crosses the left edge of the screen on its way
//      somewhere else. Leaving is handled at the container, because the pointer can
//      exit from anywhere.
//   2. NOTHING MOVES HORIZONTALLY. Row padding is constant and the icon sits in a
//      fixed 40px column, so expanding only fades the labels in. The old rail changed
//      its padding between states, which slid every icon sideways mid-slide.

import { useEffect, useState } from "react";
import { BrandMark, BrandWordmark } from "./BrandLogo";

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
// its own divider — the same call the quote tool made (Ben, 2026-08-09).
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
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, letterSpacing: "0.01em", lineHeight: 1 }}>{item.label}</span>
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
  // One clock for everything that fades as the rail opens: the labels and the
  // wordmark. Declared once so they cannot drift apart.
  const fade: React.CSSProperties = {
    opacity: isCondensed ? 0 : 1,
    visibility: isCondensed ? "hidden" : "visible",
    transition: "opacity var(--nav-dur) var(--nav-ease), visibility var(--nav-dur)",
  };

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
        // The ROW opens the rail — see the note at the top of this file.
        onMouseEnter={() => { setHoveredItem(item.id); setExpanded(true); }}
        onMouseLeave={() => setHoveredItem(null)}
        onFocus={() => { setHoveredItem(item.id); setExpanded(true); }}
        onBlur={() => setHoveredItem(null)}
        title={isCondensed ? item.label : undefined}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12,
          // CONSTANT. Padding that changed with the state slid every icon sideways
          // while the rail was still sliding.
          padding: "3px 6px",
          backgroundColor: isCondensed ? "transparent" : fill,
          border: `1px solid ${!isCondensed && active ? "var(--accent-border)" : "transparent"}`,
          borderRadius: "var(--nav-item-radius)",
          boxShadow: !isCondensed && active ? NAV_BEVEL_SHADOW : "none",
          cursor: "pointer", color: iconColor, position: "relative", textAlign: "left",
          transition: "background-color 250ms, color 250ms, box-shadow 250ms, border-color 250ms",
        }}
      >
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor, width: "var(--nav-icon-box)", height: "var(--nav-icon-box)", borderRadius: "var(--nav-item-radius)", backgroundColor: isCondensed ? fill : "transparent", border: `1px solid ${isCondensed && active ? "var(--accent-border)" : "transparent"}`, boxShadow: isCondensed && active ? NAV_BEVEL_SHADOW : "none", transition: "background-color 250ms, color 250ms" }}>
          {item.icon}
        </span>
        <span aria-hidden={isCondensed} style={{ ...fade, fontSize: 14, fontWeight: 500, color: labelColor, whiteSpace: "pre", transition: `${fade.transition}, color 250ms` }}>
          {item.label}
        </span>
      </button>
    );
  }

  return (
    <nav
      role="navigation" aria-label="Main sidebar navigation" className="nav-rail"
      // Collapsing lives here, because the pointer can leave from anywhere.
      onMouseLeave={() => setExpanded(false)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setExpanded(false); }}
      style={{
        width, minWidth: width, height: "100%",
        background: "transparent", border: "none", borderRadius: 0, boxShadow: "none",
        // The rail's own top padding IS the shell inset, now that it runs edge to
        // edge — without it the logo band starts at y=0 while the content panel
        // starts at --shell-pad, and the mark loses the header line it aligns to.
        paddingTop: "var(--shell-pad)",
        display: "flex", flexDirection: "column",
        transition: "width var(--nav-dur) var(--nav-ease), min-width var(--nav-dur) var(--nav-ease)",
        position: "relative", zIndex: 100, overflowY: "auto", overflowX: "hidden",
      }}
    >
      {/* The logo band is exactly as tall as the content window's header bar, so the
          mark sits on the same line as the "/ DASHBOARD" eyebrow beside it rather
          than riding above it. Its left padding matches the rows', so the arrow and
          every icon below share one 40px column. */}
      {/* Left padding is 14px = the row container's 8 + the button's 6, so the arrow
          starts on the same x as every icon below it. At 6px it sat 8px to their left
          and read as the logo hanging off the edge of the rail. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: "var(--panel-header-height)", padding: "0 6px 0 14px", marginBottom: 10, flexShrink: 0 }}>
        <span style={{ width: "var(--nav-icon-box)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <BrandMark height={26} />
        </span>
        <span style={fade}><BrandWordmark height={19} /></span>
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
