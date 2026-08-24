"use client";

// Who is signed in, at the foot of the nav rail.
//
// Condensed the rail is 60px of icons, so this is the colour disc alone; expanded it says
// the person's `@handle` and their organisation beneath it. The rail is where a staffer
// learns which colour is theirs, so the disc here and the disc on the card it opens read
// the same tint from the same component.
//
// CLICKING IT OPENS THEIR CARD, not Settings. The quote tool sends you to Settings →
// Profile instead, and that is right THERE because there is an editor to send you to;
// here there is not, and a row that navigates to a screen which cannot change any of
// these three facts is a dead end dressed as a control.
//
// IT IS BELOW THE LIST, NOT IN IT. Settings is an ordinary row at the end of NAV_ITEMS;
// this sits under the whole list rather than joining it — it is who you are, not somewhere
// to go. The flex:1 on the nav list is what pins it to the bottom.
//
// DESKTOP ONLY. MobileBottomBar has no expanded state — five icons and no labels — so
// there is nowhere for a name and an organisation to appear, and a bare disc among the nav
// glyphs would read as a sixth tool. Sidebar returns the bottom bar before it reaches the
// rail, so this is simply never mounted there.

import { useEffect, useRef, useState } from "react";
import { Avatar } from "./ProfileCard";
import ProfileCard from "./ProfileCard";
import { userTint, nameFor, type DirectoryMember } from "../lib/userIdentity";

const CARD_W = 288;

export default function RailProfile({ expanded }: { expanded: boolean }) {
  const [me, setMe] = useState<DirectoryMember | null>(null);
  const [hovered, setHovered] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/onboarding", { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as { me?: DirectoryMember };
        if (live && d.me?.email) setMe(d.me);
      } catch {
        // The rail is chrome. A person who cannot be named still gets a working nav.
      }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [rect]);

  // Nothing at all until the answer lands. NOT a skeleton: this sits at the bottom of a
  // rail people see on every screen, and a pulsing placeholder there would be the only
  // moving thing in the app's chrome for as long as the request takes.
  if (!me) return null;

  const tint = userTint(me.colourIndex);
  const condensed = !expanded;

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setRect(ref.current?.getBoundingClientRect() ?? null)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-expanded={!!rect}
        // The handle and the assigned colour index are the two facts a screenshot cannot
        // check, so they are on the element for a probe to read.
        data-rail-profile={me.handle}
        data-colour-index={me.colourIndex}
        title={condensed ? `${nameFor(me)} · @${me.handle}` : undefined}
        aria-label={`Your profile: ${nameFor(me)}`}
        style={{
          // The same asymmetric padding as a nav row, so the disc lands in the same 40px
          // column as the icons above it rather than 4px off it.
          display: "flex", alignItems: "center", gap: 12,
          padding: "3px 6px",
          margin: "6px 4px 8px",
          appearance: "none", border: "1px solid transparent", textAlign: "left", cursor: "pointer",
          borderRadius: "var(--nav-item-radius)",
          background: hovered && !condensed ? "var(--surface-hover)" : "transparent",
          transition: "background-color 250ms var(--nav-ease)",
          flexShrink: 0,
        }}
      >
        <span style={{
          width: "var(--nav-icon-box)", height: "var(--nav-icon-box)", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          borderRadius: "var(--nav-item-radius)",
          background: hovered && condensed ? "var(--surface-hover)" : "transparent",
          transition: "background-color 250ms var(--nav-ease)",
        }}>
          <Avatar member={me} size={26} />
        </span>
        {/* Opacity + visibility on the rail's own clock, like every other label. */}
        <span
          aria-hidden={condensed}
          style={{
            display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1,
            opacity: condensed ? 0 : 1,
            visibility: condensed ? "hidden" : "visible",
            transition: "opacity var(--nav-dur) var(--nav-ease), visibility var(--nav-dur)",
          }}
        >
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: tint.fg, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            @{me.handle}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {/* The organisation, or the person — and their handle if neither is on record
                yet, which is the case until they have been through onboarding. */}
            {me.organisation || nameFor(me)}
          </span>
        </span>
      </button>

      {rect && (
        <>
          {/* A click anywhere else dismisses. Transparent, full-screen, BELOW the card. */}
          <div onClick={() => setRect(null)} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "transparent" }} />
          <div
            role="dialog"
            aria-label={`${nameFor(me)}'s profile`}
            style={{
              // ANCHORED TO THE MEASURED RECT, in viewport coordinates. The rail scrolls
              // and clips its own overflow, and this card is taller than the row it hangs
              // off — positioned inside the rail, its bottom would simply be cut.
              position: "fixed",
              left: Math.min(rect.left, window.innerWidth - CARD_W - 8),
              bottom: Math.max(8, window.innerHeight - rect.top + 6),
              zIndex: 4001, width: CARD_W,
              background: "var(--surface-2)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.34)",
              padding: 14,
            }}
          >
            <ProfileCard member={me} />
          </div>
        </>
      )}
    </>
  );
}
