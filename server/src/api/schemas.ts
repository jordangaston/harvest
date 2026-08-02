import { z } from 'zod';

/** `POST /v1/otps` body. Phone shape is validated downstream by normalizeE164;
 * here we only require a non-empty string so an empty field is a clean 400. */
export const sendOtpBody = z.object({
  otp: z.object({
    phone_number: z.string().min(1),
  }),
});
export type SendOtpBody = z.infer<typeof sendOtpBody>;

/** `POST /v1/users` body — create account after verifying the OTP. */
export const createUserBody = z.object({
  user: z.object({
    phone_number: z.string().min(1),
    code: z.string().min(1),
    onboarding: z.unknown().optional(),
  }),
});
export type CreateUserBody = z.infer<typeof createUserBody>;

const otpAuth = z.object({
  phone_number: z.string().min(1),
  code: z.string().min(1),
});

/** `POST /v1/users/sign_in` body — exactly one of otp or refresh_token. */
export const signInBody = z.object({
  auth: z
    .object({
      otp: otpAuth.optional(),
      refresh_token: z.string().min(1).optional(),
    })
    .refine((a) => Boolean(a.otp) !== Boolean(a.refresh_token), {
      message: 'exactly one of otp or refresh_token is required',
    }),
});
export type SignInBody = z.infer<typeof signInBody>;
