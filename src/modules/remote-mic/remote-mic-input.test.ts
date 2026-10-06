import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SenderInterface } from '~/modules/remote-mic/network/server/transport/interface';
import { RemoteMic } from '~/modules/remote-mic/remote-mic-input';

let direct = false;
const connection = {
  peer: 'phone-1',
  send: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  isDirect: () => direct,
} as SenderInterface;

describe('RemoteMic input lag', () => {
  let mic: RemoteMic;

  beforeEach(() => {
    vi.useFakeTimers();
    direct = false;
    mic = new RemoteMic('phone-1', 'Singer', connection, 0);
  });

  afterEach(() => {
    mic.onDisconnect();
    vi.useRealTimers();
  });

  /** A ping goes out every second; the phone echoes this one's stamp `ms` later. */
  const pingRoundTrip = (ms: number) => {
    vi.advanceTimersByTime(1000);
    const sentAt = Date.now();
    vi.advanceTimersByTime(ms);
    mic.onPong(sentAt);
  };

  it('allows for the phone processing its audio before any ping has come back', () => {
    expect(mic.getInput().getInputLag()).toBe(205);
  });

  it('adds half the measured round trip to the game', () => {
    pingRoundTrip(60);
    expect(mic.getInput().getInputLag()).toBe(205 + 30);
  });

  it('smooths one slow ping instead of jumping to it', () => {
    pingRoundTrip(60);
    pingRoundTrip(260);
    // 60 * 0.8 + 260 * 0.2 = 100 round trip, 50 one way
    expect(mic.getInput().getInputLag()).toBe(205 + 50);
  });

  it('caps a stall so it cannot shift scoring by seconds', () => {
    pingRoundTrip(5000);
    expect(mic.getInput().getInputLag()).toBe(205 + 250);
  });

  it('starts measuring over when the readings move to the direct link', () => {
    pingRoundTrip(300);
    direct = true;
    pingRoundTrip(10);
    expect(mic.getInput().getInputLag()).toBe(205 + 5);
  });

  it('reports a phone whose pongs stopped as ever later, once one lost ping is ruled out', () => {
    pingRoundTrip(40);
    vi.advanceTimersByTime(2000);
    expect(mic.getLatency()).toBe(40);
    vi.advanceTimersByTime(1500);
    expect(mic.getLatency()).toBe(1500);
  });

  it('keeps the correction the singer set on the phone', () => {
    const tuned = new RemoteMic('phone-2', 'Singer', connection, 40);
    expect(tuned.getInput().getInputLag()).toBe(205 + 40);
    tuned.onDisconnect();
  });
});
