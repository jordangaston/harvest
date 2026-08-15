import { z } from 'zod';
import { OnboardingSchema } from '../models/user.js';

export const requestOtpSchema = z.object({
  otp: z.object({ phone_number: z.string() }),
});

export const verifyOtpSchema = z.object({
  otp: z.object({ phone_number: z.string(), code: z.string() }),
});

export const createUserSchema = z.object({
  user: z.object({
    phone_number: z.string(),
    onboarding: OnboardingSchema.optional(),
  }),
});

export const createImportSchema = z.object({
  source: z
    .object({
      url: z.string().optional(),
      share_payload: z.object({ url: z.string().optional(), text: z.string().optional() }).optional(),
      image_ref: z.string().optional(),
    })
    .refine(
      (source) => [source.url, source.share_payload, source.image_ref].filter(Boolean).length === 1,
      { message: 'provide exactly one of url, share_payload, or image_ref' },
    ),
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
    message: 'provide ingredients and/or steps',
  });

/** `GET /v1/recipes` query: cursor pagination + an opt-in expand csv. */
export const listRecipesQuerySchema = z.object({
  page_token: z.string().optional(),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
  expand: z.string().optional(),
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
      message: 'provide exactly one of otp or refresh_token',
    }),
});
