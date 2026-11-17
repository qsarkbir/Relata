import { defineConfig } from 'vitest/config';

/**
 * Vitest（単体テスト）の設定。
 *
 * 【なぜ】vite.config.ts とは分けて、独自の設定ファイルにする。
 * vite.config.ts には React プラグインが入っているが、主な対象である src/core/ の
 * 純粋な関数のテストには要らない。テスト用の設定を分けると、テストの起動が軽くなり、
 * 画面用の変換が core のテストに紛れ込むこともない。
 * 画面のテスト（T1-16 以降）で必要になったら、mergeConfig で vite.config.ts と合成する。
 */
// 【TS】`vitest/config` の defineConfig は、Vite のものに `test` の項目の型を足したもの。
export default defineConfig({
  test: {
    // 【なぜ】既定の実行環境は node。主な対象は src/core/ の純粋な関数で、DOM は要らない。
    // 画面のテスト用の DOM 環境（happy-dom や jsdom）は、必要になるタスク（T1-16 以降）で入れる。
    // そのときは、ファイルごとに `// @vitest-environment happy-dom` で切り替える。
    environment: 'node',

    // 対象は、src/ 以下の *.test.ts(x) と tests/unit/ 以下の *.test.ts。
    // 【なぜ】tests/e2e/ は Playwright の担当なので含めない（拡張子も .spec.ts で区別する）。
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'upstream/**', 'tests/e2e/**'],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // 【なぜ】しきい値（NFR-11）は src/core/ にだけ掛ける。画面は E2E で確かめる。
      include: ['src/core/**/*.ts'],
      // 【なぜ】exclude は書かない。Vitest 4 以降は、テストファイル（*.test.ts）が
      //   exclude とは別の仕組みで自動的に測定の対象から外れる（既定の exclude は空）。
      // 【なぜ】テストから読み込まれていない core のファイルも 0% として数えられるので、
      //   テストを書き忘れるとしきい値（NFR-11）で落ちる。`npm test` のたびに確かめるため、
      //   test スクリプトに --coverage を付けてある。
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
