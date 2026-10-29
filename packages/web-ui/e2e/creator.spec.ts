import { expect, test, type BrowserContext } from 'playwright/test'
import { prepareLocalBattle } from './helpers/local-battle-fixture'

// Exercise the desktop authoring surface with transactional storage behind a test bridge.
// The ordinary browser route is now read-only and is covered by content-manager.spec.ts.
async function desktopAuthoring(context: BrowserContext) {
  await context.addInitScript(() => {
    const storage = async () => {
      const modulePath = '/src/services/workStorage.ts'
      const { BrowserWorkStorage } = await import(modulePath)
      return new BrowserWorkStorage('desktop-authoring-test')
    }
    Object.defineProperty(window, 'arcadiaDesktop', {
      value: {
        getLocalServerPort: async () => null,
        listWorkspacePacks: async () => [],
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',
        readWorkWorkspace: async () => (await storage()).read(),
        compareAndSwapWorkWorkspace: async ({ expected, workspace }: { expected: number; workspace: unknown }) =>
          (await storage()).compareAndSwap(expected, workspace),
      },
    })
  })
}
test.beforeEach(async ({ context, page }) => {
  await desktopAuthoring(context)
  await prepareLocalBattle(page)
})

test('authors namespaced effects, persists a draft, publishes and shares it, and runs the real battle', async ({
  page,
  browser,
}) => {
  // Authoring, reloads, a full animated battle, and a second mobile client all share this budget.
  test.setTimeout(120_000)
  const lifecycleErrors: string[] = []
  page.on('console', message => {
    if (message.text().includes('Native battle system is disposed')) lifecycleErrors.push(message.text())
  })
  page.on('pageerror', error => lifecycleErrors.push(error.message))
  await page.goto('/creator')
  await page.getByLabel('作品名称', { exact: true }).fill('寒霜作品')
  await page.getByLabel('命名空间', { exact: true }).fill('frost_pack')
  await page.getByRole('button', { name: '创建作品', exact: true }).click()
  await expect(page.getByLabel('作品标题')).toHaveValue('寒霜作品')
  await page.getByRole('button', { name: /^印记（/ }).click()
  await page.getByLabel('本地 ID', { exact: true }).fill('slow')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  await page.getByLabel('显示名称').fill('冰霜减速')
  await page.getByLabel('添加效果', { exact: true }).selectOption({ label: '印记修改属性' })
  await page.getByRole('button', { name: '加入组合', exact: true }).click()
  await page.locator('.effect-card').getByLabel('属性', { exact: true }).selectOption('spe')
  await page.locator('.effect-card').getByLabel('数值', { exact: true }).fill('-10')
  await page.getByRole('button', { name: /^技能（/ }).click()
  await page.getByLabel('本地 ID', { exact: true }).fill('skills/ice_strike')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  await page.getByLabel('显示名称').fill('寒霜打击')
  await page.getByLabel('添加效果', { exact: true }).selectOption({ label: '命中后附加印记' })
  await page.getByRole('button', { name: '加入组合', exact: true }).click()
  const mark = page.locator('.effect-card').getByLabel('印记', { exact: true })
  const markValue = await mark.locator('option').filter({ hasText: 'frost_pack:slow' }).getAttribute('value')
  await mark.selectOption(markValue!)
  await page.getByRole('button', { name: /^精灵（/ }).click()
  await page.getByLabel('本地 ID', { exact: true }).fill('pet')
  await page.getByRole('button', { name: '添加内容', exact: true }).click()
  const skill = page.getByLabel('可学技能（可多选）')
  const skillValue = await skill
    .locator('option')
    .filter({ hasText: 'frost_pack:skills/ice_strike' })
    .getAttribute('value')
  await skill.selectOption(skillValue!)
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.reload()
  await page.getByRole('button', { name: '寒霜作品 frost_pack:…' }).click()
  await page.getByRole('button', { name: '创建固定版本', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('固定版本 1.0.0')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出草稿', exact: true }).click()
  const download = await downloadPromise
  const file = await download.path()
  await page.getByRole('button', { name: '校验并准备试战', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('校验通过')
  const original = await page.evaluate(async () => {
    const petsPath = '/src/stores/petStorage.ts',
      clientPath = '/src/stores/battleClient.ts'
    const { usePetStorageStore } = await import(petsPath)
    const { useBattleClientStore } = await import(clientPath)
    return { teams: JSON.stringify(usePetStorageStore().teams), server: useBattleClientStore().serverUrl }
  })
  // Editing after preparation must persist, while this battle keeps its earlier snapshot.
  await page.getByLabel('作品标题').fill('寒霜作品修改中')
  await page.evaluate(() => {
    const api = window.arcadiaDesktop!,
      write = api.compareAndSwapWorkWorkspace!
    const gate = new Promise<void>(resolve => {
      Reflect.set(window, 'releaseTrialSave', resolve)
    })
    api.compareAndSwapWorkWorkspace = async input => {
      api.compareAndSwapWorkWorkspace = write
      await gate
      return write(input)
    }
  })
  await page.getByRole('button', { name: '开始试战', exact: true }).click()
  await expect(page.getByLabel('作品标题')).toBeDisabled()
  await page.evaluate(() => Reflect.get(window, 'releaseTrialSave')())
  await page.waitForURL(/\/local-battle\?trialKey=/)
  await expect(page.getByRole('status')).toContainText('已载入 UGC 草稿快照：寒霜作品。')
  await expect(page.getByRole('heading', { name: '本地对战', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '开始本地对战', exact: true }).click()
  await page.waitForURL(/\/battle\?dev=true/)
  await expect(page.getByText('对战开始！', { exact: true })).toBeVisible()
  const strike = page.getByRole('button', { name: /^寒霜打击 ·/ })
  await expect(strike).toBeEnabled()
  await strike.click()
  await expect(
    page
      .getByRole('log', { name: '战斗记录' })
      .getByText(/新精灵 使用 寒霜打击/)
      .last(),
  ).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const path = '/src/stores/battle.ts'
        const { useBattleStore } = await import(path)
        const state = await useBattleStore().battleInterface.getState(undefined, true)
        return state.players.some(player =>
          player.team?.some(pet => pet.marks?.some(mark => mark.baseId === 'frost_pack:slow')),
        )
      }),
    )
    .toBe(true)
  await page.screenshot({ path: '/tmp/ugc-creator-desktop.png', fullPage: true })
  await page.evaluate(async () => {
    const path = '/src/router/index.ts'
    const { default: router } = await import(path)
    void router.push('/creator')
  })
  await page.getByRole('button', { name: '确定', exact: true }).click()
  await page.waitForURL(/\/creator$/)
  await expect(page.getByRole('button', { name: '寒霜作品修改中 frost_pack:…' })).toBeVisible()
  const restored = await page.evaluate(async () => {
    const petsPath = '/src/stores/petStorage.ts',
      clientPath = '/src/stores/battleClient.ts'
    const dataPath = '/src/stores/gameData.ts',
      battlePath = '/src/stores/battle.ts'
    const { usePetStorageStore } = await import(petsPath)
    const { useBattleClientStore } = await import(clientPath)
    const { useGameDataStore } = await import(dataPath)
    const { useBattleStore } = await import(battlePath)
    return {
      teams: JSON.stringify(usePetStorageStore().teams),
      server: useBattleClientStore().serverUrl,
      temporarySpecies: useGameDataStore().species.allIds.filter(id => id.startsWith('frost_pack:')),
      battle: useBattleStore().battleInterface,
    }
  })
  expect(restored).toEqual({ ...original, temporarySpecies: [], battle: null })
  expect(lifecycleErrors).toEqual([])
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    await desktopAuthoring(other)
    const receiver = await other.newPage()
    await receiver.goto('/creator')
    await expect(receiver.getByLabel('导入作品文件')).toBeEnabled()
    await receiver.getByLabel('导入作品文件').setInputFiles(file!)
    await receiver.getByRole('button', { name: '导入这些作品', exact: true }).click()
    await receiver.getByRole('button', { name: '寒霜作品 frost_pack:…' }).click()
    await receiver.getByRole('button', { name: /^技能（/ }).click()
    await receiver.getByLabel('编辑内容').selectOption('skills/ice_strike')
    await expect(receiver.locator('article > h3')).toHaveText('frost_pack:skills/ice_strike')
    await expect(receiver.locator('.effect-card')).toContainText('命中后附加印记')
    expect(await receiver.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await receiver.screenshot({ path: '/tmp/ugc-creator-mobile.png', fullPage: true })
  } finally {
    await other.close()
  }
})

test('a conflicting authoring window can preserve edits as a namespaced fork', async ({ page, context }) => {
  await page.goto('/creator')
  await page.getByLabel('作品名称', { exact: true }).fill('原稿')
  await page.getByLabel('命名空间', { exact: true }).fill('source')
  await page.getByRole('button', { name: '创建作品', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  const other = await context.newPage()
  await other.goto('/creator')
  await other.getByRole('button', { name: '原稿 source:…' }).click()
  await page.getByLabel('作品标题').fill('新版本')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await other.getByLabel('作品标题').fill('冲突窗口的编辑')
  await other.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(other.getByRole('alert')).toContainText('其他窗口修改')
  await other.getByLabel('命名空间', { exact: true }).fill('rescued')
  await other.getByRole('button', { name: '以此命名空间另存副本', exact: true }).click()
  await expect(other.getByLabel('作品命名空间')).toHaveValue('rescued')
  await page.reload()
  await expect(page.getByRole('button', { name: '新版本 source:…' })).toBeVisible()
  await expect(page.getByRole('button', { name: '冲突窗口的编辑 副本 rescued:…' })).toBeVisible()
})

test('imports omitted template parameters and preserves unfinished behavior rows', async ({ page }) => {
  const { createDraft, exportArchive } = await import('@arcadia-eternity/pack-loader/native')
  const draft = createDraft('unfinished-ui', '未完成', 'unfinished')
  draft.data.marks.push({
    id: 'stat',
    behaviors: [{ useId: 'speed', definitionId: 'base/template/mark-attribute' }, null],
  })
  const archive = await exportArchive({ drafts: [draft] })
  await page.goto('/creator')
  await expect(page.getByLabel('导入作品文件')).toBeEnabled()
  await page
    .getByLabel('导入作品文件')
    .setInputFiles({ name: 'unfinished.arcadia', mimeType: 'application/json', buffer: Buffer.from(archive) })
  await page.getByRole('button', { name: '导入这些作品', exact: true }).click()
  await page.getByRole('button', { name: '未完成 unfinished:…' }).click()
  await page.getByRole('button', { name: /^印记（/ }).click()
  await page.getByLabel('编辑内容').selectOption('stat')
  await expect(page.locator('.effect-card').first().getByLabel('数值', { exact: true })).toHaveValue('10')
  await expect(page.getByText('这项效果记录尚未完成。草稿会保留原始数据；可移除后重新选择模板。')).toBeVisible()
  await page.locator('.effect-card').first().getByLabel('数值', { exact: true }).fill('25')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await page.locator('.effect-card').last().getByRole('button', { name: '移除效果' }).click()
  await page.getByRole('button', { name: '校验并准备试战', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('校验通过')
})

test('Web and Node load byte-equivalent source metadata for works', async ({ page }) => {
  const { NativeNodePackLoader } = await import('@arcadia-eternity/pack-loader/node')
  const { nativeBuildIdentity } = await import('@arcadia-eternity/data-pack-base/build')
  const { createOfficialContent } = await import('@arcadia-eternity/data-pack-base/native')
  const node = await new NativeNodePackLoader(nativeBuildIdentity, createOfficialContent).loadMetadata('builtin:base', {
    source: 'node-fs',
    enforceLockfile: true,
  })
  await page.goto('/creator')
  await expect(page.getByRole('button', { name: '创建作品', exact: true })).toBeEnabled()
  const browser = await page.evaluate(async () => {
    const path = '/src/features/creator/content.ts'
    const { loadCreatorBase } = await import(path)
    return loadCreatorBase()
  })
  expect(browser).toEqual(node.data)
})

test('expired trial links cannot silently launch an ordinary battle', async ({ page }) => {
  await page.goto('/local-battle?trialKey=expired')
  await expect(page.getByText('试战快照已失效，请回到创作页重新准备试战')).toBeVisible()
  await expect(page.getByRole('button', { name: '开始本地对战', exact: true })).toBeDisabled()
})
