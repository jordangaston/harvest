import { Hono } from "hono";
import { ZodError } from "zod";
import { dbFromEnv } from "./edge-db.js";
import type { Database } from "./db.js";
import { toPublicUser } from "./models/user.js";
import { ImportService } from "./import-service.js";
import { UserService, type Resolution } from "./services/user-service.js";
import { OtpService } from "./services/otp-service.js";
import { RecipeService } from "./services/recipe-service.js";
import { CookbookService } from "./services/cookbook-service.js";
import { MealPlanService } from "./services/meal-plan-service.js";
import { GroceryService } from "./services/grocery-service.js";
import { toPublicGroceryItem } from "./models/grocery-item.js";
import { authGuard } from "./auth-guard.js";
import { normalizeE164 } from "./util/phone.js";
import { InvalidPhoneError } from "./util/phone.js";
import { AppError, OtpRequestFailedError, InvalidOtpError, NotFoundError, InvalidRangeError } from "./errors.js";
import {
  createUserSchema,
  signInSchema,
  requestOtpSchema,
  verifyOtpSchema,
  createImportSchema,
  createCookbookSchema,
  setMembershipSchema,
  updateRecipeSchema,
  listRecipesQuerySchema,
  rankedRecipesQuerySchema,
  deckQuerySchema,
  swipeBodySchema,
  createMealPlanEntrySchema,
  mealPlanRangeQuerySchema,
  addGroceryItemsSchema,
  patchGroceryItemSchema,
} from "./schemas.js";

/**
 * The Harvest HTTP API, ported from Fastify (server/src/api/app.ts) to Hono on
 * Vercel Functions via Nitro. S3 adds real bearer auth: `/v1/users` and
 * `/v1/users/sign_in` mint a per-user ES256 session; the auth guard resolves the
 * bearer to `authUserId`, which scopes imports and recipe ownership.
 */
type Vars = { authUserId: string };

/**
 * Builds the Hono app with its services wired to `db`. Tests pass a local
 * `file:` db; the deployed default export reads the Turso client from env.
 * @param db - The database the user/recipe repositories run against.
 */
