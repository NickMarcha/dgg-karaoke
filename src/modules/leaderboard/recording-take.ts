/** The singer's voice through a run, for a leaderboard entry that can be played back. */
export interface RunRecording {
  data: Uint8Array;
  type: string;
  /** The video's time, in milliseconds, when the recording began: where playback starts the video. */
  offsetMs: number;
}

/** Opus where the browser has it: a voice at this rate runs to well under a megabyte a song. */
const TYPES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'];
const BITS_PER_SECOND = 32_000;

/** One recording of a microphone, started at once; `done` holds it once the recorder stops. */
export interface Take {
  recorder: MediaRecorder;
  done: Promise<Blob>;
}

export function startTake(stream: MediaStream): Take | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  if (!type) return null;
  const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: BITS_PER_SECOND });
  const chunks: Blob[] = [];
  const done = new Promise<Blob>((resolve) => {
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
  });
  recorder.start();
  return { recorder, done };
}

export const pauseTake = ({ recorder }: Take) => recorder.state === 'recording' && recorder.pause();
export const resumeTake = ({ recorder }: Take) => recorder.state === 'paused' && recorder.resume();
export const stopTake = ({ recorder }: Take) => recorder.state !== 'inactive' && recorder.stop();

/** The finished take, placed in the video; nothing when it recorded nothing. */
export async function recordingOf(take: Take, offsetMs: number): Promise<RunRecording | null> {
  const blob = await take.done;
  if (!blob.size) return null;
  return { data: new Uint8Array(await blob.arrayBuffer()), type: take.recorder.mimeType, offsetMs };
}

/** What the game tells a phone to do with its recording, following the song's clock. */
export type PhoneRecordingAction = 'start' | 'pause' | 'resume' | 'discard' | 'stop';
