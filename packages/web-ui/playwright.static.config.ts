import { defineConfig, devices } from 'playwright/test'

// Exercise a built site below a directory, on a host with no SPA rewrite or API.
const baseURL = 'http://127.0.0.1:4179/game/'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'static-local-battle.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PLAYWRIGHT_CHANNEL } }],
  webServer: {
    command: 'node e2e/helpers/static-server.mjs',
    url: baseURL,
    reuseExistingServer: false,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 15_000,
  },
})
