import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocket, WebSocketServer } from 'ws';

import { createApp } from './app.js';
import { getDatabase } from './db.js';
import { getEnv } from './env.js';
import { type Peer, Relay } from './relay.js';

const env = getEnv();
const database = getDatabase();

// Deploys run from `main` with nobody around to migrate by hand, so a container that cannot migrate
// refuses to serve rather than running against the wrong schema.
await migrate(database, { migrationsFolder: 'drizzle' });

const app = createApp({ appOrigins: env.APP_ORIGIN, database });
const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) =>
  console.log(`DGG Karaoke API listening on http://localhost:${port}`),
);

const relay = new Relay();
// The song list a game sends a phone is the largest message, a few MB for the full library.
const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
const alive = new WeakSet<WebSocket>();

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  if (pathname !== '/remote-mic' || !env.APP_ORIGIN.includes(request.headers.origin ?? '')) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  sockets.handleUpgrade(request, socket, head, (client) => sockets.emit('connection', client));
});

sockets.on('connection', (client: WebSocket) => {
  const peer: Peer = {
    send: (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    },
    close: (code, reason) => client.close(code, reason),
  };
  alive.add(client);

  client.on('pong', () => alive.add(client));
  // The default binaryType hands every message over as one Buffer.
  client.on('message', (data: Buffer, isBinary) => {
    if (isBinary) relay.receive(peer, data);
  });
  client.on('close', () => {
    relay.disconnect(peer);
  });
  client.on('error', (error) => console.warn('Relay socket error', error.message));
});

// Cloudflare closes a socket idle for 100 s, and a phone that loses signal never says goodbye. A
// protocol-level ping every 30 s keeps the tunnel open and drops sockets that stop answering.
const heartbeat = setInterval(() => {
  for (const client of sockets.clients) {
    if (!alive.has(client)) {
      client.terminate();
      continue;
    }
    alive.delete(client);
    client.ping();
  }
}, 30_000);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  for (const client of sockets.clients) client.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
