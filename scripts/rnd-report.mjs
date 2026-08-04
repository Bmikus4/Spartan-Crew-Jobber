// ============================================================================
// Render the R&D study to one self-contained HTML file.
// ----------------------------------------------------------------------------
// Everything inline: no CDN, no external stylesheet, no web font. The file is read
// offline from disk, so an external asset would simply not load.
//
// Numbers come from scripts/rnd-study.mjs (which only reads). Nothing is typed in by
// hand here: if a figure appears in the report, it was computed there, and the
// arithmetic behind it is printed beside it.
//
//   node scripts/rnd-study.mjs --json > study.json
//   node scripts/rnd-report.mjs study.json  C:\...\Spartan-Mailbox-Sweep.html
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , dataPath, outPath] = process.argv;
if (!dataPath || !outPath) {
  console.error("usage: node scripts/rnd-report.mjs <study.json> <out.html>");
  process.exit(2);
}
const D = JSON.parse(readFileSync(dataPath, "utf8"));

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** A labelled provenance chip. Every figure in the report carries one. */
const tag = (kind) => {
  const k = String(kind).toUpperCase();
  return `<span class="tag ${k.toLowerCase()}">${k}</span>`;
};

/** Horizontal bar chart, inline SVG, no library. */
function barChart(rows, { width = 720, barH = 26, gap = 8, max = null, fmt = (v) => v } = {}) {
  const m = max ?? Math.max(...rows.map((r) => r.value), 1);
  const labelW = 210, valueW = 90;
  const plotW = width - labelW - valueW;
  const height = rows.length * (barH + gap);
  const bars = rows
    .map((r, i) => {
      const y = i * (barH + gap);
      const w = Math.max(1, Math.round((r.value / m) * plotW));
      return `
      <text x="${labelW - 10}" y="${y + barH * 0.7}" text-anchor="end" class="bl">${esc(r.label)}</text>
      <rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="3" class="bar ${r.tone || ""}"></rect>
      <text x="${labelW + w + 8}" y="${y + barH * 0.7}" class="bv">${esc(fmt(r.value))}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${bars}</svg>`;
}

/** Column chart for a time series. */
function columnChart(rows, { width = 720, height = 180 } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const n = rows.length;
  const bw = Math.max(4, Math.floor((width - 40) / n) - 6);
  const cols = rows
    .map((r, i) => {
      const h = Math.max(1, Math.round((r.value / max) * (height - 38)));
      const x = 30 + i * (bw + 6);
      return `<rect x="${x}" y="${height - 22 - h}" width="${bw}" height="${h}" rx="2" class="bar"></rect>
      <text x="${x + bw / 2}" y="${height - 8}" text-anchor="middle" class="ax">${esc(r.label)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
    <text x="0" y="12" class="ax">${max}</text>${cols}</svg>`;
}

function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const S = D.sections;

const html = `<title>Spartan Crew Enquiry Engine — R&D study</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --dim:#666; --line:#d9d9de; --bg:#fff; --panel:#f7f7f9;
          --accent:#1f6feb; --warn:#b45309; --bad:#b91c1c; --good:#15803d; }
  @media (prefers-color-scheme: dark) {
    :root { --ink:#e9e9ee; --dim:#a0a0ab; --line:#2c2c34; --bg:#0f0f12; --panel:#17171c; --accent:#5b9dff; }
  }
  :root[data-theme="dark"] { --ink:#e9e9ee; --dim:#a0a0ab; --line:#2c2c34; --bg:#0f0f12; --panel:#17171c; --accent:#5b9dff; }
  :root[data-theme="light"] { --ink:#111; --dim:#666; --line:#d9d9de; --bg:#fff; --panel:#f7f7f9; --accent:#1f6feb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 40px 24px 96px; }
  h1 { font-size: 30px; line-height:1.2; margin:0 0 6px; letter-spacing:-0.02em; }
  h2 { font-size: 21px; margin: 44px 0 12px; padding-top:18px; border-top:1px solid var(--line); letter-spacing:-0.01em; }
  h3 { font-size: 16px; margin: 26px 0 8px; }
  p, li { color: var(--ink); }
  .sub { color: var(--dim); margin: 0 0 28px; }
  .panel { background: var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin:16px 0; }
  .kpis { display:grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:20px 0 8px; }
  .kpi { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .kpi .n { font-size:26px; font-weight:650; letter-spacing:-0.02em; }
  .kpi .l { color:var(--dim); font-size:13px; margin-top:2px; }
  table { border-collapse: collapse; width:100%; margin:12px 0; font-size:14.5px; }
  th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:600; font-size:13px; text-transform:uppercase; letter-spacing:.04em; }
  td.num { font-variant-numeric: tabular-nums; }
  code, .mono { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13.5px; }
  .calc { font-family: ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; color:var(--dim);
          background:var(--panel); border-left:3px solid var(--accent); padding:8px 12px; margin:8px 0; overflow-x:auto; }
  .tag { display:inline-block; font-size:10.5px; font-weight:700; letter-spacing:.06em; padding:2px 6px;
         border-radius:4px; vertical-align:middle; margin-right:6px; }
  .tag.measured { background:rgba(21,128,61,.14); color:var(--good); }
  .tag.estimated { background:rgba(180,83,9,.14); color:var(--warn); }
  .tag.assumed { background:rgba(185,28,28,.14); color:var(--bad); }
  svg .bar { fill: var(--accent); opacity:.85; }
  svg .bar.warn { fill: var(--warn); }
  svg .bar.bad { fill: var(--bad); }
  svg .bar.good { fill: var(--good); }
  svg .bl { fill: var(--ink); font-size:13px; }
  svg .bv { fill: var(--dim); font-size:12.5px; font-variant-numeric: tabular-nums; }
  svg .ax { fill: var(--dim); font-size:11px; }
  .scroll { overflow-x:auto; }
  ol.props > li { margin: 0 0 22px; }
  .disproof { color:var(--dim); font-size:14.5px; border-left:3px solid var(--line); padding-left:12px; margin-top:8px; }
  .lede { font-size:17.5px; }
</style>
<div class="wrap">
${S}
</div>`;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html);
console.log(`wrote ${outPath} (${Math.round(html.length / 1024)} kB)`);
