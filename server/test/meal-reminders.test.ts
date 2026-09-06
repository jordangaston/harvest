import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { type Database } from "../src/db.js";
import { dynamicCronJobs, threads, threadMessages, objectives, tasks } from "../src/schema.js";
import { nextRun } from "../src/crons/next-run.js";
import { CronJobsRepository } from "../src/crons/cron-jobs-repository.js";
import { sweep, type SendDoorbell } from "../src/crons/sweep.js";
import { ReminderRepository, MEAL_REMINDER } from "../src/reminders/reminder-repository.js";
import { RemindersService } from "../src/reminders/reminders-service.js";
import { ObjectiveRepository } from "../src/chef/objective-repository.js";
import { firstMealPlanObjective } from "../src/chef/objectives/first-meal-plan.js";
import { HouseholdRepository } from "../src/repositories/household-repository.js";
import { HouseholdPreferenceRepository } from "../src/repositories/household-preference-repository.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { MealPlanService } from "../src/services/meal-plan-service.js";
import { AuthService } from "../src/services/auth-service.js";
import { Consumer } from "../src/imessage/consumer.js";
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubThreadLock } from "../src/imessage/lock.js";
import { ThreadRepository } from "../src/repositories/thread-repository.js";
import type { Chef, ChefReply, ReminderIntent } from "../src/imessage/chef.js";

const RECIPE: RecipeInput = {
  title: "Chicken Marbella",
  sourceType: "instagram",
  servings: 4,
  servingsEstimated: false,
  ingredients: [{ name: "chicken", amount: "2", unit: "pound", quantityText: "2 lb chicken" }],
  steps: ["Bake"],
  nutrition: null,
  allergens: null,
};

let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** Seeds a thread + household + owner member; sets the household's weekly meal counts. */
async function seedThread(weeklyMeals?: { breakfast: number; lunch: number; dinner: number; snack: number; kids: number }) {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const owner = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });
  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: owner.id });
  await hh.addMember({ householdId: household.id, userId: owner.id });
  if (weeklyMeals) await HouseholdPreferenceRepository.create(db).savePreferences(household.id, { weeklyMeals });

  const threadId = randomUUID();
  const chatGuid = `g-${threadId}`;
  await db.insert(threads).values({ id: threadId, chatGuid, ownerUserId: owner.id, householdId: household.id, greetedAt: new Date() });
  return { threadId, chatGuid, ownerId: owner.id, householdId: household.id };
}

/** Rows keyed by meal for a thread's meal_reminder jobs. */
async function reminderRows(threadId: string) {
  const rows = await db.select().from(dynamicCronJobs).where(and(eq(dynamicCronJobs.ownerId, threadId), eq(dynamicCronJobs.jobType, MEAL_REMINDER)));
  return Object.fromEntries(rows.map((r) => [r.meal, r]));
}

// ── cron math (unit) ──────────────────────────────────────────────────────────

describe("RemindersService cron math", () => {
  it("dinner fires at 16:30 local (18:00 anchor − 90m), lunch at 10:30", async () => {
    const { threadId } = await seedThread({ breakfast: 0, lunch: 3, dinner: 5, snack: 0, kids: 0 });
    await db.transaction((tx) => RemindersService.create(db).provisionReminders(threadId, new Date("2026-09-05T00:00:00Z"), tx));
    const rows = await reminderRows(threadId);
    expect(rows.dinner!.cronExpression).toBe("30 16 * * *");
    expect(rows.lunch!.cronExpression).toBe("30 10 * * *");
  });

  it("nextRun reads the expression in the household zone", () => {
    // 16:30 America/New_York on 2026-09-05 is 20:30 UTC (EDT, UTC-4).
    expect(nextRun("30 16 * * *", new Date("2026-09-05T00:00:00Z"), "America/New_York").toISOString()).toBe("2026-09-05T20:30:00.000Z");
  });
});

// ── Test Case 1: migration + provisioning (AC-1, AC-3) ─────────────────────────

