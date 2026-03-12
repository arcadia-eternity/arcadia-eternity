import { expect, test } from 'playwright/test'

const ALLOWED_CONSOLE_PATTERNS = [
  /ws:\/\/localhost:8102\/socket\.io/i,
  /ERR_CONNECTION_REFUSED/i,
  /Check player status error/i,
  /Create guest error/i,
  /Initialization error: TransportError/i,
  /Failed to create guest on server, using local ID/i,
  /No species data provider available/i,
  /未找到标记图片/i,
  /No available adapters\./i,
  /Background image loading timeout/i,
  /Pet sprites not ready after maximum retries/i,
  /Failed to load resource: the server responded with a status of 404/i,
]

async function collectUnexpectedConsole(page: import('playwright/test').Page) {
  const unexpectedConsoleErrors: string[] = []

  page.on('console', message => {
    if (message.type() !== 'error' && message.type() !== 'warning') return
    const text = message.text()
    if (ALLOWED_CONSOLE_PATTERNS.some(pattern => pattern.test(text))) return
    unexpectedConsoleErrors.push(`${message.type()}: ${text}`)
  })
  return unexpectedConsoleErrors
}

async function startLocalBattle(page: import('playwright/test').Page) {
  await page.goto('/local-battle')

  await expect(page.getByRole('heading', { name: '本地对战测试' })).toBeVisible()

  const startButton = page.getByRole('button', { name: '开始本地对战' })
  await expect(startButton).toBeEnabled()
  await startButton.click()

  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page).toHaveTitle(/对战界面/)
  await expect(page.getByText('对战开始！')).toBeVisible()
  await expect(page.getByRole('button', { name: '战斗' })).toBeVisible()
}

test('local battle page can enter battle scene', async ({ page }) => {
  const unexpectedConsoleErrors = await collectUnexpectedConsole(page)

  await startLocalBattle(page)
  await expect(page.getByRole('button', { name: /气力/ })).toBeVisible()

  expect(unexpectedConsoleErrors).toEqual([])
})

test('local battle can use a skill and append battle log', async ({ page }) => {
  const unexpectedConsoleErrors = await collectUnexpectedConsole(page)

  await startLocalBattle(page)

  const qiLiButton = page.getByRole('button', { name: /气力/ })
  await expect(qiLiButton).toBeEnabled()
  await qiLiButton.click()

  await expect(page.getByText(/休罗斯 使用 气力/)).toBeVisible()
  await expect(qiLiButton).toBeDisabled()

  expect(unexpectedConsoleErrors).toEqual([])
})
