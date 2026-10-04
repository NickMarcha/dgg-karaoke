import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import type { SessionUser } from '../auth.js';
import type { Database } from '../db.js';
import { songStatus } from '../schema.js';
import { songInput, Songs } from './songs.js';

const MAX_BODY_BYTES = 1024 * 1024;
const UNVERIFIED_LIMIT = 10;

interface Deps {
  database: Database;
  signedInUser: (context: Context) => Promise<SessionUser | null>;
}

const limit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (context) => context.json({ error: 'That song is too large.' }, 413),
});

const readSong = async (context: Context) => songInput.safeParse(await context.req.json().catch(() => null));

/** What the song list's unverified group reads: the fields it searches and shows. */
const unverifiedEntry = (row: {
  sharedSongId: string;
  songId: string;
  artist: string;
  title: string;
  preview: unknown;
}) => {
  const preview = row.preview as { language?: string[]; video?: string };
  return {
    sharedSongId: row.sharedSongId,
    songId: row.songId,
    artist: row.artist,
    title: row.title,
    language: preview.language ?? [],
    videoId: preview.video ?? '',
  };
};

/**
 * `/api/songs`: signed-in people submit songs; everyone reads the published ones, and plays the
 * ones still waiting for a moderator as unverified.
 */
export function songRoutes({ database, signedInUser }: Deps) {
  const songs = new Songs(database);
  const routes = new Hono();

  routes.post('/', limit, async (context) => {
    const user = await signedInUser(context);
    if (!user) return context.json({ error: 'Sign in with destiny.gg to submit a song.' }, 401);
    const song = await readSong(context);
    if (!song.success) return context.json({ error: 'That is not a song the game can read.' }, 400);
    return context.json({ id: await songs.submit(user.id, song.data) }, 201);
  });

  routes.get('/mine', async (context) => {
    const user = await signedInUser(context);
    if (!user) return context.json({ error: 'Sign in with destiny.gg first.' }, 401);
    return context.json({ songs: await songs.mine(user.id) });
  });

  routes.get('/index', async (context) => context.json(await songs.publishedPreviews()));

  routes.get('/published/:songId', async (context) => {
    const txt = await songs.publishedTxt(context.req.param('songId'));
    return txt === null ? context.json({ error: 'No such song.' }, 404) : context.text(txt);
  });

  routes.get('/unverified', async (context) => {
    const query = context.req.query('query')?.trim();
    if (!query) return context.json([]);
    return context.json((await songs.unverified(query, UNVERIFIED_LIMIT)).map(unverifiedEntry));
  });

  routes.get('/unverified/:id', async (context) => {
    const id = z.uuid().safeParse(context.req.param('id'));
    const song = id.success ? await songs.one(id.data, 'submitted') : null;
    if (!song) return context.json({ error: 'No such song.' }, 404);
    return context.json({
      ...unverifiedEntry({ ...song, sharedSongId: song.id }),
      songTxt: song.txt,
    });
  });

  return routes;
}

/** `/api/moderation/songs`, behind the moderator check in `app.ts`: the review queue. */
export function songModerationRoutes({ database, signedInUser }: Deps) {
  const songs = new Songs(database);
  const routes = new Hono();
  const songId = (context: Context) => z.uuid().safeParse(context.req.param('id'));
  const notFound = (context: Context) => context.json({ error: 'No such song.' }, 404);

  routes.get('/', async (context) => {
    const status = songStatus.enumValues.find((value) => value === context.req.query('status')) ?? 'submitted';
    return context.json({ songs: await songs.list(status, context.req.query('query')?.trim()) });
  });

  routes.get('/:id', async (context) => {
    const id = songId(context);
    const song = id.success ? await songs.one(id.data) : null;
    return song ? context.json(song) : notFound(context);
  });

  routes.put('/:id', limit, async (context) => {
    const id = songId(context);
    const song = await readSong(context);
    if (!song.success) return context.json({ error: 'That is not a song the game can read.' }, 400);
    return id.success && (await songs.correct(id.data, song.data)) ? context.json({ ok: true }) : notFound(context);
  });

  routes.post('/:id/publish', async (context) => {
    const id = songId(context);
    const moderator = (await signedInUser(context))!;
    return id.success && (await songs.publish(id.data, moderator.id)) ? context.json({ ok: true }) : notFound(context);
  });

  routes.post('/:id/reject', async (context) => {
    const id = songId(context);
    const body = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: 'Say why, so the singer can fix it.' }, 400);
    const moderator = (await signedInUser(context))!;
    return id.success && (await songs.reject(id.data, moderator.id, body.data.reason))
      ? context.json({ ok: true })
      : notFound(context);
  });

  return routes;
}
