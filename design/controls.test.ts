import { test } from "node:test";
import assert from "node:assert/strict";
import { seedValues, setValue } from "./controls.ts";
import type { ControlSpec } from "./types.ts";

const specs: ControlSpec[] = [
  { kind: "boolean", key: "b", label: "B", default: true },
  { kind: "enum", key: "e", label: "E", options: ["x", "y"], default: "x" },
  { kind: "text", key: "t", label: "T", default: "hi" },
  { kind: "number", key: "n", label: "N", default: 3 },
];

test("seedValues maps each key to its default", () => {
  assert.deepEqual(seedValues(specs), { b: true, e: "x", t: "hi", n: 3 });
});

test("seedValues handles empty and undefined", () => {
  assert.deepEqual(seedValues([]), {});
  assert.deepEqual(seedValues(undefined), {});
});

test("setValue returns a new record with one key changed, without mutating", () => {
  const before = { a: 1 };
  const after = setValue(before, "b", 2);
  assert.deepEqual(after, { a: 1, b: 2 });
  assert.deepEqual(before, { a: 1 }, "input must not be mutated");
  assert.notEqual(after, before, "must be a new object reference");
});
