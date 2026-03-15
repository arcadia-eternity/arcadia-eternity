import { isTauri } from '@/utils/env'

export interface PackTemplateSummary {
  id: string
  name: string
  description: string
}

export interface WorkspacePackSummary {
  folderName: string
  id: string
  version: string
  manifestPath: string
}

export interface CreatePackFromTemplateInput {
  folderName: string
  packId?: string
  version?: string
  template?: string
}

export interface CreatePackFromTemplateResult {
  folderName: string
  packId: string
  version: string
  packPath: string
  createdFiles: string[]
}

type TauriInvoke = typeof import('@tauri-apps/api/core').invoke

async function loadTauriInvoke(): Promise<TauriInvoke | null> {
  if (!isTauri) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke
  } catch {
    return null
  }
}

export async function listPackTemplates(): Promise<PackTemplateSummary[]> {
  const invoke = await loadTauriInvoke()
  if (!invoke) {
    return [
      {
        id: 'starter',
        name: 'Starter Pack',
        description: '基础可运行模板，包含最小 data/locales/assets 结构',
      },
    ]
  }
  return invoke<PackTemplateSummary[]>('list_pack_templates')
}

export async function listWorkspacePacks(): Promise<WorkspacePackSummary[]> {
  const invoke = await loadTauriInvoke()
  if (invoke) {
    return invoke<WorkspacePackSummary[]>('list_workspace_packs')
  }

  try {
    const response = await fetch('/packs/workspace/index.json')
    if (!response.ok) return []
    const json = await response.json()
    if (!Array.isArray(json)) return []
    return json as WorkspacePackSummary[]
  } catch {
    return []
  }
}

export async function createPackFromTemplate(
  input: CreatePackFromTemplateInput,
): Promise<CreatePackFromTemplateResult> {
  const invoke = await loadTauriInvoke()
  if (!invoke) {
    throw new Error('当前环境不支持本地数据包创建（仅 Tauri 可用）')
  }

  return invoke<CreatePackFromTemplateResult>('create_pack_from_template', {
    input: {
      folderName: input.folderName,
      packId: input.packId,
      version: input.version,
      template: input.template ?? 'starter',
    },
  })
}

export async function resolveWorkspaceFileUrl(relativePath: string): Promise<string> {
  const cleaned = relativePath.replace(/^\/+/, '')
  const invoke = await loadTauriInvoke()
  if (invoke) {
    try {
      const port = await invoke<number | null>('get_local_server_port')
      if (port && Number.isFinite(port) && port > 0) {
        return `http://127.0.0.1:${port}/${cleaned}`
      }
    } catch {
      // fallback to relative URL for non-tauri or unavailable local server
    }
  }
  return `/${cleaned}`
}
