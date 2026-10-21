"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useIsMobile } from "../lib/useIsMobile";
import { HELP_GREETING, HELP_SUGGESTIONS } from "../lib/help/knowledge";
import { readHelpStream, MAX_HELP_TURNS } from "../lib/help/stream";
import { renderRich } from "./ui/helpMarkdown";

// ───────────────────────────────────────────────────────────────────────────
// THE HUD ASSISTANT, COPIED (House of Hud's Kairo, HelpWidget.tsx at c930fa96), not redesigned:
// the same bubble, panel, messages, report view and keyboard. What differs, and why:
//   - Spartan has no desktop title bar, so the bar's height and controls width are 0.
//   - A report goes to /api/help/report (Spartan's alarm inbox) with the conversation, instead of
//     Kairo's data collection with a quote snapshot; Kairo's auto-filing is not carried over (its
//     signals are phrases about the quote catalogue).
//   - Messages are plain text: Spartan has no @mentions.
//   - Three donor defects are fixed here, not copied: an error answer showed as a blank reply
//     (now said); focus was dropped on BODY when the panel closed (now back on the bubble); the
//     whole history went with every question (now the last MAX_HELP_TURNS).
// ───────────────────────────────────────────────────────────────────────────
// Hud Assistant — a floating help bubble that rests on the top layer of the app,
// always one tap away. On desktop it opens a compact chat card anchored bottom
// -right; on mobile it opens a full sheet pinned to the visible viewport (so the
// keyboard never covers the input). The launcher hides itself on mobile whenever
// the keyboard is up, so it never gets in the way of typing in the app beneath.
// It talks to /api/help (Haiku 4.5) and streams answers grounded in the guide.

// The donor sits above Kairo's window bar (its z-index + 10); Spartan has no window bar.
const TITLE_BAR_H = 0;
const TITLE_BAR_CONTROLS_W = 0;
const WIDGET_Z = 2147483010;
// ───────────────────────────────────────────────────────────────────────────

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const GREETING = HELP_GREETING;

// ── Draggable launcher (AssistiveTouch-style) ─────────────────────────────────
// The help bubble can be dragged anywhere; on release it springs to the nearest
// screen edge with an elastic overshoot and remembers where it was docked. We
// store the dock as { edge, ratio } (ratio = position along that edge, 0..1) so
// it survives rotation / resize instead of a raw pixel pair.
type Edge = "left" | "right" | "top" | "bottom";
interface Dock { edge: Edge; ratio: number }
// THE KEY IS VERSIONED. The default below moved from the right edge to the left on
// 2026-08-26, and the dock is persisted — so everybody who had ever dragged the bubble
// would have kept their stored position and never seen the change, including the person who
// asked for it. Bumping the key re-defaults every browser exactly once.
const DOCK_KEY = "spartan-help-dock-v1";
const FAB_MARGIN = 16;
// easeOutBack — settles past the edge then springs back for the elastic feel.
const SNAP_EASE = "cubic-bezier(0.175, 0.885, 0.32, 1.275)";

// ── tiny viewport hooks (same pattern used elsewhere in the app) ──────────────
function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let baseline = vv.height;
    const check = () => {
      if (vv.height > baseline) baseline = vv.height;
      setVisible(baseline - vv.height > 120);
    };
    check();
    vv.addEventListener("resize", check);
    vv.addEventListener("scroll", check);
    return () => {
      vv.removeEventListener("resize", check);
      vv.removeEventListener("scroll", check);
    };
  }, []);
  return visible;
}

function useVisualViewport(): { height: number; offsetTop: number } {
  const [vp, setVp] = useState<{ height: number; offsetTop: number }>({ height: 0, offsetTop: 0 });
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setVp({ height: vv.height, offsetTop: vv.offsetTop });
    on();
    vv.addEventListener("resize", on);
    vv.addEventListener("scroll", on);
    return () => {
      vv.removeEventListener("resize", on);
      vv.removeEventListener("scroll", on);
    };
  }, []);
  return vp;
}

