import { describe, expect, it } from 'vitest'
import type { PackLock } from '@arcadia-eternity/schema/src/pack.js'
import type { AssetLock } from '@arcadia-eternity/schema/src/assets.js'
import { isAssetLockCompatible, isPackLockCompatible } from '../src/domain/battle/pack'

const baseLock = (): PackLock => ({
  lockVersion: 1,
  engine: 'seer2-v2',
  packs: [
    {
      id: 'arcadia-eternity.base',
      version: '1.0.0',
      integrity: 'builtin',
      source: 'builtin:base',
    },
  ],
})

describe('pack lock compatibility', () => {
  it('returns true for identical lock', () => {
    expect(isPackLockCompatible(baseLock(), baseLock())).toBe(true)
  })

  it('returns false when source differs', () => {
    const provided = baseLock()
    provided.packs[0]!.source = 'npm:@arcadia-eternity/data-pack-base'
    expect(isPackLockCompatible(baseLock(), provided)).toBe(false)
  })
})

const baseAssetLock = (): AssetLock => ({
  lockVersion: 1,
  engine: 'seer2-v2',
  assets: [
    {
      id: 'arcadia-eternity.base-assets',
      version: '1.0.0',
      integrity: 'builtin',
      source: 'builtin:base-assets',
    },
  ],
})

describe('asset lock compatibility', () => {
  it('returns true for identical lock', () => {
    expect(isAssetLockCompatible(baseAssetLock(), baseAssetLock())).toBe(true)
  })

  it('returns false when source differs', () => {
    const provided = baseAssetLock()
    provided.assets[0]!.source = 'npm:@arcadia-eternity/assets-pack-base'
    expect(isAssetLockCompatible(baseAssetLock(), provided)).toBe(false)
  })
})
