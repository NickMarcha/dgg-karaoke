import { and, asc, desc, eq, ilike, ne } from 'drizzle-orm';

import type { Database } from './db.js';
import { containing } from './like.js';
import { users } from './schema.js';

const LIMIT = 50;

const columns = {
  id: users.id,
  username: users.username,
  role: users.role,
  flair: users.flair,
  lastSeenAt: users.lastSeenAt,
};

/** A role the admin page may hand out or take away. Admins come only from `ADMIN_DGG_USERNAMES`. */
export type AssignableRole = 'singer' | 'moderator';

export class RoleChangeRefused extends Error {}

/** The accounts that have signed in, for the admin page. */
export class Users {
  constructor(private readonly database: Database) {}

  /** Moderators and admins, admins first. */
  public staff() {
    return this.database
      .select(columns)
      .from(users)
      .where(ne(users.role, 'singer'))
      .orderBy(desc(users.role), asc(users.username))
      .limit(LIMIT);
  }

  /** Everyone whose name contains `query`, as typed. */
  public search(query: string) {
    return this.database
      .select(columns)
      .from(users)
      .where(ilike(users.username, containing(query)))
      .orderBy(asc(users.username))
      .limit(LIMIT);
  }

  /** `null` for nobody by that id; refuses to change an admin, whose role comes from configuration. */
  public async setRole(id: string, role: AssignableRole) {
    const [user] = await this.database
      .update(users)
      .set({ role })
      .where(and(eq(users.id, id), ne(users.role, 'admin')))
      .returning(columns);
    if (user) return user;

    const [existing] = await this.database.select({ id: users.id }).from(users).where(eq(users.id, id));
    if (existing) throw new RoleChangeRefused("An admin's role comes from ADMIN_DGG_USERNAMES.");
    return null;
  }
}
