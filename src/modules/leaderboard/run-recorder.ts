import { SingSetup } from '~/interfaces';
import MultiMicInput from '~/modules/game-engine/input/multi-mic-input';
import {
  PhoneRecordingAction,
  pauseTake,
  recordingOf,
  resumeTake,
  RunRecording,
  startTake,
  stopTake,
  Take,
} from '~/modules/leaderboard/recording-take';
import { PlayerNumber } from '~/modules/players/player-number';
import PlayersManager from '~/modules/players/players-manager';
import RemoteMicServer from '~/modules/remote-mic/network/server';
import RemoteMicManager from '~/modules/remote-mic/remote-mic-manager';
import { InputLagSetting } from '~/routes/settings/settings-state';

/** Recording starts this long before the first note, after any skipped intro. */
const LEAD_IN_MS = 2_000;
/** The song's clock moving this much further than the wall clock is a seek, which breaks the sync. */
const SEEK_TOLERANCE_MS = 1_500;

/**
 * Records each singer through the song, kept where they sing until they choose to send it with their
 * run: a microphone on this computer here, a phone on the phone, told what to do over the relay. It
 * follows the song's own clock: it starts just before the first note, pauses while the video does, and
 * starts over when the song seeks, since a take could no longer be played back in step. Two singers on
 * one stereo device share that device's recording.
 */
class RunRecorder {
  private state: 'waiting' | 'recording' | 'paused' = 'waiting';
  private takes = new Map<string, { take: Take; offsetMs: number }>();
  private devicesByPlayer = new Map<PlayerNumber, string>();
  private phonesByPlayer = new Map<PlayerNumber, string>();
  private phoneOffsets = new Map<string, number>();
  private startAtMs = 0;
  private last: { songMs: number; wallMs: number } | null = null;

  /** A new song: forgets the last one's recordings. A phone's own start replaces its last take. */
  public begin = (singSetup: SingSetup, firstNoteMs: number) => {
    this.reset();
    this.startAtMs = Math.max(0, firstNoteMs - LEAD_IN_MS);
    this.devicesByPlayer.clear();
    this.phonesByPlayer.clear();
    for (const { number } of singSetup.players) {
      const input = PlayersManager.getPlayer(number)?.input;
      if (!input?.deviceId) continue;
      if (input.source === 'Microphone') this.devicesByPlayer.set(number, input.deviceId);
      if (input.source === 'Remote Microphone') this.phonesByPlayer.set(number, input.deviceId);
    }
  };

  /** Each frame, with the song's time. */
  public tick = (songMs: number) => {
    if (!this.devicesByPlayer.size && !this.phonesByPlayer.size) return;
    const wallMs = performance.now();
    const previous = this.last;
    this.last = { songMs, wallMs };
    if (!previous) return;

    const played = songMs - previous.songMs;
    if (played !== 0 && Math.abs(played - (wallMs - previous.wallMs)) > SEEK_TOLERANCE_MS) {
      this.tellPhones('discard');
      this.reset();
    } else if (played === 0 && this.state === 'recording') {
      this.takes.forEach(({ take }) => pauseTake(take));
      this.tellPhones('pause');
      this.state = 'paused';
    } else if (played !== 0 && this.state === 'paused') {
      this.takes.forEach(({ take }) => resumeTake(take));
      this.tellPhones('resume');
      this.state = 'recording';
    } else if (played !== 0 && this.state === 'waiting' && songMs >= this.startAtMs) {
      this.start(songMs);
    }
  };

  /** The song is over: finishes every take. */
  public stop = () => {
    this.takes.forEach(({ take }) => stopTake(take));
    if (this.state !== 'waiting') this.tellPhones('stop');
    this.last = null;
  };

  /** A singer's recording of the song just sung on this computer, if there is one to send. */
  public recordingOf = async (playerNumber: PlayerNumber): Promise<RunRecording | null> => {
    const recorded = this.takes.get(this.devicesByPlayer.get(playerNumber) ?? '');
    return recorded ? recordingOf(recorded.take, recorded.offsetMs) : null;
  };

  public hasRecording = (playerNumber: PlayerNumber) => this.takes.has(this.devicesByPlayer.get(playerNumber) ?? '');

  /** Where a phone's recording of the song just sung begins in the video, if it was told to make one. */
  public phoneOffsetOf = (playerNumber: PlayerNumber) =>
    this.phoneOffsets.get(this.phonesByPlayer.get(playerNumber) ?? '') ?? null;

  private start = (songMs: number) => {
    this.state = 'recording';
    // The song's clock runs behind the video by the calibrated lag; playback wants the video's time
    const offsetMs = Math.round(songMs + InputLagSetting.get());
    for (const deviceId of new Set(this.devicesByPlayer.values())) {
      const stream = MultiMicInput.getStream(deviceId);
      const take = stream && startTake(stream);
      if (take) this.takes.set(deviceId, { take, offsetMs });
    }
    // A phone starts once the call reaches it, which the pause and resume calls share, so they cancel out
    for (const micId of new Set(this.phonesByPlayer.values())) {
      const delayMs = RemoteMicManager.getRemoteMicById(micId)?.getNetworkDelay() ?? 0;
      this.phoneOffsets.set(micId, offsetMs + delayMs);
    }
    this.tellPhones('start');
  };

  private tellPhones = (action: PhoneRecordingAction) => {
    new Set(this.phonesByPlayer.values()).forEach((micId) => RemoteMicServer.callClient(micId, 'runRecording', action));
  };

  private reset = () => {
    this.takes.forEach(({ take }) => stopTake(take));
    this.takes.clear();
    this.phoneOffsets.clear();
    this.state = 'waiting';
    this.last = null;
  };
}

export default new RunRecorder();
