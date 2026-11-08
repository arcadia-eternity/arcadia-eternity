import type { WorkspacePackSummary } from '@/types/desktop'
import { getDesktopApi, isDesktop } from '@/utils/env'
export type { WorkspacePackSummary }

function desktopApi() {
  return getDesktopApi()
}

const BASE_PACK_ID = 'arcadia-eternity.base'

function normalizeWorkspacePackSummary(item: unknown): WorkspacePackSummary {
  const source = (item ?? {}) as Record<string, unknown>
  const id = String(source.id ?? '')
  return {
    folderName: String(source.folderName ?? ''),
    id,
    version: String(source.version ?? ''),
    manifestPath: String(source.manifestPath ?? ''),
    enabled: source.enabled !== false,
    canDisable: typeof source.canDisable === 'boolean' ? source.canDisable : id !== BASE_PACK_ID,
  }
}

export async function listWorkspacePacks(): Promise<WorkspacePackSummary[]> {
  const api = desktopApi()
  if (api) {
    const result = await api.listWorkspacePacks()
    return Array.isArray(result) ? result.map(normalizeWorkspacePackSummary) : []
  }

  try {
    const response = await fetch('/packs/workspace/index.json')
    if (!response.ok) return []
    const json = await response.json()
    if (!Array.isArray(json)) return []
    return json.map(item => normalizeWorkspacePackSummary(item))
  } catch {
    return []
  }
}

export async function resolveWorkspaceFileUrl(relativePath: string): Promise<string> {
  const cleaned = relativePath.replace(/^\/+/, '')

  if (isDesktop) {
    const api = desktopApi()
    if (api) {
      try {
        const port = await api.getLocalServerPort()
        if (port && Number.isFinite(port) && port > 0) {
          return `http://127.0.0.1:${port}/${cleaned}`
        }
      } catch {
        // fallback for unavailable local server
      }
    }
  }

  return `/${cleaned}`
}
