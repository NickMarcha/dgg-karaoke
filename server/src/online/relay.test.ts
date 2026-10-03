import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryRoomStore, OnlineDirectory } from './directory.js';
import { type OnlinePeer, OnlineRelay } from './relay.js';

type Sent = { t: string; [key: string]: unknown };

class FakePeer implements OnlinePeer {
  sent: Sent[] = [];
  constructor(public sessionId: string) {}
  send(message: object) {
    this.sent.push(message as Sent);
  }
  last(t: string) {
    return this.sent.filter((message) => message.t === t).at(-1);
  }
  messages() {
    return this.sent.filter((message) => message.t === 'message');
  }
}

describe('OnlineRelay', () => {
  let relay: OnlineRelay;
  let host: FakePeer;
  let singer: FakePeer;
  let other: FakePeer;
  let singerSeat: Awaited<ReturnType<typeof join>>;

  const send = (peer: FakePeer, message: object) => relay.receive(peer, JSON.stringify(message));
  const join = async (peer: FakePeer, participantId: string, create = false, secret?: string) => {
    await send(peer, { t: 'join', id: 1, code: '2abcd', participantId, create, secret });
    return peer.last('reply')!.result as { ok: boolean; slot: number; secret: string; epoch: number };
  };

  beforeEach(async () => {
    relay = new OnlineRelay(new OnlineDirectory(new MemoryRoomStore()));
    host = new FakePeer('s-host');
    singer = new FakePeer('s-singer');
    other = new FakePeer('s-other');
    [host, singer, other].forEach((peer) => relay.connect(peer));
    await join(host, 'host', true);
    singerSeat = await join(singer, 'singer');
    await join(other, 'other');
  });

  it('greets each socket with the session id the directory knows it by', () => {
    expect(host.sent[0]).toEqual({ t: 'welcome', sessionId: 's-host' });
  });

  it('fans the host broadcast out to everyone else in the room', async () => {
    await send(host, { t: 'broadcast', payload: { t: 'heartbeat' } });
    expect(singer.messages()).toEqual([{ t: 'message', slot: null, payload: { t: 'heartbeat' } }]);
    expect(other.messages()).toHaveLength(1);
    expect(host.messages()).toHaveLength(0);
  });

  it('refuses a broadcast from anyone but the host', async () => {
    await send(singer, { t: 'broadcast', payload: { t: 'room-state', forged: true } });
    expect(other.messages()).toHaveLength(0);
    expect(host.messages()).toHaveLength(0);
  });

  it('carries a slot between the host and its one owner, both ways', async () => {
    await send(host, { t: 'slot', slot: 1, payload: { t: 'joined' } });
    expect(singer.messages()).toEqual([{ t: 'message', slot: 1, payload: { t: 'joined' } }]);
    expect(other.messages()).toHaveLength(0);

    await send(singer, { t: 'slot', slot: 1, payload: { t: 'hello' } });
    expect(host.messages()).toEqual([{ t: 'message', slot: 1, payload: { t: 'hello' } }]);
  });

  it('refuses a singer writing on somebody else’s slot', async () => {
    await send(singer, { t: 'slot', slot: 2, payload: { t: 'hello', participantId: 'other' } });
    expect(host.messages()).toHaveLength(0);
  });

  it('tells the host when a singer’s socket closes, so its grace window starts', () => {
    relay.disconnect(singer);
    expect(host.last('slot-closed')).toEqual({ t: 'slot-closed', slot: 1 });
  });

  it('says nothing when a socket already replaced by a rejoin closes', async () => {
    const secret = singerSeat.secret;
    const reconnected = new FakePeer('s-singer-2');
    relay.connect(reconnected);
    await join(reconnected, 'singer', false, secret);

    relay.disconnect(singer);
    expect(host.last('slot-closed')).toBeUndefined();

    // The new socket is the one the room talks to now
    await send(host, { t: 'slot', slot: 1, payload: { t: 'joined' } });
    expect(reconnected.messages()).toHaveLength(1);
    expect(singer.messages()).toHaveLength(0);
  });

  it('routes the room through whoever won a promotion', async () => {
    await send(singer, { t: 'promote', id: 2, fromEpoch: singerSeat.epoch, secret: singerSeat.secret });
    expect(singer.last('reply')!.result).toMatchObject({ ok: true });

    await send(singer, { t: 'broadcast', payload: { t: 'heartbeat' } });
    expect(other.messages()).toHaveLength(1);
    // The old host is still in the room and hears the new one
    expect(host.messages()).toHaveLength(1);
    // ...but its own broadcasts no longer go anywhere
    await send(host, { t: 'broadcast', payload: { t: 'heartbeat' } });
    expect(other.messages()).toHaveLength(1);
  });

  it('answers directory calls from a socket that never joined with a refusal', async () => {
    const stranger = new FakePeer('s-stranger');
    relay.connect(stranger);
    await send(stranger, { t: 'leave', id: 7, participantId: 'singer' });
    expect(stranger.last('reply')).toEqual({ t: 'reply', id: 7, result: { ok: false, reason: 'not-a-member' } });
  });

  it('ignores messages it cannot read', async () => {
    await relay.receive(host, 'not json');
    await send(host, { t: 'join', id: 1, code: 'NOT-A-CODE', participantId: 'x' });
    expect(host.sent.filter((message) => message.t === 'reply')).toHaveLength(1);
  });
});
