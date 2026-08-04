import { z } from 'zod';

export const requestOtpSchema = z.object({
  otp: z.object({ phone_number: z.string() }),
});

export const verifyOtpSchema = z.object({
  otp: z.object({ phone_number: z.string(), code: z.string() }),
});

export const createUserSchema = z.object({
  user: z.object({
    phone_number: z.string(),
    onboarding: z.unknown().optional(),
  }),
});

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
