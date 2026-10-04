import { devices, expect, test } from '@playwright/test';

import { initTestMode, mockSongs, signIn } from './helpers';
import initialise from './page-objects/initialise';
import { connectRemoteMic, openRemoteMic } from './steps/open-and-connect-remote-mic';

let pages: ReturnType<typeof initialise>;

const song = 'e2e-multitrack-polish-1994';
const language = 'Polish';

// The e2e stack's database outlives a run, and the board keeps one row per singer and song, so each
// run signs in as somebody new: a row left by an earlier run would satisfy an assertion this one never earned
const runId = Math.random().toString(36).slice(2, 8);

/**
 * From the main menu through a full song, stopping on the post-game high scores step.
 *
 * On Easy: the API enforces the real qualifying score, which the stubbed microphone clears most
 * reliably there. Easy runs go on the song's own board and never the main menu's, which is why these
 * specs look for shared scores on the former.
 */
const singTheSong = async () => {
  await pages.mainMenuPage.goToInputSelectionPage();
  await pages.inputSelectionPage.selectAdvancedSetup();
  await pages.advancedConnectionPage.goToMainMenu();
  await pages.mainMenuPage.goToSingSong();

  await pages.songLanguagesPage.ensureSongLanguageIsSelected(language);
  await pages.songLanguagesPage.continueAndGoToSongList();
  await singFromTheSongList({ calibrate: true });
};

/** The song from the song list, which the high-scores step goes back to. Calibration is asked once. */
const singFromTheSongList = async ({ calibrate = false } = {}) => {
  await pages.songListPage.focusSong(song);
  await pages.songListPage.approveSelectedSongByKeyboard();

  await pages.songPreviewPage.navigateToDifficultySettingsWithKeyboard();
  await expect(async () => {
    const level = await pages.songPreviewPage.difficultySettingsElement.getAttribute('data-test-value');
    if (level !== 'Easy') {
      await pages.songPreviewPage.difficultySettingsElement.press('Enter');
      throw new Error(`Still on ${level}`);
    }
  }).toPass({ timeout: 10_000 });
  await pages.songPreviewPage.navigateToGoNextWithKeyboard();

  await pages.songPreviewPage.navigateToPlayTheSongWithKeyboard();
  if (calibrate) await pages.calibration.approveDefaultCalibrationSetting();

  await expect(pages.postGameResultsPage.skipScoreElement).toBeVisible({ timeout: 60_000 });
  await pages.postGameResultsPage.skipScoresAnimation();
  await pages.postGameResultsPage.goToHighScoresStep();
};

test.describe('Leaderboard', () => {
  test.beforeEach(async ({ page, context, browser }) => {
    pages = initialise(page, context, browser);
    await initTestMode({ page, context });
    await mockSongs({ page, context });
  });

  test('signed out, a good score asks for a sign-in instead', async ({ page }) => {
    test.slow();
    await page.goto('/?e2e-test');
    await pages.landingPage.enterTheGame();

    await test.step('The board is on the main menu', async () => {
      await expect(pages.leaderboardPage.panel).toBeVisible();
    });

    await singTheSong();

    await expect(pages.leaderboardPage.signInPanel).toBeVisible();
    await expect(pages.leaderboardPage.prompt).toHaveCount(0);

    await test.step("The song's own board shows the run just sung", async () => {
      await expect(pages.leaderboardPage.songPanel).toBeVisible();
      await expect(pages.leaderboardPage.songPanelOwnRow).toBeVisible();
    });
  });

  test('signed in, a good score goes on the board under the account', async ({ page, context }) => {
    test.slow();
    const username = `E2E ${runId}`;
    await signIn({ context }, username);
    await page.goto('/?e2e-test');
    await pages.landingPage.enterTheGame();
    await singTheSong();

    // The advanced setup seats two players on this computer, so the prompt asks which one was signed in
    await test.step('The prompt asks which singer the account was, and putting that score up says so', async () => {
      await expect(pages.leaderboardPage.prompt).toContainText(username);
      await pages.leaderboardPage.singerButton(0).click();
      await expect(pages.leaderboardPage.prompt).toHaveCount(0);
      await expect(pages.leaderboardPage.shareStatus).toContainText(`as ${username}`, { timeout: 15_000 });
    });

    await test.step("The next run finds it on the song's board", async () => {
      await pages.postGameHighScoresPage.goToSongList();
      await singFromTheSongList();
      await expect(pages.leaderboardPage.songPanelRows.filter({ hasText: username }).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });

  test('signed in, a declined score keeps a way back in', async ({ page, context }) => {
    test.slow();
    await signIn({ context }, `E2E decline ${runId}`);
    await page.goto('/?e2e-test');
    await pages.landingPage.enterTheGame();
    await singTheSong();

    await expect(pages.leaderboardPage.prompt).toBeVisible();
    await pages.leaderboardPage.declineButton.click();
    await expect(pages.leaderboardPage.prompt).toHaveCount(0);

    await expect(pages.leaderboardPage.optInPanel).toBeVisible();
    await pages.leaderboardPage.openPromptButton.click();
    await expect(pages.leaderboardPage.prompt).toBeVisible();
  });

  // Service worker caches index.json, which breaks the song list mock for the phone
  test.use({ serviceWorkers: 'block' });

  test("a phone's singer puts their own run up from the phone", async ({ page, browser }) => {
    test.slow();
    const username = `E2E phone ${runId}`;
    await page.goto('/?e2e-test');
    await pages.landingPage.enterTheGame();
    await pages.mainMenuPage.goToInputSelectionPage();
    await pages.inputSelectionPage.selectSmartphones();

    const phoneContext = await browser.newContext({ ...devices['Pixel 5'] });
    await signIn({ context: phoneContext }, username);
    const phone = await openRemoteMic(page, phoneContext, browser);
    await connectRemoteMic(phone._page, 'Phone singer');
    await pages.smartphonesConnectionPage.goToMainMenu();

    await pages.mainMenuPage.goToSingSong();
    await pages.songLanguagesPage.ensureSongLanguageIsSelected(language);
    await pages.songLanguagesPage.continueAndGoToSongList();
    await singFromTheSongList({ calibrate: true });

    await test.step('The phone asks, as its own account, and the computer does not', async () => {
      const prompt = phone._page.getByTestId('phone-leaderboard-prompt');
      await expect(prompt).toContainText(username, { timeout: 15_000 });
      await expect(pages.leaderboardPage.prompt).toHaveCount(0);
      await phone._page.getByTestId('phone-leaderboard-submit').click();
      await expect(phone._page.getByTestId('phone-leaderboard-status')).toBeVisible({ timeout: 15_000 });
    });

    await test.step("The run is on the song's board", async () => {
      await pages.postGameHighScoresPage.goToSongList();
      await singFromTheSongList();
      await expect(pages.leaderboardPage.songPanelRows.filter({ hasText: username }).first()).toBeVisible({
        timeout: 15_000,
      });
    });
  });
});
