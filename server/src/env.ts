import { z } from 'zod';

/** destiny.gg itself, the only provider a deployed API may sign people in with. */
export const DGG_ORIGIN = 'https://www.destiny.gg';

/**
 * Two addresses for one provider because the local stand-in (`dev/dgg-oauth`) runs in its own
 * container: the API calls it over the compose network, the browser is sent to its published port.
 */
const providerOrigin = z.preprocess((value) => (value === '' || value === undefined ? DGG_ORIGIN : value), z.url());

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    /**
     * The frontend's origins, not the API's, comma-separated: CORS and the relay's socket check compare
     * against them. One in production; locally the dev server and the e2e servers each have their own.
     */
    APP_ORIGIN: z
      .string()
      .transform((value) => value.split(',').map((origin) => origin.trim()))
      .pipe(z.array(z.url()).min(1)),
    PORT: z.coerce.number().int().positive().default(8787),
    DGG_CLIENT_ID: z.string().min(1),
    DGG_CLIENT_SECRET: z.string().min(1),
    /** The frontend's `/auth/callback`, exactly as registered with destiny.gg. */
    DGG_REDIRECT_URI: z.url(),
    /** Where the API fetches the token and the profile. */
    DGG_ORIGIN: providerOrigin,
    /** Where the browser is sent to authorize. */
    DGG_AUTHORIZE_ORIGIN: providerOrigin,
    /**
     * Whether the remote-mic and online relays serve only signed-in people, who then sing under
     * their destiny.gg names. Off, anyone may connect and types a nickname.
     */
    SIGN_IN_REQUIRED: z.stringbool().default(true),
    /** Usernames that are always admins, comma-separated. Everyone else's role is in the database. */
    ADMIN_DGG_USERNAMES: z
      .string()
      .default('')
      .transform(
        (value) =>
          new Set(
            value
              .split(',')
              .map((username) => username.trim().toLowerCase())
              .filter(Boolean),
          ),
      ),
  })
  .superRefine((env, context) => {
    // The stand-in signs anyone in as anyone. A deployed site is the only one served over https.
    if (!isDeployed(env)) return;
    for (const key of ['DGG_ORIGIN', 'DGG_AUTHORIZE_ORIGIN'] as const) {
      if (env[key] === DGG_ORIGIN) continue;
      context.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} must be ${DGG_ORIGIN} when APP_ORIGIN is https. The local stand-in is for development only.`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function isDeployed(env: Pick<Env, 'APP_ORIGIN'>): boolean {
  return env.APP_ORIGIN.some((origin) => origin.startsWith('https://'));
}

export function parseEnv(source: Record<string, unknown>): Env {
  return envSchema.parse(source);
}

let env: Env | undefined;

export function getEnv(): Env {
  env ??= parseEnv(process.env);
  return env;
}
