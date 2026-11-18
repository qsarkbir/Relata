import { defineConfig, devices } from '@playwright/test';

/** プレビューサーバーのポート。【なぜ】固定する。CI でも手元でも同じ URL で動かすため。 */
const PORT = '4173';

/**
 * build を省くか。【なぜ】CI は E2E の前に build 済みなので、環境変数 E2E_SKIP_BUILD で二重の build を避ける。
 * 手元では未設定なので、これまでどおり build してから起動する。
 */
/**
 * 配信先のURL。【なぜ】vite.config.ts の base（/relata/）に合わせ、末尾の `/` まで付ける。
 * テストは `page.goto('./')` のように相対で書く。`goto('/')` は base の外（サイトの根）を開いてしまい、
 * 404 になる。baseURL の末尾に `/` がないと、相対指定が `/relata` の親から解決される点にも注意。
 */
const BASE_URL = `http://localhost:${PORT}/relata/`;

const SKIP_BUILD = !!process.env.E2E_SKIP_BUILD;

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
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // 【なぜ】開発サーバーではなく、ビルドした静的ファイルを配信して試す。
  // 本番（GitHub Pages）と同じ形を確かめるため（NFR-01）。
  // --strictPort は、ポートが使用中のとき別のポートに逃げず、失敗させる。
  webServer: {
    command: SKIP_BUILD
      ? `npm run preview -- --port ${PORT} --strictPort`
      : `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
