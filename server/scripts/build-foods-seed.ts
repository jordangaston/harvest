import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Provenance: server/seed/foods.json is hand-curated from USDA FoodData Central
// SR Legacy (per-100g values), the public-domain reference the USDA publishes at
// https://fdc.nal.usda.gov/download-datasets. This script documents and (given the
// local CSV bundle) regenerates that file. The committed foods.json is the source
// of truth; run this only to refresh it from a newer SR Legacy dump.
//
// SR Legacy bulk CSVs expected in ./sr-legacy/ (download once, not committed):
//   food.csv, food_nutrient.csv, nutrient.csv, food_portion.csv

const CSV_DIR = './sr-legacy';
const OUT = './server/seed/foods.json';

// The eight Nutrition-Facts label-core nutrients, by FDC nutrient id.
const NUTRIENT_IDS = {
  calories: 1008,
  grams_of_protein: 1003,
  grams_of_fat: 1004,
  grams_of_carbohydrate: 1005,
  grams_of_fiber: 1079,
  grams_of_sugar: 2000,
  grams_of_saturated_fat: 1258,
  milligrams_of_sodium: 1093,
} as const;

// Curated cooking-staple allow-list: canonical name, aliases, and the SR Legacy
// fdc_id to pull nutrients from. Portions are hand-attached (SR Legacy portion
// data is sparse for cooking measures). This mirrors the committed foods.json.
interface Staple {
  name: string;
  aliases: string[];
  fdc_id: number;
}

const CANONICAL_STAPLES: Staple[] = [
  { name: 'all-purpose flour', aliases: ['flour', 'plain flour', 'white flour'], fdc_id: 168894 },
  { name: 'granulated sugar', aliases: ['sugar', 'white sugar'], fdc_id: 169655 },
  { name: 'olive oil', aliases: ['extra virgin olive oil', 'evoo'], fdc_id: 171413 },
  { name: 'garlic', aliases: ['garlic clove', 'minced garlic'], fdc_id: 169230 },
  { name: 'eggplant', aliases: ['aubergine', 'brinjal'], fdc_id: 169228 },
  { name: 'cilantro', aliases: ['coriander', 'coriander leaves'], fdc_id: 169997 },
  { name: 'chickpea', aliases: ['garbanzo', 'garbanzo bean'], fdc_id: 173757 },
  { name: 'large egg', aliases: ['egg', 'whole egg'], fdc_id: 172183 },
];

/** Splits a CSV line, honouring "double-quoted" fields with embedded commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Reads a CSV file into an array of column-keyed rows. */
function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  });
}

function build(): void {
  const nutrients = readCsv(`${CSV_DIR}/food_nutrient.csv`);
  const idSet = new Set(CANONICAL_STAPLES.map((s) => s.fdc_id));
  const wantedNutrientIds = new Set<number>(Object.values(NUTRIENT_IDS));

  // fdc_id -> nutrient_id -> per-100g amount
  const byFood = new Map<number, Map<number, number>>();
  for (const row of nutrients) {
    const fdcId = Number(row.fdc_id);
    const nutrientId = Number(row.nutrient_id);
    if (!idSet.has(fdcId) || !wantedNutrientIds.has(nutrientId)) continue;
    if (!byFood.has(fdcId)) byFood.set(fdcId, new Map());
    byFood.get(fdcId)!.set(nutrientId, Number(row.amount));
  }

  const foods = CANONICAL_STAPLES.map((staple) => {
    const amounts = byFood.get(staple.fdc_id) ?? new Map<number, number>();
    const per100g = Object.fromEntries(
      Object.entries(NUTRIENT_IDS).map(([key, id]) => [key, amounts.get(id) ?? 0]),
    );
    return { name: staple.name, aliases: staple.aliases, per100g, portions: [] as unknown[] };
  });

  writeFileSync(OUT, `${JSON.stringify(foods, null, 2)}\n`);
  process.stdout.write(`wrote ${foods.length} foods to ${OUT} (attach portions by hand)\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (existsSync(`${CSV_DIR}/food_nutrient.csv`)) {
    build();
  } else {
    process.stdout.write(
      `No ${CSV_DIR}/ CSVs found. The committed ${OUT} (hand-curated from USDA FDC ` +
        `SR Legacy per-100g, provenance noted in this file's header) stands. Nothing to do.\n`,
    );
    process.exit(0);
  }
}
