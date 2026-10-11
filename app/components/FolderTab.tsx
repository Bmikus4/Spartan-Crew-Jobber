"use client";

// ONE FOLDER TAB, in the Kairo quote tool's style (hoh-onelist app/components/ui/FolderTabs.tsx),
// cut down to the single tab Spartan needs: Analytics, opened as a popup from the TV board and
// from Settings (Ben, 2026-10-11). It is drawn as the open tab of a folder: rounded top corners,
// no bottom edge, standing on a 1px line that runs the width of the screen, with a curved foot
// on each side flaring into that line.
//
// THE FEET ARE STROKED PATHS, NOT GRADIENTS, and the half pixels are the point (the Kairo file
// says why at length): a 1px stroke straddles its path, so the arc's centreline starts at x 0.5
// and ends at y 9.5 to land exactly on the tab's side border and on the line. Each foot's 10px
// square sits one pixel inside the tab, so the tab's own border is local x 0..1 (right foot) or
// 9..10 (left foot). Fixed at 10px whatever the screen's scale: a scaled stroke stops being 1px.
//
// THE TAB STANDS ON THE LINE'S OWN PIXEL ROW and is painted over it, so the line has a gap the
// width of the tab: that missing pixel of line is what makes it a tab and not a button on a rule.

function Foot({ side, face }: { side: "l" | "r"; face: string }) {
  const arc = side === "r" ? "M0.5 0 A9.5 9.5 0 0 0 10 9.5" : "M9.5 0 A9.5 9.5 0 0 1 0 9.5";
  const fill = side === "r" ? `${arc} L10 10 L-1 10 L-1 0 Z` : `${arc} L0 10 L11 10 L11 0 Z`;
  return (
    <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden focusable="false"
      style={{ position: "absolute", bottom: 0, [side === "r" ? "left" : "right"]: "100%", marginLeft: side === "r" ? 0 : undefined, overflow: "visible", pointerEvents: "none" } as React.CSSProperties}>
      <path d={fill} fill={face} />
      <path d={arc} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
    </svg>
  );
}

export default function FolderTab({ label, onOpen, s = 1, face = "var(--bg)" }: { label: string; onOpen: () => void; s?: number; face?: string }) {
  return (
    <div style={{ position: "relative", height: 47, display: "flex", alignItems: "flex-end", justifyContent: "flex-end", flexShrink: 0, paddingRight: 11 }}>
      <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1, background: "var(--border-strong)" }} />
      <button type="button" onClick={onOpen} aria-haspopup="dialog"
        style={{
          position: "relative", zIndex: 1, width: 188, height: 43, padding: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9,
          background: face, border: "1px solid var(--border-strong)", borderBottom: "none", borderRadius: "14px 14px 0 0",
          color: "var(--text-secondary)", fontFamily: "inherit", fontSize: 13 * Math.max(s, 0.85), fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
        }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="5" y1="20" x2="5" y2="12" /><line x1="12" y1="20" x2="12" y2="5" /><line x1="19" y1="20" x2="19" y2="9" />
        </svg>
        {label}
        <Foot side="l" face={face} />
        <Foot side="r" face={face} />
      </button>
    </div>
  );
}
