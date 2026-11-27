import { expect, test, type Page } from 'playwright/test'
import { individualValueSpread } from '@arcadia-eternity/const'
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

test('local training controls update the battle and override the AI action', async ({ page }) => {
  test.setTimeout(60_000)
  await prepareLocalBattle(page)
  await page.goto('/local-battle')
  await page.getByPlaceholder('留空使用随机种子').fill('208')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  const move = page.getByRole('button', { name: /^气力 ·/ })
  await expect(move).toBeEnabled()
  await page.getByRole('button', { name: '训练', exact: true }).click()
  await page.getByRole('button', { name: '满怒气', exact: true }).click()
  const status = page.locator('[data-battle-status="left"]')
  const rage = status.getByRole('meter', { name: '怒气' })
  await expect(rage).toHaveAttribute('aria-valuenow', (await rage.getAttribute('aria-valuemax'))!)
  const opponent = page.locator('[data-battle-status="right"]')
  const hp = status.getByRole('meter', { name: '生命值' })
  const opponentHp = opponent.getByRole('meter', { name: '生命值' })
  await page.getByRole('slider', { name: '当前宠物血量' }).press('Home')
  await expect(hp).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('button', { name: '满血当前宠物' }).click()
  await expect(hp).toHaveAttribute('aria-valuenow', (await hp.getAttribute('aria-valuemax'))!)
  const opponentMax = Number(await opponentHp.getAttribute('aria-valuemax'))
  await page.getByRole('slider', { name: '对手宠物血量' }).press('ArrowLeft')
  await expect(opponentHp).toHaveAttribute('aria-valuenow', String(opponentMax - 1))
  await page.getByRole('slider', { name: '当前玩家怒气' }).press('Home')
  await expect(rage).toHaveAttribute('aria-valuenow', '0')
  await page.getByRole('slider', { name: '对手怒气' }).press('Home')
  await expect(opponent.getByRole('meter', { name: '怒气' })).toHaveAttribute('aria-valuenow', '0')
  const wait = page.locator('fieldset').getByRole('button', { name: '什么都不做' })
  await wait.click()
  await expect(wait).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('slider', { name: '对手怒气' }).press('End')
  await expect(page.getByRole('button', { name: /^使用技能:/, pressed: true })).toHaveCount(1)
  await page.getByRole('button', { name: '刷新己方可选项' }).click()
  await expect(move).toBeDisabled()
  await page.getByRole('button', { name: '满怒气', exact: true }).click()
  await expect(move).toBeEnabled()
  await page.getByRole('button', { name: '强制刷新AI选择' }).click()
  await page.getByRole('button', { name: '🔄 刷新' }).click()
  await expect(page.getByText(/随机种子: 208/)).toBeVisible()
  const switchPet = page.getByRole('button', { name: /^切换宠物:/ }).first()
  const chosenPet = (await switchPet.innerText()).replace(/^切换宠物:\s*/, '')
  await switchPet.click()
  await expect(switchPet).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '关闭训练面板' }).click()
  await move.click()
  await expect(opponent.getByText(chosenPet, { exact: true })).toBeVisible()
})

test('a heavy hit visibly pans even a square battle background', async ({ page }) => {
  test.setTimeout(60_000)
  await prepareLocalBattle(page)
  await page.goto('/local-battle')
  await page.getByPlaceholder('留空使用随机种子').fill('208')
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  const attack = page.getByTestId('skill-button').filter({ hasText: '奋力突破' })
  // This seed produces a heavy hit on the second turn.
  for (let turn = 0; turn < 2; turn++) {
    await attack.click()
    await expect(attack).toBeDisabled()
    await expect(attack).toBeEnabled()
  }
  const backdrop = page.locator('.battle-stage__backdrop')
  await expect
    .poll(() =>
      backdrop.evaluate(el => {
        const position = getComputedStyle(el).backgroundPositionX
        return Number(position.match(/([\d.]+)px/)?.[1] ?? 0)
      }),
    )
    .toBeGreaterThan(16)
  await page.getByLabel('动效模式', { exact: true }).selectOption('reduced')
  await expect(backdrop).toHaveCSS('background-position-x', '50%')
})

