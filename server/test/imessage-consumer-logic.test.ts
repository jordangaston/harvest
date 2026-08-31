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
import { ObjectiveStore } from "../src/chef/objective-store.js";
import { ThreadRepository } from "../src/repositories/thread-repository.js";
import { HouseholdRepository } from "../src/repositories/household-repository.js";
import { ScriptedReasoner } from "../src/chef/reasoning-agent.js";
import { ScriptedResponder } from "../src/chef/response-agent.js";
import { UserRepository } from "../src/repositories/user-repository.js";
import { AuthService } from "../src/services/auth-service.js";
import { threads, threadMessages, slots } from "../src/schema.js";
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
    messageGuid: `g-${id}`,
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

/** Seeds a thread + household + one member + an active onboarding objective with the given slots. */
async function seedThread(slotKeys: string[] = []): Promise<{ threadId: string; chatGuid: string; ownerId: string }> {
  const { privateKey, publicKey } = AuthService.create().generateKeyPair();
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const owner = await UserRepository.create(db).insert({ phone, jwtPrivateKey: privateKey, jwtPublicKey: publicKey });

  const hh = HouseholdRepository.create(db);
  const household = await hh.createHousehold({ ownerUserId: owner.id });
  await hh.addMember({ householdId: household.id, userId: owner.id });

  const threadId = randomUUID();
  const chatGuid = `g-${threadId}`;
  await db.insert(threads).values({ id: threadId, chatGuid, ownerUserId: owner.id, householdId: household.id });

  if (slotKeys.length)
    await ObjectiveStore.create(db).pushObjective({
      threadId,
      definition: "onboarding",
      slots: slotKeys.map((key) => ({ key, scope: "household" as const, required: true })),
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
  it("names nothing from reasoning/response/briefing/ReplyPlan/objective-store/mastra", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/imessage/consumer.ts", import.meta.url)), "utf8");
    const imports = src.split("\n").filter((l) => l.trimStart().startsWith("import"));
    for (const forbidden of ["reasoning", "response-agent", "briefing", "ReplyPlan", "objective-store", "mastra"])
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

describe("Test Case 3: a turn commits N rows + M slot updates + advances the cursor (AC-3, AC-4)", () => {
  it("commits 2 bubbles + 2 slot updates + cursor, sends twice", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores", "household.cook_days_count"]);
    await seedInbound(threadId, ownerId, "we shop at kroger");
    const newestId = await seedInbound(threadId, ownerId, "and cook 5 nights");

    const active = (await ObjectiveStore.create(db).loadActive(threadId))!;
    const askedSlot = active.slots.find((s) => s.key === "household.cook_days_count")!;
    const filledSlot = active.slots.find((s) => s.key === "household.grocery_stores")!;
    const chef: Chef = {
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [
          { kind: "text", text: "Kroger, nice." },
          { kind: "text", text: "Five nights it is." },
        ],
        slotUpdates: [
          { slotId: askedSlot.id, status: "asked" },
          { slotId: filledSlot.id, status: "filled", value: ["kroger"] },
        ],
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

    const slotRows = await db.select().from(slots).where(eq(slots.objectiveId, active.objective.id));
    expect(slotRows.find((s) => s.id === askedSlot.id)!.status).toBe("asked");
    const filled = slotRows.find((s) => s.id === filledSlot.id)!;
    expect(filled.status).toBe("filled");
    expect(filled.value).toEqual(["kroger"]);

    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBe(newestId);
  });
});

describe("Test Case 4: commit is atomic — a failing slot update rolls back the rows (AC-3)", () => {
  it("rolls back the outbound rows and cursor when applySlotUpdates throws", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    const newestId = await seedInbound(threadId, ownerId, "hi");
    const active = (await ObjectiveStore.create(db).loadActive(threadId))!;
    const slot = active.slots[0]!;
    const chef: Chef = {
      // filled with no landed value → applySlotUpdates rejects inside the tx.
      respond: async (): Promise<ChefReply> => ({
        chatEvents: [{ kind: "text", text: "should roll back" }],
        slotUpdates: [{ slotId: slot.id, status: "filled" }],
        cursorTo: newestId,
        objectiveId: active.objective.id,
      }),
    };
    const sender = new StubSpectrumSender();
    await expect(new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId })).rejects.toThrow();

    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(0);
    const [after] = await db.select().from(threads).where(eq(threads.id, threadId));
    expect(after.lastProcessedId).toBeNull();
  });
});

describe("Test Case 5: interruption restart bounded at 2 (AC-5)", () => {
  it("reasoning + response run 3 times, returns the third attempt", async () => {
    const { threadId, ownerId } = await seedThread(["household.grocery_stores"]);
    await seedInbound(threadId, ownerId, "hey");

    const reasoner = new ScriptedReasoner({ replyPlan: { intents: [{ kind: "acknowledge", note: "hi" }], must_say: [] }, slotUpdates: [] });
    const responder = new ScriptedResponder();
    const runSpy = vi.spyOn(reasoner, "run");
    const renderSpy = vi.spyOn(responder, "render");

    const chef = new RealChef(
      db,
      reasoner,
      responder,
      ObjectiveStore.create(db),
      ThreadRepository.create(db),
      HouseholdRepository.create(db),
      async () => true, // always interrupted
    );
    const reply = await chef.respond(threadId);

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(renderSpy).toHaveBeenCalledTimes(3);
    expect(reply).not.toBeNull();
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
