import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import WorkshopPage from '../WorkshopPage.vue'
import { browserTrustStore, createWorkshopSource, workshopError } from '../workshopSource'
import type { WorkshopSummary } from '@/types/workshop'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
afterEach(() => {
  vi.unstubAllGlobals()
  push.mockReset()
})

const release = (version: string) => ({
  version,
  integrity: 'sha512-' + 'a'.repeat(86) + '==',
  tarball: 'https://registry.npmjs.org/x.tgz',
  size: 1,
  publishedAt: '2026-11-20T00:00:00.000Z',
  dependencies: { '@arcadia-eternity/data-pack-base': '^5.0.0' },
  containsCode: true,
  provenance: { repository: 'demo/forest', workflow: 'release-pack.yml', commit: 'b'.repeat(40) },
})
const summary = (overrides: Partial<WorkshopSummary> = {}): WorkshopSummary => ({
  registry: 'official',
  official: true,
  freshness: 'fresh',
  checkedAt: '2026-11-27T00:00:00.000Z',
  snapshot: 3,
  expires: '2026-12-04T00:00:00.000Z',
  projects: [
    {
      id: 'demo.forest',
      kind: 'package',
      npm: '@demo/forest',
      title: '森林',
      summary: '森林精灵',
      authors: ['demo'],
      repository: 'demo/forest',
      tags: ['精灵'],
      official: false,
      featured: false,
      releases: [release('1.1.0'), release('1.0.0')],
    },
    {
      id: 'demo.cup',
      kind: 'environment',
      npm: '@demo/environment-cup',
      title: '杯赛',
      summary: '',
      authors: ['demo'],
      repository: 'demo/cup',
      tags: [],
      official: false,
      featured: true,
      releases: [release('2.0.0')],
    },
  ],
  revocations: [{ npm: '@demo/forest', version: '1.1.0', reason: '数值错误', revokedAt: '2026-11-26T00:00:00.000Z' }],
  revokedInstalled: [],
  ...overrides,
})

const bodyButton = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!

function desktop(handler: (input: { action: string } & Record<string, unknown>) => unknown) {
  const workshop = vi.fn(async (input: { action: string } & Record<string, unknown>) => {
    try {
      return { result: await handler(input) }
    } catch (error) {
      return { error: { code: (error as Error).message } }
    }
  })
  const localEnvironment = vi.fn(async () => ({
    result: { operations: [{ id: 'op', status: 'succeeded', result: { environmentId: 'cup' } }] },
  }))
  vi.stubGlobal('arcadiaDesktop', { workshop, localEnvironment })
  return { workshop, localEnvironment }
}

it('filters projects, skips revoked releases, and installs a package from the signed index', async () => {
  const { workshop } = desktop(input => {
    if (input.action === 'registries') return { registries: [{ id: 'official', site: 'x', official: true }] }
    if (input.action === 'view') return summary()
    if (input.action === 'install') return { packageId: 'pkg-1' }
  })
  const page = mount(WorkshopPage, { props: { source: createWorkshopSource() }, attachTo: document.body })
  await flushPromises()
  const items = page.findAll('.workshop-card')
  expect(items.map(item => item.find('.card-title').text())).toEqual(['杯赛', '森林'])

  await page.get('input[aria-label="搜索工坊"]').setValue('精灵')
  expect(page.findAll('.workshop-card')).toHaveLength(1)
  await page.get('.workshop-card').trigger('click')
  await flushPromises()
  expect(document.body.textContent).toContain('1.0.0')
  expect(document.body.textContent).toContain('含效果代码')
  bodyButton('安装').click()
  await flushPromises()
  expect(workshop).toHaveBeenCalledWith({ action: 'install', npm: '@demo/forest', version: '1.0.0' })
  expect(document.body.textContent).toContain('已安装 森林 1.0.0')
  bodyButton('加入环境').click()
  expect(push).toHaveBeenCalledWith({ path: '/environments', query: { target: 'local', packageId: 'pkg-1' } })
  page.unmount()
})

