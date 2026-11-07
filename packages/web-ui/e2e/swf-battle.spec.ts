import { expect, test, type Page } from 'playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSingleProcessApp } from '../../server/src/standalone/app'
import { createNpmFixture } from '../../server/test/fixtures/npm'

test.skip(process.env.PLAYWRIGHT_SWF_BATTLE !== '1', 'Requires the built paired website and live original SWF endpoint')
const originalUrls = [1, 2].map(number => `https://seer2-pet-resource.yuuinih.com/public/fight/${number}.swf`)
type PlaybackEvent = { type: string; instance: string; state?: string; states?: string[] }

async function observeClient(page: Page, origin: string, name: string) {
  await page.addInitScript(name => {
    // Observe only the public browser transport, without importing app stores or changing playback messages.
    const observations: unknown[] = []
    const commands: unknown[] = []
    Object.assign(window, { swfBattleEvents: observations, swfBattleCommands: commands })
    const NativeMessageChannel = window.MessageChannel
    window.MessageChannel = class extends NativeMessageChannel {
      constructor() {
        super()
        const post = this.port1.postMessage.bind(this.port1)
        this.port1.postMessage = (...args: Parameters<MessagePort['postMessage']>) => {
          const data = args[0]
          if (data?.v === 1 && typeof data.instance === 'string')
            commands.push({
              type: data.type,
              instance: data.instance,
              task: data.task,
              seq: data.seq,
              state: data.state,
            })
          return post(...args)
        }
        this.port1.addEventListener('message', event => {
          if (event.data?.v === 1 && typeof event.data.instance === 'string') observations.push(event.data)
        })
      }
    }
    if (localStorage.getItem('swf-battle-initialized')) return
    localStorage.setItem('swf-battle-initialized', '1')
    const profile = { id: `swf-${name}`, name }
    localStorage.setItem('player', JSON.stringify(profile))
    localStorage.setItem('player-data', JSON.stringify(profile))
    localStorage.setItem('gameSetting.battleRenderer', '"swf"')
    localStorage.setItem(
      'petStorage',
      JSON.stringify({
        storage: [],
        teams: [{ name: '原作动画队伍', pets: [], ruleSetId: 'casual_standard_ruleset' }],
        currentTeamIndex: 0,
        lastMatchingConfig: null,
      }),
    )
  }, name)
  await page.goto(origin)
  await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 30000 })
  expect(await page.evaluate(() => '__APP_DEBUG__' in window)).toBe(false)
}
const playback = (page: Page) =>
  page.evaluate(() => (window as Window & { swfBattleEvents: PlaybackEvent[] }).swfBattleEvents)
async function formTeam(page: Page, species: string) {
  await page.getByRole('link', { name: '编辑或创建队伍', exact: true }).click()
  await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '添加精灵', exact: true }).click()
  const selector = page.locator('.el-select').first()
  await selector.click()
  await selector.locator('input[role=combobox]').fill(species)
  await page.getByRole('option', { name: new RegExp(species) }).click()
  await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue(species)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByRole('link', { name: '返回房间', exact: true }).click()
  await page.getByTestId('room-team-selector').getByTestId('team-option-0').click()
}
async function expectOriginalPlayers(page: Page) {
  await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0, { timeout: 45000 })
  await expect(page.locator('iframe[title="精灵动画"]')).toHaveCount(2, { timeout: 45000 })
  await expect
    .poll(
      async () =>
        (await playback(page)).filter(event => event.type === 'ready' && event.states?.includes('物理攻击')).length,
      { timeout: 45000 },
    )
    .toBe(2)
  await expect(page.getByTestId('pet-static-fallback')).toHaveCount(0)
}

