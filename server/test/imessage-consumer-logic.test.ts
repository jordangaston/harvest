import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { pendingPast } from "../src/imessage/consumer-logic.js";
import { Consumer } from "../src/imessage/consumer.js";
import { RealChef, StubChef, type Chef, type ChefReply, type ReminderIntent } from "../src/imessage/chef.js";
import { sendingChef, CollectingSink } from "./helpers/chef-double.js";
import type { ChefAgent, ChefTurn } from "../src/chef/chef-agent.js";
import { buildTools, FACTORY_IDS } from "../src/chef/tools/registry.js";
import { steadyStateObjective } from "../src/chef/objectives/steady-state.js";
import { ReminderRepository } from "../src/reminders/reminder-repository.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { MealPlanService } from "../src/services/meal-plan-service.js";

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
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubThreadLock } from "../src/imessage/lock.js";
import { ObjectiveRepository } from "../src/chef/objective-repository.js";
import { objectiveDefinition } from "../src/chef/objectives/index.js";
import { firstMealPlanTaskSpecs } from "../src/chef/objectives/first-meal-plan.js";
import { ThreadRepository } from "../src/repositories/thread-repository.js";
import { HouseholdRepository } from "../src/repositories/household-repository.js";
import { ScriptedChefAgent } from "../src/chef/chef-agent.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { threads, threadMessages, tasks, objectives } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { type Database } from "../src/db.js";
import type { ThreadMessage } from "../src/models/thread-message.js";

// Test Case 2 (pure): the cursor cut and the sent gate.

function msg(id: string, overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id,
    threadId: "t1",
    direction: "inbound",
    type: "text",
    senderUserId: null,
    body: "hi",
    targetMessageGuid: null,
    reactionEmoji: null,
    messageGuid: `g-${id}`,
    externalId: null,
    sentAt: null,
    triggerId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("pendingPast", () => {
  const rows = [msg("a"), msg("b"), msg("c")];

  it("null cursor → all rows", () => {
    expect(pendingPast(rows, null).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("set cursor → only rows past it", () => {
    expect(pendingPast(rows, "a").map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("cursor covers all rows → empty", () => {
    expect(pendingPast(rows, "c")).toEqual([]);
  });
});

// ── WI-06: the Chef facade + the consumer commit ──────────────────────────────

let db: Database;
let cleanup: () => void;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
});
afterEach(() => cleanup());

/** Seeds a thread + household + one member + an active onboarding objective with the given tasks. */
async function seedThread(taskKeys: string[] = []): Promise<{ threadId: string; chatGuid: string; ownerId: string }> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const owner = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });

  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: owner.id });
  await hh.addMember({ householdId: household.id, userId: owner.id });

  const threadId = randomUUID();
  const chatGuid = `g-${threadId}`;
  // greeted_at set: these cases test the commit/dispatch mechanics, not the WI-4B confetti greeting
  // (which would otherwise route the fresh thread's first bubble through sendEffect).
  await db.insert(threads).values({ id: threadId, chatGuid, ownerUserId: owner.id, householdId: household.id, greetedAt: new Date() });

  if (taskKeys.length)
    await ObjectiveRepository.create(db).pushObjective({
      threadId,
      definition: "onboarding",
      tasks: taskKeys.map((key) => ({ key, kind: "elicit" as const, fact: key, scope: "household" as const, required: true })),
      position: "top",
    });

  return { threadId, chatGuid, ownerId: owner.id };
}

/** Inserts one inbound text message and returns its id. */
async function seedInbound(threadId: string, ownerId: string, body: string): Promise<string> {
  const guid = randomUUID();
  await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: ownerId, type: "text", body, messageGuid: guid });
  const [row] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, guid));
  return row.id;
}

describe("Test Case 1: consumer imports only the Chef facade (AC-1)", () => {
  it("names nothing from reasoning/response/briefing/ReplyPlan/objective-repository/mastra", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/imessage/consumer.ts", import.meta.url)), "utf8");
    const imports = src.split("\n").filter((l) => l.trimStart().startsWith("import"));
    for (const forbidden of ["reasoning", "response-agent", "briefing", "ReplyPlan", "objective-repository", "mastra"])
      expect(imports.join("\n")).not.toContain(forbidden);
    // The only agent import is the facade.
    expect(imports.some((l) => l.includes("./chef.js"))).toBe(true);
  });
});

describe("Test Case 2: null reply → no commit, no send (AC-2)", () => {
  it("writes no outbound, leaves the cursor, never sends", async () => {
    const { threadId } = await seedThread(); // no pending inbound
    const sender = new StubSpectrumSender();
    const chef: Chef = { respond: async () => null };
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(0);
    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBeNull();
    expect(sender.calls).toHaveLength(0);
  });
});

describe("Test Case 3: a turn commits N rows + advances the cursor (AC-3, AC-4)", () => {
  it("commits 2 bubbles + cursor, sends twice", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores", "household.cook_days"]);
    await seedInbound(threadId, ownerId, "we shop at kroger");
    const newestId = await seedInbound(threadId, ownerId, "and cook 5 nights");

    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;
    // Task fills happen through the in-loop tasks__update tool now, not via ChefReply; the consumer's
    // sink sends the bubbles live, then confirms any fact-less tasks and advances the cursor.
    const chef = sendingChef(
      [
        { kind: "text", text: "Kroger, nice." },
        { kind: "text", text: "Five nights it is." },
      ],
      { confirmTasks: [], cursorTo: newestId, objectiveId: active.objective.id },
    );
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(2);
    expect(outbound.every((r) => r.sentAt !== null)).toBe(true);
    expect(sender.calls).toHaveLength(2);

    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBe(newestId);
  });
});

describe("Test Case 4: the confirm/cursor commit is atomic — a failing task update leaves the cursor unmoved (AC-3)", () => {
  it("rolls back the confirm + cursor when applyTaskUpdates throws (live-sent rows persist, deduped on re-run)", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    const newestId = await seedInbound(threadId, ownerId, "hi");
    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;
    const task = active.tasks[0]!;
    // A fact-less task the consumer confirms in-txn via applyTaskUpdates (spied to throw below).
    const chef = sendingChef(
      [{ kind: "text", text: "should still send" }],
      { confirmTasks: [{ taskId: task.id, kind: "emit", status: "unasked" }], cursorTo: newestId, objectiveId: active.objective.id },
    );
    // Make the confirm write fail inside the commit tx to prove the confirm + cursor roll back. The
    // bubble was already sent live (increment 2), so its row persists — the cursor staying null is
    // what makes the redelivered turn re-run and the sink dedupe the already-sent bubble.
    const spy = vi.spyOn(ObjectiveRepository.prototype, "applyTaskUpdates").mockRejectedValueOnce(new Error("boom"));
    const sender = new StubSpectrumSender();
    await expect(new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId })).rejects.toThrow();
    spy.mockRestore();

    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBeNull(); // cursor unmoved → redelivery re-runs the turn
  });
});

