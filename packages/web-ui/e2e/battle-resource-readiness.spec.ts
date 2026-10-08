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
  await expect(start).toBeEnabled()
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

test('keeps a timed-out resource behind the loading screen and supports a fresh retry', async ({ page }) => {
  test.setTimeout(60000)
  await enterLoadingBattle(page)
  await page.clock.runFor(13000)
  await expect(page.getByTestId('battle-loading-overlay')).toBeVisible()
  await expect(page.getByTestId('battle-loading-overlay').getByRole('alert')).toContainText('首发精灵超时')
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByTestId('battle-loading-overlay').locator('li[data-state="loading"]')).toHaveText('首发精灵')
  await completeCallbacks(page, 0)
  await expect(page.locator('pet-render')).toHaveCount(2)
  await completeCallbacks(page, 1)
  await page.clock.runFor(1000)
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible()
})
