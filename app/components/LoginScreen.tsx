"use client";

import { useState, useEffect } from "react";
import BrandLogo from "./BrandLogo";

// SSO sign-in window: Google is the way in for the internal team; the hidden
// ?admin=<secret> door remains for emergencies.
export default function LoginScreen() {
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, []);

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

  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", justifyContent: "center", alignItems: "center",
        padding: 20, background: "var(--bg)", zIndex: 50,
        opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(8px)",
        transition: "opacity 0.5s ease, transform 0.5s ease", overflowY: "auto",
      }}
    >
      <div className="frosted-glass" style={{ borderRadius: "var(--radius-lg)", border: "1px solid var(--border)", padding: "34px 30px", maxWidth: 360, width: "100%" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <BrandLogo />
            <span className="eyebrow"><span className="slash">/</span>BOOKING ENGINE</span>
            <p style={{ color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.5, margin: 0 }}>
              Sign in with your approved work account to continue.
            </p>
          </div>

          {error && (
            <p role="alert" style={{ color: "var(--danger)", fontSize: 12.5, margin: 0, lineHeight: 1.45 }}>{error}</p>
          )}

          <a
            href="/api/auth/google"
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 11,
              background: "#ffffff", color: "#1f1f1f", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", padding: "14px", fontSize: 14, fontWeight: 600,
              textDecoration: "none", filter: hover ? "brightness(0.96)" : "none", transition: "filter 0.18s ease",
            }}
          >
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
  );
}
