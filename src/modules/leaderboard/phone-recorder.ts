import SimplifiedMic from '~/modules/game-engine/input/simplified-mic';
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

/**
 * The phone's side of a run's recording: it records its own microphone when the game says, so its
 * singer can send their voice with the run the game hands them. Where it sits in the video is the
 * game's to say, and comes with the run.
 */
class PhoneRecorder {
  private take: Take | null = null;

  public handle = async (action: PhoneRecordingAction) => {
    if (action === 'start') {
      if (this.take) stopTake(this.take);
      this.take = null;
      const stream = await SimplifiedMic.acquireStream();
      this.take = startTake(stream);
    } else if (this.take) {
      if (action === 'pause') pauseTake(this.take);
      if (action === 'resume') resumeTake(this.take);
      if (action === 'stop' || action === 'discard') stopTake(this.take);
      if (action === 'discard') this.take = null;
    }
  };

  /** The take just finished, held for the run's prompt even if the next song starts another. */
  public recordingAt = (offsetMs: number): (() => Promise<RunRecording | null>) | undefined => {
    const take = this.take;
    return take ? () => recordingOf(take, offsetMs) : undefined;
  };
}

export default new PhoneRecorder();
