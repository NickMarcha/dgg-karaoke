import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

import type { Database } from './db.js';
import { type OnlineDirectory, ROOM_CODE_PATTERN } from './online/directory.js';
import { fetchThroughProxy, ProxyRefused, proxyTarget } from './proxy.js';

interface AppDeps {
  appOrigins: string[];
  database: Database;
  directory: OnlineDirectory;
  fetchImpl?: typeof fetch;
}

export function createApp({ appOrigins, database, directory, fetchImpl = fetch }: AppDeps) {
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use('*', cors({ origin: appOrigins, allowMethods: ['GET', 'OPTIONS'] }));

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
