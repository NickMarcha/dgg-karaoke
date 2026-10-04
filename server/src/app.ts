import { sql } from 'drizzle-orm';
import { type Context, Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';

import { type Auth, AuthenticationError } from './auth.js';
import type { Database } from './db.js';
import { leaderboardModerationRoutes, leaderboardRoutes } from './leaderboard/routes.js';
import { type OnlineDirectory, ROOM_CODE_PATTERN } from './online/directory.js';
import { fetchThroughProxy, ProxyRefused, proxyTarget } from './proxy.js';
import type { UserRole } from './schema.js';
import type { SocketTickets } from './socket-tickets.js';
import { RoleChangeRefused, Users } from './users.js';

const SESSION_COOKIE = 'dgg_karaoke_session';

const callbackSchema = z.object({ code: z.string().min(1), state: z.string().min(1) });
const roleSchema = z.object({ role: z.enum(['singer', 'moderator']) });

interface AppDeps {
  appOrigins: string[];
  auth: Auth;
  /** Over https the session cookie is `Secure`. The site proxies `/api`, so it never needs to be cross-site. */
  secureCookies: boolean;
  /** Whether the relays need a ticket; the site reads it from `/api/me`. */
  signInRequired: boolean;
  tickets: SocketTickets;
  database: Database;
  directory: OnlineDirectory;
  fetchImpl?: typeof fetch;
}

export function createApp({
  appOrigins,
  auth,
  secureCookies,
  signInRequired,
  tickets,
  database,
  directory,
  fetchImpl = fetch,
}: AppDeps) {
  const app = new Hono();
  const people = new Users(database);

  const signedInUser = (context: Context) => {
    const token = getCookie(context, SESSION_COOKIE);
    return token ? auth.userForToken(token) : Promise.resolve(null);
  };

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: appOrigins, allowMethods: ['GET', 'OPTIONS'] }));

  // The site reaches `/api` through its own origin, so a cookie-bearing write from anywhere else is forged.
  app.use('/api/*', async (context, next) => {
    if (context.req.method !== 'GET' && !appOrigins.includes(context.req.header('origin') ?? '')) {
      return context.json({ error: 'This request came from another site.' }, 403);
    }
    await next();
  });

  app.get('/api/auth/login', async (context) => context.redirect(await auth.authorizationUrl()));

  app.post('/api/auth/callback', async (context) => {
    const body = callbackSchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: 'That sign-in link was incomplete.' }, 400);
    try {
      const { token, expiresAt } = await auth.complete(body.data.code, body.data.state);
      setCookie(context, SESSION_COOKIE, token, {
        expires: expiresAt,
        httpOnly: true,
        path: '/',
        sameSite: 'Lax',
        secure: secureCookies,
      });
      return context.json({ ok: true });
    } catch (error) {
      if (error instanceof AuthenticationError) return context.json({ error: error.message }, 400);
      throw error;
    }
  });

  app.post('/api/auth/logout', async (context) => {
    const token = getCookie(context, SESSION_COOKIE);
    if (token) await auth.signOut(token);
    deleteCookie(context, SESSION_COOKIE, { path: '/', secure: secureCookies });
    return context.json({ ok: true });
  });

  app.get('/api/me', async (context) => context.json({ user: await signedInUser(context), signInRequired }));

  app.post('/api/socket-ticket', async (context) => {
    const user = await signedInUser(context);
    if (!user && !signInRequired) return context.json({ ticket: null });
    if (!user) return context.json({ error: 'Sign in with destiny.gg first.' }, 401);
    return context.json({ ticket: tickets.issue(user) });
  });

  app.route('/api/leaderboard', leaderboardRoutes({ database, signedInUser }));

  // The admin page: appointing moderators. Admins themselves come from ADMIN_DGG_USERNAMES.
  const requireRole =
    (...roles: UserRole[]): MiddlewareHandler =>
    async (context, next) => {
      const user = await signedInUser(context);
      if (!user) return context.json({ error: 'Sign in with destiny.gg first.' }, 401);
      if (!roles.includes(user.role)) return context.json({ error: 'This is not for your account.' }, 403);
      await next();
    };

  app.use('/api/admin/*', requireRole('admin'));
  // Looking after what the community puts up: the leaderboard now, the songs with layer 4
  app.use('/api/moderation/*', requireRole('moderator', 'admin'));
  app.route('/api/moderation/leaderboard', leaderboardModerationRoutes(database));

  app.get('/api/admin/users', async (context) => {
    const query = context.req.query('query')?.trim();
    return context.json({ users: query ? await people.search(query) : await people.staff() });
  });

  app.post('/api/admin/users/:id/role', async (context) => {
    const body = roleSchema.safeParse(await context.req.json().catch(() => null));
    if (!body.success) return context.json({ error: 'The role must be singer or moderator.' }, 400);
    const id = z.uuid().safeParse(context.req.param('id'));
    if (!id.success) return context.json({ error: 'Nobody by that id has signed in.' }, 404);
    try {
      const user = await people.setRole(id.data, body.data.role);
      if (!user) return context.json({ error: 'Nobody by that id has signed in.' }, 404);
      return context.json({ user });
    } catch (error) {
      if (error instanceof RoleChangeRefused) return context.json({ error: error.message }, 409);
      throw error;
    }
  });

  app.get('/health', async (context) => {
    await database.execute(sql`select 1`);
    return context.json({ ok: true });
  });

  // Lets the join screen check a code without claiming a seat. Not a secret: codes are read out loud.
  app.get('/online/room/:code', async (context) => {
    const code = context.req.param('code').toLowerCase();
    if (!ROOM_CODE_PATTERN.test(code)) return context.json({ created: false, hostSessionId: null, epoch: 0 });
    return context.json(await directory.info(code));
  });

  app.get('/proxy', async (context) => {
    try {
      const upstream = await fetchThroughProxy(proxyTarget(context.req.query('url')), fetchImpl);
      return new Response(upstream.body, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') ?? 'text/plain' },
      });
    } catch (error) {
      if (error instanceof ProxyRefused) return context.json({ error: error.message }, 400);
      console.error('Proxy request failed', error);
      return context.json({ error: 'Upstream unavailable' }, 502);
    }
  });

  return app;
}
