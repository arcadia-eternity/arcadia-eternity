import type {
  BehaviorDefinition,
  ContentCatalog,
  ContentPrototypeData,
  EnvironmentBuildIdentity,
} from '@arcadia-eternity/battle/v4'

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type WorkKind = 'species' | 'skill' | 'mark' | 'behavior'
export type WorkRecord = { id: string; [field: string]: Json }
export interface WorkReference {
  $ref: { projectId: string; kind: WorkKind; id: string }
}
export interface WorkData {
  species: WorkRecord[]
  skills: WorkRecord[]
  marks: WorkRecord[]
  behaviors: WorkRecord[]
}
export interface WorkDependency {
  projectId: string
  version: string
  digest: string
}
export interface WorkAsset {
  id: string
  variant: string
  mime: string
  bytes: number
  sha256: string
}
export interface WorkRequirement {
  exportId: string
  registryBuildId: string
}
export interface WorkProject {
  id: string
  namespace: string
  title: string
  description: string
  origin?: { projectId: string; digest?: string }
}
export interface WorkDraft {
  format: 'arcadia.work-draft'
  version: 1
  project: WorkProject
  revision: number
  data: WorkData
  dependencies: WorkDependency[]
  assets: WorkAsset[]
  requirements: WorkRequirement[]
}
export interface WorkRelease {
  format: 'arcadia.work-release'
  version: 1
  project: WorkProject
  releaseVersion: string
  data: WorkData
  dependencies: WorkDependency[]
  assets: WorkAsset[]
  requirements: WorkRequirement[]
  digest: string
}
export interface WorkHost {
  readonly build: EnvironmentBuildIdentity
  readonly base: ContentPrototypeData
  readonly templates: readonly BehaviorDefinition[]
  readonly createContent: (data: ContentPrototypeData, revision: string) => ContentCatalog
  /** Approved export identities are host policy; a work cannot install code by declaring a requirement. */
  readonly allowedExports?: readonly string[]
}
export interface WorkDiagnostic {
  code: string
  projectId?: string
  path: string
  message: string
}
export class WorkError extends Error {
  constructor(readonly diagnostics: readonly WorkDiagnostic[]) {
    super(diagnostics.map(item => item.message).join('; '))
    this.name = 'WorkError'
  }
}
export const workKinds = ['species', 'skill', 'mark', 'behavior'] as const
export const collection = { species: 'species', skill: 'skills', mark: 'marks', behavior: 'behaviors' } as const
export const limits = Object.freeze({ bytes: 32 * 1024 * 1024, nodes: 300000, depth: 32, records: 5000, assets: 256 })
export function fail(code: string, path: string, message: string, projectId?: string): never {
  throw new WorkError([{ code, path, message, ...(projectId ? { projectId } : {}) }])
}
export function identifier(value: unknown, path = 'id'): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(value))
    fail('INVALID_ID', path, 'ID 必须由 1–80 个字母、数字、点、短横线或下划线组成')
}
export function validateNamespace(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value))
    fail('INVALID_NAMESPACE', 'project.namespace', '命名空间只能包含小写字母、数字、点、短横线和下划线')
}
/** Content type is carried by the reference/catalog, never embedded in namespace:id. */
export function runtimeId(namespace: string, id: string): string {
  validateNamespace(namespace)
  if (!/^[a-z0-9][a-z0-9_./-]{0,119}$/.test(id) || id.split('/').some(part => !part || part === '.' || part === '..'))
    fail('INVALID_ID', 'id', '内容 ID 只能包含小写字母、数字、点、短横线、下划线和有效路径段')
  return `${namespace}:${id}`
}
export function workRef(
  projectId: string,
  kind: WorkKind,
  id: string,
): { $ref: { projectId: string; kind: WorkKind; id: string } } {
  return { $ref: { projectId, kind, id } }
}
export function createDraft(id: string, title: string, namespace = id): WorkDraft {
  identifier(id)
  validateNamespace(namespace)
  if (namespace === 'base') fail('RESERVED_NAMESPACE', 'project.namespace', 'base 为官方内容保留命名空间')
  if (['constructor', 'prototype'].includes(id)) fail('RESERVED_ID', 'project.id', '该作品身份为保留名称')
  if (id === 'base') fail('RESERVED_ID', 'project.id', '官方基础内容身份不能作为用户作品身份')
  return {
    format: 'arcadia.work-draft',
    version: 1,
    project: { id, namespace, title, description: '' },
    revision: 0,
    data: { species: [], skills: [], marks: [], behaviors: [] },
    dependencies: [],
    assets: [],
    requirements: [],
  }
}

