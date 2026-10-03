import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { Auth, AuthenticationError } from './auth.js';
import { parseEnv } from './env.js';
import { OnlineDirectory } from './online/directory.js';
import { PostgresRoomStore } from './online/room-store.js';
import { oauthLoginTransactions, sessions, users } from './schema.js';

// Runs against a real Postgres: `npm run stack:test` starts one, and `.env.example` has its URL.
const url = process.env.DATABASE_URL;

const env = parseEnv({
  DATABASE_URL: 'postgresql://unused',
  APP_ORIGIN: 'http://localhost:3000',
  DGG_CLIENT_ID: 'client',
  DGG_CLIENT_SECRET: 'secret',
  DGG_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  ADMIN_DGG_USERNAMES: 'RootAdmin',
});

const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

interface Identity {
  username: string;
  userId: number;
  features?: string[];
}

/**
 * destiny.gg's token and profile endpoints. The challenge is checked the way Destiny checks it, so
 * a mistake in ours fails the sign-in here too.
 */
function fakeDestiny(challenge: () => string, identity: () => Identity) {
  return (async (input: URL) => {
    if (input.pathname === '/oauth/token') {
      const verifier = input.searchParams.get('code_verifier') ?? '';
      const expected = Buffer.from(sha256Hex(verifier + sha256Hex('secret'))).toString('base64');
      if (input.searchParams.get('code') !== 'good-code' || expected !== challenge()) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return Response.json({ access_token: 'token', expires_in: 3600, scope: 'identify', token_type: 'bearer' });
    }
    if (input.pathname === '/api/userinfo') {
      const { username, userId, features = [] } = identity();
      return Response.json({
        nick: username,
        username,
        userId,
        status: 'Active',
        createdDate: '2020-01-01',
        roles: ['USER'],
        features,
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe.skipIf(!url)('Auth', () => {
  const database = drizzle({ connection: url! });
  let identity: Identity;
  let challenge = '';
  const auth = new Auth({
    database,
    env,
    fetchImpl: fakeDestiny(
      () => challenge,
      () => identity,
    ),
  });

  /** Goes to Destiny and comes back with a code, the way the browser would. */
  async function signIn() {
    const authorize = new URL(await auth.authorizationUrl());
    challenge = authorize.searchParams.get('code_challenge')!;
    return auth.complete('good-code', authorize.searchParams.get('state')!);
  }

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  beforeEach(async () => {
    await database.delete(users);
    await database.delete(oauthLoginTransactions);
    identity = { username: 'Singer', userId: 101 };
  });

  afterAll(async () => {
    await database.delete(users);
    await database.delete(oauthLoginTransactions);
    await database.$client.end();
  });

  it('sends the browser to Destiny with our client and redirect', async () => {
    const authorize = new URL(await auth.authorizationUrl());
    expect(authorize.origin + authorize.pathname).toBe('https://www.destiny.gg/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('client');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:3000/auth/callback');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('signs a new account in as a singer, coloured by its flair', async () => {
    identity = { username: 'Singer', userId: 101, features: ['subscriber', 'flair1'] };
    const { token } = await signIn();

    expect(await auth.userForToken(token)).toMatchObject({ username: 'Singer', role: 'singer', flair: 'flair1' });
  });

  it('stores only a hash of the session token', async () => {
    const { token } = await signIn();
    const [session] = await database.select().from(sessions);
    expect(session!.tokenHash).toBe(sha256Hex(token));
  });

  it('makes a configured root admin an admin, whatever the case', async () => {
    identity = { username: 'rootadmin', userId: 102 };
    const { token } = await signIn();
    expect(await auth.userForToken(token)).toMatchObject({ role: 'admin' });
  });

  it('keeps the role the database holds for everyone else', async () => {
    const first = await signIn();
    const user = await auth.userForToken(first.token);
    await database.update(users).set({ role: 'admin' }).where(eq(users.id, user!.id));

    identity = { username: 'RenamedSinger', userId: 101 };
    const second = await signIn();

    expect(await auth.userForToken(second.token)).toMatchObject({
      id: user!.id,
      username: 'RenamedSinger',
      role: 'admin',
    });
  });

  it('uses a login attempt only once', async () => {
    const authorize = new URL(await auth.authorizationUrl());
    challenge = authorize.searchParams.get('code_challenge')!;
    const state = authorize.searchParams.get('state')!;

    await auth.complete('good-code', state);
    await expect(auth.complete('good-code', state)).rejects.toThrow(AuthenticationError);
  });

  it('refuses a state it never issued', async () => {
    await expect(auth.complete('good-code', 'made-up')).rejects.toThrow(AuthenticationError);
  });

  it('refuses a code Destiny rejects', async () => {
    const authorize = new URL(await auth.authorizationUrl());
    challenge = authorize.searchParams.get('code_challenge')!;
    await expect(auth.complete('bad-code', authorize.searchParams.get('state')!)).rejects.toThrow(AuthenticationError);
  });

  it('forgets a session on sign-out', async () => {
    const { token } = await signIn();
    await auth.signOut(token);
    expect(await auth.userForToken(token)).toBeNull();
  });

  it('does not know an expired session', async () => {
    const { token } = await signIn();
    await database.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await auth.userForToken(token)).toBeNull();
  });
});

describe.skipIf(!url)('sign-in routes', () => {
  const database = drizzle({ connection: url! });
  let challenge = '';
  const app = createApp({
    appOrigins: ['http://localhost:3000'],
    auth: new Auth({
      database,
      env,
      fetchImpl: fakeDestiny(
        () => challenge,
        () => ({ username: 'Singer', userId: 201 }),
      ),
    }),
    secureCookies: true,
    database,
    directory: new OnlineDirectory(new PostgresRoomStore(database)),
  });
  const site = { origin: 'http://localhost:3000', 'content-type': 'application/json' };

  async function signIn() {
    const login = await app.request('/api/auth/login');
    const authorize = new URL(login.headers.get('location')!);
    challenge = authorize.searchParams.get('code_challenge')!;
    return app.request('/api/auth/callback', {
      method: 'POST',
      headers: site,
      body: JSON.stringify({ code: 'good-code', state: authorize.searchParams.get('state') }),
    });
  }

  const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

  beforeAll(async () => {
    await migrate(database, { migrationsFolder: 'drizzle' });
  });

  afterAll(async () => {
    await database.delete(users);
    await database.$client.end();
  });

  it('sets a first-party session cookie the page cannot read', async () => {
    const response = await signIn();
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^dgg_karaoke_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });

  it('answers /api/me with the signed-in user, or nobody', async () => {
    const cookie = cookieOf(await signIn());

    const me = await app.request('/api/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ user: expect.objectContaining({ username: 'Singer', role: 'singer' }) });

    const anonymous = await app.request('/api/me');
    expect(await anonymous.json()).toEqual({ user: null });
  });

  it('signs out', async () => {
    const cookie = cookieOf(await signIn());
    const logout = await app.request('/api/auth/logout', { method: 'POST', headers: { ...site, cookie } });
    expect(logout.headers.get('set-cookie')).toMatch(/dgg_karaoke_session=;/);

    const me = await app.request('/api/me', { headers: { cookie } });
    expect(await me.json()).toEqual({ user: null });
  });

  it('explains a failed sign-in', async () => {
    const response = await app.request('/api/auth/callback', {
      method: 'POST',
      headers: site,
      body: JSON.stringify({ code: 'good-code', state: 'made-up' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/expired/) });
  });

  it('refuses a write from another site', async () => {
    const cookie = cookieOf(await signIn());
    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { origin: 'https://evil.test', cookie },
    });
    expect(logout.status).toBe(403);
  });
});
