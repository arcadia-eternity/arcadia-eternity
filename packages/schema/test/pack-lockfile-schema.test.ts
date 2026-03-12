import { describe, expect, test } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { PackLockfileSchema } from '../src/packLock'

describe('pack lockfile schema', () => {
  test('validates pnpm-style lockfile shape', () => {
    const lockfile = {
      lockfileVersion: 1,
      generatedAt: new Date().toISOString(),
      importers: {
        '.': {
          specifiers: {
            'arcadia-eternity.base': 'file:./packages/data-pack-base/pack.json',
          },
          dependencies: {
            'arcadia-eternity.base': {
              specifier: 'file:./packages/data-pack-base/pack.json',
              version: '1.0.0',
              packageKey: '/arcadia-eternity.base@1.0.0',
            },
          },
        },
      },
      packages: {
        '/arcadia-eternity.base@1.0.0': {
          name: 'arcadia-eternity.base',
          version: '1.0.0',
          kind: 'data',
          engine: 'seer2-v2',
          source: 'file:./packages/data-pack-base/pack.json',
          entry: 'pack.json',
          provenance: 'file',
          resolution: {
            integrity: 'sha512-abc',
            path: './packages/data-pack-base/pack.json',
          },
        },
      },
    }

    expect(Value.Check(PackLockfileSchema, lockfile)).toBe(true)
  })
})

