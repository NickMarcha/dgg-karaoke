import { z } from 'zod';

const envSchema = z.object({
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
});

export type Env = z.infer<typeof envSchema>;

let env: Env | undefined;

export function getEnv(): Env {
  env ??= envSchema.parse(process.env);
  return env;
}
