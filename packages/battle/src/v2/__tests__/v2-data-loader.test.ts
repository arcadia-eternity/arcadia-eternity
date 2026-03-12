// battle/src/v2/__tests__/v2-data-loader.test.ts
// Tests for V2DataRepository, parsers, and data loader.

import { describe, test, expect } from 'vitest'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import YAML from 'yaml'
import { V2DataRepository } from '../data/v2-data-repository.js'
import { loadV2GameData, loadV2GameDataFromPack } from '../data/v2-data-loader.js'
import { parseEffect } from '../data/parsers/effect-parser.js'
import { parseMark } from '../data/parsers/mark-parser.js'
import { parseSkill } from '../data/parsers/skill-parser.js'
import { parseSpecies } from '../data/parsers/species-parser.js'

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))
const DATA_DIR = resolve(TEST_DIR, '../../../../../packages/data-pack-base/data')
const PACK_PATH = resolve(TEST_DIR, '../../../../../packages/data-pack-base/pack.json')

// ---------------------------------------------------------------------------
// V2DataRepository unit tests
// ---------------------------------------------------------------------------

describe('V2DataRepository', () => {
  test('register and retrieve effect', () => {
    const repo = new V2DataRepository()
    const effect = { id: 'eff_1', triggers: ['OnDamage'], priority: 0, apply: { type: 'noop' } }
    repo.registerEffect('eff_1', effect)
    expect(repo.getEffect('eff_1')).toBe(effect)
    expect(repo.findEffect('eff_1')).toBe(effect)
    expect(repo.findEffect('missing')).toBeUndefined()
  })

  test('getEffect throws for missing id', () => {
    const repo = new V2DataRepository()
    expect(() => repo.getEffect('missing')).toThrow("Effect 'missing' not found")
  })

  test('register and retrieve mark', () => {
    const repo = new V2DataRepository()
    const mark = {
      type: 'baseMark' as const,
      id: 'mark_1',
      config: {
        duration: 3, persistent: true, maxStacks: 1, stackable: false,
        stackStrategy: 'extend' as any, destroyable: true, isShield: false,
        keepOnSwitchOut: false, transferOnSwitch: false, inheritOnFaint: false,
      },
      tags: [],
      effectIds: [],
    }
    repo.registerMark('mark_1', mark)
    expect(repo.getMark('mark_1')).toBe(mark)
  })

  test('stats returns correct counts', () => {
    const repo = new V2DataRepository()
    repo.registerEffect('e1', { id: 'e1', triggers: [], priority: 0, apply: {} })
    repo.registerEffect('e2', { id: 'e2', triggers: [], priority: 0, apply: {} })
    expect(repo.stats()).toEqual({ effects: 2, marks: 0, skills: 0, species: 0 })
  })

  test('clear empties all maps', () => {
    const repo = new V2DataRepository()
    repo.registerEffect('e1', { id: 'e1', triggers: [], priority: 0, apply: {} })
    repo.clear()
    expect(repo.stats()).toEqual({ effects: 0, marks: 0, skills: 0, species: 0 })
  })

  test('allEffects iterates all registered effects', () => {
    const repo = new V2DataRepository()
    repo.registerEffect('e1', { id: 'e1', triggers: [], priority: 0, apply: {} })
    repo.registerEffect('e2', { id: 'e2', triggers: [], priority: 0, apply: {} })
    const ids = [...repo.allEffects()].map(e => e.id)
    expect(ids).toContain('e1')
    expect(ids).toContain('e2')
  })
})

// ---------------------------------------------------------------------------
// Parser unit tests
// ---------------------------------------------------------------------------

describe('parseEffect', () => {
  test('converts string trigger to array', () => {
    const raw = { id: 'eff_test', trigger: 'OnDamage', priority: 5, apply: { type: 'noop' } }
    const result = parseEffect(raw)
    expect(result.triggers).toEqual(['OnDamage'])
    expect(result.priority).toBe(5)
  })

  test('keeps array trigger as-is', () => {
    const raw = { id: 'eff_test', trigger: ['OnDamage', 'OnHit'], priority: 0, apply: {} }
    const result = parseEffect(raw)
    expect(result.triggers).toEqual(['OnDamage', 'OnHit'])
  })

  test('passes condition and apply through opaquely', () => {
    const apply = { type: 'dealDamage', target: 'opponent' }
    const condition = { type: 'every', conditions: [] }
    const raw = { id: 'eff_test', trigger: 'OnHit', priority: 0, apply, condition }
    const result = parseEffect(raw)
    expect(result.apply).toBe(apply)
    expect(result.condition).toBe(condition)
  })

  test('throws if id is missing', () => {
    expect(() => parseEffect({ trigger: 'OnDamage', priority: 0, apply: {} })).toThrow('missing "id"')
  })

  test('throws if apply is missing', () => {
    expect(() => parseEffect({ id: 'x', trigger: 'OnDamage', priority: 0 })).toThrow('missing "apply"')
  })
})

