import { valid } from 'semver'
import { isRecord } from './types.ts'

export const officialBasePackage = '@arcadia-eternity/data-pack-base'
export const officialEnvironmentPackages = {
  'builtin-server': '@arcadia-eternity/environment-default',
  'training-120': '@arcadia-eternity/environment-training-120',
}

// These recipes and the base package share a release version. pnpm pins workspace:* to it when packing.
export function resolveOfficialWorkspaceManifest(manifest: unknown): unknown {
  if (
    !isRecord(manifest) ||
    typeof manifest.name !== 'string' ||
    !Object.values(officialEnvironmentPackages).includes(manifest.name) ||
    typeof manifest.version !== 'string' ||
    !valid(manifest.version) ||
    !isRecord(manifest.dependencies) ||
    manifest.dependencies[officialBasePackage] !== 'workspace:*'
  )
    return manifest
  return { ...manifest, dependencies: { ...manifest.dependencies, [officialBasePackage]: manifest.version } }
}
