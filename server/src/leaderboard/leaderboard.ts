import { and, asc, count, desc, eq, gt, gte, ilike, lte, or, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import { containing } from '../like.js';
import {
  leaderboardNotes,
  leaderboardRecordings,
  leaderboardRecords,
  type RunFlagKind,
  runFlags,
  type RunStatus,
  users,
} from '../schema.js';
import {
  GLOBAL_BOARD_SIZE,
  GLOBAL_BOARD_WINDOW_MS,
  MAX_GLOBAL_BOARD_TOLERANCE,
  SONG_BOARD_NEIGHBOURS,
  SONG_BOARD_SIZE,
} from './rules.js';
import type { ScoredSubmission } from './submission.js';

/** A public row: who, what and when, nothing that identifies the account beyond its name. */
const entry = {
  id: leaderboardRecords.id,
  status: leaderboardRecords.status,
  name: users.username,
  flair: users.flair,
  score: leaderboardRecords.score,
  artist: leaderboardRecords.artist,
  title: leaderboardRecords.title,
  songId: leaderboardRecords.songId,
  tolerance: leaderboardRecords.tolerance,
  createdAt: sql<number>`(extract(epoch from ${leaderboardRecords.createdAt}) * 1000)::bigint`.mapWith(Number),
};

const MODERATION_PAGE_SIZE = 50;

/** How many players vouched for (or reported) a run. */
const flagCount = (kind: RunFlagKind) =>
  sql<number>`(select count(*) from ${runFlags} where ${runFlags.recordId} = ${leaderboardRecords.id} and ${runFlags.kind} = ${kind})`.mapWith(
    Number,
  );

/** Only verified runs, for a board's "Verified only" switch. */
const verifiedOnly = (verified: boolean) => (verified ? eq(leaderboardRecords.status, 'verified') : undefined);

/** Best first; a tie goes to whoever got there first. */
const ranking = [desc(leaderboardRecords.score), asc(leaderboardRecords.createdAt)];

export class Leaderboard {
  constructor(private readonly database: Database) {}

  /**
   * Keeps the run if it beats the singer's best at this song and difficulty, Recorded when it comes
   * with the singer's voice. Its recording, vouches and reports belonged to the run it replaced and go
   * with it. Says whether it was kept.
   */
  public async submit(userId: string, run: ScoredSubmission): Promise<boolean> {
    const { notes, records, recording, recordingType, recordingOffsetMs, ...record } = run;
    const status: RunStatus = recording ? 'recorded' : 'score';
    return this.database.transaction(async (transaction) => {
      const [kept] = await transaction
        .insert(leaderboardRecords)
        .values({ userId, ...record, status, createdAt: new Date() })
        .onConflictDoUpdate({
          target: [leaderboardRecords.userId, leaderboardRecords.songId, leaderboardRecords.tolerance],
          set: { ...record, status, createdAt: new Date() },
          setWhere: sql`excluded.score > ${leaderboardRecords.score}`,
        })
        .returning({ id: leaderboardRecords.id });
      if (!kept) return false;

      await transaction
        .insert(leaderboardNotes)
        .values({ recordId: kept.id, notes: Buffer.from(notes) })
        .onConflictDoUpdate({ target: leaderboardNotes.recordId, set: { notes: Buffer.from(notes) } });
      await transaction.delete(leaderboardRecordings).where(eq(leaderboardRecordings.recordId, kept.id));
      await transaction.delete(runFlags).where(eq(runFlags.recordId, kept.id));
      if (recording) {
        await transaction.insert(leaderboardRecordings).values({
          recordId: kept.id,
          audio: Buffer.from(recording),
          type: recordingType!,
          offsetMs: recordingOffsetMs!,
        });
      }
      return true;
    });
  }

  /** One run on the board in full, for its page; `viewerId` adds how that player flagged it. */
  public async run(id: string, viewerId: string | null) {
    const [row] = await this.database
      .select({
        ...entry,
        userId: leaderboardRecords.userId,
        recordingType: leaderboardRecordings.type,
        recordingOffsetMs: leaderboardRecordings.offsetMs,
        vouches: flagCount('vouch'),
        reports: flagCount('report'),
      })
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .leftJoin(leaderboardRecordings, eq(leaderboardRecordings.recordId, leaderboardRecords.id))
      .where(eq(leaderboardRecords.id, id));
    if (!row) return null;

    const [own] = viewerId
      ? await this.database
          .select({ kind: runFlags.kind })
          .from(runFlags)
          .where(and(eq(runFlags.recordId, id), eq(runFlags.userId, viewerId)))
      : [];
    const { userId, recordingType, recordingOffsetMs, ...rest } = row;
    return {
      ...rest,
      recording: recordingType ? { type: recordingType, offsetMs: recordingOffsetMs! } : null,
      myFlag: own?.kind ?? null,
      isOwn: userId === viewerId,
    };
  }

  public async recording(id: string) {
    const [row] = await this.database
      .select({ audio: leaderboardRecordings.audio, type: leaderboardRecordings.type })
      .from(leaderboardRecordings)
      .where(eq(leaderboardRecordings.recordId, id));
    return row ?? null;
  }

  /**
   * Another player's vouch for a run or report of it, or neither (`null`). Only for a run with a
   * recording to listen to, and never the singer's own.
   */
  public async flag(
    id: string,
    userId: string,
    kind: RunFlagKind | null,
  ): Promise<'ok' | 'not-found' | 'own' | 'not-recorded'> {
    const [run] = await this.database
      .select({ userId: leaderboardRecords.userId, status: leaderboardRecords.status })
      .from(leaderboardRecords)
      .where(eq(leaderboardRecords.id, id));
    if (!run) return 'not-found';
    if (run.userId === userId) return 'own';
    if (run.status === 'score') return 'not-recorded';

    if (kind === null) {
      await this.database.delete(runFlags).where(and(eq(runFlags.recordId, id), eq(runFlags.userId, userId)));
    } else {
      await this.database
        .insert(runFlags)
        .values({ recordId: id, userId, kind })
        .onConflictDoUpdate({ target: [runFlags.recordId, runFlags.userId], set: { kind, createdAt: new Date() } });
    }
    return 'ok';
  }

  /** For moderators: a recorded run they have listened to. Only a recorded run can be verified. */
  public async verify(id: string): Promise<'ok' | 'not-found' | 'not-recorded'> {
    const updated = await this.database
      .update(leaderboardRecords)
      .set({ status: 'verified' })
      .where(and(eq(leaderboardRecords.id, id), eq(leaderboardRecords.status, 'recorded')))
      .returning({ id: leaderboardRecords.id });
    if (updated.length) return 'ok';
    const [exists] = await this.database
      .select({ id: leaderboardRecords.id })
      .from(leaderboardRecords)
      .where(eq(leaderboardRecords.id, id));
    return exists ? 'not-recorded' : 'not-found';
  }

  /**
   * For moderators: the newest rows, or those whose singer, artist or title contains `query`, with
   * their vouches and reports. Asked for `recorded` ones, the most talked-about come first: those are
   * the queue to listen to.
   */
  public recent(query?: string, status?: RunStatus) {
    const pattern = query ? containing(query) : null;
    const vouches = flagCount('vouch');
    const reports = flagCount('report');
    return this.database
      .select({ ...entry, vouches, reports })
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(
        and(
          status ? eq(leaderboardRecords.status, status) : undefined,
          pattern
            ? or(
                ilike(users.username, pattern),
                ilike(leaderboardRecords.artist, pattern),
                ilike(leaderboardRecords.title, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(
        ...(status === 'recorded' ? [desc(sql`${vouches} + ${reports}`)] : []),
        desc(leaderboardRecords.createdAt),
      )
      .limit(MODERATION_PAGE_SIZE);
  }

  /** Removes a row and the run behind it. Says whether there was one. */
  public async remove(id: string) {
    const removed = await this.database
      .delete(leaderboardRecords)
      .where(eq(leaderboardRecords.id, id))
      .returning({ id: leaderboardRecords.id });
    return removed.length > 0;
  }

  /** The main menu's board: every song, the last fortnight, Medium and harder. */
  public global(verified = false) {
    return this.database
      .select(entry)
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(
        and(
          lte(leaderboardRecords.tolerance, MAX_GLOBAL_BOARD_TOLERANCE),
          gt(leaderboardRecords.createdAt, new Date(Date.now() - GLOBAL_BOARD_WINDOW_MS)),
          verifiedOnly(verified),
        ),
      )
      .orderBy(...ranking)
      .limit(GLOBAL_BOARD_SIZE);
  }

  /**
   * One song at one difficulty, all time. Given a score, the rows either side of where it would land
   * (a tie behind the rows already there) and that position; otherwise the top of the board.
   */
  public async song(songId: string, tolerance: number, score: number | null, verified = false) {
    const board = and(
      eq(leaderboardRecords.songId, songId),
      eq(leaderboardRecords.tolerance, tolerance),
      verifiedOnly(verified),
    );
    const countWhere = async (where: ReturnType<typeof and>) =>
      (await this.database.select({ value: count() }).from(leaderboardRecords).where(where))[0]?.value ?? 0;

    const total = await countWhere(board);
    const position = score === null ? null : (await countWhere(and(board, gte(leaderboardRecords.score, score)))) + 1;
    const offset = position === null ? 0 : Math.max(0, position - 1 - SONG_BOARD_NEIGHBOURS);

    const entries = await this.database
      .select(entry)
      .from(leaderboardRecords)
      .innerJoin(users, eq(leaderboardRecords.userId, users.id))
      .where(board)
      .orderBy(...ranking)
      .offset(offset)
      .limit(position === null ? SONG_BOARD_SIZE : SONG_BOARD_NEIGHBOURS * 2);

    return { entries, total, startPosition: offset + 1, position };
  }
}
