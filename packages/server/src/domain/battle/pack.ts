import type { PackLock } from '@arcadia-eternity/schema/src/pack.js'
import type { AssetLock } from '@arcadia-eternity/schema/src/assets.js'

export const BUILTIN_BASE_PACK_SOURCE = 'builtin:base'

export const DEFAULT_PACK_LOCK: PackLock = {
  lockVersion: 1,
  engine: 'seer2-v2',
  packs: [
    {
      id: 'arcadia-eternity.base',
      version: '1.0.0',
      integrity: 'builtin',
      source: BUILTIN_BASE_PACK_SOURCE,
    },
  ],
}

export function resolvePackRefFromLock(lock?: PackLock): string {
  return lock?.packs[0]?.source ?? BUILTIN_BASE_PACK_SOURCE
}

export function isPackLockCompatible(required: PackLock, provided: PackLock): boolean {
  if (required.lockVersion !== provided.lockVersion || required.engine !== provided.engine) {
    return false
  }
  if (required.packs.length !== provided.packs.length) {
    return false
  }
  const normalize = (lock: PackLock) =>
    lock.packs
      .map(p => `${p.id}@${p.version}|${p.source}|${p.integrity}`)
      .sort()
      .join('||')
  return normalize(required) === normalize(provided)
}

export function isAssetLockCompatible(required: AssetLock, provided: AssetLock): boolean {
  if (required.lockVersion !== provided.lockVersion || required.engine !== provided.engine) {
    return false
  }
  if (required.assets.length !== provided.assets.length) {
    return false
  }
  const normalize = (lock: AssetLock) =>
    lock.assets
      .map(a => `${a.id}@${a.version}|${a.source}|${a.integrity}`)
      .sort()
      .join('||')
  return normalize(required) === normalize(provided)
}
