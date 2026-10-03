import { randomBytes } from 'node:crypto';

import type { SessionUser } from './auth.js';

const TICKET_TTL_MS = 60_000;

/**
 * Lets a signed-in browser open a relay socket. The session cookie belongs to the site, which
 * proxies `/api`, but the sockets go to the API directly and carry no cookie. So the browser asks
 * `/api/socket-ticket` for a ticket and puts it in the socket's URL; each is good once, for a minute.
 */
export class SocketTickets {
  private tickets = new Map<string, { user: SessionUser; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  public issue(user: SessionUser) {
    const now = this.now();
    for (const [ticket, entry] of this.tickets) if (entry.expiresAt <= now) this.tickets.delete(ticket);

    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { user, expiresAt: now + TICKET_TTL_MS });
    return ticket;
  }

  public redeem(ticket: string | null): SessionUser | null {
    if (!ticket) return null;
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return entry && entry.expiresAt > this.now() ? entry.user : null;
  }
}
