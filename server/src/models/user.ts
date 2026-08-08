import { z } from 'zod';
import {
  goalEnum,
  recipeSourceEnum,
  weekdayEnum,
  whenCookEnum,
  cookTimeEnum,
  howHeardEnum,
  ageBandEnum,
} from '../db/schema/enums.js';

const asEnum = <T extends readonly [string, ...string[]]>(values: T | readonly string[]) =>
  z.enum(values as unknown as [string, ...string[]]);

/** C2 onboarding payload: typed enum values (multi-selects are arrays). Every
 * field is optional — a user may skip a screen. The mobile accumulator maps
 * display labels to these enum values before POSTing. */
export const OnboardingSchema = z.object({
  goals: z.array(asEnum(goalEnum.enumValues)).optional(),
  recipe_sources: z.array(asEnum(recipeSourceEnum.enumValues)).optional(),
  cook_days: z.array(asEnum(weekdayEnum.enumValues)).optional(),
  when_cook: asEnum(whenCookEnum.enumValues).optional(),
  cook_time: asEnum(cookTimeEnum.enumValues).optional(),
  how_heard: asEnum(howHeardEnum.enumValues).optional(),
  age: asEnum(ageBandEnum.enumValues).optional(),
});

export type Onboarding = z.infer<typeof OnboardingSchema>;

// Domain model. Repositories parse rows into this at the boundary.
export const UserSchema = z.object({
  id: z.string().uuid(),
  phone: z.string(),
  jwtPrivateKey: z.string(),
  jwtPublicKey: z.string(),
  accessTokenNonce: z.number().int(),
  refreshTokenNonce: z.number().int(),
  goals: z.array(asEnum(goalEnum.enumValues)).nullable(),
  recipeSources: z.array(asEnum(recipeSourceEnum.enumValues)).nullable(),
  cookDays: z.array(asEnum(weekdayEnum.enumValues)).nullable(),
  whenCook: asEnum(whenCookEnum.enumValues).nullable(),
  cookTime: asEnum(cookTimeEnum.enumValues).nullable(),
  howHeard: asEnum(howHeardEnum.enumValues).nullable(),
  age: asEnum(ageBandEnum.enumValues).nullable(),
  onboardingCompletedAt: z.date().nullable(),
  createdAt: z.date(),
});

export type User = z.infer<typeof UserSchema>;

/**
 * Projects a user to the API-safe shape — never key material or nonces.
 * @param user - The domain user.
 * @returns Only the id and phone.
 */
export function toPublicUser(user: User): { id: string; phone: string } {
  return { id: user.id, phone: user.phone };
}