describe("Test Case 5: no interruption restart — respond runs the agent exactly once (Q-02)", () => {
  it("does not restart even with a message pending mid-turn (live sends aren't discardable)", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "hey");

    const agent = new ScriptedChefAgent({ mutate: true, send: [{ type: "text", text: "hi" }] });
    const runSpy = vi.spyOn(agent, "run");

    const chef = new RealChef(
      db,
      agent,
      ObjectiveRepository.create(db),
      ThreadRepository.create(db),
      HouseholdRepository.create(db),
    );
    const reply = await chef.respond(threadId, new CollectingSink());

    expect(runSpy).toHaveBeenCalledTimes(1); // no restart loop — exactly one agent run
    expect(reply).not.toBeNull();
  });
});

// ── spec-01: the merged agent over the RealChef harness (social vs work → confirm gate) ──────────

type SendPayload = { type: "text" | "tapback" | "richlink"; text?: string; url?: string };

/** Builds a RealChef around a spied ScriptedChefAgent: `mutate` marks the turn as work (any mutating
 *  tool ran → the consumer confirms fact-less tasks); `sends` are the bubbles it flushes live. */
function harness(mutate: boolean, sends: SendPayload[]) {
  const agent = new ScriptedChefAgent({ mutate, send: sends });
  const runSpy = vi.spyOn(agent, "run");
  const chef = new RealChef(
    db,
    agent,
    ObjectiveRepository.create(db),
    ThreadRepository.create(db),
    HouseholdRepository.create(db),
  );
  return { chef, runSpy };
}

describe("spec-01 Test Case 1: a social (no-work) trigger confirms nothing (AC 1, 5)", () => {
  it("worked is false → confirmTasks is [], cursor + objective from the loaded turn", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    const newestId = await seedInbound(threadId, ownerId, "this only takes 20 min, amazing!");
    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;

    const { chef, runSpy } = harness(false, [{ type: "text", text: "love it!" }]);
    const sink = new CollectingSink();
    const reply = await chef.respond(threadId, sink);

    expect(runSpy).toHaveBeenCalledTimes(1); // the agent runs once
    expect(reply!.confirmTasks).toEqual([]); // no mutating tool ran → a social turn confirms nothing
    expect(reply!.cursorTo).toBe(newestId);
    expect(reply!.objectiveId).toBe(active.objective.id);
    expect(sink.events).toHaveLength(1); // a react or short bubble, sent live
  });
});

describe("spec-01 Test Case 2: a working trigger runs once and confirms fact-less tasks (AC 2, 5)", () => {
  it("invokes the agent once, sends its bubbles, and confirms the loaded fact-less tasks", async () => {
    const { threadId, ownerId } = await seedThread();
    // A fact-less emit (close) is the kind the consumer confirms at send-time — the `worked` gate's
    // positive branch. Seed it directly so the working turn has a fact-less task to confirm.
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const emitId = randomUUID();
    await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });
    await seedInbound(threadId, ownerId, "I'm allergic to peanuts");

    const { chef, runSpy } = harness(true, [
      { type: "text", text: "noting peanuts as a severe allergy for Sam" },
      { type: "text", text: "which store do you shop at?" },
    ]);
    const sink = new CollectingSink();
    const reply = await chef.respond(threadId, sink);

    expect(runSpy).toHaveBeenCalledTimes(1);
    const texts = sink.events.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toContain("noting peanuts as a severe allergy for Sam");
    expect(texts).toContain("which store do you shop at?");
    expect(reply!.confirmTasks.map((t) => t.taskId)).toContain(emitId); // a working turn confirms the fact-less emit
  });
});

describe("spec-01 Test Case 3: an empty working turn degrades cleanly (AC 4)", () => {
  it("emits no chatEvents", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "hmm");

    const { chef } = harness(true, []);
    const sink = new CollectingSink();
    await chef.respond(threadId, sink);

    expect(sink.events).toEqual([]);
  });
});

describe("spec-01 Test Case 4: a richlink send passes through (AC 2)", () => {
  it("puts a richlink event on the reply", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "give me a recipe");

    const { chef } = harness(true, [
      { type: "text", text: "here's a recipe" },
      { type: "richlink", url: "https://x/y" },
    ]);
    const sink = new CollectingSink();
    await chef.respond(threadId, sink);

    expect(sink.events).toContainEqual({ kind: "richlink", url: "https://x/y" });
  });
});

describe("Test Case 6: selectChef(db) returns StubChef offline (AC-6)", () => {
  const prev = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev;
  });

  it("no key → StubChef, respond returns a fixed non-null reply, no network", async () => {
    delete process.env.GEMINI_API_KEY;
    const { selectChef } = await import("../src/imessage/chef.js");
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "hello");

    const chef = selectChef(db);
    expect(chef).toBeInstanceOf(StubChef);
    const sink = new CollectingSink();
    const reply = await chef.respond(threadId, sink);
    expect(reply).not.toBeNull();
    expect(sink.events).toHaveLength(1); // the stub's one fixed bubble, sent live
    expect(reply!.cursorTo).toBe(newestId);
  });
});

/** Seeds an active onboarding objective with one required close emit; returns the ids. */
async function seedEmitObjective(threadId: string): Promise<{ objectiveId: string; emitId: string }> {
  const objectiveId = randomUUID();
  await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
  const emitId = randomUUID();
  await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });
  return { objectiveId, emitId };
}

/** A chef that fills the emit + pops the objective in-loop (as tasks__update now does) and reports it,
 *  so the consumer's commit should only advance the cursor. */
function poppingChef(text: string, emitId: string, objectiveId: string, cursorTo: string): Chef {
  return {
    respond: async (_threadId, sink): Promise<ChefReply> => {
      await sink.send({ kind: "text", text });
      // The in-loop tasks__update path: mark the emit filled + pop, in one txn.
      await db.transaction(async (tx) => {
        await ObjectiveRepository.create(db).applyTaskUpdates([{ taskId: emitId, status: "filled" }], tx);
        await ObjectiveRepository.create(db).completeAndPop(objectiveId, tx);
      });
      return { confirmTasks: [], cursorTo, objectiveId, delivered: true, popped: true };
    },
  };
}

