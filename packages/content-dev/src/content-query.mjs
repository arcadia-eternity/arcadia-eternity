import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AuthorWorkspace, WorkspaceError, diagnostic } from './workspace.mjs'
import { recordSharing } from './lib/yaml-sharing.mjs'

const kinds = ['content', 'presentations', 'resources', 'assets', 'files', 'locales', 'diagnostics']
const contentKinds = ['species', 'skills', 'marks', 'behaviors', 'presentations', 'resources']
const localeKinds = {
  species: 'species',
  skill: 'skills',
  mark: 'marks',
  mark_ability: 'marks',
  mark_emblem: 'marks',
  mark_global: 'marks',
}
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const invalid = message => {
  throw new WorkspaceError('QUERY_INVALID', message)
}
const pageBytes = 2 * 1024 * 1024
const packageLimit = 256
const packageNamePattern = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/i

function options(input) {
  const value = { kind: 'content', scope: 'project', detail: 'summary', search: '', offset: 0, limit: 50, ...input }
  if (!kinds.includes(value.kind)) invalid('查询类型无效')
  if (!['project', 'dependencies', 'all'].includes(value.scope)) invalid('查询范围无效')
  if (!['summary', 'full'].includes(value.detail)) invalid('查询详情级别无效')
  if (value.contentKind !== undefined && !contentKinds.includes(value.contentKind)) invalid('内容类型无效')
  for (const key of ['search', 'id', 'locale', 'namespace', 'packageName'])
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 200))
      invalid(`${key} 需要不超过 200 字符的文本`)
  if (!Number.isInteger(value.offset) || value.offset < 0) invalid('offset 需要非负整数')
  if (!Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100) invalid('limit 需要 1–100 的整数')
  return value
}

function runtimeDependencies(manifest) {
  const entries = new Map()
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
    for (const name of Object.keys(manifest[field] ?? {}).sort(compare)) {
      if (!packageNamePattern.test(name)) throw new WorkspaceError('DEPENDENCY_INVALID', '依赖包名无效', 'package.json')
      entries.set(name, field === 'optionalDependencies' || manifest.peerDependenciesMeta?.[name]?.optional === true)
    }
  return [...entries].sort(([a], [b]) => compare(a, b))
}

// Resolve declared packages without executing package exports or consulting global module paths.
async function installedPackage(from, name) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name)
    try {
      const root = await realpath(candidate)
      const file = join(root, 'package.json')
      const info = await lstat(file)
      if (!info.isFile() || info.size > pageBytes)
        throw new WorkspaceError('DEPENDENCY_INVALID', '依赖清单需要不超过 2 MiB 的普通文件', file)
      return { root, manifest: JSON.parse(await readFile(file, 'utf8')) }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (dirname(directory) === directory) throw new WorkspaceError('DEPENDENCY_MISSING', `未安装声明的依赖：${name}`)
  }
}

function provenance(snapshot, scope, manifest) {
  return {
    namespace: snapshot.project.namespace,
    packageName: manifest.name,
    packageVersion: manifest.version,
    projectId: snapshot.project.projectId,
    scope,
    readOnly: scope === 'dependencies' || !snapshot.capabilities.sourceEditing,
  }
}

async function catalogs(workspace, scope) {
  const manifest = JSON.parse((await workspace.read('package.json')).text)
  const project = await workspace.snapshot()
  const own = { snapshot: project, owner: provenance(project, 'project', manifest) }
  const result = scope === 'dependencies' ? [] : [own]
  const diagnostics = []
  if (scope === 'project') return { catalogs: result, diagnostics }
  const queue = runtimeDependencies(manifest).map(([name, optional]) => ({ from: workspace.root, name, optional }))
  const visited = new Set([workspace.root])
  const identities = new Map([[project.project.namespace, manifest.name]])
  let inspected = 0
  while (queue.length) {
    if (++inspected > packageLimit) {
      diagnostics.push({
        code: 'DEPENDENCY_QUERY_LIMIT',
        severity: 'warning',
        message: '依赖查询超过 256 项，请缩小依赖树；结果不完整',
      })
      break
    }
    const { from, name, optional } = queue.shift()
    let dependency
    try {
      const { root, manifest: metadata } = await installedPackage(from, name)
      if (visited.has(root)) continue
      visited.add(root)
      if (metadata.arcadia || metadata.name === '@arcadia-eternity/data-pack-base') {
        dependency = await AuthorWorkspace.open(root, { watch: false, readOnly: true, published: !!metadata.arcadia })
        const snapshot = await dependency.snapshot()
        const owner = provenance(snapshot, 'dependencies', metadata)
        const previous = identities.get(owner.namespace)
        if (previous !== undefined)
          diagnostics.push({
            ...owner,
            code: 'NAMESPACE_CONFLICT',
            severity: 'error',
            message: `命名空间 ${owner.namespace} 同时用于 ${previous} 和 ${metadata.name}`,
          })
        identities.set(owner.namespace, metadata.name)
        result.push({ snapshot, owner })
        // Match the loader's visible content dependencies: stop at each content package.
      } else {
        queue.push(
          ...runtimeDependencies(metadata).map(([child, absentAllowed]) => ({
            from: root,
            name: child,
            optional: absentAllowed,
          })),
        )
      }
    } catch (error) {
      if (!(optional && error.code === 'DEPENDENCY_MISSING'))
        diagnostics.push({ ...diagnostic(error), packageName: name, scope: 'dependencies', readOnly: true })
    } finally {
      await dependency?.close()
    }
  }
  return { catalogs: result, diagnostics }
}

