import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox'
import type {
  buildDisplayCatalog,
  buildDisplayLocales,
  environmentVersion,
  gameplayRevision,
  mapPresentationResources,
} from '@arcadia-eternity/pack-loader/native'
import type { NpmContentHost, prepareNpmProject } from '@arcadia-eternity/pack-loader/node'
import type { NativeRuntimeIdentity, ServerEnvironmentDescriptor } from '@arcadia-eternity/protocol'
import type { PresentationResource, ResourceReference } from '@arcadia-eternity/schema'

export interface LocalContentRuntime {
  host: NpmContentHost
  prepareNpmProject: typeof prepareNpmProject
  gameplayRevision: typeof gameplayRevision
  environmentVersion: typeof environmentVersion
  buildDisplayCatalog: typeof buildDisplayCatalog
  buildDisplayLocales: typeof buildDisplayLocales
  mapPresentationResources: typeof mapPresentationResources
}

interface ProjectLease {
  directory: string
  document?: { id: string; name: string; rules?: unknown; requires?: unknown }
  draftRevision?: string
  release(): Promise<void>
}

interface LocalContentOptions {
  library: { acquireProject(environmentId?: string): Promise<ProjectLease> }
  load(): Promise<LocalContentRuntime>
  assetUrl(token: string, hash: string): string
}

type PreparedProject = Awaited<ReturnType<typeof prepareNpmProject>>
type DisplayCatalog = ReturnType<typeof buildDisplayCatalog> & { locales: ReturnType<typeof buildDisplayLocales> }

interface ContentSession {
  files: Map<string, { file: string; mime: string }>
  prepared: PreparedProject
  lease: ProjectLease
  owner?: string
  environment: SandboxEnvironment
  runtimeIdentity: NativeRuntimeIdentity
  packages: ServerEnvironmentDescriptor['packages']
}

