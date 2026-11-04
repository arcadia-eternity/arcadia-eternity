import { defineConfig, devices } from 'playwright/test'

const runId = (process.env.PLAYWRIGHT_PERSONAL_RUN ??= new Date().toISOString().replace(/[:.]/g, '-'))

export default defineConfig({
  testDir: './e2e',
  testMatch: 'personal-environment.spec.ts',
  outputDir: `./test-results/personal-environment/${runId}`,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    channel: process.env.CI ? undefined : 'chrome',
    // The test records both independently created clients, including successful runs.
    trace: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
})
