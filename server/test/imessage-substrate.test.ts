import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { threads, threadMessages, users } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

// The webhook route enqueues the doorbell via the module-level send(); mock it so no
// real queue is touched, and so we can assert exactly one doorbell per delivery.
const { send } = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("../src/queue.js", () => ({ send, handleCallback: vi.fn() }));

import { buildApp } from "../src/index.js";
import { parseInbound } from "../src/imessage/inbound.js";
import { Consumer } from "../src/imessage/consumer.js";
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubChef, type OutboundSink } from "../src/imessage/chef.js";
import { StubThreadLock } from "../src/imessage/lock.js";
import { ThreadRepository } from "../src/repositories/thread-repository.js";

const SECRET = "whsec_test";
process.env.SPECTRUM_WEBHOOK_SECRET = SECRET;

/** A Chef double that sends TWO text bubbles live per turn — for the outbound external_id tests. */
class TwoBubbleChef {
  private readonly threads: ThreadRepository;
  constructor(private readonly db: Database) {
    this.threads = ThreadRepository.create(db);
  }
  async respond(threadId: string, sink: OutboundSink) {
    const thread = await this.threads.findById(threadId);
    if (!thread) return null;
    const pending = await this.threads.loadPendingInbound(threadId, thread.lastProcessedId);
    if (pending.length === 0) return null;
    await sink.send({ kind: "text", text: "first" });
    await sink.send({ kind: "text", text: "second" });
    return { confirmTasks: [], cursorTo: pending[pending.length - 1]!.id, objectiveId: "", delivered: true };
  }
}

let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
  send.mockClear();
});

afterEach(() => cleanup());