describe("Test Case 5: onboarding completes via tasks__update, consumer only advances the cursor (AC-6, AC-7)", () => {
  it("the emit is filled + objective popped in-loop; the consumer runs no completeAndPop of its own", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "sounds good");
    const { objectiveId, emitId } = await seedEmitObjective(threadId);

    const chef = poppingChef("You're all set!", emitId, objectiveId, newestId);
    const popSpy = vi.spyOn(ObjectiveRepository.prototype, "completeAndPop");
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    // The chef popped in-loop (one completeAndPop, inside respond). The consumer added none of its own:
    // with the pop reported, the AC-8 fallback is skipped, so completeAndPop is called exactly once.
    expect(popSpy).toHaveBeenCalledTimes(1);
    popSpy.mockRestore();

    const [emit] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(emit!.status).toBe("filled");
    const [obj] = await db.select().from(objectives).where(eq(objectives.id, objectiveId));
    expect(obj!.status).toBe("complete");
    // The consumer's only commit is the cursor advance.
    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBe(newestId);
  });

  it("does NOT pop the objective when the reply delivered no bubbles (empty MAX_ATTEMPTS turn)", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "sounds good");
    const { objectiveId, emitId } = await seedEmitObjective(threadId);

    // An empty reply plan: no bubbles, nothing marked. AC-8 needs a delivered emit — it must not fire.
    const chef = sendingChef(
      [],
      { confirmTasks: [{ taskId: emitId, kind: "emit", status: "unasked" }], cursorTo: newestId, objectiveId },
    );
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    const [emit] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(emit!.status).toBe("unasked"); // nothing delivered → not filled
    const [obj] = await db.select().from(objectives).where(eq(objectives.id, objectiveId));
    expect(obj!.status).toBe("active"); // the close never sent → the objective must not pop
  });

  it("TC-6 safety net: a delivered but unmarked required emit still pops, with no duplicate bubbles on re-run (AC-8)", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "sounds good");
    const { objectiveId, emitId } = await seedEmitObjective(threadId);

    // The chef delivers the close but does NOT mark the emit via tasks__update (popped:false). The
    // consumer's AC-8 fallback must fill + pop so the terminal flow can't stall.
    const chef = sendingChef(
      [{ kind: "text", text: "You're all set!" }],
      { confirmTasks: [{ taskId: emitId, kind: "emit", status: "unasked" }], cursorTo: newestId, objectiveId, popped: false },
    );
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect((await db.select().from(tasks).where(eq(tasks.id, emitId)))[0]!.status).toBe("filled");
    expect((await db.select().from(objectives).where(eq(objectives.id, objectiveId)))[0]!.status).toBe("complete");
    expect(sender.calls).toHaveLength(1); // the one close bubble

    // Re-run on the same doorbell (cursor already advanced) — the sink dedupes; no new bubbles.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls).toHaveLength(1);
  });

  it("asks the fact-less explainer-ack when first delivered, fills it on the next inbound", async () => {
    const { threadId, ownerId } = await seedThread();
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const ackId = randomUUID();
    await db.insert(tasks).values({ id: ackId, objectiveId, kind: "elicit", fact: null, scope: "household", required: true, status: "unasked", solo: true });

    // The chef reports the ack's current status; the consumer asks-then-fills based on it.
    const chef: Chef = {
      respond: async (_threadId, sink): Promise<ChefReply | null> => {
        const [ack] = await db.select().from(tasks).where(eq(tasks.id, ackId));
        const pending = await ThreadRepository.create(db).loadPendingInbound(threadId, (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId);
        if (pending.length === 0) return null;
        await sink.send({ kind: "text", text: "here's how this works" });
        return {
          confirmTasks: [{ taskId: ackId, kind: "elicit", status: ack!.status }],
          cursorTo: pending[pending.length - 1]!.id,
          objectiveId,
          delivered: true,
          popped: false,
        };
      },
    };
    const consumer = new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock());

    // Turn 1: the explainer is delivered → the ack is asked (not yet filled).
    await seedInbound(threadId, ownerId, "hi");
    await consumer.handle({ threadId });
    expect((await db.select().from(tasks).where(eq(tasks.id, ackId)))[0]!.status).toBe("asked");

    // Turn 2: the user replies → the reply is the acknowledgment → the ack fills. Bump created_at a
    // second so this inbound deterministically sorts past turn 1's cursor (created_at is 1s-resolution).
    const g2 = randomUUID();
    await ThreadRepository.create(db).insertInboundMessage({ threadId, senderUserId: ownerId, type: "text", body: "got it, cool", messageGuid: g2 });
    await db.update(threadMessages).set({ createdAt: new Date(Date.now() + 1000) }).where(eq(threadMessages.messageGuid, g2));
    await consumer.handle({ threadId });
    expect((await db.select().from(tasks).where(eq(tasks.id, ackId)))[0]!.status).toBe("filled");
  });
});

// spec-02 Test Case 2 (load-bearing): mid-turn crash/resume sends exactly one of each and advances last.
describe("spec-02 Test Case 2: crash between two sends resumes with no double-send (AC 2)", () => {
  it("re-runs the turn on redelivery — exactly one of each bubble reaches the sender, cursor advances after", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "plan my week");

    // A chef that sends the ack, then on the FIRST invocation throws before the second send (the
    // crash between ack-commit and result); on the redelivery it sends both and returns cleanly.
    let firstRun = true;
    const chef: Chef = {
      respond: async (_threadId, sink): Promise<ChefReply> => {
        await sink.send({ kind: "text", text: "on it 🤔" }); // the ack — commits + sends live
        if (firstRun) {
          firstRun = false;
          throw new Error("crash after the ack, before the result");
        }
        await sink.send({ kind: "text", text: "here's your week" }); // the result — second send
        return { confirmTasks: [], cursorTo: newestId, objectiveId: "", delivered: true, popped: false };
      },
    };
    const sender = new StubSpectrumSender();
    const consumer = new Consumer(db, sender, chef, new StubThreadLock());

    // Run 1 crashes after the ack row committed + sent; the cursor must stay unmoved.
    await expect(consumer.handle({ threadId })).rejects.toThrow("crash after the ack");
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBeNull();
    expect(sender.calls.map((c) => c.body)).toEqual(["on it 🤔"]); // only the ack went out so far

    // Run 2 (redelivery on the same doorbell): the ack is deduped (skipped), the result sends.
    await consumer.handle({ threadId });

    // Across both runs the sender received exactly one ack and one result — no double-ack.
    expect(sender.calls.map((c) => c.body)).toEqual(["on it 🤔", "here's your week"]);
    // Cursor advanced only after the full turn completed.
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBe(newestId);
  });
});

// spec-02 Test Case 3: every outbound row carries trigger_id = the inbound that caused the turn.
describe("spec-02 Test Case 3: outbound rows are tagged with trigger_id (AC 3)", () => {
  it("tags each live-sent row with the trigger inbound id", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "hi");
    const chef = sendingChef(
      [{ kind: "text", text: "hey!" }, { kind: "text", text: "what's cooking?" }],
      { confirmTasks: [], cursorTo: newestId, objectiveId: "" },
    );
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(2);
    expect(outbound.every((r) => r.triggerId === newestId)).toBe(true); // both tagged with the trigger
    // The deterministic dedup guids: `${triggerId}#0`, `${triggerId}#1`.
    expect(outbound.map((r) => r.messageGuid).sort()).toEqual([`${newestId}#0`, `${newestId}#1`]);
  });
});

// ── TC-4/7: the drain loop kicks off the next objective after a pop ────────────

/** Seeds a two-objective stack on `threadId`: objective A active (one required elicit) and objective
 *  B suspended (one required emit). Returns their ids. */
