import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { SessionUser } from '../auth.js';
import { DAY_PATTERN, type Daily } from './daily.js';

/** `/api/daily`: today's song and its board, for everyone. */
export function dailyRoutes(daily: Daily) {
  const routes = new Hono();
  routes.get('/', async (context) => context.json(await daily.board(daily.today())));
  return routes;
}

/** `/api/moderation/daily`, behind the moderator check in `app.ts`: choosing a day's song. */
export function dailyModerationRoutes(daily: Daily, signedInUser: (context: Context) => Promise<SessionUser | null>) {
  const routes = new Hono();
  const day = (context: Context) => z.string().regex(DAY_PATTERN).safeParse(context.req.param('day'));

  routes.get('/', async (context) => context.json({ days: await daily.schedule() }));

  routes.put('/:day', async (context) => {
    const chosen = day(context);
    const body = z
      .object({ songId: z.string().regex(/^[a-z0-9-]{1,200}$/) })
      .safeParse(await context.req.json().catch(() => null));
    if (!chosen.success || !body.success) return context.json({ error: 'A day and a song id, please.' }, 400);
    await daily.choose(chosen.data, body.data.songId, (await signedInUser(context))!.id);
    return context.json({ ok: true });
  });

  routes.delete('/:day', async (context) => {
    const chosen = day(context);
    if (!chosen.success) return context.json({ error: 'A day, please.' }, 400);
    await daily.clear(chosen.data);
    return context.body(null, 204);
  });

  return routes;
}
