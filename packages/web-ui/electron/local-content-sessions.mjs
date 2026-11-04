import { randomUUID } from 'node:crypto'

/** Static preparation only: author modules are compiled by the loader, never evaluated here. */
export function createLocalContentSessions({ library, load, assetUrl }) {
  const sessions = new Map()
  const cache = new Map()
  const retired = new Set()
  const pending = new Map()
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
  async function prepare(owner) {
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
    let prepared
    try {
      const runtime = await load()
      prepared = lease.builtinOnly ? undefined : await compileProject(lease.directory)
      assertOpen()
      if (owner !== undefined && retiredOwners.has(owner)) throw new Error('LOCAL_CONTENT_OWNER_RELEASED')
      const source = prepared ?? runtime.base
      if (!source.sandbox) throw new Error('LOCAL_SANDBOX_MISSING')
      const token = randomUUID()
      const files = new Map()
      const resources = new Map()
      for (const pkg of prepared?.presentation ?? []) {
        for (const resource of pkg.manifest.resources) {
          if (resource.kind === 'http') resources.set(`${pkg.namespace}:${resource.id}`, resource.source)
        }
        for (const resource of pkg.resources) {
          files.set(resource.sha256, { file: resource.file, mime: resource.mime })
          resources.set(`${pkg.namespace}:${resource.id}`, assetUrl(token, resource.sha256))
        }
      }
      for (const release of prepared?.releases ?? [])
        for (const asset of release.assets) {
          const file = prepared.assetFile(asset.sha256)
          if (file) files.set(asset.sha256, { file, mime: asset.mime })
        }
      const text = raw =>
        Object.fromEntries(
          ['name', 'description'].filter(key => typeof raw[key] === 'string').map(key => [key, raw[key]]),
        )
      const content = {
        species: source.data.species.map(raw => ({
          ...runtime.parseWithErrors(runtime.SpeciesSchema, raw),
          ...text(raw),
        })),
        skills: source.data.skills.map(raw => {
          const { effect, ...display } = runtime.parseWithErrors(runtime.SkillSchema, raw)
          return { ...display, ...text(raw) }
        }),
        marks: source.data.marks.map(raw => {
          const mark = runtime.parseWithErrors(runtime.MarkSchema, raw)
          return {
            id: mark.id,
            tags: mark.tags ?? [],
            ...(mark.presentation ? { presentation: mark.presentation } : {}),
            ...text(raw),
          }
        }),
      }
      const official = runtime.presentationIndex(runtime.base.presentation)
      for (const kind of ['species', 'skills', 'marks'])
        for (const row of content[kind]) {
          const presentation = official.get(`${kind}:${row.id}`)
          if (presentation) row.presentation = structuredClone(presentation)
        }
      for (const pkg of prepared?.presentation ?? [])
        for (const binding of pkg.manifest.bindings) {
          const { id, target, ...presentation } = binding
          const owner = content[target.kind].find(row => row.id === `${pkg.namespace}:${target.id}`)
          if (!owner) throw new Error('PRESENTATION_TARGET')
          owner.presentation = structuredClone(presentation)
        }
      const resolveResource = (owner, ref) => {
        if (!ref) return ref
        if (typeof ref === 'string' && /^https?:\/\//.test(ref)) return ref
        const namespace = typeof ref === 'object' ? ref.namespace : owner.slice(0, owner.indexOf(':'))
        const id = typeof ref === 'object' ? ref.id : ref
        const url = resources.get(`${namespace}:${id}`)
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
      const bundles = structuredClone(runtime.base.locales ?? {})
      const kinds = {
        species: 'species',
        skill: 'skills',
        mark: 'marks',
        mark_ability: 'marks',
        mark_emblem: 'marks',
        mark_global: 'marks',
      }
      for (const [language, namespaces] of Object.entries(bundles))
        for (const namespace of Object.keys(namespaces)) {
          if (!kinds[namespace]) {
            delete namespaces[namespace]
            continue
          }
          const known = new Set(content[kinds[namespace]].map(row => row.id))
          namespaces[namespace] = Object.fromEntries(
            Object.entries(namespaces[namespace]).filter(([id]) => known.has(id)),
          )
        }
      for (const pkg of prepared?.presentation ?? [])
        for (const [language, namespaces] of Object.entries(pkg.manifest.locales))
          for (const [namespace, entries] of Object.entries(namespaces)) {
            const target = ((bundles[language] ??= {})[namespace] ??= {})
            for (const [id, value] of Object.entries(entries)) target[`${pkg.namespace}:${id}`] = structuredClone(value)
          }
      content.locales = { defaultLocale: prepared?.presentation[0]?.manifest.defaultLocale ?? 'zh-CN', bundles }
      const result = structuredClone({ token, environment: source.sandbox, content })
      sessions.set(token, { files, prepared, lease, owner })
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
  async function prepareProject({ directory, builtinOnly = false }) {
    assertOpen()
    if (builtinOnly) {
      await load()
      assertOpen()
      return
    }
    await compileProject(directory, true)
    await collect()
  }
  function selectProject({ directory, builtinOnly }) {
    activeDirectory = builtinOnly ? null : directory
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
    prepareProject: tracked(prepareProject),
    selectProject,
    release,
    releaseOwner,
    assetFile: (token, id) => sessions.get(token)?.files.get(id),
    close,
  }
}