async function seedTwoObjectiveStack(threadId: string): Promise<{ objA: string; taskA: string; objB: string }> {
  const store = ObjectiveRepository.create(db);
  const a = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "a", kind: "elicit", fact: "household.grocery_stores", factType: "GROCERY_STORE", scope: "household", required: true }], position: "top" });
  const b = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "bottom" });
  const [taskA] = await db.select().from(tasks).where(eq(tasks.objectiveId, a.id));
  return { objA: a.id, taskA: taskA!.id, objB: b.id };
}

/** A stateful chef: turn 1 (inbound) pops objective A; the kick-off turn (no inbound) sends one
 *  bubble against B and leaves it active. Records the sinks it saw and each turn's pending state. */
function chainingChef(taskA: string, objA: string, cursorTo: string): { chef: Chef; turns: { kickOff: boolean }[] } {
  const turns: { kickOff: boolean }[] = [];
  const chef: Chef = {
    respond: async (threadId, sink): Promise<ChefReply | null> => {
      const store = ObjectiveRepository.create(db);
      const active = await store.loadActive(threadId);
      if (!active) return null;
      const kickOff = active.objective.id !== objA; // A is gone once popped → this is the B kick-off
      turns.push({ kickOff });
      if (!kickOff) {
        // Turn 1: fill A's last task + pop (as tasks__update does), report popped.
        await sink.send({ kind: "text", text: "got it" });
        await db.transaction(async (tx) => {
          await store.applyTaskUpdates([{ taskId: taskA, status: "filled" }], tx);
          await store.completeAndPop(objA, tx);
        });
        return { confirmTasks: [], cursorTo, objectiveId: objA, delivered: true, popped: true };
      }
      // Kick-off turn: send B's opener, leave B active (no pop). No inbound consumed → cursorTo null.
      await sink.send({ kind: "text", text: "here's your first menu" });
      return { confirmTasks: [], cursorTo: null, objectiveId: active.objective.id, delivered: true, popped: false };
    },
  };
  return { chef, turns };
}

describe("TC-4: drain loop runs a triggerless kick-off after a pop (AC-4, AC-5)", () => {
  it("two turns from one inbound: pop A, kick off B, then park; cursor sits at the inbound", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "we shop at kroger");
    const { objA, taskA, objB } = await seedTwoObjectiveStack(threadId);

    const { chef, turns } = chainingChef(taskA, objA, newestId);
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    expect(turns).toEqual([{ kickOff: false }, { kickOff: true }]); // exactly two turns; turn 2 a kick-off
    expect((await db.select().from(objectives).where(eq(objectives.id, objA)))[0]!.status).toBe("complete");
    expect((await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!.status).toBe("active");
    // The loop stopped after B parked; the cursor sits at the single inbound.
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBe(newestId);
  });
});

describe("TC-7: kick-off sends key on the objective id; redelivery is a clean no-op (AC-9, AC-10)", () => {
  it("B's kick-off guid is `${objectiveB.id}#0` with a null trigger; a same-doorbell redelivery sends nothing new", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "we shop at kroger");
    const { objA, taskA, objB } = await seedTwoObjectiveStack(threadId);

    const { chef } = chainingChef(taskA, objA, newestId);
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    // B's kick-off bubble is keyed on the objective id (no inbound trigger to key on) — AC-9.
    const kickOffRows = (await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).filter((r) => r.messageGuid.startsWith(`${objB}#`));
    expect(kickOffRows).toHaveLength(1);
    expect(kickOffRows[0]!.messageGuid).toBe(`${objB}#0`);
    expect(kickOffRows[0]!.triggerId).toBeNull(); // a kick-off row carries no trigger id
    const sentBefore = sender.calls.length;

    // Redelivery on the same doorbell after a full pass: the cursor advanced and A's inbound is
    // consumed, so the drain loop finds nothing pending and no fresh pop — it commits nothing. AC-10:
    // no duplicate bubbles, B stays active, the cursor stays advanced.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls.length).toBe(sentBefore); // no duplicate sends
    expect((await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!.status).toBe("active");
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBe(newestId);
  });
});

describe("TC-4: onboarding pops into the first_meal_plan kick-off (AC-5)", () => {
  it("kick-off runs against first_meal_plan; its definition lists the mealplan tools", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "that's everything, thanks");
    const store = ObjectiveRepository.create(db);
    // The new seeding path: onboarding active (one required task), first_meal_plan suspended below it.
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    await store.pushObjective({ threadId, definition: "first_meal_plan", tasks: firstMealPlanTaskSpecs(), position: "bottom" });
    const [closeTask] = await db.select().from(tasks).where(eq(tasks.objectiveId, onboarding.id));

    const kickOffObjectives: string[] = [];
    const chef: Chef = {
      respond: async (tid, sink): Promise<ChefReply | null> => {
        const active = (await store.loadActive(tid))!;
        if (active.objective.definition === "onboarding") {
          await sink.send({ kind: "text", text: "all set" });
          await db.transaction(async (tx) => {
            await store.applyTaskUpdates([{ taskId: closeTask!.id, status: "filled" }], tx);
            await store.completeAndPop(onboarding.id, tx);
          });
          return { confirmTasks: [], cursorTo: newestId, objectiveId: onboarding.id, delivered: true, popped: true };
        }
        kickOffObjectives.push(active.objective.definition); // the kick-off turn ran against this objective
        await sink.send({ kind: "text", text: "here's your first menu" });
        return { confirmTasks: [], cursorTo: null, objectiveId: active.objective.id, delivered: true, popped: false };
      },
    };

    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    expect(kickOffObjectives).toEqual(["first_meal_plan"]); // onboarding popped straight into it
    const def = objectiveDefinition("first_meal_plan")!;
    for (const id of ["mealplan__generate", "mealplan__slot_options", "mealplan__add_recipe_to_slot", "mealplan__remove_recipe_from_slot"])
      expect(def.tools).toContain(id);
  });
});

/**
 * A chef that pops A in turn 1, then CRASHES on its first B kick-off (before B's opener sends), and on
 * any later kick-off delivers B's opener. Mirrors chainingChef's pop, with a one-shot crash injected
 * between the pop and the opener — the exact window the kickoff-pending marker recovers (spec AC-7).
 */
function crashingKickoffChef(taskA: string, objA: string, objB: string, cursorTo: string): { chef: Chef; crashed: () => boolean } {
  let firstKickoff = true;
  const chef: Chef = {
    respond: async (threadId, sink): Promise<ChefReply | null> => {
      const store = ObjectiveRepository.create(db);
      const active = await store.loadActive(threadId);
      if (!active) return null;
      if (active.objective.id === objA) {
        await sink.send({ kind: "text", text: "got it" });
        await db.transaction(async (tx) => {
          await store.applyTaskUpdates([{ taskId: taskA, status: "filled" }], tx);
          await store.completeAndPop(objA, tx); // stamps B with the kickoff-pending marker
        });
        return { confirmTasks: [], cursorTo, objectiveId: objA, delivered: true, popped: true };
      }
      // B's kick-off. Crash once before delivering — the opener never sends, B is stranded with its marker.
      if (firstKickoff) { firstKickoff = false; throw new Error("crash before B's kick-off delivers"); }
      await sink.send({ kind: "text", text: "here's your first menu" });
      return { confirmTasks: [], cursorTo: null, objectiveId: active.objective.id, delivered: true, popped: false };
    },
  };
  return { chef, crashed: () => !firstKickoff };
}

