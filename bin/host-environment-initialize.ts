import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { isAbsolute, relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { validateWorkspaceProject, type ManagementService } from '@arcadia-eternity/server'
import { inspectNpmProject } from '@arcadia-eternity/pack-loader/node'
import type { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'

type InitializationKind = 'builtin' | 'desktop' | 'npm'
type Initialization = {
  kind: InitializationKind
  environmentId: string
  state: 'pending' | 'completed' | 'abandoned'
  bindingId?: string
}
type Server = { id: string; revision: number; defaultBindingId?: string; initialization?: Initialization }
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
type Draft = {
  revision: string
  document: {
    id: string
    packages: Record<string, string>
    [key: string]: unknown
  }
}
type Call = <T>(method: string, path: string, body?: unknown, revision?: number) => Promise<T>

const shippedBasePackage = '@arcadia-eternity/data-pack-base'

async function publishAndWait(
  call: Call,
  serverPath: string,
  binding: Binding,
  versionId: string,
  timeoutMs: number,
): Promise<Binding> {
  if (binding.effectiveVersionId === versionId && binding.condition === 'available') return binding
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
  const updated = (await call<{ bindings: Binding[] }>('GET', `${serverPath}/bindings`)).bindings.find(
    item => item.id === binding.id,
  )
  if (!updated || updated.condition !== 'available') throw new Error('HOST_INITIALIZATION_BINDING_UNAVAILABLE')
  return updated
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
  binding = await publishAndWait(call, serverPath, binding, versionId, timeoutMs)
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

/** Replace a completed host-managed builtin environment when its captured package no longer matches this release. */
export async function refreshBuiltinEnvironment({
  management,
  workspace,
  projectDirectory,
  timeoutMs = 60_000,
}: {
  management: ManagementService
  workspace: ContentWorkspace
  projectDirectory: string
  timeoutMs?: number
}): Promise<boolean> {
  await management.ready()
  const call = async <T>(method: string, path: string, body?: unknown, revision?: number): Promise<T> => {
    const result = await management.localRequest({
      method,
      path,
      body,
      headers: {
        'idempotency-key': `host-refresh-builtin:${randomUUID()}`,
        ...(revision === undefined ? {} : { 'if-match': String(revision) }),
      },
    })
    if (result.status < 200 || result.status >= 300) throw new Error(`HOST_REFRESH_FAILED:${result.status}`)
    return result.body as T
  }
  const server = (await call<{ servers: Server[] }>('GET', '/servers')).servers[0]
  const initialization = server?.initialization
  if (
    !server ||
    initialization?.kind !== 'builtin' ||
    initialization.state !== 'completed' ||
    !initialization.bindingId ||
    server.defaultBindingId !== initialization.bindingId
  )
    return false
  const serverPath = `/servers/${encodeURIComponent(server.id)}`
  const binding = (await call<{ bindings: Binding[] }>('GET', `${serverPath}/bindings`)).bindings.find(
    item => item.id === initialization.bindingId,
  )
  // Disabling, hiding or replacing the host-managed binding is an administrator decision.
  if (!binding?.enabled || binding.visibility !== 'public' || binding.environmentId !== initialization.environmentId)
    return false
  const { members } = await inspectNpmProject(projectDirectory)
  const shipped = members.find(member => member.name === shippedBasePackage)
  if (!shipped) throw new Error('HOST_REFRESH_BASE_MISSING')
  const current = binding.effectiveVersionId
    ? await workspace.getVersion(binding.effectiveVersionId).catch(() => undefined)
    : undefined
  if (binding.condition === 'available' && current?.document.packages[shippedBasePackage] === shipped.version)
    return false
  const existing = (await workspace.listDrafts()).find(item => item.document.id === binding.environmentId)
  if (!existing) throw new Error('HOST_REFRESH_ENVIRONMENT_MISSING')
  const document = {
    ...existing.document,
    packages: { ...existing.document.packages, [shippedBasePackage]: shipped.version },
  }
  const draft = isDeepStrictEqual(document, existing.document)
    ? existing
    : await call<Draft>('PATCH', `/workspaces/${workspace.workspaceId}/environments/${binding.environmentId}`, {
        document,
        expectedRevision: existing.revision,
      })
  const version = await workspace.prepareVersion(
    { environmentId: binding.environmentId, expectedRevision: draft.revision, directory: projectDirectory },
    input =>
      validateWorkspaceProject(input, {
        effectPreparation: management.options.allowThirdPartyExecution ? 'compile' : 'prebuilt-only',
      }),
  )
  await publishAndWait(call, serverPath, binding, version.versionId, timeoutMs)
  return true
}
