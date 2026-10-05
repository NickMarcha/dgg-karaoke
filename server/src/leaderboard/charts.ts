import type { Song } from '~/interfaces';
import { songForScoring } from '~/modules/leaderboard/score-run';

/** A chart is read once an hour at most: songs change rarely, and a run is scored on submission. */
const CACHE_MS = 60 * 60 * 1000;
const CACHE_SIZE = 200;

/** Where a chart's txt comes from: the site's own song files, else a published community song. */
export interface ChartSources {
  siteOrigin: string;
  publishedTxt: (songId: string) => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

/**
 * The songs as the game plays them, for scoring runs. A built-in song is the site's file, as the
 * game loads it; the site answers a missing one with its page, so only plain text counts.
 */
export class Charts {
  private cache = new Map<string, { song: Song; at: number }>();

  public constructor(private sources: ChartSources) {}

  public async get(songId: string): Promise<Song | null> {
    const cached = this.cache.get(songId);
    if (cached && cached.at > Date.now() - CACHE_MS) return cached.song;

    const txt = (await this.siteTxt(songId)) ?? (await this.sources.publishedTxt(songId));
    if (!txt) return null;
    let song: Song;
    try {
      song = songForScoring(txt);
    } catch {
      return null;
    }
    this.cache.delete(songId);
    this.cache.set(songId, { song, at: Date.now() });
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return song;
  }

  private async siteTxt(songId: string) {
    const fetchImpl = this.sources.fetchImpl ?? fetch;
    const response = await fetchImpl(`${this.sources.siteOrigin}/songs/${encodeURIComponent(songId)}.txt`);
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/plain')) return null;
    return response.text();
  }
}
