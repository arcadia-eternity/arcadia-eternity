import { expect, test } from 'playwright/test'
import { prepareLocalBattle } from './helpers/local-battle-fixture'

test.beforeEach(async ({ page }) => {
  await prepareLocalBattle(page)
})

async function runtimeFormat(page: import('playwright/test').Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/stores/battle.ts'
    const { useBattleStore } = await import(modulePath)
    const snapshot = await useBattleStore().battleInterface.createRuntimeSnapshot()
    return snapshot.format
  })
}

test('the local page uses the native runtime and can create its actual checkpoint', async ({ page }) => {
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  expect(await runtimeFormat(page)).toBe('arcadia.battle.native.v4')
})

test('the local team-selection preset confirms teams and enters the native battle', async ({ page }) => {
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '团队选择测试', exact: true }).click()
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await page
    .getByRole('heading', { name: '完整队伍', exact: true })
    .locator('..')
    .getByText('休罗斯', { exact: true })
    .click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  expect(await runtimeFormat(page)).toBe('arcadia.battle.native.v4')
})

test('cold native startup tolerates delayed portraits without entering animation recovery', async ({ page }) => {
  await prepareLocalBattle(page, 10_000)
  const healthErrors: string[] = []
  page.on('console', message => {
    if (message.text().includes('[AnimationHealthMonitor]')) healthErrors.push(message.text())
  })
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  expect(healthErrors).toEqual([])
})
