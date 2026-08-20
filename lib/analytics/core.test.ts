import { test } from "node:test";
import assert from "node:assert/strict";
import { Analytics } from "./core.ts";
import type { Backend, Props } from "./backend.ts";

/** Records every backend call so tests can assert what the core forwarded. */
function spyBackend() {
  const calls: { method: string; args: unknown[] }[] = [];
  const backend: Backend = {
    track: (event: string, props?: Props) => calls.push({ method: "track", args: [event, props] }),
    identify: (userId: string) => calls.push({ method: "identify", args: [userId] }),
    setPeople: (props: Props) => calls.push({ method: "setPeople", args: [props] }),
    reset: () => calls.push({ method: "reset", args: [] }),
  };
  return { backend, calls };
}

test("S1: with no backend wired, nothing is forwarded (Noop stays)", () => {
  const a = new Analytics();
  a.track("Button Tapped", { label: "Continue" });
  a.onSignup("u1", { goals: ["save_money"] });
  // No throw, no sink — the assertion is simply that this ran without error.
  assert.ok(true);
});

test("S1: track forwards event + props to the wired backend", () => {
  const a = new Analytics();
  const { backend, calls } = spyBackend();
  a.setBackend(backend);
  a.track("Cookbook Created", { cookbook_id: "c1" });
  assert.deepEqual(calls, [{ method: "track", args: ["Cookbook Created", { cookbook_id: "c1" }] }]);
});

test("S3: setScreen emits Screen Viewed once per changed path and stamps later events", () => {
  const a = new Analytics();
  const { backend, calls } = spyBackend();
  a.setBackend(backend);
  a.setScreen("/goals");
  a.setScreen("/goals"); // duplicate — no event
  a.track("Button Tapped", { label: "Next" });
  assert.deepEqual(calls, [
    { method: "track", args: ["Screen Viewed", { screen: "/goals" }] },
    { method: "track", args: ["Button Tapped", { screen: "/goals", label: "Next" }] },
  ]);
});

test("S2: onSignup identifies, sets people-properties, then tracks Signup Completed in order", () => {
  const a = new Analytics({ now: () => "2026-08-07T00:00:00.000Z" });
  const { backend, calls } = spyBackend();
  a.setBackend(backend);
  a.onSignup("user-42", { goals: ["eat_healthier"], cook_days: ["mon"] });
  assert.deepEqual(calls, [
    { method: "identify", args: ["user-42"] },
    {
      method: "setPeople",
      args: [{ signup_at: "2026-08-07T00:00:00.000Z", goals: ["eat_healthier"], cook_days: ["mon"] }],
    },
    { method: "track", args: ["Signup Completed", {}] },
  ]);
});

test("a throwing backend never propagates out of track", () => {
  const a = new Analytics();
  a.setBackend({
    track() {
      throw new Error("network down");
    },
    identify() {},
    setPeople() {},
    reset() {},
  });
  assert.doesNotThrow(() => a.track("Recipe Imported", { recipe_count: 2 }));
});
