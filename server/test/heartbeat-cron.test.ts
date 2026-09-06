import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { type Database } from "../src/db.js";
import { dynamicCronJobs } from "../src/schema.js";
import { migratedFileDb } from "./helpers/migrated-db.js";
import { nextRun } from "../src/crons/next-run.js";
import { CronJobsRepository } from "../src/crons/cron-jobs-repository.js";
import { sweep, type SendDoorbell } from "../src/crons/sweep.js";

// The sweep route imports the module-level queue send(); mock it so no real queue is
// touched and the route test asserts no sends on a 401.
const { send } = vi.hoisted(() => ({ send: vi.fn(async (..._args: unknown[]) => {}) }));
vi.mock("../src/queue.js", () => ({ send, handleCallback: vi.fn() }));

import { buildApp } from "../src/index.js";

describe("nextRun", () => {
  it("computes the next occurrence of a plain expression", () => {
    expect(nextRun("*/5 * * * *", new Date("2026-09-05T10:02:00Z")).toISOString()).toBe(
      "2026-09-05T10:05:00.000Z",
    );
  });

  it("wraps to the next day for an hour-bounded expression past its window", () => {
    expect(nextRun("*/5 8-21 * * *", new Date("2026-09-05T22:00:00Z")).toISOString()).toBe(
      "2026-09-06T08:00:00.000Z",
    );
  });
});

describe("sweep", () => {
  let db: Database;
  let cleanup: () => void;
  const now = new Date("2026-09-05T10:02:00Z");

  beforeEach(async () => {
    ({ db, cleanup } = await migratedFileDb());
  });
  afterEach(() => cleanup());

  /** Seeds one heartbeat job. `nextRunAt` decides due-ness against `now`. */
  async function seedHeartbeat(threadId: string, nextRunAt: Date, isPaused = false) {
    await db.insert(dynamicCronJobs).values({
      jobType: "thread_heartbeat",
      ownerType: "thread",
      ownerId: threadId,
      input: { threadId },
      cronExpression: "*/5 * * * *",
      nextRunAt,
      isPaused,
    });
  }

  it("advances due rows, dispatches their doorbells, and leaves others untouched", async () => {
    const dueSlot = new Date("2026-09-05T10:00:00Z");
    const future = new Date("2026-09-06T10:00:00Z");
    await seedHeartbeat("thread-due", dueSlot);
    await seedHeartbeat("thread-future", future);
    await seedHeartbeat("thread-paused", dueSlot, true);

    const sends: { topic: string; payload: unknown; key: string }[] = [];
    const mockSend: SendDoorbell = async (topic, payload, options) => {
      sends.push({ topic, payload, key: options.idempotencyKey });
    };

    const dispatched = await sweep(CronJobsRepository.create(db), mockSend, now);

    expect(dispatched).toBe(1);
    expect(sends).toEqual([
      {
        topic: "inbound-messages",
        payload: { threadId: "thread-due" },
        key: `hb:thread-due:${dueSlot.toISOString()}`,
      },
    ]);

    const rows = Object.fromEntries(
      (await db.select().from(dynamicCronJobs)).map((r) => [r.ownerId, r.nextRunAt]),
    );
    expect(rows["thread-due"]).toEqual(nextRun("*/5 * * * *", now));
    expect(rows["thread-due"]!.getTime()).toBeGreaterThan(now.getTime());
    expect(rows["thread-future"]).toEqual(future);
    expect(rows["thread-paused"]).toEqual(dueSlot);
  });
});

describe("GET /crons/dispatch", () => {
  let db: Database;
  let cleanup: () => void;
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ({ db, cleanup } = await migratedFileDb());
    app = buildApp(db);
    send.mockClear();
    process.env.CRON_SECRET = "sekret";
    await db.insert(dynamicCronJobs).values({
      jobType: "thread_heartbeat",
      ownerType: "thread",
      ownerId: "thread-due",
      input: { threadId: "thread-due" },
      cronExpression: "*/5 * * * *",
      nextRunAt: new Date("2026-09-05T10:00:00Z"),
    });
  });
  afterEach(() => cleanup());

  it("rejects a missing or wrong bearer with 401 and no side effects", async () => {
    const before = (await db.select().from(dynamicCronJobs))[0]!.nextRunAt;

    const attempts: Record<string, string>[] = [{}, { authorization: "Bearer wrong" }];
    for (const headers of attempts) {
      const res = await app.request("/crons/dispatch", { headers });
      expect(res.status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
    const after = (await db.select().from(dynamicCronJobs))[0]!.nextRunAt;
    expect(after).toEqual(before);
  });

  it("sweeps with a valid bearer", async () => {
    const res = await app.request("/crons/dispatch", { headers: { authorization: "Bearer sekret" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ dispatched: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(dynamicCronJobs).where(eq(dynamicCronJobs.ownerId, "thread-due"));
    expect(row!.nextRunAt.getTime()).toBeGreaterThan(new Date("2026-09-05T10:00:00Z").getTime());
  });
});
