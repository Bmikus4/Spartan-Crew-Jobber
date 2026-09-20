// ============================================================================
// The venue review — a local page, one card per decision, marks on disk.
// ----------------------------------------------------------------------------
//   node scripts/venue-review.mjs            serve on :7311 and open a browser
//   npx tsx scripts/venue-review.mjs --apply  apply ONLY what was approved (WRITES)
//
// Not an Artifact and not a Next route on purpose. It reads a gitignored decision
// file and writes a gitignored mark file, both on this machine, and it is the only
// thing in this repo that can be pointed at the live tenant with intent.
//
// The apply step is a separate invocation behind a typed confirmation, because the
// failure it guards against is not a bug — it is a person running the review command
// twice and the second one mutating 3,173 rows.
// ============================================================================
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const OUT = path.join(".tmp-data", "venue-sweep2");
const DECISIONS = path.join(OUT, "decisions.json");
const MARKS = path.join(OUT, "marks.json");
const PORT = Number(process.env.PORT || 7311);

if (!fs.existsSync(DECISIONS)) {
  console.error(`no ${DECISIONS} — run: npx tsx scripts/venue-sweep2.ts --plan`);
  process.exit(1);
}

const readMarks = () => (fs.existsSync(MARKS) ? JSON.parse(fs.readFileSync(MARKS, "utf8")) : {});
const writeMarks = (m) => fs.writeFileSync(MARKS, JSON.stringify(m, null, 1));

// ---------------------------------------------------------------- apply

async function apply() {
  const { decisions, places } = JSON.parse(fs.readFileSync(DECISIONS, "utf8"));
  const marks = readMarks();
  const approved = decisions.filter((d) => marks[d.key]?.mark === "approve");

  const del = [];
  const deact = [];
  for (const d of approved) {
    for (const m of d.members) {
      if (m.action === "delete") del.push(m.id);
      if (m.action === "deactivate") deact.push(m.id);
    }
  }
  console.log(`approved groups: ${approved.length} of ${decisions.length}`);
  console.log(`  delete:     ${del.length} rows`);
  console.log(`  deactivate: ${deact.length} rows`);
  if (!del.length && !deact.length) return console.log("nothing approved — nothing to do.");

  if (process.env.I_MEAN_IT !== "yes") {
    console.log(`\nThis WRITES to the live OnSinch tenant and deletion is not reversible.`);
    console.log(`Re-run with I_MEAN_IT=yes to proceed.`);
    process.exit(2);
  }

  const { loadEnv, requireEnv, onsinchBase } = await import("./_env.mjs");
  const { OnsinchClient, httpTransport } = await import("../app/lib/engine/onsinch.ts");
  loadEnv();
  const c = new OnsinchClient(
    httpTransport({ baseUrl: onsinchBase(), apiKey: requireEnv("ONSINCH_API_KEY") })
  );

  // Deactivate first. If the run dies half way, a deactivated row is recoverable and
  // a deleted one is not, so the irreversible half goes last.
  for (const batch of chunk(deact, 50)) {
    await c.patchPlaces(batch.map((id) => ({ id, active: false })));
    console.log(`  deactivated ${batch.length}`);
  }

  for (const batch of chunk(del, 50)) {
    await c.deletePlaces(batch);
    process.stdout.write(".");
  }
  console.log(`\nsent ${del.length} deletes — now reading the pool back`);

  /**
   * DELETE /places reported success on rows it had not deleted (4f0f795), so the
   * count that goes in the log is the one the tenant agrees with.
   *
   * The read-back is ONE full pull rather than a per-id probe: 3,000 probes is an
   * hour and a cached list is 69 pages. __resetListCache matters — allPlaces() is
   * memoised and would otherwise hand back the pre-delete snapshot and report a
   * clean run every time.
   */
  const { __resetListCache } = await import("../app/lib/engine/onsinch.ts");
  __resetListCache();
  const after = await c.allPlaces();
  const alive = new Set(after.map((p) => Number(p.id)));
  const stuck = del.filter((id) => alive.has(id));
  const stillActive = after.filter((p) => deact.includes(Number(p.id)) && p.active);

  console.log(`deleted ${del.length - stuck.length} of ${del.length}` +
    (stuck.length ? ` — ${stuck.length} STILL PRESENT` : ""));
  if (stuck.length) console.log(`  stuck ids: ${stuck.slice(0, 50).join(", ")}`);
  console.log(`deactivated ${deact.length - stillActive.length} of ${deact.length}` +
    (stillActive.length ? ` — ${stillActive.length} still active` : ""));
  console.log(`pool: ${places.length} -> ${after.length}`);
  fs.writeFileSync(path.join(OUT, "applied.json"),
    JSON.stringify({ at: new Date().toISOString(), del, deact, stuck,
      stillActive: stillActive.map((p) => p.id), before: places.length, after: after.length }, null, 1));
}

