import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Each test launches its own Chromium with a throwaway profile, so tests are independent.
  fullyParallel: true,
  workers: process.env.CI ? 2 : '50%',
  // `dot` keeps output to failures + totals; pass --reporter=list for the full per-test log (PR runs).
  reporter: process.env.CI ? 'list' : 'dot',
  use: { trace: 'retain-on-failure' },
});
