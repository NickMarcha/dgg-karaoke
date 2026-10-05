import { SingSetup } from '~/interfaces';
import MultiMicInput from '~/modules/game-engine/input/multi-mic-input';
import { PlayerNumber } from '~/modules/players/player-number';
import PlayersManager from '~/modules/players/players-manager';
import { InputLagSetting } from '~/routes/settings/settings-state';

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
/** Recording starts this long before the first note, after any skipped intro. */
const LEAD_IN_MS = 2_000;
/** The song's clock moving this much further than the wall clock is a seek, which breaks the sync. */
const SEEK_TOLERANCE_MS = 1_500;

interface Take {
  recorder: MediaRecorder;
  chunks: Blob[];
  offsetMs: number;
  done: Promise<Blob>;
}

/**
 * Records each local singer's microphone through the song, kept in this browser until they choose to
 * send it with their run. It follows the song's own clock: it starts just before the first note, pauses
 * while the video does, and gives up on a take the song seeks away from, since it could no longer be
 * played back in step. Two singers on one stereo device share that device's recording.
 */
class RunRecorder {
  private takes = new Map<string, Take>();
  private devicesByPlayer = new Map<PlayerNumber, string>();
  private startAtMs = 0;
  private last: { songMs: number; wallMs: number } | null = null;

  /** A new song: forgets the last one's recordings. */
  public begin = (singSetup: SingSetup, firstNoteMs: number) => {
    this.discard();
    this.startAtMs = Math.max(0, firstNoteMs - LEAD_IN_MS);
    this.devicesByPlayer.clear();
    for (const { number } of singSetup.players) {
      const input = PlayersManager.getPlayer(number)?.input;
      if (input?.source === 'Microphone' && input.deviceId) this.devicesByPlayer.set(number, input.deviceId);
    }
  };

  /** Each frame, with the song's time. */
  public tick = (songMs: number) => {
    if (typeof MediaRecorder === 'undefined' || !this.devicesByPlayer.size) return;
    const wallMs = performance.now();
    const previous = this.last;
    this.last = { songMs, wallMs };
    if (!previous) return;

    const played = songMs - previous.songMs;
    if (Math.abs(played - (wallMs - previous.wallMs)) > SEEK_TOLERANCE_MS && played !== 0) {
      this.discard();
      return;
    }
    if (played === 0) {
      this.takes.forEach(({ recorder }) => recorder.state === 'recording' && recorder.pause());
      return;
    }
    if (!this.takes.size && songMs >= this.startAtMs) this.start(songMs);
    this.takes.forEach(({ recorder }) => recorder.state === 'paused' && recorder.resume());
  };

  /** The song is over: finishes every take. */
  public stop = () => {
    this.takes.forEach(({ recorder }) => recorder.state !== 'inactive' && recorder.stop());
    this.last = null;
  };

  /** A singer's recording of the song just sung, if there is one to send. */
  public recordingOf = async (playerNumber: PlayerNumber): Promise<RunRecording | null> => {
    const take = this.takes.get(this.devicesByPlayer.get(playerNumber) ?? '');
    if (!take) return null;
    const blob = await take.done;
    if (!blob.size) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), type: take.recorder.mimeType, offsetMs: take.offsetMs };
  };

  public hasRecording = (playerNumber: PlayerNumber) => this.takes.has(this.devicesByPlayer.get(playerNumber) ?? '');

  private start = (songMs: number) => {
    const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    for (const deviceId of new Set(this.devicesByPlayer.values())) {
      const stream = MultiMicInput.getStream(deviceId);
      if (!stream || !type) continue;
      const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: BITS_PER_SECOND });
      // The song's clock runs behind the video by the calibrated lag; playback wants the video's time
      const offsetMs = Math.round(songMs + InputLagSetting.get());
      const take: Take = { recorder, chunks: [], offsetMs, done: Promise.resolve(new Blob()) };
      take.done = new Promise((resolve) => {
        recorder.ondataavailable = (event) => take.chunks.push(event.data);
        recorder.onstop = () => resolve(new Blob(take.chunks, { type: recorder.mimeType }));
      });
      recorder.start();
      this.takes.set(deviceId, take);
    }
  };

  private discard = () => {
    this.takes.forEach(({ recorder }) => recorder.state !== 'inactive' && recorder.stop());
    this.takes.clear();
    this.last = null;
  };
}

export default new RunRecorder();
