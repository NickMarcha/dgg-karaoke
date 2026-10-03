import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SimplifiedMic from '~/modules/game-engine/input/simplified-mic';
import userMediaService from '~/modules/user-media/user-media-service';

const fakeStream = () => {
  const track = { enabled: true, readyState: 'live' as MediaStreamTrackState, stop: vi.fn() };
  track.stop.mockImplementation(() => {
    track.readyState = 'ended';
  });
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
};

describe('SimplifiedMic', () => {
  let getUserMedia: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getUserMedia = vi.spyOn(userMediaService, 'getUserMedia');
  });

  afterEach(async () => {
    await SimplifiedMic.release();
    vi.restoreAllMocks();
  });

  it('asks for the microphone once however often the game turns monitoring on and off', async () => {
    const { track, stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    await SimplifiedMic.startMonitoring();
    await SimplifiedMic.stopMonitoring();
    expect(track.enabled).toBe(false);
    expect(track.stop).not.toHaveBeenCalled();

    await SimplifiedMic.startMonitoring();
    await SimplifiedMic.stopMonitoring();
    await SimplifiedMic.startMonitoring();

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(track.enabled).toBe(true);
  });

  it('gives the microphone back on release and asks again next time', async () => {
    const first = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(fakeStream().stream);

    await SimplifiedMic.startMonitoring();
    await SimplifiedMic.release();
    expect(first.track.stop).toHaveBeenCalled();

    await SimplifiedMic.startMonitoring();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('asks again when the browser has ended the track itself', async () => {
    const first = fakeStream();
    getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(fakeStream().stream);

    await SimplifiedMic.startMonitoring();
    await SimplifiedMic.stopMonitoring();
    first.track.readyState = 'ended';
    await SimplifiedMic.startMonitoring();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
