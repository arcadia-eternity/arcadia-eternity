import { getDesktopApi, isDesktop } from './env'

const runtimeCache = {
  resolvedPackRef: null as string | null,
  resolvePromise: null as Promise<string> | null,
}

function normalizeBase(base: string): string {
  return base.replace(/\/+$/, '')
}

function defaultPackRef(): string {
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

async function resolveDesktopWorkspacePackRef(): Promise<string | null> {
  const api = getDesktopApi()
  if (!api) return null

  try {
    const port = await api.getLocalServerPort()
    if (!port || !Number.isFinite(port) || port <= 0) return null

    const candidate = `http://127.0.0.1:${port}/packs/workspace/pack.json`
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

export async function resolveRuntimePackRef(): Promise<string> {
  if (runtimeCache.resolvedPackRef) return runtimeCache.resolvedPackRef
  if (runtimeCache.resolvePromise) return runtimeCache.resolvePromise

  runtimeCache.resolvePromise = (async () => {
    const explicit = (import.meta.env.VITE_PACK_REF || '').trim()
    if (explicit) return explicit

    if (isDesktop) {
      const desktopWorkspace = await resolveDesktopWorkspacePackRef()
      if (desktopWorkspace) return desktopWorkspace
    }

    return defaultPackRef()
  })()

  const resolved = await runtimeCache.resolvePromise
  runtimeCache.resolvedPackRef = resolved
  runtimeCache.resolvePromise = null
  return resolved
}

export function applyRuntimeAssetBase(packRef: string): void {
  const root = globalThis as typeof globalThis & { __ARCADIA_ASSET_BASE__?: string }
  root.__ARCADIA_ASSET_BASE__ = resolveAssetBaseFromPackRef(packRef)
}
