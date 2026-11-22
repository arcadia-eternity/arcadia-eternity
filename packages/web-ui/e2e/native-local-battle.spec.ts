import { expect, test } from 'playwright/test'
import { trainingStat } from '@arcadia-eternity/const'
import { prepareLocalBattle } from './helpers/local-battle-fixture'
import input from '../../battle/test/fixtures/official-switch.input.json' with { type: 'json' }

async function runtimeFormat(page: import('playwright/test').Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/stores/battle.ts'
    const { useBattleStore } = await import(modulePath)
    const snapshot = await useBattleStore().battleInterface.createRuntimeSnapshot()
    return snapshot.format
  })
}

test('the local page uses the native runtime and can create its actual checkpoint', async ({ page }) => {
  await prepareLocalBattle(page)
  const workerScript = page.waitForResponse(
    response => response.url().includes('sandbox-worker') && response.request().resourceType() === 'fetch',
  )
  await page.goto('/local-battle')
  expect((await workerScript).ok()).toBe(true)
  expect(page.workers().some(worker => worker.url().includes('sandbox-worker'))).toBe(false)
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  expect(await runtimeFormat(page)).toBe('arcadia.battle.native.v4')
})

test('switching to the 120 environment preserves the selected team and applies its rules in battle', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await prepareLocalBattle(page)
  await page.goto('/local-battle')
  const version = page.getByText(/^环境版本 /)
  const initialVersion = await version.textContent()
  const team = page.getByText('默认队伍 · 3 只', { exact: true }).filter({ visible: true })
  await expect(team).toHaveCount(2)

  const picker = page.getByRole('combobox', { name: '对战环境', exact: true })
  await page.locator('.el-select').filter({ has: picker }).click()
  await page.getByRole('option', { name: /^120 资质/ }).click()
  await expect(version).toBeVisible()
  await expect(version).not.toHaveText(initialVersion!)
  await expect(team).toHaveCount(2)
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)

  const { hp, baseHp, maxIv } = await page.evaluate(async () => {
    const battlePath = '/src/stores/battle.ts'
    const dataPath = '/src/stores/gameData.ts'
    const [{ useBattleStore }, { useGameDataStore }] = await Promise.all([import(battlePath), import(dataPath)])
    const state = await useBattleStore().battleInterface.getState(undefined, true)
    const starter = state.players[0].team[0]
    const data = useGameDataStore()
    return {
      hp: starter.maxHp,
      baseHp: data.getSpecies(starter.speciesID).baseStats.hp,
      maxIv: data.rules.mechanics.individualValues.max,
    }
  })
  expect(maxIv).toBe(120)
  expect(hp).toBe(trainingStat('hp', baseHp, 100, 120, 4, 1))
})

test('the local team-selection preset confirms teams and enters the native battle', async ({ page }) => {
  await prepareLocalBattle(page)
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '团队选择测试', exact: true }).click()
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await page
    .getByRole('heading', { name: '完整队伍', exact: true })
    .locator('..')
    .getByText('休罗斯', { exact: true })
    .click()
  await page.getByRole('button', { name: '确认', exact: true }).click()
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  expect(await runtimeFormat(page)).toBe('arcadia.battle.native.v4')
})

for (const [name, routePattern] of [
  ['last damage digit', '**/damageNumber/9.png'],
  ['KO sound', '**/sound/battle/ko.mp3'],
  ['battle music', '**/music/battle/*.mp3'],
] as const) {
  test(`waits for the ${name} before starting a cold battle`, async ({ page }) => {
    await prepareLocalBattle(page)
    const media = Promise.withResolvers<void>()
    const requested = page.waitForRequest(routePattern)
    await page.route(routePattern, async route => {
      await media.promise
      await route.fallback()
    })
    try {
      await page.goto('/local-battle')
      await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
      await requested
      const overlay = page.getByTestId('battle-loading-overlay')
      await expect(overlay.locator('li[data-state="loading"]')).toHaveText('对战媒体')
      const status = await page.evaluate(async () => {
        const path = '/src/stores/battle.ts'
        const { useBattleStore } = await import(path)
        return useBattleStore().battleState.status
      })
      expect(status).toBe('Unstarted')
      await expect(page.getByTestId('battle-actions-ready')).toHaveAttribute('data-ready', 'false')
    } finally {
      media.resolve()
    }
    await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
    await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
  })
}

