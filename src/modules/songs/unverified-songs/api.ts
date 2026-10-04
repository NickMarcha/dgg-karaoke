import { UnverifiedSongPayload, UnverifiedSongSearchResult } from '~/modules/songs/unverified-songs/types';

/** Songs submitted to our API and still waiting for a moderator, which anyone may play as unverified. */
export const getUnverifiedSongsSearch = async (query: string): Promise<UnverifiedSongSearchResult[]> => {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  try {
    const response = await fetch(`/api/songs/unverified?${new URLSearchParams({ query: trimmedQuery })}`);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as UnverifiedSongSearchResult[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
};

export const getUnverifiedSongById = async (sharedSongId: string): Promise<UnverifiedSongPayload> => {
  const trimmedSongId = sharedSongId.trim();
  if (!trimmedSongId) {
    throw new Error('Missing shared song id');
  }

  const response = await fetch(`/api/songs/unverified/${encodeURIComponent(trimmedSongId)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch unverified song: ${response.status}`);
  }

  return (await response.json()) as UnverifiedSongPayload;
};
