import { sql } from 'drizzle-orm';
import { index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * The online-mode room directory (src/online/directory.ts): who is in each room, which slot they
 * hold and who hosts. Held in memory while the API runs and written through here, so a deploy
 * restarting the API does not end every room in progress.
 */
export const onlineRooms = pgTable('online_rooms', {
  code: text('code').primaryKey(),
  state: jsonb('state').notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
});

export const userRole = pgEnum('user_role', ['singer', 'admin']);
export type UserRole = (typeof userRole.enumValues)[number];

/** A destiny.gg account that has signed in at least once. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    dggUserId: text('dgg_user_id').notNull(),
    username: text('username').notNull(),
    role: userRole('role').notNull().default('singer'),
    /** The destiny.gg flair the username takes its colour from, or null for no colour. */
    flair: text('flair'),
    dggStatus: text('dgg_status').notNull(),
    // Destiny's roles and features as they arrived, kept so a role mapping can be checked against them.
    dggRoles: text('dgg_roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dggFeatures: text('dgg_features')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_dgg_user_id_unique').on(table.dggUserId)],
);

/** A sign-in that has left for destiny.gg and not come back yet. Only the state's hash is kept. */
export const oauthLoginTransactions = pgTable(
  'oauth_login_transactions',
  {
    stateHash: text('state_hash').primaryKey(),
    codeVerifier: text('code_verifier').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('oauth_login_expires_at_index').on(table.expiresAt)],
);

/** Our own sessions. The cookie holds the token; only its hash is stored. */
export const sessions = pgTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_user_id_index').on(table.userId), index('sessions_expires_at_index').on(table.expiresAt)],
);
