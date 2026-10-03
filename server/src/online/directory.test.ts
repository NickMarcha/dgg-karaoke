import { describe, expect, it } from 'vitest';

import { DIRECTORY_TTL_MS, type JoinResult, MemoryRoomStore, ONLINE_SLOT_COUNT, OnlineDirectory } from './directory.js';

// Ported from the Cloudflare Durable Object's suite (worker/online-directory-do.test.ts) with the
// same cases, so the rules are provably the ones online mode was built against.

const CODE = '2abcd';

const setup = (store = new MemoryRoomStore(), now = () => 1_000) => {
  const directory = new OnlineDirectory(store, now);
  return {
    directory,
    join: (participantId: string, sessionId: string, create: boolean, secret?: string) =>
      directory.join(CODE, participantId, sessionId, create, secret),
    leave: (participantId: string, requestedBy: { participantId: string; sessionId: string }, ban = false) =>
      directory.leave(CODE, participantId, requestedBy, ban),
    promote: (participantId: string, sessionId: string, fromEpoch: number, secret?: string) =>
      directory.promote(CODE, participantId, sessionId, fromEpoch, secret),
    info: () => directory.info(CODE),
    /** What the relay routes by: the member holding this participant id on this session. */
    seated: (participantId: string, sessionId: string) =>
      directory.peek(CODE)?.members.find((m) => m.participantId === participantId && m.sessionId === sessionId),
  };
};

const secretOf = (response: JoinResult) => (response.ok ? response.secret : undefined);
const epochOf = (response: JoinResult) => (response.ok ? response.epoch : -1);

