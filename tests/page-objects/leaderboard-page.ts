import { Browser, BrowserContext, expect, Page } from '@playwright/test';

export class LeaderboardPagePO {
  constructor(
    private page: Page,
    private context: BrowserContext,
    private browser: Browser,
  ) {}

  // --- Post-game prompt ---

  public get prompt() {
    return this.page.getByTestId('leaderboard-prompt');
  }

  public get declineButton() {
    return this.prompt.getByTestId('leaderboard-decline');
  }

  // --- High-scores step panel ---

  /** Asked which singer the account was, when several sang on this computer. */
  public singerButton(playerNumber: number) {
    return this.prompt.getByTestId(`leaderboard-singer-${playerNumber}`);
  }

  /** What became of a shared score. */
  public get sharePanel() {
    return this.page.getByTestId('leaderboard-share-panel');
  }

  public get shareStatus() {
    return this.page.getByTestId('leaderboard-share-status');
  }

  /** Shown to a qualifying score while nobody is signed in. */
  public get signInPanel() {
    return this.page.getByTestId('leaderboard-sign-in-panel');
  }

  /** Shown once the player has declined: the way back into the prompt. */
  public get optInPanel() {
    return this.page.getByTestId('leaderboard-opt-in-panel');
  }

  public get openPromptButton() {
    return this.page.getByTestId('leaderboard-open-prompt');
  }

  // --- High-scores step: the board for the song just sung ---

  /** One song at one difficulty, beside the local high scores. */
  public get songPanel() {
    return this.page.getByTestId('song-leaderboard-panel');
  }

  public get songPanelRows() {
    return this.songPanel.getByTestId('song-leaderboard-row');
  }

  /** The run just sung, slotted into the board where it would land and ringed like a focused control. */
  public get songPanelOwnRow() {
    return this.songPanel.getByTestId('song-leaderboard-own-row');
  }

  // --- Main-menu panel ---

  /**
   * The board is rendered twice — beside the menu on desktop, inside it on mobile — and only one of
   * the two is ever on screen, so match the visible one rather than a DOM position.
   */
  public get panel() {
    return this.page.getByTestId('leaderboard-panel').and(this.page.locator(':visible'));
  }

  public get rows() {
    return this.panel.getByTestId('leaderboard-row');
  }

  /**
   * The board is global and ordered by score, so a freshly submitted row is not necessarily first —
   * look it up by name rather than by position.
   */
  public rowFor(name: string) {
    return this.rows.filter({ hasText: name });
  }

  public async expectRowFor(name: string, ...texts: string[]) {
    const row = this.rowFor(name).first();

    await expect(row).toBeVisible();
    for (const text of texts) {
      await expect(row).toContainText(text);
    }
  }
}
