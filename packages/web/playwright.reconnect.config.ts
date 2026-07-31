import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'reconnect-recovery.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: {
    timeout: 20_000,
  },
  outputDir: path.join(os.tmpdir(), 'openchamber-reconnect-e2e-results'),
  reporter: 'line',
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    headless: process.env.OPENCHAMBER_E2E_HEADED !== '1',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: {
      width: 1280,
      height: 900,
    },
  },
});
