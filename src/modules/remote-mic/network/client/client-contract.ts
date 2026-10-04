import { SubmitScoreInput } from '~/modules/leaderboard/client';
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
  // After a song, this phone's run when it is good enough for a board: the phone's own account puts it up
  leaderboardRun: (run: SubmitScoreInput) => void;
}