const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

if (process.argv.includes("--apply")) {
  apply().catch((e) => { console.error(e); process.exit(1); });
} else {
  serve();
}

// ---------------------------------------------------------------- serve

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(PAGE);
    }
    if (url.pathname === "/api/data") {
      const d = fs.readFileSync(DECISIONS, "utf8");
      const payload = JSON.parse(d);
      payload.marks = readMarks();
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(payload));
    }
    if (url.pathname === "/api/mark" && req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      return req.on("end", () => {
        const { key, mark, note } = JSON.parse(b || "{}");
        const marks = readMarks();
        if (mark === null) delete marks[key];
        else marks[key] = { mark, note: note ?? "", at: new Date().toISOString() };
        writeMarks(marks);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, marked: Object.keys(marks).length }));
      });
    }
    res.writeHead(404).end("no");
  });
  server.listen(PORT, () => {
    const at = `http://localhost:${PORT}`;
    console.log(`venue review on ${at}`);
    console.log(`marks -> ${MARKS}`);
    spawn("cmd", ["/c", "start", "", at], { detached: true, stdio: "ignore" }).unref();
  });
}

// ---------------------------------------------------------------- the page

const PAGE = String.raw`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Venue sweep review</title>
<style>
:root{
  --bg:#0f1115; --panel:#161a21; --line:#242a35; --ink:#e6e9ef; --dim:#8b94a7;
  --keep:#3ddc97; --del:#ff6b6b; --deact:#f0b429; --hold:#8ab4ff; --acc:#7c5cff;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.5 ui-sans-serif,-apple-system,"Segoe UI",system-ui,sans-serif}
code,.mono{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace}

header{position:sticky;top:0;z-index:9;background:#0f1115ee;backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);padding:10px 18px}
.hrow{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
h1{font-size:14px;margin:0;font-weight:600;letter-spacing:.02em}
.stat{font-size:12px;color:var(--dim)}
.stat b{color:var(--ink);font-weight:600}
.meter{flex:1;min-width:220px;height:8px;border-radius:99px;background:#222836;overflow:hidden}
.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--keep))}
.bound{font-variant-numeric:tabular-nums;font-weight:700}
.bound.good{color:var(--keep)} .bound.bad{color:var(--deact)}

main{max-width:1100px;margin:0 auto;padding:20px 18px 120px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
  padding:16px 18px;margin-bottom:14px}
.card.done{opacity:.45}
.card.focus{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc)}
.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px}
.key{font-size:16px;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line);
  color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.badge.proven{color:var(--del);border-color:#4a2530}
.badge.merge{color:var(--keep);border-color:#1e4436}
.badge.hold{color:var(--hold);border-color:#26364f}
.badge.risk{color:var(--deact);border-color:#4a3a18}
.ev{margin:10px 0;padding:10px 12px;background:#12161d;border-left:2px solid var(--acc);
  border-radius:0 6px 6px 0}
.ev div{font-size:12.5px;color:#c3cad8;margin:3px 0}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12.5px}
th{text-align:left;color:var(--dim);font-weight:500;font-size:11px;
  text-transform:uppercase;letter-spacing:.05em;padding:4px 8px;border-bottom:1px solid var(--line)}
td{padding:5px 8px;border-bottom:1px solid #1c2129;vertical-align:top}
tr:last-child td{border-bottom:0}
.act{font-weight:700;font-size:11px;letter-spacing:.04em}
.act.keep{color:var(--keep)} .act.delete{color:var(--del)}
.act.deactivate{color:var(--deact)} .act.hold{color:var(--hold)}
.n{color:var(--dim);font-variant-numeric:tabular-nums}
.more{color:var(--dim);font-size:12px;padding:6px 8px}
.btns{display:flex;gap:8px;margin-top:12px;align-items:center}
button{font:inherit;font-size:13px;padding:6px 14px;border-radius:7px;cursor:pointer;
  border:1px solid var(--line);background:#1c212b;color:var(--ink)}
button:hover{border-color:#3a4354}
button.yes{background:#123326;border-color:#1e5c42;color:var(--keep)}
button.no{background:#331717;border-color:#5c2020;color:var(--del)}
button.on{outline:2px solid var(--acc)}
.mark{font-size:12px;color:var(--dim);margin-left:auto}
.filters{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 18px}
.filters button{font-size:12px;padding:4px 10px}
.filters button.on{background:var(--acc);border-color:var(--acc);color:#fff}
kbd{font-family:ui-monospace,monospace;font-size:11px;background:#222836;
  border:1px solid var(--line);border-radius:4px;padding:1px 5px;color:var(--dim)}
.done-banner{background:#123326;border:1px solid #1e5c42;color:var(--keep);
  padding:12px 16px;border-radius:8px;margin-bottom:16px;font-weight:600}
</style>

<header>
  <div class="hrow">
    <h1>Venue sweep review</h1>
    <span class="stat">decisions <b id="p">0</b>/<b id="t">0</b></span>
    <span class="stat">rows cleared <b id="rc">0</b>/<b id="rt">0</b></span>
    <span class="stat">denied <b id="dn">0</b></span>
    <div class="meter"><i id="bar" style="width:0%"></i></div>
    <span class="stat">95% bound on false positives
      <b class="bound" id="bd">100%</b> <span id="tgt"></span></span>
  </div>
</header>

<main>
  <div class="filters" id="filters"></div>
  <div id="list"></div>
</main>

<script>
// ---- the same hypergeometric bound the sweep script computes, in the browser ----
const LNF=[0,0];
function lnFact(n){for(let i=LNF.length;i<=n;i++)LNF[i]=LNF[i-1]+Math.log(i);return LNF[n]}
const lnC=(n,k)=>(k<0||k>n||n<0)?-Infinity:lnFact(n)-lnFact(k)-lnFact(n-k);
function hyperCdf(N,D,n,k){let s=0;for(let i=0;i<=Math.min(k,D,n);i++){
  const lp=lnC(D,i)+lnC(N-D,n-i)-lnC(N,n); if(isFinite(lp))s+=Math.exp(lp);}
  return Math.min(1,s)}
function upperBound(N,n,k){
  if(N<=0)return 0; if(n<=0)return N; if(n>=N)return k;
  let lo=k,hi=N;
  while(lo<hi){const mid=lo+Math.ceil((hi-lo)/2);
    if(hyperCdf(N,mid,n,k)>0.05)lo=mid; else hi=mid-1;}
  return lo}

const RICH=['address','city','zip','alias','lat','lng','note','region'];
const DESTRUCTIVE=m=>m.action==='delete'||m.action==='deactivate';
let DATA,BYID,MARKS={},FILTER='queue',FOCUS=0;

/** Deterministic shuffle. The bound is only honest if the order within a stratum is
 *  independent of the answer, and a stable seed makes the session resumable. */
function seeded(arr,seed){
  let s=seed; const r=()=>((s=s*1103515245+12345&0x7fffffff)/0x7fffffff);
  const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}
  return a}

/**
 * Queue order: the two risk flags first, then plain impact.
 *
 * An earlier order was risk-tier first with 'proven' last. It read well and it made
 * the meter useless — 'proven' holds 1,935 of the 3,236 rows, so the bound sat at 74%
 * for a hundred and eighty cards and then fell off a cliff. A meter that only moves
 * at the end cannot tell anyone when to stop.
 *
 * Held groups and bare survivors are few and they are where a wrong answer hides, so
 * they still come first. After that the biggest groups go first, which is also what
 * drives the bound down fastest: audit the 200-row decisions and the unaudited
 * remainder is all small, so the worst case it can hide is small too.
 */
function queue(ds){
  const by={};
  for(const d of ds)(by[d.stratum] ??= []).push(d);
  const out=[];
  for(const k of Object.keys(by)) out.push(...seeded(by[k],k.length*7919+by[k].length));
  return out.sort((a,b)=>
    (a.survivorBare||a.stratum==='hold'?1:2)-(b.survivorBare||b.stratum==='hold'?1:2) ||
    rowsOf(b)-rowsOf(a));
}
const rowsOf=d=>d.members.filter(DESTRUCTIVE).length;

async function boot(){
  const r=await fetch('/api/data'); DATA=await r.json();
  BYID=new Map(DATA.places.map(p=>[Number(p.id),p]));
  MARKS=DATA.marks||{};
  DATA.queue=queue(DATA.decisions);
  const counts={};
  for(const d of DATA.decisions) counts[d.stratum]=(counts[d.stratum]||0)+1;
  const f=document.getElementById('filters');
  const tabs=[['queue','review queue'],['left','unmarked'],['deny','denied'],
    ...Object.entries(counts).map(([k,v])=>[k,k+' ('+v+')'])];
  f.innerHTML=tabs.map(([k,l])=>'<button data-f="'+k+'">'+l+'</button>').join('');
  f.onclick=e=>{const b=e.target.closest('button'); if(!b)return;
    FILTER=b.dataset.f; FOCUS=0; render()};
  render();
}

function shown(){
  const q=DATA.queue;
  if(FILTER==='queue')return q;
  if(FILTER==='left')return q.filter(d=>!MARKS[d.key]);
  if(FILTER==='deny')return q.filter(d=>MARKS[d.key]?.mark==='deny');
  return q.filter(d=>d.stratum===FILTER);
}

/**
 * The bound, over rows, sampled by GROUP.
 *
 * A reviewer marks a decision, not a row, so rows arrive in group-sized clumps and a
 * hypergeometric drawn over rows is not valid — it reads 180 clustered rows as 180
 * independent draws and flatters the answer. So: bound the number of WRONG DECISIONS
 * a stratum can still hide (hypergeometric over groups, which IS the sampling unit),
 * then charge that many of the LARGEST UNAUDITED groups against the row total. That
 * is the worst case those decisions could actually cost, and it is honest.
 *
 * A denied decision is an observed defect, which both raises the bound and — rightly —
 * means the number stops falling until more of that stratum is checked.
 */
function stats(){
  const by={};
  for(const d of DATA.decisions){
    const s=(by[d.stratum] ??= {rows:0,sizes:[],G:0,g:0,k:0,audited:0});
    const rows=rowsOf(d);
    s.rows+=rows; s.G++;
    const m=MARKS[d.key]?.mark;
    if(m){s.g++; s.audited+=rows; if(m==='deny')s.k++}
    else s.sizes.push(rows);
  }
  let N=0,D=0,audited=0;
  for(const s of Object.values(by)){
    N+=s.rows; audited+=s.audited;
    const wrong=upperBound(s.G,s.g,s.k);
    const worst=s.sizes.sort((a,b)=>b-a).slice(0,wrong).reduce((a,b)=>a+b,0);
    // a denied decision's own rows are known-bad, not merely possible-bad
    const denied=DATA.decisions.filter(d=>d.stratum &&
      MARKS[d.key]?.mark==='deny').filter(d=>by[d.stratum]===s);
    D+=worst+denied.reduce((a,d)=>a+rowsOf(d),0);
  }
  const marked=DATA.decisions.filter(d=>MARKS[d.key]).length;
  const denied=DATA.decisions.filter(d=>MARKS[d.key]?.mark==='deny').length;
  return {N,D:Math.min(D,N),audited,marked,denied,
    rate:N?Math.min(D,N)/N:1,total:DATA.decisions.length};
}

function paint(){
  const s=stats();
  document.getElementById('p').textContent=s.marked;
  document.getElementById('t').textContent=s.total;
  document.getElementById('rc').textContent=s.audited.toLocaleString();
  document.getElementById('rt').textContent=s.N.toLocaleString();
  document.getElementById('dn').textContent=s.denied;
  const pct=(s.rate*100);
  const b=document.getElementById('bd');
  b.textContent=pct<0.001?'0.000%':pct.toFixed(3)+'%';
  b.className='bound '+(s.rate<=0.003?'good':'bad');
  document.getElementById('tgt').textContent=s.rate<=0.003?'— target met':'(target 0.300%)';
  // progress toward the target, on a log scale so the last stretch is visible
  const prog=s.rate<=0.003?100:Math.max(0,Math.min(100,
    100*(Math.log(1/s.rate)/Math.log(1/0.003))));
  document.getElementById('bar').style.width=prog+'%';
}

function fieldsOf(p){
  return RICH.filter(f=>p&&p[f]).map(f=>f+'='+String(p[f]).slice(0,42)).join('  ')||'—';
}

function card(d,i,focused){
  const surv=d.survivor?BYID.get(d.survivor):null;
  const m=MARKS[d.key];
  // collapse losers to distinct shapes — 180 identical rows is one line, not 180
  const groups=new Map();
  for(const mem of d.members){
    if(mem.id===d.survivor)continue;
    const p=BYID.get(mem.id)||{};
    const sig=mem.action+'|'+p.name+'|'+fieldsOf(p);
    const g=groups.get(sig)||{action:mem.action,reason:mem.reason,name:p.name,
      fields:fieldsOf(p),ids:[]};
    g.ids.push(mem.id); groups.set(sig,g);
  }
  const rows=[...groups.values()].sort((a,b)=>b.ids.length-a.ids.length);
  return '<div class="card'+(m?' done':'')+(focused?' focus':'')+'" data-k="'+esc(d.key)+'" id="c'+i+'">'
   +'<div class="top"><span class="key">'+esc(d.key)+'</span>'
   +'<span class="badge '+d.stratum+'">'+d.stratum+'</span>'
   +(d.survivorBare?'<span class="badge risk">survivor locates nothing</span>':'')
   +(d.homogeneous?'<span class="badge">homogeneous · one audit covers '+rowsOf(d)+' rows</span>':'')
   +'<span class="badge">'+d.members.length+' rows</span></div>'
   +(d.evidence.length?'<div class="ev">'+d.evidence.map(e=>'<div>'+esc(e)+'</div>').join('')+'</div>':'')
   +'<table><tr><th style="width:74px">action</th><th style="width:60px">id</th>'
   +'<th>name</th><th>fields</th></tr>'
   +(surv?'<tr><td class="act keep">KEEP</td><td class="n">'+surv.id+'</td>'
     +'<td>'+esc(surv.name)+'</td><td class="mono n">'+esc(fieldsOf(surv))+'</td></tr>':'')
   +rows.slice(0,8).map(g=>'<tr><td class="act '+g.action+'">'+g.action.toUpperCase()+'</td>'
     +'<td class="n">'+(g.ids.length>1?'×'+g.ids.length:g.ids[0])+'</td>'
     +'<td>'+esc(g.name)+'</td><td class="mono n">'+esc(g.fields)+'</td></tr>').join('')
   +'</table>'
   +(rows.length>8?'<div class="more">+ '+(rows.length-8)+' more distinct shapes</div>':'')
   +'<div class="btns">'
   +'<button class="yes'+(m?.mark==='approve'?' on':'')+'" data-m="approve">Approve</button>'
   +'<button class="no'+(m?.mark==='deny'?' on':'')+'" data-m="deny">Deny</button>'
   +(m?'<button data-m="clear">clear</button>':'')
   +'<span class="mark">'+(m?m.mark+' · '+m.at.slice(0,16).replace('T',' '):
       '<kbd>A</kbd> approve <kbd>D</kbd> deny <kbd>J</kbd>/<kbd>K</kbd> move')+'</span>'
   +'</div></div>';
}
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function render(){
  const list=shown();
  document.querySelectorAll('#filters button').forEach(b=>
    b.classList.toggle('on',b.dataset.f===FILTER));
  if(FOCUS>=list.length)FOCUS=Math.max(0,list.length-1);
  const s=stats();
  document.getElementById('list').innerHTML=
    (s.marked===s.total?'<div class="done-banner">Every decision is marked. '
      +'The false-positive bound is '+(s.rate*100).toFixed(3)+'% — '
      +'apply with: npx tsx scripts/venue-review.mjs --apply</div>':'')
    +(list.length?list.map((d,i)=>card(d,i,i===FOCUS)).join('')
      :'<div class="more">nothing here.</div>');
  paint();
}

document.addEventListener('click',async e=>{
  const b=e.target.closest('button[data-m]'); if(!b)return;
  const key=b.closest('.card').dataset.k;
  const mark=b.dataset.m==='clear'?null:b.dataset.m;
  await mark_(key,mark);
});

async function mark_(key,mark){
  if(mark===null)delete MARKS[key];
  else MARKS[key]={mark,note:'',at:new Date().toISOString()};
  const list=shown(); const at=list.findIndex(d=>d.key===key);
  if(at>=0&&mark)FOCUS=Math.min(list.length-1,at+1);
  render();
  document.getElementById('c'+FOCUS)?.scrollIntoView({block:'center',behavior:'smooth'});
  await fetch('/api/mark',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({key,mark})});
}

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.metaKey||e.ctrlKey)return;
  const list=shown(); const d=list[FOCUS]; if(!d)return;
  const k=e.key.toLowerCase();
  if(k==='a'){e.preventDefault();mark_(d.key,'approve')}
  else if(k==='d'){e.preventDefault();mark_(d.key,'deny')}
  else if(k==='j'||e.key==='ArrowDown'){e.preventDefault();FOCUS=Math.min(list.length-1,FOCUS+1);render();
    document.getElementById('c'+FOCUS)?.scrollIntoView({block:'center'})}
  else if(k==='k'||e.key==='ArrowUp'){e.preventDefault();FOCUS=Math.max(0,FOCUS-1);render();
    document.getElementById('c'+FOCUS)?.scrollIntoView({block:'center'})}
});

boot();
</script>`;
