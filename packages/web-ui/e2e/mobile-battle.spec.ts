import { expect, test } from 'playwright/test'
import { prepareLocalBattle } from './helpers/local-battle-fixture'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test.beforeEach(async ({ page }) => {
  await prepareLocalBattle(page)
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).tap()
  await page.waitForURL(/\/battle\?dev=true/)
})

test('offers fullscreen in portrait and keeps battle details visible in fullscreen', async ({ page }) => {
  await page.getByRole('button', { name: '进入全屏', exact: true }).tap()
  await expect(page.locator('.battle-viewport:fullscreen')).toBeVisible()
  await page.getByRole('button', { name: '气力详情' }).tap()
  await expect(page.locator(':fullscreen [role="tooltip"]')).toBeVisible()
})

test('skill details follow battle scale and let touches reach the controls underneath', async ({ page }) => {
  const dismiss = page.getByRole('button', { name: '继续游戏' })
  await dismiss.tap()
  const info = page.getByRole('button', { name: '烈焰绝袭击详情' })
  await info.tap()
  const tooltip = page.getByRole('tooltip').filter({ has: page.getByRole('heading', { name: '技能属性' }) })
  await expect(tooltip).toBeVisible()
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport)
    await expect
      .poll(() =>
        tooltip.evaluate(el => {
          const shell = document.querySelector<HTMLElement>('.battle-shell')!
          const scale = shell.getBoundingClientRect().width / shell.offsetWidth
          return Math.abs(el.getBoundingClientRect().width - (el as HTMLElement).offsetWidth * scale)
        }),
      )
      .toBeLessThan(1)
    await expect(tooltip).toHaveCSS('pointer-events', 'none')
  }
  const switchTab = page.getByRole('button', { name: '换宠', exact: true })
  const tab = (await switchTab.boundingBox())!
  const center = { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 }
  expect(
    await tooltip.evaluate((el, point) => {
      const rect = el.getBoundingClientRect()
      return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
    }, center),
  ).toBe(true)
  await page.touchscreen.tap(center.x, center.y)
  await expect(switchTab).toHaveAttribute('aria-pressed', 'true')
  await expect(tooltip).toHaveCount(0)
})
