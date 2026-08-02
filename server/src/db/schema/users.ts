import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, jsonb, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    phone: text('phone').notNull(),
    jwtPrivateKey: text('jwt_private_key').notNull(),
    jwtPublicKey: text('jwt_public_key').notNull(),
    accessTokenNonce: integer('access_token_nonce').notNull().default(0),
    refreshTokenNonce: integer('refresh_token_nonce').notNull().default(0),
    onboarding: jsonb('onboarding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_phone_uidx').on(table.phone)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
