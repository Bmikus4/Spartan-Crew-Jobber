"use client";

import { useEffect, useState } from "react";
import OnboardingCard from "./OnboardingCard";
import { TERMS_SECTIONS } from "../../lib/terms";

// First-run onboarding. Two gates, and they are NOT the same gate:
//
//   TERMS   — once per ORGANISATION. The first person from an approved domain to sign in
//             accepts on the company's behalf; nobody after them sees it.
//   PROFILE — once per PERSON. Everyone does this, including that first person, who does
//             it immediately after accepting.
//
// The server decides which are outstanding (see /api/onboarding). This component never
// infers it from local state, because "have my colleagues already agreed" is not a
// question a browser can answer.

interface State {
  email: string;
  organisation: string;
  suggestedName: string;
  needsTerms: boolean;
  needsProfile: boolean;
}

/** A step slides in from the right as the last one leaves to the left. */
function Step({ children }: { children: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 20);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      width: "100%", maxWidth: 448,
      opacity: shown ? 1 : 0,
      transform: shown ? "translateX(0)" : "translateX(40px)",
      transition: "opacity 0.3s ease, transform 0.34s cubic-bezier(0.22,1,0.36,1)",
    }}>
      {children}
    </div>
  );
}

const FIELD: React.CSSProperties = {
  width: "100%", padding: "11px 12px",
  background: "var(--input)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  fontSize: 13.5, outline: "none",
};

export default function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [step, setStep] = useState<"terms" | "profile" | "done">("terms");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [readTerms, setReadTerms] = useState(false);
  const [org, setOrg] = useState("");

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/onboarding", { cache: "no-store" });
        if (!r.ok) { onDone(); return; }
        const s = (await r.json()) as State;
        if (!live) return;
        if (!s.needsTerms && !s.needsProfile) { onDone(); return; }
        setState(s);
        setName(s.suggestedName);
        setContactEmail(s.email);
        setOrg(s.organisation);
        setStep(s.needsTerms ? "terms" : "profile");
      } catch {
        // Onboarding must never be the reason somebody cannot work. Any failure reaching
        // the server lets them straight through.
        onDone();
      }
    })();
    return () => { live = false; };
  }, [onDone]);

  /**
   * THE CURTAIN HAS A DEADLINE.
   *
   * The overlay is up while the check is in flight, so a request that never answers — not
   * an error, just silence — would leave the dashboard behind a blank ground with no way
   * past it. A `catch` cannot see that case. Six seconds is far longer than the call takes
   * and short enough that nobody sits looking at it, and letting them through is the
   * direction every other failure here takes.
   */
  useEffect(() => {
    if (state) return;
    const t = setTimeout(onDone, 6000);
    return () => clearTimeout(t);
  }, [state, onDone]);

  // The tick holds long enough to read as a confirmation rather than a flash, then hands
  // over. 1200ms: shorter reads as a glitch, longer reads as a wait.
  useEffect(() => {
    if (step !== "done") return;
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, [step, onDone]);

  /**
   * THE CURTAIN IS UP BEFORE THE ANSWER COMES BACK, and NOTHING IS DRAWN ON IT.
   *
   * Returning null until /api/onboarding replies would let a first-run user watch the
   * dashboard open, sit in it for a second, and then have it taken away by a terms screen.
   * An empty overlay on the app's own ground is indistinguishable from the app still
   * loading, which is exactly what is happening — and a spinner for a request that usually
   * answers in 200ms is a flash of its own.
   */
  if (!state) {
    return <div data-onboarding="checking" style={{ position: "fixed", inset: 0, zIndex: 9998, background: "var(--bg)" }} />;
  }

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } finally {
      setBusy(false);
    }
  }

  async function acceptTerms() {
    await post({ step: "terms" });
    setStep(state!.needsProfile ? "profile" : "done");
  }

  async function saveProfile() {
    if (!name.trim()) return;
    await post({ step: "profile", displayName: name.trim(), contactEmail: contactEmail.trim(), organisation: org.trim() });
    setStep("done");
  }

  return (
    <div
      // Which step is in front of the app, for a probe. This overlay covers everything, so
      // a script that does not know it is here reports a timeout on whatever it was
      // reaching for and says nothing about why.
      data-onboarding={step}
      style={{
        position: "fixed", inset: 0, zIndex: 9998, background: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, overflowY: "auto",
      }}
    >
      {step === "terms" && (
        <Step key="terms">
          <OnboardingCard
            title="Welcome to the booking engine"
            description={`Before ${org || "your organisation"} begins, please read how we handle your data. You are accepting this on behalf of your organisation — your colleagues will not be asked again.`}
            buttonText={readTerms ? "Accept and continue" : "Scroll to read"}
            disabled={!readTerms}
            isSubmitting={busy}
            onSubmit={acceptTerms}
          >
            <div
              onScroll={(e) => {
                const el = e.currentTarget;
                // Enabled only once the text has actually been scrolled to the end. A tick
                // box beside unread text is a fiction; this at least records that the words
                // went past their eyes.
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadTerms(true);
              }}
              style={{
                height: 224, overflowY: "auto", textAlign: "left", padding: 16,
                border: "1px solid var(--border)", borderRadius: "var(--radius)",
                background: "var(--surface-2)",
              }}
            >
              {TERMS_SECTIONS.map((s) => (
                <div key={s.heading} style={{ marginBottom: 16 }}>
                  <p className="eyebrow" style={{ margin: "0 0 4px", color: "var(--accent)" }}>{s.heading}</p>
                  {s.body.map((p, i) => (
                    <p key={i} style={{ margin: "0 0 8px", fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>{p}</p>
                  ))}
                </div>
              ))}
            </div>
          </OnboardingCard>
        </Step>
      )}

      {step === "profile" && (
        <Step key="profile">
          <OnboardingCard
            title="Set up your account"
            description="This is how you will appear to your colleagues on the board."
            buttonText="Finish setup"
            disabled={!name.trim() || !contactEmail.trim() || !org.trim()}
            isSubmitting={busy}
            onSubmit={saveProfile}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input style={FIELD} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
              <input style={FIELD} type="email" placeholder="Your email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} required />
              {!state.organisation && (
                <input style={FIELD} placeholder="Your company" value={org} onChange={(e) => setOrg(e.target.value)} required />
              )}
              {/* THE NOTE HAS TO MATCH WHAT IS ACTUALLY IN THE BOXES. Saying "filled in
                  from the account you signed in with" unconditionally becomes a lie for
                  bookings@ and info@, where suggestedName deliberately returns nothing —
                  a person looking at an empty field being told it was filled in for them. */}
              <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "var(--text-faint)", margin: 0 }}>
                {[
                  state.suggestedName
                    ? "Your name and email are filled in from the account you signed in with — change them if they are wrong."
                    : "Your email address does not spell out your name, so please type it the way you want colleagues to see it.",
                  state.organisation ? "" : "We could not tell which company you are with either, so please confirm it.",
                ].filter(Boolean).join(" ")}
              </p>
            </div>
          </OnboardingCard>
        </Step>
      )}

      {step === "done" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%", background: "var(--ok)",
            display: "flex", alignItems: "center", justifyContent: "center",
            animation: "onboardPop 0.5s ease-out",
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0 }}>You&apos;re all set</p>
        </div>
      )}
    </div>
  );
}