/** Static preparation only: author modules are compiled by the loader, never evaluated here. */
export function createLocalContentSessions({ library, load, assetUrl }: LocalContentOptions) {
  const sessions = new Map<string, ContentSession>()
  const cache = new Map<string, PreparedProject>()
  const retired = new Set<PreparedProject>()
  const pending = new Map<string, Promise<PreparedProject>>()
  const catalogs = new WeakMap<PreparedProject, DisplayCatalog>()
  const operations = new Set<Promise<unknown>>()
  const retiredOwners = new Set<string>()
  let closed = false
  let closing: Promise<void> | undefined
  const assertOpen = () => {
    if (closed) throw new Error('LOCAL_CONTENT_CLOSED')
  }
  let activeDirectory: string | undefined
  async function collect() {
    const held = new Set([...sessions.values()].map(session => session.prepared))
    for (const prepared of [...retired])
      if (!held.has(prepared)) {
        retired.delete(prepared)
        await prepared.dispose()
      }
    const idle = [...cache].filter(([directory, prepared]) => directory !== activeDirectory && !held.has(prepared))
    for (const [directory, prepared] of idle.slice(0, Math.max(0, idle.length - 2))) {
      cache.delete(directory)
      await prepared.dispose()
    }
  }
  function compileProject(directory: string, refresh = false): Promise<PreparedProject> {
    assertOpen()
    if (!directory) throw new Error('LOCAL_ENVIRONMENT_NOT_PREPARED')
    const compiling = pending.get(directory)
    if (compiling) return compiling
    const cached = cache.get(directory)
    if (!refresh && cached) return Promise.resolve(cached)
    const task = (async () => {
      const runtime = await load()
      assertOpen()
      const prepared = await runtime.prepareNpmProject(directory, runtime.host, {
        policy: { profile: 'local-development' },
      })
      if (closed) {
        await prepared.dispose()
        throw new Error('LOCAL_CONTENT_CLOSED')
      }
      const previous = cache.get(directory)
      cache.set(directory, prepared)
      if (previous) retired.add(previous)
      return prepared
    })().finally(() => {
      pending.delete(directory)
    })
    pending.set(directory, task)
    return task
  }
  async function prepare(
    owner?: string,
    {
      displayOnly = false,
      environmentId,
    }: {
      displayOnly?: boolean
      environmentId?: string
    } = {},
  ) {
    assertOpen()
    if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
    const acquired = await library.acquireProject(environmentId)
    let leaseReleased = false
    const lease = {
      ...acquired,
      release: async () => {
        if (!leaseReleased) {
          leaseReleased = true
          await acquired.release()
        }
      },
    }
    try {
      const runtime = await load()
      const prepared = await compileProject(lease.directory)
      assertOpen()
      if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      if (!prepared.sandbox) throw new Error('LOCAL_SANDBOX_MISSING')
      const token = randomUUID()
      const files: ContentSession['files'] = new Map()
      const resources = new Map<string, string>()
      const resourceIndex: PresentationResource[] = []
      for (const pkg of prepared.presentation) {
        const filesById = new Map(pkg.resources.map(resource => [resource.id, resource]))
        for (const resource of pkg.manifest.resources) {
          const id = pkg.namespace ? `${pkg.namespace}:${resource.id}` : resource.id
          let source = resource.source
          if (resource.kind === 'file') {
            const file = filesById.get(resource.id)
            if (!file) throw new Error(`LOCAL_RESOURCE_MISSING: ${id}`)
            files.set(resource.sha256, { file: file.file, mime: resource.mime })
            source = assetUrl(token, resource.sha256)
          }
          resources.set(`${pkg.namespace}:${resource.id}`, source)
          resourceIndex.push({ ...resource, id, source })
        }
      }
      for (const release of prepared.releases)
        for (const asset of release.assets) {
          const file = prepared.assetFile(asset.sha256)
          if (file) files.set(asset.sha256, { file, mime: asset.mime })
        }
      let catalog = catalogs.get(prepared)
      if (!catalog) {
        const display = runtime.buildDisplayCatalog(prepared.data, [], prepared.presentation)
        catalog = { ...display, locales: runtime.buildDisplayLocales(prepared.presentation, {}, display) }
        catalogs.set(prepared, catalog)
      }
      const content = structuredClone(catalog)
      const resolveResource = (owner: string, ref: ResourceReference) => {
        if (!ref) return ref
        if (typeof ref === 'string' && /^https?:\/\//.test(ref)) return ref
        const namespace = typeof ref === 'object' ? ref.namespace : owner.includes(':') ? owner.split(':', 1)[0] : ''
        const id = typeof ref === 'object' ? ref.id : ref
        const url =
          resources.get(`${namespace === 'base' ? '' : namespace}:${id}`) ?? resources.get(`${namespace}:${id}`)
        if (!url) {
          // Official media already uses the host's public/static paths.
          if (!owner.includes(':') && typeof ref === 'string') return ref
          throw new Error(`LOCAL_RESOURCE_MISSING: ${namespace}:${id}`)
        }
        return url
      }
      for (const kind of ['species', 'skills', 'marks'] as const)
        for (const row of content[kind])
          if (row.presentation)
            row.presentation = runtime.mapPresentationResources(row.presentation, ref => resolveResource(row.id, ref))
      const { prepareEnvironmentRules, assertEnvironmentRequirements } =
        await import('@arcadia-eternity/content-sdk/environment-rules')
      assertEnvironmentRequirements(lease.document?.requires)
      const { rules } = prepareEnvironmentRules(lease.document?.rules, prepared.sandbox.data?.ruleSets)
      const result = {
        token,
        rules,
        environmentId: lease.document?.id,
        environmentName: lease.document?.name,
        draftRevision: lease.draftRevision,
        ...(displayOnly ? {} : { environment: prepared.sandbox }),
        content,
        resources: resourceIndex,
      }
      const runtimeIdentity: NativeRuntimeIdentity = {
        kind: 'native-v4',
        contentRevision: prepared.revision,
        coreBuildId: prepared.build.coreBuildId,
        registryBuildId: prepared.build.registryBuildId,
      }
      const gameplayRevision = await runtime.gameplayRevision(runtimeIdentity, prepared.sandbox.revision, rules)
      const environmentVersion = prepared.presentationRevision
        ? runtime.environmentVersion(gameplayRevision, prepared.presentationRevision)
        : undefined
      const members = prepared.installation.members
      const packages = members.map(({ name, version, projectId, namespace }) => ({
        name,
        version,
        projectId,
        namespace,
      }))
      sessions.set(token, { files, prepared, lease, owner, environment: prepared.sandbox, runtimeIdentity, packages })
      // Acquiring a fixed old configuration must not change the library's current selection.
      if (activeDirectory === undefined) activeDirectory = lease.directory
      await collect()
      assertOpen()
      if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      return { ...result, gameplayRevision, ...(prepared.presentationRevision ? { environmentVersion } : {}), packages }
    } catch (error) {
      await lease.release()
      throw error
    }
  }
  async function release(token: string) {
    const session = sessions.get(token)
    if (!session) return
    sessions.delete(token)
    await session.lease.release()
    await collect()
  }
  /** Explicit sharing copies only already captured package media, never arbitrary caller paths. */
  async function capturePersonalEnvironment(owner?: string, environmentId?: string) {
    const captured = await prepare(owner, { environmentId })
    try {
      const { mapPresentationResources } = await load()
      const session = sessions.get(captured.token)
      if (!session || session.owner !== owner) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      const content = structuredClone(captured.content)
      const known = new Map([...session.files.keys()].map(id => [assetUrl(captured.token, id), id]))
      const referenced = new Set<string>()
      const used = new Set<ResourceReference>()
      const resource = <T extends ResourceReference>(value: T): T | string => {
        used.add(value)
        const id = typeof value === 'string' ? known.get(value) : undefined
        if (!id) return value
        referenced.add(id)
        return `arcadia-resource:${id}`
      }
      for (const kind of ['species', 'skills', 'marks'] as const)
        for (const row of content[kind])
          if (row.presentation) row.presentation = mapPresentationResources(row.presentation, resource)
      const media = captured.resources
        .filter(
          row =>
            row.tags?.some(tag => tag === 'background' || tag === 'music' || tag.startsWith('battle-ui:')) ||
            used.has(row.source),
        )
        .map(row => ({
          id: row.id,
          source: resource(row.source),
          ...(row.sha256 && { sha256: row.sha256 }),
          ...(row.tags && { tags: row.tags }),
        }))
      const assets = []
      let bytes = 0
      for (const id of referenced) {
        assertOpen()
        if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
        const file = session.files.get(id)!
        const handle = await open(file.file, 'r')
        try {
          const stat = await handle.stat()
          if (!stat.isFile() || stat.size > 64 * 1024 * 1024 || bytes + stat.size > 64 * 1024 * 1024)
            throw new Error('LOCAL_SHARE_TOO_LARGE')
          const data = await handle.readFile()
          bytes += data.length
          if (bytes > 64 * 1024 * 1024) throw new Error('LOCAL_SHARE_TOO_LARGE')
          assets.push({ id, mime: file.mime, data: data.toString('base64') })
        } finally {
          await handle.close()
        }
      }
      assertOpen()
      if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      return {
        environment: session.environment,
        rules: captured.rules,
        content,
        runtime: session.runtimeIdentity,
        packages: session.packages,
        assets,
        media,
      }
    } finally {
      await release(captured.token)
    }
  }
  async function prepareProject({ directory }: { directory: string }) {
    await compileProject(directory, true)
    await collect()
  }
  function selectProject({ directory }: { directory: string }) {
    activeDirectory = directory
    void collect().catch(() => {})
  }
  async function releaseOwner(owner: string) {
    retiredOwners.add(owner)
    await Promise.all(
      [...sessions.entries()].filter(([, session]) => session.owner === owner).map(([token]) => release(token)),
    )
  }
  function tracked<Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) {
    return (...args: Args) => {
      const operation = fn(...args)
      operations.add(operation)
      operation.then(
        () => operations.delete(operation),
        () => operations.delete(operation),
      )
      return operation
    }
  }
  async function close() {
    if (closing) return closing
    closed = true
    closing = (async () => {
      await Promise.allSettled([...operations, ...pending.values()])
      await Promise.all([...sessions.keys()].map(release))
      const prepared = new Set([...cache.values(), ...retired])
      cache.clear()
      retired.clear()
      await Promise.all([...prepared].map(item => item.dispose()))
    })()
    return closing
  }
  return {
    prepare: tracked(prepare),
    readRuntime(token: string, owner?: string) {
      const session = sessions.get(token)
      if (!session || session.owner !== owner) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      return session.environment
    },
    capturePersonalEnvironment: tracked(capturePersonalEnvironment),
    prepareProject: tracked(prepareProject),
    selectProject,
    release,
    releaseOwner,
    assetFile: (token: string, id: string) => sessions.get(token)?.files.get(id),
    close,
  }
}
