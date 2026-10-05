import { ReceivedStreamPacket } from '~/modules/online/streaming/types';
import { PlayerNumber } from '~/modules/players/player-number';

/** A singer whose packets stop this long counts as stopped: the room paused, or they left. */
const STALE_MS = 1_000;

export interface FeedSinger {
  participantId: string;
  name: string;
  playerNumber: PlayerNumber;
  /** Song time in ms and Hz, as the singer's game stamped them, in order. */
  readings: [number, number][];
  /** The singer's score at each video time a packet was sent. */
  scores: [number, number][];
  lastVideoTimeMs: number;
  receivedAt: number;
  /** How many pieces of their voice have arrived, for knowing whether it is on the stream at all. */
  voicePieces: number;
}

/**
 * What the stream view knows of the room: each singer's readings and scores, and where the singers'
 * videos are now. A different song starts it over. Kept apart from React so the view reads it every
 * frame without rendering for every packet.
 */
export class StreamFeed {
  public songId: string | null = null;
  private singers = new Map<string, FeedSinger>();
  /** Bumped whenever the singers or the song change, so the view sets the game up again. */
  public version = 0;

  public constructor(private now: () => number = () => performance.now()) {}

  public receive = ({ participantId, username, payload }: ReceivedStreamPacket) => {
    if (payload.songId !== this.songId) {
      this.songId = payload.songId;
      this.singers.clear();
      this.version++;
    }
    let singer = this.singers.get(participantId);
    if (!singer || singer.playerNumber !== payload.playerNumber) {
      singer = {
        participantId,
        name: username ?? payload.name,
        playerNumber: payload.playerNumber,
        readings: [],
        scores: [],
        lastVideoTimeMs: 0,
        receivedAt: 0,
        voicePieces: 0,
      };
      this.singers.set(participantId, singer);
      this.version++;
    }
    // A restart or a seek back starts the singer's run over
    if (payload.videoTimeMs < singer.lastVideoTimeMs - STALE_MS) {
      singer.readings = [];
      singer.scores = [];
      this.version++;
    }
    singer.readings.push(...payload.readings);
    singer.scores.push([payload.videoTimeMs, payload.score]);
    singer.voicePieces += payload.voice?.length ?? 0;
    singer.lastVideoTimeMs = payload.videoTimeMs;
    singer.receivedAt = this.now();
  };

  /** Another room, or none: nothing from the last one carries over. */
  public reset = () => {
    this.songId = null;
    this.singers.clear();
    this.version++;
  };

  public getSingers = () => [...this.singers.values()].sort((a, b) => a.playerNumber - b.playerNumber);

  /** Where the singers' videos are now, by the freshest packet; null when nobody is singing. */
  public liveVideoTimeMs = () => {
    const now = this.now();
    let live: number | null = null;
    for (const singer of this.singers.values()) {
      const age = now - singer.receivedAt;
      if (age > STALE_MS) continue;
      live = Math.max(live ?? -Infinity, singer.lastVideoTimeMs + age);
    }
    return live;
  };

  /** A singer's score as it stood at a point in the video. */
  public scoreAt = (singer: FeedSinger, videoTimeMs: number) => {
    let score = 0;
    for (const [at, value] of singer.scores) {
      if (at > videoTimeMs) break;
      score = value;
    }
    return score;
  };
}
