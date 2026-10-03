import { drizzle } from 'drizzle-orm/node-postgres';

import { getEnv } from './env.js';

export type Database = ReturnType<typeof createDatabase>;

function createDatabase() {
  return drizzle({ connection: getEnv().DATABASE_URL });
}

let database: Database | undefined;

export function getDatabase(): Database {
  database ??= createDatabase();
  return database;
}
