import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  goalEnum,
  recipeSourceEnum,
  weekdayEnum,
  whenCookEnum,
  cookTimeEnum,
  howHeardEnum,
  ageBandEnum,
} from './enums.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    phone: text('phone').notNull(),
    name: text('name'),
    jwtPrivateKey: text('jwt_private_key').notNull(),
    jwtPublicKey: text('jwt_public_key').notNull(),
    accessTokenNonce: integer('access_token_nonce').notNull().default(0),
    refreshTokenNonce: integer('refresh_token_nonce').notNull().default(0),
    // C2 onboarding: typed enum columns (replaced a non-queryable jsonb blob). All
    // nullable — a user may skip a screen. Multi-selects are enum[].
    goals: goalEnum('goals').array(),
    recipeSources: recipeSourceEnum('recipe_sources').array(),
    cookDays: weekdayEnum('cook_days').array(),
    whenCook: whenCookEnum('when_cook'),
    cookTime: cookTimeEnum('cook_time'),
    howHeard: howHeardEnum('how_heard'),
    age: ageBandEnum('age'),
    onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_phone_uidx').on(table.phone)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
