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
import { handleDoorbell } from "../src/imessage/consumer.js";
import { StubSpectrumSender } from "../src/imessage/sender.js";
import { StubChef } from "../src/imessage/chef.js";

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
    const chef = new StubChef();
    await handleDoorbell({ threadId: thread.id }, { db, sender, chef });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(outbound[0].sentAt).not.toBeNull();
    expect(sender.calls).toEqual([{ chatGuid: "chat-1", body: outbound[0].body }]);
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
    await handleDoorbell({ threadId: thread.id }, { db, sender, chef: new StubChef() });
    await handleDoorbell({ threadId: thread.id }, { db, sender, chef: new StubChef() });

    const outbound = await db.select().from(threadMessages).where(eq(threadMessages.direction, "outbound"));
    expect(outbound).toHaveLength(1);
    expect(sender.calls).toHaveLength(1);
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

  async function postAndGetThread(mGuid: string, chatGuid: string, handle: string, text: string) {
    expect((await post(signedDelivery(mGuid, chatGuid, handle, text))).status).toBe(200);
    return db.select().from(threads).where(eq(threads.chatGuid, chatGuid));
  }
});
