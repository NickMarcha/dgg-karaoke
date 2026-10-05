/**
 * The voice on a stream (docs/plans/stream-view.md, layer 2): a singer's microphone in 20 ms pieces of
 * Opus, each stamped with where it belongs in the song's video, and the view's side that plays every
 * piece when its own video reaches that point.
 */

export const VOICE_SAMPLE_RATE = 48_000;
/** 20 ms, an Opus frame. */
const FRAME_SAMPLES = 960;
const BITRATE = 32_000;
const OPUS: AudioEncoderConfig = {
  codec: 'opus',
  sampleRate: VOICE_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: BITRATE,
};

/** One piece of a singer's voice: the video time it belongs at, in ms, and its Opus bytes in base64. */
export type VoicePiece = [number, string];

/**
 * Gathers the microphone into 20 ms frames at 48 kHz in the audio thread, resampling linearly where
 * the device runs at another rate. A string module, so no bundler has to know about worklets.
 */
const CAPTURE_WORKLET = `
class VoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(${FRAME_SAMPLES});
    this.filled = 0;
    this.step = sampleRate / ${VOICE_SAMPLE_RATE};
    this.position = 0;
    this.previous = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      while (this.position <= 1) {
        this.frame[this.filled++] = this.previous + (sample - this.previous) * this.position;
        this.position += this.step;
        if (this.filled === ${FRAME_SAMPLES}) {
          // The frame ends at this sample: its start, in the context's time, is a frame earlier
          this.port.postMessage({ end: currentTime + i / sampleRate, samples: this.frame });
          this.frame = new Float32Array(${FRAME_SAMPLES});
          this.filled = 0;
        }
      }
      this.position -= 1;
      this.previous = sample;
    }
    return true;
  }
}
registerProcessor('voice-capture', VoiceCapture);
`;

export const canSendVoice = async () =>
  typeof AudioEncoder !== 'undefined' &&
  typeof AudioWorkletNode !== 'undefined' &&
  ((await AudioEncoder.isConfigSupported(OPUS).catch(() => null))?.supported ?? false);

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/**
 * A singer's side: encodes their microphone while their video plays, stamping each piece with the
 * video's time when it was sung. The video's clock comes from the packet loop, which reads it ten
 * times a second; between readings it runs on at real time.
 */
export class VoiceSender {
  private context: AudioContext | null = null;
  private encoder: AudioEncoder | null = null;
  private pieces: VoicePiece[] = [];
  private clock: { videoMs: number; at: number; playing: boolean } | null = null;

  /** `lagMs` is the singer's calibrated input lag: how late their voice reaches the game. */
  public constructor(private lagMs: number) {}

