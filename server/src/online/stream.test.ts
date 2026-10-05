import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryRoomStore, OnlineDirectory } from './directory.js';
import { type OnlinePeer, OnlineRelay, type StreamWatcher } from './relay.js';

type Sent = { t: string; [key: string]: unknown };

class FakePeer implements OnlinePeer {
  sent: Sent[] = [];
  constructor(
    public sessionId: string,
    public user: OnlinePeer['user'] = null,
  ) {}
  send(message: object) {
    this.sent.push(message as Sent);
  }
  last(t: string) {
    return this.sent.filter((message) => message.t === t).at(-1);
  }
  all(t: string) {
    return this.sent.filter((message) => message.t === t);
  }
}

interface StreamState {
  streamerId: string;
  streamer: string;
  streamerParticipantId: string | null;
  onStream: string[];
  requests: { participantId: string; username: string | null }[];
}

describe('Streaming a room', () => {
  let relay: OnlineRelay;
  let mod: FakePeer;
  let friend: FakePeer;
  let stranger: FakePeer;
  let obs: StreamWatcher & { sent: Sent[] };

  const send = (peer: FakePeer, message: object) => relay.receive(peer, JSON.stringify(message));
  const join = (peer: FakePeer, participantId: string, code = '2abcd', create = false) =>
    send(peer, { t: 'join', id: 1, code, participantId, create });
  const streams = (peer: FakePeer) => (peer.last('stream-state')?.streams ?? []) as StreamState[];
  const data = () => obs.sent.filter((message) => message.t === 'stream-data');

  beforeEach(async () => {
    relay = new OnlineRelay(new OnlineDirectory(new MemoryRoomStore()));
    mod = new FakePeer('s-mod', { id: 'u-mod', username: 'Moderator' });
    friend = new FakePeer('s-friend', { id: 'u-friend', username: 'Friend' });
    stranger = new FakePeer('s-stranger', { id: 'u-stranger', username: 'Stranger' });
    [mod, friend, stranger].forEach((peer) => relay.connect(peer));
    await join(mod, 'p-mod', '2abcd', true);
    await join(friend, 'p-friend');
    await join(stranger, 'p-stranger');

    const sent: Sent[] = [];
    obs = { streamer: { id: 'u-mod', username: 'Moderator' }, sent, send: (message) => sent.push(message as Sent) };
    relay.watch(obs);
  });

  it("follows its owner's room, and tells everyone in it who is streaming", () => {
    expect(obs.sent[0]).toEqual({ t: 'stream-room', code: '2abcd' });
    expect(streams(stranger)).toEqual([
      { streamerId: 'u-mod', streamer: 'Moderator', streamerParticipantId: 'p-mod', onStream: [], requests: [] },
    ]);
  });

  it("carries the streamer's own singing, and nobody else's until the streamer accepts them", async () => {
    await send(mod, { t: 'stream-data', payload: { score: 1 } });
    await send(friend, { t: 'stream-data', payload: { score: 2 } });
    expect(data()).toEqual([
      { t: 'stream-data', participantId: 'p-mod', username: 'Moderator', payload: { score: 1 } },
    ]);

    await send(friend, { t: 'stream-request', streamerId: 'u-mod', ask: true });
    expect(streams(mod)[0]!.requests).toEqual([{ participantId: 'p-friend', username: 'Friend' }]);

    await send(mod, { t: 'stream-answer', participantId: 'p-friend', accept: true });
    expect(streams(friend)[0]!.onStream).toEqual(['p-friend']);
    await send(friend, { t: 'stream-data', payload: { score: 3 } });
    expect(data().at(-1)).toEqual(expect.objectContaining({ participantId: 'p-friend', payload: { score: 3 } }));
  });

  it('lets only the streamer answer for their stream', async () => {
    await send(stranger, { t: 'stream-request', streamerId: 'u-mod', ask: true });
    await send(friend, { t: 'stream-answer', participantId: 'p-stranger', accept: true });
    await send(stranger, { t: 'stream-data', payload: {} });

    expect(streams(mod)[0]!.onStream).toEqual([]);
    expect(data()).toEqual([]);
  });

  it('takes a singer off when they withdraw or the streamer removes them', async () => {
    await send(friend, { t: 'stream-request', streamerId: 'u-mod', ask: true });
    await send(mod, { t: 'stream-answer', participantId: 'p-friend', accept: true });
    await send(friend, { t: 'stream-request', streamerId: 'u-mod', ask: false });
    expect(streams(mod)[0]!.onStream).toEqual([]);

    await send(friend, { t: 'stream-request', streamerId: 'u-mod', ask: true });
    await send(mod, { t: 'stream-answer', participantId: 'p-friend', accept: true });
    await send(mod, { t: 'stream-answer', participantId: 'p-friend', accept: false });
    expect(streams(mod)[0]!.onStream).toEqual([]);
  });

  it('stops streaming the room when the source closes or its owner leaves for another room', async () => {
    relay.unwatch(obs);
    expect(streams(friend)).toEqual([]);

    relay.watch(obs);
    const elsewhere = new FakePeer('s-mod-2', { id: 'u-mod', username: 'Moderator' });
    relay.connect(elsewhere);
    await join(elsewhere, 'p-mod', '3abcd', true);
    expect(obs.sent.at(-1)).toEqual({ t: 'stream-room', code: '3abcd' });
    expect(streams(friend)).toEqual([]);
  });

  it('refuses a request for a stream that is not following the room', async () => {
    await send(friend, { t: 'stream-request', streamerId: 'u-stranger', ask: true });
    expect(streams(mod).map((stream) => stream.streamerId)).toEqual(['u-mod']);
  });
});