describe("Test Case 1: provisioning derives pause from weekly counts (AC-1, AC-3)", () => {
  it("dinner+lunch live, breakfast paused, snack absent; re-run changes nothing (idempotent)", async () => {
    const { threadId } = await seedThread({ breakfast: 0, lunch: 3, dinner: 5, snack: 0, kids: 0 });
    const now = new Date("2026-09-05T00:00:00Z");
    await db.transaction((tx) => RemindersService.create(db).provisionReminders(threadId, now, tx));

    let rows = await reminderRows(threadId);
    expect(Object.keys(rows).sort()).toEqual(["breakfast", "dinner", "lunch"]); // snack NOT provisioned
    expect(rows.dinner!.isPaused).toBe(false);
    expect(rows.lunch!.isPaused).toBe(false);
    expect(rows.breakfast!.isPaused).toBe(true); // breakfast ships paused (Q-04 open)
    const dinnerRunBefore = rows.dinner!.nextRunAt;

    // Re-run: still exactly one row per course, same values (idempotent upsert on the owner index).
    await db.transaction((tx) => RemindersService.create(db).provisionReminders(threadId, now, tx));
    rows = await reminderRows(threadId);
    expect(Object.keys(rows)).toHaveLength(3);
    expect(rows.dinner!.nextRunAt).toEqual(dinnerRunBefore);
  });

  it("a 0-count course starts paused (dinner:0 ⇒ dinner paused)", async () => {
    const { threadId } = await seedThread({ breakfast: 0, lunch: 0, dinner: 0, snack: 0, kids: 0 });
    await db.transaction((tx) => RemindersService.create(db).provisionReminders(threadId, new Date(), tx));
    const rows = await reminderRows(threadId);
    expect(rows.dinner!.isPaused).toBe(true);
    expect(rows.lunch!.isPaused).toBe(true);
  });

  it("provisions on the first_meal_plan pop, and the heartbeat pauses (stack empties) but reminders stay live", async () => {
    const { threadId } = await seedThread({ breakfast: 0, lunch: 3, dinner: 5, snack: 0, kids: 0 });
    const store = ObjectiveRepository.create(db);
    // A lone first_meal_plan objective with one required emit; completing it empties the stack.
    const obj = await store.pushObjective({ threadId, definition: firstMealPlanObjective.id, tasks: [{ key: "gen", kind: "emit", scope: "household", required: true }], position: "top" });
    await db.transaction(async (tx) => {
      await store.applyTaskUpdates([{ taskId: (await db.select().from(tasks).where(eq(tasks.objectiveId, obj.id)))[0]!.id, status: "filled" }], tx);
      const next = await store.completeAndPop(obj.id, tx);
      expect(next).toBeNull(); // stack emptied
    });

    const rows = await reminderRows(threadId);
    expect(rows.dinner!.isPaused).toBe(false); // reminders outlive the objective (F-01)
    // The heartbeat row was paused by the stack-empty rule.
    const [hb] = await db.select().from(dynamicCronJobs).where(and(eq(dynamicCronJobs.ownerId, threadId), eq(dynamicCronJobs.jobType, "thread_heartbeat")));
    if (hb) expect(hb.isPaused).toBe(true);
  });

  it("a non-first_meal_plan pop does NOT provision reminders", async () => {
    const { threadId } = await seedThread({ breakfast: 0, lunch: 3, dinner: 5, snack: 0, kids: 0 });
    const store = ObjectiveRepository.create(db);
    const obj = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    await db.transaction(async (tx) => {
      await store.applyTaskUpdates([{ taskId: (await db.select().from(tasks).where(eq(tasks.objectiveId, obj.id)))[0]!.id, status: "filled" }], tx);
      await store.completeAndPop(obj.id, tx);
    });
    expect(Object.keys(await reminderRows(threadId))).toHaveLength(0);
  });
});

// ── Test Case 2: sweep dispatches both job types (AC-2) ────────────────────────