it('waits for the environment operation and blocks installs from a stale index', async () => {
  let freshness: 'fresh' | 'stale' = 'stale'
  const { workshop, localEnvironment } = desktop(input => {
    if (input.action === 'registries') return { registries: [{ id: 'official', site: 'x', official: true }] }
    if (input.action === 'view' || input.action === 'refresh') return summary({ freshness })
    if (input.action === 'install') return { operationId: 'op' }
  })
  const page = mount(WorkshopPage, { props: { source: createWorkshopSource() }, attachTo: document.body })
  await flushPromises()
  expect(page.text()).toContain('离线')
  await page.findAll('.workshop-card')[0]!.trigger('click')
  await flushPromises()
  expect(bodyButton('安装').disabled).toBe(true)

  freshness = 'fresh'
  await page
    .findAll('button')
    .find(button => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  const target = document.querySelector<HTMLInputElement>('input[aria-label="环境标识"]')!
  target.value = 'cup'
  target.dispatchEvent(new Event('input'))
  await flushPromises()
  expect(bodyButton('安装').disabled).toBe(false)
  bodyButton('安装').click()
  await flushPromises()
  expect(workshop).toHaveBeenCalledWith({
    action: 'install',
    npm: '@demo/environment-cup',
    version: '2.0.0',
    environmentId: 'cup',
  })
  expect(localEnvironment).toHaveBeenCalledWith({ action: 'snapshot' })
  expect(document.body.textContent).toContain('已安装 杯赛 2.0.0')
  bodyButton('查看环境').click()
  expect(push).toHaveBeenCalledWith({ path: '/environments', query: { target: 'local', environmentId: 'cup' } })
  page.unmount()
})

it('adds a third-party registry only after previewing its root fingerprint', async () => {
  const fingerprint = 'f'.repeat(64)
  let registries = [{ id: 'official', site: 'x', official: true }]
  const { workshop } = desktop(input => {
    if (input.action === 'registries') return { registries }
    if (input.action === 'view') return summary({ registry: String(input.registry ?? 'official') })
    if (input.action === 'preview-registry')
      return { id: 'community', fingerprint, mirrors: [], expires: '2027-11-01T00:00:00.000Z' }
    if (input.action === 'add-registry') {
      registries = [...registries, { id: 'community', site: String(input.site), official: false }]
      return { id: 'community' }
    }
  })
  const page = mount(WorkshopPage, { props: { source: createWorkshopSource() }, attachTo: document.body })
  await flushPromises()
  await page
    .findAll('button')
    .find(button => button.text() === '工坊源')!
    .trigger('click')
  await flushPromises()
  const input = document.querySelector<HTMLInputElement>('input[aria-label="工坊源地址"]')!
  input.value = 'https://community.example/'
  input.dispatchEvent(new Event('input'))
  await flushPromises()
  ;[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '读取根密钥')!.click()
  await flushPromises()
  expect(document.body.textContent).toContain(fingerprint)
  ;[...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '信任此工坊源')!.click()
  await flushPromises()
  expect(workshop).toHaveBeenCalledWith({ action: 'add-registry', site: 'https://community.example/', fingerprint })
  expect(workshop).toHaveBeenCalledWith({ action: 'view', registry: 'community' })
  page.unmount()
})

it('maps workshop error codes and serializes browser trust updates', async () => {
  expect(workshopError({ code: 'WORKSHOP_RELEASE_REVOKED' })).toBe('此版本已被撤销。')
  expect(workshopError(new Error('WORKSHOP_INTEGRITY_MISMATCH: @demo/x@1.0.0'))).toContain('签名索引')
  const store = browserTrustStore(window.localStorage)
  const root = { signed: { type: 'root' }, signatures: [] }
  expect(await store.update('official', () => ({ root }))).toBe(true)
  expect(await store.update('official', current => (current ? undefined : { root }))).toBe(false)
  expect(await store.read('official')).toEqual({ root })
  window.localStorage.clear()
})
