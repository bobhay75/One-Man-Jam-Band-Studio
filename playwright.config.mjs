import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  reporter: [
    ['list'], ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/browser-results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    acceptDownloads: true,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Optional local fallback; CI uses Playwright's pinned Chromium installation.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: 'chromium-desktop', use: { viewport: { width: 1366, height: 768 } } },
    { name: 'chromium-mobile', use: {
      viewport: { width: 412, height: 915 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true,
    } },
  ],
  webServer: {
    command: 'node tests/browser/server.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
