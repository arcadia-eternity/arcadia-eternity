import { expect, test } from 'playwright/test'

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`connection dialog covers the viewport above page content: ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.route('**/arcadia-client.json', route =>
      route.fulfill({ json: { schemaVersion: 1, backendOrigin: '/', autoConnect: false } }),
    )
    await page.goto('/content')
    await page.getByRole('button', { name: '当前未连接服务器，连接设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '服务器连接', exact: true })
    await expect(dialog).toBeVisible()
    await expect
      .poll(() =>
        dialog.evaluate(element => {
          const overlay = element.closest('.el-overlay')!
          const rect = overlay.getBoundingClientRect()
          // Hit-test the page area as well: a correct size alone cannot prove that
          // the backdrop is above the content or intercepts clicks outside the dialog.
          const top = document.elementFromPoint(8, innerHeight - 8)
          return {
            width: rect.width,
            height: rect.height,
            coversPage: !!top && overlay.contains(top),
          }
        }),
      )
      .toEqual({ ...viewport, coversPage: true })
    await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
    await dialog.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(dialog).toBeHidden()
  })
}

for (const mode of ['same-origin', 'separate-backend']) {
  test(`web deployment automatically connects by default: ${mode}`, async ({ page, baseURL }) => {
    const backend = mode === 'same-origin' ? new URL(baseURL!).origin : 'http://127.0.0.1:8199'
    let healthRequests = 0
    await page.route('**/arcadia-client.json', route =>
      route.fulfill({ json: { schemaVersion: 1, backendOrigin: backend } }),
    )
    await page.route(`${backend}/health`, route => {
      healthRequests++
      return route.fulfill({ status: 503 })
    })
    await page.goto('/')
    await expect.poll(() => healthRequests).toBeGreaterThan(0)
  })
}

test('opting out survives navigation and reload while manual connection remains available', async ({ page }) => {
  let healthRequests = 0
  await page.route('**/arcadia-client.json', route =>
    route.fulfill({ json: { schemaVersion: 1, backendOrigin: 'http://127.0.0.1:8199' } }),
  )
  await page.route('http://127.0.0.1:8199/health', route => {
    healthRequests++
    return route.fulfill({ status: 503 })
  })
  await page.goto('/dex')
  await page.getByRole('button', { name: '当前未连接服务器，连接设置' }).click()
  await page.getByText('进入联机页面时自动连接', { exact: true }).click()
  await expect(page.getByRole('switch')).not.toBeChecked()
  expect(healthRequests).toBe(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '好友大厅', exact: true }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await page.reload()
  await page.getByRole('button', { name: '当前未连接服务器，连接设置' }).click()
  expect(healthRequests).toBe(0)
  await page.getByRole('button', { name: '连接服务器', exact: true }).click()
  await expect.poll(() => healthRequests).toBeGreaterThan(0)
})

for (const mode of ['same-origin', 'separate-backend']) {
  test(`deployment can disable automatic connection without a saved user preference: ${mode}`, async ({
    page,
    baseURL,
  }) => {
    const backend = mode === 'same-origin' ? new URL(baseURL!).origin : 'http://127.0.0.1:8199'
    let healthRequests = 0
    await page.route('**/arcadia-client.json', route =>
      route.fulfill({
        json: { schemaVersion: 1, backendOrigin: backend, autoConnect: false },
      }),
    )
    await page.route(`${backend}/health`, route => {
      healthRequests++
      return route.fulfill({ status: 503 })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '当前未连接服务器，连接设置' }).click()
    await expect(page.getByRole('switch')).not.toBeChecked()
    expect(healthRequests).toBe(0)
    await page.reload()
    await page.getByRole('button', { name: '当前未连接服务器，连接设置' }).click()
    expect(healthRequests).toBe(0)
    await page.getByText('进入联机页面时自动连接', { exact: true }).click()
    await expect.poll(() => healthRequests).toBeGreaterThan(0)
  })
}

test('website only offers its configured server, with no address picker or switch action', async ({ page }) => {
  await page.route('**/arcadia-client.json', route =>
    route.fulfill({ json: { schemaVersion: 1, backendOrigin: '/', autoConnect: false } }),
  )
  await page.goto('/servers')
  await expect(page.getByRole('heading', { name: '当前网页的服务器', exact: true })).toBeVisible()
  await expect(page.getByLabel('服务器地址', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '用客户端连接', exact: true })).toHaveCount(0)
  await expect(page.getByText('当前网页只连接本站配置的服务器，不提供切服。', { exact: true })).toBeVisible()
})
