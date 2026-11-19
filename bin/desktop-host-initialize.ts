import type { ManagementService } from '@arcadia-eternity/server'
import type { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { initializeHostEnvironment } from './host-environment-initialize'

/** Clearing a desktop default later is an administrator decision, not a re-bootstrap request. */
export async function initializeDesktopHost({
  management,
  workspace,
  projectDirectory,
  kind,
  timeoutMs,
  builtinId,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  kind: 'builtin' | 'desktop'
  builtinId?: string
  timeoutMs?: number
}): Promise<void> {
  await initializeHostEnvironment({
    management,
    workspace,
    projectDirectory,
    kind,
    environmentId: kind === 'builtin' && builtinId ? builtinId : 'desktop-host',
    name: kind === 'builtin' && builtinId ? '默认环境' : '本机服务器环境',
    matchmakingEnabled: false,
    timeoutMs,
  })
}
