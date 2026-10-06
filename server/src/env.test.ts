import { describe, expect, it } from 'vitest';

import { DGG_ORIGIN, parseEnv, turnKey } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://unused',
  APP_ORIGIN: 'http://localhost:3000',
  DGG_CLIENT_ID: 'client',
  DGG_CLIENT_SECRET: 'secret',
  DGG_REDIRECT_URI: 'http://localhost:3000/auth/callback',
};

describe('parseEnv', () => {
  it('talks to destiny.gg unless told otherwise', () => {
    const env = parseEnv({ ...base, DGG_ORIGIN: '' });
    expect(env.DGG_ORIGIN).toBe(DGG_ORIGIN);
    expect(env.DGG_AUTHORIZE_ORIGIN).toBe(DGG_ORIGIN);
  });

  it('reads root admins case-insensitively', () => {
    const env = parseEnv({ ...base, ADMIN_DGG_USERNAMES: ' Destiny, ,picklesnathan ' });
    expect([...env.ADMIN_DGG_USERNAMES]).toEqual(['destiny', 'picklesnathan']);
  });

  it('allows the local stand-in over http', () => {
    expect(() => parseEnv({ ...base, DGG_ORIGIN: 'http://dgg-oauth:8789' })).not.toThrow();
  });

  it('refuses the local stand-in once the site is https', () => {
    const deployed = { ...base, APP_ORIGIN: 'https://dgg-karaoke.netlify.app' };
    expect(() => parseEnv({ ...deployed, DGG_AUTHORIZE_ORIGIN: 'http://localhost:8789' })).toThrow(
      /DGG_AUTHORIZE_ORIGIN must be/,
    );
    expect(() => parseEnv(deployed)).not.toThrow();
  });

  it('requires sign-in for the relays unless told otherwise', () => {
    expect(parseEnv(base).SIGN_IN_REQUIRED).toBe(true);
    expect(parseEnv({ ...base, SIGN_IN_REQUIRED: 'false' }).SIGN_IN_REQUIRED).toBe(false);
  });

  it('reads a TURN key only as a pair', () => {
    expect(turnKey(parseEnv({ ...base, CLOUDFLARE_TURN_KEY_ID: '', CLOUDFLARE_TURN_API_TOKEN: '' }))).toBeUndefined();
    expect(turnKey(parseEnv({ ...base, CLOUDFLARE_TURN_KEY_ID: 'id', CLOUDFLARE_TURN_API_TOKEN: 'token' }))).toEqual({
      keyId: 'id',
      apiToken: 'token',
    });
    expect(() => parseEnv({ ...base, CLOUDFLARE_TURN_KEY_ID: 'id' })).toThrow(/set together/);
  });
});
