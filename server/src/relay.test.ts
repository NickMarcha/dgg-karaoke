import { pack, unpack } from 'msgpackr';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Peer, Relay } from './relay.js';

class FakePeer implements Peer {
  received: unknown[] = [];
  closedWith: string | null = null;
  send(data: Uint8Array) {
    this.received.push(unpack(data));
  }
  close(_code: number, reason: string) {
    this.closedWith = JSON.parse(reason).error;
  }
}

describe('Relay', () => {
  let relay: Relay;
  let host: FakePeer;
  let phone: FakePeer;

  beforeEach(() => {
    relay = new Relay();
    host = new FakePeer();
    phone = new FakePeer();
    relay.receive(host, pack({ t: 'register-room', id: 'abcde' }));
  });

  const join = (peer: FakePeer, id = 'phone-1', roomId = 'abcde') =>
    relay.receive(peer, pack({ t: 'register-player', id, roomId }));

  it('acknowledges a phone joining an open room', () => {
    join(phone);
    expect(phone.received).toEqual([{ t: 'connected' }]);
  });

  it('turns away a phone whose game does not exist', () => {
    join(phone, 'phone-1', 'zzzzz');
    expect(phone.closedWith).toBe('game-not-found');
  });

  it('matches the room code without regard to case', () => {
    join(phone, 'phone-1', 'ABCDE');
    expect(phone.received).toEqual([{ t: 'connected' }]);
  });

  it('carries a phone message to the host, marked with the phone id', () => {
    join(phone);
    relay.receive(phone, pack({ t: 'forward', recipients: ['abcde'], payload: { t: 'register', name: 'x' } }));
    expect(host.received).toEqual([{ t: 'forward', sender: 'phone-1', payload: { t: 'register', name: 'x' } }]);
  });

  it('carries a host message only to the phones it names', () => {
    const other = new FakePeer();
    join(phone);
    join(other, 'phone-2');
    relay.receive(host, pack({ t: 'forward', recipients: ['phone-2'], payload: { t: 'pong' } }));
    expect(phone.received).toEqual([{ t: 'connected' }]);
    expect(other.received.at(-1)).toEqual({ t: 'forward', sender: 'abcde', payload: { t: 'pong' } });
  });

  it('answers the host ping itself', () => {
    relay.receive(host, pack({ t: 'ping' }));
    expect(host.received).toEqual([{ t: 'pong' }]);
  });

  it('closes a removed phone so it does not reconnect', () => {
    join(phone);
    relay.receive(host, pack({ t: 'remove-player', id: 'phone-1' }));
    expect(phone.closedWith).toBe('player-removed');
  });

  it('refuses a second game on a code already in use', () => {
    const second = new FakePeer();
    relay.receive(second, pack({ t: 'register-room', id: 'abcde' }));
    expect(second.closedWith).toBe('room-taken');
  });

  it('gives the code back once its host has gone', () => {
    relay.disconnect(host);
    const second = new FakePeer();
    relay.receive(second, pack({ t: 'register-room', id: 'abcde' }));
    expect(second.closedWith).toBeNull();
  });

  it('tells the host when a phone drops off', () => {
    join(phone);
    relay.disconnect(phone);
    expect(host.received).toEqual([{ t: 'forward', sender: 'phone-1', payload: { t: 'unregister' } }]);
  });

  it('says nothing to the host about a phone it removed itself', () => {
    join(phone);
    relay.receive(host, pack({ t: 'remove-player', id: 'phone-1' }));
    relay.disconnect(phone);
    expect(host.received).toEqual([]);
  });

  it('closes the phones when the host goes, so they retry until it is back', () => {
    join(phone);
    relay.disconnect(host);
    expect(phone.closedWith).toBe('host-left');
    expect(relay.roomCount()).toBe(0);
  });

  it('hands a phone id to the newest socket and tells the older one to take another', () => {
    const older = new FakePeer();
    join(older);
    join(phone);
    expect(older.closedWith).toBe('unavailable-id');
    relay.receive(phone, pack({ t: 'forward', recipients: ['abcde'], payload: { t: 'ping' } }));
    // The older socket closing must neither cut off the newer one nor report the phone as gone
    relay.disconnect(older);
    relay.receive(phone, pack({ t: 'forward', recipients: ['abcde'], payload: { t: 'ping' } }));
    expect(host.received.map((message) => (message as { payload: { t: string } }).payload.t)).toEqual(['ping', 'ping']);
  });

  it('ignores a phone trying to act as the host', () => {
    const other = new FakePeer();
    join(phone);
    join(other, 'phone-2');
    relay.receive(phone, pack({ t: 'remove-player', id: 'phone-2' }));
    expect(other.closedWith).toBeNull();
  });

  it('closes a socket that sends malformed msgpack', () => {
    relay.receive(phone, new Uint8Array([0x81]));
    expect(phone.closedWith).toBe('bad-message');
  });
});
