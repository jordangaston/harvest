import { z } from 'zod';

// Domain model. Repositories parse rows into this at the boundary.
export const UserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  jwtPrivateKey: z.string(),
  jwtPublicKey: z.string(),
  accessTokenNonce: z.number().int(),
  refreshTokenNonce: z.number().int(),
  onboarding: z.unknown().nullable(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

// What we expose over the API — never key material.
export function toPublicUser(user: User): { id: string; phone: string } {
  return { id: user.id, phone: user.phone };
}
