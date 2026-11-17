import { defineConfig, devices } from '@playwright/test';

/** プレビューサーバーのポート。【なぜ】固定する。CI でも手元でも同じ URL で動かすため。 */
const PORT = '4173';

/**
 * Playwright（E2E テスト）の設定。
 *
 * 設計書 §14 に従い、対象は Chromium だけにする。
 */
export default defineConfig({
  testDir: './tests/e2e',
  // 【なぜ】リトライは 0。不安定なテストを「再試行で通ったこと」にして隠さない。
  retries: 0,
  // 【なぜ】CI で test.only の書き忘れがあれば失敗にする。
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 【なぜ】開発サーバーではなく、ビルドした静的ファイルを配信して試す。
  // 本番（GitHub Pages）と同じ形を確かめるため（NFR-01）。
  // --strictPort は、ポートが使用中のとき別のポートに逃げず、失敗させる。
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