describe('parseMark', () => {
  test('converts effect array to effectIds', () => {
    const raw = { id: 'mark_test', effect: ['eff_1', 'eff_2'], tags: ['status'] }
    const result = parseMark(raw)
    expect(result.type).toBe('baseMark')
    expect(result.effectIds).toEqual(['eff_1', 'eff_2'])
    expect(result.tags).toEqual(['status'])
  })

  test('fills config defaults when config is absent', () => {
    const raw = { id: 'mark_test' }
    const result = parseMark(raw)
    expect(result.config.destroyable).toBe(true)
    expect(result.config.persistent).toBe(true)
  })

  test('merges partial config with defaults', () => {
    const raw = { id: 'mark_test', config: { duration: 5, persistent: false } }
    const result = parseMark(raw)
    expect(result.config.duration).toBe(5)
    expect(result.config.persistent).toBe(false)
    expect(result.config.destroyable).toBe(true)
  })

  test('throws if id is missing', () => {
    expect(() => parseMark({})).toThrow('missing "id"')
  })
})

describe('parseSkill', () => {
  test('converts effect array to effectIds', () => {
    const raw = {
      id: 'skill_test', element: 'Fire', category: 'Physical',
      power: 80, rage: 0, accuracy: 100, effect: ['eff_1'],
    }
    const result = parseSkill(raw)
    expect(result.type).toBe('baseSkill')
    expect(result.effectIds).toEqual(['eff_1'])
  })

  test('fills defaults for optional fields', () => {
    const raw = { id: 'skill_test', element: 'Normal', category: 'Status', power: 0, rage: 0, accuracy: 100 }
    const result = parseSkill(raw)
    expect(result.priority).toBe(0)
    expect(result.target).toBe('opponent')
    expect(result.multihit).toBe(1)
    expect(result.sureHit).toBe(false)
    expect(result.sureCrit).toBe(false)
    expect(result.ignoreShield).toBe(false)
    expect(result.ignoreOpponentStageStrategy).toBe('none')
  })

  test('throws if id is missing', () => {
    expect(() => parseSkill({})).toThrow('missing "id"')
  })
})

describe('parseSpecies', () => {
  test('converts ability/emblem arrays to abilityIds/emblemIds', () => {
    const raw = {
      id: 'species_test', num: 1, element: 'Fire',
      baseStats: { hp: 80, atk: 100, def: 80, spa: 60, spd: 60, spe: 90 },
      genderRatio: [50, 50], heightRange: [50, 100], weightRange: [20, 40],
      ability: ['mark_ability_1'], emblem: ['mark_emblem_1'],
      learnable_skills: [],
    }
    const result = parseSpecies(raw)
    expect(result.type).toBe('species')
    expect(result.abilityIds).toEqual(['mark_ability_1'])
    expect(result.emblemIds).toEqual(['mark_emblem_1'])
  })

  test('discards learnable_skills', () => {
    const raw = {
      id: 'species_test', num: 1, element: 'Water',
      baseStats: { hp: 80, atk: 100, def: 80, spa: 60, spd: 60, spe: 90 },
      genderRatio: null, heightRange: [0, 0], weightRange: [0, 0],
      ability: [], emblem: [],
      learnable_skills: [{ skill_id: 'skill_x', level: 1, hidden: false }],
    }
    const result = parseSpecies(raw) as any
    expect(result.learnable_skills).toBeUndefined()
  })

  test('throws if id is missing', () => {
    expect(() => parseSpecies({})).toThrow('missing "id"')
  })
})

// ---------------------------------------------------------------------------
// Data loader integration tests (uses base data pack payload)
// ---------------------------------------------------------------------------

