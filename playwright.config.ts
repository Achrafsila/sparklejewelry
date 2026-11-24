import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Test artefacts go to the system temp folder, not into the (possibly cloud-synced) project.
const artefacts = join(tmpdir(), 'sparkle-playwright');

/**
 * End-to-end tests run the real UI against the local stack (Postgres + PostgREST + dev stub).
 * Four projects cover phone, tablet and desktop, with WebKit in dark mode for Safari-like checks.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  outputDir: join(artefacts, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(artefacts, 'report') }]],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'fr-FR',
    timezoneId: 'Africa/Casablanca',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    {
      name: 'phone-chromium',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'phone-webkit-dark',
      use: { ...devices['iPhone 14'], viewport: { width: 390, height: 844 }, colorScheme: 'dark' },
    },
    {
      name: 'tablet-webkit',
      use: { ...devices['iPad (gen 7)'], viewport: { width: 768, height: 1024 } },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
