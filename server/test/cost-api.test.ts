import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { type Database } from "../src/db.js";
import { RecipeRepository, type RecipeInput } from "../src/repositories/recipe-repository.js";
import { buildApp } from "../src/index.js";
import { migratedFileDb } from "./helpers/migrated-db.js";

/** WI-CS-3 — the detail + list endpoints expose the persisted cost fields. */

const baseInput = (title: string, cost: RecipeInput["cost"]): RecipeInput => ({
  title,
  sourceType: "website",
  servings: 4,
  servingsEstimated: false,
  ingredients: [],
  steps: [],
  nutrition: null,
  allergens: null,
  cost,
});

let db: Database;
let cleanup: () => void;
let app: ReturnType<typeof buildApp>;
let phoneSeq = 0;

beforeEach(async () => {
  ({ db, cleanup } = await migratedFileDb());
  app = buildApp(db);
});
afterEach(() => cleanup());

async function mintBearer(): Promise<{ token: string; userId: string }> {
  const phone = `+1555559${String(1000 + phoneSeq++).slice(-4)}`;
  const res = await app.request("/v1/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: { phone_number: phone } }),
  });
  const body = await res.json();
  return { token: body.auth.access_token.jwt, userId: body.user.id };
}

describe("GET /v1/recipes/:id cost (WI-CS-3 TC1/TC2)", () => {
  it("returns cost_per_serving_cents + cost_coverage (as a number) when priced", async () => {
    const { token, userId } = await mintBearer();
    const repo = RecipeRepository.create(db);
    const id = await repo.persist(baseInput("Priced", { centsPerServing: 214, coverage: 0.92 }), userId);

    const res = await app.request(`/v1/recipes/${id}`, { headers: { authorization: `Bearer ${token}` } });
    const { recipe } = await res.json();
    expect(recipe.cost_per_serving_cents).toBe(214);
    expect(recipe.cost_coverage).toBe(0.92);
    expect(typeof recipe.cost_coverage).toBe("number");
  });

  it("round-trips null cost as null (present, not 0, not omitted)", async () => {
    const { token, userId } = await mintBearer();
    const id = await RecipeRepository.create(db).persist(baseInput("Free", null), userId);

    const res = await app.request(`/v1/recipes/${id}`, { headers: { authorization: `Bearer ${token}` } });
    const { recipe } = await res.json();
    expect(recipe).toHaveProperty("cost_per_serving_cents", null);
    expect(recipe).toHaveProperty("cost_coverage", null);
  });
});

describe("GET /v1/recipes cost on cards (WI-CS-3 TC3)", () => {
  it("carries both cost fields per card (priced and null)", async () => {
    const { token, userId } = await mintBearer();
    const repo = RecipeRepository.create(db);
    await repo.persist(baseInput("Priced", { centsPerServing: 214, coverage: 0.92 }), userId);
    await repo.persist(baseInput("Free", null), userId);

    const res = await app.request("/v1/recipes", { headers: { authorization: `Bearer ${token}` } });
    const cards = (await res.json()).recipes as Array<Record<string, unknown>>;
    const priced = cards.find((c) => c.title === "Priced")!;
    const free = cards.find((c) => c.title === "Free")!;
    expect(priced.cost_per_serving_cents).toBe(214);
    expect(priced.cost_coverage).toBe(0.92);
    expect(free).toHaveProperty("cost_per_serving_cents", null);
    expect(free).toHaveProperty("cost_coverage", null);
  });
});
