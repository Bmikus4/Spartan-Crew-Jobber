"use client";

// Client shell — same layout as the House of Hud QuoteToolShell: a collapsible
// nav rail on the left and a single content window on the right. Only two
// surfaces exist: the Dashboard and Settings. Theme (dark/light) is stamped on
// <html data-theme> and persisted, exactly like HoH.

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import DashboardScreen from "./DashboardScreen";
import JobsScreen from "./JobsScreen";
import SettingsScreen from "./SettingsScreen";
import LoginScreen from "./LoginScreen";

type Tool = "dashboard" | "jobs" | "settings";

const TITLES: Record<Tool, string> = { dashboard: "Dashboard", jobs: "Jobs Board", settings: "Settings" };

interface Auth { loading: boolean; authenticated: boolean; authRequired: boolean; name?: string; email?: string }

function AccountButton({ email }: { email?: string }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try { await fetch("/api/auth", { method: "DELETE" }); } catch {}
    window.location.href = "/";
  }
  return (
    <button onClick={logout} disabled={busy} title={email ? `Sign out (${email})` : "Sign out"} aria-label="Sign out"
      style={{ width: 36, height: 36, borderRadius: 9999, display: "grid", placeItems: "center", color: "var(--text-muted)", background: "transparent", border: "1px solid var(--border)", cursor: "pointer" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
    </button>
  );
}

/**
 * Both icons are always in the DOM and `data-theme` decides which one shows (see
 * .theme-toggle in globals.css). That CSS existed already and was dead: this
 * button branched in JSX on its own copy of the theme instead, which meant the
 * icon could only be right if React's state agreed with the attribute on <html> —
 * and the attribute is now set before React exists.
 *
 * So there is no theme state here at all. The attribute IS the state; the button
 * reads it, flips it, and stores it.
 */
function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    // One beat of .theme-anim makes the whole UI crossfade on one clock instead of
    // each component running its own inline transition (or none).
    root.classList.add("theme-anim");
    window.setTimeout(() => root.classList.remove("theme-anim"), 300);
    root.setAttribute("data-theme", next);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next === "light" ? "#efe8da" : "#0e0e0e");
    try { localStorage.setItem("theme", next); } catch {}
  }
  return (
    <button onClick={toggle} className="theme-toggle" aria-label="Toggle light or dark theme" title="Toggle theme">
      <svg className="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
      <svg className="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.2" y1="4.2" x2="5.6" y2="5.6" /><line x1="18.4" y1="18.4" x2="19.8" y2="19.8" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.2" y1="19.8" x2="5.6" y2="18.4" /><line x1="18.4" y1="5.6" x2="19.8" y2="4.2" /></svg>
    </button>
  );
}

export default function AppShell() {
  const [tool, setTool] = useState<Tool>("dashboard");
  const [auth, setAuth] = useState<Auth>({ loading: true, authenticated: false, authRequired: false });

  useEffect(() => {
    void (async () => {
      // Break-glass: ?admin=<ADMIN_SECRET> signs in without Google (validated server-side).
      const admin = new URLSearchParams(window.location.search).get("admin");
      if (admin) {
        try { await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "admin", secret: admin }) }); } catch {}
        window.history.replaceState({}, "", window.location.pathname);
      }
      try {
        const d = await (await fetch("/api/auth")).json();
        setAuth({ loading: false, authenticated: !!d.authenticated, authRequired: !!d.authRequired, name: d.name, email: d.email });
      } catch {
        setAuth({ loading: false, authenticated: false, authRequired: false });
      }
    })();
  }, []);

  if (auth.loading)
    return <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--bg)" }}><span className="crm-shimmer" style={{ color: "var(--text-muted)" }}>Loading…</span></div>;
  if (auth.authRequired && !auth.authenticated) return <LoginScreen />;

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: "var(--bg)" }}>
      <Sidebar activeTool={tool} onSelectTool={(id) => setTool(id as Tool)} onSettings={() => setTool("settings")} />

      <main style={{ flex: 1, minWidth: 0, height: "calc(100% - var(--shell-double-pad))", margin: "var(--shell-pad)", display: "flex", flexDirection: "column" }} className="frosted-glass">
        <header style={{ height: "var(--panel-header-height)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--panel-pad-x)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.02em" }}>
            {TITLES[tool]}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {auth.authenticated && <AccountButton email={auth.email} />}
            <ThemeToggle />
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* The dashboard's queue strip names lanes of the board, so it can send you
              there — a number you cannot act on is only half a dashboard. */}
          {tool === "settings" ? <SettingsScreen /> : tool === "jobs" ? <JobsScreen isActive /> : <DashboardScreen isActive onOpenBoard={() => setTool("jobs")} />}
        </div>
      </main>
    </div>
  );
}
