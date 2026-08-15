// Measure representative libSQL round-trip latency (read + interactive-transaction
// commit) against whatever TURSO_DATABASE_URL points at. Prints milliseconds only
// — never the URL or token. Used to contrast real Turso cloud vs local file:.
import { createClient } from '@libsql/client';

const label = process.argv[2] || 'db';
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await client.execute('CREATE TABLE IF NOT EXISTS lat_probe (id text primary key, n integer)');
await client.execute('select 1'); // warm the connection

const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ms = (t) => Math.round(t * 10) / 10;

const reads = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  await client.execute('select 1');
  reads.push(performance.now() - t);
}

// Interactive transaction: insert + update + commit — the persist shape.
const txs = [];
for (let i = 0; i < 5; i++) {
  const t = performance.now();
  const tx = await client.transaction('write');
  await tx.execute({ sql: 'insert or replace into lat_probe(id, n) values (?, ?)', args: [String(i), i] });
  await tx.execute({ sql: 'update lat_probe set n = n + 1 where id = ?', args: [String(i)] });
  await tx.commit();
  txs.push(performance.now() - t);
}

console.log(`LATENCY ${label}: read_select1_ms=${ms(median(reads))} interactive_tx_commit_ms=${ms(median(txs))} (median of 5)`);
