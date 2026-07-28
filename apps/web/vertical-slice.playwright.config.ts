import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (baseURL === undefined) {
  throw new Error('PLAYWRIGHT_BASE_URL is required for the production vertical-slice suite.');
}
const parsedBaseUrl = new URL(baseURL);
if (
  parsedBaseUrl.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(parsedBaseUrl.hostname)
) {
  throw new Error('The production vertical-slice suite refuses a non-local web endpoint.');
}

export default defineConfig({
  testDir: './vertical-slice-e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'production-desktop-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'production-mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
