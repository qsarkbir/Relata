import { expect, test } from '@playwright/test';

test.describe('アプリの外枠', () => {
  test('NFR-01: 静的にビルドしたアプリが表示される（見出し「Relata」と lang="ja"）', async ({
    page,
  }) => {
    // 操作: ビルド済みのアプリを開く。
    // 【なぜ】相対の './' にする。baseURL が /relata/ なので、base の外（'/'）を開く誤りを防げる。
    await page.goto('./');

    // 期待: 見出し「Relata」が見える。
    await expect(page.getByRole('heading', { name: 'Relata' })).toBeVisible();
    // 期待: html 要素の lang が ja（読み上げや字形選択のため）。
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
});
