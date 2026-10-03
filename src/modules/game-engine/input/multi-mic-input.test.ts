import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SelectedPlayerInput } from '~/modules/players/players-manager';

import MultiMicInput from './multi-mic-input';

const onDevice = (deviceId: string): SelectedPlayerInput => ({ source: 'Microphone', deviceId, channel: 0 });

describe('MultiMicInput', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let tracks: { enabled: boolean; readyState: string; stop: ReturnType<typeof vi.fn> }[];

  beforeEach(() => {
    tracks = [];
    getUserMedia = vi.fn(async () => {
      const track = {
        enabled: true,
        readyState: 'live',
        stop: vi.fn(() => {
          track.readyState = 'ended';
        }),
      };
      tracks.push(track);
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    // Monitoring itself needs Web Audio, which is not what is under test here
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => {
        throw new Error('no Web Audio in unit tests');
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await MultiMicInput.releaseUnused([]);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Firefox asks again for a device stopped more than a few seconds ago, which is every song
  it('keeps the microphone between monitoring sessions, muted', async () => {
    await MultiMicInput.startMonitoring('usb', [onDevice('usb')]);
    await MultiMicInput.stopMonitoring();

    expect(tracks[0].enabled).toBe(false);
    expect(tracks[0].stop).not.toHaveBeenCalled();

    await MultiMicInput.startMonitoring('usb', [onDevice('usb')]);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0].enabled).toBe(true);
  });

  it('asks for exactly the chosen device', async () => {
    await MultiMicInput.startMonitoring('usb', [onDevice('usb')]);

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { deviceId: { exact: 'usb' }, echoCancellation: false },
      video: false,
    });
  });

  it('gives back a device nobody sings through any more', async () => {
    await MultiMicInput.startMonitoring('usb', [onDevice('usb')]);
    await MultiMicInput.stopMonitoring();
    await MultiMicInput.startMonitoring('webcam', [onDevice('webcam')]);
    await MultiMicInput.releaseUnused([onDevice('webcam')]);

    expect(tracks[0].stop).toHaveBeenCalled();
    expect(tracks[1].stop).not.toHaveBeenCalled();
  });
});
