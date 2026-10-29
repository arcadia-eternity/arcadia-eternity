// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import i18next from 'i18next'
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { serverContentText, renderContentDescription, serverText } from '@/i18n/serverContent'
import { useGameDataStore } from '../gameData'
import type { WorkspacePackSummary } from '@/services/packWorkspace'

const { loadMetadata } = vi.hoisted(() => ({ loadMetadata: vi.fn() }))
vi.mock('@arcadia-eternity/pack-loader/native', () => ({
  NativePackLoader: class {
    loadMetadata = loadMetadata
  },
}))
vi.mock('@/services/packWorkspace', () => ({
  listWorkspacePacks: vi.fn(async () => []),
  resolveWorkspaceFileUrl: vi.fn(async (path: string) => `http://localhost/${path}`),
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
const baseResult = () => ({ pack: manifest, data: structuredClone(data), errors: [], source: 'http' })

beforeEach(() => {
  setActivePinia(createPinia())
  loadMetadata.mockReset().mockResolvedValue(baseResult())
})
afterEach(() => vi.unstubAllGlobals())

it('trial display restores exact prior records and text, including the connected room', async () => {
  const store = useGameDataStore()
  await store.initialize()
  const official = store.species
  const pet = { ...data.species[0], id: 'room:pet', name: '房间内容' }
  store.applyServerEnvironment({ species: [pet], skills: [], marks: [] })
  const room = store.species,
    fallback = store.serverFallback
  const release = store.useLocalBattleContent({
    species: [{ ...pet, id: 'trial:pet', name: '试战内容' }],
    skills: [],
    marks: [],
  })
  expect(serverText('species', 'trial:pet', 'name')?.value).toBe('试战内容')
  release()
  release()
  expect(store.species).toBe(room)
  expect(store.serverFallback).toBe(fallback)
  expect(store.species.byId['trial:pet']).toBeUndefined()
  expect(serverText('species', 'room:pet', 'name')?.value).toBe('房间内容')
  expect(serverText('species', 'trial:pet', 'name')).toBeUndefined()
  store.clearServerEnvironment()
  expect(store.species).toBe(official)
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
    expect([store.species.allIds.length, store.skills.allIds.length, store.marks.allIds.length]).toEqual([
      145, 966, 416,
    ])
    expect(store.nativeEffectIds).toHaveLength(1065)
    expect(store.effects.allIds).toEqual([])
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
    expect(store.effects.byId).toEqual({})
  })

  it('merges overlay metadata before resolving native effects and preserves nested source paths', async () => {
    const overlaySkill = { ...data.skills[0], power: 17, effect: ['effect_skill_consume_huanxiang_raise_def_1_stage'] }
    const overlayManifest = {
      ...manifest,
      id: 'example.overlay',
      data: { effects: [], marks: [], species: [], skills: ['groups/custom/skill.yaml'] },
    }
    loadMetadata.mockImplementation(async (ref: string) =>
      ref.includes('/overlay/')
        ? { pack: overlayManifest, data: { marks: [], species: [], skills: [overlaySkill] }, errors: [] }
        : baseResult(),
    )
    const requests: string[] = []
    vi.stubGlobal('fetch', async (ref: string) => {
      requests.push(ref)
      const pathname = new URL(ref).pathname
      const text = pathname.includes('/overlay/')
        ? JSON.stringify([overlaySkill])
        : readFileSync(new URL(pathname.replace('/packs/base/', ''), root), 'utf8')
      return new Response(text)
    })
    const store = useGameDataStore()
    await store.initializeFromWorkspacePacks([
      { id: manifest.id, folderName: 'base', enabled: true },
      { id: overlayManifest.id, folderName: 'overlay', enabled: true },
    ] as WorkspacePackSummary[])
    expect(store.skills.byId[overlaySkill.id].power).toBe(17)
    expect(store.nativeEffectIds).toContain(overlaySkill.effect[0])
    expect(store.getRecordSourceFile('skills', overlaySkill.id)).toBe('data/groups/custom/skill.yaml')
    expect(store.getRecordSourceFile('species', 'pet_dilan')).toBe('data/groups/dilan/species.0000.yaml')
    expect(requests.some(ref => /effect_.*\.yaml/.test(ref))).toBe(false)
    expect(() => store.validateDataIntegrity()).not.toThrow()
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
    species: [{ ...species, name: '作者名称', description: '<b>plain</b> {{value}}' }],
    skills: [{ ...data.skills[0], id: 'ugc:skill', name: '技能名称' }],
    marks: [{ id: 'ugc:mark', description: '印记说明' }],
  })
  expect(name.value).toBe('作者名称')
  const html = renderContentDescription(
    new MarkdownIt({ html: true }),
    '<img src=x onerror=alert(1)> **safe** [bad](javascript:alert(1))',
    'species',
    'ugc:pet',
  )
  expect(html).not.toContain('<img')
  expect(html).not.toContain('<a')
  expect(html).toContain('<strong>safe</strong>')
  expect(i18n.t('ugc:pet.description', { ns: 'species' })).toBe('<b>plain</b> {{value}}')
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
