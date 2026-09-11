import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { createServer } from 'node:http';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { loadRecipeCards } from '../src/eval/recsys/recipe-cards.js';
import type { RecipeCard } from '../src/eval/recsys/draft.js';

/**
 * Tier 2 review portal (`labels:portal`): a local-first server for correcting the LLM drafts into
 * the human gold set. Shows the anchor + candidate recipe, the draft label, and 0–3 / Skip buttons;
 * each verdict appends to `eval/gold/pairs.jsonl`. Localhost only. Target DB from `TURSO_DATABASE_URL`.
 */
const GOLD = join(process.cwd(), 'eval', 'gold');
const PAIRS = join(GOLD, 'pairs.jsonl');
const PORT = Number(process.env.PORT ?? 4100);

const readJsonl = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

type Pair = { a: string; c: string; dis?: number };
const candidates: Pair[] = readJsonl(join(GOLD, 'candidates.jsonl')).filter((o: any) => o.a && o.c);
const drafts = new Map<string, { rel: number; reason: string }>(readJsonl(join(GOLD, 'drafts.jsonl')).map((o: any) => [`${o.a}|${o.c}`, { rel: o.rel, reason: o.reason }]));
const handled = new Set<string>(readJsonl(PAIRS).map((o: any) => `${o.a}|${o.c}`));

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const cards = await loadRecipeCards(client, [...new Set(candidates.flatMap((p) => [p.a, p.c]))]);
const card = (id: string): RecipeCard => cards.get(id) ?? { id, title: '(missing recipe)', ingredients: [] };

function nextPair() {
  const p = candidates.find((x) => !handled.has(`${x.a}|${x.c}`));
  if (!p) return null;
  return { a: card(p.a), c: card(p.c), draft: drafts.get(`${p.a}|${p.c}`) ?? null, dis: p.dis ?? null };
}

const PAGE = `<!doctype html><meta charset=utf8><title>Tier 2 review</title>
<style>body{font:15px/1.5 system-ui;margin:0;background:#F1E6D2;color:#2b2b2b}
.wrap{max-width:900px;margin:0 auto;padding:24px}.prog{color:#7a6a52;margin-bottom:12px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:#FBF6EC;border-radius:12px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.card h2{font-size:17px;margin:0 0 8px}.card ul{margin:0;padding-left:18px;color:#5a5142}.card li{font-size:13px}
.draft{margin:16px 0;padding:10px 14px;background:#F3E0CC;border-radius:10px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
button{font:600 15px system-ui;padding:10px 16px;border:0;border-radius:10px;cursor:pointer;background:#A85E2B;color:#fff}
button.skip{background:#8a7d68}button.on{outline:3px solid #2b2b2b}
.done{text-align:center;padding:60px;font-size:20px}</style>
<div class=wrap>
<div class=prog id=prog></div>
<div id=app></div>
</div>
<script>
let cur=null;
async function load(){const r=await fetch('/api/next');const d=await r.json();
 document.getElementById('prog').textContent='labeled '+d.done+' / '+d.total;
 if(!d.pair){document.getElementById('app').innerHTML='<div class=done>All done — '+d.done+' labeled. You can close this.</div>';return;}
 cur=d.pair;const c=cur;
 const li=(r)=>r.ingredients.map(i=>'<li>'+esc(i)+'</li>').join('');
 const draft=c.draft?('LLM draft: <b>'+c.draft.rel+'</b> — '+esc(c.draft.reason||'')):'no draft';
 document.getElementById('app').innerHTML=
  '<div class=cards><div class=card><h2>'+esc(c.a.title)+'</h2><ul>'+li(c.a)+'</ul></div>'+
  '<div class=card><h2>'+esc(c.c.title)+'</h2><ul>'+li(c.c)+'</ul></div></div>'+
  '<div class=draft>'+draft+'</div>'+
  '<div class=btns>'+[0,1,2,3].map(n=>'<button onclick=vote('+n+') class="'+(c.draft&&c.draft.rel===n?'on':'')+'">'+n+'</button>').join('')+
  '<button class=skip onclick=vote(null)>Skip</button></div>'+
  '<p style=color:#7a6a52>0 unrelated · 1 loosely · 2 similar · 3 very similar</p>';}
function esc(s){return String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
async function vote(rel){if(!cur)return;await fetch('/api/verdict',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({a:cur.a.id,c:cur.c.id,rel})});load();}
document.addEventListener('keydown',e=>{if(['0','1','2','3'].includes(e.key))vote(+e.key);if(e.key===' '){e.preventDefault();vote(null);}});
load();
</script>`;

createServer((req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
  } else if (req.method === 'GET' && url === '/api/next') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ pair: nextPair(), done: handled.size, total: candidates.length }));
  } else if (req.method === 'POST' && url === '/api/verdict') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const { a, c, rel } = JSON.parse(body) as { a: string; c: string; rel: number | null };
      appendFileSync(PAIRS, JSON.stringify({ a, c, rel }) + '\n');
      handled.add(`${a}|${c}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    });
  } else {
    res.writeHead(404).end();
  }
}).listen(PORT, () => console.log(`Tier 2 review portal → http://localhost:${PORT}  (${candidates.length - handled.size} pairs left)`));
