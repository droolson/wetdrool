import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SOCIALLY_WOKE_WEB_PORT ?? '3000');
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
const authPort = Number(process.env.SOCIALLY_WOKE_AUTH_PORT ?? '4300');
const authServiceURL = `http://localhost:${authPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: `AUTH_DANGEROUSLY_USE_MEMORY_STORE=1 AUTH_ORIGIN=${baseURL} AUTH_RP_ID=localhost AUTH_PORT=${authPort} pnpm --filter @socially-woke/auth-service exec tsx src/server.ts`,
          reuseExistingServer: false,
          timeout: 120_000,
          url: `${authServiceURL}/healthz`,
        },
        {
          command: `SOCIALLY_WOKE_AUTH_URL=${authServiceURL} pnpm dev --webpack --port ${port}`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: baseURL,
        },
      ],
});
