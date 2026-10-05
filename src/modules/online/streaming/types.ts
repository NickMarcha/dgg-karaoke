import { VoicePiece } from '~/modules/online/streaming/stream-voice';
import { PlayerNumber } from '~/modules/players/player-number';

/**
 * One moderator streaming the room through their OBS link (docs/plans/stream-view.md), as the relay
 * tells every member: who is on that stream, and who is asking to be. Usernames are the API's, from
 * each socket's sign-in.
 */
export interface RoomStream {
  streamerId: string;
  streamer: string;
  /** The streamer's own seat in the room: always on their own stream. */
  streamerParticipantId: string | null;
  onStream: string[];
  requests: { participantId: string; username: string | null }[];
}

/**
 * A tenth of a second of one singer's singing, for the streams that accepted them. Everything is
 * placed by `videoTimeMs`, the singer's video when it was sent, so the stream view needs no clock but
 * its own video.
 */
export interface StreamPacket {
  songId: string;
  playerNumber: PlayerNumber;
  name: string;
  videoTimeMs: number;
  score: number;
  /** Pitch readings since the last packet: song time in ms, as the game stamps them, and Hz. */
  readings: [number, number][];
  /** The singer's voice since the last packet, when their browser can encode it. */
  voice?: VoicePiece[];
}

/** A packet as the stream view receives it, with whose it is. */
export interface ReceivedStreamPacket {
  participantId: string;
  username: string | null;
  payload: StreamPacket;
}
