// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import i18next from 'i18next'
import { computed } from 'vue'
import { serverContentText, serverText, isRemoteContentActive } from '@/i18n/serverContent'
import { useGameDataStore } from '../gameData'

const { loadMetadata } = vi.hoisted(() => ({ loadMetadata: vi.fn() }))
vi.mock('@arcadia-eternity/data-pack-base/effects', () => {
  throw new Error('Metadata loading must not import effect code')
})
vi.mock('@arcadia-eternity/pack-loader/native', async importOriginal => ({
  ...(await importOriginal<typeof import('@arcadia-eternity/pack-loader/native')>()),
  PackMetadataLoader: class {
    loadMetadata = loadMetadata
  },
}))
vi.mock('@/utils/packRef', () => ({
  applyRuntimeAssetBase: vi.fn(),
  resolveRuntimePackRef: vi.fn(async () => 'http://localhost/packs/base/pack.json'),
}))

const root = new URL('../../../../../packs/base/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('pack.json', root), 'utf8'))
const read = (kind: 'marks' | 'skills' | 'species') =>
  manifest.data[kind].flatMap((file: string) =>
    parse(readFileSync(new URL(`data/${file}`, root), 'utf8'), { merge: true }),
  )
const data = { marks: read('marks'), skills: read('skills'), species: read('species') }
const baseResult = () => ({
  pack: manifest,
  data: structuredClone(data),
  presentation: [JSON.parse(readFileSync(new URL('dist/presentation.json', root), 'utf8'))],
  errors: [],
  source: 'http',
})

beforeEach(() => {
  setActivePinia(createPinia())
  loadMetadata.mockReset().mockResolvedValue(baseResult())
})
afterEach(() => vi.unstubAllGlobals())

it('desktop local names and descriptions survive a remote room round trip and reload replaces only its metadata lease', async () => {
  const pet = {
    ...structuredClone(data.species[0]),
    id: 'local:pet',
    inheritance: { skills: [] },
    learnable_skills: [],
    ability: [],
    emblem: [],
    name: '本地精灵',
  }
  const content = {
    species: [pet],
    skills: [],
    marks: [],
    locales: {
      defaultLocale: 'zh-CN',
      bundles: { 'zh-CN': { species: { 'local:pet': { name: '本地名称', description: '本地说明' } } } },
    },
  }
  const releaseLocalContent = vi.fn(async () => {})
  const prepareLocalContent = vi.fn(async () => ({ token: 'metadata', environment: {}, content }))
  vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent, releaseLocalContent } })
  const store = useGameDataStore()
  await store.initialize()
  const local = store.species
  expect(isRemoteContentActive()).toBe(false)
  expect(serverText('species', 'local:pet', 'name')).toBe('本地名称')
  store.applyServerEnvironment({ species: [{ ...pet, id: 'room:pet' }], skills: [], marks: [] })
  expect(isRemoteContentActive()).toBe(true)
  expect(releaseLocalContent).not.toHaveBeenCalled()
  store.clearServerEnvironment()
  expect(store.species).toBe(local)
  expect(isRemoteContentActive()).toBe(false)
  expect(serverText('species', 'local:pet', 'name')).toBe('本地名称')
  expect(serverText('species', 'local:pet', 'description')).toBe('本地说明')
  await store.reload()
  expect(releaseLocalContent).toHaveBeenCalledExactlyOnceWith('metadata')
  store.reset()
})

it('trial display restores exact prior records and text, including the connected room', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const official = store.species
  const pet = { ...data.species[0], id: 'room:pet', name: '房间内容' }
  store.applyServerEnvironment({ species: [pet], skills: [], marks: [] })
  expect(isRemoteContentActive()).toBe(true)
  const room = store.species,
    fallback = store.serverFallback
  const release = store.useLocalBattleContent({
    species: [{ ...pet, id: 'trial:pet', name: '试战内容' }],
    skills: [],
    marks: [],
  })
  expect(isRemoteContentActive()).toBe(false)
  expect(serverText('species', 'trial:pet', 'name')).toBe('试战内容')
  release()
  release()
  expect(store.species).toBe(room)
  expect(isRemoteContentActive()).toBe(true)
  expect(store.serverFallback).toBe(fallback)
  expect(store.species.byId['trial:pet']).toBeUndefined()
  expect(serverText('species', 'room:pet', 'name')).toBe('房间内容')
  expect(serverText('species', 'trial:pet', 'name')).toBeUndefined()
  store.clearServerEnvironment()
  expect(store.species).toBe(official)
})