  public start = async (stream: MediaStream) => {
    const context = new AudioContext();
    this.context = context;
    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    // Made outside a click it starts suspended, and resuming waits for one: the singer has usually
    // clicked on the page by now, and capture starts whenever the browser lets it
    void context.resume().catch(() => undefined);
    if (this.context !== context) return;

    this.encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.pieces.push([Math.round(chunk.timestamp / 1000), toBase64(bytes)]);
      },
      error: (error) => console.warn('Voice encoder', error),
    });
    this.encoder.configure(OPUS);

    const capture = new AudioWorkletNode(context, 'voice-capture');
    capture.port.onmessage = ({ data }: MessageEvent<{ end: number; samples: Float32Array }>) => {
      const videoMs = this.videoTimeAt(context, data.end - FRAME_SAMPLES / VOICE_SAMPLE_RATE);
      if (videoMs === null || this.encoder?.state !== 'configured') return;
      const frame = new AudioData({
        format: 'f32-planar',
        sampleRate: VOICE_SAMPLE_RATE,
        numberOfFrames: FRAME_SAMPLES,
        numberOfChannels: 1,
        timestamp: Math.round(videoMs * 1000),
        data: data.samples as Float32Array<ArrayBuffer>,
      });
      this.encoder.encode(frame);
      frame.close();
    };
    context.createMediaStreamSource(stream).connect(capture);
    // Silent, but pulled: a worklet that is not connected onwards is not run in every browser
    const mute = context.createGain();
    mute.gain.value = 0;
    capture.connect(mute).connect(context.destination);
  };

  /** Where the singer's video is, and whether it plays: their voice is only sent while it does. */
  public setVideoTime = (videoMs: number) => {
    const at = performance.now();
    const playing = this.clock !== null && videoMs !== this.clock.videoMs;
    this.clock = { videoMs, at, playing };
  };

  /** The pieces encoded since the last call. */
  public take = () => {
    const pieces = this.pieces;
    this.pieces = [];
    return pieces;
  };

  public stop = () => {
    void this.context?.close();
    this.context = null;
    if (this.encoder?.state !== 'closed') this.encoder?.close();
    this.encoder = null;
  };

  /** The video's time for a moment in the audio context's clock, as the singer heard and sang it. */
  private videoTimeAt = (context: AudioContext, contextTime: number) => {
    if (!this.clock?.playing) return null;
    const performanceTime = performance.now() - (context.currentTime - contextTime) * 1000;
    return this.clock.videoMs + (performanceTime - this.clock.at) - this.lagMs;
  };
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

/** How far ahead of the video a piece is handed to the audio clock: enough to never arrive late. */
const SCHEDULE_AHEAD_MS = 250;
/** Pieces this close to where the last one ended are joined to it, so jitter makes no clicks. */
const JOIN_TOLERANCE_S = 0.04;

/**
 * The view's side for one singer: decodes their pieces as they arrive, and plays each when the view's
 * video reaches it. Nothing is handed to the audio clock more than a moment ahead, so a pause or a seek
 * leaves nothing playing that should not.
 */
export class VoicePlayer {
  private decoder: AudioDecoder;
  private queue: { videoMs: number; buffer: AudioBuffer }[] = [];
  private nextStart = 0;

  public constructor(private context: AudioContext) {
    this.decoder = new AudioDecoder({
      output: (data) => {
        const samples = new Float32Array(data.numberOfFrames);
        data.copyTo(samples, { planeIndex: 0, format: 'f32-planar' });
        const buffer = context.createBuffer(1, data.numberOfFrames, data.sampleRate);
        buffer.copyToChannel(samples, 0);
        this.queue.push({ videoMs: data.timestamp / 1000, buffer });
        data.close();
      },
      error: (error) => console.warn('Voice decoder', error),
    });
    this.decoder.configure({ codec: 'opus', sampleRate: VOICE_SAMPLE_RATE, numberOfChannels: 1 });
  }

  public receive = (pieces: VoicePiece[]) => {
    for (const [videoMs, data] of pieces) {
      this.decoder.decode(
        new EncodedAudioChunk({ type: 'key', timestamp: Math.round(videoMs * 1000), data: fromBase64(data) }),
      );
    }
  };

  /** Each frame, with where the view's video is: plays what is about to be reached, drops what was missed. */
  public play = (videoMs: number, output: AudioNode) => {
    const now = this.context.currentTime;
    this.queue.sort((a, b) => a.videoMs - b.videoMs);
    while (this.queue.length && this.queue[0]!.videoMs < videoMs + SCHEDULE_AHEAD_MS) {
      const { videoMs: at, buffer } = this.queue.shift()!;
      let start = now + (at - videoMs) / 1000;
      if (Math.abs(start - this.nextStart) < JOIN_TOLERANCE_S) start = this.nextStart;
      if (start < now) continue;
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.start(start);
      this.nextStart = start + buffer.duration;
    }
  };

  /** The video stopped or jumped: what was decoded for where it was is no use now. */
  public clear = () => {
    this.queue = [];
    this.nextStart = 0;
  };

  public close = () => {
    if (this.decoder.state !== 'closed') this.decoder.close();
  };
}
