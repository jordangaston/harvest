import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { extractLabel } from "./label.ts";

test("reads a plain string child", () => {
  assert.equal(extractLabel("Continue"), "Continue");
});

test("trims and drops whitespace-only", () => {
  assert.equal(extractLabel("  Save  "), "Save");
  assert.equal(extractLabel("   "), undefined);
});

test("reads the string inside a wrapper element (ButtonText)", () => {
  const child = React.createElement("Text", null, "Add to cookbook");
  assert.equal(extractLabel(child), "Add to cookbook");
});

test("finds the first string in mixed children (icon + label)", () => {
  const icon = React.createElement("Icon", { name: "add" });
  const text = React.createElement("Text", null, "Import");
  assert.equal(extractLabel([icon, text]), "Import");
});

test("returns undefined for icon-only / opaque children (no [object Object])", () => {
  const icon = React.createElement("Icon", { name: "add" });
  assert.equal(extractLabel(icon), undefined);
  assert.equal(extractLabel(null), undefined);
});
