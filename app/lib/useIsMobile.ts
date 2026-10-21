"use client";

import { useState, useEffect } from "react";

// Shared phone-width detector. Starts false (SSR / first paint), then resolves
// on mount — fine here because the app is hidden behind the intro overlay until
// after hydration. Matches the 768px breakpoint used in globals.css.
export function useIsMobile(breakpoint = 768): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);
  return mobile;
}
