import { z } from "zod";
import { OnboardingSchema } from "./models/user.js";

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
