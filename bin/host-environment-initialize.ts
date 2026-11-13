import { randomUUID } from 'node:crypto'
import { validateWorkspaceProject, type ManagementService } from '@arcadia-eternity/server'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import type { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'

/** A deployment-owned npm project is synchronized on every start. There is no
 * historical publication pointer; administrator binding policy remains independent. */
export async function initializeHostEnvironment({
  management,
  workspace,
  projectDirectory,
  kind,
  environmentId,
  name,
  matchmakingEnabled,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  kind: 'builtin' | 'desktop' | 'npm'
  environmentId: string
  name: string
  matchmakingEnabled: boolean
  timeoutMs?: number
}): Promise<void> {
  await management.ready()
  const pending = await management.pendingInitialization(kind, environmentId)
  const owned = await management.initializationBinding(kind, environmentId)
  if (!pending && !owned) return
  const existing = (await workspace.listDrafts()).find(item => item.document.id === environmentId)
  const { members } = await inspectNpmProject(projectDirectory)
  const document = {
    schemaVersion: 2 as const,
    id: environmentId,
    name,
    ...(existing?.document ?? {}),
    packages: Object.fromEntries(members.map(({ name, version }) => [name, version])),
    sources: [],
    rules: existing?.document.rules ?? { schemaVersion: 1 as const },
    requires: existing?.document.requires ?? {},
  }
  const draft = await workspace.saveDraft({ document, expectedRevision: existing?.revision ?? null })
  await workspace.prepareEnvironment({ environmentId, expectedRevision: draft.revision, projectDirectory }, input =>
    validateWorkspaceProject(input, {
      effectPreparation: management.options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only',
    }),
  )
  const binding = owned ?? (await management.ensureInitializationBinding(kind, environmentId))
  if (!binding) return
  await management.reconcile()
  if (!pending) return
  const call = async (method: string, path: string, body: unknown, revision: number) => {
    const result = await management.localRequest({
      method,
      path,
      body,
      headers: {
        'if-match': String(revision),
        'idempotency-key': randomUUID(),
      },
    })
    if (result.status < 200 || result.status >= 300) throw new Error(`HOST_INITIALIZATION_FAILED:${result.status}`)
  }
  const serverId = management.options.serverId
  const current = await management.options.storage.get('bindings', binding.id)
  if (!current) throw new Error('HOST_INITIALIZATION_BINDING_NOT_FOUND')
  await call(
    'PATCH',
    `/servers/${serverId}/bindings/${binding.id}`,
    {
      enabled: true,
      visibility: 'public',
      matchmakingEnabled,
    },
    current.revision,
  )
  const server = await management.options.storage.get<{ defaultBindingId?: string }>('servers', serverId)
  if (!server) throw new Error('HOST_INITIALIZATION_SERVER_NOT_FOUND')
  if (server.value.defaultBindingId && server.value.defaultBindingId !== binding.id) {
    await management.abandonInitialization(kind, environmentId)
    return
  }
  if (!server.value.defaultBindingId)
    await call('PATCH', `/servers/${serverId}`, { defaultBindingId: binding.id }, server.revision)
  await management.completeInitialization(kind, environmentId, binding.id)
}
