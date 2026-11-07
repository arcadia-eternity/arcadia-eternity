import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { isAbsolute, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { validateWorkspaceProject, type ManagementService } from '@arcadia-eternity/server'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import type { ContentWorkspace } from '@arcadia-eternity/content-dev/management-workspace'

type InitializationKind = 'builtin' | 'desktop' | 'npm'
type Server = { id: string; revision: number; defaultBindingId?: string }
type Binding = {
  id: string
  revision: number
  environmentId: string
  effectiveVersionId?: string
  condition: string
  enabled: boolean
  visibility: string
  matchmakingEnabled: boolean
}

/** Complete only an explicitly persisted host first-run marker, never an empty configuration. */
export async function initializeHostEnvironment({
  management,
  workspace,
  projectDirectory,
  kind,
  environmentId,
  name,
  matchmakingEnabled,
  timeoutMs = 60_000,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  kind: InitializationKind
  environmentId: string
  name: string
  matchmakingEnabled: boolean
  timeoutMs?: number
}): Promise<void> {
  await management.ready()
  const pending = await management.pendingInitializationInfo()
  if (pending && (pending.kind !== kind || pending.environmentId !== environmentId))
    throw new Error(`HOST_INITIALIZATION_SOURCE_CHANGED:${pending.kind}:${pending.environmentId}`)
  if (!(await management.pendingInitialization(kind, environmentId))) return
  const call = async <T>(method: string, path: string, body?: unknown, revision?: number) => {
    const result = await management.localRequest({
      method,
      path,
      body,
      headers: {
        'idempotency-key': `host-initialize:${kind}:${randomUUID()}`,
        ...(revision === undefined ? {} : { 'if-match': String(revision) }),
      },
    })
    if (result.status < 200 || result.status >= 300) throw new Error(`HOST_INITIALIZATION_FAILED:${result.status}`)
    return result.body as T
  }
  let server = (await call<{ servers: Server[] }>('GET', '/servers')).servers[0]
  if (!server) throw new Error('HOST_INITIALIZATION_SERVER_NOT_FOUND')
  const serverPath = `/servers/${encodeURIComponent(server.id)}`
  const recoveredBinding = await management.initializationBinding(kind, environmentId)
  let versionId = recoveredBinding?.value.desiredVersionId ?? recoveredBinding?.value.effectiveVersionId
  if (!versionId) {
    const { members } = await inspectNpmProject(projectDirectory)
    const packages = Object.fromEntries(members.map(({ name, version }) => [name, version]))
    const existing = (await workspace.listDrafts()).find(item => item.document.id === environmentId)
    const document = {
      schemaVersion: 2,
      id: environmentId,
      name,
      packages,
      sources: [],
      rules: { schemaVersion: 1 },
      requires: {},
    }
    if (existing && !isDeepStrictEqual(existing.document, document))
      throw new Error('HOST_INITIALIZATION_ENVIRONMENT_CONFLICT')
    const draft = existing
      ? { revision: existing.revision }
      : await call<{ revision: string }>('POST', `/workspaces/${workspace.workspaceId}/environments`, {
          document,
          expectedRevision: null,
        })
    const relativeProject = relative(workspace.root, projectDirectory)
    const shared =
      relativeProject &&
      !isAbsolute(relativeProject) &&
      relativeProject !== '..' &&
      !relativeProject.startsWith('../') &&
      !relativeProject.startsWith('..\\')
    const version = await workspace[shared ? 'adoptVersion' : 'prepareVersion'](
      { environmentId, expectedRevision: draft.revision, directory: projectDirectory },
      input =>
        validateWorkspaceProject(input, {
          effectPreparation: management.options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only',
        }),
    )
    versionId = version.versionId
  }
  const owned = recoveredBinding ?? (await management.ensureInitializationBinding(kind, environmentId, versionId))
  if (!owned) return
  let binding: Binding = { id: owned.id, revision: owned.revision, ...owned.value }
  if (server.defaultBindingId && server.defaultBindingId !== binding.id) {
    await management.abandonInitialization(kind, environmentId)
    return
  }
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
        throw new Error(state.error?.code ?? `HOST_PUBLISH_${state.status.toUpperCase()}`)
      if (Date.now() >= deadline) throw new Error('HOST_PUBLISH_TIMEOUT')
      await setTimeout(20)
    }
    binding = (await call<{ bindings: Binding[] }>('GET', `${serverPath}/bindings`)).bindings.find(
      item => item.id === binding.id,
    )!
    if (!binding || binding.condition !== 'available') throw new Error('HOST_INITIALIZATION_BINDING_UNAVAILABLE')
  }
  if (!binding.enabled || binding.visibility !== 'public' || binding.matchmakingEnabled !== matchmakingEnabled)
    binding = await call<Binding>(
      'PATCH',
      `${serverPath}/bindings/${binding.id}`,
      { enabled: true, visibility: 'public', matchmakingEnabled },
      binding.revision,
    )
  server = (await call<{ servers: Server[] }>('GET', '/servers')).servers[0]!
  if (!server.defaultBindingId) await call('PATCH', serverPath, { defaultBindingId: binding.id }, server.revision)
  else if (server.defaultBindingId !== binding.id) {
    await management.abandonInitialization(kind, environmentId)
    return
  }
  await management.completeInitialization(kind, environmentId, binding.id)
}
