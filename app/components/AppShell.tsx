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
      {/* The rail is flush and unframed; the content window is the only framed thing
          on screen. It used to be a second floating card with its own border, radius
          and inset highlight, competing with the panel that holds the work. */}
      <Sidebar activeTool={tool} onSelectTool={(id) => setTool(id as Tool)} onSettings={() => setTool("settings")} />

      <main style={{ flex: 1, minWidth: 0, height: "calc(100% - var(--shell-double-pad))", margin: "var(--shell-pad) var(--shell-pad) var(--shell-pad) 0", display: "flex", flexDirection: "column" }} className="frosted-glass">
        {/* THE window's one title bar. It used to hold a plain 13px title while each
            screen drew a second bar beneath it with the same word as an eyebrow — 96px
            of chrome to say "Dashboard" twice. The eyebrow moved up here, so a screen
            owns only its content. */}
        <header style={{ height: "var(--panel-header-height)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 var(--panel-pad-x)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {/* Nothing but the eyebrow. The theme toggle and sign-out moved to the
              footer of Settings, where the quote tool keeps them (Ben, 2026-08-10) —
              a control you touch twice a year does not belong in the chrome of every
              screen. */}
          <span className="eyebrow"><span className="slash">/</span>{TITLES[tool].toUpperCase()}</span>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* The dashboard's queue strip names lanes of the board, so it can send you
              there — a number you cannot act on is only half a dashboard. */}
          {tool === "settings"
            ? <SettingsScreen signedInAs={auth.authenticated ? auth.email : undefined} />
            : tool === "jobs" ? <JobsScreen isActive />
            : <DashboardScreen isActive onOpenBoard={() => setTool("jobs")} />}
        </div>
      </main>
    </div>
  );
}
