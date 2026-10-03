import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('MicrophoneInputSource.getInputs', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId' | 'label'>[];
  let MicrophoneInputSource: typeof import('./microphone').MicrophoneInputSource;

  const stream = { getAudioTracks: () => [{ getSettings: () => ({ channelCount: 1 }) }] } as unknown as MediaStream;

  beforeEach(async () => {
    getUserMedia = vi.fn(async () => stream);
    devices = [
      { kind: 'audioinput', deviceId: 'default', label: 'Default' },
      { kind: 'audioinput', deviceId: 'usb', label: 'USB mic' },
    ];
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia, enumerateDevices: async () => devices },
    });
    // The source remembers what it has asked for, so every test starts from a fresh module
    vi.resetModules();
    ({ MicrophoneInputSource } = await import('./microphone'));
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

  // Firefox fires `devicechange` after a grant; asking again would prompt and fire it again, forever.
  it('asks nothing more when the devices are the ones already read', async () => {
    await MicrophoneInputSource.getInputs();
    const again = await MicrophoneInputSource.getInputs();

    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(again.map((input) => input.deviceId)).toEqual(['default', 'usb']);
  });

  it('asks only for a device it has not seen', async () => {
    await MicrophoneInputSource.getInputs();
    devices.push({ kind: 'audioinput', deviceId: 'singstar', label: 'USBMIC Serial# 1' });
    devices[0] = { ...devices[0], label: 'Default - USBMIC Serial# 1' };
    await MicrophoneInputSource.getInputs();

    expect(getUserMedia).toHaveBeenCalledTimes(5);
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'singstar' } }) }),
    );
  });

  it('asks for access again after it was refused', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'));
    await MicrophoneInputSource.getInputs();
    getUserMedia.mockClear();
    await MicrophoneInputSource.getInputs();

    expect(getUserMedia).toHaveBeenNthCalledWith(1, { audio: true, video: false });
  });
});