it('keeps local battle content visible when the underlying server environment is cleared', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const original = store.species
  const content = (id: string) => ({ species: [{ ...data.species[0], id, name: id }], skills: [], marks: [] })
  store.applyServerEnvironment(content('room:pet'))
  const release = store.useLocalBattleContent(content('local:pet'))
  store.clearServerEnvironment()
  expect(store.species.allIds).toEqual(['local:pet'])
  expect(serverText('species', 'local:pet', 'name')).toBe('local:pet')
  release()
  expect(store.species).toBe(original)
  expect(store.serverFallback).toBeNull()
  expect(serverText('species', 'room:pet', 'name')).toBeUndefined()
})

it('retains a merged environment across source acquisition and independent releases', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const original = store.species
  const content = (id: string) => ({ species: [{ ...data.species[0], id, name: id }], skills: [], marks: [] })
  const environmentId = 'training-120'
  const local = store.useLocalBattleContent(content('local:pet'), { environmentId })
  const pinned = store.species
  store.applyServerEnvironment(content('room:pet'), { environmentId })
  expect(store.species).toBe(pinned)
  await store.clearServerEnvironment()
  expect(store.species).toBe(pinned)
  expect(serverText('species', 'local:pet', 'name')).toBe('local:pet')
  store.applyServerEnvironment(content('room:pet'), { environmentId })
  local()
  expect(store.species.allIds).toEqual(['room:pet'])
  local()
  expect(isRemoteContentActive()).toBe(true)
  await store.clearServerEnvironment()
  expect(store.species).toBe(original)
})

it('uses an installed non-default copy of the same logical ID after the server source disappears', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const environmentId = 'training-120'
  const content = (id: string) => ({
    species: [
      { ...data.species[0], id, name: id, inheritance: { skills: [] }, learnable_skills: [], ability: [], emblem: [] },
    ],
    skills: [],
    marks: [],
  })
  const releaseLocalContent = vi.fn()
  const prepareLocalContent = vi.fn(async () => ({ token: 'selected', environmentId, content: content('local:pet') }))
  vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent, releaseLocalContent } })
  store.applyServerEnvironment(content('room:pet'), { environmentId })
  await store.clearServerEnvironment()
  await store.clearServerEnvironment()
  expect(prepareLocalContent).toHaveBeenCalledExactlyOnceWith(environmentId)
  expect(store.species.allIds).toEqual(['local:pet'])
  expect(isRemoteContentActive()).toBe(false)
  expect(releaseLocalContent).not.toHaveBeenCalled()
  store.reconcileLocalInstallations([environmentId])
  expect(store.environmentId).toBe(environmentId)
  store.reconcileLocalInstallations([])
  expect(store.environmentId).not.toBe(environmentId)
  expect(store.getSpecies('local:pet')).toBeUndefined()
  expect(releaseLocalContent).toHaveBeenCalledExactlyOnceWith('selected')
})

it('keeps the newer publication when a local handover finishes after reconnection', async () => {
  const store = useGameDataStore()
  const environmentId = 'training-120'
  const content = { species: [], skills: [], marks: [] }
  const local = { token: 'late', environmentId, content }
  let finish!: (result: typeof local) => void
  const prepareLocalContent = vi.fn(
    () =>
      new Promise<typeof local>(resolve => {
        finish = resolve
      }),
  )
  const releaseLocalContent = vi.fn()
  vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent, releaseLocalContent } })
  store.applyServerEnvironment(content, { environmentId })
  const previous = store.species
  const first = store.clearServerEnvironment()
  const repeated = store.clearServerEnvironment()
  expect(store.species).toBe(previous)
  store.applyServerEnvironment(content, { environmentId })
  const recovered = store.species
  finish(local)
  await Promise.all([first, repeated])
  expect(prepareLocalContent).toHaveBeenCalledExactlyOnceWith(environmentId)
  expect(releaseLocalContent).toHaveBeenCalledExactlyOnceWith('late')
  expect(store.species).toBe(recovered)
  expect(isRemoteContentActive()).toBe(true)
})

it('withdraws room and matchmaking sources independently for one environment ID', () => {
  const store = useGameDataStore()
  const content = { species: [], skills: [], marks: [] }
  const environmentId = 'training-120'
  store.applyServerEnvironment(content, { environmentId, owner: 'matchmaking' })
  const preview = store.species
  store.applyServerEnvironment(content, { environmentId })
  store.clearServerEnvironment()
  expect(store.species).toBe(preview)
  store.clearServerEnvironment('matchmaking')
  expect(store.serverFallback).toBeNull()
  expect(store.environmentId).toBeUndefined()
})

