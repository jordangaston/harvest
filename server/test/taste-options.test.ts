import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { tasteIngredients } from "../src/schema.js";
import { TasteIngredientRepository } from "../src/repositories/taste-ingredient-repository.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/**
 * F-TO-1: GET /v1/taste-options + TasteIngredientRepository. Offline against a migrated
 * `file:` libSQL db; mint a bearer via POST /v1/users and drive the endpoint through app.request.
 */
let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

const OKRA_ID = "ti-okra";

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
  await db.insert(tasteIngredients).values([
    { id: OKRA_ID, label: "Okra", section: "Vegetables", foodGroup: 7 },
    { id: "ti-chicken", label: "Chicken", section: "Meat & Seafood", foodGroup: 2 },
  ]);
});
afterEach(() => cleanup());

async function mintToken(): Promise<string> {
  const phone = `+1555558${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  return (await res.json()).auth.access_token.jwt;
}

describe("TasteIngredientRepository", () => {
  it("returns the rows as {value,label,section}, ordered by (section, label)", async () => {
    const rows = await TasteIngredientRepository.create(db).ingredients();
    expect(rows).toEqual([
      { value: "ti-chicken", label: "Chicken", section: "Meat & Seafood" },
      { value: OKRA_ID, label: "Okra", section: "Vegetables" },
    ]);
  });
});

describe("GET /v1/taste-options", () => {
  it("serves the three facets; ingredients come from taste_ingredients", async () => {
    const token = await mintToken();
    const res = await app.request("/v1/taste-options", { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const { taste_options } = await res.json();

    // Cuisines + dish types are the code VOCAB with derived labels; the expanded hierarchy is present.
    expect(taste_options.cuisines).toContainEqual({ value: "tex_mex", label: "Tex-Mex" });
    expect(taste_options.cuisines).toContainEqual({ value: "italian", label: "Italian" });
    expect(taste_options.dish_types).toContainEqual({ value: "stir_fry", label: "Stir Fry" });

    // Ingredients are the seeded base ingredients, each value a real taste_ingredients id.
    expect(taste_options.ingredients).toContainEqual({ value: OKRA_ID, label: "Okra", section: "Vegetables" });
    expect(taste_options.ingredients.every((i: { value: string }) => typeof i.value === "string" && i.value.length > 0)).toBe(true);
  });

  it("returns 304 when the client sends a matching if-none-match", async () => {
    const token = await mintToken();
    const first = await app.request("/v1/taste-options", { headers: { authorization: `Bearer ${token}` } });
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect(first.headers.get("cache-control")).toContain("max-age=86400");

    const second = await app.request("/v1/taste-options", {
      headers: { authorization: `Bearer ${token}`, "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });

  it("401 without a bearer", async () => {
    expect((await app.request("/v1/taste-options")).status).toBe(401);
  });
});
