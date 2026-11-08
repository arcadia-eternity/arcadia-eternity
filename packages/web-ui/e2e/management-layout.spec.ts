import { test, expect } from 'playwright/test'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 500 },
  { width: 390, height: 844 },
]) {
  test(`management keeps navigation visible and scrolls its content at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/e2e/fixtures/management-layout.html')
    await expect(page.getByText('正在准备固定版本')).toBeVisible()
    const pane = page.getByRole('region', { name: '管理内容' })
    await pane.evaluate(node => {
      node.scrollTop = 600
    })
    expect(await pane.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
    const layout = await page.evaluate(() => {
      const route = document.querySelector('.fixture-route')!
      return {
        overflow: route.scrollHeight - route.clientHeight,
        width: route.scrollWidth - route.clientWidth,
        top: document.querySelector('.management-heading')!.getBoundingClientRect().top,
      }
    })
    expect(layout.overflow).toBeLessThanOrEqual(1)
    expect(layout.width).toBeLessThanOrEqual(1)
    expect(layout.top).toBe(60)
    await pane.evaluate(node => {
      node.scrollTop = 0
    })
    await page.getByRole('tab', { name: '审计记录' }).click()
    const audit = page.getByRole('tabpanel', { name: '审计记录' })
    await expect(audit.locator('.el-table__body tbody tr')).toHaveCount(15)
    await audit.locator('.btn-next').click()
    await expect(audit.getByText('admin-15', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: '搜索操作记录' }).fill('admin-79')
    await expect(audit.locator('.el-table__body tbody tr')).toHaveCount(1)
    await expect(audit.getByText('admin-79', { exact: true })).toBeVisible()
    if (viewport.width < 800) {
      await page.getByRole('button', { name: '管理菜单' }).click()
      await page.getByRole('dialog').getByRole('menuitem', { name: '网络与容量' }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible()
    } else await page.getByRole('menuitem', { name: '网络与容量' }).click()
    await expect(page.getByRole('button', { name: '编辑设置' })).toBeVisible()
    expect(await pane.evaluate(node => node.scrollTop)).toBe(0)
    await page.getByRole('button', { name: '编辑设置' }).click()
    await page.getByLabel('连接范围').focus()
    await page.getByLabel('连接范围').press('ArrowDown')
    await page.getByRole('option', { name: '允许网络连接' }).click()
    await expect(page.locator('.el-select').filter({ has: page.getByLabel('连接范围') })).toContainText('允许网络连接')
    expect(errors).toEqual([])
  })
}