describe("TC-6: a stranded kick-off recovers via the marker (AC-7)", () => {
  it("crash mid-kick-off → redeliver re-enters via the marker, delivers B's opener once, clears it; a third handle no-ops", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "we shop at kroger");
    const { objA, taskA, objB } = await seedTwoObjectiveStack(threadId);

    const { chef } = crashingKickoffChef(taskA, objA, objB, newestId);
    const sender = new StubSpectrumSender();

    // Handle #1: pop A, then crash before B's opener — A committed, B active + marker set, opener unsent.
    await expect(new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId })).rejects.toThrow("crash before");
    expect((await db.select().from(objectives).where(eq(objectives.id, objA)))[0]!.status).toBe("complete");
    const bAfterCrash = (await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!;
    expect(bAfterCrash.status).toBe("active");
    expect((bAfterCrash.context as { kickoffPendingAt?: string } | null)?.kickoffPendingAt).toBeDefined();
    const openerRowsBefore = (await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).filter((r) => r.messageGuid.startsWith(`${objB}#`));
    expect(openerRowsBefore).toHaveLength(0); // the opener never went out

    // Handle #2 (bare redelivery): no pending inbound, no fresh pop — the MARKER re-enters the kick-off.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    const openerRows = (await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).filter((r) => r.messageGuid.startsWith(`${objB}#`));
    expect(openerRows).toHaveLength(1); // opener delivered exactly once, keyed on B's objective id
    expect(openerRows[0]!.messageGuid).toBe(`${objB}#0`);
    const bRecovered = (await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!;
    expect((bRecovered.context as { kickoffPendingAt?: string } | null)?.kickoffPendingAt).toBeUndefined(); // marker cleared
    const sentAfterRecovery = sender.calls.length;

    // Handle #3 (another bare doorbell): marker cleared, nothing pending → a clean no-op.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls.length).toBe(sentAfterRecovery); // no duplicate opener
    expect((await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!.status).toBe("active");
  });
});

// ── WI-02: the heartbeat arm — a bare doorbell nudges quiet asks / asks eligible unasked tasks ──

import { FOLLOW_UP_LADDER } from "../src/imessage/heartbeat.js";
import type { HeartbeatIntent } from "../src/imessage/chef.js";

/** Seeds an active onboarding objective with one `asked` elicit whose `nudged_at` is `agoMs` in the
 *  past at `follow_ups_sent = 0`, so the heartbeat's first rung governs due-ness. Returns its id. */
async function seedAskedTask(threadId: string, agoMs: number): Promise<{ objectiveId: string; taskId: string }> {
  const objectiveId = randomUUID();
  await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
  const taskId = randomUUID();
  await db.insert(tasks).values({
    id: taskId, objectiveId, kind: "elicit", fact: "household.grocery_stores", scope: "household",
    required: true, status: "asked", followUpsSent: 0, nudgedAt: new Date(Date.now() - agoMs),
  });
  return { objectiveId, taskId };
}

/** A chef that captures the heartbeat intent it was handed, sends one bubble, and reports a delivered
 *  no-pop reply (a nudge doesn't fill or complete anything). `objectiveId` keys the reply. */
function nudgingChef(objectiveId: string): { chef: Chef; intents: (HeartbeatIntent | undefined)[] } {
  const intents: (HeartbeatIntent | undefined)[] = [];
  const chef: Chef = {
    respond: async (_threadId, sink, heartbeat): Promise<ChefReply> => {
      intents.push(heartbeat);
      await sink.send({ kind: "text", text: "hey, still hoping to hear back on that" });
      return { confirmTasks: [], cursorTo: null, objectiveId, delivered: true, popped: false };
    },
  };
  return { chef, intents };
}

describe("WI-02 TC-2: a quiet ask past its rung produces a nudge that commits ladder state (AC-5)", () => {
  it("chef gets the heartbeat intent, guid prefix is <objectiveId>:hb:<taskId>:1, follow_ups_sent→1 + nudged_at≈now", async () => {
    const { threadId } = await seedThread();
    const { objectiveId, taskId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000); // 6m ago, rung is 5m

    const { chef, intents } = nudgingChef(objectiveId);
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(intents).toEqual([{ taskIds: [taskId] }]); // the chef was told which task to follow up on
    expect(sender.calls).toHaveLength(1); // one nudge bubble

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(outbound[0]!.messageGuid).toBe(`${objectiveId}:hb:${taskId}:1#0`); // deterministic heartbeat guid
    expect(outbound[0]!.triggerId).toBeNull(); // no inbound trigger

    const [after] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.followUpsSent).toBe(1); // ladder advanced
    expect(after!.nudgedAt!.getTime()).toBeGreaterThan(Date.now() - 5_000); // re-stamped to ~now
  });
});

describe("WI-02 TC-3: an eligible unasked task triggers an ask turn (AC-6, AC-3)", () => {
  it("chef gets the intent naming B; B ends asked with nudged_at stamped; follow_ups_sent stays 0", async () => {
    const { threadId } = await seedThread();
    // Task A filled, task B unasked gated on A → loadActive returns only B (eligible).
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const aId = randomUUID();
    const bId = randomUUID();
    await db.insert(tasks).values({ id: aId, objectiveId, kind: "elicit", fact: "household.cook_days", scope: "household", required: true, status: "filled" });
    await db.insert(tasks).values({ id: bId, objectiveId, kind: "elicit", fact: "household.grocery_stores", scope: "household", required: true, status: "unasked", afterTaskIds: [aId] });

    // A chef that asks B: flips it to `asked` via the shared applyTaskUpdates chokepoint (which stamps
    // nudged_at, AC-3), sends its opener, reports the intent it saw.
    const intents: (HeartbeatIntent | undefined)[] = [];
    const chef: Chef = {
      respond: async (_tid, sink, heartbeat): Promise<ChefReply> => {
        intents.push(heartbeat);
        await sink.send({ kind: "text", text: "one more thing — where do you shop?" });
        await db.transaction((tx) => ObjectiveRepository.create(db).applyTaskUpdates([{ taskId: bId, status: "asked" }], tx));
        return { confirmTasks: [], cursorTo: null, objectiveId, delivered: true, popped: false };
      },
    };
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    expect(intents[0]).toEqual({ taskIds: [bId] }); // only B is actionable
    const [b] = await db.select().from(tasks).where(eq(tasks.id, bId));
    expect(b!.status).toBe("asked");
    expect(b!.nudgedAt).not.toBeNull(); // AC-3: the asked flip stamped nudged_at
    expect(b!.followUpsSent).toBe(0); // arm-2 doesn't touch the ladder counter
  });
});

