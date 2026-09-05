import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { actionable, FOLLOW_UP_LADDER } from "../src/imessage/heartbeat.js";
import type { Task } from "../src/models/task.js";

const NOW = new Date("2026-09-05T12:00:00Z");

/** A task with sane defaults; override per case. */
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: randomUUID(),
    objectiveId: randomUUID(),
    kind: "elicit",
    fact: "household.grocery_stores",
    factType: null,
    scope: "household",
    memberUserId: null,
    required: true,
    status: "asked",
    solo: false,
    afterTaskIds: [],
    followUpsSent: 0,
    nudgedAt: null,
    ...overrides,
  };
}

/** `nudgedAt` a given number of ms before NOW. */
function agoMs(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("actionable — WI-02 AC-2", () => {
  it("arm 1: an asked task is due exactly at its rung, not a hair under", () => {
    const rung = FOLLOW_UP_LADDER[0];
    const justUnder = task({ status: "asked", followUpsSent: 0, nudgedAt: agoMs(rung - 1) });
    const atRung = task({ status: "asked", followUpsSent: 0, nudgedAt: agoMs(rung) });
    expect(actionable([justUnder], NOW)).toEqual([]);
    expect(actionable([atRung], NOW)).toEqual([atRung]);
  });

  it("arm 1: each rung uses its own gap keyed by follow_ups_sent", () => {
    // A task that has been nudged twice waits the 60m rung, not the 5m one.
    const rung2 = FOLLOW_UP_LADDER[2];
    const notYet = task({ status: "asked", followUpsSent: 2, nudgedAt: agoMs(FOLLOW_UP_LADDER[0]) });
    const due = task({ status: "asked", followUpsSent: 2, nudgedAt: agoMs(rung2) });
    expect(actionable([notYet], NOW)).toEqual([]);
    expect(actionable([due], NOW)).toEqual([due]);
  });

  it("arm 1: an exhausted ask (follow_ups_sent = ladder length) is never due", () => {
    const exhausted = task({ status: "asked", followUpsSent: FOLLOW_UP_LADDER.length, nudgedAt: agoMs(30 * 24 * 60 * 60_000) });
    expect(actionable([exhausted], NOW)).toEqual([]);
  });

  it("arm 1: a null nudged_at on an asked task is due immediately (safe recovery)", () => {
    const orphan = task({ status: "asked", followUpsSent: 0, nudgedAt: null });
    expect(actionable([orphan], NOW)).toEqual([orphan]);
  });

  it("arm 2: an unasked task (already gate-eligible from loadActive) is actionable, no ladder wait", () => {
    const eligible = task({ status: "unasked", nudgedAt: null });
    expect(actionable([eligible], NOW)).toEqual([eligible]);
  });

  it("arm 2 excludes an unasked emit — the heartbeat asks questions, never re-delivers content", () => {
    const emit = task({ status: "unasked", kind: "emit", fact: null });
    expect(actionable([emit], NOW)).toEqual([]);
  });

  it("terminal tasks are never actionable", () => {
    const filled = task({ status: "filled" });
    const defaulted = task({ status: "defaulted" });
    expect(actionable([filled, defaulted], NOW)).toEqual([]);
  });

  it("returns exactly the due/eligible mix across arms", () => {
    const dueAsk = task({ status: "asked", followUpsSent: 0, nudgedAt: agoMs(FOLLOW_UP_LADDER[0]) });
    const quietAsk = task({ status: "asked", followUpsSent: 0, nudgedAt: agoMs(FOLLOW_UP_LADDER[0] - 1) });
    const unasked = task({ status: "unasked" });
    const filled = task({ status: "filled" });
    expect(new Set(actionable([dueAsk, quietAsk, unasked, filled], NOW))).toEqual(new Set([dueAsk, unasked]));
  });
});