describe('OnlineDirectory', () => {
  it('refuses a room nobody opened', async () => {
    const { join } = setup();
    expect(await join('p1', 's1', false)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('makes the participant that opens a room its host', async () => {
    const { join } = setup();
    expect(await join('p1', 's1', true)).toMatchObject({ ok: true, isHost: true, hostSessionId: 's1', slot: 0 });
  });

  it('hands every joiner a distinct slot and keeps the first host', async () => {
    const { join } = setup();
    await join('p1', 's1', true);
    expect(await join('p2', 's2', false)).toMatchObject({ ok: true, isHost: false, hostSessionId: 's1', slot: 1 });
    expect(await join('p3', 's3', false)).toMatchObject({ ok: true, isHost: false, hostSessionId: 's1', slot: 2 });
  });

  it('turns away a full room', async () => {
    const { join } = setup();
    await join('p0', 's0', true);
    for (let i = 1; i < ONLINE_SLOT_COUNT; i++) await join(`p${i}`, `s${i}`, false);
    expect(await join('one-too-many', 'sx', false)).toEqual({ ok: false, reason: 'room-full' });
  });

  it('gives a rejoining participant back the slot it already owned', async () => {
    const { join } = setup();
    await join('p1', 's1', true);
    const before = await join('p2', 's2', false);
    const after = await join('p2', 's2-new', false, secretOf(before));
    expect(after).toMatchObject({ ok: true, slot: before.ok && before.slot });
  });

  it('frees a slot on leave so a full room can let somebody else in', async () => {
    const { join, leave } = setup();
    await join('p0', 's0', true);
    for (let i = 1; i < ONLINE_SLOT_COUNT; i++) await join(`p${i}`, `s${i}`, false);
    await leave('p3', { participantId: 'p0', sessionId: 's0' });
    expect(await join('newcomer', 'sx', false)).toMatchObject({ ok: true, slot: 3 });
  });

  it('seats a member only on its own session', async () => {
    const { join, seated } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    expect(seated('p2', 's2')).toMatchObject({ slot: 1 });
    expect(seated('p2', 'some-other-session')).toBeUndefined();
  });

  it('refuses a banned participant a slot even though the room logic lives elsewhere', async () => {
    const { join, leave } = setup();
    await join('p1', 's1', true);
    await join('kicked', 's2', false);
    await leave('kicked', { participantId: 'p1', sessionId: 's1' }, true);
    expect(await join('kicked', 's2-new', false)).toEqual({ ok: false, reason: 'banned' });
  });

  it('lets a participant release its own slot', async () => {
    const { join, leave } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    await leave('p2', { participantId: 'p2', sessionId: 's2' });
    expect(await join('newcomer', 'sx', false)).toMatchObject({ ok: true, slot: 1 });
  });

  it('refuses to remove somebody on behalf of a participant that is not the host', async () => {
    const { join, leave, seated } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    await join('p3', 's3', false);
    await leave('p3', { participantId: 'p2', sessionId: 's2' });
    expect(seated('p3', 's3')).toBeDefined();
  });

  it('refuses a ban from anyone but the host', async () => {
    const { join, leave } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    const third = await join('p3', 's3', false);
    await leave('p3', { participantId: 'p2', sessionId: 's2' }, true);
    expect(await join('p3', 's3', false, secretOf(third))).toMatchObject({ ok: true });
  });

  it('ignores a removal from a session that does not match its participant', async () => {
    const { join, leave, seated } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    await leave('p2', { participantId: 'p1', sessionId: 'forged-session' });
    expect(seated('p2', 's2')).toBeDefined();
  });

  it('promotes the claimant and bumps the epoch', async () => {
    const { join, promote, info } = setup();
    const host = await join('p1', 's1', true);
    const second = await join('p2', 's2', false);
    expect(await promote('p2', 's2', epochOf(host), secretOf(second))).toEqual({ ok: true, epoch: epochOf(host) + 1 });
    expect(await info()).toMatchObject({ hostSessionId: 's2' });
  });

  it('lets only the first of two simultaneous claims win', async () => {
    const { join, promote } = setup();
    const host = await join('p1', 's1', true);
    const second = await join('p2', 's2', false);
    const third = await join('p3', 's3', false);
    // Sent together, as two singers reacting to the same stall would
    const [winner, loser] = await Promise.all([
      promote('p2', 's2', epochOf(host), secretOf(second)),
      promote('p3', 's3', epochOf(host), secretOf(third)),
    ]);
    expect(winner).toMatchObject({ ok: true });
    expect(loser).toMatchObject({ ok: false, reason: 'stale-epoch', hostSessionId: 's2' });
  });

  it('refuses a promotion from somebody who is not in the room', async () => {
    const { join, promote } = setup();
    const host = await join('p1', 's1', true);
    expect(await promote('stranger', 'sx', epochOf(host), 'any-secret')).toMatchObject({
      ok: false,
      reason: 'not-a-member',
    });
  });

  it('keeps the outgoing host as a participant, since it may only have been throttled', async () => {
    const { join, promote } = setup();
    const host = await join('p1', 's1', true);
    const second = await join('p2', 's2', false);
    await promote('p2', 's2', epochOf(host), secretOf(second));
    expect(await join('p1', 's1', false, secretOf(host))).toMatchObject({
      ok: true,
      isHost: false,
      slot: 0,
      hostSessionId: 's2',
    });
  });

  it('refuses a rejoin that cannot prove the membership is its own', async () => {
    const { join, info, seated } = setup();
    const host = await join('p1', 's1', true);
    await join('p2', 's2', false);
    expect(await join('p1', 'attacker-session', false)).toEqual({ ok: false, reason: 'not-authorized' });
    expect(await info()).toMatchObject({ hostSessionId: 's1', epoch: epochOf(host) });
    expect(seated('p1', 's1')).toBeDefined();
  });

  it('refuses a rejoin that would cut a singer off from their own slot', async () => {
    const { join, seated } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    expect(await join('p2', 'garbage', false, 'wrong-secret')).toEqual({ ok: false, reason: 'not-authorized' });
    expect(seated('p2', 's2')).toBeDefined();
  });

  it('refuses a promotion claimed on somebody else’s behalf', async () => {
    const { join, promote, info } = setup();
    const host = await join('p1', 's1', true);
    await join('p2', 's2', false);
    expect(await promote('p2', 'attacker-session', epochOf(host), 'wrong-secret')).toMatchObject({
      ok: false,
      reason: 'not-authorized',
    });
    expect(await info()).toMatchObject({ hostSessionId: 's1', epoch: epochOf(host) });
  });

  it('elects a replacement host when the current one leaves outright', async () => {
    const { join, leave, info } = setup();
    await join('p1', 's1', true);
    await join('p2', 's2', false);
    await leave('p1', { participantId: 'p1', sessionId: 's1' });
    expect(await info()).toMatchObject({ hostSessionId: 's2' });
  });

  // What the port adds: the directory lives in a process that deploys restart

  it('keeps a room across a restart, secrets and all', async () => {
    const store = new MemoryRoomStore();
    const first = setup(store);
    await first.join('p1', 's1', true);
    const singer = await first.join('p2', 's2', false);

    const restarted = setup(store);
    expect(await restarted.join('p2', 's2-after-deploy', false, secretOf(singer))).toMatchObject({
      ok: true,
      slot: 1,
      hostSessionId: 's1',
    });
  });

  it('forgets a room left idle past the TTL', async () => {
    const store = new MemoryRoomStore();
    let time = 1_000;
    const { directory, join } = setup(store, () => time);
    await join('p1', 's1', true);
    time += DIRECTORY_TTL_MS + 1;
    await directory.expire();
    expect(await join('p2', 's2', false)).toEqual({ ok: false, reason: 'not-found' });
  });

  it('does not keep codes that were only looked up', async () => {
    const { directory } = setup();
    await directory.info('9zzzz');
    expect(directory.peek('9zzzz')).toBeUndefined();
  });
});