describe("WI-04: an eligible unasked emit heartbeat-fires and delivers (arm 2 includes emits)", () => {
  it("chef gets the intent naming the emit; delivery rides a stable guid scope; ladder untouched", async () => {
    const { threadId } = await seedThread();
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const emitId = randomUUID();
    await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });

    const intents: (HeartbeatIntent | undefined)[] = [];
    const chef: Chef = {
      respond: async (_tid, sink, heartbeat): Promise<ChefReply> => {
        intents.push(heartbeat);
        await sink.send({ kind: "text", text: "here's your plan for the week!" });
        await db.transaction((tx) => ObjectiveRepository.create(db).applyTaskUpdates([{ taskId: emitId, status: "filled" }], tx));
        return { confirmTasks: [], cursorTo: null, objectiveId, delivered: true, popped: false };
      },
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(intents[0]).toEqual({ taskIds: [emitId] });
    expect(sender.calls).toHaveLength(1);
    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound[0]!.messageGuid).toBe(`${objectiveId}#0`); // emits ride the kick-off's objective scope
    const [after] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(after!.status).toBe("filled");
    expect(after!.followUpsSent).toBe(0);
  });

  it("a retry after a crashed attempt swallows the duplicate silently and still marks the emit done", async () => {
    const { threadId } = await seedThread();
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const emitId = randomUUID();
    await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });
    const sender = new StubSpectrumSender();

    // Crashed attempt: the bubble journals + sends live, then the turn dies before any commit —
    // the emit is delivered on the phone but still `unasked` in the DB.
    const crashingChef: Chef = {
      respond: async (_tid, sink): Promise<ChefReply | null> => {
        await sink.send({ kind: "text", text: "here's your plan for the week!" });
        return null;
      },
    };
    await new Consumer(db, sender, crashingChef, new StubThreadLock()).handle({ threadId });
    expect(sender.calls).toHaveLength(1); // went out before the "crash"

    // The crashed send counts as conversational activity — age it past the quiet gate so the
    // retry beat (which in production lands ≥5m later) is allowed to run.
    await db.update(threadMessages).set({ createdAt: new Date(Date.now() - 6 * 60_000) });

    // Retry beat: same unasked emit → same guid scope → the send is swallowed, the turn continues,
    // and the emit gets marked done.
    const retryChef: Chef = {
      respond: async (_tid, sink): Promise<ChefReply> => {
        await sink.send({ kind: "text", text: "here's your plan for the week!" });
        await db.transaction((tx) => ObjectiveRepository.create(db).applyTaskUpdates([{ taskId: emitId, status: "filled" }], tx));
        return { confirmTasks: [], cursorTo: null, objectiveId, delivered: true, popped: false };
      },
    };
    await new Consumer(db, sender, retryChef, new StubThreadLock()).handle({ threadId });

    expect(sender.calls).toHaveLength(1); // the duplicate was swallowed — exactly one bubble ever
    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1); // one journal row, not two
    const [after] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(after!.status).toBe("filled"); // the retry still marked it done
  });
});

describe("WI-05: a delivered-but-unadvanced attempt rotates the guid scope (deadlock regression)", () => {
  it("attempt 1 counts against a task the model didn't advance; attempt 2 gets a fresh scope and delivers", async () => {
    const { threadId } = await seedThread();
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const taskId = randomUUID();
    await db.insert(tasks).values({ id: taskId, objectiveId, kind: "elicit", fact: "household.goals", scope: "household", required: true, status: "unasked" });

    // A chef that speaks but never advances the task (the live-test shape: it asked a question
    // without marking anything).
    const chattyChef: Chef = {
      respond: async (_tid, sink): Promise<ChefReply> => {
        await sink.send({ kind: "text", text: "what are you hoping to get out of meal planning?" });
        return { confirmTasks: [], cursorTo: null, objectiveId, delivered: true, popped: false };
      },
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chattyChef, new StubThreadLock()).handle({ threadId });

    let [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(t!.followUpsSent).toBe(1); // the attempt counted even though the task didn't advance
    expect(t!.nudgedAt).not.toBeNull();
    let outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound[0]!.messageGuid).toBe(`${objectiveId}:hb:${taskId}:1#0`);

    // Quiet out rung 1, beat again: the scope is now :2 — the bubble DELIVERS instead of being
    // swallowed by attempt 1's guid (the deadlock this test pins).
    await db.update(threadMessages).set({ createdAt: new Date(Date.now() - FOLLOW_UP_LADDER[1] - 60_000) });
    await db.update(tasks).set({ nudgedAt: new Date(Date.now() - FOLLOW_UP_LADDER[1] - 60_000) }).where(eq(tasks.id, taskId));
    await new Consumer(db, sender, chattyChef, new StubThreadLock()).handle({ threadId });

    expect(sender.calls).toHaveLength(2); // both attempts reached the household
    outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound.map((o) => o.messageGuid).sort()).toEqual([`${objectiveId}:hb:${taskId}:1#0`, `${objectiveId}:hb:${taskId}:2#0`].sort());
    [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(t!.followUpsSent).toBe(2);
  });
});

describe("WI-05: the heartbeat only speaks into silence", () => {
  it("a beat during an active conversation is a silent no-op even with actionable work", async () => {
    const { threadId } = await seedThread();
    const { objectiveId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000); // due at rung 1
    // The bot replied seconds ago — the household is mid-conversation.
    await db.insert(threadMessages).values({
      id: randomUUID(),
      threadId,
      direction: "outbound",
      type: "text",
      body: "sounds great!",
      messageGuid: `${randomUUID()}#0`,
    });

    const { chef } = nudgingChef(objectiveId);
    const respondSpy = vi.spyOn(chef, "respond");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(respondSpy).not.toHaveBeenCalled();
    expect(sender.calls).toHaveLength(0);
  });

  it("the same beat fires once the last message is a full rung old", async () => {
    const { threadId } = await seedThread();
    const { objectiveId, taskId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000);
    await db.insert(threadMessages).values({
      id: randomUUID(),
      threadId,
      direction: "outbound",
      type: "text",
      body: "sounds great!",
      messageGuid: `${randomUUID()}#0`,
      createdAt: new Date(Date.now() - FOLLOW_UP_LADDER[0] - 60_000), // quiet for 6m
    });

    const { chef, intents } = nudgingChef(objectiveId);
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(intents).toEqual([{ taskIds: [taskId] }]);
    expect(sender.calls).toHaveLength(1);
  });
});

describe("WI-02 TC-4: nothing actionable → silent no-op (AC-4)", () => {
  it("an ask nudged 1 minute ago never invokes the chef, sends nothing, changes nothing", async () => {
    const { threadId } = await seedThread();
    const { objectiveId, taskId } = await seedAskedTask(threadId, 60_000); // 1m ago, well under the 5m rung

    const { chef, intents } = nudgingChef(objectiveId);
    const respondSpy = vi.spyOn(chef, "respond");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(respondSpy).not.toHaveBeenCalled();
    expect(intents).toEqual([]);
    expect(sender.calls).toHaveLength(0);
    const [after] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.followUpsSent).toBe(0);
  });
});

