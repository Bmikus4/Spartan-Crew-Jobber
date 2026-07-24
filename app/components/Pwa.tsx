"use client";

// App-wide PWA wiring: register the service worker and capture the
// beforeinstallprompt event as early as possible (it can fire before the
// Settings screen mounts). The captured event is stashed on window so the
// InstallButton can trigger it on demand; a "bip-ready" event notifies it.
import { useEffect } from "react";

export default function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onBip = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __bipEvent?: Event }).__bipEvent = e;
      window.dispatchEvent(new Event("bip-ready"));
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);
  return null;
}
