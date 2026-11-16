import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4321',
    headless: true,
  },
  webServer: {
    command: 'PORT=4321 node scripts/serve.mjs',
    url: 'http://127.0.0.1:4321/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