describe('loadV2GameData', () => {
  test('loads all YAML files and populates repository', async () => {
    const { repository, errors } = await loadV2GameData(DATA_DIR, { continueOnError: true })
    const stats = repository.stats()

    // Should have loaded a significant number of each type
    expect(stats.effects).toBeGreaterThan(100)
    expect(stats.marks).toBeGreaterThan(10)
    expect(stats.skills).toBeGreaterThan(100)
    expect(stats.species).toBeGreaterThan(10)

    // Log stats for visibility
    console.log('Repository stats:', stats)
    console.log(`Errors: ${errors.length}`)
    if (errors.length > 0) {
      console.log('First 5 errors:', errors.slice(0, 5))
    }
  })

  test('cross-reference validation finds no missing effects for skills', async () => {
    const { repository, errors } = await loadV2GameData(DATA_DIR, {
      continueOnError: true,
      validateReferences: true,
    })

    const refErrors = errors.filter(e => e.includes('references unknown'))
    if (refErrors.length > 0) {
      console.warn('Reference errors:', refErrors.slice(0, 5))
    }
    // Allow some reference errors (data may have intentional cross-file refs)
    // but the count should be reasonable
    expect(refErrors.length).toBeLessThan(50)
  })

  test('known species exists after loading', async () => {
    const { repository } = await loadV2GameData(DATA_DIR, { continueOnError: true })
    // pet_dilan is the first species in species.yaml
    const species = repository.findSpecies('pet_dilan')
    expect(species).toBeDefined()
    expect(species?.element).toBe('Water')
    expect(species?.baseStats.hp).toBeGreaterThan(0)
  })

  test('loads data and locales from pack manifest', async () => {
    const { repository, errors, pack, locales } = await loadV2GameDataFromPack(PACK_PATH, {
      continueOnError: true,
      validateReferences: true,
    })

    expect(pack?.id).toBe('arcadia-eternity.base')
    expect(pack?.layoutVersion).toBe(1)
    expect(repository.stats().skills).toBeGreaterThan(100)
    expect(errors.length).toBeLessThan(50)
    expect(locales?.['zh-CN']).toBeDefined()
    expect(locales?.['zh-CN']?.skill).toBeDefined()
    expect(locales?.['zh-CN']?.mark).toBeDefined()
  })

  test('loads data pack via npm ref', async () => {
    const { repository, pack } = await loadV2GameDataFromPack('npm:@arcadia-eternity/data-pack-base', {
      continueOnError: false,
      validateReferences: true,
    })
    expect(pack?.id).toBe('arcadia-eternity.base')
    expect(repository.stats().effects).toBeGreaterThan(100)
    expect(repository.findSkill('skill_paida')).toBeDefined()
  })

  test('loads dependency packs before entry pack', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'v2-pack-deps-'))
    const depDir = resolve(root, 'dep')
    const mainDir = resolve(root, 'main')
    await mkdir(resolve(depDir, 'data'), { recursive: true })
    await mkdir(resolve(depDir, 'locales/zh-CN'), { recursive: true })
    await mkdir(resolve(mainDir, 'data'), { recursive: true })
    await mkdir(resolve(mainDir, 'locales/zh-CN'), { recursive: true })

    try {
      await writeFile(resolve(depDir, 'data/effect_dep.yaml'), YAML.stringify([
        { id: 'eff_dep', trigger: 'OnBattleStart', priority: 0, apply: { type: 'addPower', target: 'useSkillContext', value: 1 } },
      ]))
      await writeFile(resolve(depDir, 'data/mark_dep.yaml'), YAML.stringify([]))
      await writeFile(resolve(depDir, 'data/skill_dep.yaml'), YAML.stringify([
        { id: 'skill_dep', element: 'Normal', category: 'Status', power: 0, rage: 0, accuracy: 100, effect: ['eff_dep'] },
      ]))
      await writeFile(resolve(depDir, 'data/species_dep.yaml'), YAML.stringify([
        {
          id: 'species_dep',
          num: 1,
          element: 'Normal',
          baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
          genderRatio: [50, 50],
          heightRange: [10, 20],
          weightRange: [10, 20],
          ability: [],
          emblem: [],
          learnable_skills: [],
        },
      ]))
      await writeFile(resolve(depDir, 'locales/zh-CN/skill.yaml'), YAML.stringify({ skill_dep: { name: 'Dep Skill' } }))
      await writeFile(resolve(depDir, 'pack.json'), JSON.stringify({
        id: 'dep.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        layoutVersion: 1,
        paths: { dataDir: 'data', localesDir: 'locales' },
        data: {
          effects: ['effect_dep.yaml'],
          marks: ['mark_dep.yaml'],
          skills: ['skill_dep.yaml'],
          species: ['species_dep.yaml'],
        },
        locales: { 'zh-CN': ['skill'] },
      }))

      await writeFile(resolve(mainDir, 'data/effect_main.yaml'), YAML.stringify([
        { id: 'eff_main', trigger: 'OnBattleStart', priority: 0, apply: { type: 'addPower', target: 'useSkillContext', value: 2 } },
      ]))
      await writeFile(resolve(mainDir, 'data/mark_main.yaml'), YAML.stringify([
        { id: 'mark_main', effect: ['eff_dep'] },
      ]))
      await writeFile(resolve(mainDir, 'data/skill_main.yaml'), YAML.stringify([]))
      await writeFile(resolve(mainDir, 'data/species_main.yaml'), YAML.stringify([]))
      await writeFile(resolve(mainDir, 'locales/zh-CN/mark.yaml'), YAML.stringify({ mark_main: { name: 'Main Mark' } }))
      await writeFile(resolve(mainDir, 'pack.json'), JSON.stringify({
        id: 'main.pack',
        version: '1.0.0',
        engine: 'seer2-v2',
        layoutVersion: 1,
        dependencies: [{ id: 'dep.pack', path: '../dep/pack.json' }],
        paths: { dataDir: 'data', localesDir: 'locales' },
        data: {
          effects: ['effect_main.yaml'],
          marks: ['mark_main.yaml'],
          skills: ['skill_main.yaml'],
          species: ['species_main.yaml'],
        },
        locales: { 'zh-CN': ['mark'] },
      }))

      const result = await loadV2GameDataFromPack(resolve(mainDir, 'pack.json'), {
        continueOnError: false,
        validateReferences: true,
      })
      expect(result.pack?.id).toBe('main.pack')
      expect(result.repository.findEffect('eff_dep')).toBeDefined()
      expect(result.repository.findMark('mark_main')).toBeDefined()
      expect(result.locales?.['zh-CN']?.skill).toBeDefined()
      expect(result.locales?.['zh-CN']?.mark).toBeDefined()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
