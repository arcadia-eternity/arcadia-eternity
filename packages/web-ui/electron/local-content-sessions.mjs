import { randomUUID } from 'node:crypto'
import { open } from 'node:fs/promises'

/** Static preparation only: author modules are compiled by the loader, never evaluated here. */
export function createLocalContentSessions({ library, load, assetUrl }) {
  const sessions = new Map()
  const cache = new Map()
  const retired = new Set()
  const pending = new Map()
  const catalogs = new WeakMap()
  const operations = new Set()
  const retiredOwners = new Set()
  let closed = false
  let closing
  const assertOpen = () => {
    if (closed) throw new Error('LOCAL_CONTENT_CLOSED')
  }
  let activeDirectory
  async function collect() {
    const held = new Set([...sessions.values()].map(session => session.prepared))
    for (const prepared of [...retired])
      if (!held.has(prepared)) {
        retired.delete(prepared)
        await prepared.dispose()
      }
    const idle = [...cache.keys()].filter(directory => directory !== activeDirectory && !held.has(cache.get(directory)))
    for (const directory of idle.slice(0, Math.max(0, idle.length - 2))) {
      const prepared = cache.get(directory)
      cache.delete(directory)
      await prepared.dispose()
    }
  }
  function compileProject(directory, refresh = false) {
    assertOpen()
    if (!directory) throw new Error('LOCAL_ENVIRONMENT_NOT_PREPARED')
    if (pending.has(directory)) return pending.get(directory)
    if (!refresh && cache.has(directory)) return Promise.resolve(cache.get(directory))
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
  async function prepare(owner, { displayOnly = false } = {}) {
    assertOpen()
    if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
    const acquired = await library.acquireProject()
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
      const files = new Map()
      const resources = new Map()
      for (const pkg of prepared.presentation) {
        for (const resource of pkg.manifest.resources) {
          if (resource.kind === 'http') resources.set(`${pkg.namespace}:${resource.id}`, resource.source)
        }
        for (const resource of pkg.resources) {
          files.set(resource.sha256, { file: resource.file, mime: resource.mime })
          resources.set(`${pkg.namespace}:${resource.id}`, assetUrl(token, resource.sha256))
        }
      }
      for (const release of prepared.releases)
        for (const asset of release.assets) {
          const file = prepared.assetFile(asset.sha256)
          if (file) files.set(asset.sha256, { file, mime: asset.mime })
        }
      let catalog = catalogs.get(prepared)
      if (!catalog) {
        catalog = runtime.buildDisplayCatalog(prepared.data, [], prepared.presentation)
        catalog.locales = runtime.buildDisplayLocales(prepared.presentation, {}, catalog)
        catalogs.set(prepared, catalog)
      }
      const content = structuredClone(catalog)
      const resolveResource = (owner, ref) => {
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
      for (const kind of ['species', 'skills', 'marks'])
        for (const row of content[kind]) {
          const p = row.presentation
          if (!p) continue
          for (const key of ['icon', 'portrait', 'cry', 'sfx', 'background', 'music'])
            if (p[key]) p[key] = resolveResource(row.id, p[key])
          if (p.battle)
            for (const key of ['source', 'fallback'])
              if (p.battle[key]) p.battle[key] = resolveResource(row.id, p.battle[key])
        }
      const result = { token, ...(displayOnly ? {} : { environment: prepared.sandbox }), content }
      const runtimeIdentity = {
        kind: 'native-v4',
        contentRevision: prepared.revision,
        coreBuildId: prepared.build.coreBuildId,
        registryBuildId: prepared.build.registryBuildId,
      }
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
      return result
    } catch (error) {
      await lease.release()
      throw error
    }
  }
  async function release(token) {
    const session = sessions.get(token)
    if (!session) return
    sessions.delete(token)
    await session.lease.release()
    await collect()
  }
  /** Explicit sharing copies only already captured package media, never arbitrary caller paths. */
  async function capturePersonalEnvironment(owner) {
    const captured = await prepare(owner)
    try {
      const session = sessions.get(captured.token)
      if (!session || session.owner !== owner) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      const content = structuredClone(captured.content)
      const known = new Map([...session.files.keys()].map(id => [assetUrl(captured.token, id), id]))
      const referenced = new Set()
      const resource = value => {
        const id = known.get(value)
        if (!id) return value
        referenced.add(id)
        return `arcadia-resource:${id}`
      }
      for (const kind of ['species', 'skills', 'marks'])
        for (const row of content[kind]) {
          const p = row.presentation
          if (!p) continue
          for (const key of ['icon', 'portrait', 'cry', 'sfx', 'background', 'music'])
            if (p[key]) p[key] = resource(p[key])
          if (p.battle)
            for (const key of ['source', 'fallback']) if (p.battle[key]) p.battle[key] = resource(p.battle[key])
        }
      const assets = []
      let bytes = 0
      for (const id of referenced) {
        assertOpen()
        if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
        const file = session.files.get(id)
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
        environment: captured.environment,
        content,
        runtime: session.runtimeIdentity,
        packages: session.packages,
        assets,
      }
    } finally {
      await release(captured.token)
    }
  }
  async function prepareProject({ directory }) {
    await compileProject(directory, true)
    await collect()
  }
  function selectProject({ directory }) {
    activeDirectory = directory
    void collect().catch(() => {})
  }
  async function releaseOwner(owner) {
    retiredOwners.add(owner)
    await Promise.all(
      [...sessions.entries()].filter(([, session]) => session.owner === owner).map(([token]) => release(token)),
    )
  }
  function tracked(fn) {
    return (...args) => {
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
    readRuntime(token, owner) {
      const session = sessions.get(token)
      if (!session || session.owner !== owner) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      return session.environment
    },
    capturePersonalEnvironment: tracked(capturePersonalEnvironment),
    prepareProject: tracked(prepareProject),
    selectProject,
    release,
    releaseOwner,
    assetFile: (token, id) => sessions.get(token)?.files.get(id),
    close,
  }
}