/** Builds a native Spectrum webhook body + its valid signature headers. */
function signedDelivery(messageGuid: string, chatGuid: string, handle: string, text: string) {
  const body = JSON.stringify({
    event: "message.new",
    message: {
      id: messageGuid,
      space: { id: chatGuid },
      sender: { id: handle },
      content: { type: "text", text },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const base = Buffer.from(`v0:${ts}:${body}`);
  const hex = createHmac("sha256", SECRET).update(base).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-spectrum-signature": `v0=${hex}`,
      "x-spectrum-timestamp": String(ts),
    },
  };
}

/** Builds a native Spectrum *reaction* (tapback) webhook body + its valid signature headers. */
function signedReactionDelivery(messageGuid: string, chatGuid: string, handle: string, emoji: string, targetGuid: string) {
  const body = JSON.stringify({
    event: "message.new",
    message: {
      id: messageGuid,
      space: { id: chatGuid },
      sender: { id: handle },
      content: { type: "reaction", emoji, target: { id: targetGuid } },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const base = Buffer.from(`v0:${ts}:${body}`);
  const hex = createHmac("sha256", SECRET).update(base).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-spectrum-signature": `v0=${hex}`,
      "x-spectrum-timestamp": String(ts),
    },
  };
}

/** Builds a native Spectrum threaded *reply* webhook body + its valid signature headers.
 *  The reply's own text nests at `content.content.text`; its parent guid is `content.target.id`. */
function signedReplyDelivery(messageGuid: string, chatGuid: string, handle: string, text: string, targetGuid: string) {
  const body = JSON.stringify({
    event: "message.new",
    message: {
      id: messageGuid,
      space: { id: chatGuid },
      sender: { id: handle },
      content: { type: "reply", content: { type: "text", text }, target: { id: targetGuid } },
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const base = Buffer.from(`v0:${ts}:${body}`);
  const hex = createHmac("sha256", SECRET).update(base).digest("hex");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "x-spectrum-signature": `v0=${hex}`,
      "x-spectrum-timestamp": String(ts),
    },
  };
}

function post(delivery: { body: string; headers: Record<string, string> }) {
  return app.request("/spectrum/webhook", { method: "POST", headers: delivery.headers, body: delivery.body });
}

describe("iMessage substrate", () => {
  it("happy path: signed webhook persists, doorbell processes, one reply sent (AC-1/3/5/8)", async () => {
    const res = await post(signedDelivery("m1", "chat-1", "+15551234567", "hi chef"));
    expect(res.status).toBe(200);

    const [user] = await db.select().from(users).where(eq(users.imessageHandle, "+15551234567"));
    expect(user).toBeTruthy();
    const [thread] = await db.select().from(threads).where(eq(threads.chatGuid, "chat-1"));
    expect(thread.ownerUserId).toBe(user.id);
    const inbound = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id));
    expect(inbound).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][1]).toEqual({ threadId: thread.id });

    const sender = new StubSpectrumSender();
    const chef = new StubChef(db);
    const lock = new StubThreadLock();
    // greeted_at set: this case tests the reply-send mechanics, not the WI-4B confetti greeting.
    await db.update(threads).set({ greetedAt: new Date() }).where(eq(threads.id, thread.id));
    await new Consumer(db, sender, chef, lock).handle({ threadId: thread.id });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(outbound[0].sentAt).not.toBeNull();
    expect(sender.calls).toEqual([{ chatGuid: "chat-1", body: outbound[0].body }]);
    expect(sender.reads).toContain(inbound[0].messageGuid); // marked the inbound read
    expect(sender.respondingCount).toBe(1); // reply composed + sent under the typing indicator
    expect(lock.calls).toBe(1); // the turn ran under the per-thread lock
    const [updated] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(updated.lastProcessedId).toBe(inbound[0].id);
    expect(chef.reasoningReached).toBe(true);
  });

  it("duplicate inbound is a no-op (AC-4)", async () => {
    const delivery = signedDelivery("m-dup", "chat-2", "+15550002222", "hello");
    expect((await post(delivery)).status).toBe(200);
    expect((await post(delivery)).status).toBe(200);

    const [thread] = await db.select().from(threads).where(eq(threads.chatGuid, "chat-2"));
    const inbound = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id));
    expect(inbound).toHaveLength(1);
  });

  it("redelivered doorbell sends exactly once (AC-7)", async () => {
    const [thread] = await postAndGetThread("m3", "chat-3", "+15553334444", "yo");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, new StubChef(db), new StubThreadLock()).handle({ threadId: thread.id });
    await new Consumer(db, sender, new StubChef(db), new StubThreadLock()).handle({ threadId: thread.id });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(sender.calls).toHaveLength(1);
  });

  it("a lock loser does nothing — no reply, cursor untouched", async () => {
    const [thread] = await postAndGetThread("m-lock", "chat-lock", "+15557778888", "hey");
    const sender = new StubSpectrumSender();
    // Lock not acquired (another processor holds it): the turn must not run.
    await new Consumer(db, sender, new StubChef(db), new StubThreadLock(false)).handle({ threadId: thread.id });

    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(0);
    expect(sender.calls).toHaveLength(0);
    const [after] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.lastProcessedId).toBeNull(); // cursor never advanced
  });

  it("senderless delivery is acked and ignored (no user/thread/message, no doorbell)", async () => {
    const body = JSON.stringify({
      event: "message.new",
      message: { id: "m-nosender", space: { id: "chat-ns" }, content: { type: "text", text: "hi" } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const hex = createHmac("sha256", SECRET).update(Buffer.from(`v0:${ts}:${body}`)).digest("hex");
    const res = await post({
      body,
      headers: {
        "content-type": "application/json",
        "x-spectrum-signature": `v0=${hex}`,
        "x-spectrum-timestamp": String(ts),
      },
    });
    expect(res.status).toBe(200);
    expect(await db.select().from(threads).where(eq(threads.chatGuid, "chat-ns"))).toHaveLength(0);
    expect(await db.select().from(threadMessages)).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("bad signature is rejected with no side effects (AC-2)", async () => {
    const delivery = signedDelivery("m4", "chat-4", "+15559998888", "hi");
    delivery.headers["x-spectrum-signature"] = "v0=deadbeef";
    expect((await post(delivery)).status).toBe(401);

    expect(await db.select().from(users).where(eq(users.imessageHandle, "+15559998888"))).toHaveLength(0);
    expect(await db.select().from(threads).where(eq(threads.chatGuid, "chat-4"))).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("parseInbound represents a reaction: emoji + target guid, body null (WI-A TC1)", () => {
    const { body } = signedReactionDelivery("r1", "chat-r1", "+15551112222", "❤️", "m-target");
    const parsed = parseInbound(new TextEncoder().encode(body));
    expect(parsed).toEqual({
      messageGuid: "r1",
      chatGuid: "chat-r1",
      handle: "+15551112222",
      type: "reaction",
      body: null,
      reactionEmoji: "❤️",
      targetGuid: "m-target",
    });
  });

  it("a reaction persists but draws no reply (WI-A TC2)", async () => {
    const res = await post(signedReactionDelivery("r2", "chat-r2", "+15552223333", "❤️", "m-prior"));
    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled(); // the chokepoint skips the doorbell for a reaction

    const [thread] = await db.select().from(threads).where(eq(threads.chatGuid, "chat-r2"));
    const [row] = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id));
    expect(row.type).toBe("reaction");
    expect(row.reactionEmoji).toBe("❤️");
    expect(row.targetMessageGuid).toBe("m-prior");
    expect(row.body).toBeNull();

    // Even if a stale doorbell fired, the consumer must produce no send (reaction isn't pending text).
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, new StubChef(db), new StubThreadLock()).handle({ threadId: thread.id });
    expect(sender.calls).toHaveLength(0);
    expect(await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"))).toHaveLength(0);
    const [after] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.lastProcessedId).toBeNull(); // cursor never advanced for a bare reaction
  });

  it("a text turn after a reaction still answers, advancing past both (WI-A TC3)", async () => {
    expect((await post(signedReactionDelivery("r3", "chat-r3", "+15554445555", "👍", "m-prior"))).status).toBe(200);
    expect((await post(signedDelivery("t3", "chat-r3", "+15554445555", "what's for dinner?"))).status).toBe(200);
    expect(send).toHaveBeenCalledOnce(); // only the text rang the doorbell

    const [thread] = await db.select().from(threads).where(eq(threads.chatGuid, "chat-r3"));
    const sender = new StubSpectrumSender();
    // greeted_at set: this case tests answering-after-a-reaction, not the WI-4B confetti greeting.
    await db.update(threads).set({ greetedAt: new Date() }).where(eq(threads.id, thread.id));
    await new Consumer(db, sender, new StubChef(db), new StubThreadLock()).handle({ threadId: thread.id });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(sender.calls).toEqual([{ chatGuid: "chat-r3", body: outbound[0].body }]);
    const [text] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, "t3"));
    const [after] = await db.select().from(threads).where(eq(threads.id, thread.id));
    expect(after.lastProcessedId).toBe(text.id); // cursor advanced to the text turn
  });

  it("parseInbound captures a reply's own text + parent guid (WI-B TC1)", () => {
    const { body } = signedReplyDelivery("rep1", "chat-rep1", "+15556667777", "make it vegetarian", "m-menu");
    const parsed = parseInbound(new TextEncoder().encode(body));
    expect(parsed).toEqual({
      messageGuid: "rep1",
      chatGuid: "chat-rep1",
      handle: "+15556667777",
      type: "reply",
      body: "make it vegetarian",
      reactionEmoji: undefined,
      targetGuid: "m-menu",
    });
  });

  it("a reply persists with parent guid and answers a normal turn (WI-B TC2)", async () => {
    // Seed the parent as a prior Chef outbound (excluded from the drain), so the threaded reply is
    // the sole pending inbound — its own text, and the parent guid on file.
    const [thread] = await postAndGetThread("m-seed", "chat-rep2", "+15558889999", "hey");
    await db.insert(threadMessages).values({
      threadId: thread.id, direction: "outbound", type: "text",
      body: "here's the menu", messageGuid: "m-parent", sentAt: new Date(),
    });

    const res = await post(signedReplyDelivery("rep2", "chat-rep2", "+15558889999", "make it vegetarian", "m-parent"));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2); // the seed text and the reply each ring the doorbell (a reply is answerable)

    const [replyRow] = await db.select().from(threadMessages).where(eq(threadMessages.messageGuid, "rep2"));
    expect(replyRow.type).toBe("reply");
    expect(replyRow.body).toBe("make it vegetarian");
    expect(replyRow.targetMessageGuid).toBe("m-parent");

    const sender = new StubSpectrumSender();
    const chef = new StubChef(db);
    await new Consumer(db, sender, chef, new StubThreadLock()).handle({ threadId: thread.id });
    expect(chef.reasoningReached).toBe(true); // the reply drove a reasoning turn
    expect(sender.calls).toHaveLength(1); // an outbound reply was produced
  });

  it("inbound rows carry external_id = their platform id (WI-C)", async () => {
    const [thread] = await postAndGetThread("m-ext", "chat-ext", "+15551110000", "hi chef");
    const [row] = await db.select().from(threadMessages).where(eq(threadMessages.threadId, thread.id));
    expect(row.externalId).toBe("m-ext"); // the Spectrum message id the webhook carried
  });

  it("each live bubble captures its send's external_id and is marked sent (WI-C AC1)", async () => {
    // Increment 2: bubbles send LIVE, one `send()` call per bubble, so each captures the id its own
    // call returned (the stub returns `ext-0` for a single-body send) — not a batch index-map.
    const [thread] = await postAndGetThread("m-ac1", "chat-ac1", "+15552220000", "hey");
    const sender = new StubSpectrumSender();
    await new Consumer(db, sender, new TwoBubbleChef(db), new StubThreadLock()).handle({ threadId: thread.id });

    const outbound = await db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.direction, "outbound"))
      .orderBy(sql`rowid`);
    expect(outbound).toHaveLength(2);
    expect(outbound.map((r) => r.body)).toEqual(["first", "second"]); // sent in order
    expect(outbound.every((r) => r.externalId === "ext-0")).toBe(true); // each from its own live send
    expect(outbound.every((r) => r.sentAt !== null)).toBe(true);
    expect(sender.calls.map((c) => c.body)).toEqual(["first", "second"]); // two live sends, in order
  });

  it("reply-to-Chef resolves the parent via external_id + briefs (WI-C AC2)", async () => {
    const [thread] = await postAndGetThread("m-seed2", "chat-ac2", "+15553330000", "hey");
    // A prior Chef outbound whose external_id is the platform id; its message_guid is a distinct UUID.
    await db.insert(threadMessages).values({
      threadId: thread.id, direction: "outbound", type: "text",
      body: "here's the menu for the week", messageGuid: crypto.randomUUID(),
      externalId: "spc-msg-PARENT", sentAt: new Date(),
    });

    expect((await post(signedReplyDelivery("rep-ac2", "chat-ac2", "+15553330000", "make it vegetarian", "spc-msg-PARENT"))).status).toBe(200);

    const threads = ThreadRepository.create(db);
    const parent = await threads.findByPlatformId(thread.id, "spc-msg-PARENT");
    expect(parent?.body).toBe("here's the menu for the week"); // resolved solely off external_id
    // The briefing surfaces the resolved parent (WI-B's ↳ replying to snippet) for a reply-to-Chef.
    const { prepareBriefing } = await import("../src/chef/briefing.js");
    const prompt = prepareBriefing({
      objective: { definition: "onboarding" } as any,
      tasks: [], members: [], transcript: [], trigger: "make it vegetarian",
      replyingTo: parent!.body!,
    });
    expect(prompt).toContain('replying to: "here\'s the menu for the week"');
  });

  it("an empty send return doesn't crash and still marks the row sent (WI-C AC3)", async () => {
    // A degraded send that returns no id leaves external_id null but must still mark the row sent —
    // the send resolved, so the sent_at idempotency gate must trip regardless of the returned id.
    const [thread] = await postAndGetThread("m-ac3", "chat-ac3", "+15554440000", "yo");
    const sender = new StubSpectrumSender();
    sender.sendReturn = []; // the send resolved but returned no platform id
    await new Consumer(db, sender, new TwoBubbleChef(db), new StubThreadLock()).handle({ threadId: thread.id });

    const outbound = await db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.direction, "outbound"))
      .orderBy(sql`rowid`);
    expect(outbound).toHaveLength(2);
    expect(outbound.every((r) => r.externalId === null)).toBe(true); // no id returned → left null
    expect(outbound.every((r) => r.sentAt !== null)).toBe(true); // both still marked sent
  });

  async function postAndGetThread(mGuid: string, chatGuid: string, handle: string, text: string) {
    expect((await post(signedDelivery(mGuid, chatGuid, handle, text))).status).toBe(200);
    // greeted_at set: these substrate cases test dispatch mechanics, not the WI-4B confetti greeting
    // (which would otherwise ship the fresh thread's first bubble through sendEffect, not send).
    await db.update(threads).set({ greetedAt: new Date() }).where(eq(threads.chatGuid, chatGuid));
    return db.select().from(threads).where(eq(threads.chatGuid, chatGuid));
  }
});