export function buildApp(db: Database) {
  const app = new Hono<{ Variables: Vars }>();
  const users = UserService.create(db);
  const otps = OtpService.create();
  const imports = ImportService.create(db);
  const recipes = RecipeService.create(db);
  const cookbooks = CookbookService.create(db);
  const mealPlan = MealPlanService.create(db);
  const groceries = GroceryService.create(db);
  const guard = authGuard(users);

  app.get("/healthz", (c) => c.json({ ok: true }));

/** POST /v1/otps — sends an SMS verification code. Public. 502 if the send fails. */
app.post("/v1/otps", async (c) => {
  const { otp } = requestOtpSchema.parse(await c.req.json());
  const phone = normalizeE164(otp.phone_number);
  try {
    await otps.requestOtp(phone);
  } catch {
    throw new OtpRequestFailedError();
  }
  return c.json({ otp: { status: "pending" } });
});

/** POST /v1/otps/verify — checks a code without signing in. Public. 400 if wrong. */
app.post("/v1/otps/verify", async (c) => {
  const { otp } = verifyOtpSchema.parse(await c.req.json());
  if (!(await otps.verifyOtp(otp.phone_number, otp.code))) throw new InvalidOtpError();
  return c.json({ otp: { status: "approved" } });
});

/** POST /v1/users — creates (or resolves an existing) user and returns a session. Public. */
app.post("/v1/users", async (c) => {
  const { user } = createUserSchema.parse(await c.req.json());
  const resolved = await users.createUser({ phoneNumber: user.phone_number, name: user.name, onboarding: user.onboarding });
  return c.json(sessionResponse(resolved), 201);
});

/** POST /v1/users/sign_in — exchanges an OTP or refresh token for a session. Public. */
app.post("/v1/users/sign_in", async (c) => {
  const { auth } = signInSchema.parse(await c.req.json());
  return c.json(sessionResponse(await users.signIn(auth)));
});

/** GET /v1/users/me — the authenticated user. Requires bearer token; 401 without one. */
app.get("/v1/users/me", guard, async (c) => {
  const me = await users.getMe(c.get("authUserId")!);
  return c.json({ user: me });
});

/** DELETE /v1/users/me — permanently deletes the caller and cascades all their
 * data (recipes, cookbooks, meal-plan entries, grocery items, import jobs). 204. */
app.delete("/v1/users/me", guard, async (c) => {
  await users.deleteAccount(c.get("authUserId")!);
  return c.body(null, 204);
});

/** POST /v1/imports — enqueues an import for the caller. Requires bearer token. 202. */
app.post("/v1/imports", guard, async (c) => {
  const { source, faultStep } = createImportSchema.parse(await c.req.json());
  const job = await imports.create(c.get("authUserId")!, source, faultStep);
  if (!job) return c.json({ error: { code: "UNSUPPORTED", message: "not an importable source" } }, 422);
  return c.json({ job }, 202);
});

/** GET /v1/imports/:id — one of the caller's import jobs. Owner-scoped; 404 if foreign. */
app.get("/v1/imports/:id", guard, async (c) => {
  const job = await imports.get(c.get("authUserId")!, c.req.param("id")!);
  if (!job) throw new NotFoundError();
  return c.json({ job });
});

/** GET /v1/recipes — one page of the caller's library (owned ∪ cookbook recipes),
 * newest first. Cursor-paginated via `page_token`; `expand` opts into extra fields. */
app.get("/v1/recipes", guard, async (c) => {
  const { page_token, page_size, expand } = listRecipesQuerySchema.parse(c.req.query());
  const expandSet = new Set((expand ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  return c.json(await recipes.listCards(c.get("authUserId")!, { pageSize: page_size, cursor: page_token, expand: expandSet }));
});

/** GET /v1/recipes/ranked — the caller's owned catalog ranked best-first for their
 * preferences (WI-RANK-3). Hard filters drop unsafe/incompatible recipes; each item
 * carries a 0–100 score and its per-signal breakdown. Paginated over the ranked list
 * via `page_token` (a base64url start index). Registered before `/:id` so "ranked"
 * isn't captured as a recipe id. */
app.get("/v1/recipes/ranked", guard, async (c) => {
  const { page_token, page_size } = rankedRecipesQuerySchema.parse(c.req.query());
  return c.json(await recipes.ranked(c.get("authUserId")!, { pageSize: page_size, cursor: page_token }));
});

/** GET /v1/recipes/deck — the caller's swipe deck (WI-RANK-4): visible recipes (owned ∪
 * global) minus liked/on-cooldown, ranked best-first, top `limit`. No `page_token` — the
 * deck advances by swiping. Registered before `/:id` so "deck" isn't captured as an id. */
app.get("/v1/recipes/deck", guard, async (c) => {
  const { limit } = deckQuerySchema.parse(c.req.query());
  return c.json(await recipes.deck(c.get("authUserId")!, { limit }));
});

/** POST /v1/recipes/:id/swipe — records a like/dislike/save swipe and applies its side-effect
 * (like → Liked cookbook; save → Saved cookbook; reasoned dislike → preference tuning). Requires bearer token;
 * 404 if the recipe isn't visible to the caller. Registered before `/:id`. */
app.post("/v1/recipes/:id/swipe", guard, async (c) => {
  const { direction, reason, reason_detail } = swipeBodySchema.parse(await c.req.json());
  const swipe = await recipes.swipe(c.get("authUserId")!, c.req.param("id")!, { direction, reason, reasonDetail: reason_detail });
  return c.json({ swipe });
});

/** GET /v1/recipes/:id — a recipe with its ingredients and steps. Requires bearer
 * token. Not owner-scoped — recipes are shared, so any authenticated caller can open
 * one while browsing. 404 if the id is unknown. */
app.get("/v1/recipes/:id", guard, async (c) => {
  const recipe = await recipes.get(c.req.param("id")!);
  return c.json({ recipe });
});

/** PATCH /v1/recipes/:id — edits the owner's recipe ingredients/steps in place.
 * Requires bearer token; 404 if the caller isn't the owner. */
app.patch("/v1/recipes/:id", guard, async (c) => {
  const edit = updateRecipeSchema.parse(await c.req.json());
  const recipe = await recipes.update(c.get("authUserId")!, c.req.param("id")!, edit);
  return c.json({ recipe });
});

/** DELETE /v1/recipes/:id — removes the caller's recipe (children cascade).
 * Requires bearer token; 404 if not owned; 204 on success. */
app.delete("/v1/recipes/:id", guard, async (c) => {
  await recipes.remove(c.get("authUserId")!, c.req.param("id")!);
  return c.body(null, 204);
});

/** PUT /v1/recipes/:id/cookbooks — sets which of the caller's cookbooks hold this
 * recipe. Requires bearer token; 404 if the recipe is unknown. */
app.put("/v1/recipes/:id/cookbooks", guard, async (c) => {
  const { cookbook_ids } = setMembershipSchema.parse(await c.req.json());
  const applied = await cookbooks.setMembership(c.get("authUserId")!, c.req.param("id")!, cookbook_ids);
  return c.json({ cookbook_ids: applied });
});

/** POST /v1/cookbooks — creates a named cookbook for the caller. Requires bearer
 * token. 201 on success; 409 on a duplicate name. */
app.post("/v1/cookbooks", guard, async (c) => {
  const { cookbook } = createCookbookSchema.parse(await c.req.json());
  const created = await cookbooks.create(c.get("authUserId")!, cookbook.name);
  return c.json({ cookbook: created }, 201);
});

/** GET /v1/cookbooks — lists the caller's cookbooks with counts and covers. */
app.get("/v1/cookbooks", guard, async (c) => {
  const list = await cookbooks.list(c.get("authUserId")!);
  return c.json({ cookbooks: list });
});

/** GET /v1/cookbooks/:id — one of the caller's cookbooks with its recipe cards.
 * Requires bearer token; 404 if it isn't the caller's. */
app.get("/v1/cookbooks/:id", guard, async (c) => {
  return c.json(await cookbooks.get(c.get("authUserId")!, c.req.param("id")!));
});

/** GET /v1/meal-plan?start&end — the caller's entries in an inclusive date range,
 * each with its recipe card. 400 if the range is missing, malformed, or > 31 days. */
app.get("/v1/meal-plan", guard, async (c) => {
  const { start, end } = mealPlanRangeQuerySchema.parse(c.req.query());
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (!(days >= 0 && days <= 31)) throw new InvalidRangeError();
  const entries = await mealPlan.listRange(c.get("authUserId")!, start, end);
  return c.json({ entries });
});

/** POST /v1/meal-plan — assigns a recipe to a (date, meal) slot, appended to the
 * slot. 201 with the entry; 404 if the recipe is unknown. */
app.post("/v1/meal-plan", guard, async (c) => {
  const { entry } = createMealPlanEntrySchema.parse(await c.req.json());
  const created = await mealPlan.add(c.get("authUserId")!, entry.date, entry.meal, entry.recipe_id);
  return c.json({ entry: created }, 201);
});

/** DELETE /v1/meal-plan/:id — removes one of the caller's entries. 404 if not the
 * caller's; 204 on success. */
app.delete("/v1/meal-plan/:id", guard, async (c) => {
  await mealPlan.remove(c.get("authUserId")!, c.req.param("id")!);
  return c.body(null, 204);
});

/** GET /v1/grocery_items — the caller's grocery list (flat; the client groups/sorts). */
app.get("/v1/grocery_items", guard, async (c) => {
  const items = await groceries.list(c.get("authUserId")!);
  return c.json({ items: items.map(toPublicGroceryItem) });
});

/** POST /v1/grocery_items — adds one or many items. Resolves aisle/icon + default
 * unit and merges by name+unit. 201. */
app.post("/v1/grocery_items", guard, async (c) => {
  const { items } = addGroceryItemsSchema.parse(await c.req.json());
  const created = await groceries.add(
    c.get("authUserId")!,
    items.map((i) => ({
      name: i.name,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
      quantityText: i.quantity_text ?? null,
      sourceRecipeId: i.source_recipe_id ?? null,
    })),
  );
  return c.json({ items: created.map(toPublicGroceryItem) }, 201);
});

/** PATCH /v1/grocery_items/:id — check off or edit a quantity. 404 if not the caller's. */
app.patch("/v1/grocery_items/:id", guard, async (c) => {
  const patch = patchGroceryItemSchema.parse(await c.req.json());
  const item = await groceries.patch(c.get("authUserId")!, c.req.param("id")!, patch);
  return c.json({ item: toPublicGroceryItem(item) });
});

/** DELETE /v1/grocery_items/:id — remove an item. 204; 404 if not the caller's. */
app.delete("/v1/grocery_items/:id", guard, async (c) => {
  await groceries.remove(c.get("authUserId")!, c.req.param("id")!);
  return c.body(null, 204);
});

/** GET /v1/ingredients/common?q= — the common-ingredients catalog for the picker
 * and Meal Planning. `q` filters by substring. */
app.get("/v1/ingredients/common", guard, async (c) => {
  return c.json({ ingredients: groceries.common(c.req.query("q")) });
});

  app.onError((error, c) => {
    const appError = toAppError(error);
    return c.json({ error: { code: appError.code, message: appError.message } }, appError.status as never);
  });

  return app;
}

// Deployed entry: a thin Hono that lazily builds the env-wired app on first
// request, so importing this module (e.g. under vitest) never calls dbFromEnv().
let envApp: Hono<{ Variables: Vars }> | undefined;
const app = new Hono<{ Variables: Vars }>();
app.all("/*", (c) => (envApp ??= buildApp(dbFromEnv())).fetch(c.req.raw));

export default app;

/**
 * Shapes a resolved user + tokens into the wire session payload.
 * @param resolved - user, token pair, and whether the account was just created.
 */
function sessionResponse(resolved: Resolution) {
  return {
    user: toPublicUser(resolved.user),
    auth: { access_token: resolved.tokens.access_token, refresh_token: resolved.tokens.refresh_token },
    isNew: resolved.isNew,
  };
}

/**
 * Maps any thrown value to an AppError. InvalidPhoneError and ZodError become 400s;
 * anything unrecognized collapses to a 500 INTERNAL (details not leaked to the client).
 * @param error - the caught value, of unknown type.
 */
function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InvalidPhoneError) return new AppError("INVALID_PHONE", 400, "phone_number is invalid");
  if (error instanceof ZodError)
    return new AppError("INVALID_REQUEST", 400, error.issues[0]?.message ?? "invalid request");
  return new AppError("INTERNAL", 500, "internal error");
}
