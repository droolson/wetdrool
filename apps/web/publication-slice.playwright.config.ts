import { defineConfig, devices } from '@playwright/test';

const baseURL = localHttpOrigin('PLAYWRIGHT_BASE_URL');
localHttpOrigin('PUBLICATION_SLICE_AUTH_URL');
localHttpOrigin('PUBLICATION_SLICE_INDEXER_URL');
localHttpOrigin('PUBLICATION_SLICE_RPC_URL');
required('PUBLICATION_SLICE_EVIDENCE_PATH');

export default defineConfig({
  testDir: './publication-slice-e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  expect: {
    timeout: 90_000,
  },
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'localnet-publication-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

function localHttpOrigin(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.origin !== value
  ) {
    throw new Error(`${name} must be an exact loopback HTTP origin.`);
  }
  return url.origin;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the localnet publication suite.`);
  }
  return value;
}
