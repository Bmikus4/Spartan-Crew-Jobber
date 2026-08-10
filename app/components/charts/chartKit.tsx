"use client";

// Shared drawing kit for the dashboard's hand-built SVG charts, so three charts on
// one screen look like one instrument rather than three.
//
// WHY IT EXISTS — the scaling trap, which this tool was fully inside.
//
// Every chart here drew into a FIXED viewBox at width:100% — the sparklines as
// `viewBox="0 0 200 32"` and the intake chart as `viewBox="0 0 620 200"`, both with
// `preserveAspectRatio="none"`. Two things follow, and both were visible:
//
//   1. A viewBox is a SCALE. In a ~1030px column, `620` wide is 1.66x, so an
//      authored strokeWidth of 1.8 painted at 3.0px and an 11px label at 18px. The
//      charts did not have thick lines because anyone chose thick lines.
//   2. `preserveAspectRatio="none"` makes that scale NON-UNIFORM — 1.66x across and
//      1.0x down. A round dot becomes an ellipse and a 1px vertical rule and a 1px
//      horizontal rule are different weights on screen.
//
// The fix is to measure the box and set the viewBox to the measured pixel width, so
// the scale is exactly 1 and every number below means pixels. Choosing smaller
// stroke values instead would only have looked right at one column width.
//
// Deliberately zero-dependency. The quote tool reaches for Recharts for its hero
// chart; this tool has no chart library and does not need ~100KB of one for four
// plots, so what it borrows is the LOOK — the same stroke weights, tick sizes, dot
// radius, dotted ground and line glow.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** One definition of what a chart on this dashboard looks like. */
export const CHART = {
  stroke: 2,
  tickFont: 11,
  tickFill: "var(--text-muted)",
  grid: "var(--border)",
  dotR: 5,
  dotRing: "var(--chart-surface)",
} as const;

/** Measured content width of an element, in whole pixels. 0 until first measure. */
export function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.round(entry.contentRect.width)));
    ro.observe(el);
    setW(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Measures its own box and renders an SVG at 1:1, handing children the real pixel
 * size. The dotted ground and the optional line glow come with it.
 *
 * Renders nothing until measured: a 0-width viewBox is invalid and Chrome drops the
 * whole element.
 */
export function Plot({
  height,
  minWidth = 240,
  glowColor,
  children,
  onMouseMove,
  onMouseLeave,
  ariaLabel,
}: {
  height: number;
  minWidth?: number;
  /** When set, `filter="url(#<glowId>)"` is available to children. */
  glowColor?: string;
  children: (box: { w: number; h: number; glowId: string }) => ReactNode;
  onMouseMove?: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseLeave?: () => void;
  ariaLabel?: string;
}) {
  const [ref, measured] = useChartWidth<HTMLDivElement>();
  const uid = useId().replace(/:/g, "");
  const w = Math.max(minWidth, measured);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      {measured > 0 && (
        <svg
          width={w} height={height} viewBox={`0 0 ${w} ${height}`}
          style={{ display: "block", overflow: "visible" }}
          onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}
          role="img" aria-label={ariaLabel}
        >
          <defs>
            <pattern id={`dots-${uid}`} x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="1" fill="var(--input)" />
            </pattern>
            {glowColor && (
              // Keyed by colour so Chromium repaints the filter when the series
              // changes — mutating floodColor on a live filter id does not always.
              <filter key={glowColor} id={`glow-${uid}`} x="-100%" y="-100%" width="300%" height="300%">
                <feDropShadow dx="3" dy="5" stdDeviation="18" floodColor={glowColor} floodOpacity="0.34" />
              </filter>
            )}
          </defs>
          <rect x={0} y={0} width={w} height={height} fill={`url(#dots-${uid})`} pointerEvents="none" />
          {children({ w, h: height, glowId: `glow-${uid}` })}
        </svg>
      )}
    </div>
  );
}

/** Dashed horizontal gridline + its left tick label, at true pixel size. */
export function GridLine({ y, label, x1, x2 }: { y: number; label?: string; x1: number; x2: number }) {
  return (
    <g>
      <line x1={x1} y1={y} x2={x2} y2={y} stroke={CHART.grid} strokeWidth={1} strokeDasharray="2 5" />
      {label != null && (
        <text x={x1 - 8} y={y + 4} textAnchor="end" fontSize={CHART.tickFont} fill={CHART.tickFill} className="tnum">
          {label}
        </text>
      )}
    </g>
  );
}

/**
 * The small marker in a card's bottom-right corner: hover or focus it for what the
 * card is actually plotting. Every figure on this dashboard is derived — an assumed
 * minutes-per-email, a share of job requests, a count of EVENTS rather than of
 * things — and none of that is legible from a label.
 */
export function InfoDot({ text }: { text: string }) {
  return (
    <span className="info-dot" tabIndex={0} role="note" aria-label={text}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="11" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span className="info-dot__bubble">{text}</span>
    </span>
  );
}