function translations(snapshot, row, locale) {
  return snapshot.localeSources
    .flatMap(source =>
      localeKinds[source.namespace] === row.kind &&
      (!locale || source.language === locale) &&
      source.entries[row.record.id]
        ? [{ locale: source.language, localeNamespace: source.namespace, ...source.entries[row.record.id] }]
        : [],
    )
    .sort((a, b) => compare(a.locale, b.locale) || compare(a.localeNamespace, b.localeNamespace))
}

function nameFields(localizations, requested, fallback) {
  const locale = requested ?? localizations.find(entry => entry.locale === 'zh-CN')?.locale ?? localizations[0]?.locale
  const names = [
    ...new Set(
      localizations
        .filter(entry => entry.locale === locale)
        .map(entry => entry.name)
        .filter(Boolean),
    ),
  ]
  return {
    ...(locale ? { locale } : {}),
    ...(names.length === 1
      ? { name: names[0].slice(0, 200) }
      : !names.length && typeof fallback === 'string'
        ? { name: fallback.slice(0, 200) }
        : {}),
    ...(names.length > 1 ? { ambiguousName: true } : {}),
  }
}

function rowsFor({ snapshot, owner }, query) {
  const identify = (id, kind, source = {}) => ({
    ...owner,
    kind,
    id,
    qualifiedId: `${owner.namespace}:${id}`,
    ...source,
  })
  if (query.kind === 'locales')
    return snapshot.localeSources.flatMap(source =>
      Object.entries(source.entries).map(([id, record]) => {
        const row = identify(id, 'locales', {
          contentKind: localeKinds[source.namespace],
          file: source.file,
          version: source.version,
          locale: source.language,
          localeNamespace: source.namespace,
          ...(source.locations?.[id] ?? {}),
        })
        return {
          row,
          text: JSON.stringify({ ...row, ...record }),
          full: { ...row, record, sharedFields: recordSharing(source.sharedFields, id) },
          summary: {
            ...row,
            ...(record.name ? { name: record.name.slice(0, 200) } : {}),
            ...(record.description ? { descriptionPreview: record.description.slice(0, 240) } : {}),
          },
        }
      }),
    )
  if (query.kind === 'files' || query.kind === 'diagnostics')
    return (query.kind === 'files' ? snapshot.files : snapshot.diagnostics).map(entry => {
      const row = { ...owner, kind: query.kind, ...entry }
      return { row, text: JSON.stringify(row), full: row, summary: row }
    })
  if (query.kind === 'assets')
    return snapshot.assets.map(asset => {
      const definition = snapshot.records.find(
        row => row.kind === 'resources' && row.record.id === asset.id && row.file === asset.definition,
      )
      const { kind: resourceKind, ...metadata } = asset
      const row = identify(asset.id, 'assets', {
        contentKind: 'resources',
        resourceKind,
        ...metadata,
        ...(definition ? { version: definition.version, index: definition.index } : {}),
      })
      const { references, ...summary } = row
      return { row, text: JSON.stringify(row), full: row, summary: { ...summary, referenceCount: references.length } }
    })
  return snapshot.records
    .filter(row => !['presentations', 'resources'].includes(query.kind) || row.kind === query.kind)
    .map(source => {
      const localizations = translations(snapshot, source, query.locale)
      const row = identify(source.record.id, source.kind, {
        contentKind: source.kind,
        file: source.file,
        version: source.version,
        index: source.index,
        ...(source.line ? { line: source.line, column: source.column } : {}),
        ...nameFields(localizations, query.locale, source.record.name),
      })
      return {
        row,
        text: JSON.stringify({ ...row, record: source.record, localizations }),
        summary: row,
        full: { ...row, record: source.record, sharedFields: source.sharedFields, localizations },
      }
    })
}

/** Read-only discovery over disk data. Never loads effects or changes workbench selection/drafts. */
export async function queryContent(workspace, input = {}) {
  const query = options(input)
  const { catalogs: sources, diagnostics } = await catalogs(workspace, query.scope)
  const needle = query.search.toLowerCase()
  const rows = sources
    .flatMap(source => rowsFor(source, query))
    .filter(
      ({ row, text }) =>
        (query.id === undefined || row.id === query.id || row.qualifiedId === query.id) &&
        (query.contentKind === undefined || row.contentKind === query.contentKind) &&
        (query.namespace === undefined || row.namespace === query.namespace) &&
        (query.packageName === undefined || row.packageName === query.packageName) &&
        (query.kind !== 'locales' || query.locale === undefined || row.locale === query.locale) &&
        text.toLowerCase().includes(needle),
    )
  if (
    query.id !== undefined &&
    ['content', 'presentations', 'resources', 'assets'].includes(query.kind) &&
    rows.length > 1
  )
    diagnostics.push({
      code: 'CONTENT_AMBIGUOUS',
      severity: 'warning',
      message: '此 ID 对应多个对象；请使用 contentKind、namespace 或 packageName 明确目标',
    })
  const items = []
  let bytes = 0
  for (const candidate of rows.slice(query.offset, query.offset + query.limit)) {
    const item = candidate[query.detail === 'full' ? 'full' : 'summary']
    const size = Buffer.byteLength(JSON.stringify(item))
    if (bytes + size > pageBytes) {
      if (!items.length)
        throw new WorkspaceError('QUERY_ITEM_TOO_LARGE', '此详情超过 2 MiB，请查询摘要并读取对应源码文件')
      break
    }
    bytes += size
    items.push(item)
  }
  const next = query.offset + items.length
  return { total: rows.length, offset: query.offset, nextOffset: next < rows.length ? next : null, items, diagnostics }
}
