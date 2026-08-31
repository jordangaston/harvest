import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { dbFromEnv } from '../src/edge-db.js';
import { threads, objectives, slots, households, users } from '../src/schema.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
const db = dbFromEnv();
const [t] = await db.select().from(threads).where(eq(threads.chatGuid, 'any;-;+15128267702'));
const [o] = await db.select().from(objectives).where(eq(objectives.threadId, t.id));
console.log('objective:', o.definition, '->', o.status);
const [h] = await db.select().from(households).where(eq(households.id, t.householdId!));
const hp = await HouseholdPreferenceRepository.create(db).getPreferences(h.id);
console.log('household_prefs:', JSON.stringify(hp));
const members = await HouseholdRepository.create(db).loadMembers(h.id);
const pr = PreferenceRepository.create(db);
for (const m of members) {
  const p = await pr.getPreferences(m.userId);
  const [u] = await db.select().from(users).where(eq(users.id, m.userId));
  console.log(`\n${u.name}: allergens=${JSON.stringify(p.allergens)} diets=${JSON.stringify(p.diets)} skill=${p.skillLevel} goals=${JSON.stringify(u.goals)}`);
  console.log(`  foodPrefs=${JSON.stringify(p.foodPrefs)}`);
}
const s = await db.select().from(slots).where(eq(slots.objectiveId, o.id));
console.log('\nslots filled:', s.filter(x=>x.status==='filled').length, '/', s.length);
console.log('unfilled:', s.filter(x=>x.status!=='filled').map(x=>`${x.key}${x.memberUserId?'(m)':''}`).join(', ') || 'none');
process.exit(0);
