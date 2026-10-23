// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
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

describe('native game metadata', () => {
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