describe("WI-02 TC-5: pending inbound wins over a heartbeat (AC-8)", () => {
  it("a normal turn runs against the inbound; the ladder is untouched by that iteration", async () => {
    const { threadId, ownerId } = await seedThread();
    const { objectiveId, taskId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000);
    const newestId = await seedInbound(threadId, ownerId, "kroger, actually");

    // A chef that expects a NORMAL turn: no heartbeat intent, advances the cursor to the inbound.
    const intents: (HeartbeatIntent | undefined)[] = [];
    const chef: Chef = {
      respond: async (_tid, sink, heartbeat): Promise<ChefReply> => {
        intents.push(heartbeat);
        await sink.send({ kind: "text", text: "got it, kroger" });
        return { confirmTasks: [], cursorTo: newestId, objectiveId, delivered: true, popped: false };
      },
    };
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    expect(intents[0]).toBeUndefined(); // pending wins → a normal turn, no heartbeat intent
    const [after] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.followUpsSent).toBe(0); // the ladder wasn't advanced by the inbound turn
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBe(newestId);
  });
});

describe("WI-02 TC-6: redelivery is idempotent (AC-7)", () => {
  it("a second bare doorbell after a committed nudge finds the ask no longer due → silent no-op", async () => {
    const { threadId } = await seedThread();
    const { objectiveId, taskId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000);

    const { chef } = nudgingChef(objectiveId);
    const respondSpy = vi.spyOn(chef, "respond");
    const sender = new StubSpectrumSender();

    // First doorbell: nudge sent, follow_ups_sent→1, nudged_at re-stamped to ~now.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(respondSpy).toHaveBeenCalledTimes(1);
    expect(sender.calls).toHaveLength(1);

    // Second doorbell, clock effectively unchanged: at rung 1 (30m) the ask isn't due → no-op.
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });
    expect(respondSpy).toHaveBeenCalledTimes(1); // chef not re-invoked
    expect(sender.calls).toHaveLength(1); // no new bubble
    const [after] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.followUpsSent).toBe(1); // state unchanged
  });
});

describe("WI-02 TC-7: a silent chef leaves ladder state unchanged, attempt bounded (AC-9)", () => {
  it("chef returns null → no commit, follow_ups_sent stays 0, invoked exactly once for the objective", async () => {
    const { threadId } = await seedThread();
    const { taskId } = await seedAskedTask(threadId, FOLLOW_UP_LADDER[0] + 60_000);

    // A chef that stays silent every time — the bounding set must stop a re-entry within one handle().
    const chef: Chef = { respond: async () => null };
    const respondSpy = vi.spyOn(chef, "respond");
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    expect(respondSpy).toHaveBeenCalledTimes(1); // one attempt per objective per handle()
    const [after] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(after!.followUpsSent).toBe(0); // no commit on a silent turn
  });
});

describe("F1: a silent kick-off turn (tool work, no bubble) terminates instead of spinning", () => {
  it("attempts the marker-carrying objective once per handle(), leaves the marker set for a later doorbell", async () => {
    const { threadId, ownerId } = await seedThread();
    await seedInbound(threadId, ownerId, "hi"); // consumed by the pop turn so the kick-off has no pending inbound
    const { objA, taskA, objB } = await seedTwoObjectiveStack(threadId);
    const [inbound] = await db.select().from(threadMessages).where(eq(threadMessages.direction, "inbound"));

    // Chef: pop A (stamps B's marker), then every B kick-off does silent tool work — never sends, never pops.
    let respondsForB = 0;
    const chef: Chef = {
      respond: async (tid, sink): Promise<ChefReply | null> => {
        const store = ObjectiveRepository.create(db);
        const active = (await store.loadActive(tid))!;
        if (active.objective.id === objA) {
          await sink.send({ kind: "text", text: "got it" });
          await db.transaction(async (tx) => {
            await store.applyTaskUpdates([{ taskId: taskA, status: "filled" }], tx);
            await store.completeAndPop(objA, tx);
          });
          return { confirmTasks: [], cursorTo: inbound!.id, objectiveId: objA, delivered: true, popped: true };
        }
        respondsForB++; // a silent turn: tool work happened but no bubble shipped, nothing popped
        return { confirmTasks: [], cursorTo: null, objectiveId: active.objective.id, delivered: false, popped: false };
      },
    };

    // handle() #1: pops A, attempts B's kick-off once, sees no delivery → terminates (no spin).
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });
    expect(respondsForB).toBe(1); // B's kick-off attempted exactly once — the spin is gone
    const bAfter = (await db.select().from(objectives).where(eq(objectives.id, objB)))[0]!;
    expect(bAfter.status).toBe("active");
    expect((bAfter.context as { kickoffPendingAt?: string } | null)?.kickoffPendingAt).toBeDefined(); // marker RETAINED

    // A later doorbell re-enters via the retained marker and attempts once more.
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });
    expect(respondsForB).toBe(2);
  });
});

// ── chef-steady-state WI-01: onboarding seeds once; empty stack = all tools, no objective ──────────

/** An agent that captures the turn it ran against and builds the turn's tools for its objective
 *  definition — so a test can assert which tools a steady-state turn offers. Sends one bubble. */
function capturingAgent(): { agent: ChefAgent; turns: ChefTurn[]; toolIds: string[][] } {
  const turns: ChefTurn[] = [];
  const toolIds: string[][] = [];
  const agent: ChefAgent = {
    run: async (turn, db2) => {
      turns.push(turn);
      const def = objectiveDefinition(turn.briefing.objective.definition)!;
      toolIds.push(buildTools(turn.ctx, db2, def.tools).map((t) => t.id));
      await turn.send({ kind: "text", text: "what do you need?" });
      return { worked: false };
    },
  };
  return { agent, turns, toolIds };
}

/** Marks a pushed objective complete (fills its one task + pop), emptying it off the stack. */
async function completeObjective(objectiveId: string): Promise<void> {
  const store = ObjectiveRepository.create(db);
  await db.transaction(async (tx) => {
    for (const t of await db.select().from(tasks).where(eq(tasks.objectiveId, objectiveId)))
      await store.applyTaskUpdates([{ taskId: t.id, status: "filled" }], tx);
    await store.completeAndPop(objectiveId, tx);
  });
}

describe("WI-01 TC-1: first contact still seeds onboarding + first_meal_plan (AC-1)", () => {
  it("a fresh thread (zero objectives) + inbound seeds onboarding active, first_meal_plan suspended", async () => {
    const { threadId, ownerId } = await seedThread(); // no objectives seeded
    await seedInbound(threadId, ownerId, "hi");

    const chef = new RealChef(db, new ScriptedChefAgent({ mutate: false, send: [{ type: "text", text: "hey!" }] }), ObjectiveRepository.create(db), ThreadRepository.create(db), HouseholdRepository.create(db));
    await chef.respond(threadId, new CollectingSink());

    const rows = await db.select().from(objectives).where(eq(objectives.threadId, threadId));
    const byDef = Object.fromEntries(rows.map((r) => [r.definition, r.status]));
    expect(byDef).toEqual({ onboarding: "active", first_meal_plan: "suspended" });
  });
});

