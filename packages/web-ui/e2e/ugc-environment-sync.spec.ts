import { expect, test, type Page } from 'playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSingleProcessApp } from '../../server/src/standalone/app'
import { createNpmFixture } from '../../server/test/fixtures/npm'

// Explicit acceptance run against a production distribution: pnpm build:prod, then
// PLAYWRIGHT_UGC_SYNC=1 pnpm exec playwright test --config playwright.ugc-environment.config.ts
// No Vite source imports, interception, debug stores or injected deployment configuration.
test.skip(process.env.PLAYWRIGHT_UGC_SYNC !== '1', 'Requires the built paired server website distribution')

async function openCleanClient(page: Page, origin: string, name: string) {
  await page.addInitScript(name => {
    if (localStorage.getItem('ugc-e2e-initialized')) return
    localStorage.setItem('ugc-e2e-initialized', '1')
    const profile = { id: `sync-${name}`, name }
    localStorage.setItem('player', JSON.stringify(profile))
    localStorage.setItem('player-data', JSON.stringify(profile))
    localStorage.setItem('gameSetting.battleRenderer', '"image"')
    // Start with no pet definitions or UGC package in browser storage; create the actual pet through the editor.
    localStorage.setItem(
      'petStorage',
      JSON.stringify({
        storage: [],
        teams: [{ name: '同步队伍', pets: [], ruleSetId: 'casual_standard_ruleset' }],
        currentTeamIndex: 0,
        lastMatchingConfig: null,
      }),
    )
  }, name)
  console.log('Opening clean client', name, origin)
  await page.goto(origin)
  await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 30_000 })
  expect(await page.evaluate(() => '__APP_DEBUG__' in window)).toBe(false)
  await expect(page.getByTestId('server-address-input')).toHaveCount(0)
}

async function formCustomTeam(page: Page) {
  console.log('Forming custom team')
  await page.getByRole('link', { name: '编辑或创建队伍', exact: true }).click()
  await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加精灵', exact: true }).click()
  const species = page.locator('.el-select').first()
  await species.click()
  await species.locator('input[role=combobox]').fill('展示精灵')
  await page.getByRole('option', { name: /展示精灵/ }).click()
  await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue('展示精灵')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')!).teams[0].pets[0])
  expect(saved.species).toBe('example-slow:pet')
  expect(saved.skills).toEqual(['example-slow:strike'])
  await page.getByRole('link', { name: '返回房间', exact: true }).click()
  await page.getByTestId('room-team-selector').getByTestId('team-option-0').click()
}

