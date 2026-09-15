import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { fetchWithRetry } from '../src/parse/http.js';
import { loadRecipeCards } from '../src/eval/recsys/recipe-cards.js';
import { draftMessages, parseDraft } from '../src/eval/recsys/draft.js';
import { goldFile } from '../src/eval/recsys/gold-paths.js';

/**
 * Tier 2 draft labels (`labels:draft`): the LLM rates each mined candidate pair 0–3 for similarity,
 * seeding the human review. Reads `eval/gold/candidates.jsonl`, appends `eval/gold/drafts.jsonl`.
 * Resumable (skips pairs already drafted); sequential (LLM rate-limit safe). `--limit N` drafts only
 * the first N undone pairs (smoke test). Uses DeepSeek (OpenAI-compatible); needs `DEEPSEEK_API_KEY`.
 */
const CANDIDATES = goldFile('candidates');
const DRAFTS = goldFile('drafts');
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

const key = process.env.DEEPSEEK_API_KEY;
if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
if (!existsSync(CANDIDATES)) throw new Error(`No ${CANDIDATES} — run \`npm run labels:mine\` first.`);

type Pair = { a: string; c: string };
const pairs: Pair[] = readFileSync(CANDIDATES, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((o: any) => o.a && o.c);
const done = new Set<string>(existsSync(DRAFTS) ? readFileSync(DRAFTS, 'utf8').trim().split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); return `${o.a}|${o.c}`; }) : []);
const todo = pairs.filter((p) => !done.has(`${p.a}|${p.c}`)).slice(0, limit);

const client = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const ids = [...new Set(pairs.flatMap((p) => [p.a, p.c]))];
const cards = await loadRecipeCards(client, ids);

console.log(`drafting ${todo.length} pairs (${done.size} already done) via DeepSeek…`);
let n = 0;
for (const p of todo) {
  const a = cards.get(p.a);
  const b = cards.get(p.c);
  if (!a || !b) continue;
  const res = await fetchWithRetry(DEEPSEEK_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek-chat', response_format: { type: 'json_object' }, messages: draftMessages(a, b) }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
  const json = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const draft = parseDraft(json.choices[0]?.message.content);
  appendFileSync(DRAFTS, JSON.stringify({ a: p.a, c: p.c, rel: draft.rel, reason: draft.reason }) + '\n');
  if (++n % 20 === 0) console.log(`  ${n}/${todo.length}`);
}
console.log(`Done. drafted ${n} pairs → ${DRAFTS}`);
process.exit(0);
