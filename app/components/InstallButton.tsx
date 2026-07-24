"use client";

// "Add to Home Screen" — installs the app as a PWA. On Chrome/Edge/Android it
// fires the native install prompt captured by <Pwa/>. On iOS Safari (no
// beforeinstallprompt) it shows the manual Share → Add to Home Screen steps.
import { useEffect, useState } from "react";

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const A = "var(--accent)";

interface BipEvent extends Event {
  prompt: () => void;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallButton() {
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const w = window as unknown as { __bipEvent?: BipEvent; navigator: Navigator & { standalone?: boolean } };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || w.navigator.standalone === true;
    setInstalled(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    const iosLike = /iphone|ipad|ipod/.test(ua) || (ua.includes("macintosh") && "ontouchend" in document);
    setIsIOS(iosLike && !standalone);

    if (w.__bipEvent) setCanInstall(true);
    const onReady = () => setCanInstall(true);
    const onInstalled = () => {
      setInstalled(true);
      setCanInstall(false);
      (window as unknown as { __bipEvent?: BipEvent }).__bipEvent = undefined;
    };
    window.addEventListener("bip-ready", onReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("bip-ready", onReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    const e = (window as unknown as { __bipEvent?: BipEvent }).__bipEvent;
    if (!e) return;
    e.prompt();
    try {
      await e.userChoice;
    } catch {
      /* user dismissed */
    }
    (window as unknown as { __bipEvent?: BipEvent }).__bipEvent = undefined;
    setCanInstall(false);
  }

  if (installed) {
    return (
      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: SUB }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={A} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Installed on this device
      </div>
    );
  }

  if (isIOS) {
    return (
      <div style={{ fontSize: 12.5, color: MUT, lineHeight: 1.6 }}>
        On iPhone or iPad: tap the <b style={{ color: SUB }}>Share</b> button in Safari, then choose{" "}
        <b style={{ color: SUB }}>Add to Home Screen</b>.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <button
        onClick={install}
        disabled={!canInstall}
        style={{
          display: "inline-flex", alignItems: "center", gap: 9,
          padding: "10px 18px", borderRadius: 10,
          border: "1px solid var(--accent-border)",
          background: "var(--accent-subtle)", color: A,
          fontWeight: 700, fontSize: 13.5,
          cursor: canInstall ? "pointer" : "not-allowed",
          opacity: canInstall ? 1 : 0.55, transition: "all 200ms",
        }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12" />
          <polyline points="8 11 12 15 16 11" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
        Add to Home Screen
      </button>
      {!canInstall && (
        <span style={{ fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.5 }}>
          If the button stays greyed out, open your browser menu and choose <b style={{ color: MUT }}>Install app</b> (already installed browsers won&apos;t re-prompt).
        </span>
      )}
    </div>
  );
}
