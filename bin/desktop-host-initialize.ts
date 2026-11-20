import { managementScopeKey, type ManagedServer, type ManagementService } from '@arcadia-eternity/server'
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
    matchmakingEnabled: true,
    timeoutMs,
  })
  await upgradeDesktopMatchmakingDefault(management)
}

// The old initializer wrote one binding.update before completing its marker.
// Any further update might represent a deliberate opt-out, even from the local owner.
async function upgradeDesktopMatchmakingDefault(management: ManagementService) {
  const { storage, serverId } = management.options
  const server = await storage.get<ManagedServer>('servers', serverId)
  const init = server?.value.initialization
  if (
    !init ||
    init.state !== 'completed' ||
    init.kind === 'npm' ||
    !init.bindingId ||
    init.bindingId !== server?.value.defaultBindingId
  )
    return
  const binding = await management.initializationBinding(init.kind, init.environmentId)
  if (!binding || binding.value.matchmakingEnabled || !binding.value.enabled || binding.value.visibility !== 'public')
    return
  const audit = await storage.list<{ action: string; target?: string; actor: string }>(
    'audit',
    managementScopeKey(management.serverScope),
  )
  const edits = audit.filter(entry => entry.value.action === 'binding.update' && entry.value.target === binding.id)
  if (edits.length !== 1 || edits[0]?.value.actor !== 'local-owner:' + serverId) return
  const result = await management.localRequest({
    method: 'PATCH',
    path: `/servers/${serverId}/bindings/${binding.id}`,
    headers: { 'if-match': String(binding.revision) },
    body: { matchmakingEnabled: true },
  })
  if (result.status >= 400 && result.status !== 412) throw new Error('DESKTOP_MATCHMAKING_UPGRADE_FAILED')
}
