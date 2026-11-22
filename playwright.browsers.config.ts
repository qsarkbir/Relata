import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/** 通常CIのChromiumとは別に、ローカル製品版とFirefox/WebKitを検証する。 */
export default defineConfig({
  ...base,
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
