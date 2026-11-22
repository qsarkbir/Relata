import { expect, test } from '@playwright/test';
import { startApp, counts, loadedNotice, openProject, csvButton } from './support';
test.use({ locale: 'ja-JP' });

test('FR-IN-09: 日本語の説明と承認済み英題を表示し1クリックで全サンプルを読む', async ({
  page,
}) => {
  await startApp(page);
  await expect(
    page.getByText('Scholars and Sufis of the Maghrib in the Fifteenth and Sixteenth Centuries', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(loadedNotice(page)).toContainText('Scholars and Sufis');
  await expect(counts(page)).toContainText('/ 219');
  await expect(counts(page)).toContainText('/ 204');
  await expect(csvButton(page)).toBeEnabled();
  await expect(page.getByRole('button', { name: 'サンプルを読み込む' })).toHaveCount(0);
});

test('FR-IN-09: 取得失敗を知らせ、再試行で読める', async ({ page }) => {
  await page.route('**/samples/maghrib.relata.json', (route) =>
    route.fulfill({ status: 503, body: '' }),
  );
  await startApp(page);
  const open = page.getByRole('button', { name: 'サンプルを読み込む' });
  await open.click();
  await expect(page.getByRole('alert').filter({ hasText: 'もう一度' })).toBeVisible();
  await expect(open).toBeEnabled();
  await page.unroute('**/samples/maghrib.relata.json');
  await open.click();
  await expect(loadedNotice(page)).toContainText('Scholars and Sufis');
});

for (const cancel of [true, false]) {
  test(`FR-IN-09 / FR-UI-03: ${cancel ? '取消後' : '取得中のまま'}に別ファイルを開いても遅いサンプルで置き換えない`, async ({
    page,
  }) => {
    let release: () => void = () => {
      /* ルートが登録された後に置き換える。 */
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let fetched = false;
    let finished = false;
    await page.route('**/samples/maghrib.relata.json', async (route) => {
      fetched = true;
      await held;
      await route.continue().catch(() => undefined);
      finished = true;
    });
    await startApp(page);
    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await expect.poll(() => fetched).toBe(true);
    if (cancel) await page.getByRole('button', { name: /サンプルデータ.*取り消す/ }).click();
    await openProject(page, 'maghrib.relata.json');
    release();
    await expect.poll(() => finished).toBe(true);
    await expect(counts(page)).toContainText('/ 15');
    await expect(loadedNotice(page)).not.toContainText('Scholars and Sufis');
  });
}

test('FR-IN-09 / FR-UI-01: 英語でも承認した説明と読み込み操作が使える', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await startApp(page);
  await expect(page.getByText(/This dataset records the social network/)).toBeVisible();
  await page.getByRole('button', { name: 'Load sample dataset' }).click();
  await expect(loadedNotice(page)).toContainText('Scholars and Sufis');
  await context.close();
});