it('overlapping trials released out of order never resurrect disposed content', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const original = store.species
  const content = (id: string) => ({ species: [{ ...data.species[0], id, name: id }], skills: [], marks: [] })
  const first = store.useLocalBattleContent(content('first:pet'))
  const second = store.useLocalBattleContent(content('second:pet'))
  first()
  expect(store.species.allIds).toEqual(['second:pet'])
  second()
  expect(store.species).toBe(original)
  expect(serverText('species', 'first:pet', 'name')).toBeUndefined()
  expect(serverText('species', 'second:pet', 'name')).toBeUndefined()
})

it('late trial cleanup cannot replace a later room, reset, or local reload', async () => {
  const store = useGameDataStore()
  const content = (id: string) => ({ species: [{ ...data.species[0], id, name: id }], skills: [], marks: [] })
  for (const replace of [
    async () => store.applyServerEnvironment(content('fresh:pet')),
    async () => store.reset(),
    async () => store.initialize({ forceReload: true }),
  ]) {
    const release = store.useLocalBattleContent(content('trial:pet'))
    await replace()
    const current = store.species
    release()
    expect(store.species).toBe(current)
    expect(serverText('species', 'trial:pet', 'name')).toBeUndefined()
  }
})

describe('native game metadata', () => {
  it('uses server-only metadata for a room and restores the prior local data when leaving', async () => {
    const store = useGameDataStore()
    await store.initialize()
    const originalSpecies = store.species.allIds.length
    const originalEffects = store.nativeEffectIds.length
    const species = { ...data.species[0], id: 'ugc:pet', learnable_skills: [], ability: [], emblem: [] }
    store.applyServerEnvironment({ species: [species], skills: [], marks: [] })
    expect(store.species.allIds).toEqual(['ugc:pet'])
    expect(store.nativeEffectIds).toEqual([])
    store.applyServerEnvironment({ species: [{ ...species, id: 'ugc:other' }], skills: [], marks: [] })
    store.clearServerEnvironment()
    expect(store.species.allIds).toHaveLength(originalSpecies)
    expect(store.nativeEffectIds).toHaveLength(originalEffects)
    expect(store.getSpecies('ugc:pet')).toBeUndefined()
  })
  it('initializes all base metadata without requesting legacy effect definitions', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Unexpected legacy data request')
    })
    vi.stubGlobal('fetch', fetch)
    const store = useGameDataStore()
    await store.initialize()
    expect(store.loaded).toBe(true)
    for (const kind of ['species', 'skills', 'marks'] as const)
      expect(store[kind].allIds).toEqual(data[kind].map((item: { id: string }) => item.id))
    expect(store.nativeEffectIds).toContain('effect_skill_consume_huanxiang_raise_def_1_stage')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unknown effect references and keeps compiled behaviors out of editable records', async () => {
    const store = useGameDataStore()
    await store.loadFromPackRef('http://localhost/packs/base/pack.json')
    const id = store.skills.allIds[0]
    store.skills.byId[id].effect = ['effect_unknown']
    const errors: string[] = []
    store.validateCrossReferences(errors)
    expect(errors).toEqual([`技能 ${id} 引用了不存在的效果 effect_unknown`])
  })
})

it('displays active server names and descriptions without modifying official locales', async () => {
  const i18n = i18next.createInstance().use(serverContentText)
  await i18n.init({
    lng: 'zh-CN',
    resources: { 'zh-CN': { species: { 'ugc:pet': { name: 'official' } } } },
    postProcess: ['serverContentText'],
  })
  const store = useGameDataStore()
  const species = { ...data.species[0], id: 'ugc:pet', learnable_skills: [], ability: [], emblem: [] }
  const name = computed(() => i18n.t('ugc:pet.name', { ns: 'species', nsSeparator: false }))
  store.applyServerEnvironment({
    species: [{ ...species, name: '作者名称', description: '威力 <damage>{power}</damage>' }],
    skills: [{ ...data.skills[0], id: 'ugc:skill', name: '技能名称' }],
    marks: [{ id: 'ugc:mark', description: '印记说明' }],
  })
  expect(name.value).toBe('作者名称')
  expect(i18n.t('ugc:pet.description', { ns: 'species' })).toBe('威力 <damage>{power}</damage>')
  expect(i18n.t('ugc:skill.name', { ns: 'skill' })).toBe('技能名称')
  expect(i18n.t('ugc:mark.description', { ns: ['mark', 'mark_ability'] })).toBe('印记说明')
  store.applyServerEnvironment({ species: [{ ...species, name: '另一个服务器' }], skills: [], marks: [] })
  expect(name.value).toBe('另一个服务器')
  expect(i18n.t('ugc:mark.description', { ns: 'mark', defaultValue: 'missing' })).toBe('')
  store.clearServerEnvironment()
  expect(name.value).toBe('official')
  expect(i18n.getResource('zh-CN', 'species', 'ugc:pet.name')).toBe('official')
  store.applyServerEnvironment({ species: [{ ...species, name: 'temporary' }], skills: [], marks: [] })
  store.reset()
  expect(name.value).toBe('official')
})