test('cold native startup tolerates delayed portraits without entering animation recovery', async ({ page }) => {
  await prepareLocalBattle(page, 10_000)
  const healthErrors: string[] = []
  page.on('console', message => {
    if (message.text().includes('[AnimationHealthMonitor]')) healthErrors.push(message.text())
  })
  await page.goto('/local-battle')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
  const portraits = page.getByTestId('pet-static-fallback').getByRole('img', { name: '精灵静态形象' })
  await expect(portraits).toHaveCount(2)
  await expect
    .poll(() => portraits.evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0)))
    .toBe(true)
  expect(healthErrors).toEqual([])
})

test('consecutive browser battles reuse one Worker and start with independent battle state', async ({ page }) => {
  await prepareLocalBattle(page)
  test.setTimeout(60_000)
  // entry.ts imports main asynchronously: navigation can finish before app.use(pinia).
  // Hold that real bootstrap boundary so this also exercises a slow application startup.
  let pauseBootstrap!: (resume: () => Promise<void>) => void
  const bootstrapPaused = new Promise<() => Promise<void>>(resolve => {
    pauseBootstrap = resolve
  })
  await page.route(
    url => url.pathname === '/src/main.ts',
    route => {
      pauseBootstrap(() => route.continue())
    },
    { times: 1 },
  )
  await page.goto('/local-battle')
  const resumeBootstrap = await bootstrapPaused
  const startBattle = page.getByRole('button', { name: '开始本地对战', exact: true })
  await expect(startBattle).not.toBeVisible()
  await resumeBootstrap()
  // The rendered, enabled control proves that the real app and local data are ready.
  await expect(startBattle).toBeEnabled()
  const result = await page.evaluate(async teams => {
    const factoryPath = '/src/services/nativeBattleFactory.ts'
    const poolPath = '/src/services/sandboxBattleWorkers.ts'
    const dataPath = '/src/stores/gameData.ts'
    const [{ createSandboxWebBattleSession }, { getBattleWorkers }, { useGameDataStore }] = await Promise.all([
      import(factoryPath),
      import(poolPath),
      import(dataPath),
    ])
    const data = useGameDataStore()
    await data.whenReady()
    const manager = getBattleWorkers()
    const options = { rngSeed: 'browser-pool-reuse', timerConfig: { enabled: false } }
    const samples = [manager.poolStatus()]
    const first = (await createSandboxWebBattleSession(teams[0], teams[1], data, options)).system
    let second: typeof first | undefined
    try {
      const firstWorker = manager.status().find((entry: { state: string }) => entry.state === 'active')?.workerId
      await first.ready()
      const firstRunning = await first.getState(undefined, true)
      samples.push(manager.poolStatus())
      // Change real domain state before returning the Worker to the pool.
      await first.submitAction({ type: 'surrender', player: firstRunning.players[0].id })
      const firstEnded = await first.getState(undefined, true)
      await first.cleanup()
      samples.push(manager.poolStatus())

      second = (await createSandboxWebBattleSession(teams[0], teams[1], data, options)).system
      const secondWorker = manager.status().find((entry: { state: string }) => entry.state === 'active')?.workerId
      const secondInitial = await second.getState(undefined, true)
      await second.ready()
      const secondRunning = await second.getState(undefined, true)
      samples.push(manager.poolStatus())
      await second.cleanup()
      samples.push(manager.poolStatus())
      return {
        firstWorker,
        secondWorker,
        samples,
        firstRunning: firstRunning.status,
        firstEnded: firstEnded.status,
        firstPlayerIds: firstRunning.players.map((player: { id: string }) => player.id),
        secondInitial: secondInitial.status,
        secondRunning: secondRunning.status,
        secondPlayerIds: secondRunning.players.map((player: { id: string }) => player.id),
      }
    } finally {
      await first.cleanup()
      await second?.cleanup()
    }
  }, input.teams)

  expect(result.firstWorker).toBeDefined()
  expect(result.secondWorker).toBe(result.firstWorker)
  expect(result.firstRunning).toBe('On')
  expect(result.firstEnded).toBe('Ended')
  expect(result.secondInitial).toBe('Unstarted')
  expect(result.secondRunning).toBe('On')
  expect(result.secondPlayerIds.every((id: string) => !result.firstPlayerIds.includes(id))).toBe(true)
  expect(result.samples.every((status: { idle: number }) => status.idle <= 1)).toBe(true)
  expect(result.samples[1]).toMatchObject({ active: 1, preparing: 0, idle: 0, queued: 0, workers: 1 })
  expect(result.samples[2]).toMatchObject({ active: 0, preparing: 0, idle: 1, queued: 0, workers: 1 })
  expect(result.samples[3]).toMatchObject({ active: 1, preparing: 0, idle: 0, queued: 0, workers: 1 })
  expect(result.samples[4]).toMatchObject({ active: 0, preparing: 0, idle: 1, queued: 0, workers: 1 })
})
