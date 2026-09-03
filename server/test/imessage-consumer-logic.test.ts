import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pendingPast } from "../src/imessage/consumer-logic.js";
import { Consumer } from "../src/imessage/consumer.js";
import { RealChef, StubChef, type Chef, type ChefReply } from "../src/imessage/chef.js";
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubThreadLock } from "../src/imessage/lock.js";
import { ObjectiveRepository } from "../src/chef/objective-repository.js";
import { ThreadRepository } from "../src/repositories/thread-repository.js";
import { HouseholdRepository } from "../src/repositories/household-repository.js";
import { ScriptedReasoner } from "../src/chef/reasoning-agent.js";
import { ScriptedResponder } from "../src/chef/response-agent.js";
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
    const { threadId, ownerId } = await seedThread(["household.grocery_stores", "household.cook_days_count"]);
    await seedInbound(threadId, ownerId, "we shop at kroger");
    const newestId = await seedInbound(threadId, ownerId, "and cook 5 nights");

    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;
    // Task fills happen through the in-loop update_tasks tool now, not via ChefReply; the consumer
    // just commits the bubbles, confirms any fact-less tasks, and advances the cursor.
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [
          { kind: "text", text: "Kroger, nice." },
          { kind: "text", text: "Five nights it is." },
        ],
        confirmTasks: [],
        cursorTo: newestId,
        objectiveId: active.objective.id,
      }),
    };
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

describe("Test Case 4: commit is atomic — a failing task update rolls back the rows (AC-3)", () => {
  it("rolls back the outbound rows and cursor when applyTaskUpdates throws", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    const newestId = await seedInbound(threadId, ownerId, "hi");
    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;
    const task = active.tasks[0]!;
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: "text", text: "should roll back" }],
        // A fact-less task the consumer confirms in-txn via applyTaskUpdates (spied to throw below).
        confirmTasks: [{ taskId: task.id, kind: "emit", status: "unasked" }],
        cursorTo: newestId,
        objectiveId: active.objective.id,
      }),
    };
    // Make the confirm write fail inside the commit tx to prove the outbound rows + cursor roll back.
    const spy = vi.spyOn(ObjectiveRepository.prototype, "applyTaskUpdates").mockRejectedValueOnce(new Error("boom"));
    const sender = new StubSpectrumSender();
    await expect(new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId })).rejects.toThrow();
    spy.mockRestore();

    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(0);
    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBeNull();
  });
});

describe("Test Case 5: interruption restart bounded at 2 (AC-5)", () => {
  it("reasoning + response run 3 times, returns the third attempt", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "hey");

    const reasoner = new ScriptedReasoner({ result: { communicate: ["hi"], ask: [] } });
    const responder = new ScriptedResponder(); // task by default → each turn delegates to the reasoner
    const runSpy = vi.spyOn(reasoner, "run");
    const respondSpy = vi.spyOn(responder, "respond");

    const chef = new RealChef(
      db,
      reasoner,
      responder,
      ObjectiveRepository.create(db),
      ThreadRepository.create(db),
      HouseholdRepository.create(db),
      async () => true, // always interrupted
    );
    const reply = await chef.respond(threadId);

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(respondSpy).toHaveBeenCalledTimes(3);
    expect(reply).not.toBeNull();
  });
});

// ── spec-01: responder supervisor over the RealChef harness (social vs task delegation) ──────────

/** Builds a RealChef with a spied scripted reasoner and a scripted supervisor in the given mode. */
function harness(social: boolean, result: { communicate: string[]; ask: string[]; artifacts?: { kind: "richlink"; url: string }[] }) {
  const reasoner = new ScriptedReasoner({ result });
  const responder = new ScriptedResponder(social);
  const runSpy = vi.spyOn(reasoner, "run");
  const chef = new RealChef(
    db,
    reasoner,
    responder,
    ObjectiveRepository.create(db),
    ThreadRepository.create(db),
    HouseholdRepository.create(db),
    async () => false, // no interruption
  );
  return { chef, runSpy };
}

describe("spec-01 Test Case 1: social trigger is voiced without delegation (AC 1, 5)", () => {
  it("does not invoke the reasoner; confirmTasks is [], cursor + objective from the loaded turn", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    const newestId = await seedInbound(threadId, ownerId, "this only takes 20 min, amazing!");
    const active = (await ObjectiveRepository.create(db).loadActive(threadId))!;

    const { chef, runSpy } = harness(true, { communicate: [], ask: [] });
    const reply = await chef.respond(threadId);

    expect(runSpy).not.toHaveBeenCalled(); // the reasoner's tools/loop never run
    expect(reply!.confirmTasks).toEqual([]); // a social turn confirms nothing
    expect(reply!.cursorTo).toBe(newestId);
    expect(reply!.objectiveId).toBe(active.objective.id);
    expect(reply!.chatEvents).toHaveLength(1); // a react or short bubble
  });
});

