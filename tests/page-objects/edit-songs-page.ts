import { Browser, BrowserContext, expect, Page } from '@playwright/test';

import { SongsTable } from '../components/songs-table';

export class EditSongsPagePO {
  constructor(
    private page: Page,
    private context: BrowserContext,
    private browser: Browser,
  ) {}

  songsTable = new SongsTable(this.page, this.context, this.browser);

  public async hideSong(songID: string) {
    await this.songsTable.searchSongs(songID);
    await this.page.locator(`[data-test="hide-song"][data-song="${songID}"]`).click();
  }

  public async expectSongToBeHidden(songID: string) {
    await this.songsTable.searchSongs(songID);
    await expect(this.page.locator(`[data-test="restore-song"][data-song="${songID}"]`)).toBeVisible();
  }

  public async restoreSong(songID: string) {
    await this.songsTable.searchSongs(songID);
    await this.page.locator(`[data-test="restore-song"][data-song="${songID}"]`).click();
  }

  public async expectSongToBeVisible(songID: string) {
    await this.songsTable.searchSongs(songID);
    await expect(this.page.locator(`[data-test="hide-song"][data-song = "${songID}"]`)).toBeVisible();
  }

  public async editSong(songID: string) {
    await this.songsTable.searchSongs(songID);
    await this.page.locator(`[data-test="edit-song"][data-song="${songID}"]`).click();
  }

  public async downloadSong(songID: string) {
    await this.songsTable.searchSongs(songID);
    await this.page.locator(`[data-test="download-song"][data-song="${songID}"]`).click();
  }

  public deleteSongButton(songID: string) {
    return this.page.locator(`[data-test="delete-song"][data-song="${songID}"]`);
  }

  public async deleteSong(songID: string) {
    await this.songsTable.searchSongs(songID);
    await this.deleteSongButton(songID).click();
  }

  public async goToMainMenu() {
    await this.page.getByTestId('main-menu-link').click();
  }

  public get importUltrastarButton() {
    return this.page.getByTestId('convert-song');
  }

  public async goToConvertSong() {
    await this.importUltrastarButton.click();
  }

  /** Offered after a save while signed in: send the song to DGG Karaoke for review. */
  public get submitPrompt() {
    return this.page.getByTestId('submit-song-prompt');
  }

  public async submitSong() {
    await this.submitPrompt.getByTestId('submit-song').click();
    await this.submitPrompt.getByTestId('submit-song-sent').waitFor();
    await this.submitPrompt.getByTestId('submit-song-close').click();
  }

  public get mySubmissions() {
    return this.page.getByTestId('my-submission');
  }
}
