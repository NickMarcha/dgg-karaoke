import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SenderInterface } from '~/modules/remote-mic/network/server/transport/interface';
import { RemoteMic } from '~/modules/remote-mic/remote-mic-input';

const connection = { peer: 'phone-1', send: vi.fn(), on: vi.fn(), off: vi.fn(), close: vi.fn() } as SenderInterface;

describe('RemoteMic input lag', () => {
  let mic: RemoteMic;

  beforeEach(() => {
    vi.useFakeTimers();
    mic = new RemoteMic('phone-1', 'Singer', connection, 0);
  });

  afterEach(() => {
    mic.onDisconnect();
    vi.useRealTimers();
  });

  /** The next ping goes out a second after the last pong; the phone answers `ms` later. */
  const pingRoundTrip = (ms: number) => {
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(ms);
    mic.onPong();
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

  it('keeps the correction the singer set on the phone', () => {
    const tuned = new RemoteMic('phone-2', 'Singer', connection, 40);
    expect(tuned.getInput().getInputLag()).toBe(205 + 40);
    tuned.onDisconnect();
  });
});