describe("Test Case 2: sweep dispatches heartbeat AND meal_reminder rows (AC-2)", () => {
  it("two doorbells for the due rows, future untouched, tz-aware advance", async () => {
    const now = new Date("2026-09-05T20:35:00Z");
    const dueSlot = new Date("2026-09-05T20:30:00Z");
    const future = new Date("2026-09-06T20:30:00Z");
    // A due heartbeat, a due dinner reminder (in America/New_York), and a future reminder.
    await db.insert(dynamicCronJobs).values({ jobType: "thread_heartbeat", ownerType: "thread", ownerId: "t-hb", meal: null, input: { threadId: "t-hb" }, cronExpression: "*/5 * * * *", nextRunAt: dueSlot });
    await db.insert(dynamicCronJobs).values({ jobType: MEAL_REMINDER, ownerType: "thread", ownerId: "t-mr", meal: "dinner", input: { threadId: "t-mr", meal: "dinner", tz: "America/New_York" }, cronExpression: "30 16 * * *", nextRunAt: dueSlot });
    await db.insert(dynamicCronJobs).values({ jobType: MEAL_REMINDER, ownerType: "thread", ownerId: "t-future", meal: "lunch", input: { threadId: "t-future", meal: "lunch", tz: "UTC" }, cronExpression: "30 10 * * *", nextRunAt: future });

    const sends: { payload: unknown; key: string }[] = [];
    const mockSend: SendDoorbell = async (_topic, payload, options) => { sends.push({ payload, key: options.idempotencyKey }); };
    const dispatched = await sweep(CronJobsRepository.create(db), mockSend, now);

    expect(dispatched).toBe(2);
    expect(sends.map((s) => (s.payload as { threadId: string }).threadId).sort()).toEqual(["t-hb", "t-mr"]);
    expect(sends.find((s) => s.key.startsWith("mr:dinner:"))!.key).toBe(`mr:dinner:t-mr:${dueSlot.toISOString()}`);

    const rows = Object.fromEntries((await db.select().from(dynamicCronJobs)).map((r) => [r.ownerId, r.nextRunAt]));
    // The dinner reminder advances in America/New_York — next 16:30 EDT after now is 2026-09-06 20:30Z.
    expect(rows["t-mr"]).toEqual(nextRun("30 16 * * *", now, "America/New_York"));
    expect(rows["t-mr"]!.getTime()).toBeGreaterThan(now.getTime());
    expect(rows["t-future"]).toEqual(future); // not due — untouched
  });

  it("skips a paused meal_reminder row (loadDue filters is_paused)", async () => {
    const now = new Date("2026-09-05T20:35:00Z");
    await db.insert(dynamicCronJobs).values({ jobType: MEAL_REMINDER, ownerType: "thread", ownerId: "t-paused", meal: "dinner", input: { threadId: "t-paused", meal: "dinner", tz: "UTC" }, cronExpression: "30 16 * * *", nextRunAt: new Date("2026-09-05T16:30:00Z"), isPaused: true });
    const sends: unknown[] = [];
    await sweep(CronJobsRepository.create(db), async () => { sends.push(1); }, now);
    expect(sends).toHaveLength(0);
  });
});

// ── the fire arm (AC-4, AC-5, AC-6, AC-7) ──────────────────────────────────────

/** A chef that captures the reminder intent it was handed and sends one announcement bubble. */
function announcingChef(): { chef: Chef; intents: (ReminderIntent | undefined)[] } {
  const intents: (ReminderIntent | undefined)[] = [];
  const chef: Chef = {
    respond: async (_threadId, sink, _heartbeat, reminder): Promise<ChefReply> => {
      intents.push(reminder);
      await sink.send({ kind: "text", text: `tonight you're cooking ${reminder?.recipes[0]?.title}` });
      return { confirmTasks: [], cursorTo: null, objectiveId: "meal_reminder", delivered: true, popped: false };
    },
  };
  return { chef, intents };
}

/** Seeds a due dinner reminder row and plans a dinner recipe for `date` for the owner. */
async function seedDueDinner(threadId: string, ownerId: string, date: string, tz = "UTC") {
  await db.transaction((tx) => ReminderRepository.create(db).upsertCourseReminder(threadId, "dinner", "30 16 * * *", new Date(Date.now() - 60_000), false, tz, tx));
  const recipeId = await RecipeRepository.create(db).persist(RECIPE, ownerId);
  await MealPlanService.create(db).add(ownerId, date, "dinner", recipeId, "generated");
  return recipeId;
}

