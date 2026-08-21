import { z } from "zod";
import { OnboardingSchema } from "./models/user.js";
import { SWIPE_REASONS } from "./schema.js";
import { DECK_DEFAULT_LIMIT } from "./ranking/constants.js";

export const requestOtpSchema = z.object({
  otp: z.object({ phone_number: z.string() }),
});

export const verifyOtpSchema = z.object({
  otp: z.object({ phone_number: z.string(), code: z.string() }),
});

export const createUserSchema = z.object({
  user: z.object({
    phone_number: z.string(),
    // Optional in the serverless stack (unlike main's required code+name): the
    // offline test harness and e2e provision with phone_number only. Verification
    // stays at POST /v1/otps/verify; `name` is threaded through when supplied.
    name: z.string().trim().min(1).optional(),
    onboarding: OnboardingSchema.optional(),
  }),
});

/** `POST /v1/users/anonymous` body: an optional prior device key (resolves an
 * existing anon user across reinstalls) and optional onboarding to persist. */
export const anonUserSchema = z.object({
  device_key: z.string().optional(),
  onboarding: OnboardingSchema.optional(),
});

/** `POST /v1/imports` body: exactly one of a url, a share payload, or a photo ref. */
export const createImportSchema = z.object({
  source: z
    .object({
      url: z.string().optional(),
      share_payload: z.object({ url: z.string().optional(), text: z.string().optional() }).optional(),
      image_ref: z.string().optional(),
    })
    .refine((source) => [source.url, source.share_payload, source.image_ref].filter(Boolean).length === 1, {
      message: 'provide exactly one of url, share_payload, or image_ref',
    }),
  faultStep: z.literal('extract').optional(),
});

export const createCookbookSchema = z.object({
  cookbook: z.object({ name: z.string().trim().min(1) }),
});

export const setMembershipSchema = z.object({
  cookbook_ids: z.array(z.string().uuid()),
});

export const updateRecipeSchema = z
  .object({
    ingredients: z.array(z.string()).optional(),
    steps: z.array(z.string()).optional(),
  })
  .refine((body) => body.ingredients !== undefined || body.steps !== undefined, {
    message: "provide ingredients and/or steps",
  });

export const addGroceryItemsSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        amount: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        quantity_text: z.string().nullable().optional(),
        source_recipe_id: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1),
});

export const patchGroceryItemSchema = z
  .object({
    checked: z.boolean().optional(),
    amount: z.number().nullable().optional(),
    unit: z.string().nullable().optional(),
  })
  .refine((body) => body.checked !== undefined || body.amount !== undefined || body.unit !== undefined, {
    message: 'provide checked, amount, and/or unit',
  });

/** `GET /v1/recipes` query: cursor pagination + an opt-in expand csv. */
export const listRecipesQuerySchema = z.object({
  page_token: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  expand: z.string().optional(),
});

/** `GET /v1/recipes/ranked` query: cursor pagination over the ranked catalog. */
export const rankedRecipesQuerySchema = z.object({
  page_token: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

/** `GET /v1/recipes/deck` query: how many top cards to return (no paging — swipe to advance). */
export const deckQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(DECK_DEFAULT_LIMIT),
  // Meal-type filter: comma-separated recipe_categories values (any facet); a recipe matches
  // if it carries any. ABSENT (undefined) = use the user's default from their plan; PRESENT but
  // empty (`?categories=`) = explicit show-all; values = filter to those.
  categories: z.string().optional().transform((s) => (s === undefined ? undefined : s.split(",").map((v) => v.trim()).filter(Boolean))),
});

/** `POST /v1/recipes/:id/swipe` body: like/dislike/save + an optional dislike reason and its detail. */
export const swipeBodySchema = z.object({
  direction: z.enum(["like", "dislike", "save"]),
  reason: z.enum(SWIPE_REASONS).optional(),
  reason_detail: z.string().optional(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

/** `POST /v1/meal-plan` body: assign one recipe to a (date, meal) slot. */
export const createMealPlanEntrySchema = z.object({
  entry: z.object({
    date: isoDate,
    meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    recipe_id: z.string().uuid(),
  }),
});

/** `GET /v1/meal-plan` query: an inclusive date range. */
export const mealPlanRangeQuerySchema = z.object({ start: isoDate, end: isoDate });

export const signInSchema = z.object({
  auth: z
    .object({
      otp: z.object({ phone_number: z.string(), code: z.string() }).optional(),
      refresh_token: z.string().optional(),
    })
    .refine((auth) => Boolean(auth.otp) !== Boolean(auth.refresh_token), {
      message: "provide exactly one of otp or refresh_token",
    }),
});
