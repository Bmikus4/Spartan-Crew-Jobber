"use client";

// The Hud Assistant's answer format: **bold**, numbered and bulleted lists, paragraphs.
//
// EXTRACTED FROM HelpWidget because Leni's Ask column streams the same /api/help endpoint
// (Ben, 2026-09-01: one bot, two deployments) — and two renderers for one model's output is
// how the bubble and the column come to disagree about what an answer looks like. This is
// deliberately NOT a markdown library: an answer is at most a few sentences and a list, and
// the endpoint's own style prompt forbids anything richer.

import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1
      ? <strong key={i} style={{ color: "var(--text-primary)", fontWeight: 600 }}>{part}</strong>
      : <span key={i}>{part}</span>,
  );
}

export function renderRich(text: string): ReactNode[] {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { type: "ol" | "ul"; items: string[] } | null = null;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => (
      <li key={i} style={{ marginBottom: 4 }}>{renderInline(it)}</li>
    ));
    blocks.push(
      list.type === "ol"
        ? <ol key={blocks.length} style={{ margin: "2px 0 8px", paddingLeft: 20, display: "flex", flexDirection: "column", gap: 2 }}>{items}</ol>
        : <ul key={blocks.length} style={{ margin: "2px 0 8px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>{items}</ul>,
    );
    list = null;
  };

  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) { flush(); return; }
    const ol = line.match(/^(\d+)\.\s+(.*)/);
    const ul = line.match(/^[-•]\s+(.*)/);
    if (ol) {
      if (!list || list.type !== "ol") { flush(); list = { type: "ol", items: [] }; }
      list.items.push(ol[2]);
      return;
    }
    if (ul) {
      if (!list || list.type !== "ul") { flush(); list = { type: "ul", items: [] }; }
      list.items.push(ul[1]);
      return;
    }
    flush();
    blocks.push(<p key={blocks.length} style={{ margin: "0 0 8px" }}>{renderInline(line)}</p>);
  });
  flush();
  // Trim the trailing paragraph's bottom margin for a tidy bubble.
  return blocks;
}
