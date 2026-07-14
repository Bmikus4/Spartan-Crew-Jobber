"use client";

// Nav rail — same architecture as the House of Hud tool (collapsible rail on
// desktop, bottom bar on mobile, Settings pinned to the bottom). Trimmed to a
// single tool: the Dashboard. Settings opens an overlay screen.

import { useState, useEffect } from "react";

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
function ToggleArrow({ expanded }: { expanded: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform 350ms cubic-bezier(0.4,0,0.2,1)", transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}>
      <polyline points="8 2 4 6 8 10" />
    </svg>
  );
}

const NAV_ITEMS: NavItemConfig[] = [{ id: "dashboard", label: "Dashboard", icon: <IconDashboard /> }];
const SETTINGS_ITEM: NavItemConfig = { id: "settings", label: "Settings", icon: <IconSettings /> };
const NAV_BEVEL_SHADOW = "inset 0 1px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.25)";

function Logo() {
  return (
    <div style={{ width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 10, background: "var(--accent-subtle)", border: "1px solid var(--accent-border)" }}>
      <span className="mono" style={{ fontWeight: 800, fontSize: 15, color: "var(--accent)", letterSpacing: "0.02em" }}>SC</span>
    </div>
  );
}

function MobileBottomBar({ activeTool, onSelectTool, onSettings }: SidebarProps) {
  const items = [...NAV_ITEMS, SETTINGS_ITEM];
  return (
    <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, display: "flex", justifyContent: "space-around", alignItems: "center", height: "calc(var(--mobile-nav-h) + var(--mobile-nav-safe) + 20px)", paddingTop: 10, paddingBottom: "calc(var(--mobile-nav-safe) + 10px)", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
      {items.map((item) => {
        const active = activeTool === item.id;
        return (
          <button key={item.id} onClick={() => (item.id === "settings" ? onSettings() : onSelectTool(item.id))}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: active ? "var(--accent)" : "var(--text-primary)", padding: "0 16px", minWidth: 44, height: "100%", justifyContent: "center" }}>
            <span style={{ display: "flex", transform: "scale(0.75)" }}>{item.icon}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function Sidebar({ activeTool, onSelectTool, onSettings }: SidebarProps) {
  const [expanded, setExpanded] = useState(true);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-expanded");
    if (stored !== null) setExpanded(JSON.parse(stored));
  }, []);
  useEffect(() => {
    function check() { const m = window.innerWidth < 768; setIsMobile(m); if (m) setExpanded(false); }
    check(); window.addEventListener("resize", check); return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile) return <MobileBottomBar activeTool={activeTool} onSelectTool={onSelectTool} onSettings={onSettings} />;

  function toggleExpanded() {
    const next = !expanded; setExpanded(next); localStorage.setItem("sidebar-expanded", JSON.stringify(next));
  }
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
        onMouseEnter={() => setHoveredItem(item.id)}
        onMouseLeave={() => setHoveredItem(null)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 0,
          padding: isCondensed ? "3px 2px" : "3px 11px",
          backgroundColor: isCondensed ? "transparent" : fill,
          border: `1px solid ${!isCondensed && active ? "var(--accent-border)" : "transparent"}`,
          borderRadius: "var(--nav-item-radius)",
          boxShadow: !isCondensed && active ? NAV_BEVEL_SHADOW : "none",
          cursor: "pointer", color: iconColor, position: "relative",
          transition: "background-color 250ms, color 250ms, box-shadow 250ms, border-color 250ms, padding 350ms cubic-bezier(0.4,0,0.2,1)",
        }}
      >
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", color: iconColor, width: "var(--nav-icon-box)", height: "var(--nav-icon-box)", borderRadius: "var(--nav-item-radius)", backgroundColor: isCondensed ? fill : "transparent", border: `1px solid ${isCondensed && active ? "var(--accent-border)" : "transparent"}`, boxShadow: isCondensed && active ? NAV_BEVEL_SHADOW : "none", transition: "background-color 250ms, color 250ms" }}>
          {item.icon}
        </span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 14, fontWeight: 500, color: labelColor, whiteSpace: "nowrap", overflow: "hidden", marginLeft: isCondensed ? 0 : 12, opacity: isCondensed ? 0 : 1, transition: "color 250ms, opacity 250ms, margin-left 350ms cubic-bezier(0.4,0,0.2,1)" }}>
          {item.label}
        </span>
        {isCondensed && isHovered && (
          <div style={{ position: "absolute", left: "calc(100% + 12px)", top: "50%", transform: "translateY(-50%)", backgroundColor: "var(--surface-2)", color: "var(--text-primary)", fontSize: 13, fontWeight: 500, padding: "6px 12px", borderRadius: 6, whiteSpace: "nowrap", border: "1px solid var(--border)", zIndex: 120, pointerEvents: "none" }}>
            {item.label}
          </div>
        )}
      </button>
    );
  }

  return (
    <nav role="navigation" aria-label="Main sidebar navigation" className="frosted-glass nav-rail"
      style={{ width, minWidth: width, height: "calc(100% - var(--shell-double-pad))", marginTop: "var(--shell-pad)", marginBottom: "var(--shell-pad)", display: "flex", flexDirection: "column", transition: "width 350ms cubic-bezier(0.4,0,0.2,1), min-width 350ms cubic-bezier(0.4,0,0.2,1)", position: "relative", zIndex: 100, overflowY: "auto", overflowX: "hidden", borderRadius: "0 var(--radius-lg) var(--radius-lg) 0" }}>
      <button onClick={toggleExpanded} aria-expanded={expanded} aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        style={{ position: "absolute", top: "50%", right: 8, transform: "translateY(-50%)", width: 20, height: 20, borderRadius: 4, background: "transparent", color: "var(--text-muted)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 110, padding: 0 }}>
        <ToggleArrow expanded={expanded} />
      </button>

      <div style={{ padding: "16px 0 19px 0", display: "flex", justifyContent: "center" }}>
        <Logo />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px", flex: 1 }}>
        {NAV_ITEMS.map((item) => (
          <div key={item.id} style={{ position: "relative" }}>
            {renderButton(item, { active: activeTool === item.id, onClick: () => onSelectTool(item.id) })}
          </div>
        ))}
      </div>

      <div style={{ padding: "0 8px", borderTop: "1px solid var(--border-subtle)", height: "var(--footer-bar-height)", display: "flex", alignItems: "center" }}>
        {renderButton(SETTINGS_ITEM, { active: activeTool === "settings", onClick: onSettings })}
      </div>
    </nav>
  );
}
