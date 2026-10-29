import { defineConfig, devices } from 'playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'ugc-environment-sync.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'retain-on-failure', actionTimeout: 15_000 },
})