test('clean production clients synchronize custom content, form teams, play a turn, reconnect and finish naturally', async ({
  browser,
}, testInfo) => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const fixture = await createNpmFixture({ presentation: true })
  const app = createSingleProcessApp({ host: '127.0.0.1', port: 0, webRoot: resolve(root, 'dist/web') })
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  try {
    // This is author-side package preparation, before server admission. Clients never see this code/package directory.
    const contentFile = join(fixture.installedDirectory, 'content.json')
    const content = JSON.parse(await readFile(contentFile, 'utf8'))
    content.data.species[0].baseStats.hp = 10
    content.data.species[0].presentation.battle = { renderer: 'image', source: 'assets/icon.png' }
    content.data.skills[0].power = 60
    content.data.skills[0].name = '同步冲击'
    await writeFile(contentFile, JSON.stringify(content))
    const environment = await app.environments.prepareNpm(fixture.directory)
    await app.start()
    const origin = `http://127.0.0.1:${app.address!.port}`
    const pages = await Promise.all(contexts.map(context => context.newPage()))
    const requests: string[] = []
    const mediaHeaders: Promise<string | null>[] = []
    for (const page of pages) {
      page.on('request', request => requests.push(request.url()))
      page.on('response', response => {
        if (response.url().includes(`/api/v1/environments/${environment.id}/assets/`))
          mediaHeaders.push(response.headerValue('cache-control'))
      })
    }
    const [host, guest] = pages
    await openCleanClient(host, origin, 'Host')
    await openCleanClient(guest, origin, 'Guest')
    console.log('Creating custom room')
    await host.getByTestId('create-private-room-button').click()
    const dialog = host.getByRole('dialog')
    const timer = dialog.getByRole('switch').first()
    if ((await timer.getAttribute('aria-checked')) === 'true') await timer.click()
    await host.getByTestId('room-environment-select').click()
    await host.getByRole('option', { name: '@arcadia-example/slow 1.0.0', exact: true }).click()
    await host.getByTestId('confirm-create-private-room-button').click()
    await expect(host).toHaveURL(/\/room\/[A-Za-z0-9]+/, { timeout: 30_000 })
    console.log('Custom room created', host.url())
    const room = host.url()
    // Updating the server's default cannot replace the environment already leased by this room.
    await fixture.changePower(1)
    const updated = await app.environments.prepareNpm(fixture.directory)
    app.environments.selectDefault(updated.id)
    await app.environments.retire(environment.id)
    expect(app.environments.list().some(entry => entry.id === environment.id)).toBe(false)
    await guest.goto(room)
    for (const page of pages) {
      await expect(page.getByTestId('room-environment')).toContainText('@arcadia-example/slow')
      await expect(page.getByText('玩家 (2/2)')).toBeVisible()
      await formCustomTeam(page)
    }
    const catalog = await host.request.get(`${origin}/api/v1/environments/${environment.id}/content`)
    expect(catalog.headers()['cache-control']).toBe('no-store')
    const published = await catalog.json()
    expect(published.species.some((row: { id: string }) => row.id === 'pet_dilan')).toBe(true)
    expect(published.species.some((row: { id: string }) => row.id === 'example-slow:pet')).toBe(true)
    expect(published.skills.every((row: object) => !Object.hasOwn(row, 'effect'))).toBe(true)
    expect(published.skills.find((row: { id: string }) => row.id === 'example-slow:strike').power).toBe(60)
    await guest.getByTestId('toggle-ready-button').click()
    await expect(guest.getByTestId('toggle-ready-button')).toContainText('取消准备')
    await expect(host.getByTestId('start-battle-button')).toBeEnabled()
    console.log('Starting custom battle')
    await host.getByTestId('start-battle-button').click()
    for (const page of pages) {
      await expect(page).toHaveURL(/\/battle\?.*privateRoom=true/, { timeout: 30_000 })
      await expect(page.getByRole('button', { name: '战斗', exact: true })).toBeVisible({ timeout: 45_000 })
      await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 45_000 })
    }
    await expect
      .poll(() =>
        host
          .getByTestId('pet-static-fallback')
          .locator('img')
          .first()
          .evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBe(1)
    await host.screenshot({ path: testInfo.outputPath('custom-battle-start.png'), fullPage: true })
    const skill = (page: Page) => page.locator('button').filter({ hasText: '同步冲击' }).first()
    const ended = (page: Page) =>
      page.getByText('胜利！', { exact: true }).or(page.getByText('失败...', { exact: true }))
    const attackLogs = host.getByText(/展示精灵 使用 同步冲击/)
    let turns = 0
    const playTurn = async () => {
      turns++
      const before = await attackLogs.count()
      for (const page of pages) {
        await expect(skill(page)).toBeEnabled({ timeout: 30_000 })
        await skill(page).click()
      }
      await expect.poll(() => attackLogs.count(), { timeout: 30_000 }).toBeGreaterThan(before)
      await expect
        .poll(async () => (await ended(host).isVisible()) || (await skill(host).isEnabled()), { timeout: 30_000 })
        .toBe(true)
    }
    await playTurn()
    for (const page of pages)
      await expect(page.getByText(/展示精灵 使用 同步冲击/).first()).toBeVisible({ timeout: 30_000 })
    await guest.reload()
    await expect(skill(guest)).toBeVisible({ timeout: 45_000 })
    for (let turn = 0; turn < 8; turn++) {
      if (await ended(host).isVisible()) break
      await playTurn()
    }
    for (const page of pages)
      await expect(
        page.getByText('胜利！', { exact: true }).or(page.getByText('失败...', { exact: true })),
      ).toBeVisible({ timeout: 30_000 })
    await host.screenshot({ path: testInfo.outputPath('custom-battle-result.png'), fullPage: true })
    expect(requests.some(url => /\/src\/|\/node_modules\/|\.tgz(?:[?#]|$)|\.ts(?:[?#]|$)/.test(url))).toBe(false)
    expect(requests.some(url => url.includes('not-fetched.swf'))).toBe(false)
    expect(mediaHeaders.length).toBeGreaterThan(0)
    expect((await Promise.all(mediaHeaders)).every(value => value === 'no-store')).toBe(true)
    const networkFile = testInfo.outputPath('network-requests.json')
    await writeFile(networkFile, JSON.stringify(requests, null, 2))
    await testInfo.attach('network-requests.json', { path: networkFile, contentType: 'application/json' })
    await writeFile(
      testInfo.outputPath('acceptance.json'),
      JSON.stringify(
        {
          origin,
          originalEnvironment: environment.id,
          newDefaultEnvironment: updated.id,
          originalSkillPower: published.skills.find((row: { id: string }) => row.id === 'example-slow:strike').power,
          turns,
          mediaRequests: mediaHeaders.length,
          totalRequests: requests.length,
          naturalResult: await ended(host).textContent(),
        },
        null,
        2,
      ),
    )
  } finally {
    console.log('Closing clean browser contexts')
    await Promise.all(contexts.map(context => context.close()))
    console.log('Stopping custom server')
    await app.stop()
    await fixture.dispose()
    console.log('Custom environment acceptance cleaned up')
  }
})
