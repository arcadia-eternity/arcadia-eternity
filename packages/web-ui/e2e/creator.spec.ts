import { fileURLToPath } from 'node:url'
import { emptyWorkspace, type WorkSnapshot, type WorkWorkspace } from '@arcadia-eternity/pack-loader/native'
import { prepareShippedEnvironment } from '@arcadia-eternity/pack-loader/node'
import { expect, test, type BrowserContext } from 'playwright/test'
import type { CreatorContent } from '../src/features/creator/content'

let creatorBase: CreatorContent
test.beforeAll(async () => {
  const prepared = await prepareShippedEnvironment(fileURLToPath(new URL('../../../packs/base/', import.meta.url)))
  try {
    const authoring = prepared.authoring
    if (!authoring) throw new Error('Shipped environment is missing authoring metadata')
    const { build, templates, effectIds, effectTemplates } = authoring
    creatorBase = { data: prepared.data, build, templates, effectIds, effectTemplates }
  } finally {
    await prepared.dispose()
  }
})

// Exercise the desktop authoring surface with transactional storage behind a test bridge.
// The ordinary browser route is now read-only and is covered by content-manager.spec.ts.
async function desktopAuthoring(context: BrowserContext) {
  let snapshot: WorkSnapshot = { revision: 0, workspace: emptyWorkspace() }
  await context.exposeFunction('readTestWorkWorkspace', () => snapshot)
  await context.exposeFunction('writeTestWorkWorkspace', (expected: number, workspace: WorkWorkspace) => {
    if (expected !== snapshot.revision) return false
    snapshot = { revision: expected + 1, workspace }
    return true
  })
  await context.addInitScript(base => {
    const storage = window as Window & {
      readTestWorkWorkspace(): Promise<WorkSnapshot>
      writeTestWorkWorkspace(expected: number, workspace: WorkWorkspace): Promise<boolean>
    }
    Object.defineProperty(window, 'arcadiaDesktop', {
      value: {
        getLocalServerPort: async () => null,
        listWorkspacePacks: async () => [],
        listCachedPets: async () => [],
        getAppVersion: async () => 'test',
        prepareLocalContent: async () => ({
          token: 'creator-test',
          content: { species: [], skills: [], marks: [] },
        }),
        releaseLocalContent: async () => {},
        readCreatorBase: async () => base,
        readWorkWorkspace: () => storage.readTestWorkWorkspace(),
        compareAndSwapWorkWorkspace: ({ expected, workspace }: { expected: number; workspace: WorkWorkspace }) =>
          storage.writeTestWorkWorkspace(expected, workspace),
      },
    })
  }, creatorBase)
}
test.beforeEach(async ({ context }) => {
  await desktopAuthoring(context)
})

test('authors namespaced effects, validates, publishes and shares a draft', async ({ page, browser }) => {
  await page.goto('/creator/drafts')
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
  await page.getByRole('button', { name: '校验组合内容', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('校验通过')
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    await desktopAuthoring(other)
    const receiver = await other.newPage()
    await receiver.goto('/creator/drafts')
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
  await page.goto('/creator/drafts')
  await page.getByLabel('作品名称', { exact: true }).fill('原稿')
  await page.getByLabel('命名空间', { exact: true }).fill('source')
  await page.getByRole('button', { name: '创建作品', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  const other = await context.newPage()
  await other.goto('/creator/drafts')
  await other.getByRole('button', { name: '原稿 source:…' }).click()
  await page.getByLabel('作品标题').fill('新版本')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已保存')
  await other.getByLabel('作品标题').fill('冲突窗口的编辑')
  await other.getByRole('button', { name: '保存草稿', exact: true }).click()
  await expect(other.locator('main.creator').getByRole('alert')).toContainText('其他窗口修改')
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
  await page.goto('/creator/drafts')
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
  await page.getByRole('button', { name: '校验组合内容', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('校验通过')
})

test('creator uses the shipped metadata provided by the desktop bridge', async ({ page }) => {
  const { NativeNodePackLoader } = await import('@arcadia-eternity/pack-loader/node')
  const { nativeBuildIdentity } = await import('@arcadia-eternity/data-pack-base/build')
  const { createOfficialContent } = await import('@arcadia-eternity/data-pack-base/effects')
  const node = await new NativeNodePackLoader(nativeBuildIdentity, createOfficialContent).loadMetadata('builtin:base', {
    source: 'node-fs',
    enforceLockfile: true,
  })
  await page.goto('/creator/drafts')
  await expect(page.getByRole('button', { name: '创建作品', exact: true })).toBeEnabled()
  const browser = await page.evaluate(async () => {
    const path = '/src/features/creator/content.ts'
    const { loadCreatorBase } = await import(path)
    return loadCreatorBase()
  })
  expect(browser.data).toMatchObject(node.data)
  expect(browser.effectTemplates).toEqual(creatorBase.effectTemplates)
})
