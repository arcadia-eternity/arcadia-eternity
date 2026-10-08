import { expect, test, type Page } from 'playwright/test'

// Control the renderer callback while keeping the real battle page and preparation flow.
async function installControlledResources(page: Page) {
  await page.route(/seer2-pet-animator/, route =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      export const ActionState = { IDLE: '待机', PRESENT: '个性出场', ATK_PHY: '物理攻击' };
      class ControlledRenderer extends HTMLElement {
        updateComplete = Promise.resolve(true);
        callbacks = new Promise(resolve => this.addEventListener('test-ready', resolve, { once: true }));
        async getAvailableStates() { await this.callbacks; return [ActionState.IDLE]; }
        async setState() {}
        async getState() { return ActionState.IDLE; }
      }
      customElements.define('pet-render', ControlledRenderer);
    `,
    }),
  )
  await page.route(/seer2-resource\.yuuinih\.com\/png\//, route =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6G9sAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  )
}

async function enterLoadingBattle(page: Page) {
  await installControlledResources(page)
  await page.goto('/local-battle')
  const start = page.getByRole('button', { name: '开始本地对战' })
  await expect(start).toBeEnabled({ timeout: 30000 })
  await page.clock.install()
  await start.click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.locator('pet-render')).toHaveCount(1)
  await expect(page.getByTestId('battle-loading-overlay').locator('li[data-state="loading"]')).toHaveText('首发精灵')
}

async function completeCallbacks(page: Page, index: number) {
  await page
    .locator('pet-render')
    .nth(index)
    .evaluate(renderer => renderer.dispatchEvent(new Event('test-ready')))
}

test('waits for both renderer callbacks even beyond the former fallback deadline', async ({ page }) => {
  test.setTimeout(60000)
  await enterLoadingBattle(page)
  await page.clock.runFor(8000)
  await expect(page.getByTestId('battle-loading-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toHaveCount(0)
  await completeCallbacks(page, 0)
  await expect(page.locator('pet-render')).toHaveCount(2)
  await expect(page.getByTestId('battle-loading-overlay')).toBeVisible()
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toHaveCount(0)
  await completeCallbacks(page, 1)
  await page.clock.runFor(1000)
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible()
})

test('degrades a timed-out sprite and restores it without restarting the battle UI', async ({ page }) => {
  test.setTimeout(60000)
  await enterLoadingBattle(page)
  await page.clock.runFor(13000)
  await expect(page.locator('pet-render')).toHaveCount(2)
  await completeCallbacks(page, 1)
  await page.clock.runFor(1500)
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '换宠', exact: true }).click()
  const fallback = page.getByTestId('pet-static-fallback')
  await expect(fallback).toHaveCount(1)
  await completeCallbacks(page, 0)
  await expect(fallback).toHaveCount(0)
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '换宠', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('image mode plays status glow and attack waves without loading any SWF', async ({ page }) => {
  test.setTimeout(60000)
  await installControlledResources(page)
  await page.unroute(/seer2-pet-animator/)
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  const swfRequests: string[] = []
  page.on('request', request => {
    if (/\.swf(?:\?|$)/i.test(request.url())) swfRequests.push(request.url())
  })
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战' }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible()
  await expect(page.getByTestId('pet-static-fallback')).toHaveCount(2)
  const status = page.locator('[data-skill-base-id="skill_qili"]')
  await expect(status).toBeEnabled()
  await status.click()
  await expect(page.locator('[data-battle-effect="skill-glow"] svg')).toBeVisible()
  await expect(status).toBeEnabled({ timeout: 30000 })
  await page.getByTestId('skill-button').filter({ hasText: '奋力突破' }).click()
  await expect(page.locator('[data-battle-effect="skill-wave"] svg').first()).toBeVisible()
  await expect(page.locator('[data-battle-effect="damage"]').first()).toBeAttached()
  await expect(status).toBeEnabled({ timeout: 30000 })
  await expect(page.locator('pet-render')).toHaveCount(0)
  expect(swfRequests).toEqual([])
})

test('disconnect during an image attack releases the old task and keeps the real page queue usable', async ({
  page,
}) => {
  test.setTimeout(60000)
  await installControlledResources(page)
  await page.unroute(/seer2-pet-animator/)
  await page.addInitScript(() => localStorage.setItem('gameSetting.battleRenderer', '"image"'))
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战' }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  const status = page.locator('[data-skill-base-id="skill_qili"]')
  await expect(status).toBeEnabled()
  // Inject connection events around the real local battle interface and real page watcher.
  // No animation/controller/queue implementation is replaced.
  await page.evaluate(async () => {
    const path = '/src/stores/battleClient.ts'
    const { useBattleClientStore } = await import(/* @vite-ignore */ path)
    useBattleClientStore()._instance = { currentState: { status: 'connected', matchmaking: 'idle', battle: 'active' } }
  })
  await expect(status).toBeEnabled()
  await page.getByTestId('skill-button').filter({ hasText: '奋力突破' }).click()
  await expect(page.locator('[data-battle-effect="skill-wave"] svg').first()).toBeVisible()
  await page.evaluate(async () => {
    const path = '/src/stores/battleClient.ts'
    const { useBattleClientStore } = await import(/* @vite-ignore */ path)
    useBattleClientStore()._instance.currentState.status = 'disconnected'
  })
  await expect(page.locator('[data-battle-effect="skill-wave"]')).toHaveCount(0)
  await page.evaluate(async () => {
    const path = '/src/stores/battleClient.ts'
    const { useBattleClientStore } = await import(/* @vite-ignore */ path)
    useBattleClientStore()._instance.currentState.status = 'connected'
  })
  await expect(status).toBeEnabled({ timeout: 30000 })
  await status.click()
  await expect(page.locator('[data-battle-effect="skill-glow"] svg')).toBeVisible()
  await expect(status).toBeEnabled({ timeout: 30000 })
  await expect(page.getByTestId('pet-static-fallback')).toHaveCount(2)
})
