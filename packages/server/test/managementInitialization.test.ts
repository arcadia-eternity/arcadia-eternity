import { shippedCatalogMembers, stageShippedCatalog } from './fixtures/npm'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { openStorage } from '@arcadia-eternity/database'
import { ContentWorkspace } from '@arcadia-eternity/content-sdk/management-workspace'
import { workspaceRetentions } from '../../../bin/server-persistence'
import { initializeDesktopHost } from '../../../bin/desktop-host-initialize'
import { initializeHostEnvironment } from '../../../bin/host-environment-initialize'
import { createSingleProcessApp } from '@arcadia-eternity/server'
import type { Binding, ManagedServer } from '../src/runtime/management/service'
import { validateWorkspaceProject } from '../src/runtime/management/service'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
}, 30_000)

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-initialization-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const project = await stageShippedCatalog(directory)
  const storage = openStorage({ driver: 'sqlite', filename: join(directory, 'server.sqlite') })
  await storage.migrate()
  cleanups.push(() => storage.close())
  const workspace = await ContentWorkspace.open(join(directory, 'workspace'), {
    retentions: workspaceRetentions(storage, () => workspace.workspaceId),
  })
  cleanups.push(() => workspace.close())
  const app = createSingleProcessApp({
    serverId: 'initialization-server',
    management: {
      storage,
      workspace,
      initialization: { kind: 'desktop', environmentId: 'desktop-host' },
    },
  })
  cleanups.push(() => app.stop())
  await app.management!.ready()
  return { storage, workspace, project, management: app.management! }
}

const desktopDocument = {
  schemaVersion: 2,
  id: 'desktop-host',
  name: '本机服务器环境',
  packages: shippedCatalogMembers,
  sources: [],
  rules: { schemaVersion: 1 },
  requires: {},
}

it('records a pending marker when creating a host-managed server', async () => {
  const { storage } = await setup()
  expect((await storage.get<ManagedServer>('servers', 'initialization-server'))?.value.initialization).toMatchObject({
    kind: 'desktop',
    environmentId: 'desktop-host',
    state: 'pending',
  })
}, 30_000)

it('preserves environment rules while synchronizing a deployment project', async () => {
  const { workspace, project, management } = await setup()
  const document = {
    schemaVersion: 2,
    id: 'desktop-host',
    name: '管理员草稿',
    packages: shippedCatalogMembers,
    sources: [],
    rules: { schemaVersion: 1, team: { maxSize: 1 } },
    requires: {},
  }
  await workspace.saveDraft({ document, expectedRevision: null })
  await expect(
    initializeHostEnvironment({
      management,
      workspace,
      projectDirectory: project,
      kind: 'desktop',
      environmentId: 'desktop-host',
      name: '本机服务器环境',
      matchmakingEnabled: false,
    }),
  ).resolves.toBeUndefined()
  expect((await workspace.getDraft('desktop-host')).document).toEqual(document)
}, 30_000)

it('publishes the marker-owned binding once and completes the marker', async () => {
  const { storage, workspace, project, management } = await setup()
  await initializeDesktopHost({
    management,
    workspace,
    projectDirectory: project,
    kind: 'desktop',
  })
  const server = (await storage.get<ManagedServer>('servers', 'initialization-server'))!
  expect(server.value.initialization).toMatchObject({ state: 'completed' })
  const binding = (await storage.get<Binding>('bindings', server.value.defaultBindingId!))!
  expect(binding.value).toMatchObject({
    environmentId: 'desktop-host',
    enabled: true,
    visibility: 'public',
    matchmakingEnabled: true,
    condition: 'available',
  })
  expect(binding.value).not.toHaveProperty('effectiveInstallationId')
  await management.localRequest({
    method: 'PATCH',
    path: `/servers/initialization-server/bindings/${binding.id}`,
    headers: { 'if-match': String(binding.revision) },
    body: { matchmakingEnabled: false },
  })
  await initializeDesktopHost({ management, workspace, projectDirectory: project, kind: 'desktop' })
  expect((await storage.get<Binding>('bindings', binding.id))?.value.matchmakingEnabled).toBe(false)
}, 30_000)

it('enables matchmaking for an untouched legacy desktop default when the host reopens', async () => {
  const { storage, workspace, project, management } = await setup()
  await initializeHostEnvironment({
    management,
    workspace,
    projectDirectory: project,
    kind: 'desktop',
    environmentId: 'desktop-host',
    name: '本机服务器环境',
    matchmakingEnabled: false,
  })
  const server = (await storage.get<ManagedServer>('servers', 'initialization-server'))!
  const id = server.value.defaultBindingId!
  expect((await storage.get<Binding>('bindings', id))?.value.matchmakingEnabled).toBe(false)
  await initializeDesktopHost({ management, workspace, projectDirectory: project, kind: 'desktop' })
  expect((await storage.get<Binding>('bindings', id))?.value.matchmakingEnabled).toBe(true)
}, 30_000)

it('resumes the exact pending marker-owned binding after an interrupted initialization', async () => {
  const { storage, workspace, project, management } = await setup()
  const draft = await workspace.saveDraft({ document: desktopDocument, expectedRevision: null })
  const version = await workspace.prepareEnvironment(
    { environmentId: 'desktop-host', expectedRevision: draft.revision, directory: project },
    validateWorkspaceProject,
  )
  const claimed = (await management.ensureInitializationBinding('desktop', 'desktop-host'))!
  await expect(workspace.clearInstallation(version.installationId)).rejects.toMatchObject({
    code: 'ENVIRONMENT_IN_USE',
    references: expect.arrayContaining([expect.objectContaining({ retentionId: `binding:${claimed.id}` })]),
  })
  await initializeHostEnvironment({
    management,
    workspace,
    projectDirectory: project,
    kind: 'desktop',
    environmentId: 'desktop-host',
    name: '本机服务器环境',
    matchmakingEnabled: false,
  })
  const server = (await storage.get<ManagedServer>('servers', 'initialization-server'))!
  expect(server.value.initialization).toMatchObject({ state: 'completed', bindingId: claimed.id })
  expect((await storage.get<Binding>('bindings', claimed.id))?.value).toMatchObject({
    environmentId: 'desktop-host',
    condition: 'available',
  })
}, 30_000)

it('loads compatible current content without comparing an old preparation hash', async () => {
  const { storage, workspace, project, management } = await setup()
  const draft = await workspace.saveDraft({ document: desktopDocument, expectedRevision: null })
  await workspace.prepareEnvironment(
    { environmentId: 'desktop-host', expectedRevision: draft.revision, directory: project },
    async () => ({
      contentRevision: 'deliberately-wrong-revision',
      packages: Object.entries(shippedCatalogMembers).map(([name, version]) => ({ name, version })),
    }),
  )
  const binding = (await management.ensureInitializationBinding('desktop', 'desktop-host'))!
  await storage.replace('bindings', binding.id, binding.revision, { ...binding.value, condition: 'applying' })
  await management.reconcile()
  expect((await storage.get<Binding>('bindings', binding.id))?.value).toMatchObject({
    condition: 'available',
  })
}, 30_000)
