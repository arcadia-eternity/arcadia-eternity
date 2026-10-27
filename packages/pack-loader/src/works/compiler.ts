import type { BehaviorDefinition, ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import { valid as validVersion } from 'semver'
import {
  WorkError,
  canonical,
  cloneJson,
  collection,
  digestBytes,
  digestJson,
  fail,
  freeze,
  identifier,
  parseDraft,
  runtimeId,
  workKinds,
  type Json,
  type WorkAsset,
  type WorkDraft,
  type WorkHost,
  type WorkRelease,
  type WorkDependency,
  type WorkKind,
} from './model'

const hashPattern = /^[a-f0-9]{64}$/
const versionPattern = { test: (value: unknown) => typeof value === 'string' && validVersion(value) === value }
function checkAssets(assets: readonly WorkAsset[]): void {
  const seen = new Set<string>()
  let total = 0
  for (const asset of assets) {
    identifier(asset.id, 'assets.id')
    identifier(asset.variant, 'assets.variant')
    const id = `${asset.id}/${asset.variant}`
    if (seen.has(id)) fail('DUPLICATE_ASSET', 'assets', `重复素材变体：${id}`)
    seen.add(id)
    if (
      !hashPattern.test(asset.sha256) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 0 ||
      asset.bytes > 16 * 1024 * 1024
    )
      fail('INVALID_ASSET', 'assets', `素材摘要或大小无效：${id}`)
    if (!['image/png', 'image/jpeg', 'image/webp', 'audio/ogg', 'audio/mpeg'].includes(asset.mime))
      fail('UNSUPPORTED_ASSET', 'assets', `不支持的素材类型：${asset.mime}`)
    total += asset.bytes
  }
  if (total > 24 * 1024 * 1024) fail('LIMIT_EXCEEDED', 'assets', '素材总量超过 24 MiB')
}
export async function verifyAssets(
  assets: readonly WorkAsset[],
  blobs: Readonly<Record<string, Uint8Array>>,
): Promise<void> {
  checkAssets(assets)
  for (const asset of assets) {
    const bytes = blobs[asset.sha256]
    if (!bytes || bytes.length !== asset.bytes || (await digestBytes(bytes)) !== asset.sha256)
      fail('ASSET_INTEGRITY', 'assets', `素材缺失或字节摘要不匹配：${asset.id}/${asset.variant}`)
  }
}
function checkDependencies(dependencies: readonly WorkDependency[], projectId: string): void {
  const seen = new Set<string>()
  for (const dep of dependencies) {
    identifier(dep.projectId, 'dependencies.projectId')
    if (dep.projectId === 'base' || dep.projectId === projectId || seen.has(dep.projectId))
      fail('DEPENDENCY_CONFLICT', 'dependencies', '依赖不能重复、引用自身或替换官方基础内容', projectId)
    if (!versionPattern.test(dep.version) || !hashPattern.test(dep.digest))
      fail('UNRESOLVED_DEPENDENCY', 'dependencies', '发布前必须选择依赖的精确版本和摘要', projectId)
    seen.add(dep.projectId)
  }
}
function releaseDraft(release: WorkRelease): WorkDraft {
  return parseDraft({
    format: 'arcadia.work-draft',
    version: 1,
    project: release.project,
    revision: 0,
    data: release.data,
    dependencies: release.dependencies,
    assets: release.assets,
    requirements: release.requirements,
  })
}
export async function verifyRelease(input: unknown): Promise<WorkRelease> {
  const value = cloneJson(input) as WorkRelease
  if (
    !value ||
    value.format !== 'arcadia.work-release' ||
    value.version !== 1 ||
    !versionPattern.test(value.releaseVersion)
  )
    fail('UNSUPPORTED_FORMAT', 'format', '不支持的作品版本格式')
  const keys = [
    'format',
    'version',
    'project',
    'releaseVersion',
    'data',
    'dependencies',
    'assets',
    'requirements',
    'digest',
  ]
  if (Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_RELEASE', '', '固定版本包含未知顶层字段')
  releaseDraft(value)
  checkDependencies(value.dependencies, value.project.id)
  checkAssets(value.assets)
  const { digest, ...payload } = value
  if (digest !== (await digestJson(payload)))
    fail('RELEASE_INTEGRITY', 'digest', '作品内容已改变，摘要不匹配', value.project.id)
  return freeze(value)
}
export async function resolveReleases(
  selected: readonly WorkRelease[],
  installed: readonly WorkRelease[],
): Promise<readonly WorkRelease[]> {
  selected = cloneJson(selected)
  installed = cloneJson(installed)
  const index = new Map<string, WorkRelease>()
  for (const value of [...installed, ...selected]) {
    if (!value?.project?.id) fail('INVALID_RELEASE', 'project.id', '版本缺少作品身份')
    const key = `${value.project.id}@${value.releaseVersion}:${value.digest}`
    const previous = index.get(key)
    if (previous && canonical(previous) !== canonical(value))
      fail('RELEASE_INTEGRITY', 'digest', '同一摘要对应不同作品内容')
    index.set(key, value)
  }
  const resolved = new Map<string, WorkRelease>(),
    visiting = new Set<string>(),
    output: WorkRelease[] = []
  async function visit(candidate: WorkRelease): Promise<void> {
    if (visiting.has(candidate.project.id))
      fail('DEPENDENCY_CYCLE', 'dependencies', '作品依赖存在循环', candidate.project.id)
    const existing = resolved.get(candidate.project.id)
    if (existing) {
      if (existing.digest !== candidate.digest || existing.releaseVersion !== candidate.releaseVersion)
        fail(
          'VERSION_CONFLICT',
          'dependencies',
          `同一运行环境不能选用 ${candidate.project.id} 的两个版本`,
          candidate.project.id,
        )
      return
    }
    const release = await verifyRelease(candidate)
    visiting.add(release.project.id)
    for (const dep of [...release.dependencies].sort((a, b) => (a.projectId < b.projectId ? -1 : 1))) {
      const dependency = index.get(`${dep.projectId}@${dep.version}:${dep.digest}`)
      if (!dependency)
        fail('MISSING_DEPENDENCY', 'dependencies', `缺少固定依赖：${dep.projectId} ${dep.version}`, release.project.id)
      await visit(dependency)
    }
    visiting.delete(release.project.id)
    resolved.set(release.project.id, release)
    output.push(release)
  }
  for (const release of [...selected].sort((a, b) => (a.project.id < b.project.id ? -1 : 1))) await visit(release)
  return Object.freeze(output)
}

/** Rewrite only declared reference slots; text, tags and unexposed TS callback references never get guessed. */
function linkData(
  host: WorkHost,
  works: readonly Pick<WorkRelease, 'project' | 'data' | 'dependencies' | 'requirements'>[],
): ContentPrototypeData {
  const data = cloneJson({
    marks: [...host.base.marks],
    skills: [...host.base.skills],
    species: [...host.base.species],
    behaviors: [...(host.base.behaviors ?? [])],
  })
  const baseIds = new Map<WorkKind, Set<string>>()
  for (const kind of workKinds)
    baseIds.set(
      kind,
      new Set((kind === 'behavior' ? host.templates : data[collection[kind]]).map(raw => (raw as { id: string }).id)),
    )
  const byProject = new Map(works.map(work => [work.project.id, work]))
  const namespaces = new Map<string, string>()
  for (const work of works) {
    const owner = namespaces.get(work.project.namespace)
    if (owner && owner !== work.project.id)
      fail(
        'NAMESPACE_CONFLICT',
        'project.namespace',
        `命名空间 ${work.project.namespace} 已被另一选定作品占用`,
        work.project.id,
      )
    namespaces.set(work.project.namespace, work.project.id)
  }
  const allowedExports = new Set(
    host.allowedExports ??
      host.templates.flatMap(def => (def.implementation.kind === 'native' ? [def.implementation.exportId] : [])),
  )
  const definitions = new Map<string, BehaviorDefinition>(host.templates.map(def => [def.id, def]))
  for (const work of works) {
    for (const requirement of work.requirements) {
      if (!allowedExports.has(requirement.exportId) || requirement.registryBuildId !== host.build.registryBuildId)
        fail('UNTRUSTED_CAPABILITY', 'requirements', '作品要求的原生能力尚未安装、未获准或构建不匹配', work.project.id)
    }
    for (const kind of workKinds) {
      const seen = new Set<string>()
      for (const record of work.data[collection[kind]]) {
        if (seen.has(record.id))
          fail('DUPLICATE_ID', `data.${collection[kind]}`, `重复内容 ID：${record.id}`, work.project.id)
        seen.add(record.id)
      }
    }
    for (const record of work.data.behaviors) {
      const def = cloneJson(record) as unknown as BehaviorDefinition
      if (def.implementation?.kind !== 'native' || !allowedExports.has(def.implementation.exportId))
        fail('UNTRUSTED_CAPABILITY', 'data.behaviors', '作品只能引用已安装并获准的原生行为', work.project.id)
      definitions.set(runtimeId(work.project.namespace, record.id), {
        ...def,
        id: runtimeId(work.project.namespace, record.id),
      })
    }
  }
  for (const work of works) {
    const accessible = new Set(['base', work.project.id, ...work.dependencies.map(dep => dep.projectId)])
    function reference(value: Json | undefined, kind: WorkKind, path: string): string {
      if (typeof value === 'string') {
        if (!baseIds.get(kind)!.has(value))
          fail('MISSING_REFERENCE', path, `未知官方${kind}引用：${value}；作品内引用须携带作品身份`, work.project.id)
        return value
      }
      if (!value || typeof value !== 'object' || Array.isArray(value) || !('$ref' in value))
        fail('INVALID_REFERENCE', path, '需要明确的内容引用', work.project.id)
      const ref = value.$ref as Record<string, Json>
      if (
        !ref ||
        typeof ref !== 'object' ||
        ref.kind !== kind ||
        typeof ref.projectId !== 'string' ||
        typeof ref.id !== 'string'
      )
        fail('INVALID_REFERENCE', path, '内容引用的类型或身份无效', work.project.id)
      if (!accessible.has(ref.projectId))
        fail('UNDECLARED_DEPENDENCY', path, `请先声明依赖：${ref.projectId}`, work.project.id)
      if (ref.projectId === 'base') return reference(ref.id, kind, path)
      const source = byProject.get(ref.projectId)
      if (!source?.data[collection[kind]].some(item => item.id === ref.id))
        fail('MISSING_REFERENCE', path, `引用不存在：${ref.projectId}/${ref.id}`, work.project.id)
      return runtimeId(source.project.namespace, ref.id)
    }
    for (const kind of workKinds)
      for (const record of work.data[collection[kind]]) {
        const linked = cloneJson(record)
        linked.id = runtimeId(work.project.namespace, record.id)
        const path = `data.${collection[kind]}.${record.id}`
        if (kind === 'species') {
          for (const field of ['ability', 'emblem'])
            if (Array.isArray(linked[field]))
              linked[field] = linked[field].map((value, index) => reference(value, 'mark', `${path}.${field}.${index}`))
          if (Array.isArray(linked.learnable_skills))
            linked.learnable_skills = linked.learnable_skills.map((item, index) => {
              if (!item || typeof item !== 'object' || Array.isArray(item))
                fail('INVALID_DATA', path, '可学技能数据无效', work.project.id)
              return {
                ...item,
                skill_id: reference(item.skill_id, 'skill', `${path}.learnable_skills.${index}.skill_id`),
              }
            })
        }
        if ((kind === 'skill' || kind === 'mark') && Array.isArray(linked.behaviors))
          linked.behaviors = linked.behaviors.map((raw, index) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
              fail('INVALID_DATA', path, '行为使用无效', work.project.id)
            const id = reference(raw.definitionId, 'behavior', `${path}.behaviors.${index}.definitionId`)
            const definition = definitions.get(id)
            if (!definition) fail('MISSING_REFERENCE', path, `行为定义不存在：${id}`, work.project.id)
            if (definition.implementation.kind !== 'native' || !allowedExports.has(definition.implementation.exportId))
              fail('UNTRUSTED_CAPABILITY', path, `宿主未允许此行为：${id}`, work.project.id)
            const params = cloneJson(raw.params ?? {}) as Record<string, Json>
            if (!params || typeof params !== 'object' || Array.isArray(params))
              fail('INVALID_DATA', path, '效果参数必须为对象', work.project.id)
            for (const [name, param] of Object.entries(definition.parameters))
              if (param.kind === 'string' && param.reference)
                params[name] = reference(
                  params[name] ?? param.default,
                  param.reference,
                  `${path}.behaviors.${index}.params.${name}`,
                )
            return { ...raw, definitionId: id, params }
          })
        data[collection[kind]].push(linked)
      }
  }
  return data
}
function runtimeError(error: unknown, projectId?: string): never {
  if (error instanceof WorkError) throw error
  if (error && typeof error === 'object' && 'diagnostics' in error && Array.isArray(error.diagnostics))
    throw new WorkError(
      error.diagnostics.map(item => ({
        code: String(item.code),
        projectId,
        path: `${item.contentId}/${item.useId ?? ''}${item.field}`,
        message: String(item.message),
      })),
    )
  fail('CONTENT_INVALID', 'data', error instanceof Error ? error.message : '内容校验失败', projectId)
}

export async function compileRelease(
  input: WorkDraft,
  releaseVersion: string,
  host: WorkHost,
  installed: readonly WorkRelease[] = [],
  blobs: Readonly<Record<string, Uint8Array>> = {},
): Promise<WorkRelease> {
  const draft = parseDraft(input)
  installed = cloneJson(installed)
  host = captureHost(host)
  if (!versionPattern.test(releaseVersion)) fail('INVALID_VERSION', 'releaseVersion', '版本应为 1.0.0 形式')
  checkDependencies(draft.dependencies, draft.project.id)
  await verifyAssets(draft.assets, blobs)
  const dependencies = draft.dependencies.map(dep => {
    const value = installed.find(
      item => item.project.id === dep.projectId && item.releaseVersion === dep.version && item.digest === dep.digest,
    )
    if (!value) fail('MISSING_DEPENDENCY', 'dependencies', `缺少依赖 ${dep.projectId} ${dep.version}`, draft.project.id)
    return value
  })
  const resolved = await resolveReleases(dependencies, installed)
  if (resolved.some(work => work.project.id === draft.project.id))
    fail('DEPENDENCY_CYCLE', 'dependencies', '作品依赖形成循环', draft.project.id)
  const payload = {
    format: 'arcadia.work-release' as const,
    version: 1 as const,
    project: draft.project,
    releaseVersion,
    data: draft.data,
    dependencies: [...draft.dependencies].sort((a, b) => (a.projectId < b.projectId ? -1 : 1)),
    assets: [...draft.assets].sort((a, b) => (`${a.id}/${a.variant}` < `${b.id}/${b.variant}` ? -1 : 1)),
    requirements: [...draft.requirements].sort((a, b) => (a.exportId < b.exportId ? -1 : 1)),
  }
  try {
    host.createContent(linkData(host, [...resolved, draft]), 'arcadia.work-candidate/1')
  } catch (error) {
    runtimeError(error, draft.project.id)
  }
  return freeze({ ...payload, digest: await digestJson(payload) })
}

function captureHost(host: WorkHost): WorkHost {
  return {
    ...host,
    base: cloneJson(host.base),
    build: freeze(cloneJson(host.build)),
    templates: cloneJson(host.templates),
    ...(host.allowedExports ? { allowedExports: [...host.allowedExports] } : {}),
  }
}

export async function prepareWorkEnvironment(
  host: WorkHost,
  selected: readonly WorkRelease[],
  installed: readonly WorkRelease[] = [],
  policy: Readonly<Record<string, Json>> = {},
) {
  if (
    host.build.formatVersion !== 1 ||
    !hashPattern.test(host.build.coreBuildId) ||
    !hashPattern.test(host.build.registryBuildId)
  )
    fail('UNTRUSTED_BUILD', 'build', '宿主必须提供有效的可信构建身份')
  const capturedHost = captureHost(host)
  selected = cloneJson(selected)
  installed = cloneJson(installed)
  policy = cloneJson(policy)
  const releases = await resolveReleases(selected, installed)
  const roots = [...new Map(selected.map(release => [release.project.id, release])).values()]
    .map(release => ({ projectId: release.project.id, version: release.releaseVersion, digest: release.digest }))
    .sort((a, b) => (a.projectId < b.projectId ? -1 : 1))
  const manifest = freeze({
    format: 'arcadia.work-environment' as const,
    version: 1 as const,
    roots,
    releases: releases.map(release => ({
      projectId: release.project.id,
      version: release.releaseVersion,
      digest: release.digest,
    })),
    baseDigest: await digestJson(capturedHost.base),
    build: capturedHost.build,
    policy: cloneJson(policy),
    allowedExports: [
      ...(capturedHost.allowedExports ??
        capturedHost.templates.flatMap(def =>
          def.implementation.kind === 'native' ? [def.implementation.exportId] : [],
        )),
    ].sort(),
  })
  const revision = `arcadia.work-environment/1:${await digestJson(manifest)}`
  try {
    const data = freeze(linkData(capturedHost, releases))
    const content = capturedHost.createContent(data, revision)
    return Object.freeze({
      runtime: 'native-v4' as const,
      content,
      data,
      revision,
      build: capturedHost.build,
      manifest,
      releases,
      packs: releases.map(release => ({ id: release.project.id, version: release.releaseVersion })),
    })
  } catch (error) {
    runtimeError(error)
  }
}
