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
import { authGuard } from "./auth-guard.js";
import { normalizeE164 } from "./util/phone.js";
import { InvalidPhoneError } from "./util/phone.js";
import { AppError, OtpRequestFailedError, InvalidOtpError, NotFoundError } from "./errors.js";
import {
  createUserSchema,
  signInSchema,
  requestOtpSchema,
  verifyOtpSchema,
  createCookbookSchema,
  setMembershipSchema,
  updateRecipeSchema,
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
  const imports = new ImportService();
  const recipes = RecipeService.create(db);
  const cookbooks = CookbookService.create(db);
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
  const resolved = await users.createUser({ phoneNumber: user.phone_number, onboarding: user.onboarding });
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

/** POST /v1/imports — enqueues an import for the caller. Requires bearer token. 202. */
app.post("/v1/imports", guard, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    source?: { url?: string };
    image_ref?: string;
    faultStep?: "extract";
  };
  const job = await imports.create(
    c.get("authUserId")!,
    { url: body.source?.url, image_ref: body.image_ref },
    body.faultStep,
  );
  if (!job) return c.json({ error: { code: "UNSUPPORTED", message: "not an importable source" } }, 422);
  return c.json({ job }, 202);
});

/** GET /v1/imports/:id — one of the caller's import jobs. Owner-scoped; 404 if foreign. */
app.get("/v1/imports/:id", guard, async (c) => {
  const job = await imports.get(c.get("authUserId")!, c.req.param("id")!);
  if (!job) throw new NotFoundError();
  return c.json({ job });
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
