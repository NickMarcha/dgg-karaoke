import { execFileSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { readFileSync, readdirSync } from 'fs';

import { BrowserContext, Page } from '@playwright/test';

import { BoardEntry } from '../src/modules/leaderboard/types';
import { getSongPreview } from '../src/modules/songs/utils';
import convertSongToTxt from '../src/modules/songs/utils/convert-song-to-txt';
import convertTxtToSong from '../src/modules/songs/utils/convert-txt-to-song';

const EXCLUDED_SONGS = ['shared-cloudflare-e2e'];
const songs = readdirSync('./tests/fixtures/songs/')
  .filter((file) => file.endsWith('.txt'))
  .filter((file) => !EXCLUDED_SONGS.includes(file.replace('.txt', '')))
  .map((file) => ({
    song: convertTxtToSong(readFileSync(`./tests/fixtures/songs/${file}`, { encoding: 'utf-8' })),
  }));

export const mockSongs = async ({ page }: { page: Page; context: BrowserContext }) => {
  const index = songs.map(({ song }) => getSongPreview(song));
  await page.route('/songs/index.json', (route) => route.fulfill({ status: 200, body: JSON.stringify(index) }));

  await page.route('/most-popular-songs.json', (route) => route.fulfill({ status: 200, body: JSON.stringify({}) }));
  // Songs published in the e2e database by earlier runs would join every list; the community spec lifts this
  await page.route('/api/songs/index', (route) => route.fulfill({ status: 200, body: '[]' }));

  for (const song of songs) {
    await page.route(`/songs/${song.song.id}.txt`, (route) =>
      route.fulfill({ status: 200, body: convertSongToTxt(song.song) }),
    );
  }
};

export const initTestMode = async ({ context }: { page: Page; context: BrowserContext }) => {
  await context.addInitScript(() => {
    window.isE2ETests = true;
  });
};
/**
 * Puts a mobile device straight into Mobile Phone Mode with no prompt — the `test` arm of the
 * `mobile_mode_auto_opt_in` experiment. Without it a spec gets the prompt, which is the control arm.
 */
export const enableAutoMobileMode = async ({ context }: { page: Page; context: BrowserContext }) => {
  await context.addInitScript(() => {
    window.isE2EAutoMobileMode = true;
  });
};

const BOARD_SONGS = [
  { artist: 'Bon Jovi', title: 'Livin on a Prayer' },
  { artist: 'ABBA', title: 'Dancing Queen' },
  { artist: 'Queen', title: 'Bohemian Rhapsody' },
  { artist: 'Adele', title: 'Rolling in the Deep' },
  { artist: 'Linkin Park', title: 'Numb' },
];

/**
 * A full global board, for a screen whose point is what a long one does to it. The rows are made
 * here rather than sung: the local database holds whatever earlier specs happened to submit,
 * which is neither this many rows nor the same rows twice.
 *
 * Everything a row renders is fixed: the dates are whole days back so the relative date each one
 * shows cannot drift mid-run.
 */
export const mockLeaderboard = async ({ page }: { page: Page; context: BrowserContext }, count = 50) => {
  const entries: BoardEntry[] = Array.from({ length: count }, (_, index) => ({
    name: `E2E Player ${String(index + 1).padStart(2, '0')}`,
    flair: index % 3 === 0 ? 'flair13' : null,
    score: 1_200_000 - index * 7_531,
    ...BOARD_SONGS[index % BOARD_SONGS.length],
    songId: `e2e-board-song-${index % BOARD_SONGS.length}`,
    // 1-based, and only ever Medium or Hard: Easy never reaches the global board
    tolerance: (index % 2) + 1,
    createdAt: Date.now() - ((index % 13) + 1) * 24 * 60 * 60 * 1000,
  }));

  await page.route('/api/leaderboard', (route) => route.fulfill({ status: 200, body: JSON.stringify({ entries }) }));
};

export const mockRandom = async ({ context }: { page: Page; context: BrowserContext }, randomValue = 0.5) => {
  await context.addInitScript((randomValue) => {
    window.Math.random = () => randomValue;
  }, randomValue);
};

interface SimDevice {
  id: string;
  label: string;
  channels?: number;
}
export const stubUserMedia = async ({ context, page }: { page: Page; context: BrowserContext }) => {
  await context.addInitScript(() => {
    let mediaDevices: SimDevice[] = [
      {
        id: 'default',
        label: 'Default device',
      },
    ];

    const getMediaDevices = () => {
      const data = mediaDevices.map((device) => ({
        deviceId: device.id,
        groupId: device.id,
        kind: 'audioinput',
        label: device.label,
        getCapabilities: () => ({
          channelCount: {
            max: device.channels ?? 1,
          },
        }),
      }));

      console.log(data);
      return data;
    };

    /** A stream on one device, as much of `MediaStream` as the game reads. */
    const streamOf = (device: SimDevice) => {
      const track = {
        enabled: true,
        readyState: 'live',
        stop: () => (track.readyState = 'ended'),
        getSettings: () => ({ deviceId: device.id, channelCount: device.channels ?? 1 }),
      };
      return { getAudioTracks: () => [track], getTracks: () => [track] };
    };

    // As a browser does: an exact device, or else the one the user would pick, the first
    const getUserMedia = async (capabilities: MediaStreamConstraints) => {
      // @ts-expect-error deviceId is not in the types
      const exact: string | undefined = capabilities.audio?.deviceId?.exact;
      const device = exact ? mediaDevices.find((candidate) => candidate.id === exact) : mediaDevices[0];
      if (!device) throw new OverconstrainedError('Device not found');
      return streamOf(device);
    };

    console.log(AudioBuffer);

    const callbacks: Record<string, Array<() => void>> = {
      devicechange: [],
    };
    Object.defineProperty(window.navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        enumerateDevices: () => Promise.resolve(getMediaDevices()),
        addEventListener: (e: 'devicechange', callback: () => void) => callbacks[e].push(callback),
        removeEventListener: (e: 'devicechange', callback: () => void) =>
          (callbacks[e] = callbacks[e].filter((cb) => cb !== callback)),
      },
    });

    Object.defineProperty(window, 'mediaSimulator', {
      value: {
        connectMediaDevices: (...devices: SimDevice[]) => {
          mediaDevices.push(...devices);
          callbacks.devicechange.forEach((cb) => cb());
        },
        disconnectMediaDevices: (...devices: SimDevice[]) => {
          mediaDevices = mediaDevices.filter((device) => !devices.some((removed) => removed.id === device.id));

          callbacks.devicechange.forEach((cb) => cb());
        },
      },
    });
  });

  return {
    connectDevices: (...deviceList: SimDevice[]) =>
      page.evaluate(
        ([devices]) => {
          // @ts-expect-error mediaSimulator is not in the types
          window.mediaSimulator.connectMediaDevices(...devices);
        },
        [deviceList],
      ),
    disconnectDevices: (...deviceList: SimDevice[]) =>
      page.evaluate(
        ([devices]) => {
          // @ts-expect-error mediaSimulator is not in the types
          window.mediaSimulator.disconnectMediaDevices(...devices);
        },
        [deviceList],
      ),
  };
};

/**
 * Signs the browser in as `username` by opening a session straight in the e2e stack's database.
 * The sign-in stand-in sends the browser back to port 3000, where the e2e site is not, so the specs
 * skip it; the stand-in itself was checked by hand.
 */
export const signIn = async (
  { context }: { context: BrowserContext },
  username: string,
  role: 'singer' | 'moderator' | 'admin' = 'singer',
) => {
  const token = randomUUID();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sql = `
    insert into users (dgg_user_id, username, dgg_status, role) values ('${username}', '${username}', 'Active', '${role}')
      on conflict (dgg_user_id) do update set role = excluded.role;
    insert into sessions (token_hash, user_id, expires_at)
      select '${tokenHash}', id, now() + interval '1 hour' from users where dgg_user_id = '${username}';`;
  execFileSync('docker', ['exec', '-i', 'dgg-karaoke-db-1', 'psql', '-U', 'dgg_karaoke', '-d', 'dgg_karaoke'], {
    input: sql,
  });
  // Cookies ignore ports, so this one reaches the dev and the production e2e servers alike
  await context.addCookies([{ name: 'dgg_karaoke_session', value: token, domain: 'localhost', path: '/' }]);
};
