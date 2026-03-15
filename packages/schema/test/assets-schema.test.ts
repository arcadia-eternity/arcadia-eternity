import { describe, expect, test } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { AssetLockSchema, AssetManifestSchema } from '../src/assets'

describe('asset schemas', () => {
  test('validates asset manifest', () => {
    const manifest = {
      id: 'arcadia-eternity.base-assets',
      version: '1.0.0',
      engine: 'seer2-v2',
      dependencies: ['https://example.com/assets/common.json'],
      assets: [
        {
          id: 'pet.custom.001.swf',
          type: 'petSwf',
          uri: 'https://example.com/pets/001.swf',
        },
        {
          id: 'pet.custom.001.voice',
          type: 'petSfx',
          uri: 'https://example.com/pets/001.mp3',
        },
        {
          id: 'pet.custom.001',
          type: 'petPortrait',
          uri: 'https://example.com/pets/001.png',
        },
        {
          id: 'skill.sfx.001',
          type: 'skillSfx',
          uri: 'https://example.com/sfx/001.mp3',
        },
      ],
      mappings: {
        species: {
          species_demo: 'pet.custom.001',
        },
        skills: {
          skill_demo: 'skill.sfx.001',
        },
      },
    }

    expect(Value.Check(AssetManifestSchema, manifest)).toBe(true)
  })

  test('validates asset lock', () => {
    const lock = {
      lockVersion: 1,
      engine: 'seer2-v2',
      assets: [
        {
          id: 'arcadia-eternity.base-assets',
          version: '1.0.0',
          integrity: 'sha256-abcdef',
          source: 'builtin:base-assets',
        },
      ],
    }
    expect(Value.Check(AssetLockSchema, lock)).toBe(true)
  })
})
