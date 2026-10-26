# Builds the two 10-26 audits into one page with two views, from the committed markdown, so the page and
# the repo say the same thing. The markdown is rendered in the browser by marked (cdnjs, pinned); without
# it the raw text shows. Usage: python scripts/build-audit-page.py <out.html>
import html, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
mine = (ROOT / "audit/self-audit-2026-10-26.md").read_text(encoding="utf-8")
system_p = ROOT / "audit/system-audit-2026-10-26.md"
system = system_p.read_text(encoding="utf-8") if system_p.exists() else "# The whole system\n\nThe independent audit is still running."
for text in (mine, system):
    assert "</script" not in text.lower(), "a report holds </script>"

FIGURES_MINE = [
    ("84.1%", "recall on current-reader mail", "90 of 107 labelled inquiries, HEAD"),
    ("10 / 20", "current-mail writes completed", "dev-2 replay with the held stack; 7 / 20 at HEAD"),
    ("0", "order writes since 10-21", "0 of 15,049 OnSinch audit rows by the API user"),
    ("5", "held diffs, stacked", "none deployed; full suite green on the stack"),
]

FIGURES_SYSTEM = [
    ("948 / 958", "captured emails reached a decision", "since 10-09; the 10 gaps are non-client mail before the 10-11 fix"),
    ("1", "order write path outside the switch", "/api/confirm-order, with 16 stale proposed tickets"),
    ("0", "owner alerts raised by a failed v2 read", "a read failure becomes a staff card instead"),
    ("40%", "of app code is the paused old engine", "16,095 lines; 145 of 219 test files guard it"),
]

def figures(items):
    return "".join(
        f'<div class="fig"><span class="num">{html.escape(n)}</span><span class="what">{html.escape(w)}</span><span class="how">{html.escape(h)}</span></div>'
        for n, w, h in items)

