import { describe, expect, it } from 'vitest';

import type { SessionUser } from './auth.js';
import { SocketTickets } from './socket-tickets.js';

const singer: SessionUser = { id: '1', username: 'Singer', role: 'singer', flair: null };

describe('SocketTickets', () => {
  it('redeems a ticket for the user it was issued to', () => {
    const tickets = new SocketTickets();

    expect(tickets.redeem(tickets.issue(singer))).toEqual(singer);
  });

  // A ticket travels in the socket's URL, which proxies and logs can keep
  it('redeems a ticket only once', () => {
    const tickets = new SocketTickets();
    const ticket = tickets.issue(singer);
    tickets.redeem(ticket);

    expect(tickets.redeem(ticket)).toBeNull();
  });

  it('refuses a ticket after a minute', () => {
    let now = 0;
    const tickets = new SocketTickets(() => now);
    const ticket = tickets.issue(singer);
    now = 60_001;

    expect(tickets.redeem(ticket)).toBeNull();
  });

  it('refuses a ticket it never issued, or none', () => {
    const tickets = new SocketTickets();

    expect(tickets.redeem('made-up')).toBeNull();
    expect(tickets.redeem(null)).toBeNull();
  });
});
