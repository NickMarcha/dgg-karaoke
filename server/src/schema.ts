import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

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

/** A moderator looks after the songs; an admin also appoints moderators. */
export const userRole = pgEnum('user_role', ['singer', 'moderator', 'admin']);
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

/**
 * One singer's best run of one song at one difficulty. Rows are kept for good: the main menu's
 * board looks back a fortnight, but a song's own board is all-time.
 */
export const leaderboardRecords = pgTable(
  'leaderboard_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    songId: text('song_id').notNull(),
    // Kept with the row so the board shows a song the site no longer has
    artist: text('artist').notNull(),
    title: text('title').notNull(),
    songLastUpdate: text('song_last_update'),
    score: integer('score').notNull(),
    tolerance: smallint('tolerance').notNull(),
    mode: text('mode').notNull(),
    trackIndex: smallint('track_index').notNull(),
    inputLag: integer('input_lag').notNull(),
    notesHash: text('notes_hash').notNull(),
    /** When the run was sung: a better run replaces the row and its date. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('leaderboard_records_best_unique').on(table.userId, table.songId, table.tolerance),
    index('leaderboard_records_song_index').on(table.songId, table.tolerance, table.score),
    index('leaderboard_records_global_index').on(table.createdAt, table.score),
  ],
);

/**
 * The sung frequency records behind a row, msgpack-packed by the game. Apart from the rows so a
 * board query never loads them; kept for checking and replaying runs (layer 5 of the plan).
 */
export const leaderboardNotes = pgTable('leaderboard_notes', {
  recordId: uuid('record_id')
    .primaryKey()
    .references(() => leaderboardRecords.id, { onDelete: 'cascade' }),
  notes: bytea('notes').notNull(),
});

/**
 * Where a community song stands: `submitted` (playable as unverified, waiting for a moderator),
 * `published` (in everyone's song list), `rejected` (with a reason the submitter sees), `archived`
 * (a published version a newer one replaced).
 */
export const songStatus = pgEnum('song_status', ['submitted', 'published', 'rejected', 'archived']);
export type SongStatus = (typeof songStatus.enumValues)[number];

/**
 * A song somebody signed in submitted from the editor. `txt` is the UltraStar file the game reads;
 * `preview` is what the song list shows, worked out by the browser that last saved the song.
 */
export const communitySongs = pgTable(
  'community_songs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** The game's id for the song, from its artist and title. */
    songId: text('song_id').notNull(),
    artist: text('artist').notNull(),
    title: text('title').notNull(),
    txt: text('txt').notNull(),
    preview: jsonb('preview').notNull(),
    status: songStatus('status').notNull().default('submitted'),
    rejectionReason: text('rejection_reason'),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One published version of a song at a time
    uniqueIndex('community_songs_published_unique')
      .on(table.songId)
      .where(sql`${table.status} = 'published'`),
    index('community_songs_status_index').on(table.status, table.updatedAt),
  ],
);

/** The song of each UTC day: picked from the site's popular songs when first asked for, or by a moderator. */
export const dailySongs = pgTable('daily_songs', {
  day: date('day', { mode: 'string' }).primaryKey(),
  songId: text('song_id').notNull(),
  /** The moderator who chose it; null for the automatic pick. */
  chosenBy: uuid('chosen_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A singer's best run of a day's song on that day, for the day's own board. */
export const dailyRuns = pgTable(
  'daily_runs',
  {
    day: date('day', { mode: 'string' }).notNull(),
    songId: text('song_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    tolerance: smallint('tolerance').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.day, table.songId, table.userId] })],
);
