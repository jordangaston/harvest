import 'dotenv/config';
import { dbFromEnv } from '../src/edge-db.js';
import { EquipmentMatcher } from '../src/equipment/equipment-matcher.js';
import { AllergenDetector } from '../src/allergen/allergen-detector.js';
const db = dbFromEnv();
const eq = EquipmentMatcher.create();
console.log('=== EQUIPMENT (user phrase → canonical) ===');
for (const p of ['instant pot','air fryer','crockpot','cast iron skillet','dutch oven','blender','sous vide'])
  console.log(p.padEnd(20), '->', eq.detect([p]).equipment.map((e:any)=>e.equipment).join(',') || 'NONE');
console.log('\n=== ALLERGEN (user word → allergen id via FDC pipeline) ===');
const det = AllergenDetector.create(db);
for (const w of ['peanut','shrimp','dairy','milk','gluten','wheat','soy','tree nuts','shellfish','fish','egg','sesame'])
  console.log(w.padEnd(14), '->', JSON.stringify(Object.keys((await det.detect([{ name: w } as any]))?.presences ?? {})));
process.exit(0);
