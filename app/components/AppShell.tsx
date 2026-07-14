"use client";

// Client shell — same layout as the House of Hud QuoteToolShell: a collapsible
// nav rail on the left and a single content window on the right. Only two
// surfaces exist: the Dashboard and Settings. Theme (dark/light) is stamped on
// <html data-theme> and persisted, exactly like HoH.

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import DashboardScreen from "./DashboardScreen";
import SettingsScreen from "./SettingsScreen";

type Tool = "dashboard" | "settings";

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const stored = (localStorage.getItem("theme") as "dark" | "light" | null) ?? "dark";
    setTheme(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }
  return (
    <button onClick={toggle} className="theme-toggle" aria-label="Toggle theme"
      style={{ width: 36, height: 36, borderRadius: 9999, display: "grid", placeItems: "center", color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}>
      {theme === "dark" ? (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" /></svg>
      )}
    </button>
  );
}

export default function AppShell() {
  const [tool, setTool] = useState<Tool>("dashboard");

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: "var(--bg)" }}>
      <Sidebar activeTool={tool} onSelectTool={(id) => setTool(id as Tool)} onSettings={() => setTool("settings")} />

      <main style={{ flex: 1, minWidth: 0, height: "calc(100% - var(--shell-double-pad))", margin: "var(--shell-pad) var(--shell-pad) var(--shell-pad) 0", display: "flex", flexDirection: "column" }} className="frosted-glass">
        <header style={{ height: "var(--panel-header-height)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--panel-pad-x)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
            {tool === "dashboard" ? "Dashboard" : "Settings"}
          </span>
          <ThemeToggle />
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {tool === "settings" ? <SettingsScreen /> : <DashboardScreen isActive />}
        </div>
      </main>
    </div>
  );
}