test('two production clients play original SWFs through a real battle, refresh, result and disposal', async ({
  browser,
}, testInfo) => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const fixture = await createNpmFixture({ presentation: true, remoteUrl: originalUrls[0] })
  const app = createSingleProcessApp({ host: '127.0.0.1', port: 0, webRoot: resolve(root, 'dist/web') })
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  let pages: Page[] = []
  try {
    const contentPath = join(fixture.installedDirectory, 'content.json')
    const content = JSON.parse(await readFile(contentPath, 'utf8'))
    content.data.species[0].baseStats.hp = 30
    content.data.species[0].name = '原作一号'
    content.data.species[0].presentation.battle.source = originalUrls[0]
    const second = structuredClone(content.data.species[0])
    second.id = 'pet-two'
    second.num = 2
    second.name = '原作二号'
    second.presentation.battle.source = originalUrls[1]
    content.data.species.push(second)
    content.data.skills[0].power = 60
    content.data.skills[0].name = '原作冲击'
    await writeFile(contentPath, JSON.stringify(content))
    const presentationPath = join(fixture.installedDirectory, 'dist/presentation.json')
    const presentation = JSON.parse(await readFile(presentationPath, 'utf8'))
    presentation.resources.push({
      kind: 'http',
      id: originalUrls[1],
      source: originalUrls[1],
      mime: 'application/x-shockwave-flash',
    })
    presentation.locales['zh-CN'].species = { pet: { name: '原作一号' }, 'pet-two': { name: '原作二号' } }
    await writeFile(presentationPath, JSON.stringify(presentation))
    const environment = await app.environments.prepareNpm(fixture.directory)
    await app.start()
    const origin = `http://127.0.0.1:${app.address!.port}`
    pages = await Promise.all(contexts.map(context => context.newPage()))
    const [host, guest] = pages
    const requests: string[] = [],
      failures: string[] = []
    const mediaResponses: { url: string; status: number }[] = []
    for (const page of pages) {
      page.on('request', request => requests.push(request.url()))
      page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`))
      page.on('response', response => {
        if (originalUrls.includes(response.url()))
          mediaResponses.push({ url: response.url(), status: response.status() })
      })
    }
    await observeClient(host, origin, 'Host')
    await observeClient(guest, origin, 'Guest')
    await host.getByTestId('create-private-room-button').click()
    const timer = host.getByRole('dialog').getByRole('switch').first()
    if ((await timer.getAttribute('aria-checked')) === 'true') await timer.click()
    await host.getByTestId('room-environment-select').click()
    await host.getByRole('option', { name: '@arcadia-example/slow 1.0.0', exact: true }).click()
    await host.getByTestId('confirm-create-private-room-button').click()
    await expect(host).toHaveURL(/\/room\/[A-Za-z0-9]+/, { timeout: 30000 })
    await guest.goto(host.url())
    for (const page of pages) await expect(page.getByText('玩家 (2/2)')).toBeVisible()
    await formTeam(host, '原作一号')
    await formTeam(guest, '原作二号')
    await guest.getByTestId('toggle-ready-button').click()
    await expect(host.getByTestId('start-battle-button')).toBeEnabled()
    await host.getByTestId('start-battle-button').click()
    for (const page of pages) {
      await expect(page).toHaveURL(/\/battle\?.*privateRoom=true/, { timeout: 30000 })
      await expectOriginalPlayers(page)
    }
    const skill = (page: Page) => page.locator('button').filter({ hasText: '原作冲击' }).first()
    const ended = (page: Page) =>
      page.getByText('胜利！', { exact: true }).or(page.getByText('失败...', { exact: true }))
    let turns = 0
    const playTurn = async () => {
      turns++
      const before = await host.getByText(/原作[一二]号 使用 原作冲击/).count()
      for (const page of pages) {
        await expect(skill(page)).toBeEnabled({ timeout: 30000 })
        await skill(page).click()
      }
      await expect
        .poll(() => host.getByText(/原作[一二]号 使用 原作冲击/).count(), { timeout: 30000 })
        .toBeGreaterThan(before)
      await expect
        .poll(async () => (await ended(host).isVisible()) || (await skill(host).isEnabled()), { timeout: 30000 })
        .toBe(true)
    }
    await playTurn()
    for (const page of pages) {
      await expect
        .poll(async () => (await playback(page)).some(event => event.type === 'hit' && event.state === '物理攻击'), {
          timeout: 15000,
        })
        .toBe(true)
      await expect
        .poll(async () => (await playback(page)).some(event => event.type === 'complete'), { timeout: 15000 })
        .toBe(true)
    }
    await host.screenshot({ path: testInfo.outputPath('original-swf-battle.png'), fullPage: true })
    const beforeRefresh = await playback(guest)
    await guest.reload()
    await expectOriginalPlayers(guest)
    const refreshed = await playback(guest)
    expect(
      refreshed
        .filter(event => event.type === 'ready')
        .map(event => event.instance)
        .every(instance => !beforeRefresh.some(event => event.instance === instance)),
    ).toBe(true)
    for (let turn = 0; turn < 8 && !(await ended(host).isVisible()); turn++) await playTurn()
    for (const page of pages) await expect(ended(page)).toBeVisible({ timeout: 30000 })
    const finalPlayback = await Promise.all(pages.map(playback))
    const results = await Promise.all(pages.map(page => ended(page).textContent()))
    expect(results.toSorted()).toEqual(['失败...', '胜利！'].toSorted())
    for (const events of finalPlayback) expect(events.filter(event => event.type === 'error')).toEqual([])
    await host.screenshot({ path: testInfo.outputPath('original-swf-result.png'), fullPage: true })
    await host.getByRole('button', { name: '返回大厅', exact: true }).click()
    await expect(host.locator('iframe[title="精灵动画"]')).toHaveCount(0)
    const disposal = await host.evaluate(() =>
      (window as Window & { swfBattleCommands: PlaybackEvent[] }).swfBattleCommands.filter(
        command => command.type === 'dispose',
      ),
    )
    for (const event of finalPlayback[0].filter(event => event.type === 'ready'))
      expect(disposal.some(command => command.instance === event.instance)).toBe(true)
    expect(requests.some(url => /\/src\/|\/node_modules\/|\.tgz(?:[?#]|$)|\.ts(?:[?#]|$)/.test(url))).toBe(false)
    for (const source of originalUrls)
      expect(
        mediaResponses.filter(response => response.url === source && response.status === 200).length,
      ).toBeGreaterThanOrEqual(2)
    const evidence = {
      date: new Date().toISOString(),
      origin,
      environment: environment.id,
      turns,
      results,
      beforeRefresh,
      refreshed,
      finalPlayback,
      disposal,
      mediaResponses,
      failures,
      requests,
    }
    const evidencePath = testInfo.outputPath('original-swf-battle-acceptance.json')
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
    await testInfo.attach('original-swf-battle-acceptance', { path: evidencePath, contentType: 'application/json' })
  } catch (error) {
    const clients = await Promise.all(
      pages.map(async (page, index) => {
        await page
          .screenshot({ path: testInfo.outputPath(`failed-client-${index}.png`), fullPage: true })
          .catch(() => {})
        return page
          .evaluate(() => ({
            events: (window as Window & { swfBattleEvents: PlaybackEvent[] }).swfBattleEvents,
            commands: (window as Window & { swfBattleCommands: PlaybackEvent[] }).swfBattleCommands,
          }))
          .catch(() => null)
      }),
    )
    const path = testInfo.outputPath('original-swf-battle-failure.json')
    await writeFile(path, JSON.stringify({ date: new Date().toISOString(), error: String(error), clients }, null, 2))
    await testInfo.attach('original-swf-battle-failure', { path, contentType: 'application/json' })
    throw error
  } finally {
    await Promise.all(contexts.map(context => context.close()))
    await app.stop()
    await fixture.dispose()
  }
})