it('shares App and battle-page metadata initialization during a cold battle reload', async () => {
  let finish!: (value: ReturnType<typeof baseResult>) => void
  loadMetadata.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const store = useGameDataStore()
  const app = store.initialize(),
    battlePage = store.initialize()
  store.clearServerEnvironment() // The initial authentication watcher has no remote scope to clear.
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalled())
  expect(loadMetadata).toHaveBeenCalledTimes(1)
  finish(baseResult())
  await Promise.all([app, battlePage])
})

it('cannot overwrite a recovered server catalog with late local metadata after room acceptance', async () => {
  let finish!: (value: ReturnType<typeof baseResult>) => void
  loadMetadata.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const store = useGameDataStore(),
    lateLocal = store.initialize()
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledOnce())
  const species = {
    ...data.species[0],
    id: 'recovered:pet',
    learnable_skills: [],
    ability: [],
    emblem: [],
    presentation: { battle: { renderer: 'seer2-swf', source: 'https://media.test/pet.swf' } },
  }
  const cancelled = expect(lateLocal).rejects.toMatchObject({ name: 'AbortError' })
  store.applyServerEnvironment({ species: [species], skills: [], marks: [] })
  await cancelled
  const recovered = store.species
  await store.initialize() // New consumers observe the current remote catalog, never the old local ready.
  finish(baseResult())
  await Promise.resolve()
  await Promise.resolve()
  expect(store.species).toBe(recovered)
  expect(store.getSpecies('recovered:pet')?.presentation?.battle?.source).toBe('https://media.test/pet.swf')
  expect(isRemoteContentActive()).toBe(true)
})

it('shares current readiness through a scope change and ignores a stale loader rejection', async () => {
  let rejectOld!: (error: Error) => void
  loadMetadata.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject
      }),
  )
  const store = useGameDataStore(),
    consumer = store.whenReady()
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledOnce())
  const pet = { ...data.species[0], id: 'remote:ready', learnable_skills: [], ability: [], emblem: [] }
  store.applyServerEnvironment({ species: [pet], skills: [], marks: [] })
  await consumer
  const current = store.species
  rejectOld(new Error('late local request failed'))
  await Promise.resolve()
  await Promise.resolve()
  expect(store.species).toBe(current)
  expect(store.error).toBeNull()
  expect(store.loaded).toBe(true)
})

it('explicit reload cancels the old owner and shared consumers follow exactly one new load', async () => {
  let finishOld!: (value: ReturnType<typeof baseResult>) => void
  loadMetadata.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishOld = resolve
      }),
  )
  const store = useGameDataStore(),
    oldOwner = store.initialize(),
    consumer = store.whenReady()
  const cancelled = expect(oldOwner).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledOnce())
  const replacement = store.initialize({ forceReload: true })
  await Promise.all([cancelled, replacement, consumer])
  expect(loadMetadata).toHaveBeenCalledTimes(2)
  const current = store.species
  finishOld(baseResult())
  await Promise.resolve()
  await Promise.resolve()
  expect(store.species).toBe(current)
})

it('trial entry and exit own readiness without a late local load resurrecting the trial', async () => {
  let finishOld!: (value: ReturnType<typeof baseResult>) => void
  loadMetadata.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishOld = resolve
      }),
  )
  const store = useGameDataStore(),
    consumer = store.whenReady()
  await vi.waitFor(() => expect(loadMetadata).toHaveBeenCalledOnce())
  const release = store.useLocalBattleContent({
    species: [{ ...data.species[0], id: 'trial:ready', learnable_skills: [], ability: [], emblem: [] }],
    skills: [],
    marks: [],
  })
  await consumer
  expect(store.getSpecies('trial:ready')).toBeDefined()
  release()
  await store.whenReady()
  const current = store.species
  finishOld(baseResult())
  await Promise.resolve()
  await Promise.resolve()
  expect(store.species).toBe(current)
  expect(store.getSpecies('trial:ready')).toBeUndefined()
  expect(loadMetadata).toHaveBeenCalledTimes(2)
})

it('propagates an active-loader AbortError instead of retrying the same scope forever', async () => {
  loadMetadata.mockRejectedValueOnce(new DOMException('current loader aborted', 'AbortError'))
  const store = useGameDataStore()
  await expect(store.whenReady()).rejects.toMatchObject({ name: 'AbortError', message: 'current loader aborted' })
  expect(loadMetadata).toHaveBeenCalledOnce()
})
