import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one persistent Chromium context per test; keep it simple
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
