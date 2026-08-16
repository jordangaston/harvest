import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Architect must-fix (ported from tests/unit/icon-lockstep.test.ts): the two icon
 * maps must stay in lockstep. An ingredient icon lives in three places — a keyword
 * row in `server/src/parse/icons.ts` (name → key), the app `ICON` map in
 * `components/recime/recipes.ts` (key → asset), and the PNG in `assets/ingredients/`.
 * A key in one but not the others renders blank, so this fails the build on drift.
 *
 * From `server/test/`, the repo root is two levels up (`server/` then repo root).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const iconsSrc = readFileSync(join(ROOT, "server/src/parse/icons.ts"), "utf8");
const recipesSrc = readFileSync(join(ROOT, "components/recime/recipes.ts"), "utf8");

/** Icon keys the server keyword map can emit (the `'key'` in each `[/re/, 'key']` row). */
const keywordTargets = [...iconsSrc.matchAll(/,\s*'([A-Za-z]+)'\]/g)].map((m) => m[1]!);

/** The app ICON map: key → asset filename (`key: require(".../file.jpg")`). */
const iconMap = new Map(
  [...recipesSrc.matchAll(/(\w+):\s*require\("\.\.\/\.\.\/assets\/ingredients\/([\w-]+\.jpg)"\)/g)].map(
    (m) => [m[1]!, m[2]!] as const,
  ),
);

describe("icon map lockstep", () => {
  it("every keyword-map target resolves to a key in the app ICON map", () => {
    const missing = [...new Set(keywordTargets)].filter((key) => !iconMap.has(key));
    expect(missing, `keyword targets with no ICON entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("every app ICON entry points at an asset file that exists", () => {
    const missing = [...iconMap.entries()]
      .filter(([, file]) => !existsSync(join(ROOT, "assets/ingredients", file)))
      .map(([key, file]) => `${key}→${file}`);
    expect(missing, `ICON entries with no asset file: ${missing.join(", ")}`).toEqual([]);
  });
});
