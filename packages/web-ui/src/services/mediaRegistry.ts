import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import { shallowReactive, toRaw } from 'vue'
import { officialAssetUrl } from '../utils/officialAssetUrl'

export type MediaResource = {
  id: string
  source: string
  tags?: string[]
  sha256?: string
  kind?: string
  mime?: string
}
export type MediaCatalog = Pick<ServerEnvironmentContent, 'species' | 'skills' | 'marks'>
export type MediaEnvironment = {
  scope: string
  resources: MediaResource[]
  hashes: Map<string, string>
  battleUi?: Map<string, string>
  promote?: (url: string) => void
}
const environments = shallowReactive(new WeakMap<object, MediaEnvironment>())
const localFiles = new Map<string, Set<{ url: string }>>()
let sequence = 0

export function localMediaFiles(digest: string) {
  return localFiles.get(digest) ?? []
}

export function registeredMediaEnvironment(content: MediaCatalog): MediaEnvironment {
  const key = toRaw(content)
  if (!environments.has(key)) registerMediaEnvironment(key, 'session/' + ++sequence)
  return environments.get(key)!
}

export function registerMediaEnvironment(
  content: MediaCatalog,
  scope: string,
  resources: MediaResource[] = [],
  local = false,
) {
  const hashes = new Map<string, string>()
  const leases: (() => void)[] = []
  for (const resource of resources) {
    if (!resource.sha256) continue
    if (!/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('资源哈希格式无效')
    const url = officialAssetUrl(resource.source)
    if (hashes.has(url) && hashes.get(url) !== resource.sha256) throw new Error('同一资源地址声明了不同的哈希')
    hashes.set(url, resource.sha256)
  }
  const registered = new Set<string>()
  if (local)
    for (const resource of resources) {
      if (!resource.sha256) continue
      const url = officialAssetUrl(resource.source)
      if (!registered.has(url) && (resource.kind === 'file' || url !== resource.source)) {
        registered.add(url)
        const digest = resource.sha256
        const files = localFiles.get(digest) ?? new Set()
        const entry = { url }
        files.add(entry)
        localFiles.set(digest, files)
        leases.push(() => {
          files.delete(entry)
          if (!files.size) localFiles.delete(digest)
        })
      }
    }
  environments.set(toRaw(content), { scope, resources, hashes })
  return () => {
    for (const release of leases) release()
  }
}
