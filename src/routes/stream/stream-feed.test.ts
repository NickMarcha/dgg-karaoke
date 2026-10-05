import { describe, expect, it } from 'vitest';

import { StreamPacket } from '~/modules/online/streaming/types';

import { StreamFeed } from './stream-feed';

const packet = (overrides: Partial<StreamPacket> = {}): StreamPacket => ({
  songId: 'song',
  playerNumber: 0,
  name: 'Singer',
  videoTimeMs: 10_000,
  score: 100,
  readings: [[9_000, 440]],
  ...overrides,
});

describe('StreamFeed', () => {
  it('reckons where the singers are now from the freshest packet', () => {
    let now = 0;
    const feed = new StreamFeed(() => now);
    feed.receive({ participantId: 'a', username: 'A', payload: packet({ videoTimeMs: 10_000 }) });
    now = 200;
    feed.receive({ participantId: 'b', username: 'B', payload: packet({ playerNumber: 1, videoTimeMs: 9_900 }) });
    now = 300;

    // A's packet is 300 ms old (10 300), B's 100 ms (10 000): the freshest reckoning wins
    expect(feed.liveVideoTimeMs()).toBe(10_300);
    now = 5_000;
    expect(feed.liveVideoTimeMs()).toBeNull();
  });

  it('keeps every reading and each score by when it was sent, under the destiny.gg name', () => {
    const feed = new StreamFeed(() => 0);
    feed.receive({ participantId: 'a', username: 'A', payload: packet({ videoTimeMs: 1_000, score: 10 }) });
    feed.receive({
      participantId: 'a',
      username: 'A',
      payload: packet({ videoTimeMs: 1_100, score: 20, readings: [[9_100, 441]] }),
    });

    const [singer] = feed.getSingers();
    expect(singer!.name).toBe('A');
    expect(singer!.readings).toEqual([
      [9_000, 440],
      [9_100, 441],
    ]);
    expect(feed.scoreAt(singer!, 1_050)).toBe(10);
    expect(feed.scoreAt(singer!, 2_000)).toBe(20);
  });

  it('starts over on another song, and a singer over when their song restarts', () => {
    const feed = new StreamFeed(() => 0);
    feed.receive({ participantId: 'a', username: null, payload: packet({ videoTimeMs: 60_000 }) });
    const version = feed.version;

    feed.receive({ participantId: 'a', username: null, payload: packet({ videoTimeMs: 1_000 }) });
    expect(feed.getSingers()[0]!.readings).toHaveLength(1);
    expect(feed.version).toBeGreaterThan(version);

    feed.receive({ participantId: 'b', username: null, payload: packet({ songId: 'other', playerNumber: 1 }) });
    expect(feed.getSingers().map((singer) => singer.participantId)).toEqual(['b']);
  });
});
