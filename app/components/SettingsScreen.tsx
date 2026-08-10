"use client";

// Settings — the only other client surface besides the dashboard. Currently the
// launch-critical control: order_mode (draft-only vs auto). Draft-only stages
// every OnSinch order for one-click confirm; auto writes hands-free.

import { useCallback, useEffect, useState } from "react";
import InstallButton from "./InstallButton";

type OrderMode = "draft-only" | "auto";
type ReplyDelivery = "draft" | "send";
type ReplyScope = "all" | "enquiries";
interface Settings { order_mode: OrderMode; replies_enabled: boolean; reply_delivery: ReplyDelivery; reply_scope: ReplyScope; default_rate_card: number }

const SETTINGS_FALLBACK: Settings = { order_mode: "draft-only", replies_enabled: false, reply_delivery: "draft", reply_scope: "all", default_rate_card: 315 };

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

function OnOff({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const options: { id: boolean; label: string }[] = [
    { id: false, label: "Off" },
    { id: true, label: "On" },
  ];
  return (
    <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button key={String(o.id)} onClick={() => onChange(o.id)}
            style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid " + (active ? "var(--accent-border)" : "transparent"), background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 200ms" }}>
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
      try {
        const r = await fetch("/api/settings");
        setSettings({ ...SETTINGS_FALLBACK, ...(await r.json()) });
      } catch { setSettings(SETTINGS_FALLBACK); }
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

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>AI email replies</div>
            <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
              When on, the engine drafts a Spartan-Crew reply for each inbound email, in Spartan&apos;s voice and with full thread context. <b style={{ color: SUB }}>Off by default</b> — classification and order staging still run without it.
            </p>
          </div>
          <OnOff value={settings.replies_enabled} onChange={(v) => save({ ...settings, replies_enabled: v })} />

          {/* Ben's second reply setting: draft vs actually send. Only meaningful
              once replies are on, so it stays hidden until then. */}
          {settings.replies_enabled && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Reply delivery</div>
                <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
                  <b style={{ color: SUB }}>Draft</b> (default): the reply is left in the Gmail thread as a draft for a human to read and send. <b style={{ color: SUB }}>Send</b>: the engine sends it itself.
                </p>
              </div>
              <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 3, alignSelf: "flex-start" }}>
                {(["draft", "send"] as ReplyDelivery[]).map((id) => {
                  const active = settings.reply_delivery === id;
                  return (
                    <button key={id} onClick={() => save({ ...settings, reply_delivery: id })}
                      style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + (active ? "var(--accent-border)" : "transparent"), background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 200ms", textTransform: "capitalize" }}>
                      {id}
                    </button>
                  );
                })}
              </div>
              {settings.reply_delivery === "send" && (
                <div style={{ background: "var(--danger-subtle)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: SUB }}>
                  Send mode emails clients without a human reading the reply first. Only enable once drafted replies have been checked for a while.
                </div>
              )}

              {/* WHICH threads get a reply. Measured over a 10-thread sample across
                  all classifications: 7 were acknowledgements that produced correct
                  but low-value drafts, and that shape is ~45% of the live board. */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>Which emails get a reply</div>
                  <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
                    <b style={{ color: SUB }}>All emails</b> (default): every email the engine reads, including plain acknowledgements like &quot;PO received, thanks&quot;. <b style={{ color: SUB }}>New enquiries only</b>: just the threads asking for crew — a new job or a change to one. Around 45% of threads are acknowledgements, so this roughly halves the drafts waiting to be reviewed.
                  </p>
                </div>
                <div style={{ display: "inline-flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 3, gap: 3, alignSelf: "flex-start" }}>
                  {([["all", "All emails"], ["enquiries", "New enquiries only"]] as [ReplyScope, string][]).map(([id, label]) => {
                    const active = settings.reply_scope === id;
                    return (
                      <button key={id} onClick={() => save({ ...settings, reply_scope: id })}
                        style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + (active ? "var(--accent-border)" : "transparent"), background: active ? "var(--accent-subtle)" : "transparent", color: active ? A : SUB, fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all 200ms" }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
            {saving ? "Saving…" : savedAt ? "Saved." : "Changes save automatically."}
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Rate card for new clients</div>
            <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
              A client with no pricing history has no rate card to derive, so their first job could never be raised. This is the card used instead. Measured over the 498 most recent priced orders, <b style={{ color: SUB }}>315</b> is the house standard — 70% of all orders and 75% of clients&apos; first orders. Set <b style={{ color: SUB }}>0</b> to turn this off and hold those threads for a human instead.
            </p>
          </div>
          <input
            type="number" min={0} step={1}
            value={settings.default_rate_card}
            onChange={(e) => save({ ...settings, default_rate_card: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            style={{ width: 120, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-2)", color: INK, fontWeight: 600, fontSize: 14 }}
          />
          <div style={{ background: "var(--accent-subtle)", border: "1px solid var(--accent-border)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: SUB }}>
            An order priced this way is <b>never</b> written to OnSinch hands-free, even in Auto mode — it is always staged for someone to check the price first, and the ticket says the card was assumed.
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
            {saving ? "Saving…" : savedAt ? "Saved." : "Changes save automatically."}
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Install app</div>
            <p style={{ fontSize: 12.5, color: MUT, margin: "4px 0 0", lineHeight: 1.5 }}>
              Add Spartan Crew to your phone or desktop home screen for full-screen, one-tap access.
            </p>
          </div>
          <InstallButton />
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
