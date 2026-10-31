import type { Json } from '@arcadia-eternity/pack-loader/native'
import type { ContentRow, LocaleText, SourceRecord } from './types'
import { atField, clone, equal, object } from './fields'
import { recordKey } from './drafts'
import { references, resourcePaths } from './catalog'

export interface AssistantObject {
  key: string
  label: string
  access: 'editable' | 'reference-only'
  source: Pick<SourceRecord, 'file' | 'version' | 'index' | 'sharedFields'>
  record: ContentRow
  texts: Record<string, LocaleText>
}
export interface AssistantContext {
  protocol: 'arcadia-author-context/v1'
  snapshotId: string
  projectId: string
  request: string
  includesDrafts: boolean
  objects: AssistantObject[]
}
export interface AssistantProposal {
  key: string
  target: 'record' | 'locale'
  language?: string
  path: string[]
  before?: Json
  after?: Json
}
export interface ReviewedProposal {
  value: AssistantProposal
  done?: boolean
}
export function relatedKeys(rows: SourceRecord[], keys: string[], projectId: string) {
  const roots = rows.filter(row => keys.includes(recordKey(row)))
  const linked = rows.filter(
    row =>
      row.kind === 'presentations' &&
      object(row.record.target) &&
      roots.some(
        root =>
          root.kind === (row.record.target as Record<string, Json>).kind &&
          root.record.id === (row.record.target as Record<string, Json>).id,
      ),
  )
  const media = new Set(
    [...roots, ...linked].filter(row => row.kind === 'presentations').flatMap(row => resourcePaths(row.record)),
  )
  const targets = roots.flatMap(row => references(row, projectId))
  return rows
    .filter(
      row =>
        !keys.includes(recordKey(row)) &&
        (linked.includes(row) ||
          (row.kind === 'resources' && media.has(row.record.id)) ||
          targets.some(target => target.kind === row.kind && target.id === row.record.id) ||
          references(row, projectId).some(target =>
            roots.some(root => root.kind === target.kind && root.record.id === target.id),
          )),
    )
    .map(recordKey)
}
export function parseProposals(text: string, context: AssistantContext): AssistantProposal[] {
  const input: unknown = JSON.parse(text)
  if (
    !object(input) ||
    input.baseSnapshotId !== context.snapshotId ||
    !Array.isArray(input.proposals) ||
    input.proposals.length > 200
  )
    throw new Error('建议不属于本次协作快照，或格式不正确')
  const targets = new Set<string>()
  return input.proposals.map(value => {
    if (
      !object(value) ||
      !['record', 'locale'].includes(String(value.target)) ||
      typeof value.key !== 'string' ||
      !Array.isArray(value.path) ||
      !value.path.length ||
      value.path.some(
        part => typeof part !== 'string' || ['__proto__', 'constructor', 'prototype', '<<'].includes(String(part)),
      )
    )
      throw new Error('建议字段格式不正确')
    const entry = context.objects.find(entry => entry.key === value.key && entry.access === 'editable')
    if (!entry) throw new Error('建议修改了本次范围之外或仅供参考的对象')
    if (value.target === 'record' && value.path[0] === 'id') throw new Error('建议不能更改对象标识')
    if (
      value.target === 'locale' &&
      (typeof value.language !== 'string' ||
        !entry.texts[value.language] ||
        value.path.length !== 1 ||
        !['name', 'description'].includes(String(value.path[0])) ||
        typeof value.after !== 'string')
    )
      throw new Error('名称与描述建议必须使用本次提供的语言和文本字段')
    const base =
      value.target === 'record' ? entry.record : (entry.texts[String(value.language)] as Record<string, Json>)
    const path = value.path as string[]
    for (let depth = 1; depth < path.length; depth++) {
      const parent = atField(base, path.slice(0, depth))
      if (parent !== undefined && !object(parent)) throw new Error('列表和标量必须作为完整字段提交建议')
    }
    function safe(input: unknown) {
      if (Array.isArray(input)) input.forEach(safe)
      else if (object(input))
        Object.entries(input).forEach(([key, child]) => {
          if (['__proto__', 'prototype', 'constructor', '<<'].includes(key)) throw new Error('不支持的建议字段')
          safe(child)
        })
      else if (typeof input === 'number' && !Number.isFinite(input)) throw new Error('建议数值必须有限')
    }
    safe(value.after)
    const before = atField(base, path)
    if (!equal(before, value.before)) throw new Error('建议的原值与交接快照不一致')
    const key = JSON.stringify([value.key, value.target, value.language, value.path])
    if (targets.has(key)) throw new Error('同一字段存在重复建议')
    targets.add(key)
    return clone(value) as unknown as AssistantProposal
  })
}
