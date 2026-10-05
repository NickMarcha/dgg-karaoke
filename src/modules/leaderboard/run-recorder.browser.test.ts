import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GAME_MODE, SingSetup } from '~/interfaces';
import MultiMicInput from '~/modules/game-engine/input/multi-mic-input';
import PlayersManager from '~/modules/players/players-manager';
import RemoteMicServer from '~/modules/remote-mic/network/server';
import RemoteMicManager from '~/modules/remote-mic/remote-mic-manager';
import { InputLagSetting } from '~/routes/settings/settings-state';

import RunRecorder from './run-recorder';

const singSetup = { id: 'setup', mode: GAME_MODE.DUEL, tolerance: 2, players: [{ number: 0, track: 0 }] } as SingSetup;

/** A microphone stand-in: a tone from Web Audio, which MediaRecorder records like a real one. */
function toneStream() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  return destination.stream;
}

/** Plays the song's clock forward the way the game loop does, a frame at a time. */
async function play(fromMs: number, toMs: number) {
  for (let songMs = fromMs; songMs <= toMs; songMs += 50) {
    RunRecorder.tick(songMs);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('RunRecorder', () => {
  beforeEach(() => {
    vi.spyOn(PlayersManager, 'getPlayer').mockReturnValue({
      input: { source: 'Microphone', deviceId: 'mic', channel: 0 },
    } as ReturnType<typeof PlayersManager.getPlayer>);
    vi.spyOn(MultiMicInput, 'getStream').mockReturnValue(toneStream());
    InputLagSetting.set(100);
  });

  afterEach(() => vi.restoreAllMocks());

  it('records a singer from just before the first note, with where that is in the video', async () => {
    RunRecorder.begin(singSetup, 3_000);
    await play(0, 2_500);
    RunRecorder.stop();

    const recording = await RunRecorder.recordingOf(0);
    expect(recording?.type).toMatch(/^audio\//);
    expect(recording?.data.byteLength).toBeGreaterThan(0);
    // Started at the first frame past 1 s (the first note less the lead-in), plus the calibrated lag
    expect(recording?.offsetMs).toBeGreaterThanOrEqual(1_000 + 100);
    expect(recording?.offsetMs).toBeLessThan(1_300 + 100);
  });

  it('starts again after the song seeks, from where it landed', async () => {
    RunRecorder.begin(singSetup, 0);
    await play(0, 500);
    // A skipped intro: the song jumps ahead
    await play(20_000, 20_500);
    RunRecorder.stop();

    const recording = await RunRecorder.recordingOf(0);
    expect(recording?.offsetMs).toBeGreaterThanOrEqual(20_000);
  });

  it('tells a phone when to record, and where its recording sits in the video', async () => {
    vi.spyOn(PlayersManager, 'getPlayer').mockReturnValue({
      input: { source: 'Remote Microphone', deviceId: 'phone', channel: 0 },
    } as ReturnType<typeof PlayersManager.getPlayer>);
    vi.spyOn(RemoteMicManager, 'getRemoteMicById').mockReturnValue({
      getNetworkDelay: () => 40,
    } as unknown as ReturnType<typeof RemoteMicManager.getRemoteMicById>);
    const callClient = vi.spyOn(RemoteMicServer, 'callClient').mockReturnValue();

    RunRecorder.begin(singSetup, 0);
    await play(0, 300);
    // The video stops for a moment
    RunRecorder.tick(300);
    RunRecorder.tick(300);
    await play(350, 500);
    RunRecorder.stop();

    const actions = callClient.mock.calls.map(([micId, method, action]) => `${micId} ${method} ${action}`);
    expect(actions).toEqual([
      'phone runRecording start',
      'phone runRecording pause',
      'phone runRecording resume',
      'phone runRecording stop',
    ]);
    // Its first frame past the start, plus the calibrated lag, plus the call's trip to the phone
    expect(RunRecorder.phoneOffsetOf(0)).toBe(50 + 100 + 40);
    expect(await RunRecorder.recordingOf(0)).toBeNull();
  });
});
