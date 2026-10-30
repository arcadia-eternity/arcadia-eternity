import type { Json } from '@arcadia-eternity/pack-loader/native'
import type { LocaleSource, SourceRecord } from './types'
import { object } from './fields'

export const namespaces: Record<string, string[]> = {
  species: ['species'],
  skills: ['skill'],
  marks: ['mark', 'mark_ability', 'mark_emblem', 'mark_global'],
}
export function textSource(sources: LocaleSource[], row: SourceRecord, language: string) {
  const candidates = sources.filter(
    source => source.language === language && namespaces[row.kind]?.includes(source.namespace),
  )
  const existing = candidates.filter(source => Object.hasOwn(source.entries, row.record.id))
  if (existing.length === 1) return existing[0]
  if (existing.length > 1) return undefined
  // Reuse the object's known namespace in another language, rather than guessing mark/ability/emblem.
  const known = [
    ...new Set(
      sources
        .filter(
          source => namespaces[row.kind]?.includes(source.namespace) && Object.hasOwn(source.entries, row.record.id),
        )
        .map(source => source.namespace),
    ),
  ]
  const matching = known.length === 1 ? candidates.filter(source => source.namespace === known[0]) : candidates
  return matching.length === 1 ? matching[0] : undefined
}
export function resourcePaths(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(resourcePaths)
  if (!object(value) || Object.hasOwn(value, 'namespace')) return []
  return Object.entries(value)
    .filter(([key]) => !['renderer', 'mime', 'kind'].includes(key))
    .flatMap(([, child]) => resourcePaths(child))
}
export function referenceTarget(
  value: Json | undefined,
  kind: string,
  projectId: string,
): { kind: string; id: string } | undefined {
  if (typeof value === 'string') return { kind, id: value }
  if (object(value) && object(value.$ref) && value.$ref.projectId === projectId && typeof value.$ref.id === 'string')
    return {
      kind:
        ({ skill: 'skills', mark: 'marks', behavior: 'behaviors', species: 'species' } as Record<string, string>)[
          String(value.$ref.kind)
        ] ?? kind,
      id: value.$ref.id,
    }
}
export function referenceValue(entry: Json, key: string): Json | undefined {
  return object(entry) && key === 'learnable_skills'
    ? entry.skill_id
    : object(entry) && key === 'behaviors'
      ? entry.definitionId
      : entry
}
export function references(row: SourceRecord, projectId: string) {
  const found: { kind: string; id: string }[] = []
  for (const [key, kind] of [
    ['learnable_skills', 'skills'],
    ['ability', 'marks'],
    ['emblem', 'marks'],
    ['behaviors', 'behaviors'],
    ['effect', 'behaviors'],
  ] as const) {
    const values = row.record[key]
    if (!Array.isArray(values)) continue
    for (const entry of values) {
      const target = referenceTarget(referenceValue(entry, key), kind, projectId)
      if (target) found.push(target)
    }
  }
  return found
}
export function consumers(rows: SourceRecord[], target: { kind: string; id: string }, projectId: string) {
  return rows.filter(row =>
    references(row, projectId).some(reference => reference.kind === target.kind && reference.id === target.id),
  )
}
const fieldNames: Record<string, string> = {
  name: '名称',
  description: '描述',
  element: '属性',
  category: '类别',
  power: '威力',
  rage: '怒气消耗',
  accuracy: '命中率',
  priority: '优先级',
  baseStats: '种族值',
  hp: '体力',
  atk: '物攻',
  def: '物防',
  spa: '特攻',
  spd: '特防',
  spe: '速度',
  config: '印记配置',
  duration: '持续回合',
  maxStacks: '叠加上限',
  stackable: '允许叠加',
  learnable_skills: '学习技能',
  ability: '特性',
  emblem: '纹章',
  behaviors: '效果',
  presentation: '形象与声音',
  icon: '图标',
  portrait: '立绘',
  battle: '战斗形象',
  source: '资源',
  fallback: '备用图片',
  cry: '叫声',
  sfx: '音效',
  tags: '标签',
}
export const fieldLabel = (path: (string | number)[]) =>
  path.map(key => fieldNames[String(key)] ?? String(key)).join(' · ') || '整个对象'
export function showValue(value: unknown, labels: Record<string, string> = {}, projectId = ''): string {
  if (value === undefined) return '未设置'
  if (value === null) return '无'
  if (typeof value === 'string') return value || '空文本'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value))
    return value.length ? value.map(item => showValue(item, labels, projectId)).join('；') : '无'
  if (object(value)) {
    if (object(value.$ref)) {
      const target = referenceTarget(value, '', projectId)
      return target ? labels[`${target.kind}:${target.id}`] || target.id : `${value.$ref.projectId} / ${value.$ref.id}`
    }
    if (Object.hasOwn(value, 'skill_id'))
      return `${showValue(value.skill_id, labels, projectId)} · ${value.level ?? 1} 级${value.hidden ? ' · 隐藏' : ''}`
    if (Object.hasOwn(value, 'definitionId'))
      return `${showValue(value.definitionId, labels, projectId)}${value.params ? ' · ' + showValue(value.params, labels, projectId) : ''}`
    return Object.entries(value)
      .map(([key, child]) => `${fieldLabel([key])}：${showValue(child, labels, projectId)}`)
      .join('；')
  }
  return String(value)
}
