"use client";

// ============================================================================
// BeamRing — a light that walks a card's own outline. Ported from the House of
// Hud quote tool, where it rings the chat composer and the active nav chip.
// ----------------------------------------------------------------------------
// Ben, 2026-09-02: hours reclaimed goes top-left, "highlighted with the chatbot
// glowing ring from Kairo / the existing quote tool". This is that ring.
//
// OFFSET-PATH, NOT A ROTATION. A conic gradient turning about a centre spends most
// of its 360° off the visible strip on anything wider than it is tall, so on a card
// the light would appear and vanish. This walks the rounded rectangle's own outline,
// which keeps the beam the same brightness and the same speed on every edge.
//
// THE BAND IS CUT BY A MASK, not drawn as a border. Two stacked full-bleed masks
// composited to exclude one another leave exactly the `thickness` ring between the
// border box and the content box, so the light can be an object of any size behind
// a window of any shape. Both spellings are set: the unprefixed pair is the
// standard, the -webkit- pair is what Safari still reads.
//
// THE GRADIENT'S COLOURS ARE LITERALS AND THAT IS DELIBERATE. Every other colour on
// this screen is a token, but Spartan's --accent is a near-white steel; resolved
// through it the comet loses the amber-into-magenta-into-violet run that IS the
// thing Ben pointed at. The 74% stop is a 4% mix rather than `transparent` because
// `transparent` is rgba(0,0,0,0) and a gradient ramping into it dips through BLACK.
// ============================================================================

export function BeamRing({
  radius = 12,
  thickness = 1.5,
  duration = 5,
  inset = 0,
  /** Diameter of the travelling light. A small card wants a small one. */
  blob = 220,
  zIndex = 2,
}: {
  radius?: number;
  thickness?: number;
  duration?: number;
  inset?: number;
  blob?: number;
  zIndex?: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute", inset, borderRadius: radius, zIndex,
        pointerEvents: "none", overflow: "hidden", padding: thickness,
        mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        maskComposite: "exclude",
        WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
      }}
    >
      <span
        style={{
          position: "absolute", width: blob, aspectRatio: "1",
          offsetPath: `rect(0 auto auto 0 round ${radius}px)`,
          offsetDistance: "0%",
          background:
            "radial-gradient(circle, #fff3d6 0%, #ff9a2e 18%, #f2568f 42%, #8b5cf6 62%, color-mix(in srgb, #8b5cf6 4%, transparent) 74%)",
          animation: `beamTravel ${duration}s linear infinite`,
        }}
      />
    </span>
  );
}
