import { getDesktopApi, isDesktop } from './env'

const runtimeCache = {
  resolvedPackRef: null as string | null,
  resolvePromise: null as Promise<string> | null,
}

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function defaultPackRef(): string {
  if (import.meta.env.VITE_STATIC_MODE === '1') {
    return new URL(`${import.meta.env.BASE_URL}pack.json`, window.location.href).href
  }
  const base = normalizeBase(import.meta.env.VITE_API_BASE || '')
  return `${base}/pack.json`
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

async function resolveDesktopPackRef(baseOnly = false): Promise<string | null> {
  const api = getDesktopApi()
  if (!api) return null

  try {
    const port = await api.getLocalServerPort()
    if (!port || !Number.isFinite(port) || port <= 0) return null

    const packs = await api.listWorkspacePacks()
    const base = packs.find(pack => pack.id === 'arcadia-eternity.base')
    // With registered workspace layers the store loads each original manifest.
    // A fresh dev desktop has none, so it must load the locked base directly.
    const hasLayers = packs.some(pack => pack.enabled)
    const folder = baseOnly || !hasLayers ? encodeURIComponent(base?.folderName ?? 'base') : 'workspace'
    const candidate = `http://127.0.0.1:${port}/packs/${folder}/pack.json`
    return (await isReachable(candidate)) ? candidate : null
  } catch {
    return null
  }
}

function resolveAssetBaseFromPackRef(packRef: string): string {
  try {
    const baseUrl = new URL(packRef, window.location.href)
    const normalizedPath = baseUrl.pathname.endsWith('pack.json')
      ? baseUrl.pathname.slice(0, -'pack.json'.length)
      : `${baseUrl.pathname.replace(/\/+$/, '')}/`

    return `${baseUrl.origin}${normalizedPath}`
  } catch {
    return '/'
  }
}

function withCacheBust(url: string, token: string): string {
  try {
    const parsed = new URL(url, window.location.origin)
    parsed.searchParams.set('__ae_pack_ts', token)
    return parsed.toString()
  } catch {
    const separator = url.includes('?') ? '&' : '?'
    return `${url}${separator}__ae_pack_ts=${encodeURIComponent(token)}`
  }
}

export function invalidateRuntimePackRefCache(): void {
  runtimeCache.resolvedPackRef = null
  runtimeCache.resolvePromise = null
}

/** Creator works capture the locked base independently of mutable workspace overlays. */
export async function resolveBasePackRef(): Promise<string> {
  const explicit = (import.meta.env.VITE_PACK_REF || '').trim()
  if (explicit) return explicit
  if (isDesktop) {
    const base = await resolveDesktopPackRef(true)
    if (base) return base
  }
  return defaultPackRef()
}

export async function resolveRuntimePackRef(options?: { forceRefresh?: boolean }): Promise<string> {
  const forceRefresh = options?.forceRefresh === true

  if (forceRefresh) {
    invalidateRuntimePackRefCache()
  }

  if (runtimeCache.resolvedPackRef) {
    return forceRefresh ? withCacheBust(runtimeCache.resolvedPackRef, `${Date.now()}`) : runtimeCache.resolvedPackRef
  }
  if (runtimeCache.resolvePromise) {
    const resolved = await runtimeCache.resolvePromise
    return forceRefresh ? withCacheBust(resolved, `${Date.now()}`) : resolved
  }

  runtimeCache.resolvePromise = (async () => {
    const explicit = (import.meta.env.VITE_PACK_REF || '').trim()
    if (explicit) return explicit

    if (isDesktop) {
      const desktopWorkspace = await resolveDesktopPackRef()
      if (desktopWorkspace) return desktopWorkspace
    }

    return defaultPackRef()
  })()

  const resolved = await runtimeCache.resolvePromise
  runtimeCache.resolvedPackRef = resolved
  runtimeCache.resolvePromise = null
  return forceRefresh ? withCacheBust(resolved, `${Date.now()}`) : resolved
}

export function applyRuntimeAssetBase(packRef: string): void {
  const root = globalThis as typeof globalThis & { __ARCADIA_ASSET_BASE__?: string }
  root.__ARCADIA_ASSET_BASE__ = resolveAssetBaseFromPackRef(packRef)
}
