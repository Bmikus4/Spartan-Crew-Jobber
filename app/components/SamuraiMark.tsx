import Image from "next/image";

// The SamurAI lockup: the enso ring, and the name as TYPE beside it.
//
// THE RING, NOT THE MASK. public/samuraimark.png in the Command repo is a white
// silhouette on transparent — it disappears entirely on the light theme, and a mark
// that needs a second inverted file needs the two files kept in step forever. The
// enso is orange in both grounds, so one asset serves both themes.
//
// THE NAME IS TYPE, NOT ARTWORK, for the same reason: samurailogo.png sets "SAMURAI"
// in white, which is invisible the moment the theme flips. Type inherits the theme's
// ink and costs nothing.
//
// Cap height is set against the ring rather than fixed, so the lockup reads as one
// object at 24px in a header bar and at 56px on the onboarding hero.
export default function SamuraiMark({ height = 24, showName = true }: { height?: number; showName?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(height * 0.38), minWidth: 0 }}>
      <Image
        src="/samurai-enso.png"
        alt="SamurAI"
        width={547}
        height={623}
        priority
        unoptimized
        style={{ height, width: "auto", display: "block", flexShrink: 0 }}
      />
      {showName && (
        <span
          style={{
            color: "var(--text-primary)",
            fontSize: Math.round(height * 0.62),
            fontWeight: 800,
            letterSpacing: "0.04em",
            lineHeight: 1,
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          SamurAI
        </span>
      )}
    </span>
  );
}
