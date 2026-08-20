import { test } from "node:test";
import assert from "node:assert/strict";
import { revealCount } from "../lib/typewriter.ts";

test("Reduce Motion reveals the whole string immediately", () => {
  assert.equal(revealCount(0, 28, 10, true), 10);
  assert.equal(revealCount(5, 28, 10, true), 10);
});

test("nothing is visible before the first tick", () => {
  assert.equal(revealCount(0, 28, 10, false), 0);
  assert.equal(revealCount(-100, 28, 10, false), 0);
});

test("reveal is monotonic and floors to whole characters", () => {
  assert.equal(revealCount(27, 28, 10, false), 0);
  assert.equal(revealCount(28, 28, 10, false), 1);
  assert.equal(revealCount(70, 28, 10, false), 2);
});

test("reveal caps at the string length", () => {
  assert.equal(revealCount(10_000, 28, 10, false), 10);
});

test("a non-positive speed reveals everything (guards divide-by-zero)", () => {
  assert.equal(revealCount(1, 0, 10, false), 10);
});
