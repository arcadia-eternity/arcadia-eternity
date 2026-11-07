import type { ManagementService } from '@arcadia-eternity/server'
import type { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'
import { initializeHostEnvironment } from './host-environment-initialize'

/** Clearing a desktop default later is an administrator decision, not a re-bootstrap request. */
export async function initializeDesktopHost({
  management,
  workspace,
  projectDirectory,
  kind,
  timeoutMs,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  kind: 'builtin' | 'desktop'
  timeoutMs?: number
}): Promise<void> {
  await initializeHostEnvironment({
    management,
    workspace,
    projectDirectory,
    kind,
    environmentId: 'desktop-host',
    name: '本机服务器环境',
    matchmakingEnabled: false,
    timeoutMs,
  })
}
