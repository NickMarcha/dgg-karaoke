import { randomUUID } from 'node:crypto';

import { serve } from '@hono/node-server';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { WebSocket, WebSocketServer } from 'ws';

import { createApp } from './app.js';
import { Auth } from './auth.js';
import { getDatabase } from './db.js';
import { getEnv, isDeployed, turnKey } from './env.js';
import { IceServers } from './ice-servers.js';
import { OnlineDirectory } from './online/directory.js';
import { type OnlinePeer, OnlineRelay, type StreamWatcher } from './online/relay.js';
import { PostgresRoomStore } from './online/room-store.js';
import { StreamKeys } from './online/stream-keys.js';
import { type Peer, Relay } from './relay.js';
import { SocketTickets } from './socket-tickets.js';

const env = getEnv();
const database = getDatabase();

// Deploys run from `main` with nobody around to migrate by hand, so a container that cannot migrate
// refuses to serve rather than running against the wrong schema.
await migrate(database, { migrationsFolder: 'drizzle' });

const directory = new OnlineDirectory(new PostgresRoomStore(database));
const tickets = new SocketTickets();
const app = createApp({
  appOrigins: env.APP_ORIGIN,
  siteOrigin: env.SITE_ORIGIN,
  auth: new Auth({ database, env }),
  secureCookies: isDeployed(env),
  signInRequired: env.SIGN_IN_REQUIRED,
  tickets,
  database,
  directory,
});
const server = serve({ fetch: app.fetch, port: env.PORT }, ({ port }) =>
  console.log(`DGG Karaoke API listening on http://localhost:${port}`),
);

const iceServers = new IceServers(turnKey(env));
console.log(turnKey(env) ? 'Phones fall back to Cloudflare TURN' : 'No TURN key: phones find their game by STUN alone');
void iceServers.start();
const remoteMics = new Relay(iceServers.get);
const online = new OnlineRelay(directory);
// The song list a game sends a phone is the largest message, a few MB for the full library.
const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
const alive = new WeakSet<WebSocket>();

const streamKeys = new StreamKeys(database);

server.on('upgrade', async (request, socket, head) => {
  const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost');
  const known = pathname === '/remote-mic' || pathname === '/online' || pathname === '/stream';
  // A complete response, ended rather than destroyed: the tunnel reports a socket cut off
  // mid-response as a 502 from the origin.
  const refuse = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  if (!known || !env.APP_ORIGIN.includes(request.headers.origin ?? '')) return refuse('403 Forbidden');

  // An OBS source carries no cookie: its key in the link says whose stream it is
  if (pathname === '/stream') {
    const streamer = await streamKeys.streamerFor(searchParams.get('key') ?? '').catch(() => null);
    if (!streamer) return refuse('401 Unauthorized');
    return sockets.handleUpgrade(request, socket, head, (client) => {
      accept(client);
      connectWatcher(client, streamer);
    });
  }

  const user = tickets.redeem(searchParams.get('ticket'));
  if (env.SIGN_IN_REQUIRED && !user) return refuse('401 Unauthorized');
  sockets.handleUpgrade(request, socket, head, (client) => {
    accept(client);
    if (pathname === '/online') connectOnline(client, user && { id: user.id, username: user.username });
    else connectRemoteMic(client);
  });
});

function accept(client: WebSocket) {
  alive.add(client);
  client.on('pong', () => alive.add(client));
  client.on('error', (error) => console.warn('Socket error', error.message));
}

function connectWatcher(client: WebSocket, streamer: StreamWatcher['streamer']) {
  const watcher: StreamWatcher = {
    streamer,
    send: (message) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    },
  };
  online.watch(watcher);
  client.on('close', () => online.unwatch(watcher));
}

function connectRemoteMic(client: WebSocket) {
  const peer: Peer = {
    send: (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    },
    close: (code, reason) => client.close(code, reason),
  };
  // The default binaryType hands every message over as one Buffer.
  client.on('message', (data: Buffer, isBinary) => {
    if (isBinary) remoteMics.receive(peer, data);
  });
  client.on('close', () => remoteMics.disconnect(peer));
}

function connectOnline(client: WebSocket, user: OnlinePeer['user']) {
  const peer: OnlinePeer = {
    sessionId: randomUUID(),
    user,
    send: (message) => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    },
  };
  online.connect(peer);
  client.on('message', (data: Buffer, isBinary) => {
    if (!isBinary) void online.receive(peer, data.toString());
  });
  client.on('close', () => online.disconnect(peer));
}

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

const roomExpiry = setInterval(() => {
  directory.expire().catch((error) => console.error('Could not expire online rooms', error));
}, 5 * 60_000);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  clearInterval(roomExpiry);
  iceServers.stop();
  for (const client of sockets.clients) client.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