/** Traverse before stringify/clone: reject executable values, prototypes, cycles and unbounded imports. */
export function cloneJson<T>(input: T): T {
  let nodes = 0
  const ancestors = new Set<object>()
  function visit(value: unknown, depth: number): void {
    if (++nodes > limits.nodes || depth > limits.depth) fail('LIMIT_EXCEEDED', '', '作品结构超过大小或嵌套限制')
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number' && Number.isFinite(value)) return
    if (!value || typeof value !== 'object') fail('INVALID_DATA', '', '作品只能包含有限的 JSON 数据')
    if (ancestors.has(value)) fail('INVALID_DATA', '', '作品不能包含循环对象')
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      fail('INVALID_DATA', '', '作品只能包含普通数据对象')
    ancestors.add(value)
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_DATA', key, '不允许的属性名')
      visit(child, depth + 1)
    }
    ancestors.delete(value)
  }
  visit(input, 0)
  const json = JSON.stringify(input)
  if (new TextEncoder().encode(json).length > limits.bytes) fail('LIMIT_EXCEEDED', '', '作品超过 32 MiB 限制')
  return JSON.parse(json) as T
}
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const value = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export const digestJson = (value: unknown) => digestBytes(new TextEncoder().encode(canonical(value)))

function object(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_DATA', path, '需要数据对象')
}
/** Draft admission preserves incomplete record fields; it does not pretend they are runtime definitions. */
export function parseDraft(input: unknown): WorkDraft {
  const value = cloneJson(input)
  object(value, '')
  if (value.format !== 'arcadia.work-draft' || value.version !== 1)
    fail('UNSUPPORTED_FORMAT', 'format', '不支持的作品草稿格式')
  if (
    Object.keys(value).some(
      key =>
        !['format', 'version', 'project', 'revision', 'data', 'dependencies', 'assets', 'requirements'].includes(key),
    )
  )
    fail('INVALID_DATA', '', '草稿包含未知顶层字段')
  object(value.project, 'project')
  identifier(value.project.id, 'project.id')
  validateNamespace(value.project.namespace)
  if (value.project.namespace === 'base') fail('RESERVED_NAMESPACE', 'project.namespace', '不能占用官方命名空间')
  if (['constructor', 'prototype'].includes(value.project.id)) fail('RESERVED_ID', 'project.id', '该作品身份为保留名称')
  if (value.project.id === 'base') fail('RESERVED_ID', 'project.id', '不能覆盖官方基础内容')
  if (
    typeof value.project.title !== 'string' ||
    value.project.title.length > 200 ||
    typeof value.project.description !== 'string' ||
    value.project.description.length > 20000
  )
    fail('INVALID_DATA', 'project', '作品名称或说明无效')
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    fail('INVALID_DATA', 'revision', '草稿修订号无效')
  object(value.data, 'data')
  for (const kind of workKinds) {
    const records = value.data[collection[kind]]
    if (!Array.isArray(records) || records.length > limits.records)
      fail('LIMIT_EXCEEDED', `data.${collection[kind]}`, '内容列表无效或超过上限')
    for (const record of records) {
      object(record, collection[kind])
      if (typeof record.id !== 'string') fail('INVALID_ID', `${collection[kind]}.id`, '内容缺少 ID')
      runtimeId(value.project.namespace as string, record.id)
    }
  }
  for (const field of ['dependencies', 'assets', 'requirements'])
    if (!Array.isArray(value[field]) || value[field].length > limits.assets)
      fail('LIMIT_EXCEEDED', field, '清单无效或超过上限')
  for (const field of ['dependencies', 'assets', 'requirements'] as const)
    for (const item of value[field] as unknown[]) object(item, field)
  return value as unknown as WorkDraft
}

export function forkDraft(input: WorkDraft | WorkRelease, newId: string, namespace = newId): WorkDraft {
  identifier(newId)
  if (newId === input.project.id || newId === 'base') fail('INVALID_ID', 'project.id', '副本必须使用新的作品身份')
  const draft = createDraft(newId, `${input.project.title} 副本`, namespace)
  const source = cloneJson(input)
  // Only explicitly structured references are remapped; arbitrary text and trusted callback internals are untouched.
  function rewrite(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const ref = Reflect.get(value, '$ref')
    if (ref && typeof ref === 'object' && ref.projectId === input.project.id) ref.projectId = newId
    for (const child of Object.values(value)) rewrite(child)
  }
  draft.data = source.data
  rewrite(draft.data)
  draft.project.description = source.project.description
  draft.project.origin = { projectId: source.project.id, ...('digest' in source ? { digest: source.digest } : {}) }
  draft.dependencies = source.dependencies
  draft.assets = source.assets
  draft.requirements = source.requirements
  if (
    draft.data.behaviors.some(record => (record.implementation as Record<string, Json> | undefined)?.kind === 'native')
  )
    fail(
      'NATIVE_FORK_REQUIRES_REVIEW',
      'data.behaviors',
      '自定义原生导出可能含硬编码引用；请由原作者确认依赖后再创建副本',
    )
  return parseDraft(draft)
}
