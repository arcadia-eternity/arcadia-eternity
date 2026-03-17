import type {
  CreatePackFromTemplateInput,
  CreatePackFromTemplateResult,
  PackTemplateSummary,
  WorkspacePackSummary,
} from '@/types/desktop'
import { getDesktopApi, isDesktop } from '@/utils/env'

export type { PackTemplateSummary, WorkspacePackSummary, CreatePackFromTemplateInput, CreatePackFromTemplateResult }

function desktopApi() {
  return getDesktopApi()
}

export async function listPackTemplates(): Promise<PackTemplateSummary[]> {
  const api = desktopApi()
  if (!api) {
    return [
      {
        id: 'starter',
        name: 'Starter Pack',
        description: '基础可运行模板，包含最小 data/locales/assets 结构',
      },
    ]
  }

  return api.listPackTemplates()
}

export async function listWorkspacePacks(): Promise<WorkspacePackSummary[]> {
  const api = desktopApi()
  if (api) {
    return api.listWorkspacePacks()
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
  const api = desktopApi()
  if (!api) {
    throw new Error('当前环境不支持本地数据包创建（仅桌面端可用）')
  }

  return api.createPackFromTemplate({
    folderName: input.folderName,
    packId: input.packId,
    version: input.version,
    template: input.template ?? 'starter',
  })
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
