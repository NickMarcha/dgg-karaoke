import { expect, test } from '@playwright/test';

import getSongId from '../src/modules/songs/utils/get-song-id';
import { txtfile } from './fixtures/newsongtxt';
import { initTestMode, mockSongs, signIn } from './helpers';
import initialise from './page-objects/initialise';

// The e2e stack's database outlives a run, so every run submits a song of its own
const runId = Math.random().toString(36).slice(2, 8);
const songArtist = 'convert';
const songTitle = `Community ${runId}`;
const songId = getSongId({ artist: songArtist, title: songTitle });

test('A submitted song is playable as unverified, then published to everyone', async ({ page, context, browser }) => {
  test.slow();
  const pages = initialise(page, context, browser);
  await initTestMode({ page, context });
  await mockSongs({ page, context });
  await signIn({ context }, `E2E songs ${runId}`);

  /** A browser nobody signed in on, looking for the song. */
  const visitor = async () => {
    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    await initTestMode({ page: visitorPage, context: visitorContext });
    await mockSongs({ page: visitorPage, context: visitorContext });
    await visitorPage.unroute('/api/songs/index');
    const visitorPages = initialise(visitorPage, visitorContext, browser);
    await visitorPage.goto('/?e2e-test');
    await visitorPages.landingPage.enterTheGame();
    await visitorPages.mainMenuPage.goToSingSong();
    await visitorPages.songLanguagesPage.continueAndGoToSongList();
    return visitorPages;
  };

  await test.step('A signed-in singer converts a song and submits it', async () => {
    await page.goto('/?e2e-test');
    await pages.landingPage.enterTheGame();
    await pages.mainMenuPage.goToManageSongs();
    await pages.manageSongsPage.goToEditSongs();
    await pages.editSongsPage.goToConvertSong();
    await pages.songEditBasicInfoPage.enterSongTXT(txtfile);
    await pages.songEditBasicInfoPage.goToAuthorAndVideoStep();
    await pages.songEditAuthorAndVideoPage.enterVideoURL('https://www.youtube.com/watch?v=koBUXESJZ8g');
    await pages.songEditAuthorAndVideoPage.goToSyncLyricsStep();
    await pages.songEditSyncLyricsToVideoPage.goToMetadataStep();
    await pages.songEditMetadataPage.enterSongTitle(songTitle);
    await pages.songEditMetadataPage.saveAndGoToEditSongsPage();

    await pages.editSongsPage.submitSong();
    await expect(pages.editSongsPage.mySubmissions.filter({ hasText: songTitle })).toContainText('Waiting for review');
  });

  await test.step('Anyone can find it as an unverified song', async () => {
    const visitorPages = await visitor();
    await visitorPages.songListPage.searchSong(songTitle);
    await expect(visitorPages.songListPage.unverifiedSongsGroup).toBeVisible({ timeout: 15_000 });
    await expect(visitorPages.songListPage.getUnverifiedSongCardById(songId)).toBeVisible();
  });

  await test.step('A moderator publishes it', async () => {
    const moderatorContext = await browser.newContext();
    await signIn({ context: moderatorContext }, `E2E moderator ${runId}`, 'moderator');
    const moderatorPage = await moderatorContext.newPage();
    const moderatorPages = initialise(moderatorPage, moderatorContext, browser);
    await moderatorPages.adminPage.goto();
    await moderatorPages.adminPage.publishSong(songTitle);
  });

  await test.step("It is in everyone's song list, and the singer sees it published", async () => {
    const visitorPages = await visitor();
    await expect(await visitorPages.songListPage.getSongElement(songId)).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(pages.editSongsPage.mySubmissions.filter({ hasText: songTitle })).toContainText('Published');
  });
});