// The **bold**/list/paragraph renderer moved to ui/helpMarkdown — Leni's Ask column streams
// the same endpoint, and one model's output deserves one renderer.

// ── icons ─────────────────────────────────────────────────────────────────────
function HelpIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}
function FlagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
    </svg>
  );
}

export default function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // Support ticket (data collection): the panel body switches to a minimal form;
  // the record auto-carries the help transcript + the quote-tool state snapshot,
  // so nobody has to describe where they were.
  const [view, setView] = useState<"chat" | "report">("chat");
  const [reportText, setReportText] = useState("");
  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState(false);

  /**
   * WHAT THE NEXT TICKET CARRIES, and what it does not.
   *
   * Grace's four tickets on 2026-08-28 all carried the same 08:17 conversation, with the earlier
   * "Issue filed" confirmations stacked inside them, because the transcript was never anything but
   * "everything so far". A ticket now carries the exchange SINCE the last one.
   *
   * The panel itself is not cleared. The plan said to clear it; that would take the answer the
   * person is still reading off their screen the moment a ticket is filed, and the complaint was
   * about what arrives in the ticket, not about what is on the screen.
   */
  const [filedUpTo, setFiledUpTo] = useState(0);

  const fileTicket = useCallback(async () => {
    const text = reportText.trim();
    if (!text || filing) return;
    setFiling(true);
    setFileError(false);
    let rec: { ref: string } | null = null;
    try {
      const res = await fetch("/api/help/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, messages: messages.slice(filedUpTo), screen: typeof location !== "undefined" ? location.pathname + location.search : null }),
      });
      const j = res.ok ? await res.json().catch(() => null) : null;
      rec = j?.ok ? { ref: String(j.ref) } : null;
    } catch { rec = null; }
    setFiling(false);
    if (!rec) { setFileError(true); return; } // keep the form + text for retry
    const ref = rec.ref;
    setMessages((m) => [...m, { role: "assistant", content: `**Issue filed** — ref **${ref}**. It went to SamurAI Solutions with this conversation attached, so there's nothing else you need to capture.` }]);
    setFiledUpTo(messages.length + 1);
    setReportText("");
    setView("chat");
  }, [reportText, filing, messages, filedUpTo]);

  const isMobile = useIsMobile();
  const keyboardUp = useKeyboardVisible();
  const vp = useVisualViewport();

  const scrollRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  // Closing the panel puts focus back on the bubble (the donor left it on BODY), but not on the
  // first render: the bubble must not take focus from the page it lands on.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ── Draggable launcher state ────────────────────────────────────────────────
  // pos = live top-left in px (null until measured → falls back to the default
  // bottom-right anchor). dragging kills the transition so the bubble tracks the
  // finger 1:1; on release the transition returns and animates the elastic snap.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ grabX: number; grabY: number; startX: number; startY: number; moved: boolean } | null>(null);
  // LEFT EDGE, LOW (Ben, 2026-08-26): against the nav rail, in the bottom third. 0.75 is the
  // top of that third rather than the middle of it, so the bubble sits clear of the floor
  // where the composer and the Browse Templates button live.
  const dockRef = useRef<Dock>({ edge: "left", ratio: 0.75 });
  const suppressClickRef = useRef(false);

  // IT GOES OVER THE RAIL, THE HEADER BAR, AND THE WINDOW BAR (Ben, 2026-08-26). The bubble was
  // inset by the rail's width so it could never sit on top of it; it overlaps all three now,
  // including the installed shell's minimise/maximise/close strip.
  //
  // WHICH IS THE ONE EXCEPTION TO "NOTHING COVERS THE WINDOW BAR", and it is a real exception
  // rather than a relaxation: the bubble draws over the strip but is clamped out of the THREE
  // CONTROLS at its right-hand end — see clampPos. With decorations:false those are the only way
  // to minimise, maximise or close the window, and a 56px bubble parked on top of them is a
  // window nobody can shut. Over the drag region and the trail it is harmless; the window can
  // still be moved by any other part of the strip.
  //
  // WHICH MADE THE RAIL-TRACKING MACHINERY DEAD, so it is gone rather than left inert: a
  // useNavRailOpen subscription, two custom properties read into a ref, and an inset that
  // changed with the rail's width. All of it existed to keep the bubble clear of something it
  // is now allowed to cover. Nothing was left behind for a later reader to wonder about.
  //
  // The z-index already carried this: the bubble is 6000 and the rail is 200. What was
  // stopping the overlap was arithmetic, not paint order.

  // Layout metrics (button size + edge insets). The bottom/top insets on mobile
  // keep the bubble clear of the bottom nav and top bar.
  const layout = useCallback(() => {
    const SIZE = isMobile ? 52 : 56;
    // The plain margin on both: the bubble may sit over the rail on the left and over the
    // header bar at the top. On a phone the top inset still clears the mobile top bar, which
    // is a different thing from a desktop header — that one is a bar the bubble would have to
    // be dragged behind to be lost under, and there is no rail to drag it onto.
    const insetLeft = FAB_MARGIN;
    return { SIZE, m: FAB_MARGIN, insetLeft, insetTop: isMobile ? 64 : FAB_MARGIN, insetBottom: isMobile ? 88 : FAB_MARGIN };
  }, [isMobile]);

  const clampPos = useCallback((left: number, top: number) => {
    const { SIZE, m, insetLeft, insetTop, insetBottom } = layout();
    const vw = window.innerWidth, vh = window.innerHeight;
    const y = Math.min(Math.max(top, insetTop), vh - SIZE - insetBottom);
    // OFF THE WINDOW CONTROLS, and only while the bubble is high enough to reach them. Anywhere
    // below the strip it may sit hard against the right edge as it always could; level with it,
    // its right-hand limit is the start of the three buttons.
    const overlapsBar = y < TITLE_BAR_H;
    const rightLimit = vw - SIZE - m - (overlapsBar ? TITLE_BAR_CONTROLS_W : 0);
    return {
      left: Math.min(Math.max(left, insetLeft), Math.max(insetLeft, rightLimit)),
      top: y,
    };
  }, [layout]);

  // dock → px. Free axis runs along the edge; ratio places it on that axis.
  const dockToPos = useCallback((dock: Dock) => {
    const { SIZE, m, insetLeft, insetTop, insetBottom } = layout();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (dock.edge === "left" || dock.edge === "right") {
      const top = insetTop + dock.ratio * Math.max(0, vh - insetTop - insetBottom - SIZE);
      return { left: dock.edge === "left" ? insetLeft : vw - SIZE - m, top };
    }
    const left = insetLeft + dock.ratio * Math.max(0, vw - insetLeft - m - SIZE);
    return { left, top: dock.edge === "top" ? insetTop : vh - SIZE - insetBottom };
  }, [layout]);

  // px → nearest edge + ratio along it.
  const posToDock = useCallback((left: number, top: number): Dock => {
    const { SIZE, m, insetLeft, insetTop, insetBottom } = layout();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = left + SIZE / 2, cy = top + SIZE / 2;
    // Distance to the LEFT edge is measured from the rail, so dragging the bubble to just
    // right of the rail docks it left rather than reading as "nearer the top".
    const dleft = cx - insetLeft, dright = vw - cx, dtop = cy, dbottom = vh - cy;
    const min = Math.min(dleft, dright, dtop, dbottom);
    const clamp01 = (r: number) => Math.min(1, Math.max(0, r));
    if (min === dleft || min === dright) {
      return { edge: min === dleft ? "left" : "right", ratio: clamp01((top - insetTop) / Math.max(1, vh - insetTop - insetBottom - SIZE)) };
    }
    return { edge: min === dtop ? "top" : "bottom", ratio: clamp01((left - insetLeft) / Math.max(1, vw - insetLeft - m - SIZE)) };
  }, [layout]);

  // Place on mount from the saved dock, and keep it docked across resize/rotate.
  useEffect(() => {
    try { const s = localStorage.getItem(DOCK_KEY); if (s) dockRef.current = JSON.parse(s); } catch { /* default dock */ }
    setPos(dockToPos(dockRef.current));
    const onResize = () => { if (!dragRef.current?.moved) setPos(dockToPos(dockRef.current)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [dockToPos]);

  // Keep the conversation pinned to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  // Focus the field on open (desktop only — on mobile this would pop the
  // keyboard before the user has decided to type).
  useEffect(() => {
    if (open && !isMobile) {
      const t = setTimeout(() => inputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [open, isMobile]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const send = useCallback(async (raw: string) => {
    const content = raw.trim();
    if (!content || loading) return;

    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.slice(-MAX_HELP_TURNS) }),
      });
      const out = await readHelpStream(res, (text) => {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: text };
          return copy;
        });
      });
      if (!out.ok) {
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: "Sorry, I couldn't answer that just now. Please try again in a moment, or use **Report an issue** if it keeps happening." };
          return copy;
        });
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "Sorry — I couldn't reach the help service. Please try again in a moment.",
        };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  // ── Launcher drag handlers ──────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { grabX: e.clientX - pos.left, grabY: e.clientY - pos.top, startX: e.clientX, startY: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // Only start dragging past a small threshold, so a tap still opens the panel.
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6) { d.moved = true; setDragging(true); }
    if (d.moved) setPos(clampPos(e.clientX - d.grabX, e.clientY - d.grabY));
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (!d.moved) return; // a tap, not a drag — let the click open the panel
    suppressClickRef.current = true; // swallow the click that follows a drag
    setDragging(false);
    setPos((p) => {
      if (!p) return p;
      const dock = posToDock(p.left, p.top);
      dockRef.current = dock;
      try { localStorage.setItem(DOCK_KEY, JSON.stringify(dock)); } catch { /* ignore */ }
      return dockToPos(dock); // elastic snap to the edge
    });
  };

  // The launcher disappears while the panel is open and, on mobile, whenever the
  // keyboard is up — so it never sits over what the user is typing in the app.
  const showLauncher = !open && !(isMobile && keyboardUp);

  // Panel geometry: full sheet pinned to the visible viewport on mobile; a
  // compact card anchored bottom-right on desktop.
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: "fixed",
        top: vp.height ? vp.offsetTop : 0,
        left: 0,
        right: 0,
        height: vp.height || "100%",
        zIndex: WIDGET_Z,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
      }
    : {
        position: "fixed",
        bottom: 24,
        right: 24,
        width: 384,
        maxWidth: "calc(100vw - 32px)",
        height: "min(620px, calc(100vh - 120px))",
        zIndex: WIDGET_Z,
        display: "flex",
        flexDirection: "column",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
        overflow: "hidden",
      };

  const showSuggestions = messages.length === 0;

  return (
    <>
      {/* ── Launcher (FAB) ───────────────────────────────────────────────── */}
      {showLauncher && (
        <button
          ref={launcherRef}
          onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } setOpen(true); }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-label="Open the help chat (drag to move it)"
          data-tip={"Ask for help"}
          data-tip-sub={"Explains anything in the tool. Drag the button to move it out of the way."}
          style={{
            position: "fixed",
            ...(pos
              ? { left: pos.left, top: pos.top }
              : {
                  right: isMobile ? 16 : 24,
                  bottom: isMobile ? "calc(var(--mobile-nav-h) + var(--mobile-nav-safe) + 24px)" : 24,
                }),
            zIndex: WIDGET_Z,
            width: isMobile ? 52 : 56,
            height: isMobile ? 52 : 56,
            borderRadius: "50%",
            border: "none",
            cursor: dragging ? "grabbing" : "pointer",
            touchAction: "none",
            userSelect: "none",
            background: "var(--accent)",
            color: "var(--accent-contrast)",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 8px 22px rgba(0,0,0,0.45)",
            transition: dragging
              ? "none"
              : `left 480ms ${SNAP_EASE}, top 480ms ${SNAP_EASE}, background-color 200ms ease, transform 200ms ease`,
          }}
          onMouseEnter={(e) => { if (!dragging) { e.currentTarget.style.background = "var(--accent-hover)"; e.currentTarget.style.transform = "scale(1.05)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "var(--accent)"; e.currentTarget.style.transform = "scale(1)"; }}
        >
          <HelpIcon />
        </button>
      )}

      {/* ── Panel ────────────────────────────────────────────────────────── */}
      {open && (
        <div style={panelStyle} className={isMobile ? "slide-in-bottom" : undefined} role="dialog" aria-label="Help">
          {/* Header */}
          <div
            className="chat-header"
            style={{ borderBottom: "1px solid var(--border)", justifyContent: "space-between", flexShrink: 0 }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span className="eyebrow"><span className="slash">/</span>{view === "report" ? "REPORT" : "HELP"}</span>
              <span style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 600 }}>{view === "report" ? "Report an issue" : "Help"}</span>
            </div>
            <button
              onClick={() => setView((v) => (v === "report" ? "chat" : "report"))}
              aria-label="Report an issue"
              data-tip="Report an issue"
              style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border)",
                background: view === "report" ? "var(--accent-subtle)" : "transparent",
                color: view === "report" ? "var(--accent)" : "var(--text-muted)",
                display: "grid", placeItems: "center", cursor: "pointer", marginLeft: "auto", marginRight: 8,
                transition: "color 200ms ease, border-color 200ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--accent-border)"; }}
              onMouseLeave={(e) => { if (view !== "report") { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; } }}
            >
              <FlagIcon />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close help chat"
              data-tip={"Close"}
              data-tip-sub={"The conversation is kept for when you open it again."}
              style={{
                flexShrink: 0, width: 34, height: 34, borderRadius: "50%", border: "1px solid var(--border)",
                background: "transparent", color: "var(--text-muted)", display: "grid", placeItems: "center", cursor: "pointer",
                transition: "color 200ms ease, border-color 200ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; e.currentTarget.style.borderColor = "var(--accent-border)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border)"; }}
            >
              <CloseIcon />
            </button>
          </div>

          {view === "report" && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 12, padding: 16, overflowY: "auto" }}>
              <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.55 }}>
                Describe the problem or request. Your report automatically includes this conversation
                and the screen you are on, so no screenshots are needed.
              </p>
              <textarea
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder="What went wrong, or what do you need?"
                aria-label="Describe the problem"
                rows={6}
                autoFocus={!isMobile}
                maxLength={5000}
                className="chat-text-input"
                style={{
                  resize: "vertical", minHeight: 120, padding: "10px 14px",
                  background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
                  color: "var(--text-primary)", fontFamily: "inherit", fontSize: 14, lineHeight: 1.5, outline: "none",
                }}
              />
              {/* THE ONE PLACE A CUSTOMER'S DETAILS CAN ESCAPE THE 90-DAY RULE, and it escapes by
                  somebody choosing to type them. Everything else attached to a report is structural
                  by construction — the action trail is a fixed vocabulary of event names, and a
                  chatbot message is recorded as its LENGTH. This box is free text and is kept
                  indefinitely, so the hint is the only control there is. See
                  docs/PRIVACY-POLICY-DRAFT.md, "What we capture when something breaks". */}
              <span style={{ color: "var(--text-faint)", fontSize: 12, lineHeight: 1.5 }}>
                Please leave client names, numbers and addresses out: reports are kept, and
                everything needed to reproduce this is attached already.
              </span>
              {fileError && (
                <span style={{ color: "var(--danger)", fontSize: 12.5 }}>
                  Couldn&apos;t file the report — please try again. Your text is preserved.
                </span>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setView("chat")}
                  style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12.5, fontWeight: 700, padding: "8px 6px" }}
                >
                  CANCEL
                </button>
                <button
                  onClick={() => void fileTicket()}
                  disabled={!reportText.trim() || filing}
                  style={{
                    background: reportText.trim() && !filing ? "var(--accent)" : "var(--surface-2)",
                    color: reportText.trim() && !filing ? "var(--accent-contrast)" : "var(--text-faint)",
                    border: "none", borderRadius: "var(--radius-sm)", cursor: reportText.trim() && !filing ? "pointer" : "default",
                    fontSize: 12.5, fontWeight: 700, letterSpacing: "0.06em", padding: "9px 18px",
                    transition: "background-color 200ms ease, color 200ms ease",
                  }}
                >
                  {filing ? "FILING…" : "FILE REPORT"}
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          {view === "chat" && (
          <div
            ref={scrollRef}
            className="chat-messages chat-font"
            aria-live="polite"
            style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}
          >
            {/* Welcome — always shown at the top */}
            <div style={{ color: "var(--text-secondary)", lineHeight: 1.55 }}>{renderRich(GREETING)}</div>

            {messages.map((m, i) => {
              const isUser = m.role === "user";
              const isLast = i === messages.length - 1;
              const thinking = !isUser && isLast && loading && m.content === "";
              return (
                <div key={i} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
                  <div
                    style={{
                      maxWidth: "86%",
                      lineHeight: 1.55,
                      ...(isUser
                        ? {
                            background: "var(--accent-subtle)",
                            border: "1px solid var(--accent-border)",
                            color: "var(--text-primary)",
                            borderRadius: "var(--radius) var(--radius) 4px var(--radius)",
                            padding: "9px 13px",
                          }
                        : { color: "var(--text-secondary)" }),
                    }}
                  >
                    {thinking ? (
                      <span className="crm-shimmer" style={{ fontWeight: 500 }}>Thinking…</span>
                    ) : isUser ? (
                      // What a PERSON typed is shown as typed. The assistant side goes through
                      // renderRich, which owns its own formatting.
                      <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>
                    ) : (
                      renderRich(m.content)
                    )}
                  </div>
                </div>
              );
            })}

            {/* Suggestion chips — only on an empty conversation */}
            {showSuggestions && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
                {HELP_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{
                      background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 999,
                      color: "var(--text-secondary)", fontSize: 12.5, padding: "7px 12px", cursor: "pointer", textAlign: "left",
                      transition: "background-color 200ms ease, border-color 200ms ease, color 200ms ease",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover)"; e.currentTarget.style.borderColor = "var(--accent-border)"; e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-2)"; e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Input bar */}
          {view === "chat" && (
          <div
            className="chat-input-bar"
            style={{ borderTop: "1px solid var(--border)", flexShrink: 0 }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
              }}
              placeholder="Ask about Spartan Crew…"
              aria-label="Ask a question about Spartan Crew"
              rows={1}
              className="chat-text-input"
              style={{
                flex: 1, resize: "none", maxHeight: 96, padding: "10px 14px",
                background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
                color: "var(--text-primary)", fontFamily: "inherit", fontSize: 14, lineHeight: 1.4, outline: "none",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              aria-label="Send"
              data-tip={"Send"}
              data-tip-sub={"Enter does the same."}
              style={{
                flexShrink: 0, width: 40, height: 40, borderRadius: "50%", border: "none",
                background: input.trim() && !loading ? "var(--accent)" : "var(--surface-2)",
                color: input.trim() && !loading ? "var(--accent-contrast)" : "var(--text-faint)",
                display: "grid", placeItems: "center",
                cursor: input.trim() && !loading ? "pointer" : "default",
                transition: "background-color 200ms ease, color 200ms ease",
              }}
            >
              <SendIcon />
            </button>
          </div>
          )}
        </div>
      )}
    </>
  );
}
