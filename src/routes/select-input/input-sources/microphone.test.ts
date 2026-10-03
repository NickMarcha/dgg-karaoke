import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MicrophoneInputSource } from './microphone';

describe('MicrophoneInputSource.getInputs', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  const stream = { getAudioTracks: () => [{ getSettings: () => ({ channelCount: 1 }) }] } as unknown as MediaStream;

  beforeEach(() => {
    getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
        enumerateDevices: async () => [
          { kind: 'audioinput', deviceId: 'default', label: 'Default' },
          { kind: 'audioinput', deviceId: 'usb', label: 'USB mic' },
        ],
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  // Firefox in a private window asks again for every request, so overlapping callers (the setup
  // screen and a device change arriving together) must not each start their own.
  it('shares one round of requests between overlapping callers', async () => {
    const [first, second] = await Promise.all([MicrophoneInputSource.getInputs(), MicrophoneInputSource.getInputs()]);

    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(second).toBe(first);
    expect(first.map((input) => input.deviceId)).toEqual(['default', 'usb']);
  });

  it('asks again once the previous round has finished', async () => {
    await MicrophoneInputSource.getInputs();
    await MicrophoneInputSource.getInputs();

    expect(getUserMedia).toHaveBeenCalledTimes(6);
  });
});
