import { test } from "node:test";
import assert from "node:assert/strict";
import { findRegistryProblems } from "./integrity.ts";

test("a valid registry has no problems", () => {
  assert.deepEqual(
    findRegistryProblems([
      { name: "RecipeCard", controls: [{ key: "title" }, { key: "hasImage" }] },
      { name: "Toast" },
    ]),
    [],
  );
});

test("flags an empty study name", () => {
  const problems = findRegistryProblems([{ name: "  " }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /empty name/);
});

test("flags a duplicate study name", () => {
  const problems = findRegistryProblems([{ name: "Card" }, { name: "Card" }]);
  assert.deepEqual(problems, ["duplicate study name: Card"]);
});

test("flags a duplicate control key within a study", () => {
  const problems = findRegistryProblems([
    { name: "Card", controls: [{ key: "title" }, { key: "title" }] },
  ]);
  assert.deepEqual(problems, ["Card: duplicate control key: title"]);
});
