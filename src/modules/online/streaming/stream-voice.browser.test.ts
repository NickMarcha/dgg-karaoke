import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { VOICE_SAMPLE_RATE, VoicePiece, VoiceSender } from './stream-voice';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How loud each piece is, decoded the way the stream view decodes it. */
async function loudness(pieces: VoicePiece[]) {
  const levels: [number, number][] = [];
  const decoder = new AudioDecoder({
    output: (data) => {
      const samples = new Float32Array(data.numberOfFrames);
      data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      levels.push([data.timestamp / 1000, rms]);
      data.close();
    },
    error: (error) => {
      throw error;
    },
  });
  decoder.configure({ codec: 'opus', sampleRate: VOICE_SAMPLE_RATE, numberOfChannels: 1 });
  for (const [videoMs, data] of pieces) {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: videoMs * 1000, data: bytes }));
  }
  await decoder.flush();
  return levels;
}

describe('VoiceSender', () => {
  it("stamps the voice with the video's time it was sung at", async () => {
    // Audio runs once the page has been clicked, as a singer's has
    await userEvent.click(document.body);
    // A microphone stand-in that stays silent, then sounds at a moment we note on the video's clock
    const source = new AudioContext();
    const oscillator = source.createOscillator();
    const gain = source.createGain();
    gain.gain.value = 0;
    const destination = source.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();

    const sender = new VoiceSender(0);
    await sender.start(destination.stream);
    const startedAt = performance.now();
    const clock = setInterval(() => sender.setVideoTime(performance.now() - startedAt), 100);

    await wait(600);
    gain.gain.setValueAtTime(1, source.currentTime);
    const soundedAtVideoMs = performance.now() - startedAt;
    await wait(500);
    clearInterval(clock);
    const pieces = sender.take();
    sender.stop();

    const levels = await loudness(pieces);
    const firstLoud = levels.find(([, rms]) => rms > 0.1);
    expect(levels.length).toBeGreaterThan(20);
    // A piece is 20 ms, and the sound crosses from one audio context to another on its way in
    expect(firstLoud![0]).toBeGreaterThan(soundedAtVideoMs - 40);
    expect(firstLoud![0]).toBeLessThan(soundedAtVideoMs + 60);
  });
});