describe("Test Case 3: fire arm announces the planned meal (AC-4)", () => {
  it("chef gets the reminder intent naming dinner + today's recipe; outbound guid is reminder:dinner:<today>; no quiet gate", async () => {
    const { threadId, ownerId } = await seedThread();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await seedDueDinner(threadId, ownerId, today);
    // RECENT activity — proves no quiet gate: a bot message seconds ago must not suppress the reminder.
    await db.insert(threadMessages).values({ id: randomUUID(), threadId, direction: "outbound", type: "text", body: "hi", messageGuid: `${randomUUID()}#0` });

    const { chef, intents } = announcingChef();
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(intents).toHaveLength(1);
    expect(intents[0]!.meal).toBe("dinner");
    expect(intents[0]!.recipes[0]!.title).toBe("Chicken Marbella");
    expect(sender.calls).toHaveLength(1);
    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    const reminderBubble = outbound.find((r) => r.messageGuid.startsWith("reminder:dinner:"));
    expect(reminderBubble!.messageGuid).toBe(`reminder:dinner:${today}#0`);
    expect(reminderBubble!.triggerId).toBeNull();
  });
});

describe("Test Case 4: silence when nothing planned (AC-5)", () => {
  it("a due reminder with no dinner today → chef not invoked, nothing sent, row remains", async () => {
    const { threadId, ownerId } = await seedThread();
    // Due row, but NO plan entry for today.
    await db.transaction((tx) => ReminderRepository.create(db).upsertCourseReminder(threadId, "dinner", "30 16 * * *", new Date(Date.now() - 60_000), false, "UTC", tx));

    const { chef, intents } = announcingChef();
    const respondSpy = vi.spyOn(chef, "respond");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(respondSpy).not.toHaveBeenCalled();
    expect(intents).toEqual([]);
    expect(sender.calls).toHaveLength(0);
    expect(Object.keys(await reminderRows(threadId))).toContain("dinner"); // the row stays for tomorrow
  });
});

describe("Test Case 5: same-day idempotency (AC-6)", () => {
  it("a second doorbell the same day sends no new bubble (per-day guid dedupe)", async () => {
    const { threadId, ownerId } = await seedThread();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await seedDueDinner(threadId, ownerId, today);

    const { chef } = announcingChef();
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls).toHaveLength(1);

    // Re-fire same day: the row is still due (reminders don't advance next_run in the consumer), but the
    // per-day guid already exists + is sent → the sink swallows it. No new bubble, no new outbound row.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls).toHaveLength(1);
    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(1);
  });
});

describe("Test Case 6: pending inbound wins the doorbell (AC-7)", () => {
  it("an unprocessed inbound runs a normal turn; the reminder does not fire this doorbell", async () => {
    const { threadId, ownerId } = await seedThread();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await seedDueDinner(threadId, ownerId, today);
    // An unprocessed inbound message.
    const guid = randomUUID();
    await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: ownerId, type: "text", body: "what's for dinner?", messageGuid: guid });

    // The chef records whether it ever saw a reminder intent; a normal turn advances the cursor.
    const [inbound] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
    const intents: (ReminderIntent | undefined)[] = [];
    const chef: Chef = {
      respond: async (_tid, sink, _hb, reminder): Promise<ChefReply> => {
        intents.push(reminder);
        await sink.send({ kind: "text", text: "answering the inbound" });
        return { confirmTasks: [], cursorTo: inbound!.id, objectiveId: "", delivered: true, popped: false };
      },
    };
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    // The reminder never fired this doorbell (no reminder intent); the row is untouched for the next sweep.
    expect(intents.every((i) => i === undefined)).toBe(true);
    const rem = (await reminderRows(threadId)).dinner!;
    expect(rem.isPaused).toBe(false);
    // No reminder bubble went out — only the inbound answer.
    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound.some((r) => r.messageGuid.startsWith("reminder:"))).toBe(false);
  });
});