describe("spec-01 Test Case 2: task trigger delegates once and is voiced (AC 2)", () => {
  it("invokes the reasoner exactly once and conveys communicate + ask", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "I'm allergic to peanuts");

    const { chef, runSpy } = harness(false, {
      communicate: ["noting peanuts as a severe allergy for Sam"],
      ask: ["which store do you shop at?"],
    });
    const reply = await chef.respond(threadId);

    expect(runSpy).toHaveBeenCalledTimes(1);
    const texts = reply!.chatEvents.filter((e) => e.kind === "text").map((e) => (e as { text: string }).text);
    expect(texts).toContain("noting peanuts as a severe allergy for Sam");
    expect(texts).toContain("which store do you shop at?");
  });
});

describe("spec-01 Test Case 3: empty deliberation degrades cleanly (AC 4)", () => {
  it("emits no chatEvents", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "hmm");

    const { chef } = harness(false, { communicate: [], ask: [] });
    const reply = await chef.respond(threadId);

    expect(reply!.chatEvents).toEqual([]);
  });
});

describe("spec-01 Test Case 4: artifact renders as a richlink (AC 2)", () => {
  it("puts a richlink event on the reply", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "give me a recipe");

    const { chef } = harness(false, {
      communicate: ["here's a recipe"],
      ask: [],
      artifacts: [{ kind: "richlink", url: "https://x/y" }],
    });
    const reply = await chef.respond(threadId);

    expect(reply!.chatEvents).toContainEqual({ kind: "richlink", url: "https://x/y" });
  });
});

describe("Test Case 6: selectChef(db) returns StubChef offline (AC-6)", () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  afterEach(() => {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  });

  it("no key → StubChef, respond returns a fixed non-null reply, no network", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const { selectChef } = await import("../src/imessage/chef.js");
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "hello");

    const chef = selectChef(db);
    expect(chef).toBeInstanceOf(StubChef);
    const reply = await chef.respond(threadId);
    expect(reply).not.toBeNull();
    expect(reply!.chatEvents).toHaveLength(1);
    expect(reply!.cursorTo).toBe(newestId);
  });
});

describe("Test Case 5: emit at send-time, explainer-ack on next inbound (AC-4)", () => {
  it("marks an emit filled the turn its bubbles send", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "sounds good");
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const emitId = randomUUID();
    await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });

    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: "text", text: "You're all set!" }],
        confirmTasks: [{ taskId: emitId, kind: "emit", status: "unasked" }],
        cursorTo: newestId,
        objectiveId,
      }),
    };
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    const [emit] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(emit!.status).toBe("filled"); // its bubbles went out → filled
    const [obj] = await db.select().from(objectives).where(eq(objectives.id, objectiveId));
    expect(obj!.status).toBe("complete"); // every required task terminal → popped the same turn
  });

  it("does NOT confirm the emit or pop the objective when the reply delivered no bubbles", async () => {
    const { threadId, ownerId } = await seedThread();
    const newestId = await seedInbound(threadId, ownerId, "sounds good");
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const emitId = randomUUID();
    await db.insert(tasks).values({ id: emitId, objectiveId, kind: "emit", fact: null, scope: "household", required: true, status: "unasked" });

    // An empty reply plan (MAX_ATTEMPTS fallback / a model that didn't deliver the close): no bubbles.
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [],
        confirmTasks: [{ taskId: emitId, kind: "emit", status: "unasked" }],
        cursorTo: newestId,
        objectiveId,
      }),
    };
    await new Consumer(db, new StubSpectrumSender(), chef, new StubThreadLock()).handle({ threadId });

    const [emit] = await db.select().from(tasks).where(eq(tasks.id, emitId));
    expect(emit!.status).toBe("unasked"); // nothing was sent → the emit is NOT confirmed
    const [obj] = await db.select().from(objectives).where(eq(objectives.id, objectiveId));
    expect(obj!.status).toBe("active"); // the close never sent → the objective must not pop
  });

  it("asks the fact-less explainer-ack when first delivered, fills it on the next inbound", async () => {
    const { threadId, ownerId } = await seedThread();
    const objectiveId = randomUUID();
    await db.insert(objectives).values({ id: objectiveId, threadId, definition: "onboarding", status: "active", stackPosition: 0 });
    const ackId = randomUUID();
    await db.insert(tasks).values({ id: ackId, objectiveId, kind: "elicit", fact: null, scope: "household", required: true, status: "unasked", solo: true });

    // The chef reports the ack's current status; the consumer asks-then-fills based on it.
    const chef: Chef = {
      respond: async (): Promise<ChefReply | null> => {
        const [ack] = await db.select().from(tasks).where(eq(tasks.id, ackId));
        const pending = await ThreadRepository.create(db).loadPendingInbound(threadId, (await db.select().from(threads).where(eq(threads.id, threadId)))[0]!.lastProcessedId);
        if (pending.length === 0) return null;
        return {
          chatEvents: [{ kind: "text", text: "here's how this works" }],
          confirmTasks: [{ taskId: ackId, kind: "elicit", status: ack!.status }],
          cursorTo: pending[pending.length - 1]!.id,
          objectiveId,
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
