import { config } from 'dotenv';
config({ path: '.env.local' });
config();
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { normalize } from '../src/nutrition/normalize.js';

/**
 * Seeds seasoning base ingredients + synthetic FDC foods. FNDDS (a *survey* food DB) has no
 * standalone salt/spice/herb entries, so seasonings never matched (the old matcher faked it:
 * salt→saltine, cumin→cucumber) — starving the taste vectors of their most cuisine-distinctive
 * signal and breaking diet coverage (unrecognized ingredients → `unknown`). Each seasoning becomes
 * one `taste_ingredients` base + one synthetic `fdc_foods` row per name variant (base_ingredient_id
 * set), in a reserved fdc_id range. The FTS triggers index them, so the matcher resolves them
 * word-exact. Idempotent (clears the reserved range + `Seasoning` bases, re-inserts).
 */
const url = process.env.TURSO_DATABASE_URL;
if (!url) throw new Error('TURSO_DATABASE_URL is not set');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

type Supplement = { label: string; names: string[] };
const seasonings: Supplement[] = [
  ...(JSON.parse(readFileSync('seed/seasonings.json', 'utf8')) as Supplement[]),
  ...(JSON.parse(readFileSync('seed/pantry.json', 'utf8')) as Supplement[]),
];
const FDC_BASE = 90_000_000; // clears the real FNDDS max (~2.7M)
const slug = (s: string) => 'seasoning-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Idempotent reset. Clear ingredient refs to the synthetic foods first (a prior backfill points at
// them → FK blocks the delete otherwise); the backfill re-matches after. Then null seasoning bases
// on adopted real foods, drop the synthetic foods (FTS triggers follow), and drop the bases.
await client.execute('update ingredients set fdc_id = null, match_quality = null where fdc_id >= 90000000');
await client.execute("update fdc_foods set base_ingredient_id = null where base_ingredient_id like 'seasoning-%'");
await client.execute("delete from ingredient_distinctiveness where base_ingredient_id like 'seasoning-%'"); // rebuilt by build:taste
await client.execute('delete from fdc_foods where fdc_id >= 90000000');
await client.execute("delete from taste_ingredients where section in ('Seasoning', 'Sauce')");

let fdc = FDC_BASE;
let foods = 0;
let adopted = 0;
for (const s of seasonings) {
  const id = slug(s.label);
  await client.execute({
    sql: 'insert into taste_ingredients (id, label, section, food_group) values (?, ?, ?, ?)',
    args: [id, s.label, 'Seasoning', 90],
  });
  for (const name of s.names) {
    const norm = normalize(name).join(' ');
    await client.execute({
      sql: 'insert into fdc_foods (fdc_id, description, description_normalized, category, base_ingredient_id) values (?, ?, ?, ?, ?)',
      args: [fdc++, name, norm, 'Spices and seasonings', id],
    });
    foods++;
    // Adopt an existing base-less FNDDS food for this seasoning (e.g. "Cilantro, raw" → cilantro),
    // so it rolls up whichever food the matcher picks. `X` and `X raw` only — no fuzzy over-reach.
    const res = await client.execute({
      sql: "update fdc_foods set base_ingredient_id = ? where base_ingredient_id is null and description_normalized in (?, ?)",
      args: [id, norm, `${norm} raw`],
    });
    adopted += res.rowsAffected;
  }
}
// Sauces are their own cuisine-distinctive base (pesto→Italian, salsa verde→Mexican) — a stronger
// taste signal atomic than decomposed into commodity parts. Unlike seasonings, the real FNDDS food
// already exists *with nutrition* ("Tzatziki dip", "Guacamole, NFS"), so we adopt it rather than
// synthesize — the ingredient keeps its macros and gains a rollup dimension. Exact-description match
// so we tag the sauce, not a dish that merely mentions it.
type SauceBase = { label: string; adopt: string[] };
const sauces: SauceBase[] = JSON.parse(readFileSync('seed/sauces.json', 'utf8'));
let sauceAdopted = 0;
for (const s of sauces) {
  const id = slug(s.label);
  await client.execute({
    sql: 'insert into taste_ingredients (id, label, section, food_group) values (?, ?, ?, ?)',
    args: [id, s.label, 'Sauce', 90],
  });
  for (const description of s.adopt) {
    const res = await client.execute({
      sql: 'update fdc_foods set base_ingredient_id = ? where base_ingredient_id is null and description = ?',
      args: [id, description],
    });
    sauceAdopted += res.rowsAffected;
  }
}

console.log(
  `seeded ${seasonings.length} seasoning bases · ${foods} synthetic foods · adopted ${adopted} existing base-less foods · ` +
    `${sauces.length} sauce bases adopting ${sauceAdopted} real foods`,
);
process.exit(0);
