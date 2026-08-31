import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
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
import { StubChef } from "../src/imessage/chef.js";
import { StubThreadLock } from "../src/imessage/lock.js";

const SECRET = "whsec_test";
process.env.SPECTRUM_WEBHOOK_SECRET = SECRET;

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

  async function postAndGetThread(mGuid: string, chatGuid: string, handle: string, text: string) {
    expect((await post(signedDelivery(mGuid, chatGuid, handle, text))).status).toBe(200);
    return db.select().from(threads).where(eq(threads.chatGuid, chatGuid));
  }
});
