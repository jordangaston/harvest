import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { pendingPast } from "../src/imessage/consumer-logic.js";
import { Consumer } from "../src/imessage/consumer.js";
import { RealChef, StubChef, type Chef, type ChefReply } from "../src/imessage/chef.js";
import { sendingChef, CollectingSink } from "./helpers/chef-double.js";
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubThreadLock } from "../src/imessage/lock.js";
import { ObjectiveRepository } from "../src/chef/objective-repository.js";
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
    // Task fills happen through the in-loop update_tasks tool now, not via ChefReply; the consumer's
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

/** A chef that fills the emit + pops the objective in-loop (as update_tasks now does) and reports it,
 *  so the consumer's commit should only advance the cursor. */
function poppingChef(text: string, emitId: string, objectiveId: string, cursorTo: string): Chef {
  return {
    respond: async (_threadId, sink): Promise<ChefReply> => {
      await sink.send({ kind: "text", text });
      // The in-loop update_tasks path: mark the emit filled + pop, in one txn.
      await db.transaction(async (tx) => {
        await ObjectiveRepository.create(db).applyTaskUpdates([{ taskId: emitId, status: "filled" }], tx);
        await ObjectiveRepository.create(db).completeAndPop(objectiveId, tx);
      });
      return { confirmTasks: [], cursorTo, objectiveId, delivered: true, popped: true };
    },
  };
}

describe("Test Case 5: onboarding completes via update_tasks, consumer only advances the cursor (AC-6, AC-7)", () => {
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

    // The chef delivers the close but does NOT mark the emit via update_tasks (popped:false). The
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
        // Turn 1: fill A's last task + pop (as update_tasks does), report popped.
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
