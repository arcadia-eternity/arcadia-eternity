import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { isAbsolute, relative } from 'node:path'
import { validateWorkspaceProject, type ManagementService } from '@arcadia-eternity/server'
import type { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'

type Server = { id: string; revision: number; defaultBindingId?: string }
type Binding = {
  id: string
  revision: number
  environmentId: string
  effectiveVersionId?: string
  condition: string
  enabled: boolean
  visibility: string
}

/** Initialize a first desktop host from existing client materials. A persisted
 * server selection always wins over subsequent changes to the client's selection.
 */
export async function initializeDesktopHost({
  management,
  workspace,
  projectDirectory,
  timeoutMs = 60_000,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  timeoutMs?: number
}): Promise<void> {
  await management.ready()
  const call = async <T>(method: string, path: string, body?: unknown, revision?: number) => {
    const result = await management.localRequest({
      method,
      path,
      body,
      headers: {
        'idempotency-key': `desktop-initialize:${randomUUID()}`,
        ...(revision === undefined ? {} : { 'if-match': String(revision) }),
      },
    })
    if (result.status < 200 || result.status >= 300) throw new Error(`DESKTOP_INITIALIZATION_FAILED:${result.status}`)
    return result.body as T
  }
  let server = (await call<{ servers: Server[] }>('GET', '/servers')).servers[0]
  if (!server) throw new Error('DESKTOP_SERVER_NOT_FOUND')
  if (server.defaultBindingId) return
  const serverPath = `/servers/${encodeURIComponent(server.id)}`
  const bindings = (await call<{ bindings: Binding[] }>('GET', `${serverPath}/bindings`)).bindings
  const environmentId = 'desktop-host'
  let binding = bindings.find(item => item.environmentId === environmentId)
  // Respect manually created configurations; only recover our own interrupted
  // first-run initialization, never silently select another administrator's binding.
  if (bindings.length && !binding) return
  let versionId = binding?.effectiveVersionId
  if (!versionId) {
    const listed = await workspace.listVersions(environmentId)
    const ready = listed.filter(item => item.status === 'ready').sort((a, b) => b.createdAt - a.createdAt)
    versionId = ready[0]?.versionId
  }
  if (!versionId) {
    const prepared = await validateWorkspaceProject({ directory: projectDirectory })
    const packages: Record<string, string> = {}
    for (const pkg of prepared.packages ?? []) {
      if (typeof pkg.name === 'string' && typeof pkg.version === 'string') packages[pkg.name] = pkg.version
    }
    const existing = (await workspace.listDrafts()).find(item => item.document.id === environmentId)
    const draft = await call<{ revision: string }>('POST', `/workspaces/${workspace.workspaceId}/environments`, {
      document: {
        schemaVersion: 2,
        id: environmentId,
        name: '本机服务器环境',
        packages,
        sources: [],
        rules: { schemaVersion: 1 },
        requires: {},
      },
      expectedRevision: existing?.revision ?? null,
    })
    const relativeProject = relative(workspace.root, projectDirectory)
    const shared =
      relativeProject && !isAbsolute(relativeProject) && relativeProject !== '..' && !relativeProject.startsWith('../')
    const version = await workspace[shared ? 'adoptVersion' : 'prepareVersion'](
      { environmentId, expectedRevision: draft.revision, directory: projectDirectory },
      validateWorkspaceProject,
    )
    versionId = version.versionId
  }
  if (!binding) binding = await call<Binding>('POST', `${serverPath}/bindings`, { environmentId, versionId })
  if (binding.effectiveVersionId !== versionId || binding.condition !== 'available') {
    const operation = await call<{ id: string }>(
      'POST',
      `${serverPath}/bindings/${binding.id}/publish`,
      { versionId },
      binding.revision,
    )
    const deadline = Date.now() + timeoutMs
    while (true) {
      const state = await call<{ status: string; error?: { code?: string } }>('GET', `/operations/${operation.id}`)
      if (state.status === 'succeeded') break
      if (!['queued', 'running'].includes(state.status))
        throw new Error(state.error?.code ?? `DESKTOP_PUBLISH_${state.status.toUpperCase()}`)
      if (Date.now() >= deadline) throw new Error('DESKTOP_PUBLISH_TIMEOUT')
      await setTimeout(20)
    }
    binding = (await call<{ bindings: Binding[] }>('GET', `${serverPath}/bindings`)).bindings.find(
      item => item.id === binding!.id,
    )
    if (!binding || binding.condition !== 'available') throw new Error('DESKTOP_BINDING_UNAVAILABLE')
  }
  if (!binding.enabled || binding.visibility !== 'public')
    binding = await call<Binding>(
      'PATCH',
      `${serverPath}/bindings/${binding.id}`,
      { enabled: true, visibility: 'public' },
      binding.revision,
    )
  server = (await call<{ servers: Server[] }>('GET', '/servers')).servers[0]!
  if (!server.defaultBindingId) await call('PATCH', serverPath, { defaultBindingId: binding.id }, server.revision)
}
