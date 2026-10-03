import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from './db.js';
import type { Env } from './env.js';
import { resolveFlair } from './flair.js';
import { oauthLoginTransactions, sessions, type UserRole, users } from './schema.js';

const LOGIN_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

const userInfoSchema = z.object({
  username: z.string().min(1),
  userId: z.union([z.number(), z.string()]).transform(String),
  status: z.string(),
  roles: z.array(z.string()),
  features: z.array(z.string()),
});

export interface SessionUser {
  id: string;
  username: string;
  role: UserRole;
  flair: string | null;
}

/** A sign-in that cannot finish. The message is meant for the person signing in. */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Not PKCE: destiny.gg hashes the verifier with the secret's hash, as hex, then base64s the hex. */
function codeChallenge(verifier: string, clientSecret: string) {
  return Buffer.from(sha256Hex(verifier + sha256Hex(clientSecret)), 'utf8').toString('base64');
}

interface AuthDeps {
  database: Database;
  env: Env;
  fetchImpl?: typeof fetch;
}

/**
 * Sign-in with destiny.gg. Destiny's access token is used once to read the profile and thrown
 * away; what the browser keeps is our own session token, of which only the hash is stored.
 */
export class Auth {
  private readonly database: Database;
  private readonly env: Env;
  private readonly fetchImpl: typeof fetch;

  constructor({ database, env, fetchImpl = fetch }: AuthDeps) {
    this.database = database;
    this.env = env;
    this.fetchImpl = fetchImpl;
  }

  /** Where to send the browser. Each call opens a login attempt that lasts five minutes. */
  async authorizationUrl(): Promise<string> {
    const state = randomToken();
    const verifier = randomToken(48);
    const now = new Date();

    await this.database.delete(oauthLoginTransactions).where(lt(oauthLoginTransactions.expiresAt, now));
    await this.database.insert(oauthLoginTransactions).values({
      stateHash: sha256Hex(state),
      codeVerifier: verifier,
      expiresAt: new Date(now.getTime() + LOGIN_TTL_MS),
    });

    const url = new URL('/oauth/authorize', this.env.DGG_AUTHORIZE_ORIGIN);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.env.DGG_CLIENT_ID);
    url.searchParams.set('redirect_uri', this.env.DGG_REDIRECT_URI);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge(verifier, this.env.DGG_CLIENT_SECRET));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Finishes a login attempt with the code Destiny sent back, and opens a session. */
  async complete(code: string, state: string): Promise<{ token: string; expiresAt: Date }> {
    const [transaction] = await this.database
      .delete(oauthLoginTransactions)
      .where(
        and(eq(oauthLoginTransactions.stateHash, sha256Hex(state)), gt(oauthLoginTransactions.expiresAt, new Date())),
      )
      .returning({ codeVerifier: oauthLoginTransactions.codeVerifier });
    if (!transaction) throw new AuthenticationError('This sign-in expired or was already used. Try again.');

    const identity = await this.fetchIdentity(await this.exchangeCode(code, transaction.codeVerifier));
    const isRoot = this.env.ADMIN_DGG_USERNAMES.has(identity.username.toLowerCase());
    const profile = {
      username: identity.username,
      flair: resolveFlair(identity.features),
      dggStatus: identity.status,
      dggRoles: identity.roles,
      dggFeatures: identity.features,
    };

    const [user] = await this.database
      .insert(users)
      .values({ dggUserId: identity.userId, role: isRoot ? 'admin' : 'singer', ...profile })
      .onConflictDoUpdate({
        target: users.dggUserId,
        // A root admin is re-asserted on every sign-in; everyone else keeps the role they were given.
        set: { ...profile, role: isRoot ? 'admin' : sql`${users.role}`, lastSeenAt: new Date() },
      })
      .returning({ id: users.id });
    if (!user) throw new AuthenticationError('Your account could not be created.');

    const token = randomToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await this.database.delete(sessions).where(lt(sessions.expiresAt, now));
    await this.database.insert(sessions).values({ tokenHash: sha256Hex(token), userId: user.id, expiresAt });
    return { token, expiresAt };
  }

  async userForToken(token: string): Promise<SessionUser | null> {
    const [user] = await this.database
      .select({ id: users.id, username: users.username, role: users.role, flair: users.flair })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, sha256Hex(token)), gt(sessions.expiresAt, new Date())))
      .limit(1);
    return user ?? null;
  }

  async signOut(token: string): Promise<void> {
    await this.database.delete(sessions).where(eq(sessions.tokenHash, sha256Hex(token)));
  }

  private async exchangeCode(code: string, verifier: string): Promise<string> {
    const url = new URL('/oauth/token', this.env.DGG_ORIGIN);
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('code', code);
    url.searchParams.set('client_id', this.env.DGG_CLIENT_ID);
    url.searchParams.set('redirect_uri', this.env.DGG_REDIRECT_URI);
    url.searchParams.set('code_verifier', verifier);

    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    const token = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !token.success) throw new AuthenticationError('destiny.gg could not complete the sign-in.');
    return token.data.access_token;
  }

  private async fetchIdentity(accessToken: string) {
    const url = new URL('/api/userinfo', this.env.DGG_ORIGIN);
    url.searchParams.set('token', accessToken);

    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    const identity = userInfoSchema.safeParse(await response.json().catch(() => null));
    if (!response.ok || !identity.success)
      throw new AuthenticationError('destiny.gg returned a profile we could not read.');
    return identity.data;
  }
}
