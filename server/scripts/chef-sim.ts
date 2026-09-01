import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { eq, asc } from 'drizzle-orm';
import { dbFromEnv } from '../src/edge-db.js';
import { users, threads, threadMessages, households, householdMembers, objectives, slots } from '../src/schema.js';
import { ThreadRepository } from '../src/repositories/thread-repository.js';
import { Consumer } from '../src/imessage/consumer.js';
import { selectChef } from '../src/imessage/chef.js';
import { StubThreadLock } from '../src/imessage/lock.js';
import type { Sender } from '../src/imessage/sender.js';

/**
 * Dev conversation harness — drive the real chef WITHOUT iMessage. Plays the user by inserting
 * an inbound message, running the full turn (real DeepSeek chef, lock, commit, ordering), and
 * printing the chef's reply + the resulting state. Lets us develop/debug onboarding autonomously.
 *
 *   npx tsx scripts/chef-sim.ts reset          # wipe the dev thread, start fresh
 *   npx tsx scripts/chef-sim.ts "hi"           # send one user message, read the chef's reply
 *   npx tsx scripts/chef-sim.ts "just me and my partner"
 */
const CHAT = 'dev-sim';
const HANDLE = 'dev:+15550000000';

/** Captures what would be sent instead of hitting Spectrum. */
class CaptureSender implements Sender {
  bubbles: string[] = [];
  async send(_chatGuid: string, bodies: string[]): Promise<string[]> {
    this.bubbles.push(...bodies);
    return bodies.map((_, i) => `ext-${i}`);
  }
  async sendEffect(_chatGuid: string, body: string, effectName: string): Promise<string[]> {
    this.bubbles.push(`[effect:${effectName}] ${body}`);
    return ['ext-0'];
  }
  async sendReply(chatGuid: string, _target: string, bodies: string[]): Promise<string[]> {
    return this.send(chatGuid, bodies);
  }
  async sendLink(_chatGuid: string, url: string): Promise<string[]> {
    this.bubbles.push(`[richlink:${url}]`);
    return ['ext-0'];
  }
  async sendReaction(_chatGuid: string, target: string, emoji: string): Promise<void> {
    this.bubbles.push(`[reaction:${emoji}->${target}]`);
  }
  async renameChat(_chatGuid: string, name: string): Promise<void> {
    this.bubbles.push(`[rename:${name}]`);
  }
  async sendContactCard(_chatGuid: string): Promise<void> {
    this.bubbles.push('[contact-card]');
  }
  async markRead(): Promise<void> {}
  async responding<T>(_chatGuid: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

async function reset(db: ReturnType<typeof dbFromEnv>): Promise<void> {
  const [t] = await db.select().from(threads).where(eq(threads.chatGuid, CHAT));
  if (t) {
    const objs = await db.select().from(objectives).where(eq(objectives.threadId, t.id));
    for (const o of objs) await db.delete(slots).where(eq(slots.objectiveId, o.id));
    await db.delete(objectives).where(eq(objectives.threadId, t.id));
    await db.delete(threadMessages).where(eq(threadMessages.threadId, t.id));
    if (t.householdId) {
      await db.delete(householdMembers).where(eq(householdMembers.householdId, t.householdId));
      await db.delete(households).where(eq(households.id, t.householdId));
    }
    await db.delete(threads).where(eq(threads.id, t.id));
  }
  const [u] = await db.select().from(users).where(eq(users.imessageHandle, HANDLE));
  if (u) await db.delete(users).where(eq(users.id, u.id));
  console.log('reset — dev thread wiped');
}

async function transcript(db: ReturnType<typeof dbFromEnv>, threadId: string): Promise<void> {
  const msgs = await db.select().from(threadMessages).where(eq(threadMessages.threadId, threadId)).orderBy(asc(threadMessages.createdAt));
  console.log('\n─── transcript ───');
  for (const m of msgs) console.log(m.direction === 'inbound' ? `🧑 ${m.body}` : `🧑‍🍳 ${m.body}`);
}

(async () => {
  const arg = process.argv.slice(2).join(' ').trim();
  const db = dbFromEnv();
  if (arg === 'reset' || arg === '') {
    await reset(db);
    process.exit(0);
  }

  const repo = ThreadRepository.create(db);
  const userId = await repo.upsertUserByHandle(HANDLE);
  const thread = await repo.upsertThreadByChatGuid({ chatGuid: CHAT, ownerUserId: userId });
  await repo.insertInboundMessage({ threadId: thread.id, senderUserId: userId, type: 'text', body: arg, messageGuid: `dev-${randomUUID()}` });

  const sender = new CaptureSender();
  const t0 = Date.now();
  await new Consumer(db, sender, selectChef(db), new StubThreadLock()).handle({ threadId: thread.id });

  console.log(`\n🧑 ${arg}`);
  console.log(`🧑‍🍳 (${Date.now() - t0}ms):`);
  for (const b of sender.bubbles) console.log('   •', b);

  const hh = await db.select().from(households);
  const mem = await db.select().from(householdMembers);
  const sl = await db.select().from(slots);
  const filled = sl.filter((s) => s.status === 'filled');
  console.log(`\n── state: households=${hh.length} members=${mem.length} slots=${sl.length} (filled ${filled.length}) ──`);
  if (filled.length) console.log('   filled:', filled.map((s) => `${s.key}=${JSON.stringify(s.value)}`).join(', '));
  process.exit(0);
})().catch((e) => { console.error(e?.stack ?? e?.message ?? e); process.exit(1); });
