import { defineConfig, devices } from 'playwright/test'

const runId = (process.env.PLAYWRIGHT_MANAGEMENT_RUN ??= new Date().toISOString().replace(/[:.]/g, '-'))

export default defineConfig({
  testDir: './e2e',
  testMatch: 'management-backup.spec.ts',
  outputDir: `./test-results/management-backup/${runId}`,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 1000 },
    // Credentials exist only in memory; never capture traces, videos or automatic failure snapshots.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 20_000,
  },
})
