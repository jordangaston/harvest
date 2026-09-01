import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { dbFromEnv } from '../src/edge-db.js';
import { users, threads, threadMessages, households, householdMembers, objectives, slots, householdPreferences } from '../src/schema.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { HouseholdRepository } from '../src/repositories/household-repository.js';
import { HouseholdPreferenceRepository } from '../src/repositories/household-preference-repository.js';
import { PreferenceRepository } from '../src/repositories/preference-repository.js';
import { Consumer } from '../src/imessage/consumer.js';
import { selectChef } from '../src/imessage/chef.js';
import { StubThreadLock } from '../src/imessage/lock.js';
import type { Sender } from '../src/imessage/sender.js';

/** Drives a full scripted onboarding conversation through the real chef, then dumps final DB state. */
const CHAT = 'dev-sim';
const HANDLE = 'dev:+15550000000';

class CaptureSender implements Sender {
  bubbles: string[] = [];
  async send(_g: string, bodies: string[]): Promise<string[]> { this.bubbles.push(...bodies); return bodies.map((_, i) => `ext-${i}`); }
  async sendEffect(_g: string, body: string, effectName: string): Promise<string[]> { this.bubbles.push(`[effect:${effectName}] ${body}`); return ['ext-0']; }
  async sendReply(g: string, _t: string, bodies: string[]): Promise<string[]> { return this.send(g, bodies); }
  async sendLink(_g: string, url: string): Promise<string[]> { this.bubbles.push(`[richlink:${url}]`); return ['ext-0']; }
  async sendReaction(_g: string, target: string, emoji: string): Promise<void> { this.bubbles.push(`[reaction:${emoji}->${target}]`); }
  async markRead(): Promise<void> {}
  async responding<T>(_g: string, fn: () => Promise<T>): Promise<T> { return fn(); }
}

const SCRIPT = [
  'hey',
  "It's me Jordan and my wife Sam, we cook together",
  'We want quick healthy weeknight dinners. We shop at Whole Foods, budget about $150 a week',
  'We shop on Sundays, cook about 4 nights a week, plan for 5 dinners, and we like to keep dinners under 30 minutes',
  'We have an instant pot and an air fryer, and we eat leftovers',
  "For me, Jordan — peanut allergy, severe. No special diet. I love Thai food and grilled chicken, hate cilantro. Intermediate cook.",
  'Sam has no allergies. She is a flexible pescatarian — fish always, meat once in a while. Loves salmon and pasta, dislikes mushrooms. Beginner cook.',
  'That covers everyone, thanks!',
];

/** Dev-DB slate wipe — nukes all onboarding/household state (meal-plan tables untouched). */
async function purge(db: ReturnType<typeof dbFromEnv>): Promise<void> {
  await db.delete(slots);
  await db.delete(objectives);
  await db.delete(householdPreferences);
  await db.delete(householdMembers);
  await db.delete(households);
  const [t] = await db.select().from(threads).where(eq(threads.chatGuid, CHAT));
  if (t) await db.delete(threadMessages).where(eq(threadMessages.threadId, t.id));
  await db.delete(threads).where(eq(threads.chatGuid, CHAT));
  // Proxy/dev users left behind by prior runs (no real handle, or the dev handle itself).
  const all = await db.select().from(users);
  for (const u of all) if (!u.imessageHandle || u.imessageHandle === HANDLE) await db.delete(users).where(eq(users.id, u.id));
}

(async () => {
  const db = dbFromEnv();
  await purge(db);
  const repo = ThreadRepository.create(db);
  const userId = await repo.upsertUserByHandle(HANDLE);
  const thread = await repo.upsertThreadByChatGuid({ chatGuid: CHAT, ownerUserId: userId });

  for (const msg of SCRIPT) {
    await repo.insertInboundMessage({ threadId: thread.id, senderUserId: userId, type: 'text', body: msg, messageGuid: `dev-${randomUUID()}` });
    const sender = new CaptureSender();
    const t0 = Date.now();
    await new Consumer(db, sender, selectChef(db), new StubThreadLock()).handle({ threadId: thread.id });
    console.log(`\n🧑 ${msg}`);
    console.log(`🧑‍🍳 (${Date.now() - t0}ms):`);
    for (const b of sender.bubbles) console.log('   •', b);
    const sl = await db.select().from(slots);
    console.log(`   [slots ${sl.length}, filled ${sl.filter((s) => s.status === 'filled').length}]`);
  }

  console.log('\n════════ FINAL STATE ════════');
  const hh = await db.select().from(households);
  console.log(`households=${hh.length}`);
  const hpRepo = HouseholdPreferenceRepository.create(db);
  for (const h of hh) console.log('household_preferences:', JSON.stringify(await hpRepo.getPreferences(h.id)));
  const members = hh.length ? await HouseholdRepository.create(db).loadMembers(hh[0]!.id) : [];
  const prefRepo = PreferenceRepository.create(db);
  for (const m of members) {
    const p = await prefRepo.getPreferences(m.userId);
    const [u] = await db.select().from(users).where(eq(users.id, m.userId));
    console.log(`member ${m.name ?? m.imessageHandle}: allergens=${JSON.stringify(p.allergens)} diets=${JSON.stringify(p.diets)} foodPrefs=${JSON.stringify(p.foodPrefs)} skill=${p.skillLevel} goals=${JSON.stringify(u?.goals ?? null)}`);
  }
  const sl = await db.select().from(slots);
  console.log('\nfilled slots:\n  ' + sl.filter((s) => s.status === 'filled').map((s) => `${s.key}=${JSON.stringify(s.value)}`).join('\n  '));
  console.log('\nunfilled:', sl.filter((s) => s.status !== 'filled').map((s) => s.key).join(', '));
  process.exit(0);
})().catch((e) => { console.error(e?.stack ?? e?.message ?? e); process.exit(1); });