page = f'''<title>Spartan Engine Audit</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
/* Layout: one reading column under a sticky view switcher; each view opens with its key figures, then its contents, then the report. */
:root {{
  --bg: #f2f4f3; --surface: #ffffff; --ink: #17201d; --muted: #56635e; --rule: #d3dbd8;
  --accent: #0b6e86; --accent-ink: #ffffff; --hivis: #c2410c; --code-bg: #e8edeb;
  --display: "Barlow Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif;
  --body: "Source Sans 3", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #111816; --surface: #19211f; --ink: #e4ebe8; --muted: #9db0a9; --rule: #2d3a36;
  --accent: #5cc6dc; --accent-ink: #0b1a1e; --hivis: #fb923c; --code-bg: #22302c; color-scheme: dark }} }}
:root[data-theme="dark"] {{
  --bg: #111816; --surface: #19211f; --ink: #e4ebe8; --muted: #9db0a9; --rule: #2d3a36;
  --accent: #5cc6dc; --accent-ink: #0b1a1e; --hivis: #fb923c; --code-bg: #22302c; color-scheme: dark }}
* {{ box-sizing: border-box }}
body {{ background: var(--bg); color: var(--ink); font: 400 17px/1.6 var(--body); }}
body::before {{ content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--surface) }}
.wrap {{ max-width: 860px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)) }}
header.top {{ background: var(--surface); border-bottom: 1px solid var(--rule) }}
header.top .wrap {{ padding-block: 28px 18px; display: grid; gap: 6px }}
.eyebrow {{ font: 600 13px/1.2 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--hivis) }}
h1 {{ font: 700 clamp(34px, 6vw, 52px)/1 var(--display); letter-spacing: .01em; margin: 0; text-wrap: balance }}
.lede {{ color: var(--muted); margin: 0; max-width: 62ch }}
nav.views {{ position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--surface); border-bottom: 1px solid var(--rule) }}
nav.views .wrap {{ display: flex; gap: 6px; padding-block: 10px }}
nav.views button {{ font: 600 16px/1 var(--display); letter-spacing: .04em; text-transform: uppercase; padding: 10px 16px; border-radius: 4px;
  border: 1px solid var(--rule); background: transparent; color: var(--ink); cursor: pointer }}
nav.views button[aria-selected="true"] {{ background: var(--accent); border-color: var(--accent); color: var(--accent-ink) }}
nav.views button:focus-visible {{ outline: 3px solid var(--hivis); outline-offset: 2px }}
section.view {{ padding-block: 26px 64px }}
.figs {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px }}
.fig {{ background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: 14px 16px; display: grid; gap: 2px; align-content: start }}
.fig .num {{ font: 700 34px/1 var(--display); font-variant-numeric: tabular-nums }}
.fig .what {{ font-weight: 600; line-height: 1.3 }}
.fig .how {{ color: var(--muted); font-size: 14px; line-height: 1.35 }}
.toc {{ border-left: 3px solid var(--hivis); padding: 4px 0 4px 14px; margin: 0 0 28px; display: grid; gap: 2px }}
.toc b {{ font: 600 13px/1.4 var(--mono); letter-spacing: .06em; text-transform: uppercase; color: var(--muted) }}
.toc a {{ color: var(--ink); text-decoration: none }}
.toc a:hover, .toc a:focus-visible {{ color: var(--accent); text-decoration: underline }}
.report {{ min-width: 0 }}
.report h1 {{ font-size: clamp(28px, 4.5vw, 38px); margin: 0 0 12px }}
.report h2 {{ font: 700 28px/1.15 var(--display); letter-spacing: .01em; margin: 40px 0 10px; padding-top: 14px; border-top: 1px solid var(--rule); text-wrap: balance }}
.report h3 {{ font: 600 21px/1.2 var(--display); margin: 26px 0 6px; text-wrap: balance }}
.report p, .report li {{ max-width: 68ch }}
.report ul, .report ol {{ padding-left: 1.3em }}
.report li {{ margin: 3px 0 }}
.report li::marker {{ color: var(--muted) }}
.report strong {{ font-weight: 700 }}
.report code {{ font: 400 .86em/1.4 var(--mono); background: var(--code-bg); padding: 1px 5px; border-radius: 3px; overflow-wrap: anywhere }}
.report pre {{ background: var(--code-bg); padding: 12px; border-radius: 4px; overflow-x: auto }}
.report pre code {{ background: none; padding: 0 }}
.report a {{ color: var(--accent) }}
.tablewrap {{ overflow-x: auto; margin: 14px 0; border: 1px solid var(--rule); border-radius: 4px; background: var(--surface) }}
.report table {{ border-collapse: collapse; width: 100%; font-size: 15px; line-height: 1.45 }}
.report th, .report td {{ text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--rule) }}
.report th {{ font: 600 14px/1.3 var(--mono); letter-spacing: .02em; color: var(--muted); background: var(--bg) }}
.report td {{ font-variant-numeric: tabular-nums }}
.report tr:last-child td {{ border-bottom: 0 }}
.raw {{ white-space: pre-wrap; font: 400 14px/1.5 var(--mono) }}
footer {{ color: var(--muted); font-size: 14px; padding-block: 0 40px }}
@media (prefers-reduced-motion: reduce) {{ * {{ scroll-behavior: auto !important }} }}
</style>

<header class="top"><div class="wrap">
  <span class="eyebrow">SpartanCrew enquiry engine · 26 Oct 2026</span>
  <h1>Spartan Engine Audit</h1>
  <p class="lede">Two audits, done apart. <b>My work</b> covers what I built, measured and claimed in this engagement. <b>The whole system</b> is an independent review of the automation as it runs, by a separate agent with no access to production.</p>
</div></header>
<nav class="views" aria-label="Audits"><div class="wrap" role="tablist">
  <button role="tab" id="tab-mine" aria-controls="mine" aria-selected="true">My work</button>
  <button role="tab" id="tab-system" aria-controls="system" aria-selected="false">The whole system</button>
</div></nav>
<main>
  <section class="view wrap" id="mine" role="tabpanel" aria-labelledby="tab-mine">
    <div class="figs">{figures(FIGURES_MINE)}</div>
    <nav class="toc" aria-label="Contents"><b>Contents</b></nav>
    <article class="report"><div class="raw">{html.escape(mine)}</div></article>
  </section>
  <section class="view wrap" id="system" role="tabpanel" aria-labelledby="tab-system" hidden>
    <div class="figs">{figures(FIGURES_SYSTEM)}</div>
    <nav class="toc" aria-label="Contents"><b>Contents</b></nav>
    <article class="report"><div class="raw">{html.escape(system)}</div></article>
  </section>
</main>
<footer><div class="wrap">Sources: audit/self-audit-2026-10-26.md and audit/system-audit-2026-10-26.md in the spartan-v2 repository. Client names and email text are left out of both.</div></footer>
<script type="text/markdown" id="md-mine">{mine}</script>
<script type="text/markdown" id="md-system">{system}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
(function () {{
  function slug(s, i) {{ return "s" + i + "-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }}
  function render(view) {{
    var src = document.getElementById("md-" + view).textContent;
    var host = document.querySelector("#" + view + " .report");
    if (window.marked && marked.parse) {{
      host.innerHTML = marked.parse(src, {{ mangle: false, headerIds: false }});
      host.querySelectorAll("table").forEach(function (t) {{ var w = document.createElement("div"); w.className = "tablewrap"; t.parentNode.insertBefore(w, t); w.appendChild(t); }});
    }}
    var toc = document.querySelector("#" + view + " .toc");
    var hs = host.querySelectorAll("h2");
    if (!hs.length) {{ toc.hidden = true; return; }}
    hs.forEach(function (h, i) {{ h.id = view + "-" + slug(h.textContent, i); var a = document.createElement("a"); a.href = "#" + h.id; a.textContent = h.textContent;
      a.addEventListener("click", function (e) {{ e.preventDefault(); h.scrollIntoView({{ behavior: "smooth", block: "start" }}); }}); toc.appendChild(a); }});
  }}
  render("mine"); render("system");
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function show(view) {{
    tabs.forEach(function (t) {{ var on = t.getAttribute("aria-controls") === view; t.setAttribute("aria-selected", on ? "true" : "false"); document.getElementById(t.getAttribute("aria-controls")).hidden = !on; }});
  }}
  tabs.forEach(function (t) {{ t.addEventListener("click", function () {{ show(t.getAttribute("aria-controls")); window.scrollTo(0, 0); }}); }});
  if (location.hash === "#system") show("system");
}})();
</script>
'''
out = pathlib.Path(sys.argv[1])
out.write_text(page, encoding="utf-8")
print("wrote", out, len(page), "bytes")