describe("WI-01 TC-2: steady state answers with all tools, seeds nothing (AC-2, AC-3)", () => {
  it("all objectives terminal + inbound → the full factory tool set, no new objectives, reply commits", async () => {
    const { threadId, ownerId } = await seedThread();
    const store = ObjectiveRepository.create(db);
    // Complete onboarding and first_meal_plan → the stack is empty but the thread has history.
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    const fmp = await store.pushObjective({ threadId, definition: "first_meal_plan", tasks: [{ key: "gen", kind: "emit", scope: "household", required: true }], position: "bottom" });
    await completeObjective(onboarding.id);
    await completeObjective(fmp.id);
    expect(await store.loadActive(threadId)).toBeNull(); // empty stack

    const objectivesBefore = (await db.select().from(objectives).where(eq(objectives.threadId, threadId))).length;
    const newestId = await seedInbound(threadId, ownerId, "what do we need at the store?");

    const { agent, turns, toolIds } = capturingAgent();
    const chef = new RealChef(db, agent, store, ThreadRepository.create(db), HouseholdRepository.create(db));
    const reply = await chef.respond(threadId, new CollectingSink());

    // Ran the steady-state shell, with EVERY registered factory tool built for the turn.
    expect(turns).toHaveLength(1);
    expect(turns[0]!.briefing.objective.definition).toBe(steadyStateObjective.id);
    expect(toolIds[0]!.sort()).toEqual([...FACTORY_IDS].sort()); // grocery__*, mealplan__*, facts__*, tasks__update…
    // No objective row was seeded; the reply has a null objectiveId and advances the cursor.
    expect((await db.select().from(objectives).where(eq(objectives.threadId, threadId))).length).toBe(objectivesBefore);
    expect(reply!.objectiveId).toBeNull();
    expect(reply!.popped).toBe(false);
    expect(reply!.cursorTo).toBe(newestId);
  });

  it("the consumer commits a steady-state turn end to end: bubble sent, cursor advanced, no throw", async () => {
    const { threadId, ownerId } = await seedThread();
    const store = ObjectiveRepository.create(db);
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    await completeObjective(onboarding.id);
    const newestId = await seedInbound(threadId, ownerId, "hey");

    // A steady-state reply: no objective, no confirms — the consumer must commit it null-safe.
    const chef = sendingChef([{ kind: "text", text: "hi there" }], { confirmTasks: [], cursorTo: newestId, objectiveId: null });
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(sender.calls).toHaveLength(1);
    expect((await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId).toBe(newestId);
    // Still no objective on the thread — the steady-state turn seeded nothing.
    expect(await store.loadActive(threadId)).toBeNull();
  });
});

describe("WI-01 TC-3: steady-state reminders fire; a bare heartbeat is quiet (AC-4)", () => {
  it("a due dinner reminder on a steady-state thread still fires", async () => {
    const { threadId, ownerId } = await seedThread();
    const store = ObjectiveRepository.create(db);
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    await completeObjective(onboarding.id); // empty stack
    // A due dinner reminder + a planned dinner for today.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    await db.transaction((tx) => ReminderRepository.create(db).upsertCourseReminder(threadId, "dinner", "30 16 * * *", new Date(Date.now() - 60_000), false, "UTC", tx));
    const recipeId = await RecipeRepository.create(db).persist(RECIPE, ownerId);
    await MealPlanService.create(db).add(ownerId, today, "dinner", recipeId, "generated");

    const intents: (ReminderIntent | undefined)[] = [];
    const chef: Chef = {
      respond: async (_tid, sink, _hb, reminder): Promise<ChefReply> => {
        intents.push(reminder);
        await sink.send({ kind: "text", text: `tonight: ${reminder?.recipes[0]?.title}` });
        return { confirmTasks: [], cursorTo: null, objectiveId: null, delivered: true, popped: false };
      },
    };
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(intents).toHaveLength(1);
    expect(intents[0]!.meal).toBe("dinner");
    expect(sender.calls).toHaveLength(1);
  });

  it("a bare heartbeat doorbell on a steady-state thread is a silent no-op (loadActive null)", async () => {
    const { threadId } = await seedThread();
    const store = ObjectiveRepository.create(db);
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    await completeObjective(onboarding.id); // empty stack, no reminders, no pending inbound

    const chef: Chef = { respond: async () => null };
    const respondSpy = vi.spyOn(chef, "respond");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId });

    expect(respondSpy).not.toHaveBeenCalled(); // no active objective → the heartbeat arm never fires
    expect(sender.calls).toHaveLength(0);
  });
});

describe("WI-01 TC-5: repair script removes re-seeds after a completed onboarding (AC-6)", () => {
  it("deletes the fresh onboarding + fmp (and their tasks), leaves terminal history; second run is a no-op", async () => {
    const { threadId } = await seedThread();
    const store = ObjectiveRepository.create(db);
    // The live-bug shape: onboarding completed, first_meal_plan completed, then a bogus re-seed of a
    // fresh active onboarding + suspended first_meal_plan (created AFTER the onboarding completion).
    const onboarding = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    const fmp = await store.pushObjective({ threadId, definition: "first_meal_plan", tasks: [{ key: "gen", kind: "emit", scope: "household", required: true }], position: "bottom" });
    await completeObjective(onboarding.id);
    await completeObjective(fmp.id);
    // The re-seed (what loadTurn used to do). Force createdAt well after the completion so the 1s-
    // resolution timestamp comparison is deterministic (in production it's a much-later inbound).
    const later = new Date(Date.now() + 60_000);
    const reseedOnb = await store.pushObjective({ threadId, definition: "onboarding", tasks: [{ key: "close", kind: "emit", scope: "household", required: true }], position: "top" });
    const reseedFmp = await store.pushObjective({ threadId, definition: "first_meal_plan", tasks: [{ key: "gen", kind: "emit", scope: "household", required: true }], position: "bottom" });
    await db.update(objectives).set({ createdAt: later }).where(inArray(objectives.id, [reseedOnb.id, reseedFmp.id]));

    const { repairReseededThreads } = await import("../src/chef/repair-reseeded-threads.js");
    const deleted = await repairReseededThreads(db);

    expect(deleted.map((d) => d.objectiveId).sort()).toEqual([reseedOnb.id, reseedFmp.id].sort());
    // The two fresh rows are gone, their tasks cascaded; the terminal history remains.
    const remaining = await db.select().from(objectives).where(eq(objectives.threadId, threadId));
    expect(remaining.map((r) => r.id).sort()).toEqual([onboarding.id, fmp.id].sort());
    expect(remaining.every((r) => r.status === "complete")).toBe(true);
    expect(await db.select().from(tasks).where(inArray(tasks.objectiveId, [reseedOnb.id, reseedFmp.id]))).toHaveLength(0);

    // Idempotent: a second run finds nothing to delete.
    expect(await repairReseededThreads(db)).toHaveLength(0);
  });
});
