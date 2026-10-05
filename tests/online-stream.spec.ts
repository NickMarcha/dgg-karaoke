import { expect, test } from '@playwright/test';

import { initTestMode, mockSongs, signIn } from './helpers';
import initialise from './page-objects/initialise';
import { createOnlineRoom } from './steps/create-online-room';
import { joinOnlineRoom } from './steps/join-online-room';
import { newPlayerPage } from './steps/new-player-page';
import { startOnlineSongAndReachLeaderboard } from './steps/start-online-song';

// A moderator's OBS link following the room they sing in: docs/plans/stream-view.md

const song = { ID: 'e2e-single-english-1995', language: 'English' };
const runId = Math.random().toString(36).slice(2, 8);

test.beforeEach(async ({ page, context }) => {
  await initTestMode({ page, context });
  await mockSongs({ page, context });
});

test("A moderator's stream shows the room's song with everyone they accepted", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.slow();
  const moderator = `E2E mod ${runId}`;
  const friend = `E2E friend ${runId}`;
  await signIn({ context }, moderator, 'moderator');
  const hostPages = initialise(page, context, browser);

  const key = await test.step('The moderator makes their OBS link', async () => {
    await page.goto('/?e2e-test');
    const response = await page.request.post('/api/moderation/stream-key', {
      headers: { origin: new URL(baseURL!).origin },
    });
    return ((await response.json()) as { key: string }).key;
  });

  const obs = await newPlayerPage(browser);
  await test.step('The OBS source waits for its owner to be in a room', async () => {
    await obs.goto(`/stream/?key=${key}`);
    await expect(obs.getByTestId('stream-status')).toHaveText('Waiting for you to join an online room.', {
      timeout: 15_000,
    });
  });

  const roomCode = await createOnlineRoom(page, context, browser, 'Mod');
  await expect(obs.getByTestId('stream-status')).toHaveText('Waiting for a song.', { timeout: 15_000 });

  const guestPage = await newPlayerPage(browser);
  await signIn({ context: guestPage.context() }, friend);
  const guestPages = await joinOnlineRoom(guestPage, guestPage.context(), browser, roomCode, 'Friend');

  await test.step('A singer asks to be on the stream, under their destiny.gg name, and the moderator accepts', async () => {
    await expect(guestPage.getByTestId('online-stream-status')).toContainText(`${moderator} is streaming this room`);
    await guestPage.getByTestId('online-stream-ask').click();
    await expect(page.getByTestId('online-stream-request')).toContainText(friend);
    await page.getByTestId('online-stream-accept').click();
    await expect(guestPage.getByTestId('online-stream-status')).toContainText('You are on their stream');
  });

  await test.step('The stream plays the song with both singers on it', async () => {
    await startOnlineSongAndReachLeaderboard(page, hostPages, guestPages, song);
    await expect(obs.getByTestId('stream-singer')).toHaveCount(2, { timeout: 20_000 });
    await expect(obs.getByTestId('stream-singer').first()).toContainText(moderator);
    await expect(obs.getByTestId('stream-singer').last()).toContainText(friend);
  });
});
