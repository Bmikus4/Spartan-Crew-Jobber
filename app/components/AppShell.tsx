"use client";

// Client shell — same layout as the House of Hud QuoteToolShell: a collapsible
// nav rail on the left and a single content window on the right. Only two
// surfaces exist: the Dashboard and Settings. Theme (dark/light) is stamped on
// <html data-theme> and persisted, exactly like HoH.

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import JobsScreen from "./JobsScreen";
import LiveFeedScreen from "./LiveFeedScreen";
import SettingsScreen from "./SettingsScreen";
import LoginScreen from "./LoginScreen";
import OnboardingFlow from "./onboarding/OnboardingFlow";

// TWO SCREENS (Ben, 2026-10-11): the Live Feed, which is the ops list, and Settings. The Jobs
// Board returns only when Settings switches it on; Analytics is a popup from a folder tab.
type Tool = "jobs" | "live" | "settings";

const TITLES: Record<Tool, string> = { jobs: "Jobs Board", live: "Live Feed", settings: "Settings" };

interface Auth { loading: boolean; authenticated: boolean; authRequired: boolean; name?: string; email?: string }

export default function AppShell() {
  const [tool, setTool] = useState<Tool>("live");
  const [jobsBoard, setJobsBoard] = useState(false);
  useEffect(() => {
    const read = async () => {
      try { const r = await fetch("/api/settings", { cache: "no-store" }); if (r.ok) setJobsBoard(!!(await r.json()).jobs_board_enabled); } catch { /* keep what it was */ }
    };
    void read();
    window.addEventListener("spartan:settings", read);
    return () => window.removeEventListener("spartan:settings", read);
  }, []);
  // Switching the board off while it is open lands on the Live Feed, not on a blank window.
  const shown: Tool = tool === "jobs" && !jobsBoard ? "live" : tool;
  const [auth, setAuth] = useState<Auth>({ loading: true, authenticated: false, authRequired: false });
  // ?tv=1 is the office TV: the live feed alone, no rail and no title bar. Read in an
  // effect, not during render, so the server's first paint and the client's agree.
  const [tv, setTv] = useState(false);

  useEffect(() => {
    void (async () => {
      // Break-glass: ?admin=<ADMIN_SECRET> signs in without Google (validated server-side).
      const params = new URLSearchParams(window.location.search);
      setTv(params.get("tv") === "1");
      const admin = params.get("admin");
      if (admin) {
        try { await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "admin", secret: admin }) }); } catch {}
        params.delete("admin");
        const rest = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
      }
      try {
        const d = await (await fetch("/api/auth")).json();
        setAuth({ loading: false, authenticated: !!d.authenticated, authRequired: !!d.authRequired, name: d.name, email: d.email });
      } catch {
        setAuth({ loading: false, authenticated: false, authRequired: false });
      }
    })();
  }, []);

  // ONBOARDING RUNS ONCE PER MOUNT, AND ONLY FOR SOMEBODY SIGNED IN. It is its own
  // overlay rather than a screen in the shell, because the two gates it carries are
  // company-level and person-level facts the server owns — see OnboardingFlow.
  const [onboarded, setOnboarded] = useState(false);

  if (auth.loading)
    return <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--bg)" }}><span className="crm-shimmer" style={{ color: "var(--text-muted)" }}>Loading…</span></div>;
  if (auth.authRequired && !auth.authenticated) return <LoginScreen />;
  // Signed in and not yet through the flow: the overlay decides whether anything is
  // actually outstanding, and lets everybody through when it cannot tell.
  const gate = auth.authenticated && !onboarded
    ? <OnboardingFlow onDone={() => setOnboarded(true)} />
    : null;

  if (tv) return <div style={{ height: "100%", width: "100%" }}>{gate}<LiveFeedScreen isActive tv /></div>;

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", background: "var(--bg)" }}>
      {gate}
      {/* The rail is flush and unframed; the content window is the only framed thing
          on screen. It used to be a second floating card with its own border, radius
          and inset highlight, competing with the panel that holds the work. */}
      <Sidebar activeTool={shown} jobsBoard={jobsBoard} onSelectTool={(id) => setTool(id as Tool)} onSettings={() => setTool("settings")} />

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
          <span className="eyebrow"><span className="slash">/</span>{TITLES[shown].toUpperCase()}</span>
        </header>
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* The dashboard's queue strip names lanes of the board, so it can send you
              there — a number you cannot act on is only half a dashboard. */}
          {shown === "settings"
            ? <SettingsScreen signedInAs={auth.authenticated ? auth.email : undefined} />
            : shown === "jobs" ? <JobsScreen isActive />
            : <LiveFeedScreen isActive />}
        </div>
      </main>
    </div>
  );
}
