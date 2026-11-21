import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** 実機依存の性能測定。通常CIと分け、直列・再試行なしで測定値を残す。 */
export default defineConfig({
  ...base,
  testDir: './tests/performance',
  outputDir: './performance-results/artifacts',
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'performance-results/results.json' }]],
});
