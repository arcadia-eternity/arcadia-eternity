import { expect, test, type BrowserContext, type Page } from 'playwright/test'

const localPage = './#/local-battle'

async function observeStaticOnly(context: BrowserContext, page: Page, baseURL: string) {
  const forbiddenRequests: string[] = []
  const errors: string[] = []
  const origin = new URL(baseURL).origin
  const prefix = new URL(baseURL).pathname
  const forbidden = (url: string) => {
    const parsed = new URL(url)
    return (
      /^https?:$/.test(parsed.protocol) &&
      (parsed.origin !== origin ||
        !parsed.pathname.startsWith(prefix) ||
        /\/(api|socket\.io)(\/|$)/.test(parsed.pathname))
    )
  }
  context.on('request', request => {
    if (forbidden(request.url())) forbiddenRequests.push(request.url())
  })
  await context.route('**/*', route =>
    forbidden(route.request().url()) ? route.abort('blockedbyclient') : route.continue(),
  )
  await page.routeWebSocket(/.*/, socket => {
    forbiddenRequests.push(socket.url())
    socket.close()
  })
  page.on('pageerror', error => errors.push(error.message))
  return { forbiddenRequests, errors }
}

async function configureSinglePetBattle(page: Page) {
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '团队选择测试', exact: true }).click()
  await page.getByText('最大队伍大小:', { exact: true }).locator('..').locator('input').fill('1')
  await page.getByLabel('允许击破奖励切换', { exact: true }).uncheck()
  await page.getByPlaceholder('留空使用随机种子').fill('208')
}

async function enterBattle(page: Page) {
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await expect(page).toHaveURL(/#\/battle\?/)
  const team = page.getByRole('heading', { name: '完整队伍', exact: true }).locator('..')
  await team.getByText('休罗斯', { exact: true }).click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByTestId('battle-command-dock')).toBeVisible()
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await page.getByLabel('动效模式', { exact: true }).selectOption('reduced')
}

async function attackUntilResult(page: Page) {
  const result = page.locator('.battle-result')
  // The default starter has four damage moves and one status move. Use only
  // the real, enabled damage buttons; do not manipulate the battle engine.
  const attacks = page.locator('[data-testid="skill-button"]:enabled:not([data-skill-base-id="skill_qili"])')
  let turns = 0
  while (!(await result.isVisible()) && turns < 40) {
    await expect(result.or(attacks.first()).first()).toBeVisible()
    if (await result.isVisible()) break
    const button = attacks.first()
    const id = await button.getAttribute('data-skill-base-id')
    await button.click()
    turns++
    await expect(page.locator(`[data-skill-base-id="${id}"]`)).toBeDisabled()
  }
  await expect(result).toBeVisible()
  await expect(result.getByRole('heading')).toHaveText(/胜利！|失败\.\.\.|平局/)
  expect(turns).toBeGreaterThan(0)
  return turns
}

test('a new player completes a production AI match and starts another without any backend', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.goto('./')
  await expect(page).toHaveURL(/#\/local-battle$/)
  // No profile seed, resource replacements, source imports, or debug hooks.
  await configureSinglePetBattle(page)
  await enterBattle(page)
  const turns = await attackUntilResult(page)
  await testInfo.attach('static-natural-result', { body: await page.screenshot(), contentType: 'image/png' })
  await page
    .getByRole('button', { name: /再来一局|重新对战|重新开始|返回本地对战/ })
    .first()
    .click()
  await expect(page).toHaveURL(/#\/local-battle/)
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
  await testInfo.attach('static-network-and-result', {
    body: JSON.stringify({ turns, ...observed }, null, 2),
    contentType: 'application/json',
  })
})

test('saved static resources reload offline and run another local battle', async ({ page, context, baseURL }) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.goto(localPage)
  await page.getByRole('button', { name: '保存离线资源', exact: true }).click()
  await expect(page.getByText('离线资源已就绪', { exact: true })).toBeVisible({ timeout: 120_000 })
  await context.setOffline(true)
  await page.reload()
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await page.locator('[data-skill-base-id="skill_fenlitupo"]').click()
  await expect(
    page
      .getByRole('log', { name: '战斗记录' })
      .getByText(/休罗斯 使用 奋力突破/)
      .last(),
  ).toBeVisible()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
})

test('a cache quota failure is visible and does not block a local battle', async ({ page, context, baseURL }) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.addInitScript(() => {
    Cache.prototype.put = async () => {
      throw new DOMException('Test storage quota exceeded', 'QuotaExceededError')
    }
  })
  await page.goto(localPage)
  await page.getByRole('button', { name: '保存离线资源', exact: true }).click()
  await expect(page.getByText(/离线资源.*失败|空间不足/)).toBeVisible()
  await expect(page.getByText('离线资源已就绪', { exact: true })).toHaveCount(0)
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
})

test('blocked browser storage keeps the default team playable and warns that changes are not saved', async ({
  page,
  context,
  baseURL,
}) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException('Test storage access denied', 'SecurityError')
    }
    Storage.prototype.setItem = () => {
      throw new DOMException('Test storage access denied', 'SecurityError')
    }
  })
  await page.goto(localPage)
  await expect(page.getByText(/浏览器存储不可用或空间不足/)).toBeVisible()
  await configureSinglePetBattle(page)
  await enterBattle(page)
  await expect(page.locator('[data-skill-base-id="skill_fenlitupo"]')).toBeEnabled()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
})

test('a missing bundled runtime shows a recoverable startup error without using a remote fallback', async ({
  page,
  context,
  baseURL,
}) => {
  const observed = await observeStaticOnly(context, page, baseURL!)
  await page.route('**/ruffle/ruffle.js*', route => route.abort())
  await page.goto(localPage)
  await expect(page.getByRole('alert').getByRole('heading', { name: '无法启动本地对战' })).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新重试', exact: true })).toBeVisible()
  expect(observed.forbiddenRequests).toEqual([])
  expect(observed.errors).toEqual([])
  await page.unroute('**/ruffle/ruffle.js*')
  await page.getByRole('button', { name: '刷新重试', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeEnabled()
})
