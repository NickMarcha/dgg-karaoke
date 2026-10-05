import { SubmitScoreInput } from '~/modules/leaderboard/client';
import { PhoneRecordingAction } from '~/modules/leaderboard/recording-take';
import { PlayerNumber } from '~/modules/players/player-number';
import { RemoteMicPermission } from '~/routes/settings/settings-state';

// Defines all methods the server can call on the client via rpc-call messages.
// Implementations are registered imperatively (in NetworkClient) or via the useClientHandler hook.
export interface ClientContract {
  startMonitor: () => void;
  stopMonitor: () => void;
  setPlayerNumber: (playerNumber: PlayerNumber | null) => void;
  setPermissions: (level: RemoteMicPermission) => void;
  reload: () => void;
  requestReadiness: () => void;
  // Sent by the host when the player settings screen is shown, so unassigned phones can auto-open the player picker
  notifyPlayerSettingsOpen: () => void;
  // Through a song, when to record the singer's voice, following the song's clock
  runRecording: (action: PhoneRecordingAction) => void;
  // After a song, this phone's run when it is good enough for a board: the phone's own account puts it up.
  // With where the phone's recording begins in the video, when it was told to make one
  leaderboardRun: (run: SubmitScoreInput, recordingOffsetMs: number | null) => void;
}
