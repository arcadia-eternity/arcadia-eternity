import { describe, expect, test } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { PackLockSchema, PackManifestSchema } from '../src/pack'
import { parseWithErrors } from '../src/utils'

describe('pack schemas', () => {
  test('validates pack manifest', () => {
    const manifest = {
      id: 'arcadia-eternity.base',
      version: '1.0.0',
      engine: 'seer2-v2',
      layoutVersion: 1,
      assetsRef: 'npm:@arcadia-eternity/assets-pack-base',
      paths: {
        dataDir: 'data',
        localesDir: 'locales',
      },
      data: {
        effects: ['effect_skill.yaml'],
        marks: ['mark.yaml'],
        skills: ['skill.yaml'],
        species: ['species.yaml'],
      },
      locales: {
        'zh-CN': ['skill', 'mark', 'species'],
      },
    }

    expect(Value.Check(PackManifestSchema, manifest)).toBe(true)
  })

  test('rejects invalid pack manifest engine', () => {
    expect(() =>
      parseWithErrors(PackManifestSchema, {
        id: 'bad-pack',
        version: '1.0.0',
        engine: 'seer2-v1',
        data: {
          effects: [],
          marks: [],
          skills: [],
          species: [],
        },
      }),
    ).toThrowError(/Validation failed/)
  })

  test('validates pack lock', () => {
    const lock = {
      lockVersion: 1,
      engine: 'seer2-v2',
      packs: [
        {
          id: 'arcadia-eternity.base',
          version: '1.0.0',
          integrity: 'sha256-abcdef',
          source: 'builtin:base',
        },
      ],
    }

    expect(Value.Check(PackLockSchema, lock)).toBe(true)
  })
})
