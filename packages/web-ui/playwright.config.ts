import { defineConfig, devices } from 'playwright/test'

const onlineMode = process.env.PLAYWRIGHT_ONLINE === '1'
const onlineP2PTransport = process.env.PLAYWRIGHT_P2P_TRANSPORT
const onlineServerPort = 8112
const onlineWebPort = 4175
const loopbackHost = '127.0.0.1'
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? (onlineMode ? `http://${loopbackHost}:${onlineWebPort}` : 'http://127.0.0.1:4173')

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  retries: onlineMode ? 1 : 0,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  reporter: [['line']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_CHROME_CHANNEL === 'chrome' ? { channel: 'chrome' as const } : {}),
      },
    },
  ],
  webServer: onlineMode
    ? [
        {
          command: `pnpm --filter @arcadia-eternity/server... run build && pnpm --workspace-root cli server --headless --port ${onlineServerPort} --cors-origin http://${loopbackHost}:${onlineWebPort}`,
          url: `http://${loopbackHost}:${onlineServerPort}/health`,
          reuseExistingServer: true,
          stdout: 'ignore',
          stderr: 'pipe',
          timeout: 180_000,
        },
        {
          command: `pnpm --filter @arcadia-eternity/web-ui run build:deps && VITE_BACKEND_ORIGIN=http://${loopbackHost}:${onlineServerPort}${
            onlineP2PTransport ? ` VITE_P2P_TRANSPORT=${onlineP2PTransport}` : ''
          } pnpm --filter @arcadia-eternity/web-ui exec vite --host ${loopbackHost} --port ${onlineWebPort} --strictPort`,
          url: `http://${loopbackHost}:${onlineWebPort}`,
          reuseExistingServer: true,
          stdout: 'ignore',
          stderr: 'pipe',
          timeout: 180_000,
        },
      ]
    : {
        command:
          'pnpm --filter @arcadia-eternity/web-ui run build:deps && pnpm --filter @arcadia-eternity/web-ui exec vite --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: true,
        stdout: 'ignore',
        stderr: 'pipe',
        timeout: 120_000,
      },
})
