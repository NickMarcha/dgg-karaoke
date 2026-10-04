import { Browser, BrowserContext, Page } from '@playwright/test';

/** `/admin/`: the moderators' review queue, the leaderboard rows and, for admins, the moderators. */
export class AdminPagePO {
  constructor(
    private page: Page,
    private context: BrowserContext,
    private browser: Browser,
  ) {}

  public async goto() {
    await this.page.goto('/admin/?e2e-test');
  }

  /** A song in the review queue, by the title it shows. */
  public song(title: string) {
    return this.page.getByTestId('admin-song').filter({ hasText: title });
  }

  public async publishSong(title: string) {
    await this.song(title).getByTestId('admin-song-publish').click();
    await this.song(title).waitFor({ state: 'detached' });
  }
}
