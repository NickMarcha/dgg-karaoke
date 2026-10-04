import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db.js';
import { containing } from '../like.js';
import { communitySongs, type SongStatus, users } from '../schema.js';

/** Far above any UltraStar file; the longest songs in the library are well under 100 KB. */
const MAX_TXT_LENGTH = 512 * 1024;
const MAX_PREVIEW_LENGTH = 64 * 1024;
const LIST_SIZE = 50;

/**
 * A song as the editor sends it: the UltraStar text, and the song list's preview of it. The preview
 * is the browser's own work and is only checked for the fields the API reads out of it.
 */
export const songInput = z.object({
  txt: z
    .string()
    .max(MAX_TXT_LENGTH)
    .refine((txt) => /^#TITLE:/m.test(txt) && /^#ARTIST:/m.test(txt), 'An UltraStar song names its artist and title'),
  preview: z
    .looseObject({
      id: z.string().regex(/^[a-z0-9-]{1,200}$/),
      artist: z.string().min(1).max(200),
      title: z.string().min(1).max(200),
    })
    .refine((preview) => JSON.stringify(preview).length <= MAX_PREVIEW_LENGTH, 'The preview is too large'),
});

export type SongInput = z.infer<typeof songInput>;

const fields = (song: SongInput) => ({
  songId: song.preview.id,
  artist: song.preview.artist,
  title: song.preview.title,
  txt: song.txt,
  preview: song.preview,
});

const listed = {
  id: communitySongs.id,
  songId: communitySongs.songId,
  artist: communitySongs.artist,
  title: communitySongs.title,
  status: communitySongs.status,
  rejectionReason: communitySongs.rejectionReason,
  updatedAt: communitySongs.updatedAt,
};

export class Songs {
  constructor(private readonly database: Database) {}

  /**
   * A submission waits for a moderator. Submitting the same song again while it still waits replaces
   * it, so a singer fixing their own song does not queue it twice.
   */
  public async submit(userId: string, song: SongInput) {
    const [waiting] = await this.database
      .select({ id: communitySongs.id })
      .from(communitySongs)
      .where(
        and(
          eq(communitySongs.submittedBy, userId),
          eq(communitySongs.songId, song.preview.id),
          eq(communitySongs.status, 'submitted'),
        ),
      );
    if (waiting) {
      await this.database
        .update(communitySongs)
        .set({ ...fields(song), updatedAt: new Date() })
        .where(eq(communitySongs.id, waiting.id));
      return waiting.id;
    }
    const [created] = await this.database
      .insert(communitySongs)
      .values({ ...fields(song), submittedBy: userId })
      .returning({ id: communitySongs.id });
    return created!.id;
  }

  public mine(userId: string) {
    return this.database
      .select(listed)
      .from(communitySongs)
      .where(eq(communitySongs.submittedBy, userId))
      .orderBy(desc(communitySongs.updatedAt))
      .limit(LIST_SIZE);
  }

  /** Everyone's song list gets these beside the built-in songs. */
  public async publishedPreviews() {
    const rows = await this.database
      .select({ preview: communitySongs.preview })
      .from(communitySongs)
      .where(eq(communitySongs.status, 'published'));
    return rows.map((row) => row.preview);
  }

  public async publishedTxt(songId: string) {
    const [row] = await this.database
      .select({ txt: communitySongs.txt })
      .from(communitySongs)
      .where(and(eq(communitySongs.songId, songId), eq(communitySongs.status, 'published')));
    return row?.txt ?? null;
  }

  /** Waiting songs whose artist or title contains `query`, for the song list's unverified group. */
  public unverified(query: string, limit: number) {
    const pattern = containing(query);
    return this.database
      .select({
        sharedSongId: communitySongs.id,
        songId: communitySongs.songId,
        artist: communitySongs.artist,
        title: communitySongs.title,
        preview: communitySongs.preview,
      })
      .from(communitySongs)
      .where(
        and(
          eq(communitySongs.status, 'submitted'),
          or(ilike(communitySongs.artist, pattern), ilike(communitySongs.title, pattern)),
        ),
      )
      .orderBy(desc(communitySongs.updatedAt))
      .limit(limit);
  }

  public async one(id: string, status?: SongStatus) {
    const [row] = await this.database
      .select({ ...listed, txt: communitySongs.txt, preview: communitySongs.preview, submittedBy: users.username })
      .from(communitySongs)
      .leftJoin(users, eq(communitySongs.submittedBy, users.id))
      .where(status ? and(eq(communitySongs.id, id), eq(communitySongs.status, status)) : eq(communitySongs.id, id));
    return row ?? null;
  }

  /** For moderators: by status, newest first, optionally by artist or title. */
  public list(status: SongStatus, query?: string) {
    const pattern = query ? containing(query) : null;
    return this.database
      .select({ ...listed, submittedBy: users.username })
      .from(communitySongs)
      .leftJoin(users, eq(communitySongs.submittedBy, users.id))
      .where(
        and(
          eq(communitySongs.status, status),
          pattern ? or(ilike(communitySongs.artist, pattern), ilike(communitySongs.title, pattern)) : undefined,
        ),
      )
      .orderBy(desc(communitySongs.updatedAt))
      .limit(LIST_SIZE);
  }

  public async correct(id: string, song: SongInput) {
    const updated = await this.database
      .update(communitySongs)
      .set({ ...fields(song), updatedAt: new Date() })
      .where(eq(communitySongs.id, id))
      .returning({ id: communitySongs.id });
    return updated.length > 0;
  }

  /** Publishes a song, archiving the version of it that was out before. */
  public publish(id: string, reviewerId: string) {
    return this.database.transaction(async (transaction) => {
      const [song] = await transaction
        .select({ songId: communitySongs.songId })
        .from(communitySongs)
        .where(eq(communitySongs.id, id));
      if (!song) return false;
      await transaction
        .update(communitySongs)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(communitySongs.songId, song.songId), eq(communitySongs.status, 'published')));
      await transaction
        .update(communitySongs)
        .set({ status: 'published', rejectionReason: null, reviewedBy: reviewerId, updatedAt: new Date() })
        .where(eq(communitySongs.id, id));
      return true;
    });
  }

  public async reject(id: string, reviewerId: string, reason: string) {
    const updated = await this.database
      .update(communitySongs)
      .set({ status: 'rejected', rejectionReason: reason, reviewedBy: reviewerId, updatedAt: sql`now()` })
      .where(eq(communitySongs.id, id))
      .returning({ id: communitySongs.id });
    return updated.length > 0;
  }
}
