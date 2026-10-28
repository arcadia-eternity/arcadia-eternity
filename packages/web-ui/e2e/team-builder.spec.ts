import { expect, test } from 'playwright/test'

test('the editor opens and saves while the animation runtime is still loading', async ({ page }) => {
  let release!: () => void
  const pendingRuntime = new Promise<void>(resolve => {
    release = resolve
  })
  await page.route('**/ruffle/ruffle.js*', async route => {
    await pendingRuntime
    await route.continue()
  })
  try {
    await page.goto('/team-builder', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible({ timeout: 5000 })
    await page.getByText('休罗斯', { exact: true }).first().click()
    await page.getByPlaceholder('输入精灵名称').fill('白屏修复测试')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('白屏修复测试', { exact: true }).click()
    await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue('白屏修复测试')
  } finally {
    release()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('navigation keeps the editor in the viewport from its first rendered frame', async ({ page }) => {
  await page.goto('/storage')
  await expect(page.getByRole('heading', { name: '精灵仓库', exact: true }).first()).toBeVisible()
  const position = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === '队伍编辑')!
    button.click()
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame)
      const heading = [...document.querySelectorAll('h1, h2')].find(el =>
        ['队伍编辑器', '正在初始化队伍编辑器'].includes(el.textContent?.trim() ?? ''),
      )
      if (heading) return { top: heading.getBoundingClientRect().top, viewport: window.innerHeight }
    }
    throw new Error('队伍编辑器未渲染')
  })
  expect(position.top).toBeLessThan(position.viewport)
})