async function expect120Battle(page: Page) {
  await page.waitForURL(/\/battle\?dev=true/)
  const petIVs = await page.evaluate(async () => {
    const path = '/src/stores/battle.ts'
    const { useBattleStore } = await import(path)
    const snapshot = await useBattleStore().battleInterface.createRuntimeSnapshot()
    const { nodes } = JSON.parse(snapshot.payload).battle
    return nodes
      .filter((node: { kind: string }) => node.kind === 'Pet')
      .map((pet: { fields: { ivs: { ref: number } } }) => nodes[pet.fields.ivs.ref].fields)
  })
  expect(petIVs).toHaveLength(6)
  for (const ivs of petIVs) expect(ivs).toEqual(individualValueSpread(120))
  // Both default lineups lead with a level 100 Xiuluosi (179 base HP and 4 HP EVs).
  for (const side of ['left', 'right']) {
    await expect(page.locator(`[data-battle-status="${side}"]`).getByRole('meter', { name: '生命值' })).toHaveAttribute(
      'aria-valuemax',
      '589',
    )
  }
}

test('local rematches retain both team selections, the 120-IV environment and battle options', async ({ page }) => {
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
  const seed = page.getByRole('spinbutton', { name: '随机数种子' })
  const timer = page.getByRole('checkbox', { name: '启用计时器系统' })
  const turnLimit = page.getByRole('spinbutton', { name: '每回合时间限制', exact: true })
  const selection = page.getByRole('checkbox', { name: '启用团队选择', exact: true })
  const maxSize = page.getByRole('spinbutton', { name: '最多出战数量', exact: true })
  await seed.fill('208')
  await page.getByText('启用计时器系统', { exact: true }).click()
  await turnLimit.fill('90')
  await page.getByText('启用团队选择', { exact: true }).click()
  await maxSize.fill('5')
  await page.getByText('启用团队选择', { exact: true }).click()
  // Keep the default AI roster. An alternative player team makes a reset to library order observable.
  await page.evaluate(async () => {
    const path = '/src/stores/petStorage.ts'
    const { usePetStorageStore } = await import(path)
    const library = usePetStorageStore()
    library.createNewTeam('练习队')
    library.switchTeam(0)
  })
  const playerTeam = page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '玩家1队伍' }) })
  await playerTeam.click()
  await page.getByRole('option', { name: '练习队 · 3 只' }).click()
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await expect120Battle(page)
  await page.getByRole('button', { name: /逃跑|投降/, exact: true }).click()
  await page.getByRole('button', { name: '投降', exact: true }).click()
  await page.getByRole('button', { name: '再来一局' }).click()
  await expect(playerTeam).toContainText('练习队')
  await expect(
    page.locator('.el-select').filter({ has: page.getByRole('combobox', { name: '玩家2队伍（AI）' }) }),
  ).toContainText('默认队伍')
  await expect(seed).toHaveValue('208')
  await expect(timer).toBeChecked()
  await expect(turnLimit).toHaveValue('90')
  await expect(selection).not.toBeChecked()
  await page.getByText('启用团队选择', { exact: true }).click()
  await expect(maxSize).toHaveValue('5')
  await page.getByText('启用团队选择', { exact: true }).click()
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await expect120Battle(page)
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

for (const [name, routePattern] of [['last damage digit', '**/damageNumber/9.png']] as const) {
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

for (const [name, routePattern] of [
  ['KO sound', '**/sound/battle/ko.mp3'],
  ['battle music', '**/music/battle/*.mp3'],
] as const) {
  test(`a delayed ${name} does not hold back a cold battle`, async ({ page }) => {
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
      await expect(page.getByRole('button', { name: /^气力 ·/ })).toBeEnabled()
      await expect(page.getByTestId('battle-loading-overlay')).toHaveCount(0)
    } finally {
      media.resolve()
    }
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
