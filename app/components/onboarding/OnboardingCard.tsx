"use client";

import * as React from "react";
import SamuraiMark from "../SamuraiMark";

// The onboarding card. The same design as the quote tool's, with three deliberate
// departures from the shadcn onboarding-form pattern it came from:
//
//  - THE HERO IS THE MARK, not a stock banner. A photograph at the top of a first-run
//    screen is decoration; the mark is the one thing a new person needs to associate with
//    the tool they are about to be inside.
//  - THERE IS NO AVATAR UPLOADER. It is replaced by a read-only organisation card: there
//    is no avatar store and no upload endpoint here, and a button that opens a file picker
//    leading nowhere is worse than not having it. The organisation is a FACT on this card,
//    not a field — it comes from the signed-in domain, so the card states it.
//  - THE FORM IS OPTIONAL. The same card carries the terms step, which has no input at
//    all, so children are composed in rather than assumed.
//
// NO ANIMATION LIBRARY. The quote tool's version uses framer-motion for the staggered
// fade-up; here the same movement is four CSS transitions on a mounted flag. Two packages
// for one entrance on one screen is not a trade worth making, and the app has no other
// framer usage to amortise it against.

export interface OnboardingCardProps {
  title: string;
  description: string;
  /** Shown on the organisation card. */
  organisation: string;
  buttonText: string;
  onSubmit: () => void;
  isSubmitting?: boolean;
  /** Disables the action — the terms step uses it until the text is read. */
  disabled?: boolean;
  children?: React.ReactNode;
}

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/** One element of the staggered entrance. `i` is its place in the queue. */
function Rise({ i, shown, children }: { i: number; shown: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(10px)",
        transition: `opacity 0.34s ease ${i * 0.09}s, transform 0.34s ease ${i * 0.09}s`,
      }}
    >
      {children}
    </div>
  );
}

export default function OnboardingCard({
  title, description, organisation, buttonText, onSubmit,
  isSubmitting = false, disabled = false, children,
}: OnboardingCardProps) {
  const [shown, setShown] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShown(true), 20);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="frosted-glass"
      style={{ width: "100%", maxWidth: 448, overflow: "hidden", borderRadius: "var(--radius-lg)" }}
    >
      <Rise i={0} shown={shown}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "28px 0", borderBottom: "1px solid var(--border-subtle)",
        }}>
          <SamuraiMark height={44} />
        </div>
      </Rise>

      <div style={{ padding: 32, display: "flex", flexDirection: "column", gap: 24 }}>
        <Rise i={1} shown={shown}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.15, margin: 0 }}>
              {title}
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.55, margin: 0 }}>
              {description}
            </p>
          </div>
        </Rise>

        <Rise i={2} shown={shown}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, padding: 12,
            border: "1px solid var(--border)", borderRadius: "var(--radius)",
            background: "var(--surface-2)",
          }}>
            <span style={{
              width: 40, height: 40, flexShrink: 0, borderRadius: "50%",
              background: "var(--surface-hover)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
            }}>
              {initialsOf(organisation)}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-primary)" }}>Your organisation</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{organisation}</span>
            </span>
          </div>
        </Rise>

        {children && <Rise i={3} shown={shown}>{children}</Rise>}

        <Rise i={4} shown={shown}>
          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || disabled}
            style={{
              width: "100%", padding: "13px 14px",
              border: "1px solid var(--accent-border)", borderRadius: "var(--radius)",
              background: "var(--accent)", color: "var(--accent-contrast)",
              fontSize: 14, fontWeight: 600,
              cursor: isSubmitting || disabled ? "default" : "pointer",
              opacity: isSubmitting || disabled ? 0.55 : 1,
              transition: "opacity 0.18s ease, filter 0.18s ease",
            }}
          >
            {isSubmitting ? "Saving…" : buttonText}
          </button>
        </Rise>
      </div>
    </div>
  );
}
