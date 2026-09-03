import 'dotenv/config';
import { inArray, eq, isNull } from 'drizzle-orm';
import { dbFromEnv } from '../src/edge-db.js';
import {
  threads, threadMessages, objectives, tasks, households, householdMembers, householdPreferences,
  users, userAllergens, userDiets, userFoodPrefs, userPreferences,
} from '../src/schema.js';
const HANDLE = '+15128267702';
const CHAT = 'any;-;+15128267702';
const db = dbFromEnv();

// Full purge for a clean onboarding rerun: the real thread AND the initiator's household + every
// member (incl. accumulated name-only proxies) and their preference rows. Product onboarding runs
// once; this only exists so the harness starts each rerun from a true blank slate.
const [initiator] = await db.select().from(users).where(eq(users.imessageHandle, HANDLE));
const hhIds = initiator ? (await db.select().from(households).where(eq(households.ownerUserId, initiator.id))).map((h) => h.id) : [];
const memberIds = hhIds.length ? (await db.select().from(householdMembers).where(inArray(householdMembers.householdId, hhIds))).map((m) => m.userId) : [];

const [t] = await db.select().from(threads).where(eq(threads.chatGuid, CHAT));
if (t) {
  const objIds = (await db.select().from(objectives).where(eq(objectives.threadId, t.id))).map((o) => o.id);
  if (objIds.length) await db.delete(tasks).where(inArray(tasks.objectiveId, objIds));
  await db.delete(objectives).where(eq(objectives.threadId, t.id));
  await db.delete(threadMessages).where(eq(threadMessages.threadId, t.id));
  await db.delete(threads).where(eq(threads.id, t.id));
}
if (hhIds.length) {
  await db.delete(householdMembers).where(inArray(householdMembers.householdId, hhIds));
  await db.delete(householdPreferences).where(inArray(householdPreferences.householdId, hhIds));
  await db.delete(households).where(inArray(households.id, hhIds));
}
const wipeUsers = [...new Set([...(initiator ? [initiator.id] : []), ...memberIds])];
if (wipeUsers.length) {
  for (const tbl of [userAllergens, userDiets, userFoodPrefs, userPreferences]) await db.delete(tbl).where(inArray(tbl.userId, wipeUsers));
  // proxy members (name-only, no handle) are throwaway; delete them. The initiator re-upserts on next inbound.
  await db.delete(users).where(inArray(users.id, wipeUsers));
}
console.log(`purged: thread=${t ? t.id.slice(0, 8) : 'none'}, households=${hhIds.length}, members/users=${wipeUsers.length}`);
process.exit(0);
