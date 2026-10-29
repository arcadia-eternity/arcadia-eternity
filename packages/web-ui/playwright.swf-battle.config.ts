import { defineConfig, devices } from 'playwright/test'
export default defineConfig({
  testDir: './e2e',
  testMatch: 'swf-battle.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 15000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', trace: 'retain-on-failure', actionTimeout: 15000 },
})
