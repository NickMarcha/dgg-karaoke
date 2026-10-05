import { describe, expect, it, vi } from 'vitest';

import SimplifiedMic from '~/modules/game-engine/input/simplified-mic';

import PhoneRecorder from './phone-recorder';

function toneStream() {
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  oscillator.connect(destination);
  oscillator.start();
  return destination.stream;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('PhoneRecorder', () => {
  it('records when the game says, and keeps the take for the run after the next song starts', async () => {
    vi.spyOn(SimplifiedMic, 'acquireStream').mockResolvedValue(toneStream());

    await PhoneRecorder.handle('start');
    await wait(300);
    await PhoneRecorder.handle('stop');
    const recording = PhoneRecorder.recordingAt(4_200);
    await PhoneRecorder.handle('start');

    const sent = await recording?.();
    expect(sent?.offsetMs).toBe(4_200);
    expect(sent?.data.byteLength).toBeGreaterThan(0);
  });

  it('has nothing to send after the game discards the take', async () => {
    vi.spyOn(SimplifiedMic, 'acquireStream').mockResolvedValue(toneStream());

    await PhoneRecorder.handle('start');
    await PhoneRecorder.handle('discard');

    expect(PhoneRecorder.recordingAt(0)).toBeUndefined();
  });
});
