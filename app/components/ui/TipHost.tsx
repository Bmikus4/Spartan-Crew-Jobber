"use client";

// ONE TOOLTIP FOR THE WHOLE APP, driven by an attribute.
//
// WHY NOT A <Tooltip> WRAPPER. The obvious component wraps its child, and that is exactly
// what this app cannot afford: the controls that most need a tooltip are absolutely placed
// on a photograph, or flex children whose width is load-bearing, or sit inside boxes with
// `overflow: hidden` that would clip the bubble. A wrapper changes the box, and cloneElement
// to avoid that breaks on any child that already owns its handlers.
//
// So: one host, mounted once, listening on the document. Anything with `data-tip` gets a
// tooltip — including markup that did not exist when this file was written — and adding one
// costs an attribute rather than a component and a state hook. The bubble is portalled to
// <body>, so no ancestor's overflow can clip it.
//
// NATIVE `title` IS THE THING THIS REPLACES. Do not leave both on one element: the browser's
// own tip appears a second later, in its own style, saying the same words twice. Where a
// `data-tip` is added, the `title` comes off.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCloseOnTabSwitch } from "../../lib/tabSwitch";

const DELAY_IN = 320;     // long enough that crossing a row of tags does not strobe
const DELAY_OUT = 90;
const GAP = 9;            // between the trigger's edge and the bubble
// Clear of the app's own window, not merely of the viewport: --shell-pad insets the panel 8px,
// so an 8px margin here put a clamped bubble exactly on the window's border. Keep it ahead of
// --shell-pad or the tip sits on the frame again.
const EDGE = 16;

interface Shown {
  text: string;
  sub: string | null;
  x: number;              // centre of the trigger
  top: number;            // trigger's top edge
  bottom: number;         // trigger's bottom edge
}

export default function TipHost() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => { setHost(document.body); }, []);
  // A BUBBLE IS AN ARTIFACT TOO. It clears on pointerout, on scroll and on Escape, and none of
  // those is a tab press: the pointer can leave a trigger and land on a tab in one movement.
  // Portalled to <body>, so the tab it belonged to cannot hide it either.
  useCloseOnTabSwitch(useCallback(() => { setShown(null); setPos(null); }, []));

  useEffect(() => {
    const clear = () => { if (timer.current != null) { clearTimeout(timer.current); timer.current = null; } };

    const open = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      const r = el.getBoundingClientRect();
      // A trigger scrolled out of view is not a trigger. This happens with delegated
      // listeners when a pointerover fires as the page moves under the cursor.
      if (r.bottom < 0 || r.top > document.documentElement.clientHeight) return;
      setShown({
        text,
        sub: el.getAttribute("data-tip-sub"),
        x: r.left + r.width / 2,
        top: r.top,
        bottom: r.bottom,
      });
    };

    const onOver = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      clear();
      if (!el) { setShown(null); setPos(null); return; }
      // Instant when moving between two tips — the delay is for the first one only, so a
      // row of tags reads as one surface rather than re-arming on every chip.
      timer.current = window.setTimeout(() => open(el), shown ? 0 : DELAY_IN);
    };

    const onOut = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
      if (!el) return;
      clear();
      timer.current = window.setTimeout(() => { setShown(null); setPos(null); }, DELAY_OUT);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { clear(); setShown(null); setPos(null); } };
    const onScroll = () => { clear(); setShown(null); setPos(null); };

    // pointerover/out rather than mouseenter/leave: those do not bubble, so one listener
    // on the document could never see them.
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("focusin", onOver, true);
    document.addEventListener("focusout", onOut, true);
    document.addEventListener("keydown", onKey, true);
    // Capture on scroll, because the scrolling element is a panel and not the window.
    window.addEventListener("scroll", onScroll, true);
    return () => {
      clear();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("focusin", onOver, true);
      document.removeEventListener("focusout", onOut, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [shown]);

  // MEASURED, THEN PLACED. The bubble's own width decides whether it fits on the left or
  // has to be nudged in, and its height decides whether it goes above or below — neither
  // is knowable before it has rendered, so it renders invisible for one frame.
  //
  // THE EDGE MARGIN HAS TO CLEAR THE SHELL, NOT THE VIEWPORT (Ben, 2026-09-16: "Tooltips in
  // header bar buttons are off the page").
  //
  // MEASURED FIRST, and the obvious explanations are both wrong. The bubbles for Send and Home
  // are inside the viewport — 1432..1672 and 1505..1672 on a 1680 window, at two widths. And it
  // is not the scrollbar eating the margin either: this app's root never scrolls, its panels do,
  // so clientWidth and innerWidth are the same number here.
  //
  // What is actually happening is arithmetic. The clamp kept the bubble 8px inside the viewport,
  // and `--shell-pad` insets the app's own window by exactly 8px too — so a clamped bubble lands
  // with its right edge ON the window's border, every time, to the pixel. It has not left the
  // page but it has left the PANEL, which is the edge a reader sees. EDGE is bigger than
  // --shell-pad on purpose; if that variable changes, this has to stay ahead of it.
  //
  // AND THERE WAS NO VERTICAL CLAMP AT ALL. The flip covers the common case — a tip goes above
  // unless there is no room, and a trigger low on the screen has room above it — but a trigger
  // TALL enough to reach both ends of the viewport takes the `below` branch and lands its bubble
  // past the bottom with nothing to stop it. An expanded catalogue card is that tall.
  useEffect(() => {
    if (!shown) return;
    const el = bubble.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // clientWidth/clientHeight rather than innerWidth/innerHeight: the same number today, and
    // the correct one the moment anything here does scroll.
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const below = shown.top - r.height - GAP < 4;
    // max() SECOND, so a bubble bigger than the space is pinned to the top-left rather than to a
    // negative coordinate — clipped, but from the edge a reader starts at.
    const left = Math.max(EDGE, Math.min(shown.x - r.width / 2, vw - r.width - EDGE));
    const wanted = below ? shown.bottom + GAP : shown.top - r.height - GAP;
    const top = Math.max(EDGE, Math.min(wanted, vh - r.height - EDGE));
    setPos({ left, top, below });
  }, [shown]);

  if (!host || !shown) return null;

  return createPortal(
    <div
      ref={bubble}
      role="tooltip"
      style={{
        position: "fixed",
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
        // 9999: above the catalogue overlay (95) and the nav rail (100), because a tooltip
        // that loses to the thing it is describing is not a tooltip.
        zIndex: 9999,
        maxWidth: 280, pointerEvents: "none",
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        borderRadius: "var(--radius-sm)",
        boxShadow: "0 8px 22px rgba(0,0,0,0.22)",
        padding: shown.sub ? "7px 10px" : "5px 9px",
        opacity: pos ? 1 : 0,
        transform: pos ? "none" : "translateY(2px)",
        transition: "opacity 110ms ease, transform 110ms ease",
      }}
    >
      <div style={{
        fontSize: 11.5, fontWeight: 600, lineHeight: 1.35,
        color: "var(--text-primary)", whiteSpace: "pre-line",
      }}>
        {shown.text}
      </div>
      {shown.sub && (
        // The second line is for the thing a person cannot see: what it will change, or why
        // it is disabled. Never a restatement of the first line.
        <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.4, color: "var(--text-muted)" }}>
          {shown.sub}
        </div>
      )}
    </div>,
    host,
  );
}
