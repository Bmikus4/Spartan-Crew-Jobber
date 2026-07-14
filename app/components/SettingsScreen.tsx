"use client";

// Settings — the only other client surface besides the dashboard. Currently the
// launch-critical control: order_mode (draft-only vs auto). Draft-only stages
// every OnSinch order for one-click confirm; auto writes hands-free.

import { useCallback, useEffect, useState } from "react";

type OrderMode = "draft-only" | "auto";
interface Settings { order_mode: OrderMode }

const INK = "var(--text-primary)";
const SUB = "var(--text-secondary)";
const MUT = "var(--text-muted)";
const A = "var(--accent)";

function Toggle({ value, onChange }: { value: OrderMode; onChange: (v: OrderMode) => void }) {
  const options: { id: OrderMode; label: string }[] = [
    { id: "draft-only", label: "Draft-only" },
    { id: "auto", label: "Auto (hands-free)" },
  ];
  return (
    <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button key={o.id} onClick={() => onChange(o.id)}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + (active ? "var(--accent-border)" : "transparent"), background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 200ms" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try { const r = await fetch("/api/settings"); setSettings(await r.json()); }
      catch { setSettings({ order_mode: "draft-only" }); }
    })();
  }, []);

  const save = useCallback(async (next: Settings) => {
    setSettings(next); setSaving(true);
    try { await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }); setSavedAt(Date.now()); }
    finally { setSaving(false); }
  }, []);

  const wrap: React.CSSProperties = { height: "100%", overflowY: "auto", padding: "24px clamp(16px, 4vw, 40px) 56px" };
  if (!settings) return <div style={{ ...wrap, display: "grid", placeItems: "center" }}><span className="crm-shimmer" style={{ color: MUT }}>Loading…</span></div>;

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
        <header>
          <span className="eyebrow"><span className="slash">/</span>SETTINGS</span>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: INK, margin: "4px 0 2px" }}>Engine controls</h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0 }}>How the automation behaves once n8n triggers it.</p>
        </header>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Order mode</div>
            <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
              <b style={{ color: SUB }}>Draft-only</b> (launch default): replies are drafted and each OnSinch order is <b style={{ color: SUB }}>staged</b> for one-click approval in the dashboard confirm queue — nothing is written to OnSinch automatically. <b style={{ color: SUB }}>Auto</b>: confident orders are written hands-free.
            </p>
          </div>
          <Toggle value={settings.order_mode} onChange={(v) => save({ ...settings, order_mode: v })} />
          {settings.order_mode === "auto" && (
            <div style={{ background: "var(--danger-subtle)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: SUB }}>
              Auto mode writes orders to OnSinch without a human check. Only enable once the needs-human / error rate is proven low.
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
            {saving ? "Saving…" : savedAt ? "Saved." : "Changes save automatically."}
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK, marginBottom: 6 }}>Trigger</div>
          <p style={{ fontSize: 12.5, color: MUT, margin: 0, lineHeight: 1.5 }}>
            The mailbox trigger lives in n8n. It POSTs each hydrated thread to <span className="mono" style={{ color: SUB }}>/api/n8n-inbound</span>; the automation runs here on Vercel. Set <span className="mono" style={{ color: SUB }}>N8N_WEBHOOK_SECRET</span> to lock the endpoint.
          </p>
        </div>
      </div>
    </div>
  );
}
