"use client";

import { useState, useEffect } from "react";
import SamuraiMark from "./SamuraiMark";

// The sign-in window: Google is the way in for the internal team; the hidden
// ?admin=<secret> URL remains as an emergency door.
//
// IT IS BUILT AS A WINDOW, not as a centred stack of type — the same shape the quote
// tool's sign-in screen took on 2026-08-24. The card carries the 48px header bar every
// panel in this app has: the SamurAI lockup on the left, the client's name on the right,
// so the first screen anyone sees is recognisably the same product as the fifth. Before
// this it was the only surface here with no chrome — a logo and a sentence on a slab.
//
// THE MARK IS SAMURAI'S, NOT SPARTAN'S, deliberately (Ben, 2026-08-24): this is the
// agency's tool operating the client's booking desk, and the eyebrow on the right is
// where the client is named. The Spartan wordmark still owns the nav rail inside.
export default function LoginScreen() {
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  // READ OFF THE DOCUMENT, not passed down. The theme lives on <html data-theme>, set by
  // the boot script in layout.tsx before React runs, and no component holds it in state —
  // so a prop here would be a second source of truth that starts out wrong.
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(document.documentElement.getAttribute("data-theme") === "light");
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

  // Surface a sign-in error passed back on the URL (e.g. ?authError=not_allowed).
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("authError");
    if (!err) return;
    const map: Record<string, string> = {
      not_allowed: "That account isn't on the approved list. Contact your administrator.",
      oauth_state: "Sign-in timed out — please try again.",
      google_failed: "Google sign-in failed — please try again.",
      google_unconfigured: "Google sign-in isn't set up yet. Please contact your administrator.",
    };
    setError(map[err] || "Sign-in failed — please try again.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // GOOGLE'S OWN PALETTE, NOT THIS APP'S TOKENS. A sign-in button is the one place in a
  // product where the brand rules are somebody else's: Google publishes exactly two
  // grounds — #FFFFFF with a #747775 edge, and #131314 with a #8E918F edge. A white slab
  // on the near-black theme reads as a hole punched in the panel, and the fix is Google's
  // dark variant rather than a tinted button of our own invention.
  const btn: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
    background: light ? "#ffffff" : "#131314",
    color: light ? "#1f1f1f" : "#e3e3e3",
    border: `1px solid ${light ? "#747775" : "#8e918f"}`,
    borderRadius: "var(--radius)", padding: "14px", fontSize: 14, fontWeight: 600,
    textDecoration: "none",
    // brightness() in both directions: dimming a #131314 button does nothing a person
    // can see, so the dark theme lifts instead.
    filter: hover ? (light ? "brightness(0.96)" : "brightness(1.35)") : "none",
    transition: "filter 0.18s ease",
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", justifyContent: "center", alignItems: "center",
        padding: 20, background: "var(--bg)", zIndex: 50,
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.5s ease, transform 0.5s ease", overflowY: "auto",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div className="frosted-glass login-glass">

        {/* THE HEADER BAR. Same height, same padding and same bottom rule as every panel
            header in the app — see AppShell's <header>. The card's own padding moved to
            .login-body so this strip can run to the card's edges; a header bar inset by
            56px is a label, not chrome. */}
        <div className="login-header">
          <SamuraiMark height={30} />
          {/* The client, not the product. Hidden on a phone, where 320px of card cannot
              hold both. */}
          <span className="eyebrow hide-mobile" style={{ whiteSpace: "nowrap" }}>
            <span className="slash">/</span>SPARTAN CREW
          </span>
        </div>

        <div className="login-body">
          {/* A WIDTH, NOT A MAX-WIDTH. The card is a flex item with no width of its own, so
              it would size to max-content — which means the longest line of copy inside
              decides how wide the window is, and shortening a sentence by six words moves
              the whole layout. maxWidth keeps it inside a phone. */}
          <div style={{ width: 320, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 26 }}>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {/* "Sign in", not the product name. The header bar already says which
                  product this is, so a heading repeating it left the screen without a
                  single word about what it wants from the person reading it. */}
              <h1 style={{ color: "var(--text-primary)", fontSize: 24, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.1, margin: 0 }}>
                Sign in
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>
                Use your approved work account to continue.
              </p>
            </div>

            {error && (
              <p role="alert" style={{ color: "var(--danger)", fontSize: 12.5, margin: 0, lineHeight: 1.45 }}>{error}</p>
            )}

            <a
              href="/api/auth/google"
              onMouseEnter={() => setHover(true)}
              onMouseLeave={() => setHover(false)}
              style={btn}
            >
              {/* Full colour in both themes. The G is the one element of the button that
                  Google does not permit recolouring, so it does not follow the theme. */}
              <svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
                <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
                <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
                <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
              </svg>
              Continue with Google
            </a>

            <p style={{ color: "var(--text-faint)", fontSize: 11.5, lineHeight: 1.5, margin: 0, textAlign: "center" }}>
              Access is limited to the Spartan Crew &amp; SamurAI team.
            </p>

          </div>
        </div>
      </div>
    </div>
  );
}
