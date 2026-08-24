"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

// The SamurAI lockup — the WHOLE logo, the same file the old Command loading screen used
// (Ben, 2026-08-24), not the ring with the name set as type beside it.
//
// TWO FILES, BECAUSE THE WORDMARK IS WHITE. samurailogo.png is white letters and an orange
// brush enso: perfect on the near-black theme, invisible on the tan one. The light variant
// re-inks ONLY the desaturated pixels, so the letters take the light theme's ink and the
// enso is left exactly as drawn — one artwork, two grounds, and no second brush to keep in
// step. Both are trimmed to the lockup's own alpha bounds, because padding baked into the
// file is height the mark never gets to use at 24px in a header bar.
//
// The theme is read off <html data-theme>, which the boot script in layout.tsx stamps
// before React runs. Nothing holds it in state, so a prop would be a second source of
// truth that starts out wrong.
export default function SamuraiMark({ height = 24 }: { height?: number }) {
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.getAttribute("data-theme") === "light");
  }, []);

  return (
    <Image
      src={light ? "/samurailogo-light.png" : "/samurailogo.png"}
      alt="SamurAI"
      width={1521}
      height={623}
      priority
      unoptimized
      style={{ height, width: "auto", display: "block", flexShrink: 0 }}
    />
  );
}
