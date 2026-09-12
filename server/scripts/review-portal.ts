import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createServer } from 'node:http';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { loadRecipeCards } from '../src/eval/recsys/recipe-cards.js';
import type { RecipeCard } from '../src/eval/recsys/draft.js';
import { goldFile } from '../src/eval/recsys/gold-paths.js';

/**
 * Tier 2 review portal (`labels:portal`) — review mode. Browse every candidate (grouped by anchor),
 * each pre-filled with the DeepSeek draft as its current label. Arrow through the ones DeepSeek got
 * right; press 0–3 only to override a wrong one. Overrides append to `eval/gold/pairs[.<set>].jsonl`
 * (last write wins). Localhost only. `GOLD_SET` selects the campaign; target DB from TURSO_DATABASE_URL.
 */
const PAIRS = goldFile('pairs');
const PORT = Number(process.env.PORT ?? 4100);
const readJsonl = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

type Pair = { a: string; c: string; src?: string };
const candidates: Pair[] = readJsonl(goldFile('candidates')).filter((o: any) => o.a && o.c);
const drafts = new Map<string, { rel: number; reason: string }>(readJsonl(goldFile('drafts')).map((o: any) => [`${o.a}|${o.c}`, { rel: o.rel, reason: o.reason }]));
const overrides = new Map<string, number | null>(); // last human verdict per a|c
for (const o of readJsonl(PAIRS) as any[]) overrides.set(`${o.a}|${o.c}`, o.rel);

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const cards = await loadRecipeCards(client, [...new Set(candidates.flatMap((p) => [p.a, p.c]))]);
const card = (id: string): RecipeCard => cards.get(id) ?? { id, title: '(missing recipe)', ingredients: [] };
const draftedFrom = (p: Pair) => drafts.get(`${p.a}|${p.c}`) ?? null;
const currentOf = (p: Pair) => {
  const k = `${p.a}|${p.c}`;
  return overrides.has(k) ? overrides.get(k)! : (draftedFrom(p)?.rel ?? null);
};

const PAGE = `<!doctype html><meta charset=utf8><title>Tier 2 review</title>
<style>body{font:15px/1.5 system-ui;margin:0;background:#F1E6D2;color:#2b2b2b}
.wrap{max-width:940px;margin:0 auto;padding:20px}.prog{color:#7a6a52;margin-bottom:10px}
.anchor{background:#F3E0CC;border-radius:10px;padding:10px 14px;margin-bottom:12px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#FBF6EC;border-radius:12px;padding:14px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.card h2{font-size:16px;margin:0 0 6px}.card ul{margin:0;padding-left:18px;color:#5a5142}.card li{font-size:12.5px}
.tag{font-size:12px;color:#7a6a52}.draft{margin:14px 0;padding:9px 13px;background:#efe3cf;border-radius:9px}
.btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:6px}
button{font:600 15px system-ui;padding:9px 15px;border:0;border-radius:9px;cursor:pointer;background:#d8c7a8;color:#2b2b2b}
button.cur{background:#A85E2B;color:#fff}button.nav{background:#8a7d68;color:#fff}
.done{text-align:center;padding:60px;font-size:20px}</style>
<div class=wrap>
<div class=prog id=prog></div>
<div id=app></div>
<p style=color:#7a6a52>← / → move · <b>0–3</b> override (auto-advances) · space = next · good = 2 or 3, 1 = bad rec, 0 = unrelated</p>
</div>
<script>
let i=0,total=0;
function esc(s){return String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
async function show(){const r=await fetch('/api/pair?i='+i);const d=await r.json();total=d.total;
 document.getElementById('prog').textContent='pair '+(d.i+1)+' / '+d.total+' · corrected '+d.changed+' · '+d.anchorsLeft+' recs still on the DeepSeek default';
 const c=d.pair;const li=(r)=>r.ingredients.slice(0,12).map(x=>'<li>'+esc(x)+'</li>').join('');
 const dr=c.draft?('DeepSeek: <b>'+c.draft.rel+'</b> — '+esc(c.draft.reason||'')):'no draft';
 const cur=c.current;
 document.getElementById('app').innerHTML=
  '<div class=anchor><b>Anchor:</b> '+esc(c.a.title)+'</div>'+
  '<div class=cards><div class=card><h2>'+esc(c.a.title)+'</h2><ul>'+li(c.a)+'</ul></div>'+
  '<div class=card><h2>'+esc(c.c.title)+'</h2><div class=tag>surfaced by: '+c.src+'</div><ul>'+li(c.c)+'</ul></div></div>'+
  '<div class=draft>'+dr+'</div>'+
  '<div class=btns>current: '+[0,1,2,3].map(n=>'<button onclick=vote('+n+') class="'+(cur===n?'cur':'')+'">'+n+'</button>').join('')+
  ' <button class=nav onclick="move(-1)">← prev</button><button class=nav onclick="move(1)">next →</button></div>';}
async function vote(rel){const r=await fetch('/api/pair?i='+i);const c=(await r.json()).pair;
 await fetch('/api/verdict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a:c.a.id,c:c.c.id,rel})});
 move(1);}
function move(d){i=Math.max(0,Math.min(total-1,i+d));show();}
document.addEventListener('keydown',e=>{if(['0','1','2','3'].includes(e.key))vote(+e.key);
 else if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();move(1);}else if(e.key==='ArrowLeft')move(-1);});
show();
</script>`;

function pairView(idx: number) {
  const p = candidates[idx]!;
  return {
    i: idx,
    total: candidates.length,
    changed: overrides.size,
    anchorsLeft: candidates.length - overrides.size,
    pair: { a: card(p.a), c: card(p.c), src: p.src ?? '?', draft: draftedFrom(p), current: currentOf(p) },
  };
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  } else if (req.method === 'GET' && url.pathname === '/api/pair') {
    const idx = Math.max(0, Math.min(candidates.length - 1, Number(url.searchParams.get('i') ?? 0)));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(pairView(idx)));
  } else if (req.method === 'POST' && url.pathname === '/api/verdict') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { a, c, rel } = JSON.parse(body) as { a: string; c: string; rel: number | null };
      appendFileSync(PAIRS, JSON.stringify({ a, c, rel }) + '\n');
      overrides.set(`${a}|${c}`, rel);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Tier 2 review portal (review mode) → http://localhost:${PORT}  (${candidates.length} recs, pre-filled with DeepSeek drafts)`));
