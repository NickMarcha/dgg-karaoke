import { Song } from '~/interfaces';
import { readJson } from '~/modules/api';
import { getSongPreview } from '~/modules/songs/utils';
import convertSongToTxt from '~/modules/songs/utils/convert-song-to-txt';

/** Where a submitted song stands: see `community_songs` in `server/src/schema.ts`. */
export type CommunitySongStatus = 'submitted' | 'published' | 'rejected' | 'archived';

export interface CommunitySong {
  id: string;
  songId: string;
  artist: string;
  title: string;
  status: CommunitySongStatus;
  rejectionReason: string | null;
  updatedAt: string;
  /** Present on the moderators' lists. */
  submittedBy?: string | null;
}

/** What the API stores of a song: the UltraStar text, and the song list's preview of it. */
export const songBody = (song: Song) =>
  JSON.stringify({ txt: convertSongToTxt(song), preview: getSongPreview(song, { local: false }) });

/** Sends a song for a moderator to review, as the signed-in account. */
export async function submitSong(song: Song) {
  return readJson<{ id: string }>(
    await fetch('/api/songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: songBody(song),
    }),
  );
}

export const MY_SONGS_URL = '/api/songs/mine';

export const fetchMySongs = async () => (await readJson<{ songs: CommunitySong[] }>(await fetch(MY_SONGS_URL))).songs;

/** For moderators: one submission in full, to open in the editor. */
export const fetchSubmission = async (id: string) =>
  readJson<CommunitySong & { txt: string }>(await fetch(`/api/moderation/songs/${id}`));

/** For moderators: replaces a submission's song with the editor's corrected one. */
export async function correctSubmission(id: string, song: Song) {
  await readJson(
    await fetch(`/api/moderation/songs/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: songBody(song),
    }),
  );
}

export const moderationSongsUrl = (status: CommunitySongStatus, query: string) =>
  `/api/moderation/songs?${new URLSearchParams(query ? { status, query } : { status })}`;

const moderate = async (id: string, action: 'publish' | 'reject', body: object = {}) =>
  readJson(
    await fetch(`/api/moderation/songs/${id}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

/** For moderators: into everyone's song list, replacing the version that was there. */
export const publishSubmission = (id: string) => moderate(id, 'publish');

/** For moderators: back to the submitter, with the reason they will see. */
export const rejectSubmission = (id: string, reason: string) => moderate(id, 'reject', { reason });
