import { expect, test, type Page } from 'playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSingleProcessApp } from '../../server/src/runtime/app'
import { createNpmFixture } from '../../server/test/fixtures/npm'
import { emptyNpmContentHost, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'
import { buildDisplayCatalog, buildDisplayLocales } from '@arcadia-eternity/pack-loader/native'
import { createLocalContentSessions } from '../electron/local-content-sessions.mjs'
import { createPersonalEnvironmentBundle, encodePersonalEnvironmentBundle } from '../src/services/personalEnvironment'

// Production distribution only: no Vite, request interception, injected browser state, or debug-store access.
test.skip(process.env.PLAYWRIGHT_PERSONAL_ENVIRONMENT !== '1', 'Requires the built paired website distribution')

async function makeSharedEnvironment(directory: string, installedDirectory: string, output: string) {
  const dataFile = join(installedDirectory, 'content.json')
  const data = JSON.parse(await readFile(dataFile, 'utf8'))
  data.data.species[0].baseStats.hp = 10
  data.data.skills[0].power = 120
  data.data.skills[0].name = '私人冲击'
  await writeFile(dataFile, JSON.stringify(data))
  const presentationFile = join(installedDirectory, 'dist/presentation.json')
  const presentation = JSON.parse(await readFile(presentationFile, 'utf8'))
  presentation.bindings[0].battle = { renderer: 'image', source: 'icon' }
  presentation.resources = presentation.resources.filter((resource: { kind: string }) => resource.kind === 'file')
  await writeFile(presentationFile, JSON.stringify(presentation))
  const sessions = createLocalContentSessions({
    library: { acquireProject: async () => ({ directory, release: async () => {} }) },
    load: async () => ({
      host: emptyNpmContentHost,
      prepareNpmProject,
      buildDisplayCatalog,
      buildDisplayLocales,
    }),
    assetUrl: (token: string, hash: string) => `http://localhost/local-content/${token}/${hash}`,
  })
  try {
    // This author-side capture is the actual desktop capture path; the official server never receives its directory.
    const capture = await sessions.capturePersonalEnvironment('personal-e2e-author')
    const bundle = await createPersonalEnvironmentBundle(capture)
    await writeFile(output, encodePersonalEnvironmentBundle(bundle))
    return bundle
  } finally {
    await sessions.close()
  }
}

async function formCustomTeam(page: Page) {
  await page.getByRole('link', { name: '编辑或创建队伍', exact: true }).click()
  await expect(page.getByRole('heading', { name: '队伍编辑器', exact: true })).toBeVisible()
  // A new profile contains a starter team; remove its pets through their ordinary editor controls.
  const cards = page.locator('.drag-handle')
  for (let remaining = await cards.count(); remaining > 0; remaining--) {
    await cards.first().click()
    await page.getByRole('button', { name: '永久删除', exact: true }).filter({ hasText: '永久删除' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()
    await expect(cards).toHaveCount(remaining - 1)
  }
  await page.getByRole('button', { name: '添加精灵', exact: true }).click()
  const species = page.locator('.el-select').first()
  await species.click()
  await species.locator('input[role=combobox]').fill('展示精灵')
  await page.getByRole('option', { name: /展示精灵/ }).click()
  await expect(page.getByPlaceholder('输入精灵名称')).toHaveValue('展示精灵')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  // Read-only evidence verifies the visible editor persisted the real UGC team.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('petStorage')!).teams[0].pets)
  expect(saved).toHaveLength(1)
  expect(saved[0].species).toBe('example-slow:pet')
  expect(saved[0].skills).toEqual(['example-slow:strike'])
  await page.getByRole('link', { name: '返回房间', exact: true }).click()
  await page.getByTestId('room-team-selector').getByTestId('team-option-0').click()
}

test('unpublished personal environment stays on two consenting clients through a real battle and rematch', async ({
  browser,
}, testInfo) => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const fixture = await createNpmFixture({ presentation: true, includeCatalog: true })
  const app = createSingleProcessApp({ host: '127.0.0.1', port: 0, webRoot: resolve(root, 'dist/web') })
  const contexts = await Promise.all([browser.newContext(), browser.newContext()])
  await Promise.all(
    contexts.map(context => context.tracing.start({ screenshots: true, snapshots: true, sources: true })),
  )
  const pages = await Promise.all(contexts.map(context => context.newPage()))
  const [host, guest] = pages
  const requests: { client: string; url: string; method: string }[] = []
  const frames: { client: string; direction: string; event: string; payload: unknown }[] = []
  const errors: { client: string; message: string }[] = []
  const workers: { at: number; workers: number; active: number; preparing: number; environmentIds: string[] }[] = []
  const sockets = new Set<string>()
  const sampleWorkers = () =>
    workers.push({
      at: Date.now(),
      ...app.rooms.battleWorkerStats,
      environmentIds: app.environments.list().map(environment => environment.id),
    })
  let sampler: ReturnType<typeof setInterval> | undefined
  let complete = false
  for (const [index, page] of pages.entries()) {
    const client = index === 0 ? 'host' : 'guest'
    page.on('request', request => requests.push({ client, url: request.url(), method: request.method() }))
    page.on('pageerror', error => errors.push({ client, message: error.message }))
    page.on('console', message => {
      if (message.type() === 'error') errors.push({ client, message: message.text() })
    })
    page.on('websocket', socket => {
      sockets.add(client)
      for (const direction of ['sent', 'received'] as const)
        socket.on(direction === 'sent' ? 'framesent' : 'framereceived', frame => {
          const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString()
          // Socket.IO event frames only. Authentication frames and credentials are deliberately not retained.
          const match = /^42\d*(\[.*\])$/s.exec(text)
          if (!match) return
          const [event, payload] = JSON.parse(match[1])
          frames.push({ client, direction, event, payload })
        })
    })
  }
  try {
    const bundleFile = testInfo.outputPath('shared-personal.arcadia.json')
    const bundle = await makeSharedEnvironment(fixture.directory, fixture.installedDirectory, bundleFile)
    console.log('Author captured portable environment', bundle.descriptor.id)
    await app.start()
    sampleWorkers()
    sampler = setInterval(sampleWorkers, 100)
    const origin = `http://127.0.0.1:${app.address!.port}`
    const initialCatalog = app.environments.list().map(environment => environment.id)
    expect(app.environments.list()).toMatchObject([
      { isDefault: true, packages: [{ name: '@arcadia-eternity/data-pack-base' }] },
    ])
    for (const page of pages) {
      await page.goto(origin)
      await expect(page.getByTestId('create-private-room-button')).toBeEnabled({ timeout: 30_000 })
      expect(await page.evaluate(() => '__APP_DEBUG__' in window)).toBe(false)
    }
    await expect.poll(() => sockets.size).toBe(2)
    await host.getByTestId('create-private-room-button').click()
    const dialog = host.getByRole('dialog')
    for (const option of ['房主运行对战', '我的环境', 'Relay']) {
      await dialog.getByText(option, { exact: true }).click()
      await expect(dialog.getByRole('radio', { name: option, exact: true })).toBeChecked()
    }
    const timer = dialog.getByRole('switch').first()
    if ((await timer.getAttribute('aria-checked')) === 'true') await timer.click()
    await expect(host.getByTestId('confirm-create-private-room-button')).toBeDisabled()
    await dialog.getByLabel('私人环境文件', { exact: true }).setInputFiles(bundleFile)
    await expect(dialog.getByText('已接受此版本', { exact: true })).toBeVisible({ timeout: 30_000 })
    await host.getByTestId('confirm-create-private-room-button').click()
    await expect(host).toHaveURL(/\/room\/[^/?#]+/, { timeout: 30_000 })
    const room = host.url()
    console.log('Host created personal Challenge', room)
    const create = frames.find(
      frame => frame.client === 'host' && frame.direction === 'sent' && frame.event === 'createPrivateRoom',
    )
    expect(create).toBeDefined()
    const payload = create!.payload as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['config', 'expectedRuntime', 'personalEnvironment'])
    expect(payload.personalEnvironment).toEqual({
      kind: 'personal',
      protocolVersion: 1,
      descriptor: bundle.descriptor,
      rules: bundle.rules,
      source: { kind: 'file', name: 'shared-personal.arcadia.json' },
    })
    expect(JSON.stringify(payload)).not.toContain(
      JSON.stringify(bundle.environment.modules[0].artifact.source).slice(1, -1),
    )
    expect(Object.keys(payload)).not.toContain('environment')
    expect(Object.keys(payload)).not.toContain('assets')
    expect(Object.keys(payload)).not.toContain('archive')
    expect(JSON.stringify(payload).length).toBeLessThan(64 * 1024)
    await guest.goto(room)
    await expect(guest.getByText('请确认来源后，选择文件或下载环境。', { exact: true })).toBeVisible()
    await expect(guest.getByText('已接受此版本', { exact: true })).toHaveCount(0)
    await expect(guest.getByText('玩家 (2/2)', { exact: true })).toBeVisible()
    expect(requests.some(request => request.url.includes(bundle.descriptor.id))).toBe(false)
    await guest.screenshot({ path: testInfo.outputPath('guest-before-consent.png'), fullPage: true })
    await guest.getByLabel('私人环境文件', { exact: true }).setInputFiles(bundleFile)
    await expect(guest.getByText('已接受此版本', { exact: true })).toBeVisible({ timeout: 30_000 })
    console.log('Guest explicitly accepted the same local file')
    for (const page of pages) {
      await expect(page.getByTestId('room-environment')).toContainText('@arcadia-example/slow')
      await formCustomTeam(page)
    }
    const ended = (page: Page) =>
      page.getByText('胜利！', { exact: true }).or(page.getByText('失败...', { exact: true }))
    const skill = (page: Page) => page.locator('button').filter({ hasText: '私人冲击' }).first()
    const playBattle = async (round: number) => {
      console.log('Preparing battle', round)
      await guest.getByTestId('toggle-ready-button').click()
      await expect(guest.getByTestId('toggle-ready-button')).toContainText('取消准备')
      await expect(host.getByTestId('start-battle-button')).toBeEnabled()
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
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBe(1)
      await host.screenshot({ path: testInfo.outputPath(`battle-${round}-start.png`), fullPage: true })
      let turns = 0
      for (; turns < 8; turns++) {
        if (await ended(host).isVisible()) break
        const before = await host.getByText(/展示精灵 使用 私人冲击/).count()
        for (const page of pages) {
          await expect(skill(page)).toBeEnabled({ timeout: 30_000 })
          await skill(page).click()
        }
        await expect
          .poll(() => host.getByText(/展示精灵 使用 私人冲击/).count(), { timeout: 30_000 })
          .toBeGreaterThan(before)
        await expect
          .poll(async () => (await ended(host).isVisible()) || (await skill(host).isEnabled()), { timeout: 30_000 })
          .toBe(true)
      }
      for (const page of pages) await expect(ended(page)).toBeVisible({ timeout: 30_000 })
      for (const page of pages) await expect(page.getByText(/展示精灵 使用 私人冲击/).first()).toBeVisible()
      const outcomes = await Promise.all(pages.map(page => ended(page).textContent()))
      expect(outcomes.sort()).toEqual(['失败...', '胜利！'].sort())
      await host.screenshot({ path: testInfo.outputPath(`battle-${round}-result.png`), fullPage: true })
      console.log('Natural battle result', round, outcomes)
      return { turns, outcomes }
    }
    const first = await playBattle(1)
    for (const page of pages) {
      await page.getByRole('button', { name: '返回大厅', exact: true }).click()
      await page.getByRole('button', { name: /回到房间/ }).click()
      await expect(page).toHaveURL(room)
      await expect(page.getByText('已接受此版本', { exact: true })).toBeVisible()
    }
    await expect(guest.getByTestId('toggle-ready-button')).toBeVisible({ timeout: 15_000 })
    for (const page of pages) await page.getByTestId('room-team-selector').getByTestId('team-option-0').click()
    const rematch = await playBattle(2)
    sampleWorkers()
    expect(workers.every(status => status.workers === 0 && status.active === 0 && status.preparing === 0)).toBe(true)
    expect(workers.every(status => JSON.stringify(status.environmentIds) === JSON.stringify(initialCatalog))).toBe(true)
    expect(app.environments.list().map(environment => environment.id)).toEqual(initialCatalog)
    expect(requests.some(request => request.url.includes(bundle.descriptor.id))).toBe(false)
    expect(requests.some(request => /\/src\/|\/node_modules\/|\.tgz(?:[?#]|$)|\.ts(?:[?#]|$)/.test(request.url))).toBe(
      false,
    )
    const transmitted = JSON.stringify(frames.filter(frame => frame.direction === 'sent'))
    expect(transmitted).not.toContain('arcadia.personal-environment')
    for (const module of bundle.environment.modules)
      expect(transmitted).not.toContain(JSON.stringify(module.artifact.source).slice(1, -1))
    expect(errors).toEqual([])
    await writeFile(
      testInfo.outputPath('acceptance.json'),
      JSON.stringify(
        {
          personalEnvironment: bundle.descriptor.id,
          initialCatalog,
          first,
          rematch,
          serverWorkerSamples: workers.length,
          maxObservedWorkers: 0,
        },
        null,
        2,
      ),
    )
    complete = true
  } finally {
    if (sampler) clearInterval(sampler)
    const uiAlerts = await Promise.all(
      pages.map(page =>
        page
          .getByRole('alert')
          .allTextContents()
          .catch(() => []),
      ),
    )
    await writeFile(
      testInfo.outputPath('network-events.json'),
      JSON.stringify({ requests, frames, workers, errors, uiAlerts }, null, 2),
    )
    if (!complete) {
      await Promise.all(
        pages.map(page =>
          page
            .locator('.error-alert')
            .scrollIntoViewIfNeeded({ timeout: 1000 })
            .catch(() => {}),
        ),
      )
      await Promise.all(
        pages.map((page, index) =>
          page.screenshot({ path: testInfo.outputPath(`failure-${index}.png`), fullPage: true }).catch(() => {}),
        ),
      )
    }
    await Promise.all(
      contexts.map((context, index) => context.tracing.stop({ path: testInfo.outputPath(`trace-${index}.zip`) })),
    )
    await Promise.all(contexts.map(context => context.close()))
    await app.stop()
    await fixture.dispose()
  }
})
