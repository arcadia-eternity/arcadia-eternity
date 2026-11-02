import { expect, test } from 'playwright/test'

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
  await page.getByRole('button', { name: '未连接 · 连接设置' }).click()
  await page.getByText('进入联机页面时自动连接', { exact: true }).click()
  await expect(page.getByRole('switch')).not.toBeChecked()
  expect(healthRequests).toBe(0)
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '好友大厅', exact: true }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await page.reload()
  await page.getByRole('button', { name: '未连接 · 连接设置' }).click()
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
    await page.getByRole('button', { name: '未连接 · 连接设置' }).click()
    await expect(page.getByRole('switch')).not.toBeChecked()
    expect(healthRequests).toBe(0)
    await page.reload()
    await page.getByRole('button', { name: '未连接 · 连接设置' }).click()
    expect(healthRequests).toBe(0)
    await page.getByText('进入联机页面时自动连接', { exact: true }).click()
    await expect.poll(() => healthRequests).toBeGreaterThan(0)
  })
}
